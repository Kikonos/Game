// Statements, receivables, fixed costs and solvency (B3). DESIGN.md §5.7.
// Money moves only through core/ledger.ts (post, accrue, cashOnly, invoice).

import { v09Stats } from '../crew/dayPlan';
import { BAL } from '../core/balance';
import { cashOnly, post, statementTotals } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { cardMeta, cashLowCard, invoiceOverdueCard, postProblem } from '../problems';
import { requestPause } from '../core/pause';
import { typeOf } from '../core/perf';
import { DAY, fmtMonth, monthKey, monthStart } from '../core/time';
import type { GameState, MonthKey, MonthStatement, SimEvent } from '../core/types';
import { salaryBill } from '../crew';
import { latePaymentDecision, rescueDecision } from './events';
import { stats, usd } from './util';

export function newStatement(month: MonthKey, cash: number): MonthStatement {
  return { month, lines: {}, bh: 0, cashStart: cash, cashEnd: cash, closed: false };
}

export const monthProfit = (st: MonthStatement) => statementTotals(st.lines).profit;

/** Share of month k an aircraft is on the AOC (delivered and not yet returned). */
function shareOfMonth(ac: GameState['fleet'][string], k: MonthKey): number {
  const a = monthStart(k);
  const b = monthStart(k + 1);
  const from = Math.max(a, ac.deliveredAt);
  const to = ac.ownership.kind === 'dryLeaseIn' ? Math.min(b, Math.max(ac.ownership.leaseEnd, from)) : b;
  return Math.max(0, Math.min(1, (to - from) / (b - a)));
}

/** Fixed monthly costs of month k: rent, insurance, overhead (each fleet aircraft pro-rated to its days). */
export function fixedCosts(g: GameState, k: MonthKey): { rent: number; insurance: number; overhead: number } {
  let rent = 0;
  let insurance = 0;
  let n = 0;
  for (const ac of Object.values(g.fleet)) {
    const s = shareOfMonth(ac, k);
    if (s <= 0) continue;
    n += s;
    if (ac.ownership.kind === 'dryLeaseIn') rent += ac.ownership.rentPerMonth * s;
    // v0.8 a dry lease out: the lessee insures the airframe; our rent and overhead keep running.
    if (ac.status === 'leasedOut') continue;
    insurance += typeOf(ac.typeId).insuranceMonth * s;
  }
  return { rent: Math.round(rent), insurance: Math.round(insurance), overhead: Math.round(BAL.overheadBase + BAL.overheadPerAircraft * n) };
}

/**
 * An aircraft leaving the fleet mid-month (lease returned): posts its share of this month's rent, insurance and
 * per-aircraft overhead now, since month end only sees the fleet that is left. Call just before it is deleted.
 */
export function settleDeparture(g: GameState, ac: GameState['fleet'][string]): void {
  const s = shareOfMonth(ac, g.finance.current.month);
  if (s <= 0) return;
  if (ac.ownership.kind === 'dryLeaseIn') post(g, 'rent', -Math.round(ac.ownership.rentPerMonth * s));
  if (ac.status !== 'leasedOut') post(g, 'insurance', -Math.round(typeOf(ac.typeId).insuranceMonth * s));
  post(g, 'overhead', -Math.round(BAL.overheadPerAircraft * s));
}

/**
 * 'month' (runs last): rent, insurance, overhead into the closing month; close g.finance.current into history;
 * open the next; statement message (+ optional auto-pause 'monthEnd').
 */
