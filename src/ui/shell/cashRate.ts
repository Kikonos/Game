// v0.12 the top bar's profit per day under the cash: what this month earned less what it spent, with the costs booked
// only at month end (rent, insurance, overhead, salaries) spread evenly over the month so the figure does not lurch on
// the 1st. In the first two days of a month it shows last month's average instead (too little to go on yet).

import { DAY, daysInMonth, monthStart } from '../../engine/core/time';
import { statementTotals } from '../../engine/core/ledger';
import type { GameState } from '../../engine/core/types';
import { salaryBill } from '../../engine/crew';
import { fixedCosts } from '../../engine/ops';

/** Below this many days into the month the rate falls back to last month's average. */
const WARMUP_DAYS = 2;

/** Profit per day (USD) and what it is based on; null when there is nothing to go on yet. */
export function profitPerDay(g: GameState): { perDay: number; basis: 'month' | 'lastMonth' } | null {
  const cur = g.finance.current;
  const elapsed = (g.now - monthStart(cur.month)) / DAY;
  const last = g.finance.history[g.finance.history.length - 1];
  if (elapsed < WARMUP_DAYS && last) return { perDay: statementTotals(last.lines).profit / daysInMonth(last.month), basis: 'lastMonth' };
  if (elapsed <= 0) return null;
  const fc = fixedCosts(g, cur.month);
  let heads = 0;
  for (const h of Object.values(g.heads ?? {})) if (h.hired) heads += h.hired.salary;
  const monthly = fc.rent + fc.insurance + fc.overhead + salaryBill(g) + heads;
  return { perDay: statementTotals(cur.lines).profit / Math.max(0.25, elapsed) - monthly / daysInMonth(cur.month), basis: 'month' };
}
