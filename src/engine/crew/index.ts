// B2 — Crew & HR. Public API for the UI and other modules.

import { BAL } from '../core/balance';
import { flightsOf, flightsRev, takeFlightChanges } from '../core/entities';
import type { SimModule } from '../core/module';
import { schedule } from '../core/queue';
import { DAY, yearOf } from '../core/time';
import type { CrewMember, GameState, Minute, SimEvent } from '../core/types';
import { dailyCrewCosts, monthlySalaries } from './costs';
import { deletePairing, planAircraft } from './duties';
import { dailySickness, onCrewJoin, onTrainingDone } from './hr';
import { autoRoster, guardDuty, onFlightsChanged, recheckAfterRelease, recheckNext, recheckSoon, sendStrandedHome } from './roster';
import { minRest, nightsIn, LIMITS } from './rules';
import { aboard, crewCount, crewIx, dutyBlock, dutyFlights, dutySegs, onBlocks, passengers, touchCrew } from './timeline';

export {
  checkAssignment, crewWindows, daysOffInMonth, LIMITS, maxFdp, minRest, restAfter,
  acclimState, referenceTime, type Acclim, type CrewWindows, type FdpInput, type IssueCode, type LegalityIssue, type LegalityReport, type RestInput,
} from './ftl';
export { crewName, makeCrewMember, salaryFor } from './generate';
export { crewAvailability, hireCrew, hireQuote, staffing, trainCrew, type Availability, type HireRequest, type RoleCapacity, type StaffingLine } from './hr';
export {
  applyDiscretion, autoRoster, boardCrew, buildDuties, flightCrewStatus, guardDuty, onFlightsChanged, removeCrew, replaceCrew, rerosterFrom, rosterOf,
  type FlightCrewStatus, type RosterResult,
} from './roster';
export { crewIssuesFor } from './check';
export {
  assignCrew, dutyCandidates, dutyCrew, dutyLegality, dutyOf, swapCrew, unassignCrew, unlockCrew,
  type DutyCandidate, type DutyCrewView, type DutyLegalityView, type DutyLegalityWarning, type RosterOpts, type RosterSlotView,
} from './rosterActions';
export { salaryBill } from './costs';
export { crewRev, ticketPrice } from './timeline';
export { CAL_LABEL, crewCalendar, crewStatusView, crewTravelNow, joinsAt, type CalBlock, type CalFlight, type CalKind, type CrewStatusView, type CrewTravelNow } from './calendar';

const CHECKIN = () => BAL.deadheadCheckIn;

/**
 * ERRP bookkeeping before work starting at t (a duty report or a logged ticket): the time off since the last
 * logged work counts as extended recovery when long enough with two local nights (the log is pruned, so the
 * anchor must move whenever work is logged, not only at duty reports).
 */
function noteRecovery(c: CrewMember, t: Minute): void {
  const last = c.log[c.log.length - 1];
  const prevEnd = last ? last.end : c.restUntil - 12 * 60;
  const dis = c.log.filter((e) => e.start >= c.lastRecovery && e.disruptive).length;
  const need = dis >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
  if (t - prevEnd >= need && nightsIn(c.base, prevEnd, t) >= 2) c.lastRecovery = Math.max(c.lastRecovery, t);
}

/**
 * 'duty.report': crew on duty; away from base from now when the duty leaves base; ERRP bookkeeping. The same
 * event GUARD_MIN before report is the crew check: nobody over a limit reports for it (roster.guardDuty).
 */
function onDutyReport(g: GameState, ev: SimEvent): void {
  const d = g.duties[ev.id];
  if (!d || d.ev !== ev.v || d.done) return;
  const p = g.pairings[d.pairingId];
  if (!p) return;
  if (g.now < d.report) {
    if (crewCount(p) > 0) guardDuty(g, d.id);
    return;
  }
  if (p.status === 'planned') p.status = 'active';
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    noteRecovery(c, d.report);
    c.status = 'onDuty';
    if (c.awaySince === null && (dep !== c.base || d.restAt !== c.base)) c.awaySince = g.now;
  }
  touchCrew(g);
}

