// v0.7.1 Crew Control (UPDATE-0.7.1.md §2–§4, §7): the crew-shortage ladder (amber ≤ 48 h, red ≤ 12 h + pause), the
// nine ranked solutions with previews computed on a copy of the state, private-jet positioning, the limit gauges
// and the crew-shortage ProblemCard. Read APIs are pure in g (previews clone it); actions go through the roster,
// flight and ledger helpers.

import { JET_BASES, JET_CLASS_LABEL, JET_CLASSES, JETS } from '../../data/jets';
import { BAL } from '../core/balance';
import { addDeadhead, flightsRev, liveFlightsOf, removeFlights, takeFlightChanges } from '../core/entities';
import { distance } from '../core/geo';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { isolatePauses, requestPause } from '../core/pause';
import { canFill, isPilot, typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../core/time';
import type { ActionResult, Aircraft, CrewFix, CrewMember, Duty, Flight, GameState, JetClass, Legality, Minute, Pairing, Role, StandbyKind } from '../core/types';
import { hashUnit } from '../core/util';
import { relinkPositioning } from '../contracts/schedule';
import { commercialItinerary, itinerary, itineraryText } from '../ops/commercial';
import { crewReadyAt } from '../ops/events';
import { cancelCost, cancelLegs, clearRestMarks, delayChain, liveOver, unitOf } from '../ops/flights';
import { rotationOf, subcharter, subcharterQuote } from '../ops/subcharter';
import { contractOf, isRevenue, stats, usd } from '../ops/util';
import { hurtProse, mkHurt, type GaugeSpec, type ProblemCard, type ReachSpec, hm, limitTone } from '../problems/types';
import { crewIssuesFor, openDuties, planCrew, readyAt } from './check';
import { crewWindows } from './ftl';
import { crewName } from './generate';
import { moraleShock } from './morale';
import { city, rootReason, type Reason, type ReasonCode } from './reasons';
import { applyDiscretion, autoRoster, discretionCheck, flightCrewStatus, onFlightsChanged, placeCrew, recheckPairing, releaseCrew, rerosterFrom, setShortHook, type FlightCrewStatus } from './roster';
import { assignCrew, dutyCandidates, freshReport, type DutyCandidate } from './rosterActions';
import { levelOf, LIMITS, minRest, offsetAt } from './rules';
import { cabinEarly, crewCount, crewIx, crewRev, dhBlock, fdpLimitAt, locAt, OUT_CONNECT, posSeg, segsOf, touchCrew, typeIdOf, type TicketPlan } from './timeline';
import { callFromStandby, calledNow, reserveContact } from './standby';
import { SBY_LABEL } from './calendar';
import { dayLabel, offDaysHit, takesPublishedOff, v09Stats } from './dayPlan';
import { boughtNow, buyBackFor, buyBackMode, repayText, type BuyBack } from './buyBack';
import { crewAlertKind, LIMIT_NAME, type CrewAlertKind } from './outOfHours';
import { restPlan } from './restPlan';

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
  /** v0.8 fix pack: a private jet that can't leave sooner than a cheaper fix: not offered (one muted line, `why`). */
  dominated?: boolean;
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
  buyBack: 'Ask someone to work a day off',
};
// v0.12.1 the buy-back after the call-in (its cost ranks it before a late ticket, a jet or a cancellation).
const FIX_ORDER: CrewFix[] = ['autoFix', 'deadhead', 'delay', 'jet', 'callIn', 'buyBack', 'discretion', 'swap', 'subcharter', 'cancel'];
const FIX_DESC: Record<CrewFix, string> = {
  autoFix: 'Run the roster again for this flight and its trip.',
  deadhead: 'A free crew member flies in as a passenger on an airline ticket.',
  delay: 'The flight waits until a legal crew can take it; later legs move.',
  jet: 'A business jet brings the crew in within hours. Dear, but fast.',
  callIn: 'Standby first, no overtime. A day off costs overtime and morale.',
  discretion: "After reporting, if something unforeseen happens, the captain may extend the crew's day: up to 2 h (3 h with an augmented crew).",
  swap: "Take the crew of another flight; that flight then needs a crew.",
  subcharter: 'A rival airline flies it; we still bill the client.',
  cancel: 'Compensation to the client and a reliability hit.',
  buyBack: "Paid at twice a day's pay; the day off is given back later in the month.",
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
  /** v0.9 §T seats held by crew out of hours (illegal for this duty, or a failed rest plan): a replacement takes them. */
  replace: { role: Role; crewId: string }[];
  /** Seats a new crew member can take: the empty ones, then those of `replace` (call-in, fly in, jet). */
  seats: Role[];
  /** v0.9 round 5 (speed): the longest delay from the original departure the caller would take (the bot's cap); the delay search tries no later time. */
  maxDelay?: Minute;
}

/**
 * v0.9 round 4 (§Y.1): whether even a fresh crew, reporting for the held departure (their own check-in, not the hours
 * the first crew waited), would be over the day-length limit from that report. Pure.
 */
function freshOver(g: GameState, f: Flight, d: Duty, p: Pairing): boolean {
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  if (!last) return false;
  const rep = freshReport(g, p, d, f);
  const fdp = Math.max(f.std + f.delay, g.now) + Math.max(f.block, last.sta - f.std) - rep;
  return fdp > fdpLimitAt(g, p, d, f.from, rep).max;
}

/** v0.9 round 4: the reported duty is over its day-length limit on the clock now (the hold included), as fdpOver will judge it. */
const dutyOver = (g: GameState, f: Flight, d: Duty): boolean => Math.max(d.fdp - d.maxFdp, liveOver(g, f) ?? -Infinity) > (d.discretion ?? 0);

/** v0.9 §T the seats held by crew out of hours on duty d: a crew-level illegal issue, or a rest plan failed at the gate. */
function heldOoh(g: GameState, f: Flight, d: Duty | undefined, p: Pairing | undefined, cs: FlightCrewStatus): { role: Role; crewId: string }[] {
  if (!d || !p || d.done) return [];
  const rest = p.slots.some((s) => s.crewId && s.ooh?.limit === 'inflightRest');
  if (cs.level !== 'illegal' && !rest) return [];
  const out: { role: Role; crewId: string }[] = [];
  const seen = new Set<string>();
  const add = (crewId: string) => {
    const s = p.slots.find((y) => y.crewId === crewId);
    if (!s || seen.has(crewId)) return;
    seen.add(crewId);
    out.push({ role: s.role, crewId });
  };
  if (cs.level === 'illegal') for (const b of crewIssuesFor(g, d)) add(b.crewId);
  for (const s of p.slots) if (s.crewId && s.ooh?.limit === 'inflightRest') add(s.crewId);
  // Round 4: the duty itself over its limit after a hold (a clock no re-roster shortens): every seat may go to a
  // fresh crew whose own day, from their check-in for the held departure, still fits (else fullWhy says why not).
  if (dutyOver(g, f, d) && !freshOver(g, f, d, p)) for (const s of p.slots) if (s.crewId && !s.above) add(s.crewId);
  return out.sort((a, b) => SLOT_ORDER.indexOf(a.role) - SLOT_ORDER.indexOf(b.role));
}

function ctxOf(g: GameState, flightId: string, maxDelay?: Minute): Ctx | null {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.kind === 'deadhead' || f.status !== 'scheduled') return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  const cs = flightCrewStatus(g, f.id);
  const missing = [...cs.missing].sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b));
  const unit = unitOf(g, ac, f);
  const replace = heldOoh(g, f, d, p, cs);
  return { g, f, ac, d, p, cs, missing, need: group(missing), unit, pax: unitPax(ac, unit), revLegs: unit.filter(isRevenue).length, dep: f.from, replace, seats: [...missing, ...replace.map((r) => r.role)], ...(maxDelay !== undefined ? { maxDelay } : {}) };
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
export function shortFlights(g: GameState): { flightId: string; stage: 'amber' | 'red'; hoursLeft: number; kind: CrewAlertKind }[] {
  const out: { flightId: string; stage: 'amber' | 'red'; hoursLeft: number; kind: CrewAlertKind; std: Minute }[] = [];
  const until = g.now + CC().amberH * 60;
  for (const id of Object.keys(g.fleet)) {
    const legs = liveFlightsOf(g, id);
    for (const f of legs) {
      if (f.status !== 'scheduled' || f.aircraftId !== id || f.std > until || f.std + f.delay < g.now - 6 * 60) continue;
      if (phantomLeg(f, legs)) continue;
      const cs = flightCrewStatus(g, f.id, { live: false });
      if (cs.level !== 'missing' && cs.level !== 'illegal') continue;
      const hoursLeft = Math.max(0, Math.round(((f.std - g.now) / 60) * 10) / 10);
      // v0.9 crew out of hours (a named crew member at a legal limit) or a shortage (UPDATE-0.9.md §T.2).
      const kind: CrewAlertKind = cs.level === 'illegal' || p_hasOoh(g, f) ? crewAlertKind(g, f.id) ?? 'short' : 'short';
      out.push({ flightId: f.id, stage: hoursLeft <= CC().redH ? 'red' : 'amber', hoursLeft, kind, std: f.std });
    }
  }
  out.sort((a, b) => a.std - b.std || (a.flightId < b.flightId ? -1 : 1));
  return out.map(({ std: _s, ...x }) => x);
}

/**
 * The warning ladder: crew-planning round: a trip the roster cannot crew is announced days ahead (earlyH: a calm
 * heads-up, once, Flight.crewEarly) as soon as that is known; a flight first seen short inside 48 h gets an amber mark and one message per batch (no pause);
 * still short inside 12 h it turns red, with one message per duty, the crewShortage pause and the 'crewRed' sound
 * hook. Marks are saved on the flight (never repeated). Called hourly and after every auto-roster.
 */
/** Previews run the fixes on a copy: the ladder (messages, pauses) stays quiet while one runs. */
let previewing = 0;

let escalating = false;

