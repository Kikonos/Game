// v0.7.1 Crew Control (UPDATE-0.7.1.md §2–§4, §7): the crew-shortage ladder (amber ≤ 48 h, red ≤ 12 h + pause), the
// nine ranked solutions with previews computed on a copy of the state, private-jet positioning, the limit gauges
// and the crew-shortage ProblemCard. Read APIs are pure in g (previews clone it); actions go through the roster,
// flight and ledger helpers.

import { JET_CLASSES, JETS } from '../../data/jets';
import { BAL } from '../core/balance';
import { addDeadhead, flightsRev, liveFlightsOf, removeFlights, takeFlightChanges } from '../core/entities';
import { distance } from '../core/geo';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { canFill, isPilot, typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDuration, fmtTime } from '../core/time';
import type { ActionResult, Aircraft, CrewFix, CrewMember, Duty, Flight, GameState, JetClass, Legality, Minute, Pairing, Role } from '../core/types';
import { hashUnit } from '../core/util';
import { relinkPositioning } from '../contracts/schedule';
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
import { applyDiscretion, autoRoster, discretionMax, DISCRETION_BEFORE_REPORT, flightCrewStatus, onFlightsChanged, placeCrew, recheckPairing, releaseCrew, rerosterFrom, setShortHook, type FlightCrewStatus } from './roster';
import { assignCrew, dutyCandidates, type DutyCandidate } from './rosterActions';
import { DISCRETION, levelOf, LIMITS, minRest } from './rules';
import { cabinEarly, crewCount, crewRev, dhBlock, locAt, OUT_CONNECT, segsOf, touchCrew, typeIdOf, type TicketPlan } from './timeline';
import { callFromStandby, calledNow } from './standby';

export type { Reason, ReasonCode };
export { rootReason };

const CC = () => BAL.crewControl;
const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
/** Player words for a seat: singular, plural. */
export const ROLE_WORD: Record<Role, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'],
  PUR: ['purser', 'pursers'], CC: ['cabin crew', 'cabin crew'],
};
const at = (t: Minute, now: Minute) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? fmtTime(t) : fmtDateTime(t));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ceil5 = (t: Minute) => Math.ceil(t / 5) * 5;

// ---------- types (§3.1, §3.2) ----------

export interface SeatNeed { role: Role; n: number }