/** 'duty.release': logs (pruned to 28 days), block year, rest, location; waits for a late last arrival. */
function onDutyRelease(g: GameState, ev: SimEvent): void {
  const d = g.duties[ev.id];
  if (!d || d.ev !== ev.v || d.done) return;
  const p = g.pairings[d.pairingId];
  if (!p) return;
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  const lastF = fl[fl.length - 1];
  if (lastF && g.now < d.release + DAY) {
    const post = d.release - onBlocks(lastF);
    if (lastF.status === 'enroute') {
      const at = (lastF.eta ?? lastF.sta) + Math.max(0, post);
      if (at > g.now) {
        schedule(g, at, 'duty.release', d.id, d.ev);
        return;
      }
    } else if (lastF.status === 'scheduled') {
      schedule(g, g.now + 60, 'duty.release', d.id, d.ev);
      return;
    }
  }
  const y = yearOf(g.now);
  const block = dutyBlock(g, d);
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    let out = null;
    let home = null;
    for (const fid of d.deadheadIds) {
      const f = g.flights[fid];
      if (!f || f.status === 'cancelled' || !aboard(f, c.id)) continue;
      if (f.sta <= d.report) out = f;
      else if (f.std >= d.release) home = f;
    }
    const seg = dutySegs(g, c, p, d, out, home).find((x) => x.kind === 'duty')!;
    c.log.push({ start: seg.start, end: seg.end, fdp: seg.fdp, block, sectors: d.sectors, augmented: d.augment > 0, disruptive: seg.disruptive });
    c.log = c.log.filter((e) => e.end > g.now - 28 * DAY);
    if (c.blockYearOf !== y) {
      c.blockYear = 0;
      c.blockYearOf = y;
    }
    c.blockYear += block;
    c.totalHours += block / 60;
    c.restUntil = Math.max(c.restUntil, seg.end + seg.rest);
    c.status = 'resting';
    c.loc = d.restAt;
    c.fatigue = Math.min(100, c.fatigue + Math.round(d.fdp / 60));
    if (d.restAt === c.base) c.awaySince = null;
  }
  d.done = true;
  if (p.dutyIds.every((id) => !g.duties[id] || g.duties[id].done)) p.status = 'done';
  touchCrew(g);
  recheckAfterRelease(g, p);
}

/** 'flight.arr': crew aboard (operating or deadheading) move to the arrival airport; loose tickets are logged as positioning duty. */
function onFlightArrCrew(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v || f.status !== 'done') return;
  const ix = crewIx(g);
  const pax = passengers(f);
  const did = pax.length ? ix.ticketDuty.get(f.id) : undefined;
  const d = did ? g.duties[did] : undefined;
  const rest = minRest({ dutyMin: f.sta - f.std + CHECKIN(), atHome: false, augmented: false, tzShift: 0 });
  const merged = !!d && ((f.sta <= d.report && d.report - f.sta < rest) || (f.std >= d.release && f.std - d.release < 600));
  if (f.kind !== 'deadhead') for (const id of f.crewIds) if (g.crew[id]) g.crew[id].loc = f.to;
  const missed: string[] = [];
  for (const id of pax) {
    const c = g.crew[id];
    if (!c) continue;
    // A ticket from somewhere the crew member is not was never boarded (a re-plan left it behind): their next
    // trip is re-checked now (they are not where it expects them).
    if (c.loc !== f.from) {
      missed.push(id);
      continue;
    }
    c.loc = f.to;
    if (f.to === c.base) c.awaySince = null;
    else if (c.awaySince === null) c.awaySince = f.std;
    if (!merged) {
      const off = f.atd ?? f.std;
      const on = f.ata ?? f.sta;
      noteRecovery(c, off - CHECKIN());
      c.log.push({ start: off - CHECKIN(), end: on, fdp: 0, block: 0, sectors: 0, augmented: false, disruptive: false });
      const r = minRest({ dutyMin: on - off + CHECKIN(), atHome: f.to === c.base, augmented: false, tzShift: 0 });
      c.restUntil = Math.max(c.restUntil, on + r);
      if (c.status === 'available') c.status = 'resting';
    }
  }
  if (pax.length) touchCrew(g);
  if (missed.length) recheckNext(g, missed);
}

