// B3 — Operations, maintenance, finance, events, goals, market. Public API.

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { onRefitEnd } from './cabin';
import { dailyApprovals, loadApprovals, onApprovalDone, setGrantHook } from './company';
import { dailyEvents, onDecisionExpire, paceDecisions } from './events';
import { dailyFinance, onMonthEnd, onPayment, settleDeparture } from './finance';
import { onFlightArr, onFlightDep, pruneFlights } from './flights';
import { checkGoals, ladderGrant, syncGoals } from './goals';
import { onMaintEnd, onMaintStart, planChecks, setMaintHooks } from './maintenance';
import { dailyDelivery, onDeliveryArr, onDeliveryDep } from './delivery';
import { dailyLeases, onReturnEnd, onReturnStart } from './leaseReturn';
import { dailyMarket, loadMarket, onDelivery, onLeaseEnd, refreshMarket } from './market';
import { dailyPaint, normaliseLivery } from './paint';

export {
  APPROVALS, aircraftGate, applyApproval, approvalBlocker, approvalReqs, cleanRecord, gateApprovals, ladder, ratedPilots, RUNG0_TYPES, setPolicies,
  type AircraftGate, type ApprovalDef, type ApprovalReq, type LadderNode, type LadderRung, type NodeState,
} from './company';
export { bookRefit, cabinOptions, refitQuote, refitStations, type RefitQuote } from './cabin';
export { deliveryQuote, deliveryStatus, ferryRoute, ticketPurpose, type DeliveryLeg, type DeliveryQuote, type DeliveryStatus } from './delivery';
export { chooseLease, leaseView, returnQuote, type LeaseChoice, type LeaseView, type ReturnQuote } from './leaseReturn';
export { resolveDecision } from './events';
export { cashForecast, fixedCosts, monthProfit, newStatement } from './finance';
export { delayFlight, delayOf, schedSta } from './flights';
export { GOALS, type GoalDef } from './goals';
export { aogChance, cancelCheck, checkAirportOk, checkStatus, checkUsedAt, groundGaps, scheduleCheck, type CheckStatus } from './maintenance';
export { acquireAircraft, eligibleTypes, marketView, returnSiteOf, type MarketOfferView } from './market';
export {
  clientCode, clientLivery, clientTitles, liveryOf, normaliseLivery, paintStatus, setAircraftLivery, setCompanyLivery, setFleetLivery, type PaintStatus, type ResolvedLivery,
} from './paint';
export { rotationOf, SUB_LEAD, subcharter, subcharterable, subcharterQuote, type SubcharterQuote } from './subcharter';
export { usd } from './util';
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
  pruneFlights(g);
  planChecks(g);
  dailyPaint(g);
  dailyEvents(g);
  dailyFinance(g);
  dailyApprovals(g);
  dailyMarket(g);
  dailyDelivery(g);
  dailyLeases(g);
  checkGoals(g);
}

export const opsModule: SimModule = {
  name: 'ops',
  init(g) {
    // v0.7 defaults exactly as load sets them (a fresh game and a reloaded one serialise alike).
    loadApprovals(g);
    loadMarket(g);
    refreshMarket(g);
  },
  // Decisions other modules post (crew's sickCrew) join the pacing budget as they appear.
  settle: paceDecisions,
  load(g) {
    loadApprovals(g);
    loadMarket(g);
    syncGoals(g);
    g.finance.negSince ??= null;
    // v0.5.1 liveries: client paint of a contract no longer in the save is gone; the company livery normalised (idempotent).
    for (const ac of Object.values(g.fleet)) if (ac.paintedFor && !g.contracts[ac.paintedFor]) delete ac.paintedFor;
    g.company.livery = normaliseLivery(g.company.livery);
  },
  handlers: {
    day: daily,
    month: (g, ev) => {
      refreshMarket(g);
      onMonthEnd(g, ev);
    },
    'flight.dep': (g, ev) => {
      onFlightDep(g, ev);
      const f = g.flights[ev.id];
      if (f?.purpose) onDeliveryDep(g, f);
    },
    'flight.arr': (g, ev) => {
      onFlightArr(g, ev);
      const f = g.flights[ev.id];
      if (f?.purpose && f.status === 'done') onDeliveryArr(g, f);
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
  },
};
