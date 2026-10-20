// Flight execution state machine (B3). DESIGN.md §5.5.
// Conventions: std/sta are the current schedule (delays move them through retimeFlight); `schedStd` keeps the
// original STD; `delay` is only a short hold not yet folded into std (crew wait, AOG decision pending).

import { BAL } from '../core/balance';
import { cancelFlight, flightsOf, removeFlights, retimeFlight, subcharterFlights, touchFlights } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, next, pick, range } from '../core/rng';
import { DAY, fmtDuration, fmtTime, monthKey } from '../core/time';
import type { ActionResult, Aircraft, Flight, GameState, MaintenanceEvent, Minute, SimEvent } from '../core/types';
import { flightCrewStatus, rerosterFrom } from '../crew';
import { crewShortDecision, hasOpenDecision } from './events';
import { aogChance, isGrounded, startAog } from './maintenance';
import { ageF, ageOf, bumpReliable, bumpRelation, contractOf, isBaseLeg, isRevenue, stats, turnOf } from './util';

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

/** Holds a departure without re-planning (same event version): re-queued `min` later. */
export function holdFlight(g: GameState, f: Flight, min: number): void {
  f.delay += min;
  schedule(g, g.now + min, 'flight.dep', f.id, f.ev);
  touchFlights(g);
}

function plannedChecks(g: GameState, acId: string, from: Minute): MaintenanceEvent[] {
  return Object.values(g.maintenance)
    .filter((m) => m.aircraftId === acId && m.status === 'planned' && m.start >= from)
    .sort((a, b) => a.start - b.start);
}

function shiftCheck(g: GameState, m: MaintenanceEvent, start: Minute): void {
  const dur = m.end - m.start;
  m.start = start;
  m.end = start + dur;
  m.ev++;
  schedule(g, m.start, 'maint.start', m.id, m.ev);
}

/**
 * Delays `f` to `std` and ripples: the aircraft's later legs (and planned checks) move so each leg departs at least
 * a turn after the previous arrival. Stops at the first leg the delay no longer reaches. Returns legs moved after f.
 */
export function delayChain(g: GameState, f: Flight, std: Minute, reason: string): number {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const later = ac ? flightsOf(g, ac.id).filter((x) => x !== f && x.status === 'scheduled' && x.std >= f.std) : [];
  const checks = ac ? plannedChecks(g, ac.id, f.std) : [];
  if (std !== f.std || f.delay) moveFlight(g, f, Math.max(std, g.now), reason);
  if (!ac) return 0;
  return pushLater(g, ac, f.sta + turnOf(ac), later, checks);
}

