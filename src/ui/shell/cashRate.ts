// v0.12 the top bar's profit per day under the cash: what this month earned (wet leases flown but invoiced only at month
// end included) less what it spent, with the costs booked only at month end (rent, insurance, overhead, salaries) spread
// evenly over the month so the figure does not lurch on the 1st. In the first two days of a month it shows last month's
// average instead (too little to go on yet).
// v0.12.1 one-off lines (an approval fee, a refit, a C-check, hiring and training, compensation, a dry lease's month of
// rent invoiced in advance) count once for the month, spread over all its days like the month-end bill, not over the
// days gone: a $1.6M refit paid on the 11th read as −$145K a day on top of the flying (S1118, 18 Nov: −$176K/day for
// a month heading to −$116K/day).

import { DAY, daysInMonth, monthStart } from '../../engine/core/time';
import { statementTotals } from '../../engine/core/ledger';
import type { GameState, LedgerCat } from '../../engine/core/types';
import { monthEndBill } from '../../engine/ops';
import { earnedUnbilled } from '../screens/screenLogic';

/** Below this many days into the month the rate falls back to last month's average. */
const WARMUP_DAYS = 2;

/**
 * v0.12.1 lines booked in lumps, not as the month's flying goes on: counted as month totals in the rate (never
 * extrapolated from the days gone). Revenue and cost lines alike (leaseIncome: a dry lease's rent is invoiced a month
 * in advance).
 */
export const LUMP_CATS: readonly LedgerCat[] = [
  'approvals', 'refit', 'checks', 'hiring', 'training', 'penalties', 'capex', 'leaseReturn', 'delivery', 'paint', 'compliance', 'assetSale', 'leaseIncome',
];

/** This month's costs booked only at month end: rent, insurance, overhead, crew and department-head salaries. */
export function monthEndCosts(g: GameState): number {
  // v0.12.1 the engine's month-end bill (the cash card and the forecast read the same).
  return monthEndBill(g, g.finance.current.month).total;
}

/** Profit per day (USD) and what it is based on; null when there is nothing to go on yet. */
export function profitPerDay(g: GameState): { perDay: number; basis: 'month' | 'lastMonth' } | null {
  const cur = g.finance.current;
  const elapsed = (g.now - monthStart(cur.month)) / DAY;
  const last = g.finance.history[g.finance.history.length - 1];
  if (elapsed < WARMUP_DAYS && last) return { perDay: statementTotals(last.lines).profit / daysInMonth(last.month), basis: 'lastMonth' };
  if (elapsed <= 0) return null;
  const lumps = LUMP_CATS.reduce((s, c) => s + (cur.lines[c] ?? 0), 0);
  const flow = statementTotals(cur.lines).profit - lumps + earnedUnbilled(g);
  return { perDay: flow / Math.max(0.25, elapsed) + (lumps - monthEndCosts(g)) / daysInMonth(cur.month), basis: 'month' };
}
