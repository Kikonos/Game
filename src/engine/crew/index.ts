// B2 — Crew & HR. Public API for the UI and other modules.

import { BAL } from '../core/balance';
import { flightsOf, flightsRev, takeFlightChanges } from '../core/entities';
import type { SimModule } from '../core/module';
import { schedule } from '../core/queue';
import { DAY, monthKey, yearOf } from '../core/time';
import type { CrewMember, GameState, Minute, SimEvent } from '../core/types';
import { cancelConversion, classOf, dailyClasses } from './conversion';
import { dailyCrewCosts, monthlySalaries } from './costs';
import { deletePairing, planAircraft } from './duties';
export { aboveMinimum, legalMinimum } from './duties';
import { dailySickness, onCrewJoin, onTrainingDone } from './hr';
import { dailyMorale, monthlyMorale, moraleShock, noteService, onDutyMorale, settleService, setResignHooks } from './morale';
import { autoRoster, closedWait, guardDuty, onFlightsChanged, recheckAfterRelease, recheckNext, recheckSoon, removeCrew, sendStrandedHome, stayOn } from './roster';
import { localMin, minRest, signedTz, tzNights } from './rules';
import { dailyStandby, noteRecovery } from './standby';
import { dayPlanAfter, dayPlanBefore, dayPlanInit, dayPlanLoad, dayPlanMonth, v09Stats } from './dayPlan';
import { AUTHORITY } from '../../data/flavor';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { pushMessage } from '../core/messages';
import { post } from '../core/ledger';
import { aboard, crewCount, crewIx, dutyBlock, dutyFlights, dutySegs, onBlocks, passengers, touchCrew, touchCrewState } from './timeline';

