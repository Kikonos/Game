// Pattern → flights, positioning legs and rolling base schedules (B1). DESIGN.md §5.1.6–5.1.8.

import { BAL } from '../core/balance';
import { curfewOk } from '../core/curfew';
import { addFlight, flightsOf, liveFlightsOf, ownFlightNo, removeFlights, retimeFlight, touchFlights } from '../core/entities';
import { etopsCap, reportMinutes, TECH_STOP_MIN, typeOf } from '../core/perf';
import { ticketBlock } from '../ops/commercial';
import { safetyTrip } from '../core/safety';
import { positioningFit, restBeforeJob, restedDeparture, type MoveLeg } from '../crew/duties';
import { restOf } from '../crew/restPlan';
import { segsOf } from '../crew/timeline';
import { farBase } from '../crew/farBase';
import { DAY, dayStart } from '../core/time';
import type { Contract, Flight, GameState, Minute } from '../core/types';
import {
  anchorsOf, AWAY_GAP, baseDayOf, baseDays, baseDayStart, baseFlightNo, chainBackward, chainForward, CHARTER_SLACK, DEPLOY_LEAD, flownRotations, gapMoves,
  HOME_HOP_MIN, isHold, isSoft, onwardPending, planLegs, route, type Anchor, type ChainLeg,
} from './plan';

const horizonEnd = (g: GameState) => dayStart(g.now) + BAL.scheduleHorizonDays * DAY;

/**
 * v0.12.1 the longest empty leg one crew flies in a day (block): the empty-move planner (plan.ts route) splits a longer
 * one at a crew-change stop and times it as ferry days with a night stop, as a delivery is. Pilots only, an hour's
 * report and 30 min after: two pilots 11:00 (a 12:30 day inside the 13:00 of a daytime report); with the augmented-crew
 * approval and pilot rest on board, three pilots 14:30 in bunks, 13:30 in class 2 seats, 12:30 in class 3 (CS FTL.1.205
 * 16, 15, 14 h). Pure.
 */
export function emptyDay(g: GameState, aircraftId: string): number {
  const ac = g.fleet[aircraftId];
  if (!ac) return Infinity;
  const fc = g.company.approvals.includes('augmented') ? restOf(g, aircraftId).fc : undefined;
  return fc ? [14.5, 13.5, 12.5][Math.min(3, Math.max(1, fc.cls)) - 1] * 60 : 11 * 60;
}

/**
 * v0.16.1 the jobs whose event permits an empty leg flies under: the job that flew the aircraft in (its permit lets it
 * out) and the job it flies out to (an evacuation's clearance lets its positioning into the closed airport).
 */
export type Permit = string | null | (string | null)[];

/**
 * v0.12.1 (review) when an airport a world event has closed at t opens again for our empty legs (the reopening plus
 * 3 h), or null when it is open then; `permit`: the job(s) whose event permits apply (Permit).
 * Set by contracts/offers.ts from ops/world (no import cycle).
 */
// (var, no initialiser: the hook may be set before this module finishes loading, as ops/world.ts's hooks.)
// eslint-disable-next-line no-var
var openFrom: ((g: GameState, code: string, t: Minute, permit: Permit) => Minute | null) | null | undefined;
export function setOpenFromHook(f: typeof openFrom): void {
  openFrom = f;
}

/** v0.12.1 (review) an empty leg planned after a closure's reopening (`from`: when it could have left): ops/world asks. */
// eslint-disable-next-line no-var
var closurePlannedHook: ((g: GameState, f: Flight, from: Minute) => void) | null | undefined;
export function setClosurePlannedHook(f: typeof closurePlannedHook): void {
  closurePlannedHook = f;
}

/**
 * v0.14 a move out of a far outstation planned to leave when a crew flown out can be there, landing after the work it
 * was planned for has started (`arrive`: its last landing): ops/world asks once what becomes of that work.
 */
// eslint-disable-next-line no-var
var farLateHook: ((g: GameState, f: Flight, arrive: Minute) => void) | null | undefined;
export function setFarLateHook(f: typeof farLateHook): void {
  farLateHook = f;
}

/**
 * v0.12.1 (review) the first time at or after t an empty leg may leave `code` (S1027: BLU1574 GOM–NDJ planned 29 Oct
 * 06:40, Goma shut to 30 Oct). Pure. v0.15 exported for the checker (scripts/invariants.ts pos-fdp).
 */
export const openAfter = (g: GameState, code: string, t: Minute, permit: Permit): Minute => Math.max(t, openFrom?.(g, code, t, permit) ?? t);

/**
 * v0.12.1 (review) a chain that leaves or lands at an airport closed then (a leg landing inside a closure, a fuel stop
 * shut): the time that airport opens again, else null. Pure.
 */
function shutIn(g: GameState, chain: ChainLeg[], permit: Permit | ((std: Minute) => Permit)): Minute | null {
  if (!openFrom || !chain.length) return null;
  if (typeof permit === 'function') permit = permit(chain[0].std);
  for (const l of chain) {
    const t = openFrom(g, l.from, l.std, permit) ?? openFrom(g, l.to, l.sta, permit);
    if (t !== null) return t;
  }
  return null;
}

/**
 * v0.12.1 (review) the job whose event permit an empty leg out of X carries (ops/world permitOf: the leg that flew the
 * aircraft in): the gap's own leg in, or, from where the aircraft stands, its last leg flown there. Pure.
 */
function inboundJob(g: GameState, aircraftId: string, a: Anchor, X: string): string | null {
  if (a.kind === 'flight') return a.contractId;
  if (a.kind !== 'start') return null;
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) if ((f.status === 'done' || f.status === 'enroute') && f.kind !== 'deadhead' && (!last || f.std >= last.std)) last = f;
  return last && last.to === X ? last.contractId : null;
}

/** v0.12.1 (review) chainForward from `from`, moved past any closure on its way (a few tries). */
function openForward(g: GameState, typeId: string, X: string, Y: string, from: Minute, cap: number, permit: Permit | ((std: Minute) => Permit), day = Infinity): ChainLeg[] | null {
  let t = from;
  for (let i = 0; i < 4; i++) {
    const ch = chainForward(typeId, X, Y, t, cap, day);
    if (!ch) return null;
    const re = shutIn(g, ch, permit);
    if (re === null) return ch;
    // A landing inside the closure: leave late enough to land after the reopening.
    t = Math.max(t + 60, re - (ch[ch.length - 1].sta - ch[0].std));
  }
  return null;
}

/**
 * Creates the contract's flights on its aircraft: revenue legs (split by fuel stops, internal empty legs), then
 * positioning in/out through relinkPositioning; 'base' patterns only up to the rolling horizon. Returns created flights.
 */
export function generateFlights(g: GameState, c: Contract): Flight[] {
  const out: Flight[] = [];
  if (c.pattern.kind === 'legs') {
    const acId = c.aircraftIds[0];
    const ac = g.fleet[acId];
    if (!ac) return out;
    const prog = planLegs(c.pattern, ac.typeId, !!c.requirements.noTechStops);
    if (!prog.ok) return out;
    const nos = new Map<number, string>();
    for (const t of prog.trips) {
      for (const l of t.legs) {
        let no: string;
        if (l.kind === 'positioning') no = ownFlightNo(g);
        else {
          no = nos.get(l.tpl) ?? (c.pattern.legs[l.tpl].flightNo || ownFlightNo(g));
          nos.set(l.tpl, no);
        }
        out.push(addFlight(g, { no, aircraftId: acId, contractId: c.id, kind: l.kind, from: l.from, to: l.to, std: l.std, sta: l.sta, pax: l.kind === 'positioning' ? undefined : l.pax }));
      }
    }
    // Keep the flight numbers on the pattern so panels show them.
    nos.forEach((no, i) => (c.pattern.kind === 'legs' ? (c.pattern.legs[i].flightNo = no) : undefined));
  } else {
    out.push(...extendContract(g, c, horizonEnd(g)));
  }
  for (const id of c.aircraftIds) out.push(...relinkPositioning(g, id));
  return out;
}

