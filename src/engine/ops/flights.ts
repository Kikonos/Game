// Flight execution state machine (B3). DESIGN.md §5.5.
// Conventions: std/sta are the current schedule (delays move them through retimeFlight); `schedStd` keeps the
// original STD; `delay` is a hold at the gate not folded into std (crew wait, decision pending, a short delay to
// the last leg of a duty under way). A hold never lets a leg slip entirely into the past: contracts treats such
// legs as gone and plans a duplicate.

import { BAL } from '../core/balance';
import { cancelFlight, flightsOf, removeFlights, retimeFlight, subcharterFlights, touchFlights, touchStatus, touchTickets } from '../core/entities';
import { invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { blockMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, next, pick, range } from '../core/rng';
import { DAY, fmtDuration, fmtTime, monthKey } from '../core/time';
import type { ActionResult, Aircraft, Contract, Duty, Flight, GameState, MaintenanceEvent, Message, MessageCat, Minute, Rival, SimEvent } from '../core/types';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { distance } from '../core/geo';
import { noteLostLegs } from '../contracts/billing';
import { isSoft } from '../contracts/plan';
import { applyDiscretion, boardCrew, crewIssuesFor, dropStraySpares, flightCrewStatus, guardDuty, rerosterFrom, restPlan, restSeatsBlocked, setRestDelayHook } from '../crew';
import { cue } from '../core/cues';
import { v09Stats } from '../crew/dayPlan';
import { requestPause } from '../core/pause';
import { problemFor } from '../problems';
import { noteIncident } from './company';
import { deliveryWaitDay } from './delivery';
import { crewReadyAt, crewShortDecision, hasOpenDecision } from './events';
import { aogChance, isGrounded, missCheck, startAog } from './maintenance';
import { ageF, ageOf, bumpReliable, contractOf, isBaseLeg, isRevenue, stats, turnOf, usd } from './util';
import { bumpClient, forgiveDelay, LEVEL_NAME, levelOf, statsV08 } from '../contracts/relations';
import { closedAtDeparture, payWarRisk, strikeDelay, whiteout } from './world';
import { isActive, noteHiredThem } from '../contracts/rivals';

/** v0.7.1: the problem ref and hurt snapshot of a message about legs lost or handed over (after the fact). */
function penaltyMeta(g: GameState, rev: Flight[], money: number): Pick<Message, 'problem' | 'hurt'> {
  const k = rev[0] ? contractOf(g, rev[0]) : undefined;
  const pax = rev.reduce((n, f) => n + (f.pax ?? 0), 0);
  return { problem: k ? { kind: 'penalty', ref: { kind: 'contract', id: k.id } } : undefined, hurt: { money, pax, delayMin: 0, level: money >= BAL.crewControl.hurtLowUsd || pax >= BAL.crewControl.hurtLowPax ? 'high' : money || pax ? 'low' : 'none' } };
}

// ---------- schedule changes ----------

/** Minutes a flight runs (or ran) behind its original schedule (UI). */
export function delayOf(f: Flight): number {
  const off = f.atd ?? f.std + f.delay;
  return Math.max(0, off - (f.schedStd ?? f.std));
}

/** Original scheduled arrival (before ops delays). */
export const schedSta = (f: Flight): Minute => f.sta - (f.std - (f.schedStd ?? f.std));

/** Moves a scheduled leg to `std` (block kept), remembering the original STD. */
export function moveFlight(g: GameState, f: Flight, std: Minute, reason?: string): void {
  if (f.status !== 'scheduled') return;
  f.schedStd ??= f.std;
  f.delay = 0;
  if (reason) f.delayReason = reason;
  retimeFlight(g, f, std, std + f.block);
}

/**
 * Holds a departure `min` minutes without re-planning (same event version). Once the leg could no longer arrive
 * on its schedule the hold is folded into std (a retime that pushes the later legs as far as turn minima need),
 * so it stays visible to the other modules.
 */
export function holdFlight(g: GameState, f: Flight, min: number): void {
  f.heldAt ??= g.now;
  if (f.sta <= g.now + min) return ripple(g, f, g.now + min);
  f.delay += min;
  schedule(g, g.now + min, 'flight.dep', f.id, f.ev);
  touchFlights(g);
}

/** Re-queues a departure without touching the schedule (no revision bump, so nobody re-plans around it). */
function quietHold(g: GameState, f: Flight, min: number): void {
  f.heldAt ??= g.now;
  if (f.sta <= g.now + min) return ripple(g, f, g.now + min);
  f.delay += min;
  schedule(g, g.now + min, 'flight.dep', f.id, f.ev);
}

/** How long a departure has been held at the gate by ops (crew wait, decisions). */
const heldFor = (g: GameState, f: Flight) => (f.heldAt === undefined ? 0 : g.now - f.heldAt);

function plannedChecks(g: GameState, acId: string, from: Minute): MaintenanceEvent[] {
  return Object.values(g.maintenance)
    .filter((m) => m.aircraftId === acId && m.status === 'planned' && m.start >= from)
    .sort((a, b) => a.start - b.start);
}

/** How late (vs the original STD) a rotation may start before recovery drops it instead: base waves 6 h, trips 24 h. */
export function lateCap(g: GameState, f: Flight): number {
  if (!isRevenue(f)) return Infinity;
  return isBaseLeg(g, f) ? BAL.holdMax : BAL.tripHoldMax;
}

/** Where the aircraft's crews are based for this leg: the client base of a base programme, else our home base. */
export function stationOf(g: GameState, f: Flight): string {
  const c = contractOf(g, f);
  return c?.pattern.kind === 'base' ? c.pattern.base : g.company.homeBase;
}

/** The leg that brought the aircraft where it is: airborne now, else the last one flown (legs fly in STD order). */
function lastFlown(g: GameState, ac: Aircraft): Flight | undefined {
  if (ac.flightId) return g.flights[ac.flightId];
  const legs = flightsOf(g, ac.id);
  for (let i = legs.length - 1; i >= 0; i--) if (legs[i].status === 'done') return legs[i];
  return undefined;
}

/** What recovery keeps or drops whole; `rev` is the revenue leg whose lateness decides (null: empty legs only). */
interface Unit {
  legs: Flight[];
  rev: Flight | null;
}

/**
 * The unit starting at `legs[i]`: the empty legs leading to the next revenue leg, that leg, and the revenue legs
 * of the same contract that continue it until the aircraft is back at its origin or its station (a base wave out
 * and back, a round trip, a tour). Pure.
 */
function unitAt(g: GameState, legs: Flight[], i: number): Unit {
  const out: Flight[] = [];
  let j = i;
  for (; j < legs.length && !isRevenue(legs[j]); j++) {
    if (out.length && legs[j].from !== out[out.length - 1].to) return { legs: out, rev: null };
    out.push(legs[j]);
  }
  if (j >= legs.length || (out.length && legs[j].from !== out[out.length - 1].to)) return { legs: out, rev: null };
  const rev = legs[j];
  const station = stationOf(g, rev);
  out.push(rev);
  let at = rev.to;
  for (let k = j + 1; k < legs.length && at !== rev.from && at !== station && out.length < 12; k++) {
    const y = legs[k];
    if (!isRevenue(y) || y.from !== at || y.contractId !== rev.contractId) break;
    out.push(y);
    at = y.to;
  }
  return { legs: out, rev };
}

/** The unit a scheduled leg starts (itself and what goes with it). Pure. */
export function unitOf(g: GameState, ac: Aircraft, f: Flight): Flight[] {
  const legs = flightsOf(g, ac.id).filter((x) => x.status === 'scheduled');
  const i = legs.indexOf(f);
  return i < 0 ? [f] : unitAt(g, legs, i).legs;
}

/** Minutes the unit's revenue leg would leave beyond `cap` when the aircraft is ready at `ready` (≤ 0: fine). Pure. */
function overCap(u: Unit, ready: Minute, turn: number, cap: number): number {
  if (!u.rev) return 0;
  let t = ready;
  for (const y of u.legs) {
    const std = Math.max(y.std, t);
    if (y === u.rev) return std - (y.schedStd ?? y.std) - (y.lateOk ?? 0) - cap;
    t = std + y.block + turn;
  }
  return 0;
}

export interface HoldPlan {
  moves: { f: Flight; std: Minute }[];
  cancels: Flight[];
  checks: { m: MaintenanceEvent; start: Minute }[];
  /** Planned checks the aircraft can no longer make (cancelled for re-planning). */
  dropChecks: MaintenanceEvent[];
}

/** How far past its booked start a planned check may slip behind a late aircraft before the slot is given up. */
const CHECK_SLIP = 2 * DAY;

/**
 * Recovery when the aircraft is ready at `at` from `ready`: legs move so each departs a turn after the previous
 * arrival, planned checks shift behind. A unit (wave, trip) whose revenue leg would leave later than its cap
 * (base 6 h, trip 24 h past its original STD) is dropped whole, and the units after it keep their times. Stops
 * where the chain breaks (an empty leg contracts still has to re-link). Pure.
 */
function recover(g: GameState, ac: Aircraft, legs: Flight[], at: string, ready: Minute, inbound: Flight | undefined, capped = true): HoldPlan {
  const turn = turnOf(ac);
  const plan: HoldPlan = { moves: [], cancels: [], checks: [], dropChecks: [] };
  // v0.7.1: a soft positioning leg the planner booked against stale anchors (a held leg hides behind an AOG's
  // maintenance node) can sit between a wave's out and back in departure order. Off the chain it is left to
  // relinkPositioning, never allowed to break the ripple between the legs around it.
  {
    const kept: Flight[] = [];
    let loc = at;
    for (const x of legs) {
      if (x.from !== loc && x.kind === 'positioning' && isSoft(g, x)) continue;
      kept.push(x);
      if (x.from === loc) loc = x.to;
    }
    legs = kept;
  }
  const checks = legs.length ? plannedChecks(g, ac.id, legs[0].std) : [];
  let ci = 0;
  let loc = at;
  // A check the aircraft would reach late moves behind it, up to two days past its booked start; beyond that, or
  // when the chain no longer leads there, the slot is given up (the planner re-books, the player is warned).
  const shiftChecks = (before: Minute) => {
    while (ci < checks.length && checks[ci].start < before) {
      const m = checks[ci++];
      if (m.start >= ready) {
        ready = Math.max(ready, m.end);
        continue;
      }
      if (m.at !== loc || ready - (m.bookedStart ?? m.start) > CHECK_SLIP) {
        plan.dropChecks.push(m);
        continue;
      }
      plan.checks.push({ m, start: ready });
      ready += m.end - m.start;
    }
  };
  for (let i = 0; i < legs.length; ) {
    const x = legs[i];
    shiftChecks(x.std);
    if (x.from !== loc || (x.std >= ready && !x.delay)) break;
    const u = unitAt(g, legs, i);
    // Away from the station, the leg continuing the one that brought the aircraft here (a wave's return, a tour)
    // brings the aircraft and its passengers home: it is never dropped for lateness.
    const cont = i === 0 && u.legs[0] === u.rev && x.from !== stationOf(g, x) && !!inbound && isRevenue(inbound) && inbound.to === x.from && inbound.contractId === x.contractId;
    if (capped && !cont && u.rev && overCap(u, ready, turn, lateCap(g, u.rev)) > 0) {
      plan.cancels.push(...u.legs);
      i += u.legs.length;
      continue;
    }
    for (const y of u.legs) {
      if (y !== x) shiftChecks(y.std);
      const std = Math.max(y.std, ready);
      plan.moves.push({ f: y, std });
      loc = y.to;
      ready = std + y.block + turn;
    }
    i += u.legs.length;
    if (plan.moves.length + plan.cancels.length >= 40) break;
  }
  shiftChecks(ready);
  return plan;
}

/** Recovery for the legs from `after` (excluding `skip`, taken as flown) with the aircraft ready at `at` from `ready`. Pure. */
export function planRecovery(g: GameState, ac: Aircraft, at: string, ready: Minute, after: Minute, skip?: Flight): HoldPlan {
  const legs = flightsOf(g, ac.id).filter((x) => x !== skip && x.status === 'scheduled' && x.std >= after);
  return recover(g, ac, legs, at, ready, skip ?? lastFlown(g, ac));
}

/** Waiting out a grounding until `readyAt` at `at` (AOG courier/team), from now. Pure. */
export const planHold = (g: GameState, ac: Aircraft, at: string, readyAt: Minute): HoldPlan => planRecovery(g, ac, at, readyAt, 0);

function shiftCheck(g: GameState, m: MaintenanceEvent, start: Minute): void {
  const dur = m.end - m.start;
  m.start = start;
  m.end = start + dur;
  m.ev++;
  schedule(g, m.start, 'maint.start', m.id, m.ev);
}

/**
 * Applies a recovery plan; dropped revenue legs are compensated and messaged once (with `subAc`, a crew wait:
 * sub-chartered instead when cheaper). Returns legs moved.
 */
export function applyHold(g: GameState, plan: HoldPlan, reason: string, moveReason?: string, cancelReason = reason, subAc?: Aircraft): number {
  if (subAc && subcharterInstead(g, subAc, plan.cancels, `${reason}: the aircraft can't make these on time.`, false)) plan.cancels = [];
  const rev = plan.cancels.filter((f) => f.status === 'scheduled' && isRevenue(f));
  const pen = cancelLegs(g, plan.cancels, cancelReason, 0);
  if (rev.length) {
    const f = rev[0];
    const cap = lateCap(g, f) / 60;
    pushMessage(g, {
      tone: 'bad', cat: 'ops', title: `${rev.length} leg${rev.length > 1 ? 's' : ''} cancelled: ${f.no}${rev.length > 1 ? '…' : ''}`,
      body: `${reason}: ${rev.map((x) => `${x.no} ${x.from}–${x.to}`).slice(0, 4).join(', ')}${rev.length > 4 ? '…' : ''} would leave more than ${cap} h late, so ${rev.length > 1 ? 'they were' : 'it was'} dropped to keep the rest of the schedule.${pen ? ` Compensation ${usd(pen)}.` : ''}`,
      ref: { kind: 'flight', id: f.id }, ...penaltyMeta(g, rev, pen),
    });
  }
  let n = 0;
  for (const { f, std } of plan.moves) {
    if (f.status !== 'scheduled') continue;
    if (std !== f.std) {
      moveFlight(g, f, std, moveReason ?? reason);
      n++;
    } else if (f.delay) {
      f.delay = 0;
      schedule(g, Math.max(g.now, f.std), 'flight.dep', f.id, f.ev);
    }
  }
  for (const { m, start } of plan.checks) if (m.status === 'planned') shiftCheck(g, m, start);
  for (const m of plan.dropChecks) if (m.status === 'planned') missCheck(g, m, `${reason}: the aircraft can't reach ${m.at} in time`);
  return n;
}

/**
 * Delays `f` to `std` and ripples to the aircraft's later legs and planned checks (turn minima kept). Ops delays
 * (`own`) put f's own unit under the lateness cap too, so a wave that would leave too late is dropped and the
 * next one keeps its time; a player's delay always moves f and only caps the legs after it. Returns later legs
 * moved (f may be cancelled: check its status).
 */
export function delayChain(g: GameState, f: Flight, std: Minute, reason: string, own = true, crewWait = false): number {
  const was = delayOf(f);
  const n = delayChain0(g, f, std, reason, own, crewWait);
  delayCues(g, f, was);
  return n;
}

/**
 * §S.3: a revenue leg passing 60 min late with a penalty risk (charter compensation, presidential standards) and a
 * leg held past 6 h (it may have to be cancelled) each chime once, as the delay crosses the line.
 */
function delayCues(g: GameState, f: Flight, was: number): void {
  if (f.status !== 'scheduled') return;
  const now = delayOf(f);
  if (was < 6 * 60 && now >= 6 * 60) cue('cancelRisk');
  else if (was < 60 && now >= 60 && isRevenue(f)) {
    const c = contractOf(g, f);
    if (c && ((c.product.kind === 'charter' && c.penalties.perDelay > 0) || c.requirements.standards === 'vip')) cue('delayPenalty');
  }
}

function delayChain0(g: GameState, f: Flight, std: Minute, reason: string, own: boolean, crewWait: boolean): number {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (f.status !== 'scheduled') return 0;
  std = Math.max(std, g.now);
  if (!ac) {
    moveFlight(g, f, std, reason);
    return 0;
  }
  if (own && holdable(g, f, std)) {
    // Held at the gate: f keeps its schedule (and its crew), the legs after it ripple as usual.
    f.heldAt ??= g.now;
    f.delay = std - f.std;
    f.delayReason = reason;
    schedule(g, std, 'flight.dep', f.id, f.ev);
    touchFlights(g);
    const all = flightsOf(g, ac.id).filter((x) => x.status === 'scheduled');
    const later = all.slice(all.indexOf(f) + 1);
    return applyHold(g, recover(g, ac, later, f.to, std + f.block + turnOf(ac), f), reason, reason, `Recovery: ${reason}`, crewWait ? ac : undefined);
  }
  if (own) {
    const all = flightsOf(g, ac.id).filter((x) => x.status === 'scheduled');
    const legs = [f, ...all.slice(all.indexOf(f) + 1)];
    const plan = recover(g, ac, legs, f.from, std, lastFlown(g, ac));
    const mine = plan.moves.find((x) => x.f === f);
    // The first leg always takes the new time (a hold may sit on its std); the rest follow.
    if (mine) mine.std = std;
    const moved = applyHold(g, plan, reason, reason, `Recovery: ${reason}`, crewWait ? ac : undefined);
    return Math.max(0, moved - (mine ? 1 : 0));
  }
  const from = f.std;
  moveFlight(g, f, std, reason);
  return applyHold(g, planRecovery(g, ac, f.to, f.sta + turnOf(ac), from, f), 'Schedule recovery', 'Late inbound aircraft');
}

/**
 * Workaround (crew module): retiming the last leg of a duty its crew has already reported for can release that
 * crew. An ops delay that keeps such a leg inside its own block and the duty inside its FDP limit is therefore a
 * hold at the gate, not a retime.
 */
function holdable(g: GameState, f: Flight, std: Minute): boolean {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d || d.report > g.now || d.flightIds[d.flightIds.length - 1] !== f.id) return false;
  const extra = std - (f.std + f.delay);
  return extra > 0 && std > g.now && std < f.sta && d.fdp + extra <= d.maxFdp + (d.discretion ?? 0);
}