export {
  AUG_FDP, CABIN_REST, cabinInflightRest, checkAssignment, crewWindows, daysOffInMonth, DISCRETION, FDP_BANDS, LIMITS, maxFdp, minRest, restAfter,
  acclimState, referenceTime, type Acclim, type CrewWindows, type FdpInput, type IssueCode, type LegalityIssue, type LegalityReport, type RestInput,
} from './ftl';
export { crewName, makeCrewMember, salaryFor } from './generate';
export { crewAvailability, hireBatch, hireCrew, hireFamilies, hireQuote, ratedMarket, staffing, trainCrew, type Availability, type HireRequest, type RatedMarket, type RoleCapacity, type StaffingLine } from './hr';
export {
  applyDiscretion, autoRoster, discretionCheck, discretionMax, plannedFdpOf, boardCrew, dropStraySpares, promoteSpares, buildDuties, flightCrewStatus, guardDuty, onFlightsChanged, removeCrew, replaceCrew, rerosterFrom, rosterOf, setClosedWaitHook, setRestDelayHook,
  type FlightCrewStatus, type RosterResult,
} from './roster';
export { crewIssuesFor } from './check';
export {
  assignCrew, dutyCandidates, dutyCrew, dutyLegality, dutyOf, swapCrew, unassignCrew, unlockCrew,
  type DutyCandidate, type DutyCrewView, type DutyLegalityView, type DutyLegalityWarning, type RosterOpts, type RosterSlotView,
} from './rosterActions';
export { salaryBill } from './costs';
export { crewRev, ticketPrice } from './timeline';
export { dropTargets, moveDuty, rosterBoard, type BoardBlock, type BoardRow, type DropTarget, type MoveScope } from './board';
export {
  cancelConversion, ccqPartner, classOf, conversionClasses, conversionEarliest, conversionPlan, courseOf, familyLabel, refundShare, startConversion,
  type ConversionClassPlan, type ConversionPlan, type ConversionRequest,
} from './conversion';
export {
  MORALE_LABEL, moraleOf, moraleShock, moraleSummary, moraleTarget, onContractDoneMorale, policyPreview, resignChance, resignNow, sickMult,
  type MoraleDriverView, type MoraleSummary, type MoraleView,
} from './morale';
export { crewExtraQuote, setCrewExtra } from './extra';
export { crewExtraFor, offerExtra, paidMinOf, seatsFor, type CrewExtraSource, type EffectiveExtra, type Seat } from './extraSeats';
export { CAL_LABEL, crewCalendar, crewStatusView, crewTravelNow, joinsAt, type CalBlock, type CalFlight, type CalKind, type CrewStatusView, type CrewTravelNow } from './calendar';
// v0.7.1 Crew Control (UPDATE-0.7.1.md §15).
export {
  applyCrewFix, cancelTrip, charterJet, crewControl, crewGauges, crewShortCard, escalateShortages, FIX_LABEL, jetQuote, previewCopy, reachFor, ROLE_WORD, rootReason, seatsText, shortFlights,
  type ApplyOpts, type CrewControlView, type CrewSolution, type FixOption, type FixPreview, type JetQuote, type Reason, type ReasonCode, type SeatNeed,
} from './control';
import { escalateShortages } from './control';
import { migrateRanks } from './migrate';
export { migrateRanks } from './migrate';
// v0.7.2 (UPDATE-0.7.2.md §12).
export { crewAway, type CrewAway } from './away';
export { restClassAt, restSeatsBlocked, sellableSeats } from './crewRest';
// v0.7.3 (UPDATE-0.7.3.md §7).
export {
  augLimit, bunksFor, cabinBand, effectiveRest, fittedRest, hasBunks, isSeatRest, longestDay, migrateRest, restOfAc, restWords, seatRest, ySeatsFor, planRest, restNow, restOf, restPlan, restPlanForFlight, restShort, restText, restVerdict, restWhere,
  type LongestDay, type RestLeg, type RestPlan, type RestSeat, type RestTurn,
} from './restPlan';
export { fdpWhy, setDutyAugment, type FdpWhy } from './explain';
export { onStandby } from './standby';
// v0.9 crew out of hours, crew slips (UPDATE-0.9.md §T, §W).
export { crewAlertKind, LIMIT_NAME, outOfHours, OOH_TEXT, type CrewAlertKind, type OohInfo } from './outOfHours';
export { bestSlip, slipOfFlight, slipsOfAircraft, type SlipPlan, type SlipView } from './slip';
// v0.9 roster planning (UPDATE-0.9.md §R.14).
export {
  crewMonth, dayIndex, isOff, offBreak, planLeave, planOffDays, planStandby, publishedTo, rosterStats, standbyNow,
  type CrewMonthView, type OffBreak,
} from './dayPlan';
export { dutyNeed, type ChainShape, type DutyNeed } from './duties';
export {
  EXT_TABLE, extFdp, disruptiveKinds, FTL_TYPE, STANDBY, standbyAwakeOk, standbyCut, TZ_NIGHTS, tzNights, WOCL, cabinFdpCap,
} from './rules';

const CHECKIN = () => BAL.deadheadCheckIn;

/** v0.7.2 a captain flew in a first officer's seat: pay stays; from the third time in 30 days, morale −3 each time. */
export function captainAsFo(g: GameState, c: CrewMember, report: Minute): void {
  const A = BAL.v072.asFo;
  const recent = (c.asFoAt ?? []).filter((t) => t > g.now - 30 * DAY);
  recent.push(report);
  c.asFoAt = recent;
  g.stats.asFo = (g.stats.asFo ?? 0) + 1;
  if (recent.length > A.freePerMonth) moraleShock(g, c, 'career', A.morale);
}

/**
 * v0.7.3 rotations across time zones (CS FTL.1.235(b)): resting away extends the rotation (its largest zone
 * difference and direction); back at base a rotation ≥ 4 h away leaves the local nights due at home.
 */