/** When the aircraft could first operate from `at` given its commitments before `before`. */
function readyAt(g: GameState, aircraftId: string, at: string, before: Minute, excludeContract: string): Minute {
  const ac = g.fleet[aircraftId];
  const turn = typeOf(ac.typeId).turnMin;
  let prev: Anchor | null = null;
  for (const n of anchorsOf(g, aircraftId)) {
    if (n.contractId === excludeContract || n.std >= before) continue;
    if (!prev || n.sta > prev.sta) prev = n;
  }
  if (!prev) return g.now;
  const earliest = prev.kind === 'start' ? prev.sta + 60 : prev.sta + turn;
  if (prev.to === at) return earliest;
  const ch = chainForward(ac.typeId, prev.to, at, earliest, etopsCap(g.company.approvals, ac.typeId), emptyDay(g, aircraftId));
  return ch && ch.length ? ch[ch.length - 1].sta + turn : earliest;
}

/** Base pattern: adds the rotations of every day starting before `until` (skips maintenance and clashes). */
function extendContract(g: GameState, c: Contract, until: Minute): Flight[] {
  const p = c.pattern;
  if (p.kind !== 'base' || c.generatedUntil >= p.to) return [];
  const out: Flight[] = [];
  const n = baseDays(p);
  const k0 = Math.max(0, baseDayOf(p, c.generatedUntil));
  let k1 = k0;
  while (k1 < n && baseDayStart(p, k1) < until) k1++;
  if (k1 === k0) return out;
  c.aircraftIds.forEach((acId, slot) => {
    const ac = g.fleet[acId];
    if (!ac) return;
    const turn = typeOf(ac.typeId).turnMin;
    const days = flownRotations(p, ac.typeId, slot);
    const maint = Object.values(g.maintenance).filter((m) => m.aircraftId === acId && (m.status === 'planned' || m.status === 'inWork'));
    const hard = flightsOf(g, acId).filter((f) => f.contractId !== c.id && f.status !== 'cancelled' && f.status !== 'done' && !isSoft(g, f));
    const first = c.generatedUntil <= p.from ? readyAt(g, acId, p.base, days.find((d) => d.length)?.[0].outStd ?? p.from, c.id) : -Infinity;
    for (let k = k0; k < k1; k++) {
      for (const r of days[k]) {
        if (r.outStd < Math.max(first, g.now + 30)) continue;
        const a = r.outStd - turn;
        const b = r.backSta + turn;
        if (maint.some((m) => m.start < b && m.end > a) || hard.some((f) => f.std < b && f.sta > a)) continue;
        out.push(addFlight(g, { no: baseFlightNo(p, r.destIdx, r.w, false), aircraftId: acId, contractId: c.id, kind: 'revenue', from: p.base, to: r.dest, std: r.outStd, sta: r.outSta }));
        out.push(addFlight(g, { no: baseFlightNo(p, r.destIdx, r.w, true), aircraftId: acId, contractId: c.id, kind: 'revenue', from: r.dest, to: p.base, std: r.backStd, sta: r.backSta }));
      }
    }
  });
  c.generatedUntil = k1 >= n ? p.to : baseDayStart(p, k1);
  return out;
}

/** Daily: roll 'base' patterns forward to the horizon (and stop at contract end); repair positioning. */
export function extendBaseSchedules(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.pattern.kind === 'base') extendContract(g, c, horizonEnd(g));
  }
  for (const id of Object.keys(g.fleet)) relinkPositioning(g, id);
}

/**
 * Adds empty positioning (billable on wet) or ferry legs so the aircraft is at `to` by `arriveBy` (lands a turn
 * before it): one leg, or several with fuel stops (A320 LIS→KBL via a stop). Departs as late as possible after its
 * previous commitment and replaces soft positioning legs in that gap; [] when already there; null when it can't fit.
 * Used by B1 and by B3 (maintenance ferries, AOG swaps).
 */
export function planPositioning(g: GameState, aircraftId: string, to: string, arriveBy: Minute, kind: 'positioning' | 'ferry', contractId: string | null): Flight[] | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const turn = typeOf(ac.typeId).turnMin;
  let prev: Anchor | null = null;
  for (const n of anchorsOf(g, aircraftId)) if (n.std < arriveBy && (!prev || n.sta > prev.sta)) prev = n;
  if (!prev) return null;
  if (prev.to === to) return [];
  // v0.12.1 (review) never out of an airport while it is closed. v0.16.1 the leg's own job's permit lets it in.
  const job: Permit = [inboundJob(g, aircraftId, prev, prev.to), contractId];
  const earliest = openAfter(g, prev.to, prev.kind === 'start' ? prev.sta : prev.sta + turn, job);
  const cap = etopsCap(g.company.approvals, ac.typeId);
  const day = emptyDay(g, aircraftId);
  const chain = chainBackward(ac.typeId, prev.to, to, crewFree(g, aircraftId, prev.to, earliest), arriveBy - turn, cap, day) ?? chainBackward(ac.typeId, prev.to, to, earliest, arriveBy - turn, cap, day);
  if (!chain || shutIn(g, chain, job) !== null) return null;
  const stale = flightsOf(g, aircraftId).filter((f) => isSoft(g, f) && f.std >= prev!.std && f.std < arriveBy).map((f) => f.id);
  if (stale.length) removeFlights(g, stale);
  return chain.map((l) => addFlight(g, { no: ownFlightNo(g), aircraftId, contractId, kind, from: l.from, to: l.to, std: l.std, sta: l.sta }));
}

/**
 * Minutes from now before a crew flown out on a ticket of `blk` minutes can report for an empty leg. A short ticket
 * the same morning; a long one the day before, with minimum rest on arrival (FDP). v0.14 to a far outstation (`far`:
 * crew/farBase.ts, a ticket over 12 h or 4+ time zones) the crew first wait for the day's flight out, and the rest after
 * the ticket is as long as its duty, 14 h at least (rules.ts minRest): the lead was 30 h to Manila where a crew needed
 * 42 h, so every plan out of there was one no crew could make (CS-TIF stranded for a month, re-planned at 30 h and held
 * a day at a time, never crewed). Pure.
 */
export function ticketLead(typeId: string | undefined, blk: number, far = false): number {
  if (!far) return blk + (blk <= 180 ? 6 * 60 : 14 * 60);
  const duty = BAL.deadheadCheckIn + blk;
  return TICKET_WAIT + duty + Math.max(14 * 60, duty) + (typeId ? reportMinutes(typeId).report : 60);
}

/** v0.14 an outstation a crew reaches from home only on a long ticket or across 4+ time zones (farBase). Pure. */
export function farOutstation(g: GameState, at: string): boolean {
  return farBase(g.company.homeBase, at, g.now);
}

/** v0.14 the wait for an airline's daily flight out (with the crew's notice), added before a far ticket. Rotations round: half a day (tickets leave on the route's timetable, a long thin route once or twice a day). */
const TICKET_WAIT = 12 * 60;

/**
 * Earliest departure of new empty legs from X. An aircraft idle at an outstation for a while has no crew aboard:
 * the legs leave no sooner than a ticket from base gets a crew there (same day when short, else the day before).
 * Right after landing the operating crew can still take it on.
 */