/** Moves `f` to `std` (reason kept) and pushes the legs after it only as far as turn minima need; nothing is dropped. */
function ripple(g: GameState, f: Flight, std: Minute): void {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return moveFlight(g, f, std);
  const all = flightsOf(g, ac.id).filter((x) => x.status === 'scheduled');
  const plan = recover(g, ac, [f, ...all.slice(all.indexOf(f) + 1)], f.from, std, lastFlown(g, ac), false);
  plan.moves = plan.moves.filter((x) => x.f !== f);
  moveFlight(g, f, std);
  applyHold(g, plan, 'Late inbound aircraft');
}

// ---------- disruption plans (shared by the AOG and crew decisions) ----------

/**
 * Legs an aircraft can't fly before `readyAt` from `at`: every scheduled leg departing before it, plus the legs
 * that follow until the chain is back at `at` (so the rest of the schedule still connects). Capped at 16 legs.
 */
export function windowLegs(g: GameState, ac: Aircraft, at: string, readyAt: Minute): Flight[] {
  const out: Flight[] = [];
  let loc = at;
  for (const f of flightsOf(g, ac.id)) {
    if (f.status !== 'scheduled') continue;
    if (f.std >= readyAt && loc === at) break;
    if (f.std >= readyAt + 2 * DAY || out.length >= 16) break;
    out.push(f);
    loc = f.to;
  }
  return out;
}