function pushLater(g: GameState, ac: Aircraft, ready: Minute, later: Flight[], checks: MaintenanceEvent[]): number {
  const turn = turnOf(ac);
  let n = 0;
  let ci = 0;
  for (const x of later) {
    while (ci < checks.length && checks[ci].start < x.std) {
      const m = checks[ci++];
      if (m.start < ready) shiftCheck(g, m, ready);
      ready = Math.max(ready, m.end);
    }
    if (x.std >= ready) return n;
    moveFlight(g, x, ready, x.delayReason || 'Late inbound aircraft');
    ready = x.sta + turn;
    n++;
  }
  for (; ci < checks.length; ci++) {
    const m = checks[ci];
    if (m.start >= ready) break;
    shiftCheck(g, m, ready);
    ready = m.end;
  }
  return n;
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

export interface HoldPlan {
  moves: { f: Flight; std: Minute }[];
  cancels: Flight[];
}

/**
 * Waiting out a grounding until `readyAt` at `at` (AOG courier/team): trips (charters, ferries) wait; base-programme
 * legs wait up to BAL.holdMax and are cancelled beyond it, keeping the location chain. Pure.
 */
export function planHold(g: GameState, ac: Aircraft, at: string, readyAt: Minute): HoldPlan {
  const turn = turnOf(ac);
  const plan: HoldPlan = { moves: [], cancels: [] };
  let loc = at;
  let ready = readyAt;
  for (const x of flightsOf(g, ac.id)) {
    if (x.status !== 'scheduled') continue;
    if (x.std >= ready && x.from === loc) break;
    if (x.from !== loc) {
      if (x.std >= ready + 12 * 60) break;
      plan.cancels.push(x);
      continue;
    }
    const std = Math.max(x.std, ready);
    if (std - x.std <= BAL.holdMax || !isBaseLeg(g, x)) {
      plan.moves.push({ f: x, std });
      loc = x.to;
      ready = std + x.block + turn;
    } else plan.cancels.push(x);
    if (plan.moves.length + plan.cancels.length >= 24) break;
  }
  return plan;
}

export function applyHold(g: GameState, plan: HoldPlan, reason: string): void {
  cancelLegs(g, plan.cancels, reason, 1);
  for (const { f, std } of plan.moves) {
    if (f.status !== 'scheduled') continue;
    if (std !== f.std) moveFlight(g, f, std, reason);
    else if (f.delay) {
      f.delay = 0;
      schedule(g, Math.max(g.now, f.std), 'flight.dep', f.id, f.ev);
    }
  }
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

/**
 * Cancels legs with compensation; `repPerLeg` reliability per revenue leg (at most 3 in total). Positioning and
 * ferry legs simply go (contracts re-plans empty legs). Returns the compensation paid.
 */
export function cancelLegs(g: GameState, legs: Flight[], reason: string, repPerLeg: number): number {
  const live = legs.filter((f) => f.status === 'scheduled');
  if (!live.length) return 0;
  const pen = cancelCost(g, live);
  let rev = 0;
  for (const f of live) {
    cancelFlight(g, f, reason);
    if (isRevenue(f)) {
      rev++;
      bumpRelation(g, contractOf(g, f)?.clientId, -2);
    }
  }
  if (pen) post(g, 'penalties', -pen);
  stats(g).cancelled += rev;
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

/** Rival for a sub-charter: one flying the same family if possible (picked with the RNG). */
export function pickRival(g: GameState, typeId: string): string {
  const fam = typeOf(typeId).family;
  const fit = g.rivals.filter((r) => r.fleet.some((x) => typeOf(x.typeId).family === fam));
  const pool = fit.length ? fit : g.rivals;
  return pool.length ? pick(g, pool).id : '';
}

/** Hands revenue legs to a rival (still billed to our client), drops the empty legs; posts the cost. */
export function subcharterLegs(g: GameState, legs: Flight[], rivalId: string, cost: number): number {
  const live = legs.filter((f) => f.status === 'scheduled');
  const rev = live.filter(isRevenue);
  const empty = live.filter((f) => !isRevenue(f));
  if (empty.length) removeFlights(g, empty.map((f) => f.id));
  if (rev.length) subcharterFlights(g, rev.map((f) => f.id), rivalId || 'rival');
  if (cost) post(g, 'subcharter', -cost);
  stats(g).subchartered += rev.length;
  return rev.length;
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

/** 'flight.dep' at std (+hold): readiness → crew → random delay (once) → AOG roll → off-blocks. */
export function onFlightDep(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v || f.status !== 'scheduled' || !f.aircraftId) return;
  const ac = g.fleet[f.aircraftId];
  if (!ac) return;
  // 1. Aircraft readiness.
  if (ac.status === 'aog' || ac.status === 'maintenance' || ac.status === 'delivering' || ac.flightId || ac.at !== f.from) {
    notReady(g, f, ac);
    return;
  }
  if (f.kind !== 'ferry' && isGrounded(g, ac)) {
    cancelLegs(g, [f], 'Aircraft grounded: check overdue', 1);
    pushMessage(g, { tone: 'bad', cat: 'tech', title: `${ac.reg} grounded`, body: `A check is overdue: ${f.no} ${f.from}–${f.to} cancelled. Book the check on the Fleet screen.`, ref: { kind: 'aircraft', id: ac.id } });
    return;
  }
  // 2. Crew complete and legal.
  if (crewBlocked(g, f)) {
    crewProblem(g, f, ac);
    return;
  }
  // 3. Random delay, rolled once per flight.
  if (f.delayReason === undefined) {
    const d = rollDelay(g, ac);
    if (d) {
      const n = delayChain(g, f, g.now + d.min, d.reason);
      if (d.min >= BAL.delayMessageMin) {
        pushMessage(g, {
          tone: 'info', cat: 'ops', title: `${f.no} delayed ${fmtDuration(d.min)}`,
          body: `${d.reason}. ${f.from}–${f.to} now off blocks ${fmtTime(f.std)} UTC${n ? `; ${n} later leg${n > 1 ? 's' : ''} follow` : ''}.`,
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
  depart(g, f, ac);
}

function depart(g: GameState, f: Flight, ac: Aircraft): void {
  f.status = 'enroute';
  f.atd = g.now;
  ac.flightId = f.id;
  ac.at = f.from;
  ac.status = 'flying';
  f.eta = g.now + Math.max(15, Math.round(f.block * (1 + range(g, -BAL.windNoise, BAL.windNoise))));
  schedule(g, f.eta, 'flight.arr', f.id, f.ev);
  const s = stats(g);
  s.departures++;
  const duty = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (duty?.legality === 'illegal') s.illegalFlown++;
  // Charter clients are compensated for long delays (> 3 h).
  const c = contractOf(g, f);
  if (c?.product.kind === 'charter' && isRevenue(f) && delayOf(f) > 180 && c.penalties.perDelay) post(g, 'penalties', -c.penalties.perDelay);
  touchFlights(g);
}

/** This departure can't go: seats unfilled, or its own duty is illegal (a later duty's problem is re-rostered later). */
export function crewBlocked(g: GameState, f: Flight): boolean {
  const cs = flightCrewStatus(g, f.id);
  if (cs.level === 'missing') return true;
  if (cs.level !== 'illegal') return false;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  return !d || d.legality === 'illegal';
}

/** Aircraft not ready: wait for the running flight, the check or the AOG fix; hold while a decision is open. */
function notReady(g: GameState, f: Flight, ac: Aircraft): void {
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
  if (ac.flightId) {
    const cur = g.flights[ac.flightId];
    const ready = cur ? (cur.eta ?? cur.sta) + turnOf(ac) : g.now + 30;
    delayChain(g, f, Math.max(g.now + 5, ready), 'Late inbound aircraft');
    return;
  }
  // Wrong airport: an earlier leg still to fly will bring it (hold), else wait for re-planning, then give up.
  const earlier = flightsOf(g, ac.id).some((x) => x !== f && x.status === 'scheduled' && x.std <= f.std);
  if (earlier || f.delay < 180) return holdFlight(g, f, 30);
  cancelLegs(g, [f], 'Aircraft out of position', 1);
  pushMessage(g, { tone: 'bad', cat: 'ops', title: `${f.no} cancelled`, body: `${ac.reg} is at ${ac.at}, not ${f.from}.`, ref: { kind: 'flight', id: f.id } });
}

/** Crew incomplete or illegal: re-roster and wait up to BAL.crewWaitMin, then the crew-short decision. */
function crewProblem(g: GameState, f: Flight, ac: Aircraft): void {
  if (!f.crewHeld) {
    f.crewHeld = true;
    stats(g).uncovered++;
    rerosterFrom(g, ac.id, g.now);
  }
  if (hasOpenDecision(g, 'crewShort', f.id) || f.delay < BAL.crewWaitMin) return holdFlight(g, f, 30);
  if (f.crewDecided) {
    // A recovery was already tried: give the legs up rather than fly illegally.
    const legs = windowLegs(g, ac, f.from, g.now + 1);
    cancelLegs(g, legs, 'No legal crew', 1);
    pushMessage(g, { tone: 'bad', cat: 'crew', title: `${f.no} cancelled: no legal crew`, body: `${f.from}–${f.to} could not be crewed after the recovery.`, ref: { kind: 'flight', id: f.id } });
    return;
  }
  crewShortDecision(g, f, ac);
  holdFlight(g, f, 30);
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
    touchFlights(g);
    return;
  }
  if (f.status !== 'enroute') return;
  const ac = g.fleet[f.aircraftId];
  f.status = 'done';
  f.ata = g.now;
  touchFlights(g);
  if (!ac) return;
  ac.flightId = null;
  ac.at = f.to;
  if (ac.status === 'flying') ac.status = 'available';
  const block = Math.max(0, g.now - (f.atd ?? f.std));
  const bh = block / 60;
  const fh = Math.max(0, block - 20) / 60;
  ac.hours += fh;
  ac.cycles += 1;
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
    if (g.now <= schedSta(f) + 15) s.onTime++;
    else s.delayed++;
    const target = (100 * s.onTime) / s.legs;
    const r = g.company.reputation.reliable;
    if (Math.abs(target - r) >= 0.05) bumpReliable(g, target > r ? 0.05 : -0.05);
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
  const n = delayChain(g, f, Math.max(f.std + f.delay, g.now) + m, reason || 'Held by operations');
  return { ok: true, msg: `${f.no} delayed ${fmtDuration(m)}${n ? `; ${n} later leg${n > 1 ? 's' : ''} moved` : ''}` };
}

// ---------- housekeeping ----------

/** Daily: drop done/cancelled flights once their month is closed and they are 28 days old (stats keep totals). */
export function pruneFlights(g: GameState): void {
  const cut = g.now - 28 * DAY;
  const month = monthKey(g.now);
  const ids: string[] = [];
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'done' && f.status !== 'cancelled') continue;
    const t = f.ata ?? f.sta;
    if (t < cut && monthKey(t) < month) ids.push(f.id);
  }
  if (ids.length) removeFlights(g, ids);
}