function crewFree(g: GameState, aircraftId: string, X: string, earliest: Minute): Minute {
  const home = g.company.homeBase;
  const blk = X === home ? 0 : ticketBlock(home, X);
  const lead = X === home ? 120 : ticketLead(g.fleet[aircraftId]?.typeId, blk, farOutstation(g, X));
  // v0.9.1: also when the earliest slot is still ahead but inside a ticket's reach (seed 5: an aircraft held at Goma by a
  // closure got its positioning out 6 h after the reopening, its crew already gone home: 18 red alerts in three days).
  if (earliest > g.now + lead) return earliest;
  const at = Math.max(earliest, g.now);
  let landed = -Infinity;
  for (const f of flightsOf(g, aircraftId)) {
    if (f.to !== X || f.status === 'cancelled') continue;
    const t = f.status === 'done' ? f.ata ?? f.sta : f.sta;
    if (t <= at) landed = Math.max(landed, t);
  }
  if (at - landed < 3 * 60) return earliest;
  return Math.max(earliest, Math.ceil((g.now + lead) / 5) * 5);
}

/** v0.23.2 a late empty move whose crew wait at the airport is pulled forward when it would leave this much sooner. */
const PULL_MIN = 3 * 60;

/**
 * v0.23.2 (9H-VZH, player report) the earliest the crew rostered on the empty leg `f` out of X can fly it when they are
 * all at X now (the ferry crew of a chain's earlier day, in a hotel there): their rest and the report, two hours from
 * now at least, or the leg's own time when that is sooner. null when the leg has no crew or one of them is elsewhere.
 * crewFree read an aircraft a few hours on the ground far from home as crewless and put every new plan a ticket's lead
 * from now (46 h at Quito): each time the late move was planned again (the leg it flew to cancelled, the next one out
 * of another airport) it left two days later still, and never did. Pure.
 */
function crewThere(g: GameState, f: Flight | undefined, X: string): Minute | null {
  if (!f || f.status !== 'scheduled' || f.from !== X || !f.crewIds.length) return null;
  let rested = -Infinity;
  for (const id of f.crewIds) {
    const c = g.crew[id];
    if (!c || c.loc !== X || (c.status !== 'available' && c.status !== 'resting')) return null;
    if (c.blocks?.some((b) => b.from < f.std && b.to > g.now)) return null;
    rested = Math.max(rested, c.restUntil);
    // The rest after what they have done or are doing there (a hotel standby is followed by rest too).
    for (const sg of segsOf(g, c)) if (sg.start <= g.now && sg.kind !== 'log') rested = Math.max(rested, sg.end + sg.rest);
  }
  const report = f.aircraftId && g.fleet[f.aircraftId] ? reportMinutes(g.fleet[f.aircraftId].typeId).report : 60;
  return Math.max(Math.ceil((rested + report) / 5) * 5, Math.min(f.std, Math.ceil((g.now + 120) / 5) * 5));
}

/**
 * v0.23.2 the aircraft is behind on the job the leg `b` belongs to: the job's flight before it on this aircraft was
 * cancelled (the aircraft was not there). The empty move into such a job leaves as soon as it can and waits at the
 * job's airport, not as late as the next flight still standing allows: that flight is the next to go when anything
 * slips, and the move was put back each time one did. Pure.
 */
function behindOn(g: GameState, aircraftId: string, b: Anchor): boolean {
  if (b.kind !== 'flight' || !live(g, b.contractId)) return false;
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) {
    if (f.kind !== 'revenue' || f.id === b.id || f.std > b.std) continue;
    if (!last || f.std >= last.std) last = f;
  }
  return !!last && last.status === 'cancelled' && last.contractId === b.contractId;
}

/** v0.14 the longest night stop between two ferry days of one empty chain (plan.ts nextDay: 14 h, put to 07:00 local). */
const FERRY_NIGHT_MAX = 30 * 60;

const live = (g: GameState, id: string | null) => !!id && (g.contracts[id]?.status === 'signed' || g.contracts[id]?.status === 'active');

/**
 * v0.12.1 a live contract with flying still to do (a revenue leg to come, or base days not yet generated): only such a
 * contract gets a new empty leg between two commitments (one tagged to a finished job kept it active for days). Pure.
 */
function flying(g: GameState, id: string | null): boolean {
  if (!live(g, id)) return false;
  const c = g.contracts[id!];
  if (c.pattern.kind === 'base' && c.generatedUntil < c.pattern.to) return true;
  return Object.values(g.flights).some((f) => f.contractId === id && f.status === 'scheduled' && (f.kind === 'revenue' || f.kind === 'techstop'));
}

/** v0.12.1 an empty move from X that reaches Y on time exists (X = Y: staying put always is). Pure. */
function onTimeMove(typeId: string, X: string, Y: string, earliest: Minute, latest: Minute, home: string, allowHop: boolean, cap: number, day = Infinity): boolean {
  const ch = X === Y ? gapMoves(typeId, X, Y, earliest, latest, home, allowHop, cap, day) : chainBackward(typeId, X, Y, earliest, latest, cap, day);
  return !!ch;
}

/**
 * v0.12.1 the aircraft is on the ground at X after its last leg of a job whose later legs out of X were cancelled (a
 * crew shortage, a client's cancellation): nothing would take it home (CS-TTL sat at Port Sudan for a month). Pure.
 */
export function stranded(g: GameState, aircraftId: string, X: string): boolean {
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.kind !== 'deadhead' && (!last || f.std >= last.std)) last = f;
  if (!last || last.to !== X || !last.contractId) return false;
  const k = last.contractId;
  return flightsOf(g, aircraftId).some((f) => f.status === 'cancelled' && f.contractId === k && f.from === X && f.std >= last!.std);
}

/**
 * v0.12.1 after a curfew diversion to X (the leg on its way there, or landed in the last day), the earliest the empty
 * leg out can leave: when its crew have had their minimum rest (seed 9: AWL200 CGN–DUS flown on 3 h of rest after the
 * Düsseldorf curfew diversion). -Infinity otherwise. Pure.
 */
function restAfterCurfew(g: GameState, a: Anchor, aircraftId: string, X: string): Minute {
  let f: Flight | undefined = a.kind === 'flight' ? g.flights[a.id] : undefined;
  if (a.kind === 'start') for (const y of flightsOf(g, aircraftId)) if (y.status === 'done' && y.kind !== 'deadhead' && (!f || y.std >= f.std)) f = y;
  if (!f || f.to !== X || !f.div || f.ops !== 'curfew' || (f.ata !== undefined && g.now - f.ata >= DAY)) return -Infinity;
  // From the landing, never from now: the earliest stays put from one relink to the next (a fixed point). Their own
  // crew after the rest is the crew there for sure (a crew flown in sooner is not: seed 2, no captain could make it).
  const home = g.company.homeBase;
  const blk = X === home ? 0 : ticketBlock(home, X);
  const fresh = Math.ceil(((f.ata ?? f.eta ?? f.sta) + (X === home ? 120 : blk + (blk <= 180 ? 6 * 60 : 14 * 60))) / 5) * 5;
  return restedDeparture(g, f) ?? fresh;
}

/**
 * v0.15.1 the crew who flew the aircraft in on an empty leg (a ferry day of a crew-change chain, a positioning): when
 * they landed at X and when they can fly on after their minimum rest (restedDeparture); null when the leg before the
 * gap is no such leg with a crew (airborne now, or flown in the last day). A move timed between the turn they could
 * still make and the end of their rest has nobody to fly it (a fresh crew comes no sooner: crewFree). Seed 1: AWL127
 * KTM–PVG pulled from 05:20 to 01:20 for the job's crew while its ferry crew rested until 04:12, its crew gone, then
 * eight days at Kathmandu and Juneyao's Shanghai legs sub-chartered seven times. Pure.
 */
