// Money primitive: every cash movement goes through post() so the month statement stays complete.
// Accrual-light: revenue is posted when invoiced (receivable), cash moves when paid (ops/finance.ts).

import { nextId } from './entities';
import { schedule } from './queue';
import { chance, int } from './rng';
import type { GameState, LedgerCat, Receivable } from './types';

/** Books an amount (revenue +, cost −) into this month's statement and moves cash. */
export function post(g: GameState, cat: LedgerCat, amount: number): void {
  if (!amount) return;
  const st = g.finance.current;
  st.lines[cat] = (st.lines[cat] ?? 0) + amount;
  g.company.cash += amount;
}

/** Books revenue in the statement without moving cash (cash arrives with the receivable). */
export function accrue(g: GameState, cat: LedgerCat, amount: number): void {
  if (!amount) return;
  const st = g.finance.current;
  st.lines[cat] = (st.lines[cat] ?? 0) + amount;
}

/** Moves cash without touching the statement (receivable collected, deposit refunded). */
export function cashOnly(g: GameState, amount: number): void {
  g.company.cash += amount;
}

export function statementTotals(lines: Partial<Record<LedgerCat, number>>): { revenue: number; costs: number; profit: number } {
  let revenue = 0;
  let costs = 0;
  for (const v of Object.values(lines)) {
    if (v === undefined) continue;
    if (v >= 0) revenue += v;
    else costs += v;
  }
  return { revenue, costs, profit: revenue + costs };
}

/**
 * Issues an invoice: accrues the revenue now, creates the receivable and rolls when the client really pays
 * (on time with its payReliability, else lateDays late), queuing a 'payment' event (ops/finance.ts collects it).
 */
export function invoice(g: GameState, inv: { clientId: string; contractId: string | null; desc: string; amount: number; cat: LedgerCat; dueDays: number }): Receivable {
  const c = g.clients[inv.clientId];
  const due = g.now + inv.dueDays * 1440;
  const late = c && !chance(g, c.payReliability) ? int(g, c.lateDays[0], c.lateDays[1]) : 0;
  const r: Receivable = {
    id: nextId(g, 'r'), clientId: inv.clientId, contractId: inv.contractId, desc: inv.desc, amount: Math.round(inv.amount),
    issued: g.now, due, payAt: due + late * 1440, paid: null, cat: inv.cat,
  };
  g.finance.receivables.push(r);
  accrue(g, inv.cat, r.amount);
  schedule(g, r.payAt, 'payment', r.id);
  return r;
}