function noteRotation(c: CrewMember, at: string, report: Minute, end: Minute): void {
  if (at !== c.base) {
    const dz = signedTz(c.base, at, end);
    const r = (c.rot ??= { start: report, maxTz: 0, dir: 0 });
    if (Math.abs(dz) > r.maxTz) {
      r.maxTz = Math.abs(dz);
      r.dir = Math.sign(dz) as -1 | 0 | 1;
    }
    return;
  }
  if (!c.rot) return;
  if (c.rot.maxTz >= 4) c.tzBack = { back: end, nights: tzNights(c.rot.maxTz, (end - c.rot.start) / 60), dir: c.rot.dir === 1 ? 1 : -1 };
  delete c.rot;
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
    // Nobody is called in to wait out a closure on duty (seed 5: a Goma positioning crew sat 29 h "on duty" through
    // hourly holds and went home at the reopening, leaving the aircraft without a crew: 18 red alerts in three days).
    if (d.flightIds[0] && closedWait(g, d.flightIds[0])) return;
    if (crewCount(p) > 0) guardDuty(g, d.id);
    return;
  }
  if (p.status === 'planned') p.status = 'active';
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  // v0.7.3 CS FTL.1.205(d): a delay announced before the crew left keeps the told report's limit (one note when it bites).
  if (d.notified !== undefined && d.report > d.notified && d.report - d.notified < 10 * 60 && d.legality !== 'legal') {
    const f0 = g.flights[d.flightIds[0]];
    const hmT = (t: Minute) => `${String(Math.floor((localMin(dep, t)) / 60)).padStart(2, '0')}:${String(localMin(dep, t) % 60).padStart(2, '0')}`;
    const hmD = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
    pushMessage(g, {
      tone: 'info', cat: 'crew', title: `Delayed report: ${f0?.no ?? 'a duty'}`,
      body: `${f0?.no ?? 'The'} crew were told to report at ${hmT(d.notified)} and now report at ${hmT(d.report)}: the limit stays ${hmD(d.maxFdp)}${d.report - d.notified < 4 * 60 ? ' (the earlier band) because the delay is under 4 hours' : ', the more limiting of the two reports'}.`,
      ref: f0 ? { kind: 'flight', id: f0.id } : undefined,
    });
    g.stats.delayedReports = (g.stats.delayedReports ?? 0) + 1;
  }
  // v0.9 the day as planned when the crew reported: discretion only for what comes after (UPDATE-0.9.md §U.3).
  d.plannedFdp ??= d.fdp;
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    noteRecovery(c, d.report, g);
    c.status = 'onDuty';
    if (c.awaySince === null && (dep !== c.base || d.restAt !== c.base)) c.awaySince = g.now;
  }
  touchCrewState(g);
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
  // v0.9 §W a duty that took over at a fuel stop: one crew change flown.
  if (d.slipAt && g.flights[d.flightIds[0]]?.from === d.slipAt) v09Stats(g).slips++;
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
    // v0.9 crew who joined the duty after its report (a call-in at the gate) get their recovery noted too.
    noteRecovery(c, seg.start, g);
    c.log.push({
      start: seg.start, end: seg.end, fdp: seg.fdp, block, sectors: d.sectors, augmented: d.augment > 0, disruptive: seg.disruptive,
      ...(d.ext ? { ext: true as const } : {}), ...(seg.early ? { early: true } : {}), ...(seg.late ? { late: true } : {}), ...(seg.night ? { night: true } : {}),
    });
    c.log = c.log.filter((e) => e.end > g.now - 28 * DAY);
    if (c.blockYearOf !== y) {
      c.blockYear = 0;
      c.blockYearOf = y;
    }
    c.blockYear += block;
    // v0.7.2 1,000 h in 12 months: block by calendar month, the last 12 kept.
    const mk = monthKey(g.now);
    const bm = (c.blockMonths ??= {});
    bm[mk] = (bm[mk] ?? 0) + block;
    for (const key in bm) if (+key <= mk - 12) delete bm[key];
    c.totalHours += block / 60;
    c.restUntil = Math.max(c.restUntil, seg.end + seg.rest);
    c.status = 'resting';
    c.loc = d.restAt;
    noteRotation(c, seg.at || d.restAt, seg.start, seg.end);
    c.fatigue = Math.min(100, c.fatigue + Math.round(d.fdp / 60));
    if (d.restAt === c.base) c.awaySince = null;
    if (c.role === 'CPT' && (s.role === 'FO' || s.role === 'CRP')) captainAsFo(g, c, d.report);
  }
  d.done = true;
  // v0.7.3 ORO.FTL.205(f)(5): discretion over 1 h is reported to the authority within 28 days (one message).
  const over = d.fdp - (d.ext && d.basicFdp ? d.basicFdp : d.maxFdp);
  if (d.discretion && over > 60) {
    const f0 = g.flights[d.flightIds[0]];
    const auth = AUTHORITY[AIRPORT_BY_CODE[g.company.homeBase]?.country ?? ''] ?? 'the authority';
    pushMessage(g, { tone: 'info', cat: 'crew', title: `Discretion report filed: ${f0?.no ?? 'a duty'}`, body: `${f0?.no ?? 'The'} crew ran ${Math.floor(over / 60)}:${String(over % 60).padStart(2, '0')} over their limit; reported to ${auth} within 28 days.`, ref: f0 ? { kind: 'flight', id: f0.id } : undefined });
    g.stats.discretionReports = (g.stats.discretionReports ?? 0) + 1;
  }
  // v0.7.3 split duty: the crew room or a hotel day room at the break (CS FTL.1.220(d)).
  if (d.split) {
    const S = BAL.v073.split;
    const n = p.slots.filter((s) => s.crewId).length;
    if (n) post(g, 'hotels', -n * (d.split.room === 'hotel' ? S.dayRoom : S.lounge));
    g.stats.splits = (g.stats.splits ?? 0) + 1;
  }
  if (d.ext) g.stats.extensions = (g.stats.extensions ?? 0) + 1;
  const last = p.dutyIds.every((id) => !g.duties[id] || g.duties[id].done);
  if (last) p.status = 'done';
  onDutyMorale(g, p, last);
  touchCrewState(g);
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
  noteService(g, f);
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
    if (f.to === c.base) noteRotation(c, f.to, f.std, f.ata ?? f.sta);
    if (!merged) {
      const off = f.atd ?? f.std;
      const on = f.ata ?? f.sta;
      noteRecovery(c, off - CHECKIN(), g);
      c.log.push({ start: off - CHECKIN(), end: on, fdp: 0, block: 0, sectors: 0, augmented: false, disruptive: false });
      const r = minRest({ dutyMin: on - off + CHECKIN(), atHome: f.to === c.base, augmented: false, tzShift: 0 });
      c.restUntil = Math.max(c.restUntil, on + r);
      if (c.status === 'available') c.status = 'resting';
    }
  }
  if (pax.length) touchCrewState(g);
  if (missed.length) recheckNext(g, missed);
}