/** Client compensation for cancelling these legs (contract perCancelledLeg on revenue legs). Pure. */
export function cancelCost(g: GameState, legs: Flight[]): number {
  let s = 0;
  for (const f of legs) {
    const c = contractOf(g, f);
    if (c && isRevenue(f)) s += c.penalties.perCancelledLeg;
  }
  return s;
}

/** Reliability follows performance: each revenue leg pulls it toward its outcome (on time 100, late 60, cancelled 0). */
export function legOutcome(g: GameState, outcome: number): void {
  const r = g.company.reputation.reliable;
  bumpReliable(g, (outcome - r) * BAL.reliableStep);
}

/**
 * Cancels legs with compensation; each revenue leg counts as a failed outcome (relation −2), and a player's
 * explicit cancel costs `repPerLeg` more per leg (at most 3 in total). Positioning legs are removed (contracts
 * re-plans empty legs from where the aircraft really is); ferries are cancelled. `agreed`: dropped with notice
 * under the contract (no compensation, no reliability or relation effect here). Returns the compensation paid.
 */
export function cancelLegs(g: GameState, legs: Flight[], reason: string, repPerLeg: number, agreed = false): number {
  // v0.7: a delivery ferry is never cancelled (it waits at the site instead).
  const live = legs.filter((f) => f.status === 'scheduled' && f.purpose !== 'delivery');
  if (!live.length) return 0;
  const pen = agreed ? 0 : cancelCost(g, live);
  if (!agreed) noteLostLegs(g, live);
  let rev = 0;
  const empty: string[] = [];
  for (const f of live) {
    if (f.kind === 'positioning') {
      empty.push(f.id);
      continue;
    }
    cancelFlight(g, f, reason);
    if (isRevenue(f)) {
      rev++;
      if (agreed) continue;
      bumpClient(g, contractOf(g, f)?.clientId, BAL.v08.rel.cancelLeg, `Cancelled ${f.no}`);
      legOutcome(g, 0);
    }
  }
  if (empty.length) removeFlights(g, empty);
  if (pen) post(g, 'penalties', -pen);
  if (!agreed) stats(g).cancelled += rev;
  if (!agreed && rev > 0) v09Stats(g).lastCancel = g.now;
  if (rev && repPerLeg) bumpReliable(g, -Math.min(3, rev * repPerLeg));
  return pen;
}

/** Rival price for flying these legs: contract rate (wet) or pro-rata charter price, × factor. Pure. */
export function subcharterCost(g: GameState, legs: Flight[], factor: number): number {
  let s = 0;
  for (const f of legs) {
    if (!isRevenue(f)) continue;
    const c = contractOf(g, f);
    const bh = f.block / 60;
    if (c?.product.kind === 'wet') s += c.product.ratePerBH * bh * factor;
    else if (c?.product.kind === 'charter') s += (c.product.price * f.block * factor) / Math.max(f.block, c.planRevMin ?? f.block * 4);
    else s += typeOf(f.aircraftId && g.fleet[f.aircraftId] ? g.fleet[f.aircraftId].typeId : 'a320ceo').rateBH * bh * factor;
  }
  return Math.round(s);
}

/** A rival's price level (its priceFactor; 1 when unknown). */
export const rivalFactor = (g: GameState, rivalId: string): number => g.rivals.find((r) => r.id === rivalId)?.priceFactor ?? 1;

/** v0.8 rivals that can take legs of ours: active, never the contract's own client (a rival we fly for), same family when any. Pure. */
export function rivalsFor(g: GameState, typeId: string | null, legs: Flight[] = []): Rival[] {
  const c = legs.length ? contractOf(g, legs[0]) : undefined;
  const cl = c ? g.clients[c.clientId] : undefined;
  const ok = g.rivals.filter((r) => isActive(r) && (!c || (r.clientId !== c.clientId && r.id !== cl?.rivalId)));
  if (!typeId) return ok;
  const fam = typeOf(typeId).family;
  const fit = ok.filter((r) => r.fleet.some((x) => x.count > 0 && typeOf(x.typeId).family === fam));
  return fit.length ? fit : ok;
}

/** v0.8 what a rival charges to position to the first leg and home from the last (ferry hours at 40 % of its type's rate). Pure. */
export function positioningCost(r: Rival, legs: Flight[], typeId: string): number {
  if (!legs.length || !AIRPORT_BY_CODE[r.base]) return 0;
  const km = distance(r.base, legs[0].from) + distance(legs[legs.length - 1].to, r.base);
  return Math.round(((km / 800) * typeOf(typeId).rateBH * 0.4) / 100) * 100;
}

/** Rival for a sub-charter: one flying the same family (never the contract's client), picked with the RNG among the 3 nearest the first leg. */
export function pickRival(g: GameState, typeId: string, legs: Flight[] = []): string {
  let pool = rivalsFor(g, typeId, legs);
  const from = legs[0]?.from;
  if (from && AIRPORT_BY_CODE[from]) {
    const d = (r: Rival) => (AIRPORT_BY_CODE[r.base] ? distance(r.base, from) : 1e9);
    pool = [...pool].sort((a, b) => d(a) - d(b) || a.id.localeCompare(b.id)).slice(0, 3);
  }
  return pool.length ? pick(g, pool).id : '';
}

