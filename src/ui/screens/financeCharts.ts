// v0.12 Visual B: the Finance screen's 12-month charts (revenue and costs as paired bars on one axis, the month-end cash
// as its own small line: never a second y-axis). Pure: the months come from the closed statements plus this month so far.

import { statementTotals } from '../../engine/core/ledger';
import type { Finance, MonthKey } from '../../engine/core/types';

export interface MonthPoint {
  month: MonthKey;
  revenue: number;
  /** Costs as a positive amount (the ledger keeps them negative). */
  costs: number;
  /** Cash at the month's end (this month: the cash now). */
  cash: number;
  /** This month, still running. */
  current: boolean;
}

/** The last `n` months, oldest first, ending with the current one. Pure. */
export function monthSeries(fin: Pick<Finance, 'current' | 'history'>, cashNow: number, n = 12): MonthPoint[] {
  const closed = fin.history.filter((m) => m.month < fin.current.month).sort((a, b) => a.month - b.month).slice(-(n - 1));
  const out: MonthPoint[] = closed.map((m) => {
    const t = statementTotals(m.lines);
    return { month: m.month, revenue: t.revenue, costs: Math.abs(t.costs), cash: m.cashEnd, current: false };
  });
  const t = statementTotals(fin.current.lines);
  out.push({ month: fin.current.month, revenue: t.revenue, costs: Math.abs(t.costs), cash: cashNow, current: true });
  return out;
}

/** A key that changes only when the charts would draw something different at whole-dollar-thousands precision. */
export const seriesKey = (pts: MonthPoint[]): string => pts.map((p) => `${p.month}:${Math.round(p.revenue / 1e3)}:${Math.round(p.costs / 1e3)}:${Math.round(p.cash / 1e3)}`).join('|');
