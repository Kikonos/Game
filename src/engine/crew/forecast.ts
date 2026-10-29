// Peak staffing heads-up (27 Oct 2026, approved by the player): "a heads-up in the Crew screen about 4–6 weeks before a
// busy month, e.g. 'July needs 3 more A320 cabin crew sets', so you can hire or train in time."
//
// Month by month over the next three calendar months, per fleet family and role, the crew-days the signed work needs
// against the crew-days the crew can give:
// - need: every duty the signed flying makes (the roster's duties where it has planned them, else the legs grouped
//   into days of work as the planner would), with the days away from base around it (night stops, positioning), each
//   times its crew (the extra crew asked for, a client's own cabin crew left out, ferries pilots only, relief pilots on
//   long days); crew stationed on a deployment for every day they are there; the home standby the planner keeps (one
//   per role and family a day); divided by the share of working days a roster can really use (PACKING: rest after
//   long trips, crew in the wrong place, the 7/14/28-day duty limits);
// - supply: each crew member counted once, in the family staffing() counts them in (cabin crew on several types in
//   their hire family first), for the days they are there (joiners from their join date, a conversion class onto the
//   family from its end, a leaver until their last day, a conversion away until it starts), less leave, courses and
//   known sickness, less their days off (at least 7 a month and 96 a year pro rata, leave counting towards the 96).
// A gap shows once the month is within the time a hire (or a class) takes to join plus two weeks, and at least six
// weeks ahead, so the advice always comes in time to act on. Pure (memoised per day and roster/flight revision).

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { flightsOf, flightsRev } from '../core/entities';
import { isPilot, reportMinutes, typeOf } from '../core/perf';
import { DAY, daysInMonth, fmtDate, fmtMonth, monthKey, monthStart } from '../core/time';
import { pushMessage } from '../core/messages';
import type { Aircraft, Flight, GameState, Minute, MonthKey, Role } from '../core/types';
import { hurtProse, mkHurt, type ProblemAction, type ProblemCard } from '../problems/types';
import { dropClientSeats } from './clientCrew';
import { conversionClasses } from './conversion';
import { crewExtraFor, seatsFor } from './extraSeats';
import { ratedMarket, staffingAssign } from './hr';
import { awayOnDryLease, familyName, familyNeeds } from './sets';
import { crewRev, dhBlock } from './timeline';

/** The roles the forecast counts: relief pilots are first officers here (as staffing()). */
export const PEAK_ROLES: Role[] = ['CPT', 'FO', 'PUR', 'CC'];

export const PEAK = {
  /** Months looked at after the current one. */
  months: 3,
  /** Share of a crew member's working days a roster fills with flying and standby (calibrated on bot seeds 1–6). */
  packing: 0.85,
  /** The earliest a gap shows: this many days before the month (more when a hire takes longer). */
  minLeadDays: 42,
  /** Days kept in hand on top of the time a hire takes to join. */
  spareDays: 14,
  /** A gap smaller than this share of one person is noise. */
  minShort: 0.25,
  /** Days off a month at least (BAL.v09.roster.off.legalMonth) and free days a year (yearMin). */
  offMonth: 7,
  freeYear: 96,
  /** A night stop longer than this (days) sends the crew home and back. */
  layoverDays: 3,
};

export interface PeakGap {
  month: MonthKey;
  /** 'July'. */
  monthName: string;
  start: Minute;
  family: RatingFamily;
  label: string;
  role: Role;
  /** Crew-days the month's work needs (packing included) and the crew-days the crew can give. */
  needDays: number;
  haveDays: number;
  /** The same as people working a full month: needed, there. */
  need: number;
  have: number;
  /** Whole people to add. */
  short: number;
  /** One crew set of this role in the family (Planning's sets), and the gap in sets (≈). */
  perSet: number;
  sets: number;
  /** Days a hire of this role takes to join at most, the last day to hire for the month, and whether that has passed. */
  leadDays: number;
  hireBy: Minute;
  late: boolean;
  /** A whole set short, any pilot, or too late to hire in time: the four-line card. */
  serious: boolean;
}