/** Status from blocks (sick, leave, training, joining) and rest; crew left 'onDuty' without an active trip are freed. */
function refreshStatuses(g: GameState): void {
  const ix = crewIx(g);
  for (const c of Object.values(g.crew)) {
    // v0.9 kept 40 days after they end: the month-end days-off count reads a month's leave and sickness (pro rata).
    if (c.blocks && (!c.blocks.length || c.blocks.some((b) => b.to <= g.now - 40 * DAY))) {
      c.blocks = c.blocks.filter((b) => b.to > g.now - 40 * DAY);
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
  let n = 0;
  for (const p of Object.values(g.pairings)) {
    if (p.status === 'planned' && p.end < g.now && crewCount(p) === 0) {
      p.status = 'broken';
      n++;
    }
    if (p.end < cut && p.status !== 'planned') {
      deletePairing(g, p);
      n++;
    }
  }
  for (const dep of Object.values(g.deployments)) if (dep.end < cut && !dep.pairingIds.length) delete g.deployments[dep.id];
  if (n) touchCrew(g);
}

function daily(g: GameState) {
  dailyClasses(g);
  refreshStatuses(g);
  prune(g);
  dailyCrewCosts(g);
  for (const c of Object.values(g.crew)) if (c.status !== 'onDuty') c.fatigue = Math.max(0, c.fatigue - 6);
  dailySickness(g);
  dailyMorale(g);
  // v0.9 roster planning (UPDATE-0.9.md §R): annual leave and days off up to the horizon before the roster run.
  dayPlanBefore(g);
  // Keep the published roster horizon filled (auto-roster policy), then bring home anyone left without work away.
  if (g.company.policies.autoRoster) {
    recheckSoon(g);
    autoRoster(g);
    // Crew flying home only to fly straight back out stay at the hotel instead.
    const stayed = stayOn(g);
    if (stayed.length) recheckNext(g, stayed);
  }
  sendStrandedHome(g);
  // v0.7.3 home standby for the days an old save published before v0.9; v0.9 standby for every free published day.
  dailyStandby(g);
  dayPlanAfter(g);
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

/** Month end: salaries (late when cash goes negative), the morale line, wet leases' service score. */
function monthly(g: GameState): void {
  monthlySalaries(g);
  dayPlanMonth(g);
  monthlyMorale(g);
  for (const k of Object.values(g.contracts)) if (k.status === 'active' && k.product.kind === 'wet') settleService(g, k);
}

// v0.6 resignations: work past the leave date goes back to the roster (a planned class seat is given up); on the
// day they leave, every trip from then is re-crewed and the record goes (callers tolerate missing crew ids).
setResignHooks(
  (g, c) => {
    const k = classOf(g, c.id);
    if (k && k.status === 'planned') cancelConversion(g, k.id, c.id);
    removeCrew(g, c.id, c.notice!.leaves, c.notice!.leaves + 3650 * DAY);
  },
  (g, c) => {
    removeCrew(g, c.id, g.now, g.now + 3650 * DAY);
    g.training = g.training.filter((x) => x.crewId !== c.id);
    for (const k of Object.values(g.classes ?? {})) if (k.crewIds.includes(c.id) && k.status !== 'done') k.crewIds = k.crewIds.filter((x) => x !== c.id);
  },
);

/** v0.7.1: the ladder ticks on the hour as a sim event (saved in the queue, so a reload plays on identically). */
function queueAlert(g: GameState): void {
  if (g.queue.some((e) => e.type === 'crew.alert')) return;
  schedule(g, Math.floor(g.now / 60) * 60 + 60, 'crew.alert', '');
}

function onCrewAlert(g: GameState): void {
  // The hourly check re-rosters a freshly short aircraft before warning (a roster not yet run is not a shortage).
  escalateShortages(g, { reroster: true });
  hourlyHook?.(g);
  schedule(g, Math.floor(g.now / 60) * 60 + 60, 'crew.alert', '');
}

/** v0.9 ops/heads.ts: the crew desk and the watch desk run on the hourly crew check. */
let hourlyHook: ((g: GameState) => void) | null = null;
export function setHourlyHook(f: typeof hourlyHook): void {
  hourlyHook = f;
}

export const crewModule: SimModule = {
  name: 'crew',
  init(g) {
    // The same defaults load sets (a fresh game and a reloaded one serialise alike).
    g.stats.crewFixes ??= {};
    for (const c of Object.values(g.crew)) c.twoDays ??= { 0: monthKey(g.now) };
    // v0.9 roster planning from the first day (leave, days off and standby for the published 14 days).
    dayPlanInit(g);
    queueAlert(g);
  },
  load(g) {
    // v0.7.2: CSD/SCC → PUR before anything reads roles.
    migrateRanks(g);
    g.classes ??= {};
    const y = yearOf(g.now);
    for (const c of Object.values(g.crew)) c.blockYearOf ??= y;
    // v0.7.3 two local days twice a month: tracked from the load month (that month counts as satisfied).
    for (const c of Object.values(g.crew)) c.twoDays ??= { 0: monthKey(g.now) };
    // v0.7.1: the old 48 h warning mark becomes the amber stage; fix tallies default.
    for (const f of Object.values(g.flights)) if (f.crewWarned && !f.crewAlert) f.crewAlert = 'amber';
    g.stats.crewFixes ??= {};
    queueAlert(g);
    touchCrew(g);
    // v0.9 old saves keep their published roster; the v0.9 planner takes over from the first unpublished day.
    dayPlanLoad(g);
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
    month: monthly,
    'duty.report': onDutyReport,
    'duty.release': onDutyRelease,
    'flight.arr': onFlightArrCrew,
    'crew.join': onCrewJoin,
    'training.done': onTrainingDone,
    'crew.alert': onCrewAlert,
  },
};

// v0.8 mixed-crew contracts (UPDATE-0.8.md §7).
export { clientCrewOf, clientCrewRows, mixedCrewFlavour, mixedCrewText } from './clientCrew';
// v0.7.4 crew planning by type family (crew sets) and the round-up hire.
export { awayOnDryLease, completeSets, crewPlan, familyName, missingFor, roundTargets, roundUpQuote, roundUpRoles, SET_ROLES, SETS_DETACHED, SETS_WHY, setsForStation, setWords, type FamilyPlan, type RoundUpLine, type SetRole, type TypeSet } from './sets';