/** Hands revenue legs to a rival (still billed to our client), drops the empty legs; posts the cost. */
export function subcharterLegs(g: GameState, legs: Flight[], rivalId: string, cost: number, out?: { hit?: SubHit }): number {
  const live = legs.filter((f) => f.status === 'scheduled' && f.purpose !== 'delivery');
  const rev = live.filter(isRevenue);
  const empty = live.filter((f) => !isRevenue(f));
  // v0.7.2 the client notices (F3): reliability and relation, worse when hand-overs become a habit.
  const hit = subHit(g, rev);
  // v0.8 a prestige operator embarrasses us less with the client: relation × (1.5 − quality).
  const rival = g.rivals.find((r) => r.id === rivalId);
  if (rival) {
    const k = 1.5 - rival.quality;
    hit.relation = Math.round(hit.relation * k * 10) / 10;
    hit.byClient = hit.byClient.map(([id, d]) => [id, Math.round(d * k * 100) / 100]);
  }
  if (empty.length) removeFlights(g, empty.map((f) => f.id));
  if (rev.length) subcharterFlights(g, rev.map((f) => f.id), rivalId || 'rival');
  if (cost) post(g, 'subcharter', -cost);
  stats(g).subchartered += rev.length;
  if (rev.length) {
    bumpReliable(g, hit.reliability);
    stats(g).subHit = Math.round(((stats(g).subHit ?? 0) + hit.reliability) * 10) / 10;
    const name = rival?.name ?? 'a rival';
    for (const [clientId, d] of hit.byClient) bumpClient(g, clientId, d, `Handed flights to ${name}`);
    if (rival) noteHiredThem(g, rival.id, rev.length, g.clients[contractOf(g, rev[0])?.clientId ?? '']?.name ?? 'a client');
    const cap = (stats(g).subCap ??= []);
    for (const [clientId, v] of hit.capped) if (v) cap.push([g.now, clientId, v]);
    const log = (stats(g).subLog ??= []);
    for (const f of rev) {
      log.push(f.std);
      const c = contractOf(g, f);
      if (c) (c.subLegs ??= []).push(f.std);
    }
    pruneSubLog(g);
  }
  if (out) out.hit = hit;
  return rev.length;
}

/** v0.7.2 ' TUI notices: reliability −2.1.' for hand-over messages. */
export function noticeText(g: GameState, f: Flight | undefined, hit: SubHit | undefined): string {
  if (!hit || !hit.reliability) return '';
  const c = f ? contractOf(g, f) : undefined;
  const who = (c && g.clients[c.clientId]?.name) || 'The client';
  return ` ${who} notices: reliability ${fmtHit(hit.reliability)}.`;
}

/** v0.7.2 a hand-over's cost: reliability (≤ 0) and relation (≤ 0, per client), with the plain words. */
export interface SubHit { reliability: number; relation: number; text: string; byClient: [string, number][]; capped: [string, number][] }

const inWindow = (g: GameState, ts: Minute[] | undefined) => {
  const from = g.now - BAL.v072.sub.windowDays * DAY;
  let n = 0;
  for (const t of ts ?? []) if (t >= from) n++;
  return n;
};

/**
 * v0.7.2 F3: per revenue leg, in order, −base … −max reliability by the contract's share of its legs in the 90-day
 * window handed over (flown + still planned, so a fresh contract starts cheap) and the company's hand-overs in the last
 * 90 days (each leg counts for the next); at most capPerClient per client in capDays (splitting or bundling a hand-over
 * costs the same); relation −relationPerLeg a leg (at most relationCap per client). Pure.
 */
export function subHit(g: GameState, rev: Flight[]): SubHit {
  const S = BAL.v072.sub;
  let n90 = inWindow(g, g.stats.subLog);
  const sub = new Map<string, number>();
  const planned = new Map<string, number>();
  const relBy = new Map<string, number>();
  const byClient = new Map<string, number>();
  for (const f of rev) {
    const c = contractOf(g, f);
    let share = 0;
    if (c) {
      const s90 = sub.get(c.id) ?? inWindow(g, c.subLegs);
      if (!planned.has(c.id)) planned.set(c.id, plannedLegs(g, c.id));
      const flown90 = (c.legsFlown ?? 0) * Math.min(1, (S.windowDays * DAY) / Math.max(DAY, g.now - c.start));
      share = s90 / Math.max(1, s90 + flown90 + planned.get(c.id)!);
      sub.set(c.id, s90 + 1);
      byClient.set(c.clientId, Math.max(-S.relationCap, (byClient.get(c.clientId) ?? 0) - S.relationPerLeg));
    }
    const k = Math.min(1, Math.max(0, (share - S.shareFrom) / S.shareSpan, (n90 - S.nFrom) / S.nSpan));
    const key = c?.clientId ?? '';
    relBy.set(key, (relBy.get(key) ?? 0) + S.base + (S.max - S.base) * k);
    n90++;
  }
  // per client: what is left of the cap after this client's hits in the last capDays
  const from = g.now - S.capDays * DAY;
  const capped: [string, number][] = [];
  let rel = 0;
  for (const [k, v] of relBy) {
    let used = 0;
    for (const [t, id, x] of g.stats.subCap ?? []) if (t >= from && id === k) used -= x;
    const take = Math.round(Math.min(v, Math.max(0, S.capPerClient - used)) * 10) / 10;
    capped.push([k, -take]);
    rel += take;
  }
  const reliability = -Math.round(rel * 10) / 10;
  const relation = [...byClient.values()].reduce((a, b) => a + b, 0);
  const text = !rev.length ? '' : reliability ? `reliability ${fmtHit(reliability)} · the client notices` : 'the client notices (reliability already hit this week)';
  return { reliability, relation, text, byClient: [...byClient], capped };
}

/** A contract's own revenue legs still scheduled in the next window (the share's denominator). */
function plannedLegs(g: GameState, contractId: string): number {
  const to = g.now + BAL.v072.sub.windowDays * DAY;
  let n = 0;
  for (const f of Object.values(g.flights)) if (f.contractId === contractId && f.status === 'scheduled' && f.aircraftId && f.std >= g.now && f.std <= to && isRevenue(f)) n++;
  return n;
}

/** '−2', '−0.6'. */
const fmtHit = (v: number) => `−${Math.abs(v) % 1 ? Math.abs(v).toFixed(1) : Math.abs(v)}`;

/** Drops sub-charter log entries older than the window (company and contracts). */
function pruneSubLog(g: GameState): void {
  const from = g.now - BAL.v072.sub.windowDays * DAY;
  if (g.stats.subLog) g.stats.subLog = g.stats.subLog.filter((t) => t >= from);
  const capFrom = g.now - BAL.v072.sub.capDays * DAY;
  if (g.stats.subCap) g.stats.subCap = g.stats.subCap.filter(([t]) => t >= capFrom);
  for (const c of Object.values(g.contracts)) if (c.subLegs?.length) c.subLegs = c.subLegs.filter((t) => t >= from);
}

// ---------- departure ----------

const OPS_REASONS = ['ATC slot', 'Weather at destination', 'Late ground handling', 'Late passengers', 'Catering', 'Fuelling', 'Airport congestion'];
const TECH_REASONS = ['Technical: bleed fault', 'Technical: brake temperature', 'Technical: pressurisation sensor', 'Technical: APU', 'Technical: cabin defect'];

function rollDelay(g: GameState, ac: Aircraft): { min: number; reason: string } | null {
  if (chance(g, BAL.delayChance)) {
    const min = Math.min(BAL.delayCap, Math.max(5, Math.round(-BAL.delayMean * Math.log(1 - next(g)))));
    return { min, reason: pick(g, OPS_REASONS) };
  }
  if (chance(g, BAL.techDelayChance * ageF(g, ac))) {
    const min = Math.min(240, Math.max(15, Math.round(-BAL.techDelayMean * Math.log(1 - next(g)))));
    return { min, reason: pick(g, TECH_REASONS) };
  }
  return null;
}