export interface PeakMonth {
  month: MonthKey;
  monthName: string;
  start: Minute;
  family: RatingFamily;
  label: string;
  /** Per role: crew-days needed and available, people needed and there. */
  roles: { role: Role; needDays: number; haveDays: number; need: number; have: number }[];
}

export interface PeakForecast {
  /** Every month and family looked at (the Planning view's table). */
  months: PeakMonth[];
  /** Gaps inside their warning window, soonest month first. */
  gaps: PeakGap[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (k: MonthKey) => MONTH_NAMES[k % 12];

const wideFamily = (f: RatingFamily) => ACMI_TYPES_LIST.some((t) => t.family === f && t.body === 'wide');

/** The most days a hire of this role and family takes to join today (the quote's jitter at its top). Pure. */
export function hireLeadDays(g: GameState, family: RatingFamily, role: Role): number {
  if (!isPilot(role)) return Math.ceil(BAL.v072.cabinHire.days * 1.2);
  const base = ((wideFamily(family) ? BAL.hireDaysWide : BAL.hireDays)[role === 'CRP' ? 'FO' : role] ?? 45);
  const left = ratedMarket(g, family, role)?.left ?? 1;
  return Math.ceil(base * (left > 0 ? 1 : BAL.ratedPool.daysMult) * 1.2);
}

/** Days before a month its gap for this role shows (a hire's join time plus a margin, six weeks at least). Pure. */
export const warnDays = (g: GameState, family: RatingFamily, role: Role): number =>
  Math.max(PEAK.minLeadDays, hireLeadDays(g, family, role) + PEAK.spareDays);

type RoleDays = Record<Role, number>;
const zero = (): RoleDays => ({ CPT: 0, FO: 0, CRP: 0, PUR: 0, CC: 0 });

/** Days of [a, b) inside [from, to). */
const overlapDays = (a: Minute, b: Minute, from: Minute, to: Minute) => Math.max(0, Math.min(b, to) - Math.max(a, from)) / DAY;

interface Work { start: Minute; end: Minute; from: string; to: string; legs: Flight[]; augment: 0 | 1 | 2 }

/** An aircraft's legs we crew in [from, to) (padded), grouped into days of work: the roster's duties, else by gaps. */
function workOf(g: GameState, ac: Aircraft, from: Minute, to: Minute, skip: (f: Flight) => boolean): Work[] {
  const rm = reportMinutes(ac.typeId);
  const legs = flightsOf(g, ac.id).filter((f) => f.aircraftId === ac.id && f.status !== 'cancelled' && f.kind !== 'deadhead' && !f.operatedBy && f.std >= from && f.std < to && !skip(f));
  const out: Work[] = [];
  let cur: Work | null = null;
  let curDuty: string | null = null;
  for (const f of legs) {
    const d = f.dutyId ? g.duties[f.dutyId] : undefined;
    const lastOn = f.ata ?? f.sta;
    // Unplanned legs: one day of work while the gaps stay short and the day within 11 h (a narrowbody's usual FDP).
    const same = cur && (d ? curDuty === d.id : !curDuty && f.std - cur.legs[cur.legs.length - 1].sta < 6 * 60 && lastOn + rm.post - cur.start <= 11 * 60);
    if (cur && same) {
      cur.legs.push(f);
      cur.end = lastOn + rm.post;
      cur.to = f.to;
    } else {
      cur = { start: (d?.report ?? f.std - rm.report), end: lastOn + rm.post, from: f.from, to: f.to, legs: [f], augment: d ? d.augment : 0 };
      curDuty = d?.id ?? null;
      out.push(cur);
    }
    if (d) cur.augment = d.augment;
  }
  // Long days the roster has not planned yet: 3 pilots past 13 h, 4 past 16 h (the planner's in-flight rest).
  for (const w of out) if (!w.legs[0].dutyId) w.augment = w.end - w.start > 16 * 60 ? 2 : w.end - w.start > 13 * 60 ? 1 : 0;
  return out;
}

/** Crew per role for a day of work on this aircraft (extra crew, a client's own cabin crew, ferries, relief pilots). */
function crewFor(g: GameState, ac: Aircraft, w: Work): RoleDays {
  const out = zero();
  const k = w.legs[0].contractId ? g.contracts[w.legs[0].contractId] : undefined;
  const pilotsOnly = w.legs.every((f) => f.kind === 'ferry');
  const x = crewExtraFor(g, ac.id, k?.id ?? null);
  let seats = seatsFor(ac.typeId, ac.cabin.total, x, Math.min(k?.requirements.extraCabin ?? 0, x.cabin), { augment: w.augment, pilotsOnly });
  if (!pilotsOnly) seats = dropClientSeats(seats, k?.requirements.clientCabin);
  for (const s of seats) out[s.role === 'CRP' ? 'FO' : s.role]++;
  return out;
}

/** Crew-days of signed work per family and role in [from, to) (no packing, no standby). Pure. */
export function workDays(g: GameState, from: Minute, to: Minute): Map<RatingFamily, RoleDays> {
  const out = new Map<RatingFamily, RoleDays>();
  const famOf = (f: RatingFamily) => out.get(f) ?? out.set(f, zero()).get(f)!;
  const home = g.company.homeBase;
  for (const ac of Object.values(g.fleet)) {
    if (awayOnDryLease(g, ac) || ac.status === 'stored') continue;
    const fam = famOf(typeOf(ac.typeId).family);
    // Deployments: their crew are on station every day they run (their days off taken there).
    const deps = Object.values(g.deployments).filter((dp) => dp.aircraftId === ac.id && dp.end > from - 7 * DAY && dp.start < to + 7 * DAY);
    const onDep = (f: Flight) => deps.some((dp) => f.contractId === dp.contractId && f.std >= dp.start && f.std < dp.end);
    for (const dp of deps) {
      const days = overlapDays(dp.start, dp.end, from, to);
      if (!days) continue;
      const set = crewFor(g, ac, { start: dp.start, end: dp.end, from: dp.base, to: dp.base, legs: [{ contractId: dp.contractId, kind: 'revenue' } as Flight], augment: 0 });
      // On station every day, days off included: their share of work days (as the supply side counts them).
      const share = workShare(daysInMonth(monthKey(from)));
      for (const r of PEAK_ROLES) fam[r] += dp.setsOnStation * set[r] * days * share;
    }
    const work = workOf(g, ac, from - 4 * DAY, to + 4 * DAY, onDep);
    // Trips: days of work from base back to base (a night stop longer than PEAK.layoverDays sends the crew home).
    let i = 0;
    while (i < work.length) {
      let j = i;
      while (j + 1 < work.length && work[j].to !== home && work[j + 1].from === work[j].to && work[j + 1].start - work[j].end <= PEAK.layoverDays * DAY) j++;
      const first = work[i];
      const last = work[j];
      const start = first.start - (first.from !== home ? dhBlock(home, first.from) + 120 : 0);
      const end = last.end + (last.to !== home ? dhBlock(last.to, home) + 120 : 0);
      // The trip's crew: the largest of its days (a relief pilot for one long day stays with the trip).
      const crew = zero();
      for (let k = i; k <= j; k++) {
        const c = crewFor(g, ac, work[k]);
        for (const r of PEAK_ROLES) crew[r] = Math.max(crew[r], c[r]);
      }
      // Calendar days the trip holds its crew (at least one crew-day per duty: a crew flies one duty a day, so two
      // duties on one day are two crews), spread over the months it touches.
      const days = Math.max(1, j - i + 1, Math.ceil((end - start) / DAY - 1e-9));
      const inWin = overlapDays(start, end, from, to);
      const share = end > start ? inWin / ((end - start) / DAY) : start >= from && start < to ? 1 : 0;
      if (share > 0) for (const r of PEAK_ROLES) fam[r] += crew[r] * days * share;
      i = j + 1;
    }
  }
  return out;
}

/** The share of a full month's days a crew member works (days off at least 7 and 96 a year pro rata). */
function workShare(dim: number): number {
  return (dim - Math.max((PEAK.offMonth * dim) / 30.44, (PEAK.freeYear * dim) / 365)) / dim;
}

/** Need and supply per family and role for one day (crew-days; packing and standby as monthPlan). Pure. */
export function dayLoad(g: GameState, day: Minute): Map<RatingFamily, { role: Role; need: number; have: number }[]> {
  const need = workDays(g, day, day + DAY);
  const have = crewDays(g, day, day + DAY);
  const sby = BAL.v073.standby.perFamily;
  const out = new Map<RatingFamily, { role: Role; need: number; have: number }[]>();
  for (const [family, w] of need) {
    const h = have.get(family) ?? zero();
    const rows: { role: Role; need: number; have: number }[] = [];
    for (const r of PEAK_ROLES) if (w[r] > 0) rows.push({ role: r, need: (w[r] + (sby[r] ?? 0)) / PEAK.packing, have: h[r] });
    out.set(family, rows);
  }
  return out;
}

/** Working days a crew member gives the family in [from, to): days there, less leave, courses, sickness and days off. */
function supplyDays(g: GameState, c: GameState['crew'][string], family: RatingFamily, from: Minute, to: Minute, joinsAt: Minute): number {
  let a = Math.max(from, joinsAt);
  let b = to;
  if (c.notice) b = Math.min(b, c.notice.leaves);
  // A conversion that takes this rating away ends it at the class start.
  for (const k of conversionClasses(g)) {
    if (!k.crewIds.includes(c.id) || k.family === family) continue;
    const loses = k.group === 'pilot' ? k.course === 'full' : k.drop?.[c.id] === family;
    if (loses) b = Math.min(b, k.start);
    // Away on the course (any class): not flying while it runs.
  }
  if (b <= a) return 0;
  let blocked = 0;
  let leave = 0;
  for (const x of c.blocks ?? []) {
    if (x.why === 'joining') continue;
    const d = overlapDays(x.from, x.to, a, b);
    if (x.why === 'leave') leave += d;
    else blocked += d;
  }
  for (const k of conversionClasses(g)) if (k.crewIds.includes(c.id) && k.family !== family) blocked += overlapDays(k.start, k.end, a, b);
  const avail = Math.max(0, (b - a) / DAY - blocked);
  const off = Math.max((PEAK.offMonth * Math.max(0, avail - leave)) / 30.44, (PEAK.freeYear * avail) / 365 - leave, 0);
  return Math.max(0, avail - leave - off);
}

/** Crew-days each family and role can give in [from, to), each person counted once (as staffing()). Pure. */
export function crewDays(g: GameState, from: Minute, to: Minute): Map<RatingFamily, RoleDays> {
  const out = new Map<RatingFamily, RoleDays>();
  const famOf = (f: RatingFamily) => out.get(f) ?? out.set(f, zero()).get(f)!;
  const { homeOf } = staffingAssign(g);
  const fleet = new Set(Object.values(g.fleet).map((ac) => typeOf(ac.typeId).family));
  // Crew in a class onto a family count there from the end of the course.
  const onto = new Map<string, { family: RatingFamily; end: Minute }>();
  for (const k of conversionClasses(g)) for (const id of k.crewIds) if (!g.crew[id]?.ratings.includes(k.family)) onto.set(id, { family: k.family, end: k.end });
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    // On notice: counted where they fly until their last day, once (the first type they hold in the fleet). v0.11.2
    // fix: everyone counted once, as staffing() (pilots on two types were counted in both families).
    const fams = c.notice ? c.ratings.filter((f) => fleet.has(f)).slice(0, 1) : homeOf.get(c.id) ?? [];
    const role: Role = c.role === 'CRP' ? 'FO' : c.role;
    const joins = c.status === 'joining' ? c.hired : -Infinity;
    for (const f of fams) if (fleet.has(f)) famOf(f)[role] += supplyDays(g, c, f, from, to, joins);
    const k = onto.get(c.id);
    if (k && fleet.has(k.family) && !fams.includes(k.family)) famOf(k.family)[role] += supplyDays(g, c, k.family, from, to, Math.max(joins, k.end));
  }
  return out;
}

const memo = new WeakMap<GameState, { key: string; v: PeakForecast }>();

/** The heads-up: months, families, roles, and the gaps inside their warning window. Pure (memoised). */
export function peakForecast(g: GameState): PeakForecast {
  // (Hires and classes do not bump the crew revision: the head count, the joiners and the classes are in the key.)
  const key = `${Math.floor(g.now / DAY)}:${crewRev(g)}:${flightsRev(g)}:${Object.keys(g.contracts).length}:${Object.keys(g.deployments).length}:${Object.keys(g.crew).length}:${g.hires.length}:${conversionClasses(g).map((k) => `${k.id}${k.crewIds.length}`).join(',')}`;
  const hit = memo.get(g);
  if (hit && hit.key === key) return hit.v;
  const v = forecastNow(g);
  memo.set(g, { key, v });
  return v;
}

/** One month and family: need and supply per role (packing, standby and the PUR → CC spill applied). Pure. */
export function monthPlan(g: GameState, mk: MonthKey): PeakMonth[] {
  const from = monthStart(mk);
  const to = monthStart(mk + 1);
  const dim = daysInMonth(mk);
  const full = dim * workShare(dim);
  const need = workDays(g, from, to);
  const have = crewDays(g, from, to);
  const sby = BAL.v073.standby.perFamily;
  const out: PeakMonth[] = [];
  for (const [family, w] of [...need].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const h = have.get(family) ?? zero();
    const roles: PeakMonth['roles'] = [];
    const nd = zero();
    for (const r of PEAK_ROLES) nd[r] = w[r] > 0 ? (w[r] + (sby[r] ?? 0) * dim) / PEAK.packing : 0;
    // Pursers fill cabin crew seats (never the other way round), as Planning's sets.
    const hd = { ...h };
    const spare = hd.PUR - nd.PUR;
    if (spare > 0 && hd.CC < nd.CC) {
      const m = Math.min(spare, nd.CC - hd.CC);
      hd.PUR -= m;
      hd.CC += m;
    }
    for (const r of PEAK_ROLES) if (nd[r] > 0) roles.push({ role: r, needDays: nd[r], haveDays: hd[r], need: nd[r] / full, have: hd[r] / full });
    if (roles.length) out.push({ month: mk, monthName: monthName(mk), start: from, family, label: familyName(family), roles });
  }
  return out;
}

function forecastNow(g: GameState): PeakForecast {
  const k0 = monthKey(g.now);
  const months: PeakMonth[] = [];
  const gaps: PeakGap[] = [];
  const sets = familyNeeds(g);
  for (let k = k0 + 1; k <= k0 + PEAK.months; k++) {
    for (const m of monthPlan(g, k)) {
      months.push(m);
      const f = sets.get(m.family);
      for (const r of m.roles) {
        const short = Math.ceil(r.need - r.have - PEAK.minShort);
        if (short < 1) continue;
        const lead = hireLeadDays(g, m.family, r.role);
        if (m.start - g.now > warnDays(g, m.family, r.role) * DAY) continue;
        // One full set of this role on the family's types (the type's own crew complement), not the family's average need
        // per set: a mixed-crew contract (the client's cabin crew in some seats) would shrink that and inflate 'about N sets'.
        const perSet = f ? Math.max(0, ...[...f.types.values()].map((t) => t.set[r.role] ?? 0)) : 0;
        const hireBy = m.start - lead * DAY;
        const late = g.now > hireBy;
        gaps.push({
          month: m.month, monthName: m.monthName, start: m.start, family: m.family, label: m.label, role: r.role, needDays: r.needDays, haveDays: r.haveDays,
          need: r.need, have: r.have, short, perSet, sets: perSet > 0 ? short / perSet : 0, leadDays: lead, hireBy, late,
          serious: late || isPilot(r.role) || (perSet > 0 && short >= perSet - 1e-9),
        });
      }
    }
  }
  gaps.sort((a, b) => a.month - b.month || (a.family < b.family ? -1 : a.family > b.family ? 1 : 0) || PEAK_ROLES.indexOf(a.role) - PEAK_ROLES.indexOf(b.role));
  return { months, gaps };
}

// ---------- words ----------

const ROLE_ONE: Record<Role, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', PUR: 'purser', CC: 'cabin crew' };
const ROLE_MANY: Record<Role, string> = { CPT: 'captains', FO: 'first officers', CRP: 'relief pilots', PUR: 'pursers', CC: 'cabin crew' };
export const roleCount = (n: number, r: Role) => `${n} ${n === 1 ? ROLE_ONE[r] : ROLE_MANY[r]}`;

/** '3 cabin crew (about 1 set)' / '1 captain'. */
export function gapWords(x: PeakGap): string {
  const sets = !isPilot(x.role) && x.sets >= 0.75 ? ` (about ${Math.round(x.sets)} set${Math.round(x.sets) === 1 ? '' : 's'})` : '';
  return `${roleCount(x.short, x.role)}${sets}`;
}

/** The family label as said in a sentence: 'A320', '737', 'A330/A340'. */
export const familyWord = (f: RatingFamily) => familyName(f).replace(' family', '');

/** One family-month's gaps in a line: 'July needs 3 more A320 cabin crew (about 1 set) and 1 captain'. */
export function peakLine(xs: PeakGap[]): string {
  if (!xs.length) return '';
  const parts = xs.map(gapWords);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${xs[0].monthName} needs ${list.replace(/^(\d+) /, `$1 more ${familyWord(xs[0].family)} `)}`;
}

/** Gaps grouped by month and family (the order they show in). */
export function peakGroups(f: PeakForecast): PeakGap[][] {
  const by = new Map<string, PeakGap[]>();
  for (const x of f.gaps) {
    const k = `${x.month}:${x.family}`;
    by.set(k, [...(by.get(k) ?? []), x]);
  }
  return [...by.values()];
}

/** When hires ordered today join (the slowest role in the group), as a date. */
export const joinsBy = (g: GameState, xs: PeakGap[]): string => fmtDate(g.now + Math.max(...xs.map((x) => x.leadDays)) * DAY);

// ---------- the card, the Inbox note ----------

/** The card's subject id for a family's month: 'peak:<month key>:<family>'. */
export const peakId = (month: MonthKey, family: RatingFamily) => `peak:${month}:${family}`;

/**
 * The four-line card for a family's busy month (WHAT / WHY / DOES IT HURT / WHAT YOU CAN DO), or null when that month
 * is staffed (or not inside its warning window yet). id: peakId(). Pure.
 */
export function crewPeakCard(g: GameState, id: string): ProblemCard | null {
  const m = /^peak:(\d+):(.+)$/.exec(id);
  if (!m) return null;
  const xs = peakForecast(g).gaps.filter((x) => x.month === Number(m[1]) && x.family === m[2]);
  if (!xs.length) return null;
  const x0 = xs[0];
  const late = xs.filter((x) => x.late);
  // Rounded so the two numbers differ by the gap (the details carry the exact figures).
  const needs = xs.map((x) => roleCount(Math.max(x.short, Math.round(x.need)), x.role)).join(' and ');
  const haves = xs.map((x) => Math.max(x.short, Math.round(x.need)) - x.short).join(' and ');
  const why = `${x0.monthName}'s signed flying needs about ${needs} at work (with days off, leave and standby); you will have about ${haves}${xs.length > 1 ? ' respectively' : ''}.`;
  // Nothing lost yet; the risk is the busiest days of the month (no money or passengers to put on it yet).
  const hurt = {
    ...mkHurt({}), badges: [], level: late.length ? ('low' as const) : ('none' as const),
    text: late.length
      ? `Yes: ${roleCount(late[0].short, late[0].role)} hired today ${late[0].short === 1 ? 'joins' : 'join'} after ${x0.monthName} starts; expect flights held for crew, sub-charters or cancellations on its busiest days`
      : 'Not now: left as it is, expect flights held for crew, sub-charters or cancellations on the busiest days',
  };
  // Hire buttons: the slowest to join first (pilots), each prefilled.
  const byLead = [...xs].sort((a, b) => b.leadDays - a.leadDays || PEAK_ROLES.indexOf(a.role) - PEAK_ROLES.indexOf(b.role));
  const actions: ProblemAction[] = byLead.slice(0, 2).map((x, i) => ({
    id: i === 0 ? 'hire' : `hire${x.role}`, label: `Hire ${roleCount(x.short, x.role)}`, open: { modal: 'hire' as const, id: `${x.role}:${x.family}:${x.short}` }, ...(i === 0 ? { primary: true } : {}),
  }));
  actions.push({ id: 'crewPlan', label: 'Crew planning', open: { tab: 'crew', view: 'plan' } });
  const details = xs.map((x) => `${roleCount(Math.round(x.need), x.role)} needed at work in ${x.monthName}, ${Math.round(x.have * 10) / 10} there (joiners from their join date, each person counted once). A hire joins in up to ${x.leadDays} days: ${x.late ? 'too late for the start of the month' : `hire by ${fmtDate(x.hireBy)}`}.`);
  details.push(`Counted from the work signed now: the roster's duties, the days away around them and crew stationed at deployments, plus a home standby a day; a roster fills about ${Math.round(PEAK.packing * 100)}% of the working days crew have.`);
  return {
    subject: { kind: 'crewPeak', ref: { kind: 'crew', id } }, severity: 'amber',
    title: peakLine(xs), what: peakLine(xs), why, hurt, actions, details, visuals: {}, terms: xs.some((x) => !isPilot(x.role)) ? ['crewSet'] : [], by: late.length ? x0.start : Math.min(...xs.map((x) => x.hireBy)),
  };
}

/**
 * Daily: one Inbox note per family and busy month when a gap first shows (a new role joining a month already told
 * gets its own note); never repeated while it stands. A serious gap (the four-line card) chimes with its note.
 */
export function peakHeadsUp(g: GameState): void {
  const k0 = monthKey(g.now);
  const told = (g.stats.peakWarned ??= []).filter((k) => Number(k.split('|')[0]) > k0);
  g.stats.peakWarned = told;
  for (const xs of peakGroups(peakForecast(g))) {
    const fresh = xs.filter((x) => !told.includes(`${x.month}|${x.family}|${x.role}`));
    if (!fresh.length) continue;
    for (const x of fresh) told.push(`${x.month}|${x.family}|${x.role}`);
    const id = peakId(xs[0].month, xs[0].family);
    const card = crewPeakCard(g, id);
    if (!card) continue;
    const serious = fresh.some((x) => x.serious);
    pushMessage(g, {
      tone: serious ? 'warn' : 'info', cat: 'crew', cue: serious ? 'notice' : null,
      title: card.what, body: `${card.why} ${hurtProse(card)}.`, ref: card.subject.ref,
      // (No hurt snapshot: no money or passengers are at stake yet, and a 'no cost' badge would read as 'no harm'.)
      ...(serious ? { problem: card.subject } : {}),
    });
  }
}

export { fmtMonth };
