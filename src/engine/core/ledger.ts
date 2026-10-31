// Money primitive: every cash movement goes through post() so the month statement stays complete.
// Accrual-light: revenue is posted when invoiced (receivable), cash moves when paid (ops/finance.ts).

import { BAL } from './balance';
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

/** v0.12.1 the statement's revenue lines (the Finance rows and the totals split the same way). */
export const REVENUE_CATS: readonly LedgerCat[] = ['acmiRevenue', 'charterRevenue', 'otherRevenue', 'leaseIncome', 'assetSale'];

/** v0.12.1 the statement's cost lines, in the Finance screen's order. */
export const COST_CATS: readonly LedgerCat[] = [
  'fuel', 'airportFees', 'rent', 'reserves', 'salaries', 'perDiem', 'hotels', 'deadhead', 'crewJet', 'maintenance', 'checks', 'paint', 'insurance', 'overhead',
  'training', 'hiring', 'penalties', 'subcharter', 'approvals', 'interest', 'capex', 'refit', 'leaseReturn', 'warRisk', 'disruption', 'compliance', 'delivery',
  // v0.14 sales trips and fairs; receivables written off.
  'sales', 'badDebt',
];

/**
 * Revenue and costs by category (v0.12.1 not by sign: a loss on a sale is negative revenue, a refund lowers costs).
 * A line under no known category (none should exist) still counts by its sign.
 */
export function statementTotals(lines: Partial<Record<LedgerCat, number>>): { revenue: number; costs: number; profit: number } {
  let revenue = 0;
  let costs = 0;
  for (const [cat, v] of Object.entries(lines) as [LedgerCat, number | undefined][]) {
    if (v === undefined) continue;
    if (REVENUE_CATS.includes(cat) || (!COST_CATS.includes(cat) && v >= 0)) revenue += v;
    else costs += v;
  }
  return { revenue, costs, profit: revenue + costs };
}

/**
 * Issues an invoice: accrues the revenue now, creates the receivable and rolls when the client really pays
 * (on time with its payReliability, else lateDays late), queuing a 'payment' event (ops/finance.ts collects it).
 * `deferred` (charter deposits and balances): no revenue line now; contracts accrue it per leg flown.
 */
export function invoice(g: GameState, inv: { clientId: string; contractId: string | null; desc: string; amount: number; cat: LedgerCat; dueDays: number; deferred?: boolean }): Receivable {
  const c = g.clients[inv.clientId];
  const due = g.now + inv.dueDays * 1440;
  // v0.8 Trusted / Partner clients pay more reliably (+0.10 / +0.20, at most 0.98).
  const boost = c?.level ? BAL.v08.perks[c.level].payBoost : 0;
  const late = c && !chance(g, boost ? Math.min(0.98, c.payReliability + boost) : c.payReliability) ? int(g, c.lateDays[0], c.lateDays[1]) : 0;
  const r: Receivable = {
    id: nextId(g, 'r'), clientId: inv.clientId, contractId: inv.contractId, desc: inv.desc, amount: Math.round(inv.amount),
    issued: g.now, due, payAt: due + late * 1440, paid: null, cat: inv.cat,
  };
  g.finance.receivables.push(r);
  if (!inv.deferred) accrue(g, inv.cat, r.amount);
  schedule(g, r.payAt, 'payment', r.id);
  return r;
}