/** Status from blocks (sick, leave, training, joining) and rest; crew left 'onDuty' without an active trip are freed. */
function refreshStatuses(g: GameState): void {
  const ix = crewIx(g);
  for (const c of Object.values(g.crew)) {
    if (c.blocks) {
      c.blocks = c.blocks.filter((b) => b.to > g.now - DAY);
      if (!c.blocks.length) delete c.blocks;
    }
    const block = c.blocks?.find((b) => b.from <= g.now && b.to > g.now);
    if (c.status === 'onDuty') {
      if (!(ix.pairingsOf.get(c.id) ?? []).some((p) => p.status === 'active')) c.status = c.restUntil > g.now ? 'resting' : 'available';
      continue;
    }
    if (block) {
      if (block.why !== 'joining' || c.status === 'joining') c.status = block.why;
    } else if (c.status === 'sick' || c.status === 'leave' || c.status === 'training') c.status = c.restUntil > g.now ? 'resting' : 'available';
    else if (c.status === 'resting' && c.restUntil <= g.now) c.status = 'available';
  }
}

/** Daily: duties and pairings a week past their end go (crew logs keep the totals); uncrewed past pairings are broken. */
function prune(g: GameState): void {
  const cut = g.now - 7 * DAY;
  for (const p of Object.values(g.pairings)) {
    if (p.status === 'planned' && p.end < g.now && crewCount(p) === 0) p.status = 'broken';
    if (p.end < cut && p.status !== 'planned') deletePairing(g, p);
  }
  for (const dep of Object.values(g.deployments)) if (dep.end < cut && !dep.pairingIds.length) delete g.deployments[dep.id];
  touchCrew(g);
}

function daily(g: GameState) {
  refreshStatuses(g);
  prune(g);
  dailyCrewCosts(g);
  for (const c of Object.values(g.crew)) if (c.status !== 'onDuty') c.fatigue = Math.max(0, c.fatigue - 6);
  dailySickness(g);
  // Keep the published roster horizon filled (auto-roster policy), then bring home anyone left without work away.
  if (g.company.policies.autoRoster) {
    recheckSoon(g);
    autoRoster(g);
  }
  sendStrandedHome(g);
}

const lastHour = new WeakMap<GameState, number>();
const lastFlightsRev = new WeakMap<GameState, number>();
/** Flights a planning pass could not place (not retried on every change). */
const unplaced = new WeakMap<GameState, Set<string>>();

/**
 * Flights added outside an accept (dev demo flights, ops ferries) that no duty holds yet, departing inside the
 * roster horizon: their aircraft are planned and, with the auto-roster policy, crewed now instead of at midnight.
 */
function rosterNewFlights(g: GameState): void {
  const ix = crewIx(g);
  const until = g.now + BAL.rosterHorizonDays * DAY;
  const acs: string[] = [];
  let skip = unplaced.get(g);
  if (!skip) unplaced.set(g, (skip = new Set()));
  for (const id of Object.keys(g.fleet)) {
    const fl = flightsOf(g, id);
    let lo = 0;
    let hi = fl.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (fl[m].std < g.now) lo = m + 1;
      else hi = m;
    }
    for (let i = lo; i < fl.length && fl[i].std < until; i++) {
      const f = fl[i];
      if (f.status === 'scheduled' && f.aircraftId === id && !ix.inDuty.has(f.id) && !skip.has(f.id)) {
        acs.push(id);
        break;
      }
    }
  }
  if (!acs.length) return;
  if (g.company.policies.autoRoster) autoRoster(g, { aircraftIds: acs });
  else for (const id of acs) planAircraft(g, id, g.now);
  const placed = crewIx(g).inDuty;
  for (const id of acs) for (const f of flightsOf(g, id)) if (f.status === 'scheduled' && f.std >= g.now && f.std < until && !placed.has(f.id)) skip.add(f.id);
}

export const crewModule: SimModule = {
  name: 'crew',
  load(g) {
    const y = yearOf(g.now);
    for (const c of Object.values(g.crew)) c.blockYearOf ??= y;
    touchCrew(g);
  },
  settle(g) {
    for (const [aircraftId, t] of takeFlightChanges(g)) onFlightsChanged(g, aircraftId, t);
    const rev = flightsRev(g);
    if (lastFlightsRev.get(g) !== rev) {
      rosterNewFlights(g);
      lastFlightsRev.set(g, flightsRev(g));
    }
    const h = Math.floor(g.now / 60);
    if (lastHour.get(g) !== h) {
      lastHour.set(g, h);
      refreshStatuses(g);
    }
  },
  handlers: {
    day: daily,
    month: monthlySalaries,
    'duty.report': onDutyReport,
    'duty.release': onDutyRelease,
    'flight.arr': onFlightArrCrew,
    'crew.join': onCrewJoin,
    'training.done': onTrainingDone,
  },
};
