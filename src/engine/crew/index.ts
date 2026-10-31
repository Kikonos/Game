// B2 — Crew & HR. Public API for the UI and other modules.

import { BAL } from '../core/balance';
import { flightsOf, flightsRev, takeFlightChanges, touchTickets } from '../core/entities';
import type { SimModule } from '../core/module';
import { schedule } from '../core/queue';
import { DAY, monthKey, yearOf } from '../core/time';
import type { CrewMember, Flight, GameState, Minute, SimEvent } from '../core/types';
import { cancelConversion, classOf, dailyClasses } from './conversion';
import { dailyCrewCosts, monthlySalaries } from './costs';
import { afterDiversion, deletePairing, dutyLegality as dutyLevel, pairingSeats, planAircraft, refreshPairing } from './duties';
export { aboveMinimum, afterDiversion, legalMinimum } from './duties';
import { dailySickness, onCrewJoin, onTrainingDone } from './hr';
import { dailyMorale, monthlyMorale, moraleShock, noteService, onDutyMorale, settleService, setResignHooks } from './morale';
import { autoRoster, closedWait, guardDuty, homeBeforeLeave, onFlightsChanged, recheckAfterRelease, recheckNext, recheckPairing, recheckSoon, leaveAfterTickets, rebookAfterLateRelease, releaseCrew, removeCrew, sendStrandedHome, settleRides, splitOverlong, stayOn, forgetGoneTickets } from './roster';
import { localMin, minRest, signedTz, tzDeltaH, tzNights } from './rules';
import { clipToRest, dailyStandby, noteRecovery } from './standby';
import { dayPlanAfter, dayPlanBefore, dayPlanInit, dayPlanLoad, dayPlanMonth, v09Stats } from './dayPlan';
import { peakHeadsUp } from './forecast';
import { AUTHORITY } from '../../data/flavor';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { pushMessage } from '../core/messages';
import { post } from '../core/ledger';
import { aboard, checkInOf, crewCount, crewIx, dutyBlock, dutyFlights, dutySegs, extCutAt, passengers, touchCrew, touchCrewState, typeIdOf } from './timeline';
import { reportMinutes } from '../core/perf';