export function onMonthEnd(g: GameState, ev: SimEvent): void {
  const cur = g.finance.current;
  const fc = fixedCosts(g, cur.month);
  post(g, 'rent', -fc.rent);
  post(g, 'insurance', -fc.insurance);
  post(g, 'overhead', -fc.overhead);
  cur.cashEnd = g.company.cash;
  cur.closed = true;
  g.finance.history.push(cur);
  if (g.finance.history.length > 60) g.finance.history.shift();
  g.finance.current = newStatement(monthKey(ev.t), g.company.cash);
  const { revenue, costs, profit } = statementTotals(cur.lines);
  const s = stats(g);
  s.bestMonthProfit = Math.max(s.bestMonthProfit, profit);
  pushMessage(g, {
    tone: profit >= 0 ? 'good' : 'warn', cat: 'finance', title: `${fmtMonth(cur.month, false)} statement`, cue: 'monthEnd',
    body: `Revenue ${usd(revenue)}, costs ${usd(-costs)}: ${profit >= 0 ? 'profit' : 'loss'} ${usd(Math.abs(profit))}. ${Math.round(cur.bh)} block hours. Cash ${usd(g.company.cash)}.`,
  });
  requestPause('monthEnd');
}

/** 'payment': collect a receivable (cashOnly) and message when it was late. */
export function onPayment(g: GameState, ev: SimEvent): void {
  const r = g.finance.receivables.find((x) => x.id === ev.id);
  if (!r || r.paid !== null || g.now < r.payAt) return;
  cashOnly(g, r.amount);
  r.paid = g.now;
  const late = Math.floor((g.now - r.due) / DAY);
  if (late > BAL.graceDays) {
    const name = g.clients[r.clientId]?.name ?? 'A client';
    pushMessage(g, { tone: 'info', cat: 'finance', title: `${name} paid ${late} days late`, body: `${usd(r.amount)} for ${r.desc}.`, cue: 'paymentIn' });
    if (g.clients[r.clientId]?.kind === 'government') v09Stats(g).lateGovPaid++;
  }
}

function gameOver(g: GameState, reason: string): void {
  if (g.gameOver) return;
  g.gameOver = { t: g.now, reason };
  pushMessage(g, { tone: 'bad', cat: 'finance', title: 'The company has failed', body: reason });
}

/** Daily: overdue reminders (+7, +30 → decision), receivables pruning, low-cash warning, rescue and bankruptcy. */
export function dailyFinance(g: GameState): void {
  const f = g.finance;
  for (const r of f.receivables) {
    if (r.paid !== null) continue;
    const over = Math.floor((g.now - r.due) / DAY);
    if (over >= 30 && (r.nudged ?? 0) < 30) {
      r.nudged = 30;
      if (g.decisions.length < BAL.maxOpenDecisions) latePaymentDecision(g, r);
      else pushMessage(g, { tone: 'warn', cat: 'finance', title: `${g.clients[r.clientId]?.name ?? 'A client'} is 30 days late`, body: `${usd(r.amount)} for ${r.desc}.`, ref: r.contractId ? { kind: 'contract', id: r.contractId } : undefined, ...cardMeta(invoiceOverdueCard(g, r.id)) });
    } else if (over >= 7 && (r.nudged ?? 0) < 7) {
      r.nudged = 7;
      // Late interest (BAL.lateInterest a year) is flavour in v0.5: shown, never collected.
      const interest = Math.round((r.amount * BAL.lateInterest * over) / 365);
      pushMessage(g, {
        tone: 'info', cat: 'finance', title: `Invoice overdue: ${g.clients[r.clientId]?.name ?? 'client'}`,
        body: `${usd(r.amount)} for ${r.desc}, ${over} days past due. Reminder sent${interest >= 100 ? ` (late interest so far ${usd(interest)}, which nobody in this business pays)` : ''}.`,
      });
    }
  }
  if (f.receivables.length > 80) f.receivables = f.receivables.filter((r) => r.paid === null || r.paid > g.now - 120 * DAY);
  // Solvency (fail forward).
  const cash = g.company.cash;
  if (cash < 0) {
    f.negSince ??= g.now;
    if (f.refusedRescue && cash < BAL.bankruptFloor) return gameOver(g, `Cash fell below ${usd(BAL.bankruptFloor)} after the rescue was refused.`);
    if (g.now - f.negSince >= BAL.rescueDays * DAY) {
      if ((f.rescues ?? 0) >= 1) return gameOver(g, `Insolvent again for ${BAL.rescueDays} days after the rescue.`);
      if (!f.refusedRescue && !g.decisions.some((d) => d.kind === 'rescue')) rescueDecision(g);
    }
  } else {
    // Recovered on our own after refusing the investor: the offer may come round again next time.
    if (f.negSince !== null && f.refusedRescue) f.refusedRescue = false;
    f.negSince = null;
  }
  // Low-cash warning (every two weeks at most) when the 30-day forecast dips below zero.
  if (g.now - (f.lowCashAt ?? -Infinity) >= 14 * DAY) {
    const low = Math.min(...cashForecast(g, 30).map((p) => p.cash));
    if (low < 0) {
      f.lowCashAt = g.now;
      const card = cashLowCard(g);
      if (card) postProblem(g, card, { cat: 'finance', tone: 'bad', tail: 'Find work, chase receivables or cut costs.' });
      else pushMessage(g, { tone: 'bad', cat: 'finance', title: 'Cash is running out', body: `The 30-day forecast dips to ${usd(low)}. Find work, chase receivables or cut costs.` });
    }
  }
}