/** 'flight.dep' at std (+hold): sequence → readiness → grounding → crew → random delay (once) → AOG roll → off-blocks. */
export function onFlightDep(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v || f.status !== 'scheduled' || !f.aircraftId) return;
  const ac = g.fleet[f.aircraftId];
  if (!ac) return;
  // Loop guard: other modules re-plan empty legs on every flight change; never spin at one instant.
  if (spinning(g, ac.id)) return quietHold(g, f, 30);
  // 0. Sequence: an earlier leg from where the aircraft is (held for crew or a decision) goes first.
  const here = ac.flightId ? g.flights[ac.flightId]?.to : ac.at;
  const prior = flightsOf(g, ac.id).find((x) => x !== f && x.status === 'scheduled' && x.from === here && (x.std < f.std || (x.std === f.std && x.sta < f.sta)));
  if (prior && f.from === here) return isRevenue(f) ? holdFlight(g, f, 30) : quietHold(g, f, 30);
  // An empty leg must not take the aircraft away from a revenue leg due here before it could be back.
  if (!isRevenue(f) && f.to !== f.from && f.from === here) {
    const back = f.sta + turnOf(ac) + blockMinutes(ac.typeId, f.to, f.from) + turnOf(ac);
    const due = flightsOf(g, ac.id).find((x) => x !== f && x.status === 'scheduled' && isRevenue(x) && x.std < back);
    // Moved behind it, the leg is soft again and contracts re-plans (or drops) it.
    if (due && due.from === f.from) return moveFlight(g, f, Math.max(due.sta + turnOf(ac), g.now + 90), 'Re-planned');
  }
  // 1. Aircraft readiness (on blocks here at least a turn ago).
  if (ac.status === 'aog' || ac.status === 'maintenance' || ac.status === 'delivering' || ac.status === 'leasedOut' || ac.flightId || ac.at !== f.from || turnReady(g, ac) > g.now) {
    notReady(g, f, ac);
    return;
  }
  // v0.8 world events: a closed airport holds the leg (force majeure, no lateness cap); a whiteout turns an ice leg back.
  const closed = closedAtDeparture(g, f);
  if (closed) {
    f.closedBy = closed.id;
    return quietHold(g, f, 60);
  }
  if (whiteout(g, f)) return;
  // Grounded past the check tolerance: revenue legs stay on the ground; empty legs fly on a ferry permit.
  if (isRevenue(f) && isGrounded(g, ac)) {
    return dropUnit(g, ac, f, 'Aircraft grounded: check overdue', `${ac.reg} is grounded: a check is overdue (book it on the Fleet screen).`, 'tech');
  }
  // 2. Crew complete and legal (v0.6: optional extra crew not at the gate, or over a limit, stay behind).
  dropStraySpares(g, f);
  if (crewBlocked(g, f)) {
    crewProblem(g, f, ac);
    return;
  }
  // 3. Random delay, rolled once per flight (v0.8: an ATC strike on its countries first, not our fault).
  if (f.delayReason === undefined) {
    const st = strikeDelay(g, f);
    if (st) {
      delayChain(g, f, g.now + st.min, st.reason);
      const e = g.world?.events.find((x) => x.id === st.eventId);
      if (e) e.flightsHit = (e.flightsHit ?? 0) + 1;
      const v8 = statsV08(g);
      v8.strikeDelays = (v8.strikeDelays ?? 0) + 1;
      return;
    }
    const d = rollDelay(g, ac);
    if (d) {
      const n = delayChain(g, f, g.now + d.min, d.reason);
      if (d.min >= BAL.delayMessageMin && f.status === 'scheduled') {
        pushMessage(g, {
          tone: 'info', cat: 'ops', title: `${f.no} delayed ${fmtDuration(d.min)}`,
          body: `${d.reason}. ${f.from}–${f.to} now off blocks ${fmtTime(f.std + f.delay)} UTC${n ? `; ${n} later leg${n > 1 ? 's follow' : ' follows'}` : ''}.`,
          ref: { kind: 'flight', id: f.id },
        });
      }
      return;
    }
    f.delayReason = '';
  }
  // 4. AOG (its own roll; technical delays never become one).
  if (chance(g, aogChance(g, ac, f.from))) {
    startAog(g, ac, f);
    holdFlight(g, f, 30);
    return;
  }
  // 5. Gate holds can stretch the duty: the commander extends it within discretion, beyond that a fresh crew.
  if (fdpOver(g, f)) {
    crewProblem(g, f, ac);
    return;
  }
  clearRestMarks(g, f);
  depart(g, f, ac);
}

/**
 * Projected FDP of the duty f opens or continues (now + the rest of its legs) against its limit. Over the limit
 * without discretion used: the commander applies it (inbox note). Still over: the duty is marked illegal (true).
 */
function fdpOver(g: GameState, f: Flight): boolean {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d || d.report > g.now || f.kind === 'deadhead') return false;
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  if (!last) return false;
  const fdp = g.now + Math.max(f.block, last.sta - f.std) - d.report;
  if (fdp <= d.maxFdp + (d.discretion ?? 0)) return false;
  if (!d.discretion) {
    // v0.9 only for the unforeseen (UPDATE-0.9.md §U.3): a day already too long at report becomes crew out of hours.
    const r = applyDiscretion(g, d.id, fdp);
    if (r.ok) {
      pushMessage(g, {
        tone: 'info', cat: 'crew', title: `Commander's discretion on ${f.no}`,
        body: `Gate holds stretched the duty; the commander extends it to finish ${f.from}–${last.to}. The crew will want their rest.`,
        ref: { kind: 'flight', id: f.id },
      });
    }
    if (fdp <= d.maxFdp + (d.discretion ?? 0)) return false;
  }
  d.fdp = fdp;
  d.legality = 'illegal';
  return true;
}

/**
 * v0.7.2 crew rest seats taken out of sale on a flight whose duty needs in-flight rest: passengers booked beyond
 * the sellable seats are offloaded once, at departure (compensation to penalties, one message with the card).
 */
export function offloadRestSeats(g: GameState, f: Flight, ac: Aircraft): void {
  const blocked = restSeatsBlocked(g, f.id);
  if (!blocked || !isRevenue(f) || f.pax === undefined) return;
  const n = f.pax - (ac.cabin.total - blocked);
  if (n <= 0) return;
  f.pax -= n;
  const cost = n * BAL.v072.restSeats.offloadPerPax;
  post(g, 'penalties', -cost);
  pushMessage(g, {
    tone: 'bad', cat: 'ops', title: `${f.no}: ${n} passenger${n > 1 ? 's' : ''} offloaded for crew rest`,
    body: `The duty needs in-flight rest and ${ac.reg} has no bunks: its last row (${blocked} seats) is curtained off for the crew. Compensation ${usd(cost)}.`,
    ref: { kind: 'flight', id: f.id }, problem: { kind: 'restSeats', ref: { kind: 'flight', id: f.id } }, hurt: { money: cost, pax: n, delayMin: 0, level: cost >= BAL.crewControl.hurtLowUsd ? 'high' : 'low' },
  });
}

function depart(g: GameState, f: Flight, ac: Aircraft): void {
  offloadRestSeats(g, f, ac);
  boardCrew(g, f);
  f.status = 'enroute';
  f.atd = g.now;
  ac.flightId = f.id;
  ac.at = f.from;
  ac.status = 'flying';
  f.eta = g.now + Math.max(15, Math.round(f.block * (1 + range(g, -BAL.windNoise, BAL.windNoise))));
  schedule(g, f.eta, 'flight.arr', f.id, f.ev);
  cue('flightDep');
  const s = stats(g);
  s.departures++;
  const duty = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (duty?.legality === 'illegal') {
    s.illegalFlown++;
    noteIncident(g, 'illegalCrew', `${f.no} flew on a duty over its FDP`);
  }
  // Every crew member legal for the duty this leg opens (rest, recovery, location, status…).
  const crewIll = !!duty && duty.flightIds[0] === f.id && crewIssuesFor(g, duty).length > 0;
  if (crewIll) {
    s.illegalCrewFlown = (s.illegalCrewFlown ?? 0) + 1;
    if (duty!.legality !== 'illegal') noteIncident(g, 'illegalCrew', `${f.no} left with a crew member over a limit`);
  }
  departStats(g, f, ac, duty, !crewIll && duty?.legality !== 'illegal');
  // Charter clients are compensated for long delays (> 3 h). v0.8: a Trusted client forgives a few a month; presidential
  // standards notice anything over 30 min (× 3); our own late legs cost relation (−1, at most −4 a contract-month).
  const c = contractOf(g, f);
  if (c && isRevenue(f)) lateLeg(g, f, c);
  // v0.8 war-risk cover for the landing (re-billed to a wet client).
  payWarRisk(g, f);
  touchStatus(g, ac.id);
}

