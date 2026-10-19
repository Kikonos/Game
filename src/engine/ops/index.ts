// B3 — Operations, maintenance, finance, events, goals, market. Public API.

import type { SimModule } from '../core/module';
import type { GameState } from '../core/types';
import { onApprovalDone } from './company';
import { dailyEvents, onDecisionExpire } from './events';
import { dailyFinance, onMonthEnd, onPayment } from './finance';
import { onFlightArr, onFlightDep, pruneFlights } from './flights';
import { checkGoals } from './goals';
import { onMaintEnd, onMaintStart, planChecks } from './maintenance';
import { onDelivery, onLeaseEnd, refreshMarket } from './market';

export { APPROVALS, applyApproval, setPolicies, type ApprovalDef } from './company';
export { resolveDecision } from './events';
export { cashForecast, monthProfit, newStatement } from './finance';
export { delayFlight } from './flights';
export { GOALS, type GoalDef } from './goals';
export { aogChance, cancelCheck, checkStatus, scheduleCheck, type CheckStatus } from './maintenance';
export { acquireAircraft } from './market';

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
    'lease.end': onLeaseEnd,
    'approval.done': onApprovalDone,
    'decision.expire': onDecisionExpire,
  },
};