/**
 * Projected cash for the next `days` days from known commitments: receivables at their due dates, wet-lease
 * MGH invoices for running months, charter instalments, salaries and fixed costs at month ends, planned checks,
 * variable flying costs. Pure (no RNG).
 */
export function cashForecast(g: GameState, days: number): { t: number; cash: number }[] {
  const end = g.now + days * DAY;
  const delta = new Map<number, number>();
  const add = (t: number, v: number) => {
    if (t > end || !v) return;
    const d = Math.max(0, Math.floor((t - g.now) / DAY));
    delta.set(d, (delta.get(d) ?? 0) + v);
  };
  // Overdue invoices are expected at the client's typical lateness (never today); slow payers' invoices not yet
  // due likewise.
  for (const r of g.finance.receivables) {
    if (r.paid !== null) continue;
    const cl = g.clients[r.clientId];
    const mid = cl ? ((cl.lateDays[0] + cl.lateDays[1]) / 2) * DAY : 15 * DAY;
    let t = r.due;
    if (r.due < g.now) t = Math.max(r.due + mid, g.now + 7 * DAY);
    else if (cl && cl.payReliability < 0.6) t = r.due + mid;
    add(t, r.amount);
  }
  const salaries = salaryBill(g);
  for (let k = monthKey(g.now); monthStart(k) <= end; k++) {
    const t = monthStart(k + 1);
    const fc = fixedCosts(g, k);
    add(t, -(fc.rent + fc.insurance + fc.overhead + salaries));
    for (const c of Object.values(g.contracts)) {
      if ((c.status !== 'active' && c.status !== 'signed') || c.product.kind !== 'wet') continue;
      const a = Math.max(c.start, monthStart(k));
      const b = Math.min(c.end, t);
      if (b <= a) continue;
      add(t + c.payment.dueDays * DAY, c.product.ratePerBH * c.product.mghPerMonth * c.aircraftIds.length * ((b - a) / (t - monthStart(k))));
    }
  }
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'active' && c.status !== 'signed') continue;
    for (const it of c.instalments ?? []) add(it.at + c.payment.dueDays * DAY, it.amount);
  }
  for (const m of Object.values(g.maintenance)) if ((m.status === 'planned' || m.status === 'inWork') && m.kind !== 'AOG') add(m.end, -m.cost);
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.std > end) continue;
    const ac = g.fleet[f.aircraftId];
    if (ac) add(f.sta, -Math.round(typeOf(ac.typeId).maintBH * (f.block / 60)));
  }
  const out: { t: number; cash: number }[] = [];
  let cash = g.company.cash;
  for (let d = 0; d <= days; d++) {
    cash += delta.get(d) ?? 0;
    out.push({ t: g.now + d * DAY, cash: Math.round(cash) });
  }
  return out;
}