export interface FixPreview {
  /** What changes if applied: lines like 'Captain Silva takes the CPT seat (deadhead TP 1342 LIS–DUS, lands 07:10)'. */
  changes: string[];
  /** After the fix: the flight's crew status and what is still missing ('cancelled' / 'subchartered': it is no longer ours to crew). */
  after: { level: FlightCrewStatus['level'] | 'cancelled' | 'subchartered'; missing: SeatNeed[] };
  /** Knock-on: other flights that move or lose crew (`text` without the flight number: the panel adds it once). */
  ripple: { flightId: string; no: string; text: string; tone: 'warn' | 'bad' }[];
  /** Spend the re-roster around the fix caused on other trips (tickets), beyond the fix's own cost. */
  extraCost?: number;
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

export interface ApplyOpts {
  optionId?: string; crewIds?: string[]; confirmed?: boolean;
  /** Delay (and jet + rest): the departure the solution previewed; computed when absent. */
  at?: Minute;
}

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
  discretion: "After reporting, if something unforeseen happens, the captain may extend the crew's day: up to 2 h (3 h with an augmented crew).",
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

/** A positioning leg the planner left beside a crewed scheduled leg of the same aircraft and route (same half day): a phantom, not a shortage. */
function phantomLeg(f: Flight, legs: Flight[]): boolean {
  if (f.kind !== 'positioning') return false;
  return legs.some((y) => y !== f && y.status === 'scheduled' && y.kind !== 'positioning' && y.from === f.from && y.to === f.to && Math.abs(y.std - f.std) <= 4 * 60 && y.crewIds.length > 0);
}

/** Crew-short flights (missing or illegal crew) departing inside the amber window, soonest first. Pure. */
export function shortFlights(g: GameState): { flightId: string; stage: 'amber' | 'red'; hoursLeft: number }[] {
  const out: { flightId: string; stage: 'amber' | 'red'; hoursLeft: number; std: Minute }[] = [];
  const until = g.now + CC().amberH * 60;
  for (const id of Object.keys(g.fleet)) {
    const legs = liveFlightsOf(g, id);
    for (const f of legs) {
      if (f.status !== 'scheduled' || f.aircraftId !== id || f.std > until || f.std + f.delay < g.now - 6 * 60) continue;
      if (phantomLeg(f, legs)) continue;
      const cs = flightCrewStatus(g, f.id, { live: false });
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

let escalating = false;

export function escalateShortages(g: GameState, opts: { reroster?: boolean } = {}): void {
  if (previewing || escalating) return;
  escalating = true;
  try {
    escalate(g, opts.reroster === true);
  } finally {
    escalating = false;
  }
}

/** The roster for the flight's aircraft now: duties built for a leg that has none yet (a fresh empty leg), else the rolling re-plan. */
function planNow(g: GameState, f: Flight): void {
  if (!f.aircraftId) return;
  if (!f.dutyId) autoRoster(g, { aircraftIds: [f.aircraftId] });
  else rerosterFrom(g, f.aircraftId, g.now);
}

/**
 * Marks every open leg of the duty (and its pairing's other short duties) at once: the legs of one duty never re-warn.
 * A short sibling duty further out takes the stage it is at itself (amber beyond 12 h), so it still gets its own red
 * and pause at 12 h when it stays short after the first duty is fixed.
 */
function markDuty(g: GameState, f: Flight, mark: 'amber' | 'red'): void {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  const ids = p ? openDuties(g, p).flatMap((x) => x.flightIds) : d ? d.flightIds : [f.id];
  for (const id of ids) {
    const y = g.flights[id];
    if (!y || y.status !== 'scheduled') continue;
    if (y === f || flightCrewStatus(g, id).level === 'missing' || flightCrewStatus(g, id).level === 'illegal') {
      const own = mark === 'red' && y.dutyId !== f.dutyId && y.std - g.now > BAL.crewControl.redH * 60 ? 'amber' : mark;
      if (own === 'red' || !y.crewAlert) y.crewAlert = own;
    }
  }
}

function escalate(g: GameState, reroster: boolean): void {
  const amber: Flight[] = [];
  const red: Flight[] = [];
  // A shortage first seen now may only be a roster not yet run (a leg just planned or retimed): one re-roster of
  // the aircraft before any warning, so 'free but not placed' never stands. (Not after the roster's own run.)
  const fresh = new Set<string>();
  if (reroster) for (const x of shortFlights(g)) {
    const f = g.flights[x.flightId];
    if (!f.crewAlert && f.aircraftId && !fresh.has(f.aircraftId)) {
      fresh.add(f.aircraftId);
      planNow(g, f);
    }
  }
  for (const x of shortFlights(g)) {
    const f = g.flights[x.flightId];
    if (x.stage === 'red') {
      if (f.crewAlert !== 'red') {
        markDuty(g, f, 'red');
        red.push(f);
      }
    } else if (!f.crewAlert) {
      markDuty(g, f, 'amber');
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
  /** One red per aircraft and batch: the legs of one wave of trouble are one event. */
  const perAircraft = (fl: Flight[]) => {
    const seen = new Set<string>();
    return fl.filter((f) => {
      const k = f.aircraftId ?? f.id;
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
    const duties = perDuty(red);
    s.crewRed = (s.crewRed ?? 0) + duties.length;
    for (const f of perAircraft(duties)) {
      const card = crewShortCard(g, f.id);
      if (!card) continue;
      const h = Math.max(0, Math.round((f.std - g.now) / 60));
      const also = duties.filter((y) => y !== f && y.aircraftId === f.aircraftId).map((y) => y.no);
      pushMessage(g, {
        tone: 'bad', cat: 'crew', topic: 'crewRed', title: `CREW SHORTAGE: ${f.no} in ${h} h`,
        body: `${card.why} Hurts: ${card.hurt.text.replace(/^(Yes|Not much): /, '')}.${also.length ? ` Also ${also.slice(0, 3).join(', ')} on the same aircraft.` : ''} Open Crew Control to fix it.`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
    requestPause('crewShortage');
  }
}

setShortHook((g) => escalateShortages(g));

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
    } else why = `${f.no} has no crew plan yet: the roster plans ${BAL.rosterHorizonDays} days ahead; Auto-fix plans it now.`;
  } else if (!d || !p) {
    why = `${f.no} has no crew plan yet: the roster plans ${BAL.rosterHorizonDays} days ahead; Auto-fix plans it now.`;
    terms.push('standby');
  } else {
    const role = x.missing[0];
    const word = ROLE_WORD[role];
    const cands = candidatesOf(g, d, role).filter((c) => !c.onPairing);
    const rated = Object.values(g.crew).some((c) => canFill(role, c.role) && c.ratings.includes(fam));
    // Someone at the departure airport is never 'in the wrong place': their root cause is rest or another trip.
    const refused = cands.filter((c) => c.level === 'illegal' && c.reason && !(c.reason.code === 'place' && c.loc === x.dep));
    let cause: ReasonCode | null = null;
    for (const code of CAUSE_ORDER) if (refused.some((c) => c.reason!.code === code)) { cause = code; break; }
    let pick = cause ? refused.find((c) => c.reason!.code === cause)! : null;
    const plur = word[1];
    // v0.7.3 crew on home standby are the first call (no overtime), as the call-in fix picks them.
    const free = cands.find((c) => c.level !== 'illegal' && c.standby && !c.travel) ?? cands.find((c) => c.level !== 'illegal');
    // The place story is told by the one person who could land first (what the delay fix waits for).
    const same = cause === 'place' ? refused.filter((c) => c.reason!.code === 'place') : [];
    const reaches = new Map<string, ReachSpec>();
    if (cause === 'place') {
      for (const c of same.slice(0, 8)) reaches.set(c.crewId, reachFor(g, p, d, g.crew[c.crewId], f.std));
      same.sort((a, b) => (reaches.get(a.crewId)?.earliestArrival ?? Infinity) - (reaches.get(b.crewId)?.earliestArrival ?? Infinity) || (a.crewId < b.crewId ? -1 : 1));
      pick = same[0] ?? pick;
    }
    const cm = pick ? g.crew[pick.crewId] : undefined;
    const r = pick?.reason;
    if (free?.standby && !free.travel) {
      why = `${free.name} is on home standby at ${city(x.dep)} and can take the ${word[0]} seat: call them in (no overtime).`;
      terms.push('standby');
    } else if (free) {
      why = `${free.name} is free${free.loc !== x.dep ? ` in ${city(free.loc)}` : ` at ${city(x.dep)}`} and could take the ${word[0]} seat: the roster has not placed them yet.`;
      terms.push('standby');
    } else if (!cands.length || !cm || !r) {
      why = rated ? `No ${fam} ${plur} are free at all this week.` : `Nobody free holds the ${fam} rating.`;
      terms.push('standby');
    } else if (r.code === 'place') {
      const reach = reaches.get(cm.id) ?? reachFor(g, p, d, cm, f.std);
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
      visuals.gauges = crewGauges(g, cm.id, d.id);
      // The end of the rest from the reason, else from the rest gauge; the v0.7.3 rest rules say why in words.
      const gauge = visuals.gauges.find((x) => x.id === 'rest' && x.tone !== 'good');
      const until = r.until ?? gauge?.by;
      why = until !== undefined && until > d.report
        ? `${crewName(cm)} is the nearest free ${word[0]}, but their rest at ${city(pick!.loc)} ends at ${at(until, g.now)}, after the ${at(d.report, g.now)} report.`
        : `${crewName(cm)} is the nearest free ${word[0]}, but they ${/^finished\b/.test(r.text) ? '' : 'are '}${r.text}.`;
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
    for (const c of cands.slice(0, 8)) details.push(`${c.name} (${city(c.loc)}): ${c.reason?.text ?? (c.reasons.length ? c.reasons.join('; ') : c.level === 'tight' ? 'legal, close to a limit' : 'legal, free')}`);
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

/** The smallest class that seats the crew and covers the distance (with one fuel stop at most); a light jet only up to ~3 h. */
function jetClassFor(crewN: number, nm: number): JetClass {
  const J = CC().jet;
  for (const cls of JET_CLASSES) {
    if (cls === 'light' && (nm / J.cruiseKt.light) * 60 + J.taxiMin > 180) continue;
    if (crewN <= J.seats[cls] && nm <= J.rangeNm[cls] * 2) return cls;
  }
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

/** A jet ride as a ticket plan (check-in 30 min at the FBO, like a booked charter). */
const jetRide = (q: JetQuote, from: string, to: string): TicketPlan => ({ from, to, std: q.wheelsUp, sta: q.arrives, charter: { cls: q.cls, model: q.model, operator: q.operator, reg: q.reg } }) as TicketPlan;

/**
 * Crew who could take a `role` seat if a jet brought them (the airline reach ignored): legal with the ride in their
 * day (a ride landing inside minimum rest of the report counts as FDP), earliest ready first. `fdpOnly` is set when
 * someone was refused only because the ride makes the day too long. Pure.
 */
type JetCand = { c: CrewMember; loc: string; ready: Minute; level: Legality };

function jetCandidates(g: GameState, p: Pairing, d: Duty, role: Role, exclude: Set<string>, cls?: JetClass, fdpOnly?: { v: boolean }): JetCand[] {
  const all = memoOf(g, `jc:${d.id}:${role}:${cls ?? ''}`, () => jetCandidatesAll(g, p, d, role, cls));
  if (fdpOnly && all.fdpOnly) fdpOnly.v = true;
  return all.list.filter((x) => !exclude.has(x.c.id));
}

/** Crew a jet could bring who are legal only after a night's rest on arrival (the 'jet + rest' option). */
function jetRestCandidates(g: GameState, p: Pairing, d: Duty, role: Role, exclude: Set<string>): JetCand[] {
  return memoOf(g, `jc:${d.id}:${role}:`, () => jetCandidatesAll(g, p, d, role)).rested.filter((x) => !exclude.has(x.c.id));
}

function jetCandidatesAll(g: GameState, p: Pairing, d: Duty, role: Role, cls?: JetClass): { list: JetCand[]; rested: JetCand[]; fdpOnly: boolean } {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const fam = typeOf(typeIdOf(g, p)).family;
  const on = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const fdpOnly = { v: false };
  // The nearest-ready dozen are planned (one planCrew each); the rest could only be worse rides.
  const pool: { c: CrewMember; loc: string; ready: Minute; km: number; segs: ReturnType<typeof segsOf> }[] = [];
  for (const c of Object.values(g.crew)) {
    if (!canFill(role, c.role) || !c.ratings.includes(fam) || on.has(c.id)) continue;
    if (c.status === 'sick' || c.status === 'leave' || c.status === 'training' || c.status === 'joining') continue;
    const segs = segsOf(g, c, p.id);
    const loc = locAt(c, segs, d.report);
    if (loc === dep) continue;
    pool.push({ c, loc, ready: Math.max(g.now, readyAt(c, segs, d.report)), km: distance(loc, dep), segs });
  }
  pool.sort((a, b) => a.ready - b.ready || a.km - b.km || (a.c.role === role ? -1 : 1) || (a.c.id < b.c.id ? -1 : 1));
  const out: (JetCand & { km: number })[] = [];
  const rested: JetCand[] = [];
  for (const { c, loc, ready, km, segs } of pool.slice(0, 12)) {
    const q = jetQuote(g, loc, dep, 1, ready, cls);
    // A jet landing after the report delays the flight by the gap (runFix): the ride is judged against that later
    // report, i.e. shifted earlier by the gap for the check.
    const shift = Math.max(0, q.arrives + OUT_CONNECT - d.report);
    const ride = jetRide(q, loc, dep);
    const plan = planCrew(g, c, p, segs, false, 0, undefined, shift ? { ...ride, std: ride.std - shift, sta: ride.sta - shift } : ride);
    // The duty's own FDP problem is the duty's (crewIllegal), not the ride's.
    const issues = plan.issues.filter((i) => !(i.code === 'fdp' && d.legality === 'illegal'));
    const level = levelOf(issues);
    if (level === 'illegal') {
      if (issues.every((i) => i.level !== 'illegal' || i.code === 'fdp' || i.code === 'rest')) {
        fdpOnly.v = true;
        rested.push({ c, loc, ready, level: 'legal' });
      }
      continue;
    }
    out.push({ c, loc, ready, level, km });
  }
  return { list: out, rested, fdpOnly: fdpOnly.v };
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

/** Cancels the unit the flight starts (wave or trip) for want of crew: compensation, reliability −3 (revenue legs), one message unless `quiet`. */
export function cancelTrip(g: GameState, flightId: string, quiet = false): ActionResult<{ legs: number; empty: number; penalty: number }> {
  const x = ctxOf(g, flightId);
  if (!x) return { ok: false, error: 'Flight not found or already left' };
  const legs = x.unit.filter((l) => l.status === 'scheduled' && l.purpose !== 'delivery');
  const rev = legs.filter(isRevenue).length;
  const penalty = cancelLegs(g, legs, 'Crew shortage', rev ? CC().cancelRep : 0);
  if (!quiet) pushMessage(g, {
    tone: rev ? 'bad' : 'info', cat: 'crew', title: `${x.f.no} cancelled${legs.length > 1 ? ` with ${legs.length - 1} more` : ''}: crew shortage`,
    body: `${legs.map((l) => `${l.no} ${l.from}–${l.to}`).join(', ')} cancelled for want of a legal crew.${penalty ? ` Compensation ${usd(penalty)}.` : ''}`,
    ref: { kind: 'flight', id: x.f.id }, hurt: { money: penalty, pax: x.pax, delayMin: 0, level: penalty || x.pax ? 'high' : 'none' },
  });
  if (x.ac) rerosterFrom(g, x.ac.id, g.now);
  return { ok: true, msg: `${plural(rev, 'leg')} cancelled, ${usd(penalty)} compensation`, data: { legs: rev, empty: legs.length - rev, penalty } };
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

/** Per state revision and minute: candidate searches (dutyCandidates, jetCandidates) are pure, so repeats within a step are free. */
const memo = new WeakMap<GameState, { key: string; m: Map<string, unknown> }>();
function memoOf<T>(g: GameState, key: string, f: () => T): T {
  const rev = `${crewRev(g)}:${flightsRev(g)}:${g.now}`;
  let c = memo.get(g);
  if (!c || c.key !== rev) memo.set(g, (c = { key: rev, m: new Map() }));
  if (c.m.has(key)) return c.m.get(key) as T;
  const v = f();
  c.m.set(key, v);
  return v;
}
const candidatesOf = (g: GameState, d: Duty, role: Role) => memoOf(g, `dc:${d.id}:${role}`, () => dutyCandidates(g, d.id, role));

/** Candidates for a missing seat: legal after their trip, not on the pairing; `here`: at the airport (call-in) or not (deadhead). */
function seatCandidates(g: GameState, d: Duty, role: Role, here: boolean): DutyCandidate[] {
  const list = candidatesOf(g, d, role).filter((c) => !c.onPairing && c.level !== 'illegal' && (here ? !c.travel : !!c.travel));
  // v0.7.3 a call-in takes crew on home standby first (no overtime, no morale hit).
  return here ? [...list.filter((c) => c.standby), ...list.filter((c) => !c.standby)] : list;
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

/** Delays f until `ready` as the player would (lateness accepted), ripples the later legs and re-syncs the duties now (the settle would, later). */
function delayTo(h: GameState, f: Flight, ready: Minute): void {
  f.lateOk = Math.max(f.lateOk ?? 0, ready - (f.schedStd ?? f.std));
  delayChain(h, f, ready, 'Waiting for crew', false);
  for (const [id, t] of takeFlightChanges(h)) onFlightsChanged(h, id, t);
}

/** Delays f to `at` and re-runs the roster: true when the flight is then crewed (used on copies to test a time). */
function tryDelay(h: GameState, flightId: string, at: Minute): boolean {
  const f = h.flights[flightId];
  const ac = f?.aircraftId ? h.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return false;
  delayTo(h, f, at);
  rerosterFrom(h, ac.id, h.now);
  // An empty leg delayed past the commitment it leads to is re-planned by the schedule (a fresh, uncrewed leg at
  // the old time): that delay is no fix. The re-plan runs now so the answer is known before the player taps.
  if (f.kind === 'positioning') relinkPositioning(h, ac.id);
  const hf = h.flights[flightId];
  if (!hf || hf.status !== 'scheduled') return false;
  return !BAD(flightCrewStatus(h, flightId).level);
}

/**
 * Departures worth trying for 'delay', soonest first, within two days: crewReadyAt, and from the roster's own
 * refusals: a candidate's ticket arrival, the end of a rest or of another trip (plus a night's rest), the
 * nearest person's earliest landing, each with the connection and the report lead; and the same after a night's
 * rest on arrival (fly in the day before). Pure.
 */
function delayTimes(g: GameState, x: Ctx): Minute[] {
  const { f, ac, d, p } = x;
  const lead = d ? Math.max(0, f.std - d.report) : 0;
  const floor = f.std + f.delay;
  const times = new Set<Minute>();
  const add = (t: Minute) => {
    t = ceil5(t);
    if (t > floor && t - g.now <= 2 * DAY) times.add(t);
  };
  add(crewReadyAt(g, f, ac));
  if (d && p) {
    const night = (atHome: boolean) => minRest({ dutyMin: 0, atHome, augmented: false, tzShift: 0 });
    for (const role of new Set(x.missing)) {
      for (const c of candidatesOf(g, d, role).slice(0, 12)) {
        if (c.onPairing) continue;
        const cm = g.crew[c.crewId];
        if (!cm) continue;
        if (c.arrives !== undefined) add(c.arrives + OUT_CONNECT + lead);
        const r = c.reason;
        if (r?.until !== undefined) add(r.until + (r.code === 'busy' ? night(c.loc === cm.base) : 0) + lead);
        if (r?.code === 'place' && c.loc !== x.dep) {
          const reach = reachFor(g, p, d, cm, f.std);
          add(reach.earliestArrival + OUT_CONNECT + lead);
          add(reach.earliestArrival + night(false) + lead);
        }
        if (r?.code === 'fdp' || r?.code === 'rest') add(Math.max(g.now, cm.restUntil, c.arrives ?? 0) + night(c.loc === cm.base) + lead);
      }
    }
  }
  return [...times].sort((a, b) => a - b).slice(0, 6);
}

/** The soonest of delayTimes at which the roster crews the flight, tried on copies; null when none works. Memoized per step. */
function delayPlan(g: GameState, x: Ctx): { at: Minute } | null {
  return memoOf(g, `dp:${x.f.id}`, () => {
    for (const at of delayTimes(g, x)) {
      const h = structuredClone(g);
      previewing++;
      let ok = false;
      try {
        ok = tryDelay(h, x.f.id, at);
      } catch {
        ok = false;
      } finally {
        previewing--;
      }
      if (ok) return { at };
    }
    return null;
  });
}

/** Tickets bought for `crewId` on the pairing's duties that did not exist before (their cost). */
function ticketsBought(h: GameState, p: Pairing, crewId: string, had: Set<string>): number {
  let s = 0;
  for (const did of p.dutyIds) {
    const d = h.duties[did];
    if (!d) continue;
    for (const fid of d.deadheadIds) {
      const t = h.flights[fid];
      if (t && !had.has(fid) && t.crewIds.includes(crewId)) s += t.cost ?? 0;
    }
  }
  return s;
}

/** Runs a fix on state h (the live game or a preview copy). */
function runFix(h: GameState, flightId: string, fix: CrewFix, opts: ApplyOpts): Run {
  const x = ctxOf(h, flightId);
  if (!x) return { ok: false, error: 'Flight not found or already left' };
  const { f, ac, d, p } = x;
  const before = heldBy(p);
  switch (fix) {
    case 'autoFix': {
      planNow(h, f);
      const changes = seatChanges(h, f, before).filter((c) => !/still missing$/.test(c));
      if (!changes.length) return { ok: false, error: 'Nobody legal is free: see the other fixes' };
      return { ok: true, changes: [...changes, ...seatChanges(h, f, before).filter((c) => /still missing$/.test(c))], cost: 0 };
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
      const had = new Set(Object.values(h.flights).filter((t) => t.kind === 'deadhead').map((t) => t.id));
      for (const { role, crewId } of picks) {
        const r = assignCrew(h, f.id, crewId, role);
        if (!r.ok) continue;
        const c = h.crew[crewId];
        // (placing them may already have called them out: the roster counts a placement inside a running window)
        if (fix === 'callIn' && (callFromStandby(h, crewId) || calledNow(h, crewId))) {
          const nd = h.duties[d.id] ?? d;
          const seg = segsOf(h, c).find((x) => x.dutyId === nd.id && x.kind === 'duty');
          const until = seg ? seg.start + seg.maxFdp : nd.report + nd.maxFdp;
          const cut = seg && seg.maxFdp < nd.maxFdp + (nd.discretion ?? 0) + (c.role === 'PUR' || c.role === 'CC' ? cabinEarly(h, h.pairings[nd.pairingId] ?? p!, nd) : 0);
          changes.push(`${role === 'CPT' ? 'Capt. ' : ''}${crewName(c)} called from home standby: no overtime; their day may run to ${fmtTime(until)} UTC${cut ? ' (standby beyond 6 h shortens it)' : ''}`);
        } else if (fix === 'callIn') {
          const ot = overtimeOf(c);
          post(h, 'salaries', -ot);
          moraleShock(h, c, 'pay', CC().callInMorale);
          cost += ot;
          changes.push(`${crewName(c)} called in for the ${ROLE_WORD[role][0]} seat (${usd(ot)} overtime, morale ${CC().callInMorale})`);
        } else {
          changes.push(`${crewName(c)} takes the ${ROLE_WORD[role][0]} seat${rideText(h, h.duties[d.id] ?? d, crewId)}`);
          if (h.pairings[p!.id]) cost += ticketsBought(h, h.pairings[p!.id], crewId, had);
        }
      }
      if (!changes.length) return { ok: false, error: 'The roster refused every candidate' };
      const still = h.pairings[p!.id] ? group(h.pairings[p!.id].slots.filter((s) => !s.crewId && !s.above).map((s) => s.role)) : [];
      if (still.length) changes.push(`${seatsText(still)} still missing`);
      return { ok: true, changes, cost };
    }
    case 'delay': {
      // The departure comes from the roster's own answer (delayPlan tried it on copies); never a guess that
      // leaves the seats empty.
      const at0 = opts.at ?? delayPlan(h, x)?.at;
      if (at0 === undefined) return { ok: false, error: !delayTimes(h, x).length && crewReadyAt(h, f, ac) <= f.std + f.delay ? 'A crew can take it on time: use Auto-fix' : 'Nobody can take it even two days later' };
      if (at0 <= f.std + f.delay) return { ok: false, error: 'A crew can take it on time: use Auto-fix' };
      if (at0 - h.now > 2 * DAY) return { ok: false, error: 'No legal crew within two days' };
      const was = f.std;
      if (!tryDelay(h, f.id, at0)) {
        const hf = h.flights[f.id];
        if (!hf || hf.status !== 'scheduled') return { ok: false, error: f.kind === 'positioning' ? 'The schedule re-plans empty legs itself: this one waits for a crew at the gate' : 'The flight would be dropped by the delay' };
        return { ok: false, error: 'Nobody can take it even later: see the other fixes' };
      }
      const changes = [`${f.no} leaves ${at(f.std, h.now)} UTC (+${fmtDuration(f.std - was)})`, ...seatChanges(h, f, before)];
      return { ok: true, changes, cost: 0 };
    }
    case 'jet': {
      if (!d || !p) return { ok: false, error: 'No crew plan for this flight yet' };
      const cls = (opts.optionId && JET_CLASSES.includes(opts.optionId as JetClass) ? opts.optionId : undefined) as JetClass | undefined;
      const used = new Set<string>();
      const picks: { c: CrewMember; ready: Minute; loc: string }[] = [];
      for (const role of x.missing) {
        const list = jetCandidates(h, p, d, role, used, cls);
        const pick = opts.crewIds ? list.find((y) => opts.crewIds!.includes(y.c.id)) : list[0];
        if (!pick) continue;
        used.add(pick.c.id);
        picks.push({ c: pick.c, ready: pick.ready, loc: pick.loc });
      }
      // Jet + rest (opts.at): the crew land, rest a night and take the flight the next day.
      if (!picks.length && opts.at !== undefined) {
        for (const role of x.missing) {
          const pick = jetRestCandidates(h, p, d, role, used)[0];
          if (!pick) continue;
          used.add(pick.c.id);
          picks.push({ c: pick.c, ready: pick.ready, loc: pick.loc });
        }
      }
      if (!picks.length) return { ok: false, error: 'Nobody legal is free anywhere' };
      // Even a jet may land after the report: the flight is delayed first by the gap.
      let latest = 0;
      const byLoc = new Map<string, { n: number; ready: Minute }>();
      for (const y of picks) byLoc.set(y.loc, { n: (byLoc.get(y.loc)?.n ?? 0) + 1, ready: Math.max(byLoc.get(y.loc)?.ready ?? 0, y.ready) });
      for (const [loc, v] of byLoc) latest = Math.max(latest, jetQuote(h, loc, x.dep, v.n, v.ready, cls).arrives);
      const changes: string[] = [];
      const gap = Math.max(latest + OUT_CONNECT - d.report, opts.at !== undefined ? opts.at - f.std : 0);
      if (gap > 0) {
        // The flight waits for the jet with the roster held off: the jet's crew take the seats, not an airline
        // ticket the re-sync would buy meanwhile (a jet fix charters a jet, or is refused).
        const was = f.std;
        const auto = h.company.policies.autoRoster;
        h.company.policies.autoRoster = false;
        try {
          delayTo(h, f, ceil5(f.std + gap));
        } finally {
          h.company.policies.autoRoster = auto;
        }
        changes.push(`${f.no} leaves ${at(f.std, h.now)} UTC (+${fmtDuration(f.std - was)}) so the jet can land first`);
        if (h.flights[f.id]?.status !== 'scheduled') return { ok: false, error: 'The flight would be dropped by the delay' };
      }
      const r = charterJet(h, f.id, picks.map((y) => y.c.id).filter((id) => !heldBy(ctxOf(h, flightId)?.p).has(id)), cls ?? jetClassFor(picks.length, distance(picks[0].loc, x.dep) / NM));
      if (!r.ok) return { ok: false, error: r.error === 'Nobody could be seated on the trip' ? 'Even flown in by jet, nobody is legal for the trip' : r.error };
      // Seats the jet did not cover go to the roster as usual.
      if (gap > 0 && ctxOf(h, flightId)?.missing.length) rerosterFrom(h, ac.id, h.now);
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
      if (!ids.includes(f.id)) return { ok: false, error: 'Too close to departure for a rival to position' };
      const q = subcharterQuote(h, ids);
      if (!q) return { ok: false, error: 'No rival can take it (too close to departure, or no revenue legs)' };
      const r = subcharter(h, ids, q.cost);
      if (!r.ok) return r;
      return { ok: true, changes: [`${q.rivalName} flies ${plural(r.data!.legs, 'leg')} for ${usd(q.cost)}; we still bill ${usd(q.revenue)}`], cost: q.cost };
    }
    case 'cancel': {
      const r = cancelTrip(h, f.id, true);
      if (!r.ok) return r;
      const { legs, empty, penalty } = r.data!;
      const what = [legs ? plural(legs, 'revenue leg') : '', empty ? plural(empty, 'empty leg') : ''].filter(Boolean).join(' and ');
      return { ok: true, changes: [`${what} cancelled, ${usd(penalty)} compensation${legs ? ', reliability −3' : ''}`], cost: penalty };
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

const BAD = (l: FixPreview['after']['level']) => l === 'missing' || l === 'illegal';

function rippleOf(h: GameState, before: Snap, unit: Set<string>): FixPreview['ripple'] {
  const out: FixPreview['ripple'] = [];
  for (const [id, b] of before) {
    const f = h.flights[id];
    if (!f || f.status === 'cancelled') {
      if (!f || isRevenue(f)) out.push({ flightId: id, no: b.no, text: 'cancelled', tone: 'bad' });
      continue;
    }
    if (f.aircraftId === null && f.operatedBy) continue;
    if (unit.has(id)) continue;
    if (f.std !== b.std) out.push({ flightId: id, no: b.no, text: `moves ${f.std > b.std ? '+' : '−'}${fmtDuration(Math.abs(f.std - b.std))}`, tone: 'warn' });
    const cs = flightCrewStatus(h, id);
    if (BAD(cs.level) && !BAD(b.level)) out.push({ flightId: id, no: b.no, text: `then needs ${seatsText(group(cs.missing)) || 'a legal crew'}`, tone: 'bad' });
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
  const cs: { level: FixPreview['after']['level']; missing: Role[] } = hf && hf.aircraftId && hf.status === 'scheduled'
    ? flightCrewStatus(h, x.f.id)
    : { level: fix === 'subcharter' || hf?.operatedBy ? 'subchartered' : !hf || hf.status === 'cancelled' ? 'cancelled' : 'ok', missing: [] };
  // The fix's own cost; what the re-roster spent on other trips meanwhile is shown apart.
  const extra = Math.max(0, ledgerDiff(g, h) - r.cost);
  return {
    ok: true, cost: r.cost, newStd: hf && hf.status === 'scheduled' && hf.std !== x.f.std ? hf.std : null,
    preview: { changes: r.changes, after: { level: cs.level, missing: group(cs.missing) }, ripple: rippleOf(h, before, unit), ...(extra ? { extraCost: extra } : {}) },
  };
}

// ---------- the view (§3.1) ----------

const empty = (x: Ctx): FixPreview => ({ changes: [], after: { level: x.cs.level, missing: x.need }, ripple: [] });

/** The nine solutions (available first, ranked) for the flight; `previews` false skips the copies (availability only). */
function solutionsFor(g: GameState, x: Ctx, previews: boolean, only?: readonly CrewFix[]): CrewSolution[] {
  const { f, ac, d, p } = x;
  // v0.7.3 only the fixes asked for (applyCrewFix, the bot's ladder): the delay and jet searches run copies of the state.
  const want = (id: CrewFix) => !only || only.includes(id);
  const before = previews ? snapshot(g) : new Map();
  const out: CrewSolution[] = [];
  const base = (id: CrewFix): CrewSolution => ({ id, label: FIX_LABEL[id], desc: FIX_DESC[id], available: true, cost: 0, newDeparture: null, chips: [], consequences: [], rank: 0, confirm: false, preview: empty(x) });
  const no = (s: CrewSolution, why: string): CrewSolution => ({ ...s, available: false, why });
  const run = (s: CrewSolution, opts: ApplyOpts = {}): CrewSolution => {
    if (!previews) return s;
    const r = previewOf(g, x, s.id, opts, before);
    if (!r.ok) return no({ ...s, cost: 0, chips: [], newDeparture: null, consequences: [], options: s.options?.length ? s.options : undefined }, r.error ?? 'Not possible now');
    // The chip shows what the fix itself costs (the preview's number); ripple spend is its own line.
    const cost = r.cost || s.cost;
    const chips = s.chips.filter((c) => !c.startsWith('$'));
    if (cost) chips.unshift(usd(cost));
    const consequences = [...s.consequences];
    if (r.preview.extraCost) consequences.push(`+${usd(r.preview.extraCost)} tickets for other trips`);
    return { ...s, cost, preview: r.preview, newDeparture: s.newDeparture ?? r.newStd, consequences: consequences.slice(0, 4), chips };
  };
  const hrs = (t: Minute) => `lands ${at(t, g.now)}`;
  // a. auto-fix (a run that changes nothing is refused by runFix, so the preview marks it unavailable).
  if (want('autoFix')) out.push(run(base('autoFix')));
  // b. deadhead and e. call-in
  for (const id of ['deadhead', 'callIn'] as const) {
    if (!want(id)) continue;
    const s = base(id);
    if (!d || !x.missing.length) {
      out.push(no(s, x.missing.length ? 'No crew plan for this flight yet' : 'Every seat is taken'));
      continue;
    }
    const options: FixOption[] = [];
    for (const role of new Set(x.missing)) {
      for (const c of seatCandidates(g, d, role, id === 'callIn').slice(0, 6)) {
        const cm = g.crew[c.crewId];
        const sby = id === 'callIn' && c.standby;
        const ot = id === 'callIn' && !sby ? overtimeOf(cm) : 0;
        options.push({
          id: c.crewId, label: `${c.name} · ${c.loc}${sby ? ` · On home standby since ${fmtTime(c.standby!.from, g.company.homeBase)} ${g.company.homeBase}` : id === 'callIn' ? ' · Day off: called in' : ''}`,
          sub: sby ? 'No overtime · standby beyond 6 h shortens the day' : id === 'callIn' ? `${usd(ot)} overtime · morale ${CC().callInMorale}` : `${c.travel ?? ''} · ${c.level === 'tight' ? 'tight after' : 'legal after'}`,
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
    if (id === 'callIn' && !first.cost) s.desc = 'Crew on home standby come in: no overtime; standby beyond 6 h shortens their day.';
    s.chips = id === 'callIn' ? (first.cost ? [usd(first.cost), `Morale ${CC().callInMorale}`] : ['No overtime', 'Home standby']) : [usd(first.cost), first.arrives !== undefined ? hrs(first.arrives) : ''].filter(Boolean);
    out.push(run(s));
  }
  // c. delay: the departure the roster itself accepts (tried on copies), never a guess.
  if (want('delay')) {
    const s = base('delay');
    const plan = delayPlan(g, x);
    if (!plan) out.push(no(s, !delayTimes(g, x).length && crewReadyAt(g, f, ac) <= f.std + f.delay ? 'A crew can take it on time: use Auto-fix' : f.kind === 'positioning' ? 'The schedule re-plans empty legs itself: this one waits for a crew at the gate' : 'Nobody can take it even two days later'));
    else {
      const ready = plan.at;
      const k = contractOf(g, f);
      const late = ready - (f.schedStd ?? f.std);
      s.newDeparture = ready;
      s.cost = k?.product.kind === 'charter' && late > 180 ? k.penalties.perDelay : 0;
      s.chips = [`leaves ${at(ready, g.now)} (+${fmtDuration(ready - f.std)})`];
      s.confirm = true;
      out.push(run(s, { at: ready }));
    }
  }
  // d. jet: only for seats nobody at the departure airport can fill; with a night's rest on arrival when the
  // day would otherwise run too long (jet + rest).
  if (want('jet')) {
    const s = base('jet');
    if (!d || !p || !x.missing.length) out.push(no(s, x.missing.length ? 'No crew plan for this flight yet' : 'Every seat is taken'));
    else {
      const local = new Map<Role, DutyCandidate[]>();
      for (const role of new Set(x.missing)) local.set(role, seatCandidates(g, d, role, true));
      const localPicks = pickCrew(x, local);
      // Seats left after everyone free at the airport is seated: those a jet is quoted for.
      const need = new Map<Role, number>();
      for (const role of x.missing) need.set(role, (need.get(role) ?? 0) + 1);
      for (const y of localPicks) need.set(y.role, (need.get(y.role) ?? 0) - 1);
      const roles = x.missing.filter((role) => {
        const n = need.get(role) ?? 0;
        if (n <= 0) return false;
        need.set(role, n - 1);
        return true;
      });
      const used = new Set<string>();
      const picks: { c: CrewMember; ready: Minute; loc: string }[] = [];
      const fdpOnly = { v: false };
      let rest = false;
      for (const role of roles) {
        const pick = jetCandidates(g, p, d, role, used, undefined, fdpOnly)[0];
        if (!pick) continue;
        used.add(pick.c.id);
        picks.push(pick);
      }
      if (!picks.length && roles.length && fdpOnly.v) {
        // Jet + rest: the nearest rested-on-arrival crew; the flight leaves after their night's rest.
        for (const role of roles) {
          const pick = jetRestCandidates(g, p, d, role, used)[0];
          if (!pick) continue;
          used.add(pick.c.id);
          picks.push(pick);
        }
        rest = picks.length > 0;
      }
      if (!roles.length) {
        const names = localPicks.map((y) => crewName(g.crew[y.crewId])).join(' and ');
        out.push(no(s, `${names} ${localPicks.length === 1 ? 'is' : 'are'} already at ${city(x.dep)}: use Auto-fix or Call in`));
      } else if (!picks.length) {
        const fam = typeOf(ac.typeId).family;
        const freeRated = Object.values(g.crew).filter((c) => c.ratings.includes(fam) && roles.some((r) => canFill(r, c.role)) && c.status !== 'sick' && c.status !== 'leave' && c.status !== 'training' && c.status !== 'joining' && !p.slots.some((y) => y.crewId === c.id));
        const why = fdpOnly.v ? "Even by jet the crew's day would be too long: delay the flight instead"
          : !freeRated.length ? `Nobody rated on the ${fam} is free`
          : freeRated.every((c) => c.loc === x.dep) ? `Everyone free is already at ${city(x.dep)}: use Auto-fix or Call in`
          : 'Everyone free is on another trip or over a limit: a jet would not help';
        out.push(no(s, why));
      } else {
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
        const lead = Math.max(0, f.std - d.report);
        let gap = auto.arrives + OUT_CONNECT - d.report;
        if (rest) gap = Math.max(gap, auto.arrives + minRest({ dutyMin: 0, atHome: false, augmented: false, tzShift: 0 }) + lead - f.std);
        s.chips = [usd(auto.cost), hrs(auto.arrives)];
        if (auto.jets > 1) s.chips.push(`${auto.jets} jets`);
        s.consequences.push(`${picks.map((y) => crewName(y.c)).join(', ')} from ${[...byLoc.keys()].map(city).join(' and ')}`, 'Not billed to the client');
        if (gap > 0) {
          s.newDeparture = ceil5(f.std + gap);
          s.chips.push(`leaves ${at(s.newDeparture, g.now)} (+${fmtDuration(gap)})`);
          s.consequences.unshift(rest ? `The crew rest a night after landing: the flight leaves ${at(s.newDeparture, g.now)}` : `Even a jet lands ${fmtDuration(gap)} late: the flight is delayed first`);
        }
        s.confirm = true;
        // Jet + rest only when the airline ticket with the same night's rest would leave later (else that is Delay).
        const dp = rest ? delayPlan(g, x) : null;
        if (rest && dp && dp.at <= s.newDeparture!) out.push(no({ ...s, cost: 0, chips: [], newDeparture: null, consequences: [] }, 'An airline ticket and a night\'s rest get a crew there just as soon: use Delay until crew arrives'));
        else out.push(run(s, rest ? { at: s.newDeparture! } : {}));
      }
    }
  }
  // f. discretion
  if (want('discretion')) {
    const s = base('discretion');
    const over = d ? d.fdp - d.maxFdp - (d.discretion ?? 0) : 0;
    if (!d) out.push(no(s, 'No duty'));
    else if (x.missing.length) out.push(no(s, 'Seats are empty: discretion does not crew a flight'));
    else if (d.report > g.now) out.push(no(s, DISCRETION_BEFORE_REPORT));
    else if (d.discretion) out.push(no(s, 'Already used on this duty'));
    else if (over <= 0) out.push(no(s, 'The duty is not over its limit'));
    else if (over > discretionMax(g, d)) out.push(no(s, `Over by ${fmtDuration(over)}: more than discretion allows${d.augment > 0 && discretionMax(g, d) < DISCRETION.augmented ? " (the cabin crew's rest allows no longer day)" : ''}`));
    else {
      s.chips = ['Free', `FDP +${fmtDuration(over)}`, 'Morale −3 each', 'Fatigue +10'];
      out.push(run(s));
    }
  }
  // g. swap
  if (want('swap')) {
    const s = base('swap');
    const sources = d && p ? swapSources(g, x) : [];
    if (!sources.length) out.push(no(s, 'No other crew within two days can take it'));
    else {
      s.options = sources.slice(0, 6).map((q) => ({ id: q.p.id, label: `${q.first?.no ?? 'Trip'} ${q.first?.from ?? ''}–${q.first?.to ?? ''} crew`, sub: `reports ${fmtDateTime(openDuties(g, q.p)[0].report)} UTC${q.legal === 'tight' ? ' · tight after' : ''}`, cost: 0, level: q.legal }));
      s.confirm = true;
      const r = run(s);
      // What the other flight then needs comes from the preview (it may stay crewed after its own re-roster).
      const then = r.preview.changes.find((c) => / then needs | is still crewed$/.test(c));
      if (then) r.consequences = [then, ...r.consequences].slice(0, 4);
      else if (!previews) r.consequences = [`${sources[0].first?.no ?? 'That flight'} may then need a crew`, ...r.consequences];
      out.push(r);
    }
  }
  // h. sub-charter
  if (want('subcharter')) {
    const s = base('subcharter');
    const rot = rotationOf(g, f.id).map((l) => l.id);
    const q = rot.includes(f.id) ? subcharterQuote(g, rot) : null;
    if (!q) out.push(no(s, x.revLegs ? 'Too close to departure for a rival to position' : 'No revenue legs to hand over'));
    else {
      s.cost = q.cost;
      s.chips = [usd(q.cost), `Hurts: ${q.hit.text}`, `we still bill ${usd(q.revenue)}`, q.rivalName];
      s.consequences.push(`${q.rivalName} flies ${plural(q.revenueLegs, 'leg')}; ${q.hit.text.replace(' · ', ', ')}`);
      out.push(run(s));
    }
  }
  // i. cancel
  if (want('cancel')) {
    const s = base('cancel');
    const live = x.unit.filter((l) => l.status === 'scheduled' && l.purpose !== 'delivery');
    if (!live.length) out.push(no(s, 'Nothing to cancel'));
    else {
      s.cost = cancelCost(g, live);
      const rev = live.filter(isRevenue).length;
      s.chips = [usd(s.cost), `${rev ? 'Reliability −3' : 'No client'}`, rev ? plural(rev, 'revenue leg') : plural(live.length, 'empty leg')];
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
    return bad + s.cost + (s.preview.extraCost ?? 0) + late + rip + (s.id === 'cancel' ? x.pax * 500 : 0);
  };
  const ranked = [...out].sort((a, b) => Number(b.available) - Number(a.available) || score(a) - score(b) || FIX_ORDER.indexOf(a.id) - FIX_ORDER.indexOf(b.id));
  ranked.forEach((s, i) => (s.rank = i + 1));
  return ranked;
}

/** Crew Control for a flight: missing seats, the card and the nine ranked solutions with previews (v0.7.3 `only`: just those fixes). Pure in g. */
export function crewControl(g: GameState, flightId: string, opts: { previews?: boolean; only?: readonly CrewFix[] } = {}): CrewControlView | null {
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
    missing: x.need, illegal, card: fallback, solutions: solutionsFor(g, x, opts.previews !== false, opts.only),
    unit: { flightIds: x.unit.map((l) => l.id), pax: x.pax, revenueLegs: x.revLegs },
  };
}

/** Applies a Crew Control fix on the live state (availability re-checked; confirms honoured); one info message. */
export function applyCrewFix(g: GameState, flightId: string, fix: CrewFix, opts: ApplyOpts = {}): ActionResult<{ changes: string[]; after: CrewControlView | null }> {
  const view = crewControl(g, flightId, { previews: false, only: [fix] });
  if (!view) return { ok: false, error: 'Flight not found or already left' };
  const s = view.solutions.find((y) => y.id === fix);
  if (!s) return { ok: false, error: 'Unknown fix' };
  if (!s.available) return { ok: false, error: s.why ?? 'Not available' };
  if (s.confirm && !opts.confirmed) return { ok: false, error: 'Needs confirmation' };
  // The departure the row previewed (delay, jet + rest) is the one applied.
  const r = runFix(g, flightId, fix, (fix === 'delay' || fix === 'jet') && opts.at === undefined && s.newDeparture ? { ...opts, at: s.newDeparture } : opts);
  if (!r.ok) return r;
  const st = stats(g);
  st.crewFixes = { ...(st.crewFixes ?? {}), [fix]: ((st.crewFixes ?? {})[fix] ?? 0) + 1 };
  const f = g.flights[flightId];
  const cs = f && f.aircraftId && f.status === 'scheduled' ? flightCrewStatus(g, flightId) : null;
  const fixed = !cs || !BAD(cs.level);
  // One message per event: a cancellation posts its own (with the hurt) from here.
  if (fix === 'cancel') {
    const unit = view.unit.flightIds.map((id) => g.flights[id]).filter((l): l is Flight => !!l && l.status === 'cancelled');
    pushMessage(g, {
      tone: view.unit.revenueLegs ? 'bad' : 'info', cat: 'crew', title: `${view.no} cancelled${unit.length > 1 ? ` with ${unit.length - 1} more` : ''}: crew shortage`,
      body: `${unit.map((l) => `${l.no} ${l.from}–${l.to}`).join(', ')} cancelled for want of a legal crew. ${r.changes.join('. ')}.`,
      ref: { kind: 'flight', id: flightId }, hurt: { money: r.cost, pax: view.unit.pax, delayMin: 0, level: r.cost || view.unit.pax ? 'high' : 'none' },
    });
  } else pushMessage(g, {
    tone: 'info', cat: 'crew', title: `${view.no} ${fixed ? (fix === 'subcharter' ? 'sub-chartered' : 'crewed') : 'still short'}: ${FIX_LABEL[fix]}`,
    body: r.changes.join('. ') + '.', ref: { kind: 'flight', id: flightId },
  });
  // `after` without previews (cheap): the panel re-reads crewControl for the next round anyway.
  return { ok: true, msg: r.changes[0], data: { changes: r.changes, after: fixed ? null : crewControl(g, flightId, { previews: false }) } };
}

// ---------- shared with ops (the gate decision) ----------

/** Legs this fix covers for ops' crew-short decision chips. */
export const tripPax = (ac: Aircraft, legs: Flight[]) => unitPax(ac, legs);
export { minRest };
