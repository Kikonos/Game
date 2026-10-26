// B3 — Operations, maintenance, finance, events, goals, market. Public API.

import { airframeVariant, variantsOf } from '../../data/variants';
import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { onRefitEnd, onRestFitEnd } from './cabin';
setRestFitHook(onRestFitEnd);
import { dailyApprovals, loadApprovals, onApprovalDone, setGrantHook } from './company';
import { dailyEvents, onDecisionExpire, paceDecisions } from './events';
import { dailyFinance, onMonthEnd, onPayment, settleDeparture } from './finance';
import { checkAchievements, loadAchievements, ON_ARRIVAL, ON_DEPARTURE } from './achievements';
import { announceBackfill, dailyHeads, loadHeads, monthlyHeads } from './heads';
import { onFlightArr, onFlightDep, pruneFlights } from './flights';
import { checkGoals, ladderGrant, syncGoals } from './goals';
import { onMaintEnd, onMaintStart, planChecks, setMaintHooks, setRestFitHook } from './maintenance';
import { dailyDelivery, onDeliveryArr, onDeliveryDep } from './delivery';
import { dailyLeases, onReturnEnd, onReturnStart } from './leaseReturn';
import { dailyMarket, loadMarket, onDelivery, onLeaseEnd, refreshMarket } from './market';
import { dailyPaint, normaliseLivery } from './paint';
import { loadRest, loadRest074, rollRestFor } from '../crew/restPlan';
import { dailyClientCabin } from './clientCabin';
import { DAY } from '../core/time';
import { dailyDryLeases, onLeaseBack, onLeaseFerryHome, onLeaseOut } from './dryLease';
import { dailyWorld, loadWorld, onWorldEnd } from './world';
import { retireTypes } from './retired';
import { registerResolvers } from './events';
import { DISRUPT_RESOLVERS, holdingForDecision, onDivertedArrival, onOpsEvent, opsState, rollBirdStrike, rollSickAway } from './disrupt';
import { dailyDirector, newDirector } from './director';
import { rollRamp } from './ramp';
import { dailyAudit } from './audit';
import { DAY as DAY_MIN } from '../core/time';

// v0.11 Operations: the disruption cards' resolvers join the decision table (wired here, after every module loaded).
registerResolvers(DISRUPT_RESOLVERS);

/** v0.11 load / init: the director and the operations record (older saves: a first audit at least 60 days off). */
function loadOps(g: GameState): void {
  g.director ??= newDirector(g);
  if (!g.opsx) {
    const st = opsState(g);
    st.audit.next = Math.max(g.started + 330 * DAY_MIN, Math.floor(g.now / DAY_MIN) * DAY_MIN + 60 * DAY_MIN);
  }
}


/** v0.10 every airframe of a type with variants carries one (stable: hashed from the seed and the aircraft id). */
function loadVariants(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    if (ac.variant || !variantsOf(ac.typeId).length) continue;
    const v = airframeVariant(g.seed, ac.id, ac.typeId, ac.builtYear);
    if (v) ac.variant = v;
  }
}