function inboundCrew(g: GameState, a: Anchor, aircraftId: string, X: string): { landed: Minute; rested: Minute; block: number } | null {
  let f: Flight | undefined = a.kind === 'flight' ? g.flights[a.id] : undefined;
  if (a.kind === 'start') for (const y of flightsOf(g, aircraftId)) if (y.status === 'done' && y.kind !== 'deadhead' && (!f || y.std >= f.std)) f = y;
  if (!f || f.to !== X || (f.kind !== 'positioning' && f.kind !== 'ferry') || !f.dutyId) return null;
  if (f.status === 'scheduled' ? !f.crewIds.length : f.status !== 'enroute' && (f.status !== 'done' || f.ata === undefined || g.now - f.ata >= DAY)) return null;
  const rested = restedDeparture(g, f);
  // (The landing as crewFree reads it: the schedule's, not the wind's.)
  // v0.23.2 what their day has flown by then (its legs and the fuel stops between).
  const day = g.duties[f.dutyId]?.flightIds.map((id) => g.flights[id]).filter((x) => x && x.std <= f!.std) ?? [];
  const block = day.reduce((s, x) => s + x.block, 0) + Math.max(0, day.length - 1) * TECH_STOP_MIN;
  return rested === null ? null : { landed: f.status === 'done' ? f.ata! : f.sta, rested, block };
}

/** v0.15.1 the same crew can take a leg on within this of landing (crewFree's reading). */
const SAME_CREW_MIN = 3 * 60;

/** v0.12.1 the aircraft is at X after a technical diversion that no onward leg carried on from (coach, rival, fix). Pure. */
function ownFaultAt(g: GameState, aircraftId: string, X: string): boolean {
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.kind !== 'deadhead' && (!last || f.std >= last.std)) last = f;
  return !!last && last.to === X && last.div?.cause === 'technical' && !last.contOf;
}

/** Positioning lead before a commitment: the evening before a deployment, a turn plus slack before a charter. */
function leadFor(g: GameState, b: Anchor, turn: number): number {
  const c = b.contractId ? g.contracts[b.contractId] : undefined;
  if (!c) return turn;
  // v0.12.1 a world tour too: the aircraft is at the gateway the evening before (catering, crew rest, the guests' check-in).
  return c.pattern.kind === 'base' || isHold(c) ? DEPLOY_LEAD : turn + CHARTER_SLACK;
}

function chainOk(legs: Flight[], X: string, Y: string | null, earliest: Minute): boolean {
  if (!legs.length) return false;
  if (legs[0].from !== X || legs[0].std < earliest) return false;
  for (let i = 1; i < legs.length; i++) if (legs[i].from !== legs[i - 1].to || legs[i].std < legs[i - 1].sta) return false;
  // v0.14.1 (OPS-4) nor a chain that leaves or lands inside a night curfew: one kept from a save made before the
  // curfew-aware planner, or moved there since, is planned again (S1027: CS-TCS into DUS at 05:50 local every week).
  if (!legs.every((f) => curfewOk(f.from, f.std) && curfewOk(f.to, f.sta))) return false;
  return Y === null || legs[legs.length - 1].to === Y;
}

/**
 * v0.12.1 a chain that is right but leaves a few minutes before `earliest` (the inbound's ETA slipped), moved by just
 * those minutes when it still reaches Y by `latest` outside the night curfews; null otherwise. Re-planned from scratch
 * it went to the other end of the gap and its crew's duty broke (S1027: BLU953 DUS–LIS, 7 min behind BLU932's ETA, moved
 * from 15:45 to 21:59; the crew's day ran 14:44, a red alarm and the next morning's flight late). Pure.
 */
function nudged(legs: Flight[], X: string, Y: string | null, earliest: Minute, latest: Minute): (ChainLeg & { contractId: string | null })[] | null {
  if (!legs.length || legs[0].from !== X || legs.some((f) => f.status !== 'scheduled')) return null;
  const d = Math.ceil((earliest - legs[0].std) / 5) * 5;
  if (d <= 0 || d > 3 * 60) return null;
  // v0.14.1 (CREW-1) each leg keeps its own job, and a leg after a wait (a hop home, then out to the next job days
  // later) moves only by what the wait does not absorb: the ferry home FCO–LIS (the pilgrimage's) and the move out
  // LIS–AMS 13 days later (the next job's) were refused, and a 4-min ETA slip re-made the crewed ferry with no crew.
  let carry = d;
  const out = legs.map((f, i) => {
    // (A ferry day's night stop is the crew's rest: the next day moves with the first, as before.)
    if (i > 0 && f.std - legs[i - 1].sta > FERRY_NIGHT_MAX) carry = Math.max(0, carry - (f.std - legs[i - 1].sta - TECH_STOP_MIN));
    return { from: f.from, to: f.to, std: f.std + carry, sta: f.sta + carry, contractId: f.contractId };
  });
  for (let i = 1; i < out.length; i++) if (out[i].from !== out[i - 1].to || out[i].std < out[i - 1].sta) return null;
  const last = out[out.length - 1];
  if ((Y !== null && last.to !== Y) || last.sta > latest) return null;
  return out.every((l) => curfewOk(l.from, l.std) && curfewOk(l.to, l.sta)) ? out : null;
}

/** The airports an empty move from → to calls at (fuel stops included), or null without a route. */
function routePath(typeId: string, from: string, to: string, cap: number, day = Infinity): string[] | null {
  const r = route(typeId, from, to, cap, day);
  return r ? [from, ...r.map((l) => l.to)] : null;
}

const samePath = (a: string[], b: string[] | null) => !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * v0.7.2.2 (player bug: a moved trip left its ferries on the old aircraft): a continuous chain is only kept when it
 * is a move the planner itself would make between X and Y (Y null: the end of the schedule): the direct route (its
 * fuel stops), or, where a hop home is allowed, out home and back on. A loop that leaves and comes back to the same
 * airport for nothing (LIS–MAN–LIS around a trip that went to another aircraft) or detours through a station no
 * commitment needs any more is an orphan: it is removed and the gap re-planned.
 */
function chainSane(typeId: string, legs: Flight[], X: string, Y: string | null, home: string, allowHop: boolean, cap: number, day = Infinity): boolean {
  const path = [legs[0].from, ...legs.map((f) => f.to)];
  // End of the schedule: only the way home is ever planned.
  if (Y === null) return X !== home && samePath(path, routePath(typeId, X, home, cap, day));
  const direct = X !== Y ? routePath(typeId, X, Y, cap, day) : null;
  if (X !== Y && samePath(path, direct)) return true;
  // v0.14.1 a chain that makes the planner's first stop and then flies the planner's route on from there is its move too
  // (the fuel stops after the first may differ: GOM–NDJ then NDJ–DJE–MAN where GOM–MAN goes on over Tunis). Read as an
  // orphan, the leg on from the first stop was re-made on every settle once the first leg was too near to re-plan.
  if (direct && direct.length > 2 && path.length > 2 && path[1] === direct[1] && samePath(path.slice(1), routePath(typeId, path[1], Y, cap, day))) return true;
  if (!allowHop || X === home || Y === home) return false;
  const k = path.indexOf(home);
  return k > 0 && samePath(path.slice(0, k + 1), routePath(typeId, X, home, cap, day)) && samePath(path.slice(k), routePath(typeId, home, Y, cap, day));
}

/**
 * v0.14.1 the job's first sector after anchor `b`: its leg and the tech-stop legs that carry on from it; null when `b`
 * is not a passenger leg still to fly (maintenance, an empty leg, the aircraft's start). Pure.
 */
function jobSector(g: GameState, b: Anchor, stops: Flight[]): MoveLeg[] | null {
  if (b.kind !== 'flight') return null;
  const f = g.flights[b.id];
  if (!f || f.status !== 'scheduled' || (f.kind !== 'revenue' && f.kind !== 'techstop')) return null;
  const out: MoveLeg[] = [{ from: f.from, to: f.to, std: f.std, sta: f.sta }];
  // v0.15 not the empty legs after it: the roster cuts a day too long for one crew (a ferry crew for the move, the
  // job's crew on tickets: duties.ts partition/slipUnits), so counting the ferry home here only pulled legal moves to
  // the evening before and changed normal games. Ash Cloud's pos-fdp (MAN–AGP 00:15) was Manchester shut until then.
  for (let i = 0; i < 4; i++) {
    const last = out[out.length - 1];
    const x = stops.find((y) => y.from === last.to && y.std >= last.sta && y.std - last.sta <= 3 * 60);
    if (!x) break;
    out.push({ from: x.from, to: x.to, std: x.std, sta: x.sta });
  }
  return out;
}

