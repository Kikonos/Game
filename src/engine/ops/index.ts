// B3 — Operations, maintenance, finance, events, goals, market. Public API.

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { onApprovalDone } from './company';
import { dailyEvents, onDecisionExpire, paceDecisions } from './events';
import { dailyFinance, onMonthEnd, onPayment, settleDeparture } from './finance';
import { onFlightArr, onFlightDep, pruneFlights } from './flights';
import { checkGoals, syncGoals } from './goals';
import { onMaintEnd, onMaintStart, planChecks } from './maintenance';
import { onDelivery, onLeaseEnd, refreshMarket } from './market';

export { APPROVALS, applyApproval, approvalBlocker, setPolicies, type ApprovalDef } from './company';
export { resolveDecision } from './events';
export { cashForecast, fixedCosts, monthProfit, newStatement } from './finance';
export { delayFlight, delayOf, schedSta } from './flights';
export { GOALS, type GoalDef } from './goals';
export { aogChance, cancelCheck, checkAirportOk, checkStatus, groundGaps, scheduleCheck, type CheckStatus } from './maintenance';
export { acquireAircraft } from './market';
export { usd } from './util';

function daily(g: GameState) {
  pruneFlights(g);
  planChecks(g);
  dailyEvents(g);
  dailyFinance(g);
  checkGoals(g);
}

export const opsModule: SimModule = {
  name: 'ops',
  init(g) {
    refreshMarket(g);
  },
  // Decisions other modules post (crew's sickCrew) join the pacing budget as they appear.
  settle: paceDecisions,
  load(g) {
    syncGoals(g);
    g.finance.negSince ??= null;
  },
  handlers: {
    day: daily,
    month: (g, ev) => {
      refreshMarket(g);
      onMonthEnd(g, ev);
    },
    'flight.dep': onFlightDep,
    'flight.arr': onFlightArr,
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
