// Statements, receivables, fixed costs and solvency (B3). DESIGN.md §5.7.
// Money moves only through core/ledger.ts (post, accrue, cashOnly, invoice).

import { statementTotals } from '../core/ledger';
import { monthKey } from '../core/time';
import type { GameState, MonthKey, MonthStatement, SimEvent } from '../core/types';

export function newStatement(month: MonthKey, cash: number): MonthStatement {
  return { month, lines: {}, bh: 0, cashStart: cash, cashEnd: cash, closed: false };
}

export const monthProfit = (st: MonthStatement) => statementTotals(st.lines).profit;

/**
 * 'month' (runs last): rent, reserves, insurance, overhead; close g.finance.current into history; open the next;
 * month-end summary message (+ optional auto-pause 'monthEnd'). TODO(B3): costs and message.
 */
export function onMonthEnd(g: GameState, ev: SimEvent): void {
  const cur = g.finance.current;
  cur.cashEnd = g.company.cash;
  cur.closed = true;
  g.finance.history.push(cur);
  if (g.finance.history.length > 60) g.finance.history.shift();
  g.finance.current = newStatement(monthKey(ev.t), g.company.cash);
}

/** 'payment': collect a receivable (cashOnly) and message when it was late. TODO(B3) */
export function onPayment(_g: GameState, _ev: SimEvent): void {}

/** Daily: overdue receivable reminders, low-cash warnings, bankruptcy / fail-forward rescue. TODO(B3) */
export function dailyFinance(_g: GameState): void {}

/** Projected cash for the next `days` days from known commitments (chart on Finance). TODO(B3) */
export function cashForecast(g: GameState, days: number): { t: number; cash: number }[] {
  return [{ t: g.now, cash: g.company.cash }, { t: g.now + days * 1440, cash: g.company.cash }];
}