/** Keeps the last 14 month keys of a month record. */
function monthRec(rec: Record<number, [number, number]>, k: number): [number, number] {
  const r = (rec[k] ??= [0, 0]);
  const keys = Object.keys(rec).map(Number);
  if (keys.length > 14) for (const x of keys.sort((a, b) => a - b).slice(0, keys.length - 14)) delete rec[x];
  return r;
}

/**
 * v0.9 achievement counters at a departure (§14.1): revenue sectors in a row with a legal crew, crew coverage and
 * on-time departures by month, 747-400 revenue sectors, augmented duties leaving with a legal rest plan; the
 * "nothing cancelled" clock starts with the first revenue departure.
 */
function departStats(g: GameState, f: Flight, ac: Aircraft, duty: Duty | undefined, legal: boolean): void {
  const v = v09Stats(g);
  if (duty && duty.augment > 0 && duty.flightIds[0] === f.id && restPlan(g, duty.id)?.ok === true) v.restPlans = (v.restPlans ?? 0) + 1;
  if (!isRevenue(f)) return;
  v.legalStreak = legal ? v.legalStreak + 1 : 0;
  v.lastCancel ??= g.now;
  const k = monthKey(g.now);
  monthRec(v.cover, k)[0]++;
  const ot = monthRec((v.onTimeM ??= {}), k);
  ot[0]++;
  if (delayOf(f) <= 15) ot[1]++;
  if (ac.typeId === 'b744') v.queenSectors = (v.queenSectors ?? 0) + 1;
}

/** Delays nobody at our end controls (ATC, weather, the client, the world). */
const NOT_OURS = /^(ATC|Weather|Late passengers|Airport congestion|Client|Landing permit|Waiting:|Closed:|Whiteout|Moved to)/;

/**
 * v0.8 (§1.3, §1.4, §2.3) a revenue leg leaving late by our fault: over 3 h, charter compensation and relation −1
 * (at most −4 a contract-month), unless a Trusted / Partner client forgives it (n a month); presidential standards:
 * over 30 min costs compensation × 3 and relation −3.
 */
