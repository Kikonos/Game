// v0.18.3 Convert surplus crew (Crew › Utilisation, "More crew than the flying needs" › Convert): which type to
// convert them to and why, who goes (the least work ahead first), and when: 1–3 options that put them in as few
// classes as the course rules allow, on dates where their roster is free or where a dry run of the roster finds a
// legal replacement for each trip in the way ('Silva's BLU1234 on 3 Dec goes to Costa'). Booking one applies those
// replacements, then books the classes through the usual conversion (training blocks, Inbox, ratings as now).
// Read APIs are pure and deterministic (a copy of the game takes the dry run).

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { isPilot, typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { ActionResult, CrewMember, GameState, Minute, Role } from '../core/types';
import { previewCopy } from './atomic';
import { ccqKeeps, classOf, classStartFor, conversionClasses, conversionEarliest, conversionPlan, courseOf, familyLabel, startConversion } from './conversion';
import { peakForecast } from './forecast';
import { staffing } from './hr';
import { rosterOf } from './roster';
import { assignCrew, dutyCandidates } from './rosterActions';
import { crewUtilisation, roleWords } from './utilisation';

/** Course size the proposals keep to (the training centre's real classes): pilots in sim pairs, cabin crew in a room. */
export const CONVERT = { pilotClass: 8, cabinClass: 20, lookDays: 90, maxOptions: 3 };

export interface ConvertTarget {
  family: RatingFamily;
  /** 'A330/340: 6 captains short from 14 Jan, when CS-TTZ arrives' / 'We fly the B757/767: none short'. */
  why: string;
  /** People of this rank the type is short of (0: held, not short). */
  short: number;
  /** When they are needed (null: no date). */
  at: Minute | null;
  kind: 'arriving' | 'short' | 'held';
  /** A common-type course (CCQ: keeps the old rating, shorter) for this rank's people. */
  ccq: boolean;
}

export interface ConvertSwap {
  dutyId: string;
  pairingId: string;
  /** 'BLU1234' (the trip's first flight) and its report. */
  no: string;
  at: Minute;
  role: Role;
  from: string;
  to: string;
  /** 'Silva's BLU1234 on 3 Dec goes to Costa'. */
  text: string;
  ticket: number;
}

export interface ConvertClass { start: Minute; end: Minute; crewIds: string[]; group: 'pilot' | 'cabin' }

export interface ConvertOption {
  key: string;
  /** 'One class 8 Jan – 18 Feb: all 6' / 'Two classes …'. */
  title: string;
  classes: ConvertClass[];
  swaps: ConvertSwap[];
  /** Trips in the way the dry run found nobody for (they go back to the auto-roster, as a manual booking does). */
  unresolved: number;
  fees: number;
  /** Re-crew positioning tickets. */
  recrew: number;
  /** Block hours of their own flying handed to others. */
  handedBH: number;
  /** The day the last of them is line-ready (course end). */
  ready: Minute;
  /** Line-ready after the need date. */
  late: boolean;
}

export interface ConvertAdvice {
  from: RatingFamily;
  role: Role;
  targets: ConvertTarget[];
  /** Candidates for the chosen target, least work ahead first (the surplus first, then other idle crew of the rank). */
  candidates: string[];
  /** How many the proposal converts. */
  want: number;
  options: ConvertOption[];
  /** Plain words when nothing can be proposed. */
  why: string | null;
}

const families = (): RatingFamily[] => [...new Set(ACMI_TYPES_LIST.map((t) => t.family))];

/** Families flown, delivering or on a lease deal at the committee or signed (not yet an aircraft), with their next arrival. */
function arriving(g: GameState): Map<RatingFamily, { at: Minute; reg: string } | null> {
  const out = new Map<RatingFamily, { at: Minute; reg: string } | null>();
  const note = (f: RatingFamily, at: Minute | null, reg: string) => {
    const x = out.get(f);
    if (at === null) { if (!out.has(f)) out.set(f, null); return; }
    if (!x || at < x.at) out.set(f, { at, reg });
  };
  for (const ac of Object.values(g.fleet).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const f = typeOf(ac.typeId).family;
    const pending = ac.status === 'delivering' || (ac.delivery && ac.delivery.arrived === undefined);
    note(f, pending ? ac.induction?.ready ?? ac.delivery?.handover ?? ac.deliveredAt : null, ac.reg);
  }
  for (const d of g.leasing?.deals ?? []) {
    if (d.aircraftId || (d.stage !== 'approved' && d.stage !== 'signed' && d.stage !== 'conditions')) continue;
    note(typeOf(d.offer.typeId).family, (d.signedAt ?? d.signBy ?? g.now) + (d.offer.leadDays ?? 60) * DAY, d.opts?.reg ?? `the ${typeOf(d.offer.typeId).short}`);
  }
  return out;
}

/**
 * Types this rank could convert to: first those short of crew (the Planning sets now, the crew forecast's coming
 * months, a type arriving), most short first; else the types we fly or have coming that they don't hold. Pure.
 */
export function convertTargets(g: GameState, from: RatingFamily, role: Role): ConvertTarget[] {
  const arr = arriving(g);
  const lines = staffing(g);
  const booked = (f: RatingFamily) => conversionClasses(g).filter((k) => k.family === f).reduce((n, k) => n + k.crewIds.filter((id) => g.crew[id]?.role === role).length, 0);
  const gaps = peakForecast(g).gaps.filter((x) => x.role === role);
  const out: ConvertTarget[] = [];
  const pilot = isPilot(role);
  // A sample person of the rank for the course type (CCQ keeps the old rating).
  const sample = { ratings: [from] } as Pick<CrewMember, 'ratings'>;
  for (const f of families()) {
    if (f === from || !arr.has(f)) continue;
    const l = lines.find((x) => x.family === f && x.role === role);
    const setsShort = l ? Math.max(0, l.need - l.have - (l.covered ?? 0) - booked(f)) : 0;
    const gap = gaps.filter((x) => x.family === f).sort((a, b) => b.short - a.short || a.start - b.start)[0];
    const fcShort = gap ? Math.max(0, gap.short - booked(f)) : 0;
    const next = arr.get(f) ?? null;
    const short = Math.max(setsShort, fcShort);
    const ccq = !!ccqKeeps(sample, f);
    const label = familyLabel(f) === f ? f : `${familyLabel(f)} (${f})`;
    if (short > 0) {
      const at = fcShort >= setsShort && gap ? gap.start : next?.at ?? null;
      const when = at && at > g.now + DAY ? ` from ${fmtDay(at)}` : ' now';
      const reg = next && (!at || Math.abs(next.at - (at ?? 0)) < 45 * DAY) ? `, when ${next.reg} arrives` : '';
      out.push({ family: f, short, at, kind: next ? 'arriving' : 'short', ccq, why: `${label}: ${roleWords(role, short)} short${when}${reg}` });
    } else {
      out.push({ family: f, short: 0, at: next?.at ?? null, kind: 'held', ccq, why: `${label}: ${next ? `${next.reg} arrives ${fmtDay(next.at)}; ` : ''}${l ? `${l.have} rated, none short` : 'no crew rated yet'}` });
    }
  }
  return out.sort((a, b) => Number(b.short > 0) - Number(a.short > 0) || b.short - a.short || (a.at ?? Infinity) - (b.at ?? Infinity) || (a.family < b.family ? -1 : 1));
}

/** Minutes of trips on the roster from now over the next 60 days (work ahead). */
const workAhead = (g: GameState, id: string): number => rosterOf(g, id, g.now, g.now + 60 * DAY).filter((d) => !d.done).reduce((s, d) => s + (d.release - d.report), 0);

/**
 * The people to propose, least work ahead first: of this rank and family, at work (not joining, on notice, in a
 * class or training), not yet rated on the target. Pure.
 */
export function convertCandidates(g: GameState, from: RatingFamily, role: Role, target: RatingFamily): string[] {
  const u = crewUtilisation(g);
  const d28 = new Map(u.people.map((p) => [p.id, p.d28]));
  const xs = Object.values(g.crew).filter((c) => c.role === role && c.ratings.includes(from) && !c.ratings.includes(target) && !c.notice && c.status !== 'joining' && !classOf(g, c.id) && !g.training.some((t) => t.crewId === c.id && t.end > g.now));
  const w = new Map(xs.map((c) => [c.id, workAhead(g, c.id)]));
  return xs.sort((a, b) => w.get(a.id)! - w.get(b.id)! || (d28.get(a.id) ?? 0) - (d28.get(b.id) ?? 0) || (a.id < b.id ? -1 : 1)).map((c) => c.id);
}

/** Pairings of a person that a class [start, end) takes them off (the day before to the end, as startConversion). */
function inTheWay(g: GameState, id: string, start: Minute, end: Minute): { pairingId: string; dutyId: string; report: Minute }[] {
  const seen = new Map<string, { pairingId: string; dutyId: string; report: Minute }>();
  for (const d of rosterOf(g, id, start - DAY, end)) {
    if (d.done || d.release <= start - DAY || d.report >= end) continue;
    const x = seen.get(d.pairingId);
    if (!x || d.report < x.report) seen.set(d.pairingId, { pairingId: d.pairingId, dutyId: d.id, report: d.report });
  }
  return [...seen.values()].sort((a, b) => a.report - b.report || (a.pairingId < b.pairingId ? -1 : 1));
}

/** Leave or other blocks in the class dates (a booked holiday is never moved for a course). */
const blocked = (c: CrewMember, start: Minute, end: Minute) => (c.blocks ?? []).some((b) => b.from < end && b.to > start - DAY && b.why !== 'training');

/** The course of a group of people onto `family`: the longest any of them takes (a CCQ is shorter). */
function lengthOf(g: GameState, ids: string[], family: RatingFamily): { days: number; group: 'pilot' | 'cabin' } {
  const c0 = g.crew[ids[0]];
  const group = c0 && isPilot(c0.role) ? 'pilot' : 'cabin';
  let days = 0;
  for (const id of ids) days = Math.max(days, courseOf(group, g.crew[id] && ccqKeeps(g.crew[id], family) ? 'ccq' : 'full', family).days);
  return { days, group };
}

/** Dry run on a copy: the trips in the way of these classes, each given to the first clean legal replacement. */
function recrew(g: GameState, classes: ConvertClass[]): { swaps: ConvertSwap[]; unresolved: number; handedBH: number } {
  const h = previewCopy(g);
  const inClass = new Set(classes.flatMap((k) => k.crewIds));
  const swaps: ConvertSwap[] = [];
  let unresolved = 0;
  let handedBH = 0;
  for (const k of classes) {
    for (const id of k.crewIds) {
      for (const w of inTheWay(g, id, k.start, k.end)) {
        const p = h.pairings[w.pairingId];
        const slot = p?.slots.find((s) => s.crewId === id);
        if (!p || !slot) continue;
        handedBH += p.dutyIds.reduce((s, did) => s + (h.duties[did]?.flightIds ?? []).reduce((b, fid) => b + (h.flights[fid]?.block ?? 0), 0), 0) / 60;
        const cands = dutyCandidates(h, w.dutyId, slot.role).filter((c) => c.level === 'legal' && !c.dayOff && !c.onPairing && !inClass.has(c.crewId) && !h.crew[c.crewId]?.notice);
        let done = false;
        for (const c of cands.slice(0, 4)) {
          const r = assignCrew(h, w.dutyId, c.crewId, slot.role, { replace: id });
          if (!r.ok) continue;
          const f = h.flights[h.duties[w.dutyId]?.flightIds[0] ?? ''];
          const no = f?.no ?? 'a trip';
          const a = g.crew[id];
          const b = g.crew[c.crewId];
          swaps.push({ dutyId: w.dutyId, pairingId: w.pairingId, no, at: w.report, role: slot.role, from: id, to: c.crewId, ticket: c.ticket, text: `${a.last}'s ${no} on ${fmtDay(w.report)} goes to ${b.first.charAt(0)}. ${b.last}` });
          done = true;
          break;
        }
        if (!done) unresolved++;
      }
    }
  }
  return { swaps, unresolved, handedBH: Math.round(handedBH) };
}

/** People who could start on day t (no leave in the way), and how many trips stand in their way then. */
function fitAt(g: GameState, ids: string[], t: Minute, len: number): { ok: string[]; trips: number } {
  const ok: string[] = [];
  let trips = 0;
  for (const id of ids) {
    const c = g.crew[id];
    if (!c || blocked(c, t, t + len)) continue;
    ok.push(id);
    trips += inTheWay(g, id, t, t + len).length;
  }
  return { ok, trips };
}

const chunks = <T>(xs: T[], n: number): T[][] => {
  const k = Math.max(1, Math.ceil(xs.length / n));
  const out: T[][] = Array.from({ length: k }, () => []);
  xs.forEach((x, i) => out[Math.floor((i * k) / xs.length)].push(x));
  return out;
};

/** Classes for these groups from day t: each class at the first start the training centre allows after the previous. */
function placeClasses(g: GameState, groups: string[][], t: Minute, family: RatingFamily): ConvertClass[] {
  const out: ConvertClass[] = [];
  const starts: Minute[] = [];
  for (const ids of groups) {
    if (!ids.length) continue;
    const { days, group } = lengthOf(g, ids, family);
    const s = classStartFor(g, group, t, days * DAY, starts);
    starts.push(s);
    out.push({ start: s, end: s + days * DAY, crewIds: ids, group });
  }
  return out;
}

/**
 * The proposal for converting `want` of these candidates onto `target`, needed by `needBy`: up to three options
 * (soonest; fewest trips moved; or the group split into two classes on dates their rosters are free), each with
 * the dry-run re-crewing, cost and line-ready day; sorted by line-ready day. Deterministic. Pure.
 */
export function convertOptions(g: GameState, candidates: string[], want: number, target: RatingFamily, needBy: Minute | null): ConvertOption[] {
  if (!candidates.length || want <= 0) return [];
  const pool = candidates.slice(0, Math.min(candidates.length, want + Math.ceil(want / 2)));
  const c0 = g.crew[pool[0]];
  const pilot = isPilot(c0.role);
  const max = pilot ? CONVERT.pilotClass : CONVERT.cabinClass;
  const { days } = lengthOf(g, pool, target);
  const len = days * DAY;
  const earliest = conversionEarliest(g);
  const lastStart = Math.min(g.now + BAL.conv.maxAheadDays * DAY - len, Math.max(earliest + 14 * DAY, (needBy ?? earliest + CONVERT.lookDays * DAY) - len), earliest + CONVERT.lookDays * DAY);
  const daysList: Minute[] = [];
  for (let t = earliest; t <= Math.max(earliest, lastStart); t += DAY) daysList.push(t);
  // Per start day: who can go (leave aside) and the trips in their way; the want least-busy at that day.
  const pick = (t: number): { ids: string[]; trips: number } => {
    const f = fitAt(g, pool, t, len);
    const per = f.ok.map((id) => ({ id, n: inTheWay(g, id, t, t + len).length })).sort((a, b) => a.n - b.n || pool.indexOf(a.id) - pool.indexOf(b.id));
    const ids = per.slice(0, want).map((x) => x.id);
    return { ids: pool.filter((id) => ids.includes(id)), trips: per.slice(0, want).reduce((s, x) => s + x.n, 0) };
  };
  const scan = daysList.map((t) => ({ t, ...pick(t) }));
  const full = scan.filter((x) => x.ids.length >= Math.min(want, pool.length));
  const opts: { key: string; groups: string[][]; t: Minute; classes?: ConvertClass[] }[] = [];
  const soon = full[0] ?? scan.reduce((a, b) => (b.ids.length > a.ids.length ? b : a), scan[0]);
  if (soon) opts.push({ key: 'soon', groups: chunks(soon.ids, max), t: soon.t });
  const calm = [...full].sort((a, b) => a.trips - b.trips || a.t - b.t)[0];
  if (calm && calm.t !== soon?.t) opts.push({ key: 'calm', groups: chunks(calm.ids, max), t: calm.t });
  // Two classes: each person's first free day (no trip in the way), split into an early and a late group.
  if (soon && soon.ids.length >= (pilot ? 2 : 4)) {
    const free = soon.ids.map((id) => ({ id, t: daysList.find((t) => !blocked(g.crew[id], t, t + len) && !inTheWay(g, id, t, t + len).length) ?? soon.t }));
    free.sort((a, b) => a.t - b.t || soon.ids.indexOf(a.id) - soon.ids.indexOf(b.id));
    const half = Math.ceil(free.length / 2);
    const a = free.slice(0, half);
    const b = free.slice(half);
    if (b.length && a[a.length - 1].t !== soon.t) {
      const ka = placeClasses(g, chunks(a.map((x) => x.id), max), Math.max(...a.map((x) => x.t)), target);
      const kb = placeClasses(g, chunks(b.map((x) => x.id), max), Math.max(...b.map((x) => x.t)), target);
      // Keep the two pilot classes apart as the centre would (placeClasses on the second group counts only booked ones).
      const starts = ka.map((k) => k.start);
      const kb2 = kb.map((k) => {
        const s = classStartFor(g, k.group, k.start, k.end - k.start, starts);
        starts.push(s);
        return { ...k, start: s, end: s + (k.end - k.start) };
      });
      opts.push({ key: 'two', groups: [], t: 0, classes: [...ka, ...kb2] });
    }
  }
  const out: ConvertOption[] = [];
  for (const o of opts) {
    const classes = o.classes ?? placeClasses(g, o.groups, o.t, target);
    if (!classes.length) continue;
    const ids = classes.flatMap((k) => k.crewIds);
    const plan = conversionPlan(g, { crewIds: ids, family: target, start: classes[0].start });
    const rc = recrew(g, classes);
    const ready = Math.max(...classes.map((k) => k.end));
    const span = (k: ConvertClass) => `${fmtDay(k.start)} – ${fmtDay(k.end - 1)}`;
    const n = classes.length;
    const who = ids.length === want ? `all ${ids.length}` : `${ids.length} of ${want}`;
    const title = n === 1 ? `One class ${span(classes[0])}: ${who}` : `${n === 2 ? 'Two' : n} classes: ${classes.map((k) => `${k.crewIds.length} from ${fmtDay(k.start)}`).join(', ')}`;
    const key = classes.map((k) => `${k.start}:${k.crewIds.join('.')}`).join('|');
    if (out.some((x) => x.key === key)) continue;
    out.push({
      key, title, classes, swaps: rc.swaps, unresolved: rc.unresolved, fees: plan.cost, recrew: rc.swaps.reduce((s, x) => s + x.ticket, 0), handedBH: rc.handedBH,
      ready, late: needBy !== null && ready > needBy,
    });
  }
  return out.sort((a, b) => Number(a.late) - Number(b.late) || a.unresolved - b.unresolved || a.ready - b.ready || a.swaps.length - b.swaps.length).slice(0, CONVERT.maxOptions);
}

/**
 * Everything the Convert dialog proposes for a surplus row (`n` beyond the flying's need), for `target` (default: the
 * first target). How many: the target's shortfall (at least the surplus when it is short of more), else the surplus;
 * never more than the family can spare when the course ends their old rating. Pure.
 */
export function convertAdvice(g: GameState, from: RatingFamily, role: Role, n: number, target?: RatingFamily): ConvertAdvice {
  const targets = convertTargets(g, from, role);
  const t = targets.find((x) => x.family === target) ?? targets[0];
  if (!t) return { from, role, targets, candidates: [], want: 0, options: [], why: 'No other type in the fleet or on order to convert to' };
  const candidates = convertCandidates(g, from, role, t.family);
  // Spare on the old type: what the Planning view counts beyond its need (a CCQ keeps the old rating: all of it is
  // still there after the course, so the surplus plus the idle may go).
  const l = staffing(g).find((x) => x.family === from && x.role === role);
  const spare = l ? Math.max(0, l.have - l.need) : n;
  const idle = crewUtilisation(g).people.filter((p) => p.role === role && p.family === from && p.idle).length;
  const room = t.ccq ? Math.max(spare, Math.min(idle, n + (isPilot(role) ? CONVERT.pilotClass : CONVERT.cabinClass))) : spare;
  const want = Math.min(candidates.length, Math.max(1, Math.min(room, t.short > 0 ? Math.max(t.short, n) : n)));
  const options = convertOptions(g, candidates, want, t.family, t.at);
  return { from, role, targets, candidates, want, options, why: options.length ? null : 'Nobody of this rank can go: all are booked, on notice or joining' };
}

/**
 * Books a proposal: the dry-run replacements (each checked again; one that no longer fits is left to the
 * auto-roster), then each class through startConversion (training blocks on the calendar, the course fees, its
 * Inbox note), and one Inbox note listing the trips handed over.
 */
export function applyConvertOption(g: GameState, family: RatingFamily, o: ConvertOption): ActionResult<{ classIds: string[]; swapped: number }> {
  const done: ConvertSwap[] = [];
  for (const s of o.swaps) {
    const p = g.pairings[s.pairingId];
    if (!p || !p.slots.some((x) => x.crewId === s.from) || !g.crew[s.to]) continue;
    const r = assignCrew(g, s.dutyId, s.to, s.role, { replace: s.from });
    if (r.ok) done.push(s);
  }
  const classIds: string[] = [];
  const errors: string[] = [];
  for (const k of o.classes) {
    const r = startConversion(g, { crewIds: k.crewIds, family, start: k.start });
    if (r.ok) classIds.push(...r.data!.classIds);
    else errors.push(r.error ?? 'not booked');
  }
  if (!classIds.length) return { ok: false, error: errors[0] ?? 'Nothing booked' };
  if (done.length) {
    pushMessage(g, {
      tone: 'info', cat: 'crew', title: `${done.length} trip${done.length === 1 ? '' : 's'} re-crewed for the ${familyLabel(family)} course`,
      body: `${done.map((s) => s.text).join('; ')}.`,
      ref: { kind: 'crew', id: done[0].to },
    });
  }
  return { ok: true, msg: `${familyLabel(family)} course booked${done.length ? ` · ${done.length} trip${done.length === 1 ? '' : 's'} re-crewed` : ''}`, data: { classIds, swapped: done.length } };
}

/** The convert words a surplus row carries ('Convert'), and why not when nothing fits (null: offer it). Pure. */
export function convertWhyNot(g: GameState, from: RatingFamily, role: Role): string | null {
  return convertTargets(g, from, role).length ? null : 'No other type in the fleet or on order';
}

