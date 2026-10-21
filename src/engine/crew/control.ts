// v0.7.1 Crew Control (UPDATE-0.7.1.md §2–§4, §7): the crew-shortage ladder (amber ≤ 48 h, red ≤ 12 h + pause), the
// nine ranked solutions with previews computed on a copy of the state, private-jet positioning, the limit gauges
// and the crew-shortage ProblemCard. Read APIs are pure in g (previews clone it); actions go through the roster,
// flight and ledger helpers.

import { JET_CLASSES, JETS } from '../../data/jets';
import { BAL } from '../core/balance';
import { addDeadhead, liveFlightsOf, removeFlights } from '../core/entities';
import { distance } from '../core/geo';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { canFill, isPilot, typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDuration, fmtTime } from '../core/time';
import type { ActionResult, Aircraft, CrewFix, CrewMember, Duty, Flight, GameState, JetClass, Legality, Minute, Pairing, Role } from '../core/types';
import { hashUnit } from '../core/util';
import { commercialItinerary, itinerary, itineraryText } from '../ops/commercial';
import { crewReadyAt } from '../ops/events';
import { cancelCost, cancelLegs, delayChain, unitOf } from '../ops/flights';
import { rotationOf, subcharter, subcharterQuote } from '../ops/subcharter';
import { contractOf, isRevenue, stats, usd } from '../ops/util';
import { mkHurt, type GaugeSpec, type ProblemCard, type ReachSpec, hm, limitTone } from '../problems/types';
import { crewIssuesFor, openDuties, planCrew, readyAt } from './check';
import { crewWindows } from './ftl';
import { crewName } from './generate';
import { moraleShock } from './morale';
import { city, rootReason, type Reason, type ReasonCode } from './reasons';
import { applyDiscretion, flightCrewStatus, placeCrew, recheckPairing, releaseCrew, rerosterFrom, setShortHook, type FlightCrewStatus } from './roster';
import { assignCrew, dutyCandidates, type DutyCandidate } from './rosterActions';
import { levelOf, LIMITS, minRest } from './rules';
import { crewCount, dhBlock, locAt, OUT_CONNECT, segsOf, touchCrew, typeIdOf } from './timeline';

export type { Reason, ReasonCode };
export { rootReason };

const CC = () => BAL.crewControl;
const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];
/** Player words for a seat: singular, plural. */
export const ROLE_WORD: Record<Role, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'],
  CSD: ['cabin manager', 'cabin managers'], SCC: ['senior cabin crew', 'senior cabin crew'], CC: ['cabin crew', 'cabin crew'],
};
const at = (t: Minute, now: Minute) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? fmtTime(t) : fmtDateTime(t));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ceil5 = (t: Minute) => Math.ceil(t / 5) * 5;

// ---------- types (§3.1, §3.2) ----------

export interface SeatNeed { role: Role; n: number }

export interface FixPreview {
  /** What changes if applied: lines like 'Captain Silva takes the CPT seat (deadhead TP 1342 LIS–DUS, lands 07:10)'. */
  changes: string[];
  /** After the fix: the flight's crew status and what is still missing. */
  after: { level: FlightCrewStatus['level']; missing: SeatNeed[] };
  /** Knock-on: other flights that move or lose crew. */
  ripple: { flightId: string; no: string; text: string; tone: 'warn' | 'bad' }[];
}

export interface FixOption {
  /** crewId | pairingId | jet class. */
  id: string;
  label: string;
  sub: string;
  cost: number;
  arrives?: Minute;
  /** Legality of the person after the trip (candidates). */
  level: Legality | null;
  reason?: Reason;
}

export interface CrewSolution {
  id: CrewFix;
  label: string;
  desc: string;
  available: boolean;
  why?: string;
  cost: number;
  newDeparture: Minute | null;
  chips: string[];
  consequences: string[];
  rank: number;
  confirm: boolean;
  preview: FixPreview;
  options?: FixOption[];
}

export interface CrewControlView {
  flightId: string; no: string; from: string; to: string; std: Minute; aircraftId: string; reg: string;
  stage: 'amber' | 'red' | 'gate' | 'ok';
  hoursLeft: number;
  missing: SeatNeed[];
  /** Seats held by crew who cannot legally fly (illegal), with their one reason. */
  illegal: { crewId: string; name: string; role: Role; reason: Reason }[];
  card: ProblemCard;
  solutions: CrewSolution[];
  /** Legs this fix covers (the unit: wave or trip) and their passengers. */
  unit: { flightIds: string[]; pax: number; revenueLegs: number };
}

export interface ApplyOpts { optionId?: string; crewIds?: string[]; confirmed?: boolean }

export const FIX_LABEL: Record<CrewFix, string> = {
  autoFix: 'Auto-fix', deadhead: 'Fly someone in', delay: 'Delay until crew arrives', jet: 'Charter a private jet', callIn: 'Call in standby crew',
  discretion: "Commander's discretion", swap: 'Swap crews', subcharter: 'Sub-charter', cancel: 'Cancel',
};
const FIX_ORDER: CrewFix[] = ['autoFix', 'deadhead', 'delay', 'jet', 'callIn', 'discretion', 'swap', 'subcharter', 'cancel'];
const FIX_DESC: Record<CrewFix, string> = {
  autoFix: 'Run the roster again for this flight and its trip.',
  deadhead: 'A free crew member flies in as a passenger on an airline ticket.',
  delay: 'The flight waits until a legal crew can take it; later legs move.',
  jet: 'A business jet brings the crew in within hours. Dear, but fast.',
  callIn: 'Someone off duty at the airport comes in: overtime pay, a morale hit.',
  discretion: "The captain extends the crew's day by up to two hours.",
  swap: "Take the crew of another flight; that flight then needs a crew.",
  subcharter: 'A rival airline flies it; we still bill the client.',
  cancel: 'Compensation to the client and a reliability hit.',
};

// ---------- the unit, seats and words ----------

const group = (roles: Role[]): SeatNeed[] => {
  const out: SeatNeed[] = [];
  for (const r of SLOT_ORDER) {
    const n = roles.filter((x) => x === r).length;
    if (n) out.push({ role: r, n });
  }
  return out;
};
export const seatsText = (need: SeatNeed[]): string => need.map((s) => `${s.n} ${ROLE_WORD[s.role][s.n === 1 ? 0 : 1]}`).join(' and ') || 'nothing';

/** Passengers of the unit's revenue legs (cabin × 85% when a leg has none). */
function unitPax(ac: Aircraft, legs: Flight[]): number {
  let n = 0;
  for (const f of legs) if (isRevenue(f)) n += f.pax ?? Math.round(ac.cabin.total * 0.85);
  return n;
}

interface Ctx {
  g: GameState; f: Flight; ac: Aircraft; d?: Duty; p?: Pairing; cs: FlightCrewStatus;
  missing: Role[]; need: SeatNeed[]; unit: Flight[]; pax: number; revLegs: number; dep: string;
}

function ctxOf(g: GameState, flightId: string): Ctx | null {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.kind === 'deadhead' || f.status !== 'scheduled') return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  const cs = flightCrewStatus(g, f.id);
  const missing = [...cs.missing].sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  const unit = unitOf(g, ac, f);
  return { g, f, ac, d, p, cs, missing, need: group(missing), unit, pax: unitPax(ac, unit), revLegs: unit.filter(isRevenue).length, dep: f.from };
}

function whatLine(x: Ctx): string {
  const { f, p, missing } = x;
  if (!missing.length) return `${f.no}'s crew can't legally fly it`;
  const req = p ? p.slots.filter((s) => !s.above).map((s) => s.role) : missing;
  const pilots = req.filter(isPilot).length;
  const cabin = req.length - pilots;
  const mp = missing.filter(isPilot).length;
  const mc = missing.length - mp;
  if (mp === pilots && mc === cabin) return `${f.no} has no crew`;
  if (mp === pilots && !mc && pilots) return `${f.no} has no pilots`;
  if (mc === cabin && !mp && cabin) return `${f.no} has no cabin crew`;
  return `${f.no} is missing ${seatsText(x.need)}`;
}