export {
  APPROVALS, aircraftGate, applyApproval, approvalBlocker, approvalReqs, cleanRecord, etopsMxBlocker, etopsMxState, gateApprovals, ladder, ratedPilots, RUNG0_TYPES, setPolicies,
  setUpEtopsMx, waitingFor, type EtopsMxState,
  type AircraftGate, type ApprovalDef, type ApprovalReq, type LadderNode, type LadderRung, type NodeState,
} from './company';
export { addRestToCCheck, bookRefit, bookRestRefit, bookRestSeats, cabinOptions, refitKindText, refitQuote, refitSlots, refitStations, refitTerms, restAfterRefit, restRefitLabel, restRefitOptions, restRefitQuote, restSeatsQuote, type RefitKind, type RefitQuote, type RefitSlot, type RestRefitOption } from './cabin';
export { clientCabinSlot, dailyClientCabin } from './clientCabin';
// v0.7.2 (UPDATE-0.7.2.md §12).
export { opsStripFacts, type OpsStripFacts } from './strip';
export { cancelSale, leastUsed, saleQuote, sellAircraft, type LeastUsedRow, type SaleQuote } from './sale';
import { onSaleClose } from './sale';
export { bookCCheck, cCheckOptions, cCheckSlots, checkLogistics, type CCheckOption, type CheckTicket } from './cHub';
export { C_HUBS, type CHub } from '../../data/mro';
export { deliveryQuote, deliveryStatus, ferryRoute, ticketPurpose, type DeliveryLeg, type DeliveryQuote, type DeliveryStatus } from './delivery';
export { chooseLease, earlyReturnQuote, leaseView, returnEarly, returnQuote, type EarlyReturnQuote, type LeaseChoice, type LeaseView, type ReturnQuote } from './leaseReturn';
export { reopenLatePayment, resolveDecision } from './events';
export { cashForecast, fixedCosts, monthProfit, newStatement } from './finance';
export { delayFlight, delayOf, schedSta } from './flights';
export { GOALS, type GoalDef } from './goals';
export { aogChance, cancelCheck, checkAirportOk, checkStatus, checkUsedAt, groundGaps, scheduleCheck, type CheckStatus } from './maintenance';
export { acquireAircraft, eligibleTypes, marketView, renameAircraft, returnSiteOf, type MarketOfferView } from './market';
export { checkRegistration, cleanAircraftName, cleanRegInput, NAME_MAX, regCountry, regFormat, suggestRegistration } from './registration';
export {
  clientCode, clientLivery, clientTitles, liveryOf, normaliseLivery, paintStatus, setAircraftLivery, setCompanyLivery, setFleetLivery, type PaintStatus, type ResolvedLivery,
} from './paint';
export { rotationOf, SUB_LEAD, subcharter, subcharterable, subcharterHit, subcharterQuote, subcharterQuotes, type SubcharterHit, type SubcharterQuote } from './subcharter';
// v0.8 (UPDATE-0.8.md §12).
export { demandFactor, marketOutlook, segIndex, type MarketOutlook } from './market';
export { flightZone, warRiskAt, worldEvent, worldEventPins, worldEvents, worldZones, EVENT_ICON, type WorldEventView, type ZoneView } from './world';
export { dryLeaseOf, dryLeaseView, leasedText, type DryLeaseView } from './dryLease';
export { usd } from './util';
// v0.9 (UPDATE-0.9.md §12).
export {
  acceptProposal, analystView, dismissProposal, ferryAircraft, fireHead, headsView, headView, hireHead, setHeadOn, setHeadRules,
  type AnalystView, type HeadView,
} from './heads';
export { achievementProgress, achievementsView, checkAchievements, grantAchievement, type AchievementView } from './achievements';
// v0.7.1 every problem as one card (engine/problems).
export { hurtBadges, messageBadges, postProblem, problemAt, problemFor, problems, type GaugeSpec, type Hurt, type MiniMapSpec, type ProblemAction, type ProblemCard, type ReachSpec, type TimelineSpec } from '../problems';
import { postRestProblems } from '../problems';
export { FLIGHT_TYPE_HINT, FLIGHT_TYPE_LABEL, FLIGHT_TYPES, flightCrewAboard, flightType, type FlightType } from './flightType';
export {
  commercialFlightsAirborne, commercialFlightsBetween, commercialItinerary, commercialProgress, CONNECT_MIN, itinerary, itineraryText, ticketBlock,
  type CommercialFlight, type CommercialLeg,
} from './commercial';

// v0.7 hooks, wired once every module has loaded (the ops modules import each other).
setMaintHooks((g, m) => onReturnStart(g, m), (g, m) => {
  onRefitEnd(g, m);
  onReturnEnd(g, m);
});
setGrantHook(ladderGrant);

function daily(g: GameState) {
  // v0.11 the director's day (quiet or busy), sick calls away from base, the yearly audit.
  dailyDirector(g);
  rollSickAway(g);
  dailyAudit(g);
  pruneFlights(g);
  planChecks(g);
  dailyPaint(g);
  dailyClientCabin(g);
  // v0.8 world events: new ones, closures catching new legs, war-risk cover withdrawn, court injunctions.
  dailyWorld(g);
  dailyEvents(g);
  dailyFinance(g);
  dailyApprovals(g);
  dailyMarket(g);
  dailyDelivery(g);
  dailyLeases(g);
  // v0.8 the lessee's hours and the monthly rent and reserves of dry leases out.
  dailyDryLeases(g);
  checkGoals(g);
  // v0.9 achievements (and the heads they earn), then the heads' daily work.
  checkAchievements(g);
  dailyHeads(g);
  // v0.7.3 in-flight rest cards (rest too short, a 4th pilot for seats, extra cabin crew) inside the roster horizon.
  postRestProblems(g);
}