export function escalateShortages(g: GameState, opts: { reroster?: boolean; freeFix?: boolean } = {}): void {
  if (previewing || escalating) return;
  escalating = true;
  try {
    escalate(g, opts.reroster === true, opts.freeFix !== false);
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

/**
 * Crew-planning round: 'Late change: Ana Gomes fell sick on 14 Oct. ' when a late change emptied a seat on the flight's
 * duty (Flight.crewLost on one of its legs), the leg was added at short notice (Flight.born) or a delay moved it an hour
 * or more, so a notice tells a late change from a planning failure; else ''.
 */
export function lateChangeNote(g: GameState, f: Flight): string {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  let lost = f.crewLost;
  for (const id of d?.flightIds ?? []) {
    const y = g.flights[id]?.crewLost;
    if (y && (!lost || y.t > lost.t)) lost = y;
  }
  if (!lost || lost.t < f.std - 7 * DAY) {
    // A leg added or moved at short notice: nobody could have been planned for it earlier.
    if (f.born !== undefined && f.born > f.std - 2 * DAY) return `Late change: this leg was only added on ${fmtDay(f.born)} at ${fmtTime(f.born)} UTC (a schedule change at short notice). `;
    const moved = f.schedStd !== undefined ? f.std + f.delay - f.schedStd : f.delay;
    // (Not a wait for crew: that is the shortage itself.)
    if (moved >= 60 && !/crew/i.test(f.delayReason ?? '')) return `Late change: ${f.delayReason ? f.delayReason.toLowerCase() : 'a delay'} moved it ${fmtDuration(moved)} later. `;
    return '';
  }
  const c = g.crew[lost.crewId];
  const who = c ? crewName(c) : 'A crew member';
  return lost.why === 'sick' ? `Late change: ${who} fell sick on ${fmtDay(lost.t)}. ` : `Late change: ${who} can no longer fly it after a delay or change on ${fmtDay(lost.t)}. `;
}

/**
 * Crew-planning round: legs beyond the amber stage and inside earlyH whose trip the roster cannot crew (a seat with no
 * legal crew member at all, after the aircraft's own re-plan): the early heads-up, once per trip. One leg per duty.
 */
function earlyShort(g: GameState, reroster: boolean): Flight[] {
  const from = g.now + CC().amberH * 60;
  const until = g.now + CC().earlyH * 60;
  const out: Flight[] = [];
  const planned = new Set<string>();
  for (const id of Object.keys(g.fleet)) {
    const legs = liveFlightsOf(g, id);
    for (const f of legs) {
      // (A leg with no duty yet is one the roster has not planned: not known to be short.)
      if (f.status !== 'scheduled' || f.aircraftId !== id || f.std <= from || f.std > until || f.crewEarly || f.crewAlert || !f.dutyId || phantomLeg(f, legs)) continue;
      const cs = flightCrewStatus(g, f.id, { live: false });
      if (cs.level !== 'missing') continue;
      // Each duty is read once every 6 h at most; the time is saved on the duty (Duty.earlyRead), so a reloaded game
      // reads (and re-plans) when the original would: a runtime map, empty after a load, gave the heads-up hours apart.
      const d = g.duties[f.dutyId];
      if (!d || (d.earlyRead ?? -Infinity) > g.now - 6 * 60) continue;
      d.earlyRead = g.now;
      if (reroster && !planned.has(id)) {
        planned.add(id);
        planNow(g, f);
        if (flightCrewStatus(g, f.id, { live: false }).level !== 'missing') continue;
      }
      const x = ctxOf(g, f.id);
      if (!x || crewableOnTime(g, x)) continue;
      out.push(f);
    }
  }
  return out;
}

function escalate(g: GameState, reroster: boolean, freeFix: boolean): void {
  const amber: Flight[] = [];
  const red: Flight[] = [];
  // Crew-planning round: the early heads-up, days ahead, as soon as the roster knows it cannot crew a trip.
  const early = earlyShort(g, reroster);
  if (early.length) {
    const seen = new Set<string>();
    const fl = early.filter((f) => {
      const k = f.dutyId ? g.duties[f.dutyId]?.pairingId ?? f.dutyId : f.id;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    for (const f of early) {
      const d = f.dutyId ? g.duties[f.dutyId] : undefined;
      const p = d ? g.pairings[d.pairingId] : undefined;
      for (const id of p ? openDuties(g, p).flatMap((x) => x.flightIds) : [f.id]) if (g.flights[id]) g.flights[id].crewEarly = true;
    }
    stats(g).crewEarly = (stats(g).crewEarly ?? 0) + fl.length;
    for (const f of fl.slice(0, 3)) {
      const card = crewShortCard(g, f.id);
      if (!card) continue;
      const days = Math.max(1, Math.round((f.std - g.now) / DAY));
      pushMessage(g, {
        tone: 'info', cat: 'crew',
        title: `Heads-up: ${card.what} (${fmtDay(f.std)})`,
        body: `${lateChangeNote(g, f)}${card.why} ${days} days to go: hire, fly someone in on a ticket or a private jet, swap crews, sub-lease the trip or move it. ${hurtProse(card)}.${fl.length > 3 && f === fl[0] ? ` Also ${fl.slice(3, 6).map((y) => y.no).join(', ')}.` : ''}`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
  }
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
  // v0.9 before a red (alarm and pause), the free fixes once: the roster run again for the aircraft, then crew on
  // standby at the departure called out (legal, no overtime, never a day off). Red only when the flight stays short.
  let list = shortFlights(g);
  // v0.9 fix: from the amber stage too (a first warning 48 h out): a standby call-out or a ticket for free crew is
  // cheap then, and gone 12 h out.
  const due = (x: (typeof list)[number]) => {
    const a = g.flights[x.flightId].crewAlert;
    return x.stage === 'red' ? a !== 'red' : !a;
  };
  if (freeFix && list.some(due)) {
    const done = new Set<string>(fresh);
    for (const x of list) {
      const f = g.flights[x.flightId];
      if (!due(x) || f.status !== 'scheduled') continue;
      // Crew out of hours keep their alert unless a standby replaces them (a re-roster would only empty the seat).
      if (x.kind === 'short' && f.aircraftId && !done.has(f.aircraftId)) {
        done.add(f.aircraftId);
        planNow(g, f);
      }
      if (BAD(flightCrewStatus(g, f.id, { live: false }).level)) standbyCallOut(g, f.id);
    }
    list = shortFlights(g);
  }
  const kindOf = new Map<string, CrewAlertKind>();
  for (const x of list) {
    const f = g.flights[x.flightId];
    kindOf.set(f.id, x.kind);
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
  const v9 = v09Stats(g);
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
    const hours = kindOf.get(fl[0].id) === 'hours';
    v9.oohAmber += fl.filter((f) => kindOf.get(f.id) === 'hours').length;
    const card = hours ? crewHoursCardHook?.(g, fl[0].id) ?? crewShortCard(g, fl[0].id) : crewShortCard(g, fl[0].id);
    if (card) {
      const h = Math.round((fl[0].std - g.now) / 60);
      pushMessage(g, {
        tone: 'warn', cat: 'crew', cue: 'crewAmber',
        title: fl.length === 1 ? (hours ? `${fl[0].no}: crew out of hours` : card.what) : `${fl.length} flights need crew`,
        body: `${hours ? `${card.what}. ` : ''}${lateChangeNote(g, fl[0])}${card.why} ${hurtProse(card)}. Departs in ${h} h.${fl.length > 1 ? ` Also ${fl.slice(1, 4).map((f) => f.no).join(', ')}.` : ''}`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
  }
  if (red.length) {
    const duties = perDuty(red);
    s.crewRed = (s.crewRed ?? 0) + duties.length;
    let short = false;
    let hrs = false;
    for (const f of perAircraft(duties)) {
      const hours = kindOf.get(f.id) === 'hours';
      const card = hours ? crewHoursCardHook?.(g, f.id) ?? crewShortCard(g, f.id) : crewShortCard(g, f.id);
      if (!card) continue;
      const h = Math.max(0, Math.round((f.std - g.now) / 60));
      const also = duties.filter((y) => y !== f && y.aircraftId === f.aircraftId).map((y) => y.no);
      if (hours) {
        hrs = true;
        v9.oohRed++;
      } else short = true;


      pushMessage(g, {
        tone: 'bad', cat: 'crew', topic: hours ? 'crewHours' : 'crewRed', title: `${hours ? 'CREW OUT OF HOURS' : 'CREW SHORTAGE'}: ${f.no} in ${h} h`,
        body: `${hours ? `${card.what}. ` : ''}${lateChangeNote(g, f)}${card.why} ${hurtProse(card)}.${also.length ? ` Also ${also.slice(0, 3).join(', ')} on the same aircraft.` : ''}`,
        ref: card.subject.ref, problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
      });
    }
    if (short) requestPause('crewShortage');
    if (hrs) requestPause('crewHours');
  }
}

setShortHook((g) => escalateShortages(g));

/**
 * v0.9 the routine call-out (§R.4): every open seat of the flight (and those of crew out of hours) taken by crew on
 * standby at the departure, legal, no overtime, no day off; applied only when it covers them all. One info message.
 */
function standbyCallOut(g: GameState, flightId: string): boolean {
  // Standby at the departure first (no overtime), then crew free elsewhere on a ticket (what the roster buys anyway).
  for (const fix of ['callIn', 'deadhead'] as const) {
    const x = ctxOf(g, flightId);
    if (!x?.d || !x.p || !x.seats.length) return false;
    const lists = new Map<Role, DutyCandidate[]>();
    for (const role of new Set(x.seats)) lists.set(role, seatCandidates(g, x.d, role, fix === 'callIn').filter((c) => (fix === 'deadhead' || !!c.standby) && !c.dayOff && c.level !== 'illegal'));
    const span: [Minute, Minute] = [fix === 'callIn' ? x.d.report : x.d.report - DAY, openDuties(g, x.p).at(-1)?.release ?? x.d.release];
    const picks = pickCrew(x, lists, undefined, (id) => !takesPublishedOff(g, g.crew[id], span[0], span[1]));
    if (picks.length < x.seats.length) continue;
    const r = runFix(g, flightId, fix, { crewIds: picks.map((y) => y.crewId) });
    if (!r.ok || BAD(flightCrewStatus(g, flightId, { live: false }).level)) continue;
    pushMessage(g, { tone: 'info', cat: 'crew', title: `${x.f.no} crewed ${fix === 'callIn' ? 'from standby' : 'on a ticket'}`, body: `${r.changes.join('. ')}.`, ref: { kind: 'flight', id: flightId } });
    return true;
  }
  return false;
}

/** v0.9 the out-of-hours card (problems/crew.ts crewHoursCard registers itself: problems import crew, not the reverse). */
// eslint-disable-next-line no-var -- set while modules load in a cycle (var: no temporal dead zone)
var crewHoursCardHook: ((g: GameState, flightId: string) => ProblemCard | null) | null | undefined;
export function setCrewHoursCard(f: (g: GameState, flightId: string) => ProblemCard | null): void {
  crewHoursCardHook = f;
}

/** A slot of the flight's duty carries an out-of-hours mark. */
function p_hasOoh(g: GameState, f: Flight): boolean {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  return !!p?.slots.some((x) => x.ooh && !x.crewId);
}

// ---------- the card (§3.6–§3.8, §9) ----------

// v0.12.1 days off first: the one blocker a buy-back lifts (BLU1565 read 'free in Lisbon' for captains on days off).
const CAUSE_ORDER: ReasonCode[] = ['daysOff', 'place', 'rest', 'fdp', 'hours', 'recovery', 'busy', 'sick', 'leave', 'training', 'joining', 'rating'];

/** The reach bar: when the nearest ticket from where c is could land, against the duty's must-land-by. Pure. */
export function reachFor(g: GameState, p: Pairing, d: Duty, c: CrewMember, departure: Minute): ReachSpec {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const segs = segsOf(g, c, p.id);
  const from = locAt(c, segs, d.report);
  const ready = Math.max(g.now, readyAt(c, segs, d.report, g.now));
  const first = Math.ceil((ready + BAL.deadheadCheckIn) / 60) * 60;
  const arr = first + dhBlock(from, dep);
  const legs = from === dep ? [] : itinerary(from, dep, first, arr).map((l) => ({ no: l.no, airline: l.airline, from: l.from, to: l.to, dep: l.dep, arr: l.arr }));
  const mustLandBy = d.report - OUT_CONNECT;
  return { from, to: dep, now: g.now, mustLandBy, report: d.report, departure, earliestArrival: arr, legs, gapMin: arr - mustLandBy };
}

/**
 * v0.12.1 what really keeps a crew member who could land in time from the trip, in plain words (the card read 'flown
 * in the same day their day would be too long, and after a night's rest they report too late' 83 h before the report).
 */
function placeBlock(g: GameState, reasons: string[], report: Minute): string {
  const t = reasons.find((x) => /FDP|Resting at|earliest arrival|rest at/i.test(x)) ?? reasons[0] ?? '';
  const resting = /Resting at \w{3} until ([^;]+);/.exec(t);
  if (resting) return `they rest until ${resting[1].trim()} first`;
  const fdp = /FDP (\d+:\d\d)(?: > |, within 30 min of )(\d+:\d\d) max; rest at (\w{3}) needed landing by (.+)$/.exec(t);
  if (fdp) return `flown in the same day their day would be too long (${fdp[1]}, limit ${fdp[2]}), and to rest in ${city(fdp[3])} first they had to land by ${fdp[4].trim()}`;
  return t ? t.charAt(0).toLowerCase() + t.slice(1).replace(/\.$/, '') : `nothing legal gets them there for the ${at(report, g.now)} report`;
}

/** The crew-shortage card for a flight whose crew is missing or illegal (null when it is fine). Pure. */
export function crewShortCard(g: GameState, flightId: string): ProblemCard | null {
  const x = ctxOf(g, flightId);
  if (!x || (x.cs.level !== 'missing' && x.cs.level !== 'illegal')) return null;
  const { f, ac, d, p } = x;
  const ready = readyOf(g, f, ac);
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
      // v0.10.1 not at the departure airport: which seat ('FO Teresa Martins is in Lisbon, not Antalya').
      const seat = r.code === 'place' ? p?.slots.find((s) => s.crewId === first.id)?.role : undefined;
      why = `${seat ? `${seat} ` : ''}${crewName(first)} is ${r.text}${r.code === 'rest' && d ? `, after the ${fmtTime(d.report)} report` : ''}.`;
      for (const b of bad) details.push(`${crewName(g.crew[b.crewId])}: ${b.issue.text}`);
      if (r.code === 'rest' || r.code === 'fdp' || r.code === 'hours' || r.code === 'recovery') visuals.gauges = crewGauges(g, first.id, d?.id);
      if (r.code === 'place' && p && d) visuals.reach = reachFor(g, p, d, first, f.std);
      terms.push(r.code === 'rest' ? 'rest' : r.code === 'fdp' ? 'fdp' : r.code === 'recovery' ? 'recovery' : 'deadhead');
    } else if (d) {
      const max = d.maxFdp + (d.discretion ?? 0);
      why = `The crew's day would run ${hm(d.fdp)}, over the ${hm(max)} limit${d.discretion ? ' even with discretion' : ''}.`;
      details.push(`Duty ${fmtDateTime(d.report)} – ${fmtDateTime(d.release)}, ${d.sectors} sectors, FDP ${hm(d.fdp)} of ${hm(d.maxFdp)}${d.discretion ? ` + ${hm(d.discretion)} discretion` : ''}`);
      visuals.gauges = [{ id: 'fdp', label: 'Day length', value: d.fdp, limit: max, unit: 'hm', text: `${hm(d.fdp)} of ${hm(max)}`, tone: 'bad', by: d.report }];
      // v0.9 the discretion term only where it may apply (after report, unforeseen: UPDATE-0.9.md §U.3).
      terms.push('fdp', ...(discretionCheck(g, d.id).ok ? ['discretion' as const] : []));
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
    // v0.12.1 a day off the roster will not take (tight: published) holds them back too: its own story (BLU1565).
    const refused = cands.filter((c) => (c.level === 'illegal' || (c.dayOff && c.reason?.code === 'daysOff')) && c.reason && !(c.reason.code === 'place' && c.loc === x.dep));
    let cause: ReasonCode | null = null;
    for (const code of CAUSE_ORDER) if (refused.some((c) => c.reason!.code === code)) { cause = code; break; }
    let pick = cause ? refused.find((c) => c.reason!.code === cause)! : null;
    const plur = word[1];
    // v0.7.3 crew on standby are the first call (no overtime), as the call-in fix picks them; v0.9 a day off is the last.
    const free = cands.find((c) => c.level !== 'illegal' && c.standby && !c.travel && !c.dayOff) ?? cands.find((c) => c.level !== 'illegal' && !c.dayOff);
    const offFree = free ? undefined : cands.find((c) => c.level !== 'illegal' && c.dayOff && !c.travel);
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
    // v0.12.1 crew already at the departure come first in the story (BLU1570: 'your free captains are in Lisbon' while
    // two pilots sat in Goma): who is there and what holds them back; and whoever only a day off holds back.
    const bbs = buyBackPicks(g, f.id);
    const here = cands.filter((c) => c.loc === x.dep && c.level === 'illegal' && c.reason && c.crewId !== pick?.crewId && !inTheAir(g, c.crewId) && !bbs.some((y) => y.c.id === c.crewId));
    const hereLine = here.length ? `In ${city(x.dep)}: ${here.slice(0, 2).map((c) => `${c.name} is ${c.reason!.text}`).join('; ')}${here.length > 2 ? `; ${here.length - 2} more` : ''}. ` : '';
    if (bbs.length) {
      const y = bbs[0];
      const mode = buyBackMode(g);
      why = `${crewName(y.c)} is ${y.here ? `in ${city(x.dep)}` : `in ${city(y.c.loc)}`} and only a day off (${dayLabel(y.bb.worked)}) stands in the way: ${mode === 'auto' ? 'Auto-fix asks them to work it' : 'ask them to work it in Crew Control'} (${usd(y.bb.cost)}, twice a day's pay).${bbs.length > 1 ? ` ${bbs.slice(1).map((z) => crewName(z.c)).join(' and ')} too.` : ''}`;
      terms.push('daysOff');
    } else if (free?.standby && !free.travel) {
      why = `${free.name} is on ${SBY_WORD[free.standby.kind]} at ${city(x.dep)} and can take the ${word[0]} seat: call them in (no overtime).`;
      terms.push('standby');
    } else if (offFree) {
      why = `${offFree.name} is on a day off at ${city(x.dep)}: calling them in costs overtime and morale −${Math.abs(BAL.v09.roster.morale.broken)}.`;
      terms.push('daysOff');
    } else if (free) {
      why = `${free.name} is free${free.loc !== x.dep ? ` in ${city(free.loc)}` : ` at ${city(x.dep)}`} and could take the ${word[0]} seat: the roster has not placed them yet.`;
      terms.push('standby');
    } else if (!cands.length || !cm || !r) {
      why = rated ? `No ${fam} ${plur} are free at all this week.` : `Nobody free holds the ${fam} rating.`;
      terms.push('standby');
    } else if (r.code === 'daysOff') {
      // v0.12.1 the true blocker: days off (a buy-back is at most once a month a person and keeps the legal minimum).
      const n = refused.filter((c) => c.reason!.code === 'daysOff').length;
      const soon = d.report - g.now <= BAL.v09.roster.buyBack.horizonH * 60;
      why = `${crewName(cm)} could take it but is ${r.text}${n > 1 ? `, as are ${n - 1} more ${plur}` : ''}: ${soon ? 'none of them can be asked to work it (once a month each, and never below the legal days off)' : `from ${BAL.v09.roster.buyBack.horizonH} h before the report one can be asked to work it (twice a day's pay); before that, fly someone in or swap crews`}.`;
      terms.push('daysOff');
    } else if (r.code === 'place') {
      const reach = reaches.get(cm.id) ?? reachFor(g, p, d, cm, f.std);
      const where = [...new Set(same.map((c) => city(c.loc)))].slice(0, 2).join(' and ');
      const gap = reach.gapMin;
      why = gap > 0
        ? `Your free ${plur} are in ${where} and the earliest they can land in ${city(x.dep)} is ${at(reach.earliestArrival, g.now)}, ${fmtDuration(gap)} after the latest ${at(reach.mustLandBy, g.now)}.`
        : `Your free ${plur} are in ${where}. ${crewName(cm)} could land by ${at(reach.earliestArrival, g.now)}, but ${placeBlock(g, pick!.reasons, d.report)}.`;
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
      why = `${crewName(cm)} could take it, but their day would run ${r.text.replace(/^over the day-length limit \(?/, '').replace(/\)$/, '')}.`;
      visuals.gauges = crewGauges(g, cm.id, d.id);
      terms.push('fdp');
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
    if (hereLine && !free?.standby && !offFree) why = `${hereLine}${why}`;
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
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  cum('duty7d', cap(LIMIT_NAME.duty7d), w.duty7d, LIMITS.duty7d);
  cum('block28d', cap(LIMIT_NAME.block28d), w.block28d, LIMITS.block28d);
  cum('blockYear', cap(LIMIT_NAME.blockYear), w.blockYear, LIMITS.blockYear);
  return out;
}

// ---------- jets (§4) ----------

export interface JetQuote {
  cls: JetClass; model: string; operator: string; reg: string; seats: number; jets: number;
  wheelsUp: Minute; arrives: Minute; block: number; fuelStop: string | null; cost: number; text: string;
}

const NM = 1.852;

/**
 * The smallest class that seats the crew and flies the distance nonstop; else the smallest with one fuel stop (a light
 * jet only up to ~3 h). Crew-planning round: nonstop first (a long-range jet over an ocean, not a heavy with a stop).
 */
function jetClassFor(crewN: number, nm: number): JetClass {
  const J = CC().jet;
  const ok = (cls: JetClass, legs: number) => !(cls === 'light' && (nm / J.cruiseKt.light) * 60 + J.taxiMin > 180) && crewN <= J.seats[cls] && nm <= J.rangeNm[cls] * legs;
  return JET_CLASSES.find((c) => ok(c, 1)) ?? JET_CLASSES.find((c) => ok(c, 2)) ?? 'long';
}

/** Crew-planning round: the business-aviation base nearest an airport and the distance (nm); 0 at a base. Memoized. */
const nearBase = new Map<string, { base: string; nm: number }>();
export function nearestJetBase(code: string): { base: string; nm: number } {
  let r = nearBase.get(code);
  if (!r) {
    r = { base: code, nm: Infinity };
    for (const b of JET_BASES) {
      const nm = b === code ? 0 : distance(b, code) / NM;
      if (nm < r.nm) r = { base: b, nm };
    }
    if (!Number.isFinite(r.nm)) r = { base: code, nm: 0 };
    nearBase.set(code, r);
  }
  return r;
}

/**
 * A charter quote for `crewN` crew from → to, free from `ready` (now at the earliest). Pure (hash-picked operator).
 * Crew-planning round: a direct route at the class's real cruise speed, a fuel stop only past its range; the jet
 * comes from the nearest business-aviation base, wheels up 2 h after the call (or its positioning + 1 h when the base
 * is far), and its empty legs there and back are billed.
 */
export function jetQuote(g: GameState, from: string, to: string, crewN: number, ready: Minute, cls?: JetClass): JetQuote {
  const J = CC().jet;
  const nm = distance(from, to) / NM;
  const c = cls ?? jetClassFor(crewN, nm);
  const seats = J.seats[c];
  const jets = Math.max(1, Math.ceil(crewN / seats));
  const stop = nm > J.rangeNm[c];
  const fly = (x: number) => (x / J.cruiseKt[c]) * 60;
  let block = Math.round(fly(nm) + J.taxiMin);
  if (stop) block += J.fuelStopMin;
  const posIn = nearestJetBase(from).nm;
  const posBack = nearestJetBase(to).nm;
  const posH = (posIn ? fly(posIn) + J.taxiMin : 0) / 60 + (posBack ? fly(posBack) + J.taxiMin : 0) / 60;
  const hours = Math.max(J.minH, block / 60) + J.posShare * posH;
  const per = Math.round((hours * J.rate[c] + J.fees + (stop ? J.fuelStopFee : 0)) / 100) * 100;
  const cost = per * jets;
  const lead = Math.max(J.fboLeadMin, posIn ? fly(posIn) + J.taxiMin + J.posLeadMin : 0);
  const wheelsUp = Math.ceil(Math.max(g.now + lead, ready) / 15) * 15;
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
  const pool: { c: CrewMember; loc: string; ready: Minute; km: number; segs: ReturnType<typeof segsOf>; lands: Minute }[] = [];
  for (const c of Object.values(g.crew)) {
    if (!canFill(role, c.role) || !c.ratings.includes(fam) || on.has(c.id)) continue;
    if (c.status === 'sick' || c.status === 'leave' || c.status === 'training' || c.status === 'joining') continue;
    // v0.9 never someone on a planned day off (R.5: only the player takes one, through Crew Control's call-in).
    if (offDaysHit(c, d.report - 6 * 60, d.release).length) continue;
    const segs = segsOf(g, c, p.id);
    const loc = locAt(c, segs, d.report);
    if (loc === dep) continue;
    const ready = Math.max(g.now, readyAt(c, segs, d.report, g.now));
    // Crew-planning round: ranked by when a jet would land them (crew resting a short hop away beat crew free now
    // an ocean away; seed: two pilots resting in Bermuda 2.5 h from Montego Bay were never looked at).
    pool.push({ c, loc, ready, km: distance(loc, dep), segs, lands: jetQuote(g, loc, dep, 1, ready, cls).arrives });
  }
  pool.sort((a, b) => a.lands - b.lands || a.km - b.km || (a.c.role === role ? -1 : 1) || (a.c.id < b.c.id ? -1 : 1));
  const out: (JetCand & { km: number })[] = [];
  const rested: JetCand[] = [];
  for (const { c, loc, ready, km, segs } of pool.slice(0, 12)) {
    const q = jetQuote(g, loc, dep, 1, ready, cls);
    // A jet landing after the report delays the flight by the gap (runFix): the ride is judged against that later
    // report, i.e. shifted earlier by the gap for the check.
    const shift = Math.max(0, q.arrives + OUT_CONNECT - d.report);
    const ride = jetRide(q, loc, dep);
    // Crew-planning round: never earlier than the crew can check in (moved by the whole gap, a crew resting until just
    // before the jet read 'Rest 9:42 < 10:00' and a jet from 2.5 h away was never offered). Moved less than the gap,
    // the merged day reads a little short here; the preview (the flight really delayed on a copy) has the last word.
    const k = Math.min(shift, Math.max(0, ride.std - CC().jet.checkInMin - ready));
    const plan = planCrew(g, c, p, segs, false, 0, undefined, k ? { ...ride, std: ride.std - k, sta: ride.sta - k } : ride);
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
    ready.set(loc, Math.max(ready.get(loc) ?? g.now, readyAt(c, segs, d.report, g.now)));
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
  let refused: string | undefined;
  for (const c of crew) {
    const seat = p.slots.find((s) => !s.crewId && !s.above && s.role === c.role) ?? p.slots.find((s) => !s.crewId && !s.above && canFill(s.role, c.role));
    const r = seat ? assignCrew(g, f.id, c.id, seat.role) : { ok: false as const, error: 'No empty seat' };
    if (r.ok) seated.push(c.id);
    else {
      refused ??= `${crewName(c)}: ${r.error}`;
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
  // Crew-planning round: the first refusal is named (the player saw only 'nobody is legal').
  if (!seated.length) return { ok: false, error: `Nobody could be seated on the trip${refused ? ` (${refused})` : ''}` };
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
    // v0.12.1 never a ticket already gone (a swap preview read 'lands 26 Oct 15:15' on 27 Oct).
    if (!t || t.status !== 'scheduled' || t.sta > d.report || t.std < g.now) continue;
    // v0.12.1 a seat on our own flight: 'flies out on our own BLU123 LIS–LPA, lands 07:10'.
    if (t.kind !== 'deadhead' && t.riders?.includes(crewId)) return ` (flies out on our own ${t.no} ${t.from}–${t.to}, lands ${at(t.sta, g.now)})`;
    if (!t.crewIds.includes(crewId) || t.kind !== 'deadhead') continue;
    const legs = commercialItinerary(g, t);
    return ` (${t.charter ? `private jet ${t.charter.model}` : `deadhead ${itineraryText(legs)}`}, lands ${at(t.sta, g.now)})`;
  }
  return '';
}

/** v0.12.1 the month's salaries line so far (negative): a fix's day-off pay is the drop. */
const salariesNow = (h: GameState): number => -(h.finance.current.lines.salaries ?? 0);

/** Seats filled on the flight's pairing since `before` (crew id per slot index), as change lines. */
function seatChanges(g: GameState, f: Flight, before: Set<string>): string[] {
  const d = g.flights[f.id]?.dutyId ? g.duties[g.flights[f.id].dutyId!] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) return [];
  const out: string[] = [];
  for (const s of p.slots) {
    if (!s.crewId || before.has(s.crewId) || s.above) continue;
    const c = g.crew[s.crewId];
    // v0.12.1 a day off bought for it (crew/buyBack.ts: marked this minute) is said on the line.
    const bought = !!c && boughtNow(g, c.id);
    if (c) out.push(`${crewName(c)} takes the ${ROLE_WORD[s.role][0]} seat${rideText(g, d, c.id)}${bought ? ', working a day off' : ''}`);
  }
  const still = group(p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role));
  if (still.length) out.push(`${seatsText(still)} still missing`);
  return out;
}

const heldBy = (p?: Pairing) => new Set(p ? p.slots.filter((s) => s.crewId).map((s) => s.crewId!) : []);
const overtimeOf = (c: CrewMember) => Math.round((CC().callInPay * c.salary) / 21);

/**
 * v0.12.1 on a ticket that has left (deadheads stay 'scheduled' until they land): in the air, so no use at its
 * departure airport (BLU1570: Bruno Pereira, flying Goma–Amsterdam, was offered for the Goma captain seat).
 */
const inTheAir = (g: GameState, crewId: string) => (crewIx(g).tickets.get(crewId) ?? []).some((t) => t.status === 'scheduled' && t.std <= g.now && t.sta > g.now);

export interface BuyBackPick { role: Role; c: CrewMember; bb: BuyBack; here: boolean; ticket: number }

/**
 * v0.12.1 who could take each missing seat by working a day off (crew/buyBack.ts buyBackFor), one person per seat:
 * those already at the departure first, then the cheapest (pay and ticket). `chosen`: the player's picks. Pure.
 */
export function buyBackPicks(g: GameState, flightId: string, chosen?: string[]): BuyBackPick[] {
  const x = ctxOf(g, flightId);
  if (!x?.d || !x.p) return [];
  return memoOf(g, `bb:${flightId}:${chosen?.join(',') ?? ''}`, () => {
    const { d, p } = x;
    const out: BuyBackPick[] = [];
    const used = new Set<string>();
    for (const role of x.missing) {
      const list: BuyBackPick[] = [];
      for (const cand of candidatesOf(g, d!, role)) {
        if (cand.onPairing || used.has(cand.crewId) || !cand.codes.includes('daysOff') || (chosen && !chosen.includes(cand.crewId))) continue;
        const c = g.crew[cand.crewId];
        if (!c || inTheAir(g, c.id)) continue;
        const base = segsOf(g, c, p!.id);
        const plan = planCrew(g, c, p!, base);
        const bb = buyBackFor(g, c, plan, base);
        if (bb) list.push({ role, c, bb, here: !plan.out, ticket: plan.out ? cand.ticket : 0 });
      }
      list.sort((a, b) => Number(b.here) - Number(a.here) || a.bb.cost + a.ticket - b.bb.cost - b.ticket || (a.c.id < b.c.id ? -1 : 1));
      if (!list.length) continue;
      used.add(list[0].c.id);
      out.push(list[0]);
    }
    return out;
  });
}

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
/** v0.9 speed: when a crew could take the flight, once per state and minute (the card, the delay search, the rows). */
const readyOf = (g: GameState, f: Flight, ac: Aircraft) => memoOf(g, `ra:${f.id}:${ac.id}`, () => crewReadyAt(g, f, ac));

/**
 * v0.9 a call-in candidate's standby as Crew Control lists it (§R.4): 'Airport standby until 10:30 · ready in 20 min',
 * 'Home standby (early) · ready in 1:30', 'Hotel standby at DUB · ready in 45 min', 'Reserve · from 19:10 (10 h notice)'.
 */
function sbyText(g: GameState, c: CrewMember, s: NonNullable<DutyCandidate['standby']>): string {
  const ready = s.readyMin < 60 ? `${s.readyMin} min` : `${Math.floor(s.readyMin / 60)}:${String(s.readyMin % 60).padStart(2, '0')}`;
  if (s.kind === 'airport') return `Airport standby until ${fmtTime(s.to, s.at)} · ready in ${ready}`;
  if (s.kind === 'hotel') return `Hotel standby at ${s.at} · ready in ${ready}`;
  // Round 4: the 10 h run from the call, and a reserve is not called 22:00–06:00 (standby.ts reserveContact).
  if (s.kind === 'reserve') return `Reserve · from ${fmtTime(Math.max(reserveContact(g, s.at), s.from) + s.readyMin, s.at)} (10 h notice)`;
  const early = (s.from + offsetAt(c.base, s.from)) % DAY < 12 * 60;
  return `Home standby (${early ? 'early' : 'late'}) · ready in ${ready}`;
}

/** v0.9 how a standby kind reads in a sentence. */
const SBY_WORD: Record<StandbyKind, string> = { home: 'home standby', hotel: 'hotel standby', airport: 'airport standby', reserve: 'reserve' };

/**
 * Candidates for a missing seat: legal after their trip, not on the pairing; `here`: at the airport (call-in) or not
 * (deadhead). v0.9 (§R.4) a call-in takes airport standby first, then hotel or home standby, then reserve, then crew
 * off duty on a rest day, and last someone on a planned day off; flying someone in lists standby crew first.
 */
function seatCandidates(g: GameState, d: Duty, role: Role, here: boolean): DutyCandidate[] {
  const list = candidatesOf(g, d, role).filter((c) => !c.onPairing && c.level !== 'illegal' && (here ? !c.travel : !!c.travel));
  // On a window now before one starting later (short notice).
  const rank = (c: DutyCandidate) => (c.dayOff ? 5 : !c.standby ? 4 : c.standby.kind === 'airport' ? 1 : c.standby.kind === 'reserve' ? 3 : c.standby.from <= g.now ? 2 : 2.5);
  return list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

/**
 * Round 4: why nobody at the departure airport can be called in. A crew member on standby there who is not legal for
 * it (the awake cap, rest, a limit) is named with that reason, so the refusal never reads as 'nobody' beside a
 * standby row on the board; else the plain line.
 */
function nobodyFree(g: GameState, x: Ctx, d: Duty): string {
  for (const role of new Set(x.seats)) {
    const LIMIT = new Set(['rest', 'fdp', 'hours', 'recovery']);
    const c = candidatesOf(g, d, role).find((y) => !y.onPairing && !y.travel && y.level === 'illegal' && y.reasons.length && (y.standby || (y.reason && LIMIT.has(y.reason.code))));
    if (c) {
      const r = c.reasons[0].replace(/\.$/, '');
      return `${c.name}${c.standby ? ` on ${SBY_WORD[c.standby.kind]}` : ''} cannot take it: ${r.charAt(0).toLowerCase()}${r.slice(1)}`;
    }
  }
  return `Nobody is free at ${city(x.dep)} today`;
}

/** v0.9 §T the seats a new crew member can take: empty ones, then those held by crew out of hours. */
const jetSeats = (x: Ctx): { role: Role; replaces?: string }[] => [...x.missing.map((role) => ({ role })), ...x.replace.map((r) => ({ role: r.role, replaces: r.crewId }))];

/**
 * v0.9 §Y.1 an augmented duty whose in-flight rest plan still fails after the change: why, in words (null: fine).
 * v0.9 round 4: judged at the gate (the actual off-block time; a replacement's own report), and a plan that works
 * again clears the seats' rest marks at once.
 */
function restStillFails(h: GameState, dutyId: string): string | null {
  const d = h.duties[dutyId];
  if (!d || d.augment === 0 || d.legacyRest) return null;
  const f = h.flights[d.flightIds[0]];
  const at = f && d.report <= h.now ? Math.max(f.std + f.delay, h.now) : undefined;
  const plan = restPlan(h, d.id, at !== undefined ? { at } : {});
  if (plan?.ok === false) {
    const p = h.pairings[d.pairingId];
    const old = p ? p.slots.filter((s) => s.crewId && s.ooh?.limit === 'inflightRest' && s.from === undefined).length : 0;
    return old ? `${old} of the cabin crew keep the old day: the rest plan only works with a whole fresh cabin crew` : 'Even with fresh crew the in-flight rest plan does not work after this delay: delay for rest or swap';
  }
  if (f) clearRestMarks(h, f);
  return null;
}

/** The default (or chosen) crew per missing seat, one person each, from a candidate list per role. */
function pickCrew(x: Ctx, lists: Map<Role, DutyCandidate[]>, chosen?: string[], ok: (crewId: string) => boolean = () => true): { role: Role; crewId: string; replaces?: string }[] {
  const out: { role: Role; crewId: string; replaces?: string }[] = [];
  const used = new Set<string>();
  // v0.9 §T the empty seats first, then the seats of crew out of hours (each pick names whom it replaces).
  for (const { role, replaces } of jetSeats(x)) {
    const list = lists.get(role) ?? [];
    // v0.9 a published day off is only ever taken when the player picks that person (R.5).
    const pick = chosen ? list.find((c) => chosen.includes(c.crewId) && !used.has(c.crewId)) : list.find((c) => !used.has(c.crewId) && !c.dayOff && ok(c.crewId));
    if (!pick) continue;
    used.add(pick.crewId);
    out.push({ role, crewId: pick.crewId, ...(replaces ? { replaces } : {}) });
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

/** A rest-before shortfall in a candidate's reasons ('Rest 13:55 < 14:00'; not 'Rest before next duty'). */
const REST_SHORT = /^Rest (\d+):(\d\d) < (\d+):(\d\d)$/;

/**
 * BLU1396 round: whether the roster can crew every empty seat of the flight as it stands (a candidate who is not
 * illegal, off no published day, per seat), the condition under which Crew Control may point to Auto-fix. Pure.
 */
function crewableOnTime(g: GameState, x: Ctx): boolean {
  const { d } = x;
  if (!d) return false;
  const need = new Map<Role, number>();
  for (const r of x.seats) need.set(r, (need.get(r) ?? 0) + 1);
  const used = new Set<string>();
  for (const [role, n] of need) {
    let k = 0;
    for (const c of candidatesOf(g, d, role)) {
      if (k >= n) break;
      if (c.onPairing || c.level === 'illegal' || c.dayOff || used.has(c.crewId)) continue;
      used.add(c.crewId);
      k++;
    }
    if (k < n) return false;
  }
  return true;
}

/** Why 'delay' has no time to offer: a crew can go on time (Auto-fix, when its preview or the candidates say so), or nobody can even later. */
function noDelayWhy(g: GameState, x: Ctx, autoFixWorks: boolean | null = null): string {
  const { f, ac } = x;
  // Auto-fix's own preview crews it on time (an out-of-hours crew member replaced included): the delay was not looked for.
  if (autoFixWorks) return 'A crew can take it on time: use Auto-fix';
  if (autoFixWorks !== false && crewAlertKind(g, f.id) !== 'hours' && readyOf(g, f, ac) <= f.std + f.delay && crewableOnTime(g, x)) return 'A crew can take it on time: use Auto-fix';
  return f.kind === 'positioning' ? 'The schedule re-plans empty legs itself: this one waits for a crew at the gate' : 'Nobody can take it even two days later';
}

/**
 * Crew-planning round: the rest a crew member needs after a ride from → the duty's first departure (std → sta) before
 * reporting, as the check reads it (posSeg: the ride's length or 10 h, 14 h across 4+ time zones), plus the cabin
 * crew's earlier report. Pure.
 */
function arrivalRest(g: GameState, p: Pairing, d: Duty, c: CrewMember, from: string, std: Minute, sta: Minute, charter = false): number {
  const to = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const t = { from, to, std, sta, ...(charter ? { charter: { cls: 'heavy' as JetClass, model: '', operator: '', reg: '' } } : {}) } as TicketPlan;
  return posSeg(t, c).rest + (c.role === 'PUR' || c.role === 'CC' ? cabinEarly(g, p, d) : 0);
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
  // v0.9 round 5 (speed): never past the caller's cap (the bot takes at most 6 h: 45 of its 49 copies a year tried a
  // later time it then refused; each is a full re-roster on a cold copy).
  const cap = x.maxDelay === undefined ? Infinity : (f.schedStd ?? f.std) + x.maxDelay;
  const add = (t: Minute) => {
    t = ceil5(t);
    if (t > floor && t - g.now <= 2 * DAY && t <= cap) times.add(t);
  };
  add(readyOf(g, f, ac));
  if (d && p) {
    const night = (atHome: boolean) => minRest({ dutyMin: 0, atHome, augmented: false, tzShift: 0 });
    for (const role of new Set(x.seats)) {
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
          // Crew-planning round: the rest the check really asks after that ticket (14 h across 4+ time zones, the
          // ticket's length when longer) and the cabin crew's earlier report.
          add(reach.earliestArrival + arrivalRest(g, p, d, cm, reach.from, reach.earliestArrival - dhBlock(reach.from, x.dep), reach.earliestArrival) + lead);
        }
        if (r?.code === 'fdp' || r?.code === 'rest') add(Math.max(g.now, cm.restUntil, c.arrives ?? 0) + night(c.loc === cm.base) + lead);
        // BLU1396 round: a crew member just short of the rest before it (cabin crew 'Rest 13:55 < 14:00' after the
        // ticket out) is legal once the departure moves by the shortfall: a small delay is tried too, with 5 min in hand.
        for (const t of c.reasons) {
          const m = REST_SHORT.exec(t);
          if (m) add(floor + (Number(m[3]) * 60 + Number(m[4])) - (Number(m[1]) * 60 + Number(m[2])) + 5);
        }
      }
    }
  }
  return [...times].sort((a, b) => a - b).slice(0, 6);
}

/**
 * v0.8 speed: a copy of the state for a preview. Duty logs and the inbox only ever grow by new entries, so the copy
 * gets its own arrays holding the same entries (a third cheaper than cloning them).
 */
export function previewCopy(g: GameState): GameState {
  const { crew, messages, ...rest } = g;
  const h = copyData(rest) as GameState;
  h.crew = {};
  for (const id in crew) {
    const { log, ...c } = crew[id];
    h.crew[id] = { ...copyData(c), log: log?.slice() ?? log };
  }
  h.messages = messages.slice();
  return h;
}

/**
 * v0.9 round 4 speed: a deep copy of save data (plain objects, arrays and primitives: what serialize writes), key
 * order and undefined values kept as structuredClone keeps them, at a third of its cost for this shape. Anything
 * else (nothing in a GameState) still goes through structuredClone.
 */
function copyData<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = copyData(v[i]);
    return out as T;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return structuredClone(v);
  const out: Record<string, unknown> = {};
  for (const k in v) out[k] = copyData((v as Record<string, unknown>)[k]);
  return out as T;
}

/** The soonest of delayTimes at which the roster crews the flight, tried on copies; null when none works. Memoized per step. */
function delayPlan(g: GameState, x: Ctx): { at: Minute } | null {
  return memoOf(g, `dp:${x.f.id}:${x.maxDelay ?? ''}`, () => {
    const tryAt = (at: Minute) => {
      const h = previewCopy(g);
      previewing++;
      try {
        // A dry run on a copy: no cue, no pause reaches the live game (core/pause.ts).
        return isolatePauses(() => tryDelay(h, x.f.id, at));
      } catch {
        return false;
      } finally {
        previewing--;
      }
    };
    // v0.8 speed: the latest time first: when even that leaves the flight short, the earlier ones do too (a later
    // departure only gives crews more time), so a hopeless flight costs one copy instead of six.
    const times = delayTimes(g, x);
    const last = times[times.length - 1];
    if (last === undefined || !tryAt(last)) return null;
    // v0.9 speed: the earliest that works by halving (same monotone reading: a later time works when an earlier does).
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tryAt(times[mid])) hi = mid;
      else lo = mid + 1;
    }
    return { at: times[lo] };
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
      const sal = salariesNow(h);
      planNow(h, f);
      const changes = seatChanges(h, f, before).filter((c) => !/still missing$/.test(c));
      if (!changes.length) return { ok: false, error: 'Nobody legal is free: see the other fixes' };
      // v0.12.1 a day off the roster bought back is its cost (the pay), said on the line.
      return { ok: true, changes: [...changes, ...seatChanges(h, f, before).filter((c) => /still missing$/.test(c))], cost: Math.max(0, salariesNow(h) - sal) };
    }
    case 'deadhead':
    case 'callIn': {
      if (!d) return { ok: false, error: 'No crew plan for this flight yet' };
      const lists = new Map<Role, DutyCandidate[]>();
      for (const role of new Set(x.seats)) lists.set(role, seatCandidates(h, d, role, fix === 'callIn'));
      // The trip's span, a day of travel before it included for a ticket out (a ticket on a day off takes it too); a
      // call-in at the airport only the duty itself.
      const span: [Minute, Minute] = [fix === 'callIn' ? d.report : d.report - DAY, (p ? openDuties(h, p).at(-1)?.release : undefined) ?? d.release];
      const picks = pickCrew(x, lists, opts.crewIds, (id) => !takesPublishedOff(h, h.crew[id], span[0], span[1]));
      if (!picks.length) return { ok: false, error: fix === 'callIn' ? nobodyFree(h, x, d) : 'Nobody legal can be flown in' };
      const changes: string[] = [];
      let cost = 0;
      const had = new Set(Object.values(h.flights).filter((t) => t.kind === 'deadhead').map((t) => t.id));
      for (const { role, crewId, replaces } of picks) {
        // v0.9 a standby window for this report (running, or starting soon: short notice) is a call-out, no overtime.
        const onSby = !!(lists.get(role) ?? []).find((x) => x.crewId === crewId)?.standby;
        // v0.9 §T a seat held by crew out of hours: they come off it as the new crew member takes it.
        const r = assignCrew(h, f.id, crewId, role, replaces && h.pairings[p!.id]?.slots.some((s) => s.crewId === replaces) ? { replace: replaces } : {});
        if (!r.ok) continue;
        const c = h.crew[crewId];
        if (replaces && h.crew[replaces]) changes.push(`${crewName(h.crew[replaces])} comes off (out of hours)`);
        // (placing them may already have called them out: the roster counts a placement inside a running window)
        if (fix === 'callIn' && (callFromStandby(h, crewId) || calledNow(h, crewId) || onSby)) {
          const nd = h.duties[d.id] ?? d;
          const seg = segsOf(h, c).find((x) => x.dutyId === nd.id && x.kind === 'duty');
          const until = seg ? seg.start + seg.maxFdp : nd.report + nd.maxFdp;
          const cut = seg && seg.maxFdp < nd.maxFdp + (nd.discretion ?? 0) + (c.role === 'PUR' || c.role === 'CC' ? cabinEarly(h, h.pairings[nd.pairingId] ?? p!, nd) : 0);
          changes.push(`${role === 'CPT' ? 'Capt. ' : ''}${crewName(c)} called from standby: no overtime; their day may run to ${fmtTime(until)} UTC${cut ? ' (the standby shortens it)' : ''}`);
        } else if (fix === 'callIn') {
          const ot = overtimeOf(c);
          post(h, 'salaries', -ot);
          // v0.9 a planned day off taken (crew/dayPlan.ts takeOffDays, on placing) costs its own −6 instead.
          const wasOff = (lists.get(role) ?? []).find((x) => x.crewId === crewId)?.dayOff;
          if (!wasOff) moraleShock(h, c, 'pay', CC().callInMorale);
          cost += ot;
          changes.push(`${crewName(c)} called in for the ${ROLE_WORD[role][0]} seat${wasOff ? ' on a day off' : ''} (${usd(ot)} overtime, morale −${Math.abs(wasOff ? BAL.v09.roster.morale.broken : CC().callInMorale)})`);
        } else {
          changes.push(`${crewName(c)} takes the ${ROLE_WORD[role][0]} seat${rideText(h, h.duties[d.id] ?? d, crewId)}`);
          if (h.pairings[p!.id]) cost += ticketsBought(h, h.pairings[p!.id], crewId, had);
        }
      }
      if (!changes.length) return { ok: false, error: 'The roster refused every candidate' };
      const restBad = restStillFails(h, d.id);
      if (restBad) return { ok: false, error: restBad };
      const still = h.pairings[p!.id] ? group(h.pairings[p!.id].slots.filter((s) => !s.crewId && !s.above).map((s) => s.role)) : [];
      if (still.length) changes.push(`${seatsText(still)} still missing`);
      return { ok: true, changes, cost };
    }
    case 'delay': {
      // The departure comes from the roster's own answer (delayPlan tried it on copies); never a guess that
      // leaves the seats empty.
      const at0 = opts.at ?? delayPlan(h, x)?.at;
      if (at0 === undefined) return { ok: false, error: noDelayWhy(h, x) };
      if (at0 <= f.std + f.delay) return { ok: false, error: noDelayWhy(h, x) };
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
      const picks: { c: CrewMember; ready: Minute; loc: string; replaces?: string }[] = [];
      const seatOf = jetSeats(x);
      for (const { role, replaces } of seatOf) {
        const list = jetCandidates(h, p, d, role, used, cls);
        const pick = opts.crewIds ? list.find((y) => opts.crewIds!.includes(y.c.id)) : list[0];
        if (!pick) continue;
        used.add(pick.c.id);
        picks.push({ c: pick.c, ready: pick.ready, loc: pick.loc, replaces });
      }
      // Jet + rest (opts.at): the crew land, rest a night and take the flight the next day.
      if (!picks.length && opts.at !== undefined) {
        for (const { role, replaces } of seatOf) {
          const pick = jetRestCandidates(h, p, d, role, used)[0];
          if (!pick) continue;
          used.add(pick.c.id);
          picks.push({ c: pick.c, ready: pick.ready, loc: pick.loc, replaces });
        }
      }
      if (!picks.length) return { ok: false, error: 'Nobody legal is free anywhere' };
      if (cls && picks.some((y) => distance(y.loc, x.dep) / NM > CC().jet.rangeNm[cls] * 2)) return { ok: false, error: `A ${JET_CLASS_LABEL[cls].toLowerCase()} cannot fly that far with one fuel stop` };
      // Even a jet may land after the report: the flight is delayed first by the gap.
      let latest = 0;
      const byLoc = new Map<string, { n: number; ready: Minute }>();
      for (const y of picks) byLoc.set(y.loc, { n: (byLoc.get(y.loc)?.n ?? 0) + 1, ready: Math.max(byLoc.get(y.loc)?.ready ?? 0, y.ready) });
      for (const [loc, v] of byLoc) latest = Math.max(latest, jetQuote(h, loc, x.dep, v.n, v.ready, cls).arrives);
      const changes: string[] = [];
      const gap = Math.max(latest + OUT_CONNECT - d.report, opts.at !== undefined ? opts.at - f.std : 0);
      if (gap > 0 && f.kind === 'positioning') return { ok: false, error: 'The schedule re-plans empty legs itself: a jet landing after the departure is no fix' };
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
      // v0.9 §T crew out of hours come off their seats for the jet's crew.
      const hp = h.pairings[p.id];
      for (const y of picks) if (y.replaces && hp?.slots.some((s) => s.crewId === y.replaces)) {
        releaseCrew(h, hp, y.replaces);
        changes.push(`${crewName(h.crew[y.replaces])} comes off (out of hours)`);
      }
      const r = charterJet(h, f.id, picks.map((y) => y.c.id).filter((id) => !heldBy(ctxOf(h, flightId)?.p).has(id)), cls ?? jetClassFor(picks.length, distance(picks[0].loc, x.dep) / NM));
      if (!r.ok) return { ok: false, error: r.error?.startsWith('Nobody could be seated on the trip') ? r.error.replace('Nobody could be seated on the trip', 'Even flown in by jet, nobody is legal for the trip') : r.error };
      // v0.9 round 4 (§Y.1): after the report, the jet's crew start a fresh day in the seats they took over.
      if (d.report <= h.now && hp) for (const y of picks) if (y.replaces) for (const sl of hp.slots) if (sl.crewId === y.c.id) sl.from = freshReport(h, hp, h.duties[d.id] ?? d);
      const restBad = restStillFails(h, d.id);
      if (restBad) return { ok: false, error: restBad };
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
      const sal = salariesNow(h);
      const swapped: string[] = [];
      const sources = swapSources(h, x);
      const q = (opts.optionId ? sources.find((s) => s.p.id === opts.optionId) : sources[0])?.p;
      if (!q) return { ok: false, error: 'No other crew within two days can take it' };
      const changes: string[] = [];
      const qFirst = h.flights[openDuties(h, q)[0]?.flightIds[0] ?? ''];
      for (const role of x.missing) {
        const seat = p.slots.findIndex((s) => !s.crewId && !s.above && s.role === role);
        if (seat < 0) continue;
        // v0.9.1: never someone the move would leave under the month's legal days off (seed 6: a swap on 31 January took a
        // purser's last two days off; a day off the month can spare is still taken, with its morale).
        // v0.12.1 nor anyone the move leaves illegal on this trip (in the air, out of reach, a hard limit): only a day
        // off a buy-back lifts may stand in the way, and that day is bought.
        // Debug round (26 Oct 2026): never someone already on this trip (seed 1: the captain of AWL298 was also rostered
        // on AWL306 and the swap seated him in AWL298's first officer seat too, one pilot in both seats).
        const donor = q.slots.find((s) => s.crewId && canFill(role, s.role) && h.crew[s.crewId] && !p.slots.some((y) => y.crewId === s.crewId) && swapLevel(h, p, q, h.crew[s.crewId]) !== 'illegal');
        if (!donor) continue;
        const c = h.crew[donor.crewId!];
        swapped.push(c.id);
        const offBefore = c.boughtOff?.length ?? 0;
        releaseCrew(h, q, c.id);
        placeCrew(h, p, seat, c, { what: f.no, quiet: true });
        p.slots[seat].locked = true;
        moraleShock(h, c, 'lateChange', CC().swapMorale);
        const bought = (c.boughtOff?.length ?? 0) > offBefore;
        changes.push(`${crewName(c)} moves from ${qFirst?.no ?? 'the other trip'} to the ${ROLE_WORD[role][0]} seat${rideText(h, d, c.id)}${bought ? ', working a day off' : ''}`);
      }
      if (!changes.length) return { ok: false, error: 'That crew has nobody for these seats' };
      touchCrew(h);
      if (q.aircraftId) rerosterFrom(h, q.aircraftId, h.now);
      // v0.12.1 seats the other crew could not fill go to the roster (its buy-back included when automatic).
      const hp = h.pairings[p.id];
      const moved = new Set([...before, ...swapped]);
      if (hp?.slots.some((s) => !s.crewId && !s.above)) planNow(h, h.flights[f.id] ?? f);
      changes.push(...seatChanges(h, f, moved).filter((c) => !/still missing$/.test(c)));
      if (qFirst) {
        const cs = flightCrewStatus(h, qFirst.id);
        changes.push(cs.level === 'missing' || cs.level === 'illegal' ? `${qFirst.no} then needs ${seatsText(group(cs.missing)) || 'a legal crew'}` : `${qFirst.no} is still crewed`);
      }
      return { ok: true, changes, cost: Math.max(0, salariesNow(h) - sal) };
    }
    case 'buyBack': {
      if (!d || !p) return { ok: false, error: 'No crew plan for this flight yet' };
      const picks = buyBackPicks(h, f.id, opts.crewIds);
      if (!picks.length) return { ok: false, error: buyBackNone(h, x) };
      const changes: string[] = [];
      let cost = 0;
      for (const y of picks) {
        const seat = p.slots.findIndex((s) => !s.crewId && !s.above && s.role === y.role);
        if (seat < 0) continue;
        const had = new Set(Object.keys(h.flights).filter((id) => h.flights[id].kind === 'deadhead'));
        placeCrew(h, p, seat, y.c, { what: f.no, quiet: true });
        cost += y.bb.cost + ticketsBought(h, p, y.c.id, had);
        changes.push(`${crewName(y.c)} ${y.bb.clip ? 'ends the day off on' : 'works the day off on'} ${dayLabel(y.bb.worked)}${y.bb.clip ? ' early' : ''} for the ${ROLE_WORD[y.role][0]} seat (${usd(y.bb.cost)})${rideText(h, d, y.c.id)}. ${repayText(y.c, y.bb).replace(/\.$/, '')}`.trim());
      }
      if (!changes.length) return { ok: false, error: buyBackNone(h, x) };
      const still = group(p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role));
      if (still.length) changes.push(`${seatsText(still)} still missing`);
      return { ok: true, changes, cost };
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

/**
 * v0.12.1 how crew member c of trip q would stand on p after a swap: illegal when in the air or a hard limit bites;
 * blocked only by days off reads 'tight' when a buy-back lifts them (the swap buys the day). Pure.
 */
function swapLevel(g: GameState, p: Pairing, q: Pairing, c: CrewMember): Legality {
  if (inTheAir(g, c.id)) return 'illegal';
  const segs = segsOf(g, c, q.id).filter((s) => !s.dutyId || !p.dutyIds.includes(s.dutyId));
  const plan = planCrew(g, c, p, segs, false, 0, q.id);
  const lv = levelOf(plan.issues.filter((i) => i.code !== 'fdp'));
  if (lv !== 'illegal') return lv;
  return buyBackFor(g, c, plan, segs) ? 'tight' : 'illegal';
}

/** v0.12.1 why nobody can be asked to work a day off. */
function buyBackNone(g: GameState, x: Ctx): string {
  if (!x.missing.length) return fullWhy(x);
  for (const role of new Set(x.missing)) {
    const off = x.d ? candidatesOf(g, x.d, role).find((c) => !c.onPairing && c.codes.includes('daysOff')) : undefined;
    if (off) {
      const c = g.crew[off.crewId];
      if (c?.boughtOff?.length && off.codes.length === 1) return `${off.name} already worked a day off this month`;
      return `${off.name} is held back by more than a day off: ${(off.reason?.text ?? off.reasons[0] ?? '').replace(/\.$/, '')}`;
    }
  }
  return 'Nobody is held back only by a day off';
}

/** Other planned trips of the same family whose crew could take this trip's missing seats (report within ±48 h). */
function swapSources(g: GameState, x: Ctx): { p: Pairing; first: Flight | undefined; legal: Legality }[] {
  const { d, p } = x;
  if (!d || !p) return [];
  const fam = typeOf(typeIdOf(g, p)).family;
  const out: { p: Pairing; first: Flight | undefined; legal: Legality; report: Minute; covered: number }[] = [];
  for (const q of Object.values(g.pairings)) {
    if (q.id === p.id || !q.aircraftId || q.status !== 'planned' || q.tour || crewCount(q) === 0 || typeOf(typeIdOf(g, q)).family !== fam) continue;
    const open = openDuties(g, q);
    if (!open.length || open[0].report <= g.now || Math.abs(open[0].report - d.report) > 48 * 60) continue;
    let legal: Legality = 'legal';
    let covered = 0;
    const taken = new Set<string>();
    for (const role of x.missing) {
      // v0.12.1 one donor per seat, never one in the air, and only someone who can then legally fly it (a day off a
      // buy-back lifts counts: the preview names it): the swap moved a Lisbon first officer whose ticket to Goma had left.
      const donor = q.slots.find((s) => s.crewId && !taken.has(s.crewId) && canFill(role, s.role) && g.crew[s.crewId] && !p.slots.some((y) => y.crewId === s.crewId) && swapLevel(g, p, q, g.crew[s.crewId]) !== 'illegal');
      if (!donor) continue;
      taken.add(donor.crewId!);
      covered++;
      if (swapLevel(g, p, q, g.crew[donor.crewId!]) === 'tight') legal = 'tight';
    }
    if (!covered) continue;
    out.push({ p: q, first: g.flights[open[0].flightIds[0]], legal, report: open[0].report, covered });
  }
  // v0.12.1 the trip whose crew fills the most seats first, then the nearest report.
  out.sort((a, b) => b.covered - a.covered || a.report - b.report || (a.p.id < b.p.id ? -1 : 1));
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
  const h = previewCopy(g);
  previewing++;
  let r: Run;
  try {
    r = isolatePauses(() => runFix(h, x.f.id, fix, opts));
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

const possessiveName = (n: string) => (/s$/i.test(n) ? `${n}'` : `${n}'s`);

/**
 * v0.8 fix pack: why a private jet is not offered: 'A jet would land after TP 1541 (16:12 vs 14:45): not offered' when
 * the cheaper fix waits for that airline flight, else 'A jet would leave no sooner than the delay (18:15 vs 16:45)'. Pure.
 */
function jetBeaten(g: GameState, x: Ctx, beat: CrewSolution, jetLands: Minute, jetLeaves: Minute): string {
  const reach = beat.id === 'delay' ? crewShortCard(g, x.f.id)?.visuals.reach : undefined;
  const leg = reach?.legs[reach.legs.length - 1];
  if (leg && jetLands >= leg.arr) return `A jet would land after ${leg.no} (${at(jetLands, g.now)} vs ${at(leg.arr, g.now)}): not offered`;
  const tk = beat.id === 'deadhead' ? beat.options?.[0] : undefined;
  if (tk?.arrives !== undefined && jetLands >= tk.arrives) return `A jet would land after ${possessiveName(tk.label.split(' · ')[0])} airline ticket (${at(jetLands, g.now)} vs ${at(tk.arrives, g.now)}): not offered`;
  const what = beat.id === 'delay' ? 'the delay' : beat.id === 'deadhead' ? 'a crew on a ticket' : beat.id === 'callIn' ? 'calling someone in' : 'the auto-fix';
  return `A jet would leave no sooner than ${what} (${at(jetLeaves, g.now)} vs ${at(beat.newDeparture ?? x.f.std, g.now)}): not offered`;
}

/** Why no new crew member helps when every seat is held: the duty itself is too long, or nothing is wrong with a seat. */
function fullWhy(x: Ctx): string {
  const { g, f, d, p } = x;
  // Round 4: judged on a fresh crew's own day from the held departure, not the hours the first crew waited.
  if (d && dutyOver(g, f, d) && (!p || d.report > g.now || freshOver(g, f, d, p))) return 'The day itself is too long: a fresh crew would be over the limit too';
  return 'Every seat is taken';
}

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
    if (!d || !x.seats.length) {
      out.push(no(s, x.seats.length ? 'No crew plan for this flight yet' : fullWhy(x)));
      continue;
    }
    const options: FixOption[] = [];
    const lists0 = new Map<string, DutyCandidate>();
    for (const role of new Set(x.seats)) {
      for (const c of seatCandidates(g, d, role, id === 'callIn').slice(0, 6)) {
        lists0.set(c.crewId, c);
        const cm = g.crew[c.crewId];
        const sby = id === 'callIn' ? c.standby : undefined;
        const ot = id === 'callIn' && !sby ? overtimeOf(cm) : 0;
        const morale = c.dayOff ? BAL.v09.roster.morale.broken : CC().callInMorale;
        options.push({
          id: c.crewId, label: `${c.name}${sby ? '' : ` · ${c.loc}`}${sby ? ` · ${sbyText(g, cm, sby)}` : id === 'callIn' ? (c.dayOff ? ' · Day off: called in' : ' · Off duty: called in') : c.standby ? ` · ${SBY_LABEL[c.standby.kind]}` : ''}`,
          sub: sby ? 'No overtime' : id === 'callIn' ? `${usd(ot)} overtime · morale ${morale}` : `${c.travel ?? ''} · ${c.level === 'tight' ? 'tight after' : 'legal after'}`,
          cost: id === 'callIn' ? ot : c.ticket, arrives: c.arrives, level: c.level, reason: c.reason,
        });
      }
    }
    if (!options.length) {
      out.push(no(s, id === 'callIn' ? nobodyFree(g, x, d) : 'Nobody legal is free elsewhere'));
      continue;
    }
    s.options = options;
    const first = options[0];
    s.cost = first.cost;
    const firstC = (lists0.get(first.id) ?? null);
    // Round 4: the blurb follows the pick (the static one read as both free and priced for an off-duty pick).
    // v0.12.1 a pick riding our own flight says so.
    const own = id === 'deadhead' ? /^Flies out on our own (\S+)/.exec(firstC?.travel ?? '') : null;
    if (own) s.desc = `A free crew member flies out on our own ${own[1]} as a passenger: no ticket.`;
    if (id === 'callIn') s.desc = !first.cost ? 'Crew on standby come in: no overtime; a long standby shortens their day.' : `${firstC?.dayOff ? 'A day off' : 'Off duty'}: ${usd(first.cost)} overtime, morale ${firstC?.dayOff ? BAL.v09.roster.morale.broken : CC().callInMorale}.`;
    s.chips = id === 'callIn'
      ? (first.cost ? [usd(first.cost), `Morale ${firstC?.dayOff ? BAL.v09.roster.morale.broken : CC().callInMorale}`] : ['No overtime', firstC?.standby ? SBY_LABEL[firstC.standby.kind] : 'Standby'])
      : [usd(first.cost), first.arrives !== undefined ? hrs(first.arrives) : ''].filter(Boolean);
    out.push(run(s));
  }
  // v0.12.1 the buy-back: whoever only a day off holds back (at the departure first), with what it costs.
  if (want('buyBack')) {
    const s = base('buyBack');
    const picks = d && p && x.missing.length ? buyBackPicks(g, f.id) : [];
    if (!picks.length) out.push(no(s, d ? buyBackNone(g, x) : 'No crew plan for this flight yet'));
    else {
      const y = picks[0];
      s.label = picks.length === 1 ? `Ask ${crewName(y.c)} to work a day off` : `Ask ${picks.length} crew to work a day off`;
      s.desc = `${crewName(y.c)} is ${y.here ? `in ${city(x.dep)}` : `in ${city(y.c.loc)}`} and only a day off (${dayLabel(y.bb.worked)}) stands in the way. Paid at twice a day's pay; ${repayText(y.c, y.bb).replace(/\.$/, '')}.`;
      s.cost = picks.reduce((n, z) => n + z.bb.cost + z.ticket, 0);
      s.chips = [usd(s.cost), "2× a day's pay"];
      // One person per seat, so no options to pick from: each is named with the day and what comes back.
      s.consequences = picks.map((z) => `${crewName(z.c)} (${ROLE_WORD[z.role][0]}, ${z.here ? city(x.dep) : city(z.c.loc)}): day off ${dayLabel(z.bb.worked)}, ${usd(z.bb.cost)}`);
      out.push(run(s));
    }
  }
  // c. delay: the departure the roster itself accepts (tried on copies), never a guess.
  if (want('delay')) {
    const s = base('delay');
    // An out-of-hours crew is "ready" at the gate but may not go: never point to Auto-fix for it.
    // BLU1396 round: Auto-fix is named only when it can crew the flight (its own preview when there is one); when it
    // crews it on time, no delay is offered beside it.
    const af = out.find((o) => o.id === 'autoFix');
    const afWorks = previews && af ? af.available && !BAD(af.preview.after.level) && !af.newDeparture : null;
    const plan = afWorks ? null : delayPlan(g, x);
    if (!plan) out.push(no(s, noDelayWhy(g, x, afWorks)));
    else {
      const ready = plan.at;
      const k = contractOf(g, f);
      const late = ready - (f.schedStd ?? f.std);
      s.newDeparture = ready;
      s.cost = k?.product.kind === 'charter' && late > 180 ? k.penalties.perDelay : 0;
      s.chips = [`leaves ${at(ready, g.now)} (+${fmtDuration(ready - f.std)})`];
      s.confirm = true;
      const r = run(s, { at: ready });
      // Round 4: who the wait is for (the roster's own pick on the copy), so the row names a person, not just a time.
      const takes = r.available ? r.preview.changes.filter((c) => / takes the .+? seat/.test(c)).map((c) => c.replace(/ takes the (.+?) seat.*$/, ' ($1)')) : [];
      if (takes.length) r.consequences = [`${takes.slice(0, 3).join(', ')}${takes.length > 3 ? ` and ${takes.length - 3} more` : ''} legal from ${at(ready, g.now)}`, ...r.consequences].slice(0, 4);
      out.push(r);
    }
  }
  // d. jet: only for seats nobody at the departure airport can fill; with a night's rest on arrival when the
  // day would otherwise run too long (jet + rest).
  if (want('jet')) {
    const s = base('jet');
    if (!d || !p || !x.seats.length) out.push(no(s, x.seats.length ? 'No crew plan for this flight yet' : fullWhy(x)));
    else {
      const local = new Map<Role, DutyCandidate[]>();
      for (const role of new Set(x.seats)) local.set(role, seatCandidates(g, d, role, true));
      const localPicks = pickCrew(x, local);
      // Seats left after everyone free at the airport is seated: those a jet is quoted for.
      const need = new Map<Role, number>();
      for (const role of x.seats) need.set(role, (need.get(role) ?? 0) + 1);
      for (const y of localPicks) need.set(y.role, (need.get(y.role) ?? 0) - 1);
      const roles = x.seats.filter((role) => {
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
        // Code review: only classes that reach with one fuel stop at most (a light jet's 1,800 nm do not cross the
        // Atlantic in two hops: it was offered Lisbon–Montego Bay, 3,735 nm, as the cheapest jet).
        const reach = (cls: JetClass) => [...byLoc.keys()].every((loc) => distance(loc, x.dep) / NM <= CC().jet.rangeNm[cls] * 2);
        s.options = JET_CLASSES.filter((cls) => picks.length <= CC().jet.seats[cls] * 2 && reach(cls)).map((cls) => {
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
        // Crew-planning round: jet + rest waits the rest each crew member really needs after the ride (14 h across 4+
        // time zones; the cabin crew report earlier), not a flat 10 h (Lisbon–Montego Bay crew landed 4 h short of it
        // and the preview read 'Even flown in by jet, nobody is legal for the trip').
        if (rest) {
          for (const y of picks) {
            const q = jetQuote(g, y.loc, x.dep, byLoc.get(y.loc)!.n, byLoc.get(y.loc)!.ready);
            gap = Math.max(gap, q.arrives + arrivalRest(g, p, d, y.c, y.loc, q.wheelsUp, q.arrives, true) + lead - f.std);
          }
        }
        // v0.9 round 3: as for Delay, an empty leg is never held back for a jet: past the commitment it leads to, the
        // schedule re-plans it as a fresh, uncrewed leg at the earliest time, and the two fixes chased each other
        // (bot seed 5: dozens of copies of one OXB–LIS leg after an AOG, each a red alarm).
        if (f.kind === 'positioning' && gap > 0) out.push(no({ ...s, cost: 0, chips: [], newDeparture: null, consequences: [], options: undefined }, 'The schedule re-plans empty legs itself: a jet landing after the departure is no fix'));
        else {
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
          // v0.8 fix pack: no jet when a cheaper fix (auto-fix, a ticket, a call-in, the delay) leaves as soon, with
          // the fastest jet class at the cheapest price: one muted line says why instead.
          const leavesAt = (arr: Minute) => (rest ? s.newDeparture! : arr + OUT_CONNECT - d.report > 0 ? ceil5(f.std + arr + OUT_CONNECT - d.report) : f.std);
          const fastest = Math.min(...s.options.map((o) => o.arrives ?? Infinity), auto.arrives);
          const cheapest = Math.min(...s.options.map((o) => o.cost), auto.cost);
          const jetLeaves = leavesAt(fastest);
          // The airline story first (the delay waits for a named flight, a ticket lands sooner), then auto-fix and call-in.
          const beat = (['delay', 'deadhead', 'autoFix', 'callIn'] as const).map((id) => out.find((o) => o.id === id)).find((o) => !!o && o.available && !BAD(o.preview.after.level) && o.cost < cheapest && (o.newDeparture ?? f.std) <= jetLeaves);
          if (rest && dp && dp.at <= s.newDeparture!) out.push(no({ ...s, cost: 0, chips: [], newDeparture: null, consequences: [] }, 'An airline ticket and a night\'s rest get a crew there just as soon: use Delay until crew arrives'));
          else if (beat) out.push({ ...no({ ...s, cost: 0, chips: [], newDeparture: null, consequences: [], options: undefined }, jetBeaten(g, x, beat, fastest, jetLeaves)), dominated: true });
          else out.push(run(s, rest ? { at: s.newDeparture! } : {}));
        }
      }
    }
  }
  // f. discretion
  if (want('discretion')) {
    const s = base('discretion');
    const over = d ? d.fdp - d.maxFdp - (d.discretion ?? 0) : 0;
    if (!d) out.push(no(s, 'No duty'));
    else if (x.missing.length) out.push(no(s, "Seats are empty: discretion doesn't crew a flight"));
    else if (!discretionCheck(g, d.id).ok) out.push(no(s, discretionCheck(g, d.id).why));
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
      // v0.9 language pass: the hit is in the chips; the line says only who flies what.
      s.consequences.push(`${q.rivalName} flies ${plural(q.revenueLegs, 'leg')}`);
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
  // A jet not offered (v0.8 fix pack) goes last: the panel shows it as one muted line under the rows.
  // v0.9 §T crew out of hours: a call-in from standby leads at equal cost, as the card says ('Replace X: Y is on standby').
  const order = (id: CrewFix) => (x.replace.length && id === 'callIn' ? -1 : FIX_ORDER.indexOf(id));
  const ranked = [...out].sort((a, b) => Number(!!a.dominated) - Number(!!b.dominated) || Number(b.available) - Number(a.available) || score(a) - score(b) || order(a.id) - order(b.id));
  ranked.forEach((s, i) => (s.rank = i + 1));
  return ranked;
}

/** Crew Control for a flight: missing seats, the card and the nine ranked solutions with previews (v0.7.3 `only`: just those fixes). Pure in g. */
export function crewControl(g: GameState, flightId: string, opts: { previews?: boolean; only?: readonly CrewFix[]; noCard?: boolean; maxDelayMin?: number } = {}): CrewControlView | null {
  const x = ctxOf(g, flightId, opts.maxDelayMin);
  if (!x) return null;
  // v0.9 §T crew out of hours gets its own card (who, which limit, by how much), as in the inbox. `noCard` (the bot,
  // applyCrewFix): the stage from the crew status alone, the card left empty.
  const bad = x.cs.level === 'missing' || x.cs.level === 'illegal';
  const card = opts.noCard ? null : crewAlertKind(g, flightId) === 'hours' ? crewHoursCardHook?.(g, flightId) ?? crewShortCard(g, flightId) : crewShortCard(g, flightId);
  const { f, ac, d, p } = x;
  const hoursLeft = Math.round(((f.std - g.now) / 60) * 10) / 10;
  const stage: CrewControlView['stage'] = !(opts.noCard ? bad : card) ? 'ok' : f.std + f.delay <= g.now || f.crewHeld ? 'gate' : hoursLeft <= CC().redH ? 'red' : 'amber';
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

/** v0.9 ops/heads.ts: a fix applied to a flight (a player's fix soon after a head's counts as an override). */
let fixHook: ((g: GameState, flightId: string) => void) | null = null;
export function setFixHook(f: typeof fixHook): void {
  fixHook = f;
}

/** Applies a Crew Control fix on the live state (availability re-checked; confirms honoured); one info message. */
export function applyCrewFix(g: GameState, flightId: string, fix: CrewFix, opts: ApplyOpts = {}): ActionResult<{ changes: string[]; after: CrewControlView | null }> {
  const view = crewControl(g, flightId, { previews: false, only: [fix], noCard: true });
  if (!view) return { ok: false, error: 'Flight not found or already left' };
  const s = view.solutions.find((y) => y.id === fix);
  if (!s) return { ok: false, error: 'Unknown fix' };
  if (!s.available) return { ok: false, error: s.why ?? 'Not available' };
  if (s.confirm && !opts.confirmed) return { ok: false, error: 'Needs confirmation' };
  const kind = crewAlertKind(g, flightId);
  // The departure the row previewed (delay, jet + rest) is the one applied.
  const r = runFix(g, flightId, fix, (fix === 'delay' || fix === 'jet') && opts.at === undefined && s.newDeparture ? { ...opts, at: s.newDeparture } : opts);
  if (!r.ok) return r;
  const st = stats(g);
  st.crewFixes = { ...(st.crewFixes ?? {}), [fix]: ((st.crewFixes ?? {})[fix] ?? 0) + 1 };
  if (fix === 'subcharter' || fix === 'cancel') v09Stats(g).legalStreak = 0;
  fixHook?.(g, flightId);
  const f = g.flights[flightId];
  const cs = f && f.aircraftId && f.status === 'scheduled' ? flightCrewStatus(g, flightId) : null;
  const fixed = !cs || !BAD(cs.level);
  // One message per event: a cancellation posts its own (with the hurt) from here.
  if (fix === 'cancel') {
    const unit = view.unit.flightIds.map((id) => g.flights[id]).filter((l): l is Flight => !!l && l.status === 'cancelled');
    // v0.9 round 4 (§V): 'cancelled' once (the title), the leg count once; the legs, the reason and what it costs.
    pushMessage(g, {
      tone: view.unit.revenueLegs ? 'bad' : 'info', cat: 'crew', title: `${view.no} cancelled${unit.length > 1 ? ` with ${unit.length - 1} more` : ''}: ${kind === 'hours' ? 'crew out of hours' : 'crew shortage'}`,
      body: `${unit.map((l) => `${l.no} ${l.from}–${l.to}`).join(', ')}: no legal crew. ${r.cost ? `${usd(r.cost)} compensation` : 'No compensation'}${view.unit.revenueLegs ? ', reliability −3' : ''}.`,
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