// ---------- the ladder (§2) ----------

/** Crew-short flights (missing or illegal crew) departing inside the amber window, soonest first. Pure. */
export function shortFlights(g: GameState): { flightId: string; stage: 'amber' | 'red'; hoursLeft: number }[] {
  const out: { flightId: string; stage: 'amber' | 'red'; hoursLeft: number; std: Minute }[] = [];
  const until = g.now + CC().amberH * 60;
  for (const id of Object.keys(g.fleet)) {
    for (const f of liveFlightsOf(g, id)) {
      if (f.status !== 'scheduled' || f.aircraftId !== id || f.std > until || f.std + f.delay < g.now - 6 * 60) continue;
      const cs = flightCrewStatus(g, f.id);
      if (cs.level !== 'missing' && cs.level !== 'illegal') continue;
      const hoursLeft = Math.max(0, Math.round(((f.std - g.now) / 60) * 10) / 10);
      out.push({ flightId: f.id, stage: hoursLeft <= CC().redH ? 'red' : 'amber', hoursLeft, std: f.std });
    }
  }
  out.sort((a, b) => a.std - b.std || (a.flightId < b.flightId ? -1 : 1));
  return out.map(({ std: _s, ...x }) => x);
}

/**
 * The warning ladder: a flight first seen short inside 48 h gets an amber mark and one message per batch (no pause);
 * still short inside 12 h it turns red, with one message per duty, the crewShortage pause and the 'crewRed' sound
 * hook. Marks are saved on the flight (never repeated). Called hourly and after every auto-roster.
 */
/** Previews run the fixes on a copy: the ladder (messages, pauses) stays quiet while one runs. */
let previewing = 0;