/**
 * Keeps exactly one empty-leg chain between consecutive commitments at different airports (DESIGN §5.1.6): soft
 * positioning legs that no longer link their neighbours are removed and re-planned (as late as possible; late
 * if they can't make it); after a contract's last leg the aircraft goes home; a long idle stay at an outstation
 * becomes a hop home and back. Returns the legs it created.
 */
export function relinkPositioning(g: GameState, aircraftId: string): Flight[] {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.status === 'stored' || ac.status === 'leasedOut') return [];
  // v0.12.1 nothing is planned while a diversion's onward is open (S1118 BLU1083: an empty AMS–AYT planned while its
  // passengers waited at Amsterdam for the card; seed 2: four LHR–LGW copies, one per relink): planned once, after it.
  if (onwardPending(g, aircraftId)) return [];
  const typeId = ac.typeId;
  const turn = typeOf(typeId).turnMin;
  const home = g.company.homeBase;
  // v0.11 empty legs stay inside our ETOPS approval and the type's capability (the 60-minute rule without one).
  const cap = etopsCap(g.company.approvals, typeId);
  // v0.12.1 and no empty leg longer than one crew's day (a crew-change stop instead).
  const day = emptyDay(g, aircraftId);
  const nodes = anchorsOf(g, aircraftId);
  if (!nodes.length) return [];
  const soft = liveFlightsOf(g, aircraftId).filter((f) => isSoft(g, f));
  // Gaps between non-overlapping nodes.
  type Gap = { a: Anchor; b: Anchor | null; legs: Flight[] };
  const gaps: Gap[] = [];
  let cur = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    const b = nodes[i];
    if (b.std < cur.sta) {
      // v0.12.1 a leg out of the maintenance airport that is not yet moved behind unplanned work (a ramp inspection,
      // an AOG) follows it, as recovery will move it: the gap after it starts where it lands (seed 9: CTA–DUS planned
      // empty beside EW6101 CTA–DUS, which the inspection had only delayed).
      if (cur.kind === 'maint' && b.kind === 'flight' && b.from === cur.to) {
        const std = Math.max(b.std, cur.sta);
        cur = { ...b, std, sta: std + (b.sta - b.std) };
        continue;
      }
      // v0.12.1 (review) a leg out of another airport, due already (its departure passed while the aircraft is on the
      // ground at `start`: a ferry held for its aircraft), never swallows where the aircraft is: the empty leg there is
      // still that gap's. Swallowed, the leg was removed at each hold and made again when the hold moved the ferry on
      // (S1027: CS-TCS at closed Goma, GOM–NDJ re-made every 6 h, a crew alarm each time).
      if (cur.kind === 'start' && b.kind === 'flight' && b.from !== cur.to) {
        gaps.push({ a: cur, b, legs: [] });
        cur = b;
        continue;
      }
      if (b.sta > cur.sta) cur = b;
      continue;
    }
    gaps.push({ a: cur, b, legs: [] });
    cur = b;
  }
  gaps.push({ a: cur, b: null, legs: [] });
  // A leg belongs to the gap it starts in; a late leg out of a gap's start airport (planned forward, after the
  // next commitment's first departure) still belongs to that gap, so a second pass keeps it (fixed point).
  // v0.8 fix pack: so do the later legs of a late chain with a fuel stop (LGW–KAN–LAD landing after the next
  // departure): read alone, KAN–LAD fell in another gap, the chain looked broken and was re-planned on every
  // settle, thousands of times (a player's aircraft back from an AOG; its crews ticketed each time).
  let prev = null as { f: Flight; gap: Gap } | null;
  for (const f of [...soft].sort((x, y) => x.std - y.std)) {
    let gap: Gap = gaps.find((x) => x.b && (f.std < x.b.std || (f.from === x.a.to && f.std < x.b.sta))) ?? gaps[gaps.length - 1];
    // v0.12.1 a late leg planned forward past the next commitment's landing (after a night curfew and the crew's rest)
    // belongs to the last gap that starts where it leaves, not to the gap its time falls in: read there it was an
    // orphan, removed and planned again on every settle (seed 2: CGN–DUS AWL263–273, a crew alarm each). A leg that
    // continues the one before it (a hop's way back out, a fuel stop) stays with that chain.
    if (gap.a.to !== f.from && !(prev && prev.f.to === f.from)) {
      const own = gaps.filter((x) => x.a.to === f.from && x.a.sta <= f.std).pop();
      if (own) gap = own;
    }
    const pg: Gap | undefined = prev?.gap;
    // v0.12.1 only a chain already late for that gap's next commitment (S1027: a hop's return a week later, LIS–AMS
    // 27 Nov, was pulled into the gap before the 26 Nov trip and kept there, the aircraft "in Lisbon" for weeks).
    // v0.14 so does the next ferry day of a crew-change chain (a night stop between): its first day lands before that
    // commitment, the next days leave after it. Read alone, the first day was an unfinished chain, re-planned on every
    // settle and its later days orphans (CS-TIF stranded at Manila, MNL–DAC–EVN–RIX re-made every hour for two weeks,
    // each copy crewless, a "late change" alarm each, airBaltic's Riga base cancelled meanwhile).
    const ferryDay = !!prev && prev.f.to !== home && f.std - prev.f.sta <= FERRY_NIGHT_MAX;
    if (prev && pg && pg !== gap && pg.b && prev.f.to === f.from && prev.f.to !== pg.b.from && f.std >= prev.f.sta && ((f.std < pg.b.sta + DAY && prev.f.sta + turn > pg.b.std) || ferryDay)) gap = pg;
    gap.legs.push(f);
    prev = { f, gap };
  }
  const created: Flight[] = [];
  const remove: string[] = [];
  // v0.14.1 the aircraft's tech-stop legs still to fly (a job's first sector carries on through them), read once.
  let stops: Flight[] | undefined;
  // v0.9 round 3: the legs to create are collected first and matched against the legs the pass removes (below).
  const planned: { l: ChainLeg; contractId: string | null }[] = [];
  // v0.12.1 (review) first legs out of a closed airport put after its reopening, with when they could have left.
  const pushed = new Map<ChainLeg, Minute>();
  // v0.14 first legs of late moves out of a far outstation (no crew aboard), with when the move lands.
  const farLate = new Map<ChainLeg, Minute>();
  const retimedAsks: [Flight, Minute][] = [];
  // v0.9 fix: a gap's new plan is set against the legs it replaces. Legs of the same route are kept and only retimed
  // (their crews and tickets stay: an inbound 13 min late re-made VCE–LIS 2 h before departure, crewless, a red
  // alarm); a plan identical to them is no change at all (a busy game re-planned LOS–TLS–STN on every settle).
  let pending: Flight[] = [];
  const add = (chain: ChainLeg[], contractId: string | null) => {
    const old = pending.splice(0, chain.length);
    // v0.14.1 (CREW-1) the same route is the same leg whatever job it is tagged to: retimed, its crew kept, and it takes
    // the plan's tag, except a live job's tag the plan would only drop (the ferry home after the pilgrimage stays the
    // pilgrimage's once its last flight is airborne). Matched on the job too, a 4-min ETA slip re-made the crewed
    // FCO–LIS with no crew (S1027: BLU1183 DUS–LIS, 7 crew, re-made crewless). And leg by leg from the first: the legs
    // that still fly the plan's route are kept (their crews, a crew wait held at the gate) and only the rest re-made.
    // All or nothing, a chain held at Goma for a crew (GOM–NDJ–DJE–MAN) lost its wait to a re-route over Tunis, was
    // planned to leave at once, held again, and re-made 37 times in a day.
    let k = 0;
    while (k < old.length && k < chain.length && old[k].from === chain[k].from && old[k].to === chain[k].to && old[k].status === 'scheduled') k++;
    for (let i = 0; i < k; i++) {
      const f = old[i];
      if (f.contractId !== contractId && (contractId !== null || !live(g, f.contractId))) {
        f.contractId = contractId;
        touchFlights(g);
      }
      if (f.std !== chain[i].std || f.sta !== chain[i].sta) retimeFlight(g, f, chain[i].std, chain[i].sta);
    }
    // v0.12.1 (review) a leg moved past a closure's reopening asks about what it strands, as a new one does.
    const from = k ? pushed.get(chain[0]) : undefined;
    if (from !== undefined) retimedAsks.push([old[0], from]);
    remove.push(...old.slice(k).map((f) => f.id));
    for (const l of chain.slice(k)) planned.push({ l, contractId });
  };
  const replacing = (legs: Flight[]) => {
    remove.push(...pending.map((f) => f.id));
    pending = [...legs];
  };
  for (const { a, b, legs } of gaps) {
    legs.sort((x, y) => x.std - y.std);
    const X = a.to;
    // Debug round (26 Oct 2026): an empty leg of this gap held at the gate for a crew (operations moved it to when one
    // can be there) keeps that wait: re-planned from earlier, it was retimed or replaced to leave at once, its departure
    // held it again, and so on at one minute (seed 1: LGW–LHR after a curfew diversion, 500 copies, the safety net).
    const held = legs.reduce((m, l) => ((l.crewTries ?? 0) > 0 && l.status === 'scheduled' ? Math.max(m, l.std) : m), -Infinity);
    // v0.12.1 (review) and not before X reopens when a world event has it closed (unless under the event's permit).
    // The permit holds only for a leg leaving before the gap's next flight (after it, that flight is the one before it,
    // as permitOf reads at the gate: planned later, the leg was held there "Waiting: Fighting near Goma").
    // v0.16.1 and the job the leg flies out to, when live: its event's clearance lets an evacuation's positioning into
    // the closed airport (s0429: LIS–NIM for the Niamey evacuation was planned after the reopening, a week late; Crew
    // Control then read "no crew can be flown in"). The leg is tagged to that job (inId), so the gate reads the same.
    const job0 = inboundJob(g, aircraftId, a, X);
    const jobTo = b && live(g, b.contractId) ? b.contractId : null;
    const job = (std: Minute): Permit => [b && b.kind === 'flight' && std >= b.std ? null : job0, jobTo];
    const base0 = Math.max(a.kind === 'start' ? a.sta : a.sta + turn, held, restAfterCurfew(g, a, aircraftId, X));
    const earliest = openAfter(g, X, base0, job(base0));
    if (!b) {
      // End gap: after a live contract's last leg, go home. v0.12.1 also when the aircraft was stranded (the rest of
      // its job, the legs that would have taken it away, cancelled): one way home, at once (crewFree).
      // v0.16.4 (CS-TQM) and whenever it is on the ground away with nothing planned at all: an aircraft away from base
      // always has a way home (or a card says why not: problems/fleet.ts awayIdleCard). Not one being handed back or
      // over abroad (a lease return, a sale), nor one waiting at the seller for its delivery ferry.
      const idle = a.kind === 'start' && ac.status === 'available' && !ac.returning && !ac.sale && !(ac.delivery && !ac.delivery.arrived);
      const wantHome = (live(g, a.contractId) || (a.kind === 'start' && stranded(g, aircraftId, X)) || idle) && X !== home && a.kind !== 'maint';
      if (legs.length ? chainOk(legs, X, null, earliest) && chainSane(typeId, legs, X, null, home, false, cap, day) : !wantHome) continue;
      const nh = nudged(legs, X, null, earliest, Infinity);
      replacing(legs);
      if (nh && chainSane(typeId, legs, X, null, home, false, cap, day)) {
        for (const l of nh) add([l], l.contractId);
        continue;
      }
      if (wantHome) {
        // v0.16.4 the move home of an aircraft left with nothing planned (no job of its own any more) is flown by a crew
        // flown out for it, never tacked onto the day of the crew who just landed it (an extended day just landed read
        // illegal once a leg was added straight after it).
        let from0 = earliest;
        if (idle && !live(g, a.contractId) && !stranded(g, aircraftId, X)) {
          let landed = -Infinity;
          for (const f of flightsOf(g, aircraftId)) if (f.to === X && f.status === 'done') landed = Math.max(landed, f.ata ?? f.sta);
          from0 = Math.max(earliest, landed + SAME_CREW_MIN + 5);
        }
        const ch = openForward(g, typeId, X, home, crewFree(g, aircraftId, X, from0), cap, job, day);
        if (ch && earliest > base0) pushed.set(ch[0], base0);
        if (ch) add(ch, a.contractId);
      }
      continue;
    }
    const Y = b.from;
    const sameBase = !!a.contractId && a.contractId === b.contractId && g.contracts[a.contractId]?.pattern.kind === 'base';
    // v0.12.1 never a hop home and back before an empty move of its own (a ferry home held at X): the out-and-back
    // PZU–LIS–PZU planned around CS-TTL's ferry home (two planners each bringing the aircraft home).
    const emptyNext = b.kind === 'flight' && (g.flights[b.id]?.kind === 'ferry' || g.flights[b.id]?.kind === 'positioning');
    // v0.12.1 nor inside a held job (a world tour): the aircraft waits at the stop with its crew.
    const inHold = !!b.contractId && isHold(g.contracts[b.contractId]) && (a.contractId === b.contractId || b.std <= g.now);
    const allowHop = a.kind !== 'maint' && b.kind !== 'maint' && !sameBase && !emptyNext && !inHold;
    // v0.14.1 (OPS-5) before a check at home after a long wait away, the aircraft goes home at once (only the out-and-
    // back hop stays barred around checks): CS-TCS sat 13.5 days at Prague, then a lone 01:50 ferry home to its C-check.
    // v0.16.4 (CS-TQM, player report) and before any commitment that starts at home, whatever it is: an empty ferry out
    // of home (a dry lease's delivery) barred the hop, so the move home was planned as late as possible: CS-TQM sat 24
    // days at Hong Kong after the Hong Kong Airlines cover, its HKG–TAS–BUD–LIS planned for the eve of the ferry to
    // Abidjan, crewless. Going home is no out-and-back: the empty ferry after it is no reason to wait away.
    const homeFirst = a.kind !== 'maint' && Y === home && X !== home && !inHold;
    const latest = b.std - turn;
    // v0.14.1 (CS-TTL, player report) an empty move into a job is timed for the crew who fly the job, not only for the
    // aircraft: as late as possible when one crew flies both in a day that needs no more than the job alone; otherwise,
    // when the aircraft is free that long, the evening before, landing a full rest ahead of the report (restBeforeJob),
    // so the job's crew fly it and sleep at Y or a ferry crew does. Corendon moved AMS–VRA from 08:30 to 11:30; FRA–AMS
    // stayed at 05:45 ("on time"), one crew's day 17:40 of 12:15, the aircraft empty at Frankfurt for 49 h before it
    // (2028 has a 29 Feb); the trip was flagged, never re-cut, and slipped 60 h at the gate. With no room for the
    // evening before, the late move stays: one crew with in-flight rest (3 or 4 pilots), or a ferry crew of two pilots
    // and the job's crew on airline tickets (duties.ts slipUnits/partition).
    let op0: MoveLeg[] | null | undefined;
    const opOf = () => (op0 === undefined ? (op0 = jobSector(g, b, stops ??= liveFlightsOf(g, aircraftId).filter((f) => f.kind === 'techstop' && f.status === 'scheduled'))) : op0);
    const fitOf = (move: MoveLeg[]) => positioningFit(g, typeId, restOf(g, aircraftId), move, opOf()!);
    // v0.15.1 a departure from X nobody can fly: after the turn the crew who flew the aircraft in could still make,
    // before their rest ends (and before a fresh crew could be there).
    const inb = inboundCrew(g, a, aircraftId, X);
    const nobody = (std: Minute): boolean => !!inb && std > inb.landed + SAME_CREW_MIN && std < Math.min(inb.rested, crewFree(g, aircraftId, X, inb.landed + SAME_CREW_MIN + 5));
    // v0.23.2 nor a move straight on with the crew who flew the aircraft in when their day would then be longer than
    // one crew's day of empty flying (emptyDay): the next ferry day waits for their rest. Planned on at the turn, the
    // roster took them off and the aircraft waited two days for another crew (9H-VZH at Hartford).
    const dayOver = (ch: ChainLeg[]): boolean => {
      if (!inb || !ch.length || ch[0].from !== X || ch[0].std >= inb.rested || ch[0].std > inb.landed + SAME_CREW_MIN) return false;
      let blk = inb.block + TECH_STOP_MIN + (ch[0].sta - ch[0].std);
      for (let i = 1; i < ch.length && ch[i].std - ch[i - 1].sta <= SAME_CREW_MIN; i++) blk += TECH_STOP_MIN + (ch[i].sta - ch[i].std);
      return blk > day;
    };
    // v0.15.1 a kept chain the roster has crewed (a duty with crew, not illegal) is flown by them whatever the estimate
    // reads: the chain's night counts from the scheduled landing, restedDeparture from the ETA, and the moment BOG–JFK
    // took off 11 minutes behind, the legal crewed JFK–SFJ–SNN at 14:35 (rested 14:46) was re-made to leave at landing,
    // lost its crew and sat six days at New York (seed 4, AWL121: a quarter of the year's legs).
    const crewed = (f: Flight): boolean => f.crewIds.length > 0 && (!f.dutyId || g.duties[f.dutyId]?.legality !== 'illegal');
    const crewTimed = <T extends MoveLeg>(move: T[], from0: Minute): T[] | ChainLeg[] => {
      const op = opOf();
      if (!op || !move.length || move[move.length - 1].to !== Y || move[move.length - 1].sta > op[0].std) return move;
      const fit = fitOf(move);
      if (!fit) return move;
      const by = op[0].std - restBeforeJob(g, typeId, move, op[0].std);
      let early = chainBackward(typeId, move[0].from, Y, from0, by, cap, day);
      // v0.15.1 timed for nobody (the ferry crew's rest, no fresh crew yet): after their rest, or not at all.
      if (early?.length && early[0].from === X && nobody(early[0].std)) early = chainBackward(typeId, move[0].from, Y, Math.max(from0, inb!.rested), by, cap, day);
      return early?.length && shutIn(g, early, job) === null && fitOf(early) < fit ? early : move;
    };
    /** The move into Y of a gap's legs: after their last landing at home (a hop home and out again), else all of them. */
    const tailOf = <T extends MoveLeg>(ls: T[]): { tail: T[]; from0: (x: Minute) => Minute } => {
      let k = 0;
      if (Y !== home) ls.forEach((l, i) => { if (l.to === home && i < ls.length - 1) k = i + 1; });
      return { tail: ls.slice(k), from0: (x) => (k ? ls[k - 1].sta + HOME_HOP_MIN : x) };
    };
    /** Kept legs that an earlier move would make a better day for the job's crew (re-planned: retimed, crews kept). */
    const crewLate = (ls: Flight[]): boolean => {
      if (!opOf() || ls[ls.length - 1].sta > latest) return false;
      const { tail, from0 } = tailOf(ls);
      if (!tail.length || tail[tail.length - 1].to !== Y || tail[tail.length - 1].sta > opOf()![0].std || !fitOf(tail)) return false;
      return crewTimed(tail, from0(crewFree(g, aircraftId, X, earliest))) !== tail;
    };
    // v0.14 at a far outstation (a long airline ticket from home) with no crew aboard, a move that leaves before a crew
    // flown out can be there is no plan: nobody can fly it. Such a move neither replaces a late chain that a crew can
    // fly (on time from `ready` or not at all) nor is planned in a tight window: the move leaves when a crew can be at
    // X, late, and the commitments it misses are covered meanwhile (CS-TIF at Manila: an "on time" MNL–RIX planned
    // 11 h out, held, its Riga flights dropped, and the ferry re-planned anew, for weeks).
    // v0.23.2 never later than its crew can fly it: a crew at X (crewThere), or the roster's crew at the time the leg
    // already has (a crewed leg is never pushed back a ticket's lead from now each time the move is planned again).
    const there = crewThere(g, legs[0], X);
    const first = legs.length && legs[0].from === X && legs[0].status === 'scheduled' && crewed(legs[0]) ? legs[0].std : null;
    const freeAt = (e: Minute): Minute => {
      const t = crewFree(g, aircraftId, X, e);
      return there !== null ? Math.min(t, Math.max(e, there)) : first !== null ? Math.min(t, Math.max(e, first)) : t;
    };
    const ready = farOutstation(g, X) ? freeAt(earliest) : earliest;
    // v0.23.2 a late move whose crew wait at X leaves when they can fly it, not days later.
    // v0.23.2 behind on the job it flies to (its flights are being cancelled): the move leaves as soon as it can.
    const asap = X !== Y && X !== home && behindOn(g, aircraftId, b) && b.std - freeAt(earliest) < AWAY_GAP;
    const soon = asap && legs.length > 0 && legs[0].from === X && legs[0].std - freeAt(earliest) >= PULL_MIN;
    const pull = soon || (there !== null && legs[legs.length - 1].sta > latest && legs[0].std - Math.max(earliest, there) >= PULL_MIN);
    const hop = X === Y ? gapMoves(typeId, X, Y, crewFree(g, aircraftId, X, earliest), latest, home, allowHop, cap, day) : null;
    if (X === Y && !legs.length && !hop?.length) continue;
    // v0.12.1 kept only on time for Y, or when nothing on time can be planned (a late chain stays late, not re-made).
    // v0.14.1 (OPS-5) a move home before a check that waits AWAY_GAP or more at X is planned again (forward).
    const idleAway = homeFirst && legs.length > 0 && legs[0].std - crewFree(g, aircraftId, X, earliest) >= AWAY_GAP && latest - earliest >= AWAY_GAP;
    if (legs.length && chainOk(legs, X, Y, earliest) && chainSane(typeId, legs, X, Y, home, allowHop, cap, day) && (legs[legs.length - 1].sta <= latest || !onTimeMove(typeId, X, Y, ready, latest, home, allowHop, cap, day)) && !crewLate(legs) && !idleAway && !pull && (crewed(legs[0]) || !nobody(legs[0].std))) continue;
    const nl = nudged(legs, X, Y, earliest, latest);
    replacing(legs);
    if (nl && chainSane(typeId, legs, X, Y, home, allowHop, cap, day)) {
      for (const l of nl) add([l], l.contractId);
      continue;
    }
    // v0.12.1 the empty leg out of an alternate after our own technical diversion is our cost: never billed to the
    // client as positioning (seed 9: airBaltic billed for four VAR–RIX legs after our fault at Riga).
    const inId = a.kind === 'start' && ownFaultAt(g, aircraftId, X) ? null : live(g, b.contractId) ? b.contractId : flying(g, a.contractId) ? a.contractId : null;
    if (X === Y) {
      if (hop?.length) {
        const k = hop.findIndex((l) => l.to === home) + 1;
        add(hop.slice(0, k), flying(g, a.contractId) ? a.contractId : null);
        add(k ? crewTimed(hop.slice(k), hop[k - 1].sta + HOME_HOP_MIN) : hop.slice(k), inId);
      }
      continue;
    }
    // Leave room to crew it when the window allows; a tight window keeps the earliest slot.
    const from = freeAt(earliest);
    // A long wait at an outstation is spent at home (home, then on to Y), not parked away for weeks.
    const via = (allowHop || (homeFirst && b.std - leadFor(g, b, turn) - from >= AWAY_GAP)) && X !== home ? gapMoves(typeId, X, Y, from, b.std - leadFor(g, b, turn), home, true, cap, day) : null;
    if (via?.some((l) => l.to === home)) {
      const k = via.findIndex((l) => l.to === home) + 1;
      add(via.slice(0, k), flying(g, a.contractId) ? a.contractId : null);
      add(crewTimed(via.slice(k), via[k - 1].sta + HOME_HOP_MIN), inId);
      continue;
    }
    // v0.12.1 (review) a chain landing (or stopping) inside a closure is no plan: the next one, else the first after it.
    const open = (x: ChainLeg[] | null) => (x && shutIn(g, x, job) === null ? x : null);
    // v0.14.1 (OPS-3) a charter's slack gives way to a night curfew at Y: the landing waits for the curfew's end inside
    // it, the same morning, before the move is pulled back to the evening before.
    const slack = leadFor(g, b, turn) - turn;
    const soft = slack > 0 && slack <= CHARTER_SLACK ? slack : 0;
    const ch0 =
      (asap ? openForward(g, typeId, X, Y, from, cap, job, day) : null) ??
      open(chainBackward(typeId, X, Y, from, b.std - leadFor(g, b, turn), cap, day, soft)) ??
      open(chainBackward(typeId, X, Y, from, latest, cap, day)) ??
      open(chainBackward(typeId, X, Y, ready, b.std - leadFor(g, b, turn), cap, day, soft)) ??
      open(chainBackward(typeId, X, Y, ready, latest, cap, day)) ??
      // Debug round (26 Oct 2026): already late for Y, the move leaves when a crew can be at X, not at once: planned at
      // `earliest` with nobody there, its departure re-rostered, the gap re-planned the same leg anew at the same
      // minute, a fresh red alarm and pause each time, and the clock never moved on (seed 3: an A320 back from an AOG
      // at Riyadh, 26 Oct; in the game the Play button paused again at once, for ever).
      openForward(g, typeId, X, Y, from, cap, job, day);
    let ch = ch0 ? crewTimed(ch0, from) : ch0;
    // v0.15.1 the move as late as possible can fall in the same gap (the job soon after the ferry crew's landing): then
    // it leaves after their rest when that still reaches Y in time, else as a late move after it.
    if (ch?.length && ch[0].from === X && (nobody(ch[0].std) || dayOver(ch))) ch = open(chainBackward(typeId, X, Y, inb!.rested, latest, cap, day)) ?? openForward(g, typeId, X, Y, inb!.rested, cap, job, day) ?? ch;
    if (ch) {
      if (earliest > base0 && ch[0].from === X) pushed.set(ch[0], base0);
      if (ready > earliest && ch.length && ch[0].from === X && ch[ch.length - 1].sta > latest) farLate.set(ch[0], ch[ch.length - 1].sta);
      add(ch, inId);
    }
  }
  replacing([]);
  // v0.9 round 3: a pass whose plan is exactly the legs it removes (route, times and contract, as a multiset) changes
  // nothing: it is a no-op, not a loop. Overlapping empty legs (GRU–LIS beside LIS–GRU on one aircraft, a late leg
  // that falls in the next gap) are matched position by position above and missed; every settle then made copies and
  // the safety net threw them away and reported a loop ("CS-DVJ re-planned 2 empty leg(s) unchanged", 98 times).
  if (planned.length && planned.length === remove.length) {
    const key = (from: string, to: string, std: Minute, sta: Minute, k: string | null) => `${from}-${to}@${std}-${sta}:${k ?? ''}`;
    const was = remove.map((id) => g.flights[id]).filter((f) => f?.status === 'scheduled').map((f) => key(f.from, f.to, f.std, f.sta, f.contractId)).sort().join(' ');
    if (was === planned.map(({ l, contractId }) => key(l.from, l.to, l.std, l.sta, contractId)).sort().join(' ')) return [];
  }
  // v0.12.1 never a second copy of an empty leg the aircraft keeps (seed 2: a hard LHR–LGW within the hour fell inside
  // the gap before it, the gap read empty and planned it again, AWL374–377 in one minute, each a crew alarm).
  const gone = new Set(remove);
  const kept = liveFlightsOf(g, aircraftId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled' && !gone.has(f.id));
  for (const { l, contractId } of planned) {
    if (kept.some((f) => f.from === l.from && f.to === l.to && f.contractId === contractId && Math.abs(f.std - l.std) <= turn)) continue;
    created.push(addFlight(g, { no: ownFlightNo(g), aircraftId, contractId, kind: 'positioning', from: l.from, to: l.to, std: l.std, sta: l.sta }));
  }
  const asks: [Flight, Minute][] = [...retimedAsks];
  for (const f of created) {
    const hit = [...pushed].find(([l]) => l.from === f.from && l.std === f.std);
    if (hit) asks.push([f, hit[1]]);
  }
  // v0.8 pre-release safety net: a pass that only swaps legs for the very same legs (route, times, contract) would
  // do it again on the next settle, and the next: the fix pack's fuel-stop chain was re-planned that way on every
  // settle until the game froze. Keep the legs (and their crews), drop the copies and report the loop.
  if (remove.length && created.length === remove.length) {
    const sig = (f: Flight) => `${f.from}-${f.to}@${f.std}-${f.sta}:${f.contractId ?? ''}`;
    const was = remove.map((id) => sig(g.flights[id])).sort().join(' ');
    if (was === created.map(sig).sort().join(' ')) {
      // The copies never reached a roster: gone without a re-sync (their queued departures find no flight).
      for (const f of created) delete g.flights[f.id];
      safetyTrip('relinkPositioning', `${ac.reg} re-planned ${created.length} empty leg(s) unchanged at ${g.now} (${was})`);
      return [];
    }
  }
  if (remove.length) removeFlights(g, remove);
  for (const [f, from] of asks) if (g.flights[f.id] && f.status === 'scheduled') closurePlannedHook?.(g, f, from);
  for (const f of created) {
    const hit = [...farLate].find(([l]) => l.from === f.from && l.std === f.std);
    if (hit && g.flights[f.id] && f.status === 'scheduled') farLateHook?.(g, f, hit[1]);
  }
  return created;
}