function lateLeg(g: GameState, f: Flight, c: Contract): void {
  const late = delayOf(f);
  const vip = c.requirements.standards === 'vip';
  if (late <= (vip ? 30 : 180)) return;
  const ours = !NOT_OURS.test(f.delayReason ?? '');
  const pen = c.product.kind === 'charter' ? c.penalties.perDelay * (vip ? 3 : 1) : 0;
  if (ours && !vip && forgiveDelay(g, c.clientId)) {
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${g.clients[c.clientId]?.name ?? 'The client'} let it go`, body: `${f.no} left ${fmtDuration(late)} late; they forgave it (${LEVEL_NAME[levelOf(g, g.clients[c.clientId])]} client): no compensation, no harm done.`, ref: { kind: 'flight', id: f.id } });
    return;
  }
  if (pen) post(g, 'penalties', -pen);
  if (!ours) return;
  const k = monthKey(g.now);
  const used = c.lateHits && c.lateHits[0] === k ? c.lateHits[1] : 0;
  const d = vip ? -3 : Math.max(BAL.v08.rel.lateCap - used, BAL.v08.rel.lateLeg);
  if (d >= 0) return;
  c.lateHits = [k, used + d];
  bumpClient(g, c.clientId, d, `${f.no} left ${fmtDuration(late)} late`);
}

/**
 * This departure can't go: seats unfilled, its own duty is illegal, or (on the duty's first leg) a crew member is
 * over a limit for it (a later duty's problem is re-rostered from there).
 */
export function crewBlocked(g: GameState, f: Flight): boolean {
  const cs = flightCrewStatus(g, f.id, { live: false });
  if (cs.level === 'missing') return true;
  // The duty's crew must be at its first departure airport (tickets in have landed by now).
  const dd = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = dd && dd.flightIds[0] === f.id ? g.pairings[dd.pairingId] : undefined;
  if (p) for (const s of p.slots) if (s.crewId && g.crew[s.crewId] && g.crew[s.crewId].loc !== f.from) return true;
  if (p && dd && crewIssuesFor(g, dd).length) return true;
  // v0.9 §Y.1 the in-flight rest plan re-checked at departure: a delay after report can make it impossible.
  if (p && restFailed(g, f)) return true;
  if (cs.level !== 'illegal') return false;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  return !d || d.legality === 'illegal';
}

const spin = new WeakMap<GameState, { t: Minute; ac: string; n: number }>();
/** More than 12 departure attempts for one aircraft at one minute: something keeps re-planning its legs. */
function spinning(g: GameState, acId: string): boolean {
  const s = spin.get(g);
  if (!s || s.t !== g.now || s.ac !== acId) {
    spin.set(g, { t: g.now, ac: acId, n: 1 });
    return false;
  }
  return ++s.n > 12;
}

/** When the aircraft has had its turn after the last on-blocks. */
function turnReady(g: GameState, ac: Aircraft): Minute {
  const prev = lastFlown(g, ac);
  return prev?.ata !== undefined ? prev.ata + turnOf(ac) : 0;
}

/** Aircraft not ready: wait for the running flight, the turn, the check or the AOG fix; hold while a decision is open. */
function notReady(g: GameState, f: Flight, ac: Aircraft): void {
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  const heading = cur ? cur.to : ac.at;
  if (!isRevenue(f)) {
    // An empty leg from somewhere the aircraft is not heading to is stale: a positioning leg goes back to
    // contracts (re-linked from the real position); a ferry waits a day for the leg that brings the aircraft in.
    if (heading !== f.from) {
      if (f.kind === 'positioning' || f.delay >= DAY) return void removeFlights(g, [f.id]);
      return quietHold(g, f, 120);
    }
    const ready = cur ? (cur.eta ?? cur.sta) + turnOf(ac) : ac.maintId ? (g.maintenance[ac.maintId]?.end ?? g.now) + 30 : Math.max(g.now + 15, turnReady(g, ac));
    return quietHold(g, f, Math.max(15, Math.min(120, ready - g.now)));
  }
  // Still turning round: a short hold at the gate (no retime: the crew's duty is under way).
  if (!cur && ac.at === f.from && ac.status === 'available' && turnReady(g, ac) > g.now) return holdFlight(g, f, turnReady(g, ac) - g.now);
  if (ac.status === 'aog' || ac.status === 'maintenance') {
    const m = ac.maintId ? g.maintenance[ac.maintId] : undefined;
    if (ac.status === 'aog' && hasOpenDecision(g, 'aog', ac.id)) return holdFlight(g, f, 30);
    delayChain(g, f, Math.max(g.now + 30, (m?.end ?? g.now) + 30), ac.status === 'aog' ? 'Aircraft unserviceable' : 'Maintenance overrun');
    return;
  }
  if (ac.status === 'delivering') {
    delayChain(g, f, Math.max(g.now + 60, ac.deliveredAt + 60), 'Aircraft not delivered');
    return;
  }
  if (cur) {
    // Heading elsewhere: leave room for an empty leg back (contracts plans it).
    const away = cur.to !== f.from ? blockMinutes(ac.typeId, cur.to, f.from) + turnOf(ac) : 0;
    delayChain(g, f, Math.max(g.now + 5, (cur.eta ?? cur.sta) + turnOf(ac) + away), 'Late inbound aircraft');
    return;
  }
  // Wrong airport: a scheduled leg into f.from brings it (follow that), else wait for re-planning, then give up.
  const inbound = flightsOf(g, ac.id).find((x) => x !== f && x.status === 'scheduled' && x.to === f.from && x.std < f.std + DAY);
  if (inbound) {
    const at = Math.max(g.now + 30, inbound.std + inbound.delay + inbound.block + turnOf(ac));
    return at > f.std + f.delay ? void delayChain(g, f, at, 'Late inbound aircraft') : holdFlight(g, f, 30);
  }
  if (heldFor(g, f) < 180) return holdFlight(g, f, 30);
  dropUnit(g, ac, f, 'Aircraft out of position', `${ac.reg} is at ${ac.at}, not ${f.from}, and no flight brings it there in time.`, 'ops');
}

/**
 * Crew failure on `legs`: operations hand the revenue legs to a rival when that costs less than cancelling them
 * (compensation plus the fares lost; we still bill the client). True when sub-chartered.
 */
export function subcharterInstead(g: GameState, ac: Aircraft, legs: Flight[], why: string, reroster = true): boolean {
  const live = legs.filter((x) => x.status === 'scheduled');
  const rev = live.filter(isRevenue);
  if (!rev.length) return false;
  const rivalId = pickRival(g, ac.typeId, live);
  if (!rivalId) return false;
  const cost = subcharterCost(g, live, range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]) * rivalFactor(g, rivalId));
  if (cost >= cancelCost(g, live) + subcharterCost(g, live, 1)) return false;
  const name = g.rivals.find((r) => r.id === rivalId)?.name ?? 'A rival operator';
  const out: { hit?: SubHit } = {};
  subcharterLegs(g, live, rivalId, cost, out);
  pushMessage(g, {
    tone: 'warn', cat: 'crew', title: `${rev[0].no} sub-chartered${rev.length > 1 ? ` with ${rev.length - 1} more` : ''}`,
    body: `${why} ${name} flies ${rev.map((x) => `${x.no} ${x.from}–${x.to}`).join(', ')} for us (${usd(cost)}); the client is billed as usual.${noticeText(g, rev[0], out.hit)}`,
    ref: { kind: 'flight', id: rev[0].id }, ...penaltyMeta(g, rev, cost),
  });
  if (reroster) rerosterFrom(g, ac.id, g.now);
  return true;
}

/** Cancels the unit `f` starts (empty legs go back to contracts) with one message; the rest is re-rostered. */
function dropUnit(g: GameState, ac: Aircraft, f: Flight, reason: string, why: string, cat: MessageCat): void {
  const legs = unitOf(g, ac, f);
  const rev = legs.filter(isRevenue);
  const pen = cancelLegs(g, legs, reason, 0);
  if (rev.length) {
    pushMessage(g, {
      tone: 'bad', cat, title: `${rev[0].no} cancelled${rev.length > 1 ? ` with ${rev.length - 1} more` : ''}`,
      body: `${why} ${rev.map((x) => `${x.no} ${x.from}–${x.to}`).join(', ')} cancelled.${pen ? ` Compensation ${usd(pen)}.` : ''}`,
      ref: { kind: 'flight', id: rev[0].id }, ...penaltyMeta(g, rev, pen),
    });
  }
  rerosterFrom(g, ac.id, g.now);
}

/**
 * Crew incomplete or illegal: re-roster and wait up to BAL.crewWaitMin, then the crew-short decision. After a
 * "wait for crew" decision, at the station two more waits are tried (each under the lateness cap, so a wave that
 * would leave too late is dropped and the next keeps its time), then the wave is given up and the rest
 * re-rostered. Away from the station the leg brings the aircraft home: it keeps waiting for a rested or
 * positioned crew (cancelling it would strand the aircraft) and is only given up after two days.
 */
/** v0.9 §Y.1 the reported augmented duty this leg opens, when its in-flight rest plan no longer works (null: fine). */
function restFailed(g: GameState, f: Flight): Duty | null {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d || d.augment === 0 || d.legacyRest || d.flightIds[0] !== f.id || d.report > g.now || d.done) return null;
  return restPlan(g, d.id)?.ok === false ? d : null;
}

/**
 * v0.9 §Y.1 the rest plan failed at the gate: the cabin crew are out of hours (limit 'inflightRest'), red at once
 * with the urgent alarm and the crewHours pause; the gate decision (fresh crew, delay, sub-charter, cancel) follows.
 */
function restOutOfHours(g: GameState, f: Flight, d: Duty): void {
  const p = g.pairings[d.pairingId];
  if (!p) return;
  for (const s of p.slots) if (s.crewId && (s.role === 'PUR' || s.role === 'CC')) s.ooh = { crewId: s.crewId, limit: 'inflightRest', over: 0, at: g.now };
  if (f.crewAlert === 'red') return;
  f.crewAlert = 'red';
  const v9 = (g.stats.v09 ??= { legalStreak: 0, cover: {}, slips: 0, oohRed: 0, oohAmber: 0, discretionUsed: 0, discretionRefused: 0, headHandled: 0, headMistakes: 0, jumboLoads: 0, lateGovPaid: 0, cOnTime: 0 });
  v9.oohRed++;
  const card = problemFor(g, { kind: 'crewHours', ref: { kind: 'flight', id: f.id } });
  pushMessage(g, {
    tone: 'bad', cat: 'crew', topic: 'crewHours', title: `CREW OUT OF HOURS: ${f.no} at the gate`,
    body: card ? `${card.why} ${card.hurt.text.replace(/^(Yes|Not much): /, '')}.` : 'After the delay the in-flight rest plan no longer works: the cabin crew cannot all rest in this cruise.',
    ref: { kind: 'flight', id: f.id }, problem: { kind: 'crewHours', ref: { kind: 'flight', id: f.id } },
    ...(card ? { hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level } } : {}),
  });
  requestPause('crewHours');
}

/** Clears the rest-plan marks of a duty whose plan works again (re-planned turns, a fresh crew). */
function clearRestMarks(g: GameState, f: Flight): void {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (p) for (const s of p.slots) if (s.ooh?.limit === 'inflightRest') delete s.ooh;
}

function crewProblem(g: GameState, f: Flight, ac: Aircraft): void {
  if (!f.crewHeld) {
    f.crewHeld = true;
    f.heldAt ??= g.now;
    if (isRevenue(f)) {
      stats(g).uncovered++;
      monthRec(v09Stats(g).cover, monthKey(g.now))[1]++;
    }
    const rd = restFailed(g, f);
    if (rd) restOutOfHours(g, f, rd);
    // Crew over a limit come off the duty first (refilled when someone legal can take the seat).
    if (f.dutyId) guardDuty(g, f.dutyId);
    rerosterFrom(g, ac.id, g.now);
    if (!crewBlocked(g, f)) return holdFlight(g, f, 5);
  }
  if (!isRevenue(f)) return f.purpose === 'delivery' ? deliveryWait(g, f, ac) : emptyLegCrew(g, f, ac);
  if (hasOpenDecision(g, 'crewShort', f.id) || heldFor(g, f) < BAL.crewWaitMin) return holdFlight(g, f, 30);
  if (f.crewDecided) {
    const tries = (f.crewTries ?? 0) + 1;
    f.crewTries = tries;
    const away = f.from !== stationOf(g, f);
    if (away ? delayOf(f) < 2 * DAY : tries <= 2) {
      delayChain(g, f, Math.max(crewReadyAt(g, f, ac), g.now + Math.min(6, tries) * 60), away ? 'Waiting for a rescue crew' : 'Waiting for a legal crew', true, true);
      rerosterFrom(g, ac.id, g.now);
      return;
    }
    const why = `No legal crew after ${fmtDuration(heldFor(g, f))} on the ground:`;
    if (!subcharterInstead(g, ac, unitOf(g, ac, f), why)) dropUnit(g, ac, f, 'No legal crew', why, 'crew');
    return;
  }
  crewShortDecision(g, f, ac);
  holdFlight(g, f, 30);
}

/**
 * Empty legs need no decision: they wait for a crew (a standby set deadheads in; re-rostered against the new time)
 * under the lateness cap of the revenue leg they lead to. A chain whose duty is illegal as built (nobody has
 * reported yet) can't be crewed by waiting: after two tries the unit it serves is dropped. A positioning leg still
 * uncrewed after a day goes back to contracts; a ferry is cancelled.
 */
function emptyLegCrew(g: GameState, f: Flight, ac: Aircraft): void {
  const tries = (f.crewTries ?? 0) + 1;
  f.crewTries = tries;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (d && d.legality === 'illegal' && d.report > g.now && tries > 2) {
    const why = 'No legal crew pairing can fly this trip as planned (duty too long for one crew):';
    if (subcharterInstead(g, ac, unitOf(g, ac, f), why)) return;
    return dropUnit(g, ac, f, 'No legal crew', why, 'crew');
  }
  if (tries > 4 && delayOf(f) > DAY) {
    if (f.kind === 'positioning') removeFlights(g, [f.id]);
    else cancelLegs(g, [f], 'No crew for the ferry', 0);
    return;
  }
  delayChain(g, f, Math.max(crewReadyAt(g, f, ac), g.now + tries * 120), 'Waiting for crew', true, true);
  rerosterFrom(g, ac.id, g.now);
}

/**
 * v0.7: a delivery ferry is never cancelled. Without a legal crew it waits at the site a day at a time (the whole
 * chain moves 24 h, parking is charged daily) and the roster tries again; the 48 h warning was given earlier.
 */
function deliveryWait(g: GameState, f: Flight, ac: Aircraft): void {
  // Crew who reported for it stand down (rest at the site) and the trip is planned again for tomorrow: left 'on duty'
  // the trip would stay under way while its legs move a day at a time, and nobody could be added to it.
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (p && p.status === 'active' && !p.dutyIds.some((id) => g.duties[id]?.done)) {
    p.status = 'planned';
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (c?.status === 'onDuty') c.status = c.restUntil > g.now ? 'resting' : 'available';
    }
  }
  const chain = deliveryWaitDay(g, f, ac);
  for (const x of chain) {
    x.delay = 0;
    delete x.crewHeld;
    delete x.heldAt;
    delete x.crewTries;
  }
  // Work planned after the ferry moves behind it (a wave that would leave too late is dropped, as for any delay).
  const last = chain.reduce((a, b) => (b.sta > a.sta ? b : a), chain[0]);
  const behind = last && flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.purpose !== 'delivery' && x.std >= f.std && x.std < last.sta + turnOf(ac));
  if (behind) delayChain(g, behind, last.sta + turnOf(ac), 'Delivery ferry delayed');
  rerosterFrom(g, ac.id, g.now);
}

// ---------- arrival ----------

/** Fuel, fees and catering fall on us on charter, ferry and non-billable positioning legs. */
export function paysFuel(g: GameState, f: Flight): boolean {
  if (f.kind === 'ferry') return true;
  const c = contractOf(g, f);
  if (!c || c.product.kind === 'charter') return true;
  if (c.product.kind === 'wet') return f.kind === 'positioning' && !c.product.positioningBillable;
  return false;
}

/** 'flight.arr': on-blocks; aircraft parked; hours and cycles; costs; on-time stats and reliability. */
export function onFlightArr(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v) return;
  // Deadheads and sub-chartered legs (no aircraft): done on time; contracts bill, crew moves deadheaders.
  if (!f.aircraftId) {
    if (f.status !== 'scheduled') return;
    f.status = 'done';
    f.atd = f.std;
    f.ata = g.now;
    touchTickets(g);
    return;
  }
  if (f.status !== 'enroute') return;
  const ac = g.fleet[f.aircraftId];
  f.status = 'done';
  f.ata = g.now;
  cue('flightArr');
  if (AIRPORT_BY_CODE[f.to]?.ice) v09Stats(g).antarctic = (v09Stats(g).antarctic ?? 0) + 1;
  touchStatus(g, f.aircraftId);
  if (!ac) return;
  ac.flightId = null;
  ac.at = f.to;
  if (ac.status === 'flying') ac.status = 'available';
  const block = Math.max(0, g.now - (f.atd ?? f.std));
  const bh = block / 60;
  const fh = Math.max(0, block - 20) / 60;
  ac.hours += fh;
  ac.cycles += 1;
  // v0.7.2 daily block minutes, the last 90 days ("Which one?": the least used aircraft).
  const day = Math.floor(g.now / DAY);
  const bd = (ac.bhDays ??= []);
  if (bd.length && bd[bd.length - 1][0] === day) bd[bd.length - 1][1] += Math.round(block);
  else bd.push([day, Math.round(block)]);
  while (bd.length && bd[0][0] <= day - 90) bd.shift();
  ac.maint.fhSinceA += fh;
  ac.maint.fhSinceC += fh;
  ac.maint.deferred = Math.min(1, ac.maint.deferred + 0.0005 * ageF(g, ac));
  // Costs.
  const t = typeOf(ac.typeId);
  const wide = t.body === 'wide' ? 1 : 0;
  const maint = t.maintBH * (1 + BAL.maintAgeFactor * Math.max(0, ageOf(g, ac) - 12)) * bh;
  if (ac.ownership.kind === 'dryLeaseIn') {
    const res = Math.min(maint, ac.ownership.reservesPerFH * fh);
    post(g, 'reserves', -Math.round(res));
    post(g, 'maintenance', -Math.round(maint - res));
  } else post(g, 'maintenance', -Math.round(maint));
  if (paysFuel(g, f)) {
    post(g, 'fuel', -Math.round(t.fuelTBH * bh * g.market.fuelPrice));
    // v0.9 §Y.2 fuel at cost: a jumbo charter's revenue legs re-bill the actual burn to the client.
    const fc = contractOf(g, f);
    if (fc && fc.product.kind === 'charter' && fc.product.fuelAtCost && isRevenue(f)) {
      invoice(g, { clientId: fc.clientId, contractId: fc.id, desc: `Fuel re-billed: ${f.no}`, amount: Math.round(t.fuelTBH * bh * g.market.fuelPrice), cat: 'otherRevenue', dueDays: fc.payment.basis === 'arrears' ? fc.payment.dueDays : 7, deferred: true });
    }
    post(g, 'airportFees', -(BAL.airportFees[wide] + (isRevenue(f) ? BAL.catering[wide] : 0)));
  }
  g.finance.current.bh = Math.round((g.finance.current.bh + bh) * 100) / 100;
  // Stats and reliability (revenue legs).
  const s = stats(g);
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (d && d.augment > 0 && f.block >= 6 * 60) s.augmentedDuties++;
  if (f.block >= 16 * 60) s.ulrSectors++;
  if (isRevenue(f)) {
    s.legs++;
    const onTime = g.now <= schedSta(f) + 15;
    if (onTime) s.onTime++;
    else s.delayed++;
    legOutcome(g, onTime ? 100 : 60);
  }
}

// ---------- player action ----------

/** Delays a scheduled flight (e.g. holding for a late VIP) and ripples to the aircraft's following legs. */
export function delayFlight(g: GameState, flightId: string, minutes: number, reason: string): ActionResult {
  const f = g.flights[flightId];
  if (!f) return { ok: false, error: 'Flight not found' };
  if (f.status !== 'scheduled') return { ok: false, error: 'This flight has already left' };
  if (!f.aircraftId) return { ok: false, error: 'Not operated by our aircraft' };
  const m = Math.round(minutes);
  if (!(m >= 5 && m <= 24 * 60)) return { ok: false, error: 'Delay between 5 minutes and 24 hours' };
  const std = Math.max(f.std + f.delay, g.now) + m;
  // The player accepts this lateness: recovery's cap counts on top of it.
  f.lateOk = Math.max(f.lateOk ?? 0, std - (f.schedStd ?? f.std));
  const before = stats(g).cancelled;
  const n = delayChain(g, f, std, reason || 'Held by operations', false);
  const dropped = stats(g).cancelled - before;
  return { ok: true, msg: `${f.no} delayed ${fmtDuration(m)}${n ? `; ${n} later leg${n > 1 ? 's' : ''} moved` : ''}${dropped ? `; ${dropped} leg${dropped > 1 ? 's' : ''} cancelled` : ''}` };
}

// ---------- housekeeping ----------

/**
 * Daily: drop done/cancelled flights a week after on-blocks (crew tickets after two days), which keeps a big
 * fleet's save small; billing (contract use), stats and crew logs already hold what they need.
 */
export function pruneFlights(g: GameState): void {
  const ids: string[] = [];
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'done' && f.status !== 'cancelled') continue;
    if ((f.ata ?? f.sta) < g.now - (f.kind === 'deadhead' ? 2 : 7) * DAY) ids.push(f.id);
  }
  if (ids.length) removeFlights(g, ids);
}

// v0.5.2: a crew short of rest after a late finish: the duty's first leg waits for them (crew.guardDuty).
setRestDelayHook((g, f, std) => {
  if (f.status !== 'scheduled' || std <= f.std) return false;
  const was = f.std;
  const n = delayChain(g, f, std, 'Crew rest');
  if (f.std + f.delay < std) return false;
  pushMessage(g, {
    tone: 'info', cat: 'ops', title: `${f.no} delayed ${fmtDuration(std - was)}`,
    body: `Crew rest: yesterday's late finish left the crew short of their minimum rest, so the report moves back. ${f.from}–${f.to} now off blocks ${fmtTime(std)} UTC${n ? `; ${n} later leg${n > 1 ? 's follow' : ' follows'}` : ''}.`,
    ref: { kind: 'flight', id: f.id },
  });
  return true;
});