export function escalateShortages(g: GameState): void {
  if (previewing) return;
  const amber: Flight[] = [];
  const red: Flight[] = [];
  for (const x of shortFlights(g)) {
    const f = g.flights[x.flightId];
    if (x.stage === 'red') {
      if (f.crewAlert !== 'red') {
        f.crewAlert = 'red';
        red.push(f);
      }
    } else if (!f.crewAlert) {
      f.crewAlert = 'amber';
      amber.push(f);
    }
  }
  const s = stats(g);
  const perDuty = (fl: Flight[]) => {
    const seen = new Set<string>();
    return fl.filter((f) => {
      const k = f.dutyId ?? f.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  if (amber.length) {
    s.crewAmber = (s.crewAmber ?? 0) + amber.length;
    const fl = perDuty(amber);
    const card = crewShortCard(g, fl[0].id);
    if (card) {
      const h = Math.round((fl[0].std - g.now) / 60);
      pushMessage(g, {
        tone: 'warn', cat: 'crew', title: fl.length === 1 ? card.what : `${fl.length} flights have no crew`,
        body: `${card.why} Hurts: ${card.hurt.text.replace(/^(Yes|Not much): /, '')}. Departs in ${h} h.${fl.length > 1 ? ` Also ${fl.slice(1, 4).map((f) => f.no).join(', ')}.` : ''}`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
  }
  if (red.length) {
    for (const f of perDuty(red)) {
      s.crewRed = (s.crewRed ?? 0) + 1;
      const card = crewShortCard(g, f.id);
      if (!card) continue;
      const h = Math.max(0, Math.round((f.std - g.now) / 60));
      pushMessage(g, {
        tone: 'bad', cat: 'crew', topic: 'crewRed', title: `CREW SHORTAGE: ${f.no} in ${h} h`,
        body: `${card.why} Hurts: ${card.hurt.text.replace(/^(Yes|Not much): /, '')}. Open Crew Control to fix it.`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
    requestPause('crewShortage');
  }
}

setShortHook(escalateShortages);

// ---------- the card (§3.6–§3.8, §9) ----------

const CAUSE_ORDER: ReasonCode[] = ['place', 'rest', 'fdp', 'hours', 'recovery', 'busy', 'sick', 'leave', 'training', 'joining', 'rating'];

/** The reach bar: when the nearest ticket from where c is could land, against the duty's must-land-by. Pure. */
export function reachFor(g: GameState, p: Pairing, d: Duty, c: CrewMember, departure: Minute): ReachSpec {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const segs = segsOf(g, c, p.id);
  const from = locAt(c, segs, d.report);
  const ready = Math.max(g.now, readyAt(c, segs, d.report));
  const first = Math.ceil((ready + BAL.deadheadCheckIn) / 60) * 60;
  const arr = first + dhBlock(from, dep);
  const legs = from === dep ? [] : itinerary(from, dep, first, arr).map((l) => ({ no: l.no, airline: l.airline, from: l.from, to: l.to, dep: l.dep, arr: l.arr }));
  const mustLandBy = d.report - OUT_CONNECT;
  return { from, to: dep, now: g.now, mustLandBy, report: d.report, departure, earliestArrival: arr, legs, gapMin: arr - mustLandBy };
}

/** The crew-shortage card for a flight whose crew is missing or illegal (null when it is fine). Pure. */
export function crewShortCard(g: GameState, flightId: string): ProblemCard | null {
  const x = ctxOf(g, flightId);
  if (!x || (x.cs.level !== 'missing' && x.cs.level !== 'illegal')) return null;
  const { f, ac, d, p } = x;
  const ready = crewReadyAt(g, f, ac);
  const delayMin = Math.max(0, ready - f.std);
  const k = contractOf(g, f);
  const perDelay = k?.product.kind === 'charter' && delayMin > 180 ? k.penalties.perDelay : 0;
  const hurt = mkHurt({ money: cancelCost(g, x.unit) + perDelay, pax: x.pax, delayMin, legs: x.revLegs, what: 'penalty', empty: !x.revLegs });
  const what = whatLine(x);
  const visuals: ProblemCard['visuals'] = {};
  const details: string[] = [];
  const terms: ProblemCard['terms'] = [];
  let why = '';
  const fam = typeOf(ac.typeId).family;
  if (!x.missing.length) {
    // An illegal seat, or a duty too long for one crew.
    const bad = d ? crewIssuesFor(g, d) : [];
    const first = bad[0] ? g.crew[bad[0].crewId] : undefined;
    const r = first && d && p ? rootReason(g, bad.filter((b) => b.crewId === first.id).map((b) => b.issue), first, p) : null;
    if (first && r) {
      why = `${crewName(first)} is ${r.text}${r.code === 'rest' && d ? `, after the ${fmtTime(d.report)} report` : ''}.`;
      for (const b of bad) details.push(`${crewName(g.crew[b.crewId])}: ${b.issue.text}`);
      if (r.code === 'rest' || r.code === 'fdp' || r.code === 'hours' || r.code === 'recovery') visuals.gauges = crewGauges(g, first.id, d?.id);
      if (r.code === 'place' && p && d) visuals.reach = reachFor(g, p, d, first, f.std);
      terms.push(r.code === 'rest' ? 'rest' : r.code === 'fdp' ? 'fdp' : r.code === 'recovery' ? 'recovery' : 'deadhead');
    } else if (d) {
      const max = d.maxFdp + (d.discretion ?? 0);
      why = `The crew's day would run ${hm(d.fdp)}, over the ${hm(max)} limit${d.discretion ? ' even with discretion' : ''}.`;
      details.push(`Duty ${fmtDateTime(d.report)} – ${fmtDateTime(d.release)}, ${d.sectors} sectors, FDP ${hm(d.fdp)} of ${hm(d.maxFdp)}${d.discretion ? ` + ${hm(d.discretion)} discretion` : ''}`);
      visuals.gauges = [{ id: 'fdp', label: 'Day length', value: d.fdp, limit: max, unit: 'hm', text: `${hm(d.fdp)} of ${hm(max)}`, tone: 'bad', by: d.report }];
      terms.push('fdp', 'discretion');
    } else why = `${f.no} has no crew plan yet.`;
  } else {
    const role = x.missing[0];
    const word = ROLE_WORD[role];
    const cands = d ? dutyCandidates(g, d.id, role).filter((c) => !c.onPairing) : [];
    const rated = Object.values(g.crew).some((c) => canFill(role, c.role) && c.ratings.includes(fam));
    const refused = cands.filter((c) => c.level === 'illegal' && c.reason);
    let cause: ReasonCode | null = null;
    for (const code of CAUSE_ORDER) if (refused.some((c) => c.reason!.code === code)) { cause = code; break; }
    const pick = cause ? refused.find((c) => c.reason!.code === cause)! : null;
    const cm = pick ? g.crew[pick.crewId] : undefined;
    const r = pick?.reason;
    const plur = word[1];
    const free = cands.find((c) => c.level !== 'illegal');
    if (free) {
      why = `${free.name} is free${free.loc !== x.dep ? ` in ${city(free.loc)}` : ` at ${city(x.dep)}`} and could take the ${word[0]} seat: the roster has not placed them yet.`;
      terms.push('standby');
    } else if (!cands.length || !cm || !r) {
      why = rated ? `No ${fam} ${plur} are free at all this week.` : `Nobody free holds the ${fam} rating.`;
      terms.push('standby');
    } else if (r.code === 'place' && p && d) {
      const reach = reachFor(g, p, d, cm, f.std);
      const same = refused.filter((c) => c.reason!.code === 'place');
      const where = [...new Set(same.map((c) => city(c.loc)))].slice(0, 2).join(' and ');
      const gap = reach.gapMin;
      why = gap > 0
        ? `Your free ${plur} are in ${where} and the earliest they can land in ${city(x.dep)} is ${at(reach.earliestArrival, g.now)}, ${fmtDuration(gap)} after the latest ${at(reach.mustLandBy, g.now)}.`
        : `Your free ${plur} are in ${where}: flown in the same day their day would be too long, and after a night's rest they report too late for the ${at(d.report, g.now)} report.`;
      visuals.reach = reach;
      visuals.minimap = {
        crew: same.slice(0, 6).map((c) => ({ id: c.crewId, name: c.name, at: c.loc })), to: x.dep,
        path: reach.legs.map((l) => ({ from: l.from, to: l.to, no: l.no, dep: l.dep, arr: l.arr })), departure: f.std,
      };
      terms.push('deadhead');
    } else if (r.code === 'rest' && d) {
      why = `${crewName(cm)} is the nearest free ${word[0]}, but their rest at ${city(pick!.loc)} ends at ${r.until !== undefined ? at(r.until, g.now) : 'too late'}, after the ${at(d.report, g.now)} report.`;
      visuals.gauges = crewGauges(g, cm.id, d.id);
      terms.push('rest');
    } else if (r.code === 'fdp' && d) {
      why = `${crewName(cm)} could take it, but their day would run ${r.text.replace(/^over the day limit \(?/, '').replace(/\)$/, '')}.`;
      visuals.gauges = crewGauges(g, cm.id, d.id);
      terms.push('fdp', 'discretion');
    } else if (r.code === 'hours') {
      why = `${crewName(cm)} is ${r.text}; everyone else rated on the ${fam} is busy or away.`;
      visuals.gauges = crewGauges(g, cm.id, d?.id);
      terms.push('blockHours');
    } else if (r.code === 'recovery') {
      why = `${crewName(cm)} is ${r.text}; everyone else rated on the ${fam} is busy or away.`;
      visuals.gauges = crewGauges(g, cm.id, d?.id);
      terms.push('recovery');
    } else if (r.code === 'busy') {
      why = `Every rated ${word[0]} is busy on another trip (${crewName(cm)} ${r.text.replace(/^busy /, '')}).`;
      terms.push('standby');
    } else {
      why = `${crewName(cm)} is ${r.text}, and nobody else rated on the ${fam} is free.`;
      terms.push('standby');
    }
    for (const c of cands.slice(0, 8)) details.push(`${c.name} (${city(c.loc)}): ${c.reason?.text ?? c.reasons.join('; ') ?? 'legal'}`);
  }
  if (d) details.push(`Report ${fmtDateTime(d.report)} UTC at ${x.dep}; missing ${seatsText(x.need)}${x.cs.level === 'illegal' ? '; crew flagged illegal' : ''}`);
  details.push(`A legal crew could take it from ${fmtDateTime(ready)} UTC${delayMin ? ` (${fmtDuration(delayMin)} late)` : ''}`);
  const sev = (f.std - g.now) / 60 <= CC().redH ? 'red' : 'amber';
  return {
    subject: { kind: x.missing.length ? 'crewShort' : 'crewIllegal', ref: { kind: 'flight', id: f.id } },
    severity: sev, title: what, what, why, hurt,
    actions: [
      { id: 'crewControl', label: 'Crew Control', open: { modal: 'crewControl', id: f.id }, primary: true },
      ...(d ? [{ id: 'adjustCrew', label: 'Adjust crew', open: { modal: 'duty' as const, id: d.id } }] : []),
      { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } } },
    ],
    details, visuals, terms: [...new Set(terms)], by: f.std,
  };
}

// ---------- gauges (§7) ----------

/** Fuel-gauge bars for a crew member's limits: FDP of a duty (or the next), rest, 7-day duty, 28-day block, year block. Pure. */
export function crewGauges(g: GameState, crewId: string, dutyId?: string): GaugeSpec[] {
  const c = g.crew[crewId];
  if (!c) return [];
  const out: GaugeSpec[] = [];
  const segs = segsOf(g, c);
  let d = dutyId ? g.duties[dutyId] : undefined;
  if (!d) {
    const next = segs.find((s) => s.kind === 'duty' && s.end > g.now && s.dutyId);
    d = next?.dutyId ? g.duties[next.dutyId] : undefined;
  }
  const t = d ? d.report : g.now;
  if (d) {
    const seg = segs.find((s) => s.dutyId === d!.id && s.kind === 'duty');
    const fdp = seg?.fdp ?? d.fdp;
    const max = seg?.maxFdp ?? d.maxFdp + (d.discretion ?? 0);
    out.push({ id: 'fdp', label: 'Day length', value: fdp, limit: max, unit: 'hm', text: `${hm(fdp)} of ${hm(max)}`, tone: fdp > max ? 'bad' : limitTone(fdp, max), by: d.report, crewId });
  }
  // Rest before that duty (or the rest running now): taken so far against the minimum, ending when it ends.
  const prev = [...segs].reverse().find((s) => s.kind !== 'log' && s.end <= t && (!d || s.dutyId !== d.id));
  const last = c.log[c.log.length - 1];
  let taken = 0;
  let need = 0;
  let ends = 0;
  if (prev) {
    taken = t - prev.end;
    need = prev.rest;
    ends = prev.end + prev.rest;
  } else if (last) {
    taken = t - last.end;
    need = Math.max(c.restUntil - last.end, 0);
    ends = c.restUntil;
  }
  if (need > 0) {
    const ok = taken >= need;
    out.push({ id: 'rest', label: 'Rest', value: Math.min(taken, need), limit: need, unit: 'hm', text: `${hm(Math.min(taken, need))} of ${hm(need)}${ok ? '' : ` by ${fmtTime(ends)}`}`, tone: ok ? 'good' : taken >= need * 0.75 ? 'warn' : 'bad', by: ends, crewId });
  }
  const w = crewWindows(g, c, t);
  const cum = (id: GaugeSpec['id'], label: string, v: number, lim: number) => out.push({ id, label, value: v, limit: lim, unit: 'hm', text: `${hm(v)} of ${hm(lim)}`, tone: limitTone(v, lim), crewId });
  cum('duty7d', '7-day duty', w.duty7d, LIMITS.duty7d);
  cum('block28d', '28-day flying', w.block28d, LIMITS.block28d);
  cum('blockYear', 'Year flying', w.blockYear, LIMITS.blockYear);
  return out;
}

// ---------- jets (§4) ----------

export interface JetQuote {
  cls: JetClass; model: string; operator: string; reg: string; seats: number; jets: number;
  wheelsUp: Minute; arrives: Minute; block: number; fuelStop: string | null; cost: number; text: string;
}

const NM = 1.852;

/** The smallest class that seats the crew and covers the distance (with one fuel stop at most). */
function jetClassFor(crewN: number, nm: number): JetClass {
  const J = CC().jet;
  for (const cls of JET_CLASSES) if (crewN <= J.seats[cls] && nm <= J.rangeNm[cls] * 2) return cls;
  return 'heavy';
}

/** A charter quote for `crewN` crew from → to, free from `ready` (now at the earliest). Pure (hash-picked operator). */
export function jetQuote(g: GameState, from: string, to: string, crewN: number, ready: Minute, cls?: JetClass): JetQuote {
  const J = CC().jet;
  const nm = distance(from, to) / NM;
  const c = cls ?? jetClassFor(crewN, nm);
  const seats = J.seats[c];
  const jets = Math.max(1, Math.ceil(crewN / seats));
  const stop = nm > J.rangeNm[c];
  let block = Math.round((nm / J.cruiseKt[c]) * 60 + J.taxiMin);
  if (stop) block += J.fuelStopMin;
  const hours = Math.max(J.minH, block / 60) + J.positioningH;
  const per = Math.round((hours * J.rate[c] + J.fees + (stop ? J.fuelStopFee : 0)) / 100) * 100;
  const cost = per * jets;
  const wheelsUp = Math.ceil(Math.max(g.now + J.fboLeadMin, ready) / 15) * 15;
  const arrives = wheelsUp + block;
  const day = Math.floor(g.now / DAY);
  const data = JETS[c];
  const h = hashUnit(`${from}${to}${c}${day}`);
  const model = data.types[Math.floor(h * data.types.length) % data.types.length];
  const op = data.operators[Math.floor(h * 97) % data.operators.length];
  const letters = (n: number) => String.fromCharCode(65 + (n % 26));
  const k = Math.floor(h * 1e6);
  const reg = `${op.prefix}${letters(k)}${letters(k >> 5)}${letters(k >> 10)}`;
  const fuelStop = stop ? 'one fuel stop' : null;
  return {
    cls: c, model, operator: op.name, reg, seats, jets, wheelsUp, arrives, block, fuelStop, cost,
    text: `${model} · ${op.name} · ${from}→${to} ${fmtTime(wheelsUp)}–${fmtTime(arrives)} UTC${stop ? ' (fuel stop)' : ''}${jets > 1 ? ` · ${jets} jets` : ''} · ${usd(cost)}`,
  };
}

/** Crew who could take a `role` seat if a jet brought them (the airline reach ignored), earliest ready first. Pure. */
function jetCandidates(g: GameState, p: Pairing, d: Duty, role: Role, exclude: Set<string>): { c: CrewMember; loc: string; ready: Minute; level: Legality }[] {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const fam = typeOf(typeIdOf(g, p)).family;
  const on = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const out: { c: CrewMember; loc: string; ready: Minute; level: Legality; km: number }[] = [];
  for (const c of Object.values(g.crew)) {
    if (!canFill(role, c.role) || !c.ratings.includes(fam) || on.has(c.id) || exclude.has(c.id)) continue;
    const segs = segsOf(g, c, p.id);
    const loc = locAt(c, segs, d.report);
    if (loc === dep) continue;
    const plan = planCrew(g, c, p, segs);
    const issues = plan.issues.filter((i) => i.code !== 'fdp' && i.code !== 'location');
    const level = levelOf(issues);
    if (level === 'illegal') continue;
    out.push({ c, loc, ready: Math.max(g.now, readyAt(c, segs, d.report)), level, km: distance(loc, dep) });
  }
  out.sort((a, b) => a.ready - b.ready || a.km - b.km || (a.c.role === role ? -1 : 1) || (a.c.id < b.c.id ? -1 : 1));
  return out;
}

/**
 * Charters one business jet per origin for these crew to the flight's first departure and seats them on its duty
 * (kind 'deadhead' with `charter`; the ride is positioning inside the FDP like any ticket). Cost to 'crewJet'.
 */
export function charterJet(g: GameState, flightId: string, crewIds: string[], cls: JetClass): ActionResult<{ ticketIds: string[]; cost: number }> {
  const x = ctxOf(g, flightId);
  if (!x) return { ok: false, error: 'Flight not found or already left' };
  const { f, d, p } = x;
  if (!d || !p) return { ok: false, error: 'No crew plan for this flight yet' };
  const crew = crewIds.map((id) => g.crew[id]).filter((c): c is CrewMember => !!c);
  if (!crew.length) return { ok: false, error: 'Nobody to fly in' };
  if (crew.some((c) => p.slots.some((s) => s.crewId === c.id))) return { ok: false, error: 'Already on this trip' };
  const groups = new Map<string, CrewMember[]>();
  const ready = new Map<string, Minute>();
  for (const c of crew) {
    const segs = segsOf(g, c, p.id);
    const loc = locAt(c, segs, d.report);
    if (loc === x.dep) return { ok: false, error: `${crewName(c)} is already at ${x.dep}` };
    groups.set(loc, [...(groups.get(loc) ?? []), c]);
    ready.set(loc, Math.max(ready.get(loc) ?? g.now, readyAt(c, segs, d.report)));
  }
  const ticketIds: string[] = [];
  let cost = 0;
  const lines: string[] = [];
  for (const [loc, cs] of groups) {
    const q = jetQuote(g, loc, x.dep, cs.length, ready.get(loc)!, cls);
    const t = addDeadhead(g, { crewIds: cs.map((c) => c.id), from: loc, to: x.dep, std: q.wheelsUp, sta: q.arrives, cost: q.cost, contractId: p.contractId });
    t.no = 'PJ';
    t.charter = { cls: q.cls, model: q.model, operator: q.operator, reg: q.reg };
    d.deadheadIds.push(t.id);
    ticketIds.push(t.id);
    cost += q.cost;
    lines.push(`${q.model} (${q.operator}) ${loc}–${x.dep}, lands ${at(q.arrives, g.now)}`);
  }
  touchCrew(g);
  // Seat them; anyone the roster still refuses comes off the jet (an empty jet is not chartered).
  const seated: string[] = [];
  for (const c of crew) {
    const seat = p.slots.find((s) => !s.crewId && !s.above && s.role === c.role) ?? p.slots.find((s) => !s.crewId && !s.above && canFill(s.role, c.role));
    const r = seat ? assignCrew(g, f.id, c.id, seat.role) : { ok: false as const, error: 'No empty seat' };
    if (r.ok) seated.push(c.id);
    else {
      for (const id of ticketIds) {
        const t = g.flights[id];
        if (t) t.crewIds = t.crewIds.filter((y) => y !== c.id);
      }
    }
  }
  const empty = ticketIds.filter((id) => !g.flights[id]?.crewIds.length);
  if (empty.length) {
    for (const id of empty) cost -= g.flights[id].cost ?? 0;
    removeFlights(g, empty);
    d.deadheadIds = d.deadheadIds.filter((id) => !empty.includes(id));
    touchCrew(g);
  }
  if (!seated.length) return { ok: false, error: 'Nobody could be seated on the trip' };
  post(g, 'crewJet', -cost);
  const s = stats(g);
  s.jets = (s.jets ?? 0) + ticketIds.length - empty.length;
  s.jetSpend = (s.jetSpend ?? 0) + cost;
  recheckPairing(g, p);
  touchCrew(g);
  return { ok: true, msg: `Private jet chartered: ${lines.join('; ')} (${usd(cost)})`, data: { ticketIds: ticketIds.filter((id) => !empty.includes(id)), cost } };
}

// ---------- cancel (§3.4 i) ----------

/** Cancels the unit the flight starts (wave or trip) for want of crew: compensation, reliability −3, one message. */
export function cancelTrip(g: GameState, flightId: string): ActionResult<{ legs: number; penalty: number }> {
  const x = ctxOf(g, flightId);
  if (!x) return { ok: false, error: 'Flight not found or already left' };
  const legs = x.unit;
  const rev = legs.filter(isRevenue).length;
  const penalty = cancelLegs(g, legs, 'Crew shortage', CC().cancelRep);
  pushMessage(g, {
    tone: rev ? 'bad' : 'info', cat: 'crew', title: `${x.f.no} cancelled${legs.length > 1 ? ` with ${legs.length - 1} more` : ''}: crew shortage`,
    body: `${legs.map((l) => `${l.no} ${l.from}–${l.to}`).join(', ')} cancelled for want of a legal crew.${penalty ? ` Compensation ${usd(penalty)}.` : ''}`,
    ref: { kind: 'flight', id: x.f.id }, hurt: { money: penalty, pax: x.pax, delayMin: 0, level: penalty || x.pax ? 'high' : 'none' },
  });
  if (x.ac) rerosterFrom(g, x.ac.id, g.now);
  return { ok: true, msg: `${plural(rev, 'leg')} cancelled, ${usd(penalty)} compensation`, data: { legs: rev, penalty } };
}

// ---------- the fixes (§3.4) ----------

type Run = { ok: true; changes: string[]; cost: number } | { ok: false; error: string };

/** The ticket out a crew member holds for duty d, as 'deadhead TP 1342 LIS–DUS, lands 07:10' / 'private jet …'. */
function rideText(g: GameState, d: Duty, crewId: string): string {
  for (const fid of d.deadheadIds) {
    const t = g.flights[fid];
    if (!t || t.status !== 'scheduled' || !t.crewIds.includes(crewId) || t.sta > d.report) continue;
    const legs = commercialItinerary(g, t);
    return ` (${t.charter ? `private jet ${t.charter.model}` : `deadhead ${itineraryText(legs)}`}, lands ${at(t.sta, g.now)})`;
  }
  return '';
}

/** Seats filled on the flight's pairing since `before` (crew id per slot index), as change lines. */
function seatChanges(g: GameState, f: Flight, before: Set<string>): string[] {
  const d = g.flights[f.id]?.dutyId ? g.duties[g.flights[f.id].dutyId!] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) return [];
  const out: string[] = [];
  for (const s of p.slots) {
    if (!s.crewId || before.has(s.crewId) || s.above) continue;
    const c = g.crew[s.crewId];
    if (c) out.push(`${crewName(c)} takes the ${ROLE_WORD[s.role][0]} seat${rideText(g, d, c.id)}`);
  }
  const still = group(p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role));
  if (still.length) out.push(`${seatsText(still)} still missing`);
  return out;
}

const heldBy = (p?: Pairing) => new Set(p ? p.slots.filter((s) => s.crewId).map((s) => s.crewId!) : []);
const overtimeOf = (c: CrewMember) => Math.round((CC().callInPay * c.salary) / 21);

/** Candidates for a missing seat: legal after their trip, not on the pairing; `here`: at the airport (call-in) or not (deadhead). */
function seatCandidates(g: GameState, d: Duty, role: Role, here: boolean): DutyCandidate[] {
  return dutyCandidates(g, d.id, role).filter((c) => !c.onPairing && c.level !== 'illegal' && (here ? !c.travel : !!c.travel));
}

/** The default (or chosen) crew per missing seat, one person each, from a candidate list per role. */
function pickCrew(x: Ctx, lists: Map<Role, DutyCandidate[]>, chosen?: string[]): { role: Role; crewId: string }[] {
  const out: { role: Role; crewId: string }[] = [];
  const used = new Set<string>();
  for (const role of x.missing) {
    const list = lists.get(role) ?? [];
    const pick = chosen ? list.find((c) => chosen.includes(c.crewId) && !used.has(c.crewId)) : list.find((c) => !used.has(c.crewId));
    if (!pick) continue;
    used.add(pick.crewId);
    out.push({ role, crewId: pick.crewId });
  }
  return out;
}

/** Delays f until `ready` as the player would (lateness accepted) and ripples the later legs. */
function delayTo(h: GameState, f: Flight, ready: Minute): void {
  f.lateOk = Math.max(f.lateOk ?? 0, ready - (f.schedStd ?? f.std));
  delayChain(h, f, ready, 'Waiting for crew', false);
}

/** Runs a fix on state h (the live game or a preview copy). */
function runFix(h: GameState, flightId: string, fix: CrewFix, opts: ApplyOpts): Run {
  const x = ctxOf(h, flightId);
  if (!x) return { ok: false, error: 'Flight not found or already left' };
  const { f, ac, d, p } = x;
  const before = heldBy(p);
  switch (fix) {
    case 'autoFix': {
      rerosterFrom(h, ac.id, h.now);
      const changes = seatChanges(h, f, before);
      return { ok: true, changes: changes.length ? changes : ['Nothing changed: nobody legal is free'], cost: 0 };
    }
    case 'deadhead':
    case 'callIn': {
      if (!d) return { ok: false, error: 'No crew plan for this flight yet' };
      const lists = new Map<Role, DutyCandidate[]>();
      for (const role of new Set(x.missing)) lists.set(role, seatCandidates(h, d, role, fix === 'callIn'));
      const picks = pickCrew(x, lists, opts.crewIds);
      if (!picks.length) return { ok: false, error: fix === 'callIn' ? `Nobody is free at ${city(x.dep)} today` : 'Nobody legal can be flown in' };
      const changes: string[] = [];
      let cost = 0;
      for (const { role, crewId } of picks) {
        const r = assignCrew(h, f.id, crewId, role);
        if (!r.ok) continue;
        const c = h.crew[crewId];
        if (fix === 'callIn') {
          const ot = overtimeOf(c);
          post(h, 'salaries', -ot);
          moraleShock(h, c, 'pay', CC().callInMorale);
          cost += ot;
          changes.push(`${crewName(c)} called in for the ${ROLE_WORD[role][0]} seat (${usd(ot)} overtime, morale ${CC().callInMorale})`);
        } else changes.push(`${crewName(c)} takes the ${ROLE_WORD[role][0]} seat${rideText(h, h.duties[d.id] ?? d, crewId)}`);
      }
      if (!changes.length) return { ok: false, error: 'The roster refused every candidate' };
      const still = h.pairings[p!.id] ? group(h.pairings[p!.id].slots.filter((s) => !s.crewId && !s.above).map((s) => s.role)) : [];
      if (still.length) changes.push(`${seatsText(still)} still missing`);
      return { ok: true, changes, cost };
    }
    case 'delay': {
      const ready = crewReadyAt(h, f, ac);
      if (ready <= f.std + f.delay) return { ok: false, error: 'A crew can take it on time: use Auto-fix' };
      if (ready - h.now > 2 * DAY) return { ok: false, error: 'No legal crew within two days' };
      const was = f.std;
      delayTo(h, f, ready);
      rerosterFrom(h, ac.id, h.now);
      const changes = [`${f.no} leaves ${at(f.std, h.now)} UTC (+${fmtDuration(f.std - was)})`, ...seatChanges(h, f, before)];
      return { ok: true, changes, cost: 0 };
    }
    case 'jet': {
      if (!d || !p) return { ok: false, error: 'No crew plan for this flight yet' };
      const used = new Set<string>();
      const picks: { c: CrewMember; ready: Minute; loc: string }[] = [];
      for (const role of x.missing) {
        const list = jetCandidates(h, p, d, role, used);
        const pick = opts.crewIds ? list.find((y) => opts.crewIds!.includes(y.c.id)) : list[0];
        if (!pick) continue;
        used.add(pick.c.id);
        picks.push({ c: pick.c, ready: pick.ready, loc: pick.loc });
      }
      if (!picks.length) return { ok: false, error: 'Nobody legal is free anywhere' };
      const cls = (opts.optionId && JET_CLASSES.includes(opts.optionId as JetClass) ? opts.optionId : undefined) as JetClass | undefined;
      // Even a jet may land after the report: the flight is delayed first by the gap.
      let latest = 0;
      const byLoc = new Map<string, { n: number; ready: Minute }>();
      for (const y of picks) byLoc.set(y.loc, { n: (byLoc.get(y.loc)?.n ?? 0) + 1, ready: Math.max(byLoc.get(y.loc)?.ready ?? 0, y.ready) });
      for (const [loc, v] of byLoc) latest = Math.max(latest, jetQuote(h, loc, x.dep, v.n, v.ready, cls).arrives);
      const changes: string[] = [];
      const gap = latest + OUT_CONNECT - d.report;
      if (gap > 0) {
        const was = f.std;
        delayTo(h, f, ceil5(f.std + gap));
        changes.push(`${f.no} leaves ${at(f.std, h.now)} UTC (+${fmtDuration(f.std - was)}) so the jet can land first`);
      }
      const r = charterJet(h, f.id, picks.map((y) => y.c.id), cls ?? jetClassFor(picks.length, distance(picks[0].loc, x.dep) / NM));
      if (!r.ok) return r;
      changes.push(...seatChanges(h, f, before));
      return { ok: true, changes, cost: r.data!.cost };
    }
    case 'discretion': {
      if (!d) return { ok: false, error: 'No duty' };
      const r = applyDiscretion(h, d.id);
      if (!r.ok) return r;
      return { ok: true, changes: [r.msg ?? "Commander's discretion applied", `Morale −3 and fatigue +10 for ${crewCount(h.pairings[d.pairingId])} crew`], cost: 0 };
    }
    case 'swap': {
      if (!d || !p) return { ok: false, error: 'No crew plan for this flight yet' };
      const sources = swapSources(h, x);
      const q = (opts.optionId ? sources.find((s) => s.p.id === opts.optionId) : sources[0])?.p;
      if (!q) return { ok: false, error: 'No other crew within two days can take it' };
      const changes: string[] = [];
      const qFirst = h.flights[openDuties(h, q)[0]?.flightIds[0] ?? ''];
      for (const role of x.missing) {
        const seat = p.slots.findIndex((s) => !s.crewId && !s.above && s.role === role);
        if (seat < 0) continue;
        const donor = q.slots.find((s) => s.crewId && canFill(role, s.role) && h.crew[s.crewId]);
        if (!donor) continue;
        const c = h.crew[donor.crewId!];
        releaseCrew(h, q, c.id);
        placeCrew(h, p, seat, c);
        p.slots[seat].locked = true;
        moraleShock(h, c, 'lateChange', CC().swapMorale);
        changes.push(`${crewName(c)} moves from ${qFirst?.no ?? 'the other trip'} to the ${ROLE_WORD[role][0]} seat${rideText(h, d, c.id)}`);
      }
      if (!changes.length) return { ok: false, error: 'That crew has nobody for these seats' };
      touchCrew(h);
      if (q.aircraftId) rerosterFrom(h, q.aircraftId, h.now);
      if (qFirst) {
        const cs = flightCrewStatus(h, qFirst.id);
        changes.push(cs.level === 'missing' || cs.level === 'illegal' ? `${qFirst.no} then needs ${seatsText(group(cs.missing)) || 'a legal crew'}` : `${qFirst.no} is still crewed`);
      }
      return { ok: true, changes, cost: 0 };
    }
    case 'subcharter': {
      const ids = rotationOf(h, f.id).map((l) => l.id);
      const q = subcharterQuote(h, ids);
      if (!q) return { ok: false, error: 'No rival can take it (too close to departure, or no revenue legs)' };
      const r = subcharter(h, ids, q.cost);
      if (!r.ok) return r;
      return { ok: true, changes: [`${q.rivalName} flies ${plural(r.data!.legs, 'leg')} for ${usd(q.cost)}; we still bill ${usd(q.revenue)}`], cost: q.cost };
    }
    case 'cancel': {
      const r = cancelTrip(h, f.id);
      if (!r.ok) return r;
      return { ok: true, changes: [`${plural(r.data!.legs, 'revenue leg')} cancelled, ${usd(r.data!.penalty)} compensation, reliability −3`], cost: r.data!.penalty };
    }
  }
}

/** Other planned trips of the same family whose crew could take this trip's missing seats (report within ±48 h). */
function swapSources(g: GameState, x: Ctx): { p: Pairing; first: Flight | undefined; legal: Legality }[] {
  const { d, p } = x;
  if (!d || !p) return [];
  const fam = typeOf(typeIdOf(g, p)).family;
  const out: { p: Pairing; first: Flight | undefined; legal: Legality; report: Minute }[] = [];
  for (const q of Object.values(g.pairings)) {
    if (q.id === p.id || !q.aircraftId || q.status !== 'planned' || q.tour || crewCount(q) === 0 || typeOf(typeIdOf(g, q)).family !== fam) continue;
    const open = openDuties(g, q);
    if (!open.length || open[0].report <= g.now || Math.abs(open[0].report - d.report) > 48 * 60) continue;
    let legal: Legality = 'legal';
    let covered = 0;
    for (const role of new Set(x.missing)) {
      const donor = q.slots.find((s) => s.crewId && canFill(role, s.role) && g.crew[s.crewId]);
      if (!donor) continue;
      const c = g.crew[donor.crewId!];
      const segs = segsOf(g, c, q.id).filter((s) => !s.dutyId || !p.dutyIds.includes(s.dutyId));
      const lv = levelOf(planCrew(g, c, p, segs, false, 0, q.id).issues.filter((i) => i.code !== 'fdp'));
      if (lv === 'illegal') continue;
      covered++;
      legal = lv === 'tight' ? 'tight' : legal;
    }
    if (!covered) continue;
    out.push({ p: q, first: g.flights[open[0].flightIds[0]], legal, report: open[0].report });
  }
  out.sort((a, b) => a.report - b.report || (a.p.id < b.p.id ? -1 : 1));
  return out;
}

// ---------- previews (§3.3) ----------

type Snap = Map<string, { no: string; level: FlightCrewStatus['level']; std: Minute; missing: Role[] }>;

/** Scheduled legs of every aircraft inside a week: their crew status and times (ripple baseline). */
function snapshot(g: GameState): Snap {
  const m: Snap = new Map();
  const until = g.now + 7 * DAY;
  for (const id of Object.keys(g.fleet)) for (const f of liveFlightsOf(g, id)) {
    if (f.status !== 'scheduled' || f.std > until) continue;
    const cs = flightCrewStatus(g, f.id);
    m.set(f.id, { no: f.no, level: cs.level, std: f.std, missing: cs.missing });
  }
  return m;
}

const BAD = (l: FlightCrewStatus['level']) => l === 'missing' || l === 'illegal';

function rippleOf(h: GameState, before: Snap, unit: Set<string>): FixPreview['ripple'] {
  const out: FixPreview['ripple'] = [];
  for (const [id, b] of before) {
    const f = h.flights[id];
    if (!f || f.status === 'cancelled') {
      if (!f || isRevenue(f)) out.push({ flightId: id, no: b.no, text: `${b.no} cancelled`, tone: 'bad' });
      continue;
    }
    if (f.aircraftId === null && f.operatedBy) continue;
    if (unit.has(id)) continue;
    if (f.std !== b.std) out.push({ flightId: id, no: b.no, text: `${b.no} moves ${f.std > b.std ? '+' : '−'}${fmtDuration(Math.abs(f.std - b.std))}`, tone: 'warn' });
    const cs = flightCrewStatus(h, id);
    if (BAD(cs.level) && !BAD(b.level)) out.push({ flightId: id, no: b.no, text: `${b.no} then needs ${seatsText(group(cs.missing)) || 'a legal crew'}`, tone: 'bad' });
    if (out.length >= 6) break;
  }
  return out;
}

/** Costs the fix posted on the copy (tickets, jets, overtime, sub-charter, compensation). */
function ledgerDiff(g: GameState, h: GameState): number {
  let s = 0;
  for (const cat of ['deadhead', 'crewJet', 'salaries', 'subcharter', 'penalties'] as const) s += (g.finance.current.lines[cat] ?? 0) - (h.finance.current.lines[cat] ?? 0);
  return Math.max(0, Math.round(s));
}

function previewOf(g: GameState, x: Ctx, fix: CrewFix, opts: ApplyOpts, before: Snap): { preview: FixPreview; cost: number; newStd: Minute | null; ok: boolean; error?: string } {
  const h = structuredClone(g);
  previewing++;
  let r: Run;
  try {
    r = runFix(h, x.f.id, fix, opts);
  } catch (e) {
    r = { ok: false, error: `Not possible: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    previewing--;
  }
  const unit = new Set(x.unit.map((l) => l.id));
  if (!r.ok) return { ok: false, error: r.error, preview: { changes: [], after: { level: x.cs.level, missing: x.need }, ripple: [] }, cost: 0, newStd: null };
  const hf = h.flights[x.f.id];
  const cs = hf && hf.aircraftId && hf.status === 'scheduled' ? flightCrewStatus(h, x.f.id) : { level: 'ok' as const, missing: [] as Role[] };
  return {
    ok: true, cost: Math.max(r.cost, ledgerDiff(g, h)), newStd: hf && hf.status === 'scheduled' && hf.std !== x.f.std ? hf.std : null,
    preview: { changes: r.changes, after: { level: cs.level, missing: group(cs.missing) }, ripple: rippleOf(h, before, unit) },
  };
}

// ---------- the view (§3.1) ----------

const empty = (x: Ctx): FixPreview => ({ changes: [], after: { level: x.cs.level, missing: x.need }, ripple: [] });

/** The nine solutions (available first, ranked) for the flight; `previews` false skips the copies (availability only). */
function solutionsFor(g: GameState, x: Ctx, previews: boolean): CrewSolution[] {
  const { f, ac, d, p } = x;
  const before = previews ? snapshot(g) : new Map();
  const out: CrewSolution[] = [];
  const base = (id: CrewFix): CrewSolution => ({ id, label: FIX_LABEL[id], desc: FIX_DESC[id], available: true, cost: 0, newDeparture: null, chips: [], consequences: [], rank: 0, confirm: false, preview: empty(x) });
  const no = (s: CrewSolution, why: string): CrewSolution => ({ ...s, available: false, why });
  const run = (s: CrewSolution, opts: ApplyOpts = {}): CrewSolution => {
    if (!previews) return s;
    const r = previewOf(g, x, s.id, opts, before);
    if (!r.ok) return no(s, r.error ?? 'Not possible now');
    const cost = Math.max(s.cost, r.cost);
    const chips = [...s.chips];
    if (cost && !chips.some((c) => c.startsWith('$'))) chips.unshift(usd(cost));
    return { ...s, cost, preview: r.preview, newDeparture: s.newDeparture ?? r.newStd, consequences: [...s.consequences, ...r.preview.ripple.map((l) => l.text)].slice(0, 4), chips };
  };
  const hrs = (t: Minute) => `lands ${at(t, g.now)}`;
  // a. auto-fix
  {
    const s = run(base('autoFix'));
    out.push(s.available && previews && BAD(s.preview.after.level) && s.preview.changes.every((c) => /still missing|Nothing changed/.test(c)) ? no(s, 'Nobody legal is free: see the other fixes') : s);
  }
  // b. deadhead and e. call-in
  for (const id of ['deadhead', 'callIn'] as const) {
    const s = base(id);
    if (!d || !x.missing.length) {
      out.push(no(s, x.missing.length ? 'No crew plan for this flight yet' : 'Every seat is taken'));
      continue;
    }
    const options: FixOption[] = [];
    for (const role of new Set(x.missing)) {
      for (const c of seatCandidates(g, d, role, id === 'callIn').slice(0, 6)) {
        const cm = g.crew[c.crewId];
        const ot = id === 'callIn' ? overtimeOf(cm) : 0;
        options.push({
          id: c.crewId, label: `${c.name} · ${c.loc}${id === 'callIn' && cm.status === 'off' ? ' · day off' : ''}`,
          sub: id === 'callIn' ? `${usd(ot)} overtime · morale ${CC().callInMorale}` : `${c.travel ?? ''} · ${c.level === 'tight' ? 'tight after' : 'legal after'}`,
          cost: id === 'callIn' ? ot : c.ticket, arrives: c.arrives, level: c.level, reason: c.reason,
        });
      }
    }
    if (!options.length) {
      out.push(no(s, id === 'callIn' ? `Nobody is free at ${city(x.dep)} today` : 'Nobody legal is free elsewhere'));
      continue;
    }
    s.options = options;
    const first = options[0];
    s.cost = first.cost;
    s.chips = id === 'callIn' ? [usd(first.cost), `Morale ${CC().callInMorale}`] : [usd(first.cost), first.arrives !== undefined ? hrs(first.arrives) : ''].filter(Boolean);
    out.push(run(s));
  }
  // c. delay
  {
    const s = base('delay');
    const ready = crewReadyAt(g, f, ac);
    if (ready <= f.std + f.delay) out.push(no(s, 'A crew can take it on time: use Auto-fix'));
    else if (ready - g.now > 2 * DAY) out.push(no(s, 'No legal crew within two days'));
    else {
      const k = contractOf(g, f);
      const late = ready - (f.schedStd ?? f.std);
      s.newDeparture = ready;
      s.cost = k?.product.kind === 'charter' && late > 180 ? k.penalties.perDelay : 0;
      s.chips = [`leaves ${at(ready, g.now)} (+${fmtDuration(ready - f.std)})`];
      s.confirm = true;
      out.push(run(s));
    }
  }
  // d. jet
  {
    const s = base('jet');
    if (!d || !p || !x.missing.length) out.push(no(s, x.missing.length ? 'No crew plan for this flight yet' : 'Every seat is taken'));
    else {
      const used = new Set<string>();
      const picks: { c: CrewMember; ready: Minute; loc: string }[] = [];
      for (const role of x.missing) {
        const pick = jetCandidates(g, p, d, role, used)[0];
        if (!pick) continue;
        used.add(pick.c.id);
        picks.push(pick);
      }
      if (!picks.length) out.push(no(s, 'Nobody legal is free anywhere within jet range'));
      else {
        const byLoc = new Map<string, { n: number; ready: Minute }>();
        for (const y of picks) byLoc.set(y.loc, { n: (byLoc.get(y.loc)?.n ?? 0) + 1, ready: Math.max(byLoc.get(y.loc)?.ready ?? 0, y.ready) });
        const quote = (cls?: JetClass) => {
          let cost = 0;
          let arrives = 0;
          let text = '';
          let jets = 0;
          for (const [loc, v] of byLoc) {
            const q = jetQuote(g, loc, x.dep, v.n, v.ready, cls);
            cost += q.cost;
            arrives = Math.max(arrives, q.arrives);
            jets += q.jets;
            text ||= `${q.model} · ${q.operator}`;
          }
          return { cost, arrives, text, jets };
        };
        const auto = quote();
        s.options = JET_CLASSES.filter((cls) => picks.length <= CC().jet.seats[cls] * 2).map((cls) => {
          const q = quote(cls);
          const first = [...byLoc.keys()][0];
          const qq = jetQuote(g, first, x.dep, byLoc.get(first)!.n, byLoc.get(first)!.ready, cls);
          return { id: cls, label: `${qq.model} · ${qq.operator}`, sub: `${usd(q.cost)} · wheels up ${at(qq.wheelsUp, g.now)}, ${hrs(q.arrives)}${qq.fuelStop ? ' (fuel stop)' : ''}${q.jets > 1 ? ` · ${q.jets} jets` : ''}`, cost: q.cost, arrives: q.arrives, level: null as Legality | null };
        });
        const defCls = jetClassFor(byLoc.size === 1 ? picks.length : Math.max(...[...byLoc.values()].map((v) => v.n)), distance(picks[0].loc, x.dep) / NM);
        s.options.sort((a, b) => Number(b.id === defCls) - Number(a.id === defCls));
        s.cost = auto.cost;
        const gap = auto.arrives + OUT_CONNECT - d.report;
        s.chips = [usd(auto.cost), hrs(auto.arrives)];
        if (auto.jets > 1) s.chips.push(`${auto.jets} jets`);
        s.consequences.push(`${picks.map((y) => crewName(y.c)).join(', ')} from ${[...byLoc.keys()].map(city).join(' and ')}`, 'Not billed to the client');
        if (gap > 0) {
          s.newDeparture = ceil5(f.std + gap);
          s.chips.push(`leaves ${at(s.newDeparture, g.now)} (+${fmtDuration(gap)})`);
          s.consequences.unshift(`Even a jet lands ${fmtDuration(gap)} late: the flight is delayed first`);
        }
        s.confirm = true;
        out.push(run(s));
      }
    }
  }
  // f. discretion
  {
    const s = base('discretion');
    const over = d ? d.fdp - d.maxFdp - (d.discretion ?? 0) : 0;
    if (!d) out.push(no(s, 'No duty'));
    else if (x.missing.length) out.push(no(s, 'Seats are empty: discretion does not crew a flight'));
    else if (d.discretion) out.push(no(s, 'Already used on this duty'));
    else if (over <= 0) out.push(no(s, 'The duty is not over its limit'));
    else if (over > (d.augment > 0 ? 180 : 120)) out.push(no(s, `Over by ${fmtDuration(over)}: more than discretion allows`));
    else {
      s.chips = ['Free', `FDP +${fmtDuration(over)}`, 'Morale −3 each', 'Fatigue +10'];
      out.push(run(s));
    }
  }
  // g. swap
  {
    const s = base('swap');
    const sources = d && p ? swapSources(g, x) : [];
    if (!sources.length) out.push(no(s, 'No other crew within two days can take it'));
    else {
      s.options = sources.slice(0, 6).map((q) => ({ id: q.p.id, label: `${q.first?.no ?? 'Trip'} ${q.first?.from ?? ''}–${q.first?.to ?? ''} crew`, sub: `reports ${fmtDateTime(openDuties(g, q.p)[0].report)} UTC${q.legal === 'tight' ? ' · tight after' : ''}`, cost: 0, level: q.legal }));
      s.confirm = true;
      s.consequences.push(`${sources[0].first?.no ?? 'That flight'} then needs a crew`);
      out.push(run(s));
    }
  }
  // h. sub-charter
  {
    const s = base('subcharter');
    const q = subcharterQuote(g, rotationOf(g, f.id).map((l) => l.id));
    if (!q) out.push(no(s, x.revLegs ? 'Too close to departure for a rival to position' : 'No revenue legs to hand over'));
    else {
      s.cost = q.cost;
      s.chips = [usd(q.cost), `we still bill ${usd(q.revenue)}`, q.rivalName];
      s.consequences.push(`${q.rivalName} flies ${plural(q.revenueLegs, 'leg')}; no reliability hit`);
      out.push(run(s));
    }
  }
  // i. cancel
  {
    const s = base('cancel');
    const live = x.unit.filter((l) => l.status === 'scheduled' && l.purpose !== 'delivery');
    if (!live.length) out.push(no(s, 'Nothing to cancel'));
    else {
      s.cost = cancelCost(g, live);
      s.chips = [usd(s.cost), `${x.revLegs ? 'Reliability −3' : 'No client'}`, plural(live.length, 'leg')];
      if (x.pax) s.chips.push(`${x.pax} pax`);
      s.confirm = true;
      out.push(run(s));
    }
  }
  // Ranking: available first, by (hurt after fix) + cost + lateness, ties in table order.
  const score = (s: CrewSolution) => {
    const bad = BAD(s.preview.after.level) ? 1e9 : 0;
    const late = s.newDeparture ? Math.max(0, s.newDeparture - f.std) * 100 : 0;
    const rip = s.preview.ripple.reduce((n, l) => n + (l.tone === 'bad' ? 20_000 : 2_000), 0);
    return bad + s.cost + late + rip + (s.id === 'cancel' ? x.pax * 500 : 0);
  };
  const ranked = [...out].sort((a, b) => Number(b.available) - Number(a.available) || score(a) - score(b) || FIX_ORDER.indexOf(a.id) - FIX_ORDER.indexOf(b.id));
  ranked.forEach((s, i) => (s.rank = i + 1));
  return ranked;
}

/** Crew Control for a flight: missing seats, the card and the nine ranked solutions with previews. Pure in g. */
export function crewControl(g: GameState, flightId: string, opts: { previews?: boolean } = {}): CrewControlView | null {
  const x = ctxOf(g, flightId);
  if (!x) return null;
  const card = crewShortCard(g, flightId);
  const { f, ac, d, p } = x;
  const hoursLeft = Math.round(((f.std - g.now) / 60) * 10) / 10;
  const stage: CrewControlView['stage'] = !card ? 'ok' : f.std + f.delay <= g.now || f.crewHeld ? 'gate' : hoursLeft <= CC().redH ? 'red' : 'amber';
  const illegal: CrewControlView['illegal'] = [];
  if (d && p) {
    for (const b of crewIssuesFor(g, d)) {
      const c = g.crew[b.crewId];
      const r = c ? rootReason(g, [b.issue], c, p) : null;
      const role = p.slots.find((s) => s.crewId === b.crewId)?.role ?? c?.role ?? 'CC';
      if (c && r) illegal.push({ crewId: c.id, name: crewName(c), role, reason: r });
    }
  }
  const fallback: ProblemCard = card ?? {
    subject: { kind: 'crewShort', ref: { kind: 'flight', id: f.id } }, severity: 'amber', title: `${f.no} is crewed`, what: `${f.no} is crewed`, why: 'Nothing is missing.',
    hurt: mkHurt({}), actions: [], details: [], visuals: {}, terms: [], by: f.std,
  };
  return {
    flightId: f.id, no: f.no, from: f.from, to: f.to, std: f.std, aircraftId: ac.id, reg: ac.reg, stage, hoursLeft,
    missing: x.need, illegal, card: fallback, solutions: solutionsFor(g, x, opts.previews !== false),
    unit: { flightIds: x.unit.map((l) => l.id), pax: x.pax, revenueLegs: x.revLegs },
  };
}

/** Applies a Crew Control fix on the live state (availability re-checked; confirms honoured); one info message. */
export function applyCrewFix(g: GameState, flightId: string, fix: CrewFix, opts: ApplyOpts = {}): ActionResult<{ changes: string[]; after: CrewControlView | null }> {
  const view = crewControl(g, flightId, { previews: false });
  if (!view) return { ok: false, error: 'Flight not found or already left' };
  const s = view.solutions.find((y) => y.id === fix);
  if (!s) return { ok: false, error: 'Unknown fix' };
  if (!s.available) return { ok: false, error: s.why ?? 'Not available' };
  if (s.confirm && !opts.confirmed) return { ok: false, error: 'Needs confirmation' };
  const r = runFix(g, flightId, fix, opts);
  if (!r.ok) return r;
  const st = stats(g);
  st.crewFixes = { ...(st.crewFixes ?? {}), [fix]: ((st.crewFixes ?? {})[fix] ?? 0) + 1 };
  const f = g.flights[flightId];
  const cs = f && f.aircraftId && f.status === 'scheduled' ? flightCrewStatus(g, flightId) : null;
  const fixed = !cs || !BAD(cs.level);
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: `${view.no} ${fixed ? (fix === 'cancel' ? 'cancelled' : fix === 'subcharter' ? 'sub-chartered' : 'crewed') : 'still short'}: ${FIX_LABEL[fix]}`,
    body: r.changes.join('. ') + '.', ref: { kind: 'flight', id: flightId },
  });
  return { ok: true, msg: r.changes[0], data: { changes: r.changes, after: fixed ? null : crewControl(g, flightId) } };
}

// ---------- shared with ops (the gate decision) ----------

/** Legs this fix covers for ops' crew-short decision chips. */
export const tripPax = (ac: Aircraft, legs: Flight[]) => unitPax(ac, legs);
export { minRest };