/**
 * v0.16.4 (CS-TQM, player report) an aircraft on the ground away from base with nothing planned at all (no leg, no
 * check, no job holding it), when relinkPositioning found no way home: 'route' (nothing in its range and our ETOPS
 * limit gets it home), 'closed' (every way home lands in a closure) or 'none' (no reason found). null: not idle away (at
 * home, flying, in a check, being delivered, handed back or sold, or something planned). Pure.
 */
export function awayIdle(g: GameState, aircraftId: string): { why: 'route' | 'closed' | 'none'; since: Minute; to: string } | null {
  const ac = g.fleet[aircraftId];
  const home = g.company.homeBase;
  if (!ac || ac.at === home || ac.status !== 'available' || ac.flightId || ac.returning || ac.sale || (ac.delivery && !ac.delivery.arrived)) return null;
  if (liveFlightsOf(g, aircraftId).some((f) => f.status === 'scheduled' || f.status === 'enroute') || onwardPending(g, aircraftId)) return null;
  // Where it has to be next: its next commitment (a base programme, a check) elsewhere, else home; one here is a plan.
  const next = anchorsOf(g, aircraftId).find((x) => x.kind !== 'start');
  const to = next ? next.from : home;
  if (to === ac.at) return null;
  let since = ac.deliveredAt;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.to === ac.at) since = Math.max(since, f.ata ?? f.sta);
  const ch = chainForward(ac.typeId, ac.at, to, g.now, etopsCap(g.company.approvals, ac.typeId), emptyDay(g, aircraftId));
  const why = !ch ? 'route' : shutIn(g, ch, null) !== null ? 'closed' : 'none';
  return { why, since, to };
}