export const opsModule: SimModule = {
  name: 'ops',
  init(g) {
    g.world ??= { events: [] };
    // v0.7 defaults exactly as load sets them (a fresh game and a reloaded one serialise alike).
    loadApprovals(g);
    loadMarket(g);
    refreshMarket(g);
    // v0.7.3 the start fleet's rest facilities: the market roll, deterministic per aircraft (widebodies only).
    // v0.7.4 fitted facilities only (bunks always as a pair; the 767 never); the cabin's curtained seats are always there.
    for (const ac of Object.values(g.fleet)) {
      ac.rest ??= rollRestFor(ac.id, ac.typeId, ac.cabin.j);
      ac.restV ??= 2;
    }
    for (const ac of Object.values(g.fleet)) ac.bhSince ??= Math.floor(g.now / DAY);
    loadVariants(g);
    // v0.9 heads locked, nothing earned yet.
    loadHeads(g);
    g.achievements ??= {};
    loadOps(g);
  },
  // Decisions other modules post (crew's sickCrew) join the pacing budget as they appear.
  settle: paceDecisions,
  load(g) {
    // v0.10 retired types (the 777-200LR → 777-200ER) before anything reads a type.
    retireTypes(g);
    // v0.8 world events (none in older saves).
    loadWorld(g);
    loadApprovals(g);
    loadMarket(g);
    syncGoals(g);
    g.finance.negSince ??= null;
    // v0.5.1 liveries: client paint of a contract no longer in the save is gone; the company livery normalised (idempotent).
    for (const ac of Object.values(g.fleet)) if (ac.paintedFor && !g.contracts[ac.paintedFor]) delete ac.paintedFor;
    // v0.7.3 pilots' and cabin crew's rest facilities from the v0.7.2 {bunks, seats} (old widebodies keep bunks).
    loadRest(g);
    // v0.7.4 fitted facilities only, bunks paired, no bunks on the 767 (a message and a re-roster where that bites).
    loadRest074(g);
    // v0.7.2 utilisation counts from the first load that tracks it (older saves have no bhDays).
    for (const ac of Object.values(g.fleet)) ac.bhSince ??= Math.floor(g.now / DAY);
    g.company.livery = normaliseLivery(g.company.livery);
    // v0.10 airframe variants (engines, door layout): a stable one for aircraft from before v0.10.
    loadVariants(g);
    // v0.9 heads (locked by default), then achievements: an older save earns what it has silently (one message each).
    loadHeads(g);
    loadAchievements(g);
    announceBackfill(g);
    loadOps(g);
  },
  handlers: {
    day: daily,
    month: (g, ev) => {
      refreshMarket(g);
      monthlyHeads(g);
      onMonthEnd(g, ev);
      checkAchievements(g, { monthEnd: true });
    },
    'flight.dep': (g, ev) => {
      onFlightDep(g, ev);
      const f = g.flights[ev.id];
      if (f?.purpose) onDeliveryDep(g, f);
      if (f?.status === 'enroute') checkAchievements(g, { ids: ON_DEPARTURE });
    },
    'flight.arr': (g, ev) => {
      // v0.11 a diversion or medical card still open: the aircraft holds (circles) until it is answered.
      const f0 = g.flights[ev.id];
      if (f0 && f0.ev === ev.v && f0.status === 'enroute' && holdingForDecision(g, f0)) return;
      onFlightArr(g, ev);
      const f = g.flights[ev.id];
      // v0.11 on blocks: the onward card after a diversion, else a bird strike may be written up; a ramp inspector.
      if (f && f.status === 'done' && f.ev === ev.v && f.aircraftId && g.fleet[f.aircraftId]) {
        const ac = g.fleet[f.aircraftId];
        if (f.div && f.to !== f.div.to0 && !f.contOf) onDivertedArrival(g, f);
        else rollBirdStrike(g, f, ac);
        rollRamp(g, f, ac);
      }
      if (f?.status === 'done') checkAchievements(g, { ids: ON_ARRIVAL });
      if (f?.purpose && f.status === 'done') onDeliveryArr(g, f);
      if (f?.purpose === 'lease' && f.status === 'done') onLeaseFerryHome(g, f);
    },
    'maint.start': onMaintStart,
    'maint.end': onMaintEnd,
    payment: onPayment,
    'aircraft.delivery': onDelivery,
    'lease.end': (g, ev) => {
      // A returned aircraft leaves g.fleet: settle its part-month fixed costs first (finance).
      const ac = g.fleet[ev.id];
      onLeaseEnd(g, ev);
      if (ac && !g.fleet[ev.id]) settleDeparture(g, ac);
    },
    'approval.done': onApprovalDone,
    'decision.expire': onDecisionExpire,
    // v0.7.2 an agreed aircraft sale closes.
    'aircraft.sale': onSaleClose,
    // v0.8 a dry lease out starts at the lessee's base / ends.
    'lease.out': onLeaseOut,
    'lease.back': onLeaseBack,
    'world.end': onWorldEnd,
    // v0.11 a timed disruption (a mid-flight card, a sick call at the hotel).
    'ops.event': onOpsEvent,
  },
};