export {
  AUG_FDP, CABIN_REST, cabinInflightRest, checkAssignment, crewWindows, daysOffInMonth, DISCRETION, FDP_BANDS, LIMITS, maxFdp, minRest, restAfter,
  acclimState, referenceTime, type Acclim, type CrewWindows, type FdpInput, type IssueCode, type LegalityIssue, type LegalityReport, type RestInput,
} from './ftl';
export { crewName, makeCrewMember, salaryFor } from './generate';
export { crewPeakCard, gapWords, hireLeadDays, monthPlan, PEAK, peakForecast, peakGroups, peakId, peakLine, warnDays, type PeakForecast, type PeakGap, type PeakMonth } from './forecast';
export { crewAvailability, hireBatch, hireCrew, hireFamilies, hireQuote, ratedMarket, staffing, staffingAssign, trainCrew, type Availability, type HireRequest, type RatedMarket, type RoleCapacity, type StaffingLine } from './hr';
export {
  applyDiscretion, autoRoster, discretionCheck, discretionMax, plannedFdpOf, boardCrew, dropStraySpares, promoteSpares, buildDuties, flightCrewStatus, guardDuty, onFlightsChanged, removeCrew, replaceCrew, rerosterFrom, rosterOf, seatRiders, setClosedWaitHook, setRestDelayHook,
  type FlightCrewStatus, type RosterResult,
} from './roster';
export { crewIssuesFor } from './check';
export {
  assignCrew, dutyCandidates, dutyCrew, dutyLegality, dutyOf, swapCrew, unassignCrew, unlockCrew,
  type DutyCandidate, type DutyCrewView, type DutyLegalityView, type DutyLegalityWarning, type RosterOpts, type RosterSlotView,
} from './rosterActions';
export { paidShare, salaryBill } from './costs';
export { crewRev, rideRoom, rideSeats, ridersText, ridesAllowed, revenueRide, ticketPrice } from './timeline';
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
export { crewExtraFor, extraCabinMax, offerExtra, paidMinOf, seatsFor, type CrewExtraSource, type EffectiveExtra, type Seat } from './extraSeats';
export { CAL_LABEL, crewCalendar, crewStatusView, crewTravelNow, joinsAt, type CalBlock, type CalFlight, type CalKind, type CrewStatusView, type CrewTravelNow } from './calendar';
// v0.7.1 Crew Control (UPDATE-0.7.1.md §15).
export {
  applyCrewFix, cancelTrip, charterJet, crewControl, crewGauges, crewShortCard, escalateShortages, FIX_LABEL, jetQuote, previewCopy, reachFor, ROLE_WORD, rootReason, seatsText, shortFlights,
  type ApplyOpts, type CrewControlView, type CrewSolution, type FixOption, type FixPreview, type JetQuote, type Reason, type ReasonCode, type SeatNeed,
} from './control';
import { escalateShortages } from './control';
import { migrateRanks } from './migrate';
import { payBuyBack } from './buyBack';
export { migrateRanks } from './migrate';
// v0.7.2 (UPDATE-0.7.2.md §12).
export { crewAway, type CrewAway } from './away';
export { crewSeatsBlocked, restClassAt, restSeatsBlocked, sellableSeats } from './crewRest';
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
    // Crew-planning round: from the crew member's own start (a ticket out merged into the FDP checks in hours before
    // the report; cabin crew report earlier). Seed 6: an FO ticketed out at 08:00 for a 13:45 report, 33 h after a home
    // standby, had the time off counted as a recovery rest up to 13:45; the next 168 h ran from there (179 h in fact).
    let out: Flight | null = null;
    for (const fid of d.deadheadIds) {
      const f = g.flights[fid];
      if (f && f.status !== 'cancelled' && f.sta <= d.report && aboard(f, c.id)) out = f;
    }
    const own = dutySegs(g, c, p, d, out, null).find((x) => x.kind === 'duty')?.start ?? d.report;
    noteRecovery(c, Math.min(d.report, own), g);
    // v0.12.1 a day off bought back for this trip is paid now that they report for it.
    if (s.buyBack) payBuyBack(g, s);
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
  // Debug round (26 Oct 2026): the post-flight duty after the actual on-blocks (release − on-blocks read negative for
  // a leg landing late, so the duty ended before the aircraft was on the ground).
  const postMin = reportMinutes(typeIdOf(g, p)).post;
  if (lastF && g.now < d.release + DAY) {
    const post = Math.max(postMin, d.release - lastF.sta);
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
  // The duty ends at the last sector's actual on-blocks plus the post-flight duty, not the planned release: a leg that
  // lands late (winds, holding) makes the FDP and the duty longer and the rest after it starts later (ORO.FTL.105).
  // Seed 2: XY3103 landed 17:33 and the crew were logged off at 17:20, resting from then (10:40 before a 14 h rest).
  if (lastF?.status === 'done' && lastF.ata !== undefined && lastF.ata + postMin > d.release) {
    d.fdp = Math.max(d.fdp, lastF.ata - d.report);
    d.release = lastF.ata + postMin;
  }
  // Past the max FDP in the air: the commander's discretion covered it (ORO.FTL.205(f), unforeseen after take-off).
  // Leftover-breach round: also when the release had already moved with the ETA (the duty synced in flight), so the
  // FDP on record never exceeds its limit plus the discretion on record; not for a duty that left already illegal.
  if (lastF?.status === 'done' && d.legality !== 'illegal' && d.fdp > d.maxFdp + (d.discretion ?? 0)) {
    d.discretion = d.fdp - d.maxFdp;
    d.legality = dutyLevel(d);
  }
  // ... and the crew rest where the last leg really landed (a diversion the duty was not re-synced for).
  if (lastF?.status === 'done') d.restAt = lastF.to;
  // Crew-planning round: tickets after the duty that the real release no longer leaves room for (no check-in in time,
  // or leaving inside the rest) are rebooked before the duty is logged.
  rebookAfterLateRelease(g, p, d);
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
    // BLU1396 round: the planned extension's rest option (ORO.FTL.205(d)): +2 h before and after when this crew member
    // rested 2 h more than the minimum before it (c.restUntil is still the rest before; a standby after it is not
    // rest: extCutAt), else +4 h after.
    const extCut = d.ext ? extCutAt(c, seg.start) : 0;
    // v0.9 crew who joined the duty after its report (a call-in at the gate) get their recovery noted too.
    noteRecovery(c, seg.start, g);
    c.log.push({
      start: seg.start, end: seg.end, fdp: seg.fdp, block, sectors: d.sectors, augmented: d.augment > 0, disruptive: seg.disruptive,
      ...(d.ext ? { ext: true as const, extRest: extCut ? ('split' as const) : ('after' as const) } : {}), ...(seg.early ? { early: true } : {}), ...(seg.late ? { late: true } : {}), ...(seg.night ? { night: true } : {}),
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
    c.restUntil = Math.max(c.restUntil, seg.end + seg.rest - extCut);
    c.status = 'resting';
    c.loc = d.restAt;
    clipToRest(g, c);
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

/** Crew who got to `at` (on a leg they operated or rode) after `t`. */
function landedAfter(g: GameState, at: string, t: Minute): Set<string> {
  const out = new Set<string>();
  for (const id in g.flights) {
    const x = g.flights[id];
    if (x.to !== at || x.status !== 'done' || x.kind === 'deadhead' || (x.ata ?? x.sta) <= t) continue;
    for (const c of x.crewIds) out.add(c);
    for (const c of x.riders ?? []) out.add(c);
  }
  return out;
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
  let late: Set<string> | undefined;
  for (const id of pax) {
    const c = g.crew[id];
    if (!c) continue;
    // A ticket from somewhere the crew member is not was never boarded (a re-plan left it behind): their next
    // trip is re-checked now (they are not where it expects them). Debug round (26 Oct 2026): nor one that left
    // before they landed there (their own leg arrived late: seed 1, a DH at 18:00 'boarded' off a leg on blocks 18:10).
    // v0.12.1 round D: nor by someone on leave, sick or not joined at its departure (they stay home: a captain placed
    // by hand while on annual leave rode our aircraft out to her trip).
    const off = c.blocks?.some((b) => b.why !== 'training' && b.from <= (f.atd ?? f.std) && b.to > (f.atd ?? f.std));
    if (off || c.loc !== f.from || (late ??= landedAfter(g, f.from, (f.atd ?? f.std) - 15)).has(id)) {
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
      // Crew-planning round: checked in as the plan reads the ticket (a private jet 30 min at the FBO, not an airline's
      // hour). Seed 3: a jet at 04:00 after a 60 h recovery from 15:10 three days before was logged from 03:00, the
      // recovery read 59:50 and the 168 h ran to 193 h.
      const ci = checkInOf(f);
      noteRecovery(c, off - ci, g);
      c.log.push({ start: off - ci, end: on, fdp: 0, block: 0, sectors: 0, augmented: false, disruptive: false });
      const r = minRest({ dutyMin: on - off + CHECKIN(), atHome: f.to === c.base, augmented: false, tzShift: tzDeltaH(c.base, f.to, on) });
      c.restUntil = Math.max(c.restUntil, on + r);
      if (c.status === 'available') c.status = 'resting';
      // Leftover-breach round: as after a duty (onDutyRelease), standby not started yet waits for this rest, and a
      // window at a station the ticket took them away from goes.
      clipToRest(g, c);
    }
  }
  if (pax.length) touchCrewState(g);
  // v0.12.1 riders of our own flight diverted to an alternate: their next trip is re-planned from there now.
  const landed = f.div && f.kind !== 'deadhead' ? pax.filter((id) => g.crew[id] && !missed.includes(id)) : [];
  if (landed.length) recheckNext(g, landed, d && !d.done ? g.pairings[d.pairingId] : undefined);
  if (missed.length) {
    // v0.10.1 never boarded: they come off the ticket, so no timeline (the roster's, the duty log's) moves them with
    // it; the trip it was for is re-checked from where they really are (re-ticketed or re-crewed, or the shortage
    // ladder raises it), as is their next trip.
    if (f.kind === 'deadhead') f.crewIds = f.crewIds.filter((x) => !missed.includes(x));
    else if (f.riders) {
      f.riders = f.riders.filter((x) => !missed.includes(x));
      if (!f.riders.length) delete f.riders;
    }
    touchTickets(g);
    touchCrew(g);
    recheckNext(g, missed, d && !d.done ? g.pairings[d.pairingId] : undefined);
  }
}

/**
 * v0.10.1 save repair (BLU511): before 0.10.1 a ticket out flown without a crew member (they were elsewhere: a re-plan
 * left the ticket behind) still counted as theirs, so the roster saw them at the trip's departure while they were not
 * there. Such crew come off the flown ticket and the trip's crew legality is re-read (the hourly crew check and the gate
 * then re-crew it). Crew locations are kept: they are where the crew last flew.
 */
function repairMissedTickets(g: GameState): void {
  const fixed = new Set<string>();
  // Crew-planning round: crew who left the ticket's destination on a later flight did fly it (their trip's first duty
  // went with its aircraft's flights at the gate and the flown ticket moved on to the next duty, from elsewhere).
  let left: Map<string, Flight[]> | null = null;
  const leftFrom = (st: string): Flight[] => {
    if (!left) {
      left = new Map();
      for (const f of Object.values(g.flights)) {
        if (f.status !== 'done' && f.status !== 'enroute') continue;
        const l = left.get(f.from);
        if (l) l.push(f);
        else left.set(f.from, [f]);
      }
    }
    return left.get(st) ?? [];
  };
  for (const d of Object.values(g.duties)) {
    const p = g.pairings[d.pairingId];
    const f0 = g.flights[d.flightIds[0]];
    if (d.done || !p || !f0 || f0.status !== 'scheduled') continue;
    for (const fid of d.deadheadIds) {
      const t = g.flights[fid];
      if (!t || t.status !== 'done' || t.sta > d.report) continue;
      const gone = passengers(t).filter((id) => g.crew[id] && g.crew[id].loc !== t.to && p.slots.some((s) => s.crewId === id) && !leftFrom(t.to).some((f) => f.std >= t.sta && (f.crewIds.includes(id) || aboard(f, id))));
      if (!gone.length) continue;
      if (t.kind === 'deadhead') t.crewIds = t.crewIds.filter((x) => !gone.includes(x));
      else if (t.riders) {
        t.riders = t.riders.filter((x) => !gone.includes(x));
        if (!t.riders.length) delete t.riders;
      }
      fixed.add(p.id);
      // A gate decision taken on the old reading (wait for this crew) is asked again: the crew are not coming.
      if (f0.crewDecided) {
        delete f0.crewDecided;
        delete f0.crewTries;
      }
    }
  }
  if (!fixed.size) return;
  touchTickets(g);
  touchCrew(g);
  for (const id of fixed) recheckPairing(g, g.pairings[id]);
}

/**
 * Crew-planning round save repair (seed 1, SK4002): before it, a duty under way kept its legs from the destination a
 * diverted leg never reached, its crew "on duty" at the alternate until a rescue loop gave up. Such a duty (the
 * diversion settled: no onward card open) is settled as resolveOnward now does.
 */
function repairDiverted(g: GameState): void {
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report > g.now) continue;
    const fl = d.flightIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
    const i = fl.findIndex((f, k) => f.status === 'done' && !!f.div && f.to !== f.div.to0 && fl[k + 1]?.status === 'scheduled' && fl[k + 1].from !== f.to);
    if (i < 0) continue;
    const f = fl[i];
    if (g.decisions.some((x) => x.kind === 'divertOnward' && x.data?.flightId === f.id)) continue;
    const x = f.contOf ? g.flights[f.contOf] : undefined;
    afterDiversion(g, f, x && x.status === 'scheduled' && !x.dutyId ? x : null);
  }
}

/**
 * Crew-planning round save repair: a trip joining a mixed-crew job's empty leg to another charter was given no cabin
 * seats for that charter (duties.ts clientCabinOf). Trips still to fly whose seats now read more crew get them (empty,
 * for the roster to fill).
 */
function repairMixedTrips(g: GameState): void {
  for (const p of Object.values(g.pairings)) {
    if (p.status === 'done' || p.status === 'broken') continue;
    const want = pairingSeats(g, p).filter((s) => !s.above).length;
    if (want > p.slots.filter((s) => !s.above && !s.extra).length) for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
  }
}

/**
 * v0.10.2 save repair (BLU1109): before 0.10.2 a home standby running when its crew member was given new work was cut
 * short instead of being marked as a call-out, so the rest owed after an uncalled window (12 h at home) stood between
 * the standby and the work it was cut for. A window still uncalled whose end is followed within the hour by that
 * crew member's next duty or ticket was such a call-out: it is marked called and the trips re-read.
 */
function repairCutStandby(g: GameState): void {
  const fixed = new Set<string>();
  for (const c of Object.values(g.crew)) {
    if (!c.standby?.length) continue;
    for (const w of c.standby) {
      if (w.calledAt !== undefined || w.kind === 'reserve' || w.to < g.now - DAY || w.to > g.now + DAY) continue;
      let hit = false;
      for (const p of Object.values(g.pairings)) {
        if (!p.slots.some((s) => s.crewId === c.id)) continue;
        for (const id of p.dutyIds) {
          const d = g.duties[id];
          if (!d || d.done) continue;
          const tk = d.deadheadIds.map((x) => g.flights[x]).filter((f) => f && f.status === 'scheduled' && aboard(f, c.id));
          const start = Math.min(d.report, ...tk.map((f) => f!.std - 60));
          if (start >= w.to && start < w.to + 60) {
            hit = true;
            fixed.add(p.id);
          }
        }
      }
      if (hit) w.calledAt = w.to;
    }
  }
  if (!fixed.size) return;
  touchCrewState(g);
  for (const id of fixed) recheckPairing(g, g.pairings[id]);
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
  // Crew-planning round: a ticket moved by any other path that lands after a leave began starts that leave at home.
  leaveAfterTickets(g);
  // v0.7.3 home standby for the days an old save published before v0.9; v0.9 standby for every free published day.
  dailyStandby(g);
  dayPlanAfter(g);
  // Peak-staffing round: the busy-month heads-up (one Inbox note per family, month and role).
  peakHeadsUp(g);
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
  // Leftover-breach round: crew away with a leave (or their last day) starting within 3 h go home first.
  homeBeforeLeave(g);
  // v0.12.1 nobody waits on duty at the gate past their limit: a duty held past a night's rest ends at its last landing.
  splitOverlong(g);
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
    g.company.policies.buyBack ??= 'auto';
    for (const c of Object.values(g.crew)) c.twoDays ??= { 0: monthKey(g.now) };
    // v0.9 roster planning from the first day (leave, days off and standby for the published 14 days).
    dayPlanInit(g);
    queueAlert(g);
  },
  load(g) {
    // v0.7.2: CSD/SCC → PUR before anything reads roles.
    migrateRanks(g);
    g.classes ??= {};
    // v0.12.1 Settings › Buy back days off: automatically.
    g.company.policies.buyBack ??= 'auto';
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
    repairMissedTickets(g);
    // v0.12.1 open duties no longer list rides on legs already gone (a relinked positioning leg removed with crew on it).
    for (const d of Object.values(g.duties)) if (!d.done && d.deadheadIds.some((id) => !g.flights[id])) d.deadheadIds = d.deadheadIds.filter((id) => g.flights[id]);
    repairCutStandby(g);
    repairDiverted(g);
    repairMixedTrips(g);
    // v0.12.1 legs a load repair moved or removed (ops: a closure's held legs, orphan out-and-backs): duties follow now.
    for (const [aircraftId, t] of takeFlightChanges(g)) onFlightsChanged(g, aircraftId, t);
  },
  settle(g) {
    for (const [aircraftId, t] of takeFlightChanges(g)) onFlightsChanged(g, aircraftId, t);
    const rev = flightsRev(g);
    if (lastFlightsRev.get(g) !== rev) {
      // v0.12.1 riders whose flight was cancelled, removed or filled up are re-planned first; tickets gone come off duties.
      settleRides(g);
      forgetGoneTickets(g);
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
