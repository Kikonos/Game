// v0.7.1 money problems as ProblemCards (UPDATE-0.7.1.md §9.3): cash running out, overdue invoices, a loss month,
// a rent due when the forecast dips. Numbers from ops/finance read APIs. Pure.

import { BAL } from '../core/balance';
import { statementTotals } from '../core/ledger';
import { DAY, fmtDay, fmtMonth, monthKey, nextMonthStart } from '../core/time';
import type { GameState } from '../core/types';
import { cashForecast, fixedCosts } from '../ops/finance';
import { usd } from '../ops/util';
import { mkHurt, type ProblemCard, type TimelineSpec } from './types';

export function cashLowCard(g: GameState): ProblemCard | null {
  const fc = cashForecast(g, 30);
  if (!fc.length) return null;
  let low = fc[0];
  for (const p of fc) if (p.cash < low.cash) low = p;
  const first = fc.find((p) => p.cash < 0);
  if (!first || low.cash >= 0) return null;
  const k = monthKey(g.now);
  const fx = fixedCosts(g, k);
  const salaries = Object.values(g.crew).reduce((s, c) => s + c.salary, 0) * (1 + BAL.onCosts);
  const monthEnd = nextMonthStart(g.now);
  const timeline: TimelineSpec = {
    from: g.now, to: g.now + 30 * DAY,
    marks: [{ t: first.t, label: 'cash < 0', tone: 'bad' }, { t: monthEnd, label: 'month end', tone: 'warn' }],
    spans: [{ from: first.t, to: g.now + 30 * DAY, label: 'short', tone: 'bad' }],
  };
  const decision = g.decisions.find((d) => d.kind === 'latePayment');
  return {
    subject: { kind: 'cashLow', ref: { kind: 'cash', id: 'cash' } }, severity: first.t - g.now <= 7 * DAY ? 'red' : 'amber',
    title: `Cash runs out on ${fmtDay(first.t)}`, what: `Cash runs out on ${fmtDay(first.t)}`,
    why: `The 30-day forecast dips to ${usd(low.cash)}: rent and salaries of about ${usd(fx.rent + fx.insurance + fx.overhead + salaries)} on ${fmtDay(monthEnd)} exceed what comes in.`,
    hurt: mkHurt({ money: -low.cash, what: `short on ${fmtDay(low.t)}`, extra: `salaries late = morale ${BAL.morale.salaryLate}` }),
    actions: [
      { id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true },
      { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } },
      ...(decision ? [{ id: 'factor', label: 'Sell an invoice', open: { modal: 'decision' as const, id: decision.id } }] : []),
    ],
    details: [`Cash now ${usd(g.company.cash)}`, `Fixed costs this month ${usd(fx.rent + fx.insurance + fx.overhead)}, salaries ${usd(salaries)}`, `Outstanding invoices ${usd(g.finance.receivables.filter((r) => r.paid === null).reduce((s, r) => s + r.amount, 0))}`],
    visuals: { timeline, gauges: [{ id: 'cash', label: 'Cash', value: Math.max(0, g.company.cash), limit: Math.max(1, g.company.cash - low.cash), unit: 'usd', text: `${usd(g.company.cash)} now, ${usd(low.cash)} at the low`, tone: 'bad', by: low.t }] },
    terms: ['blockHours'], by: first.t,
  };
}

export function invoiceOverdueCard(g: GameState, receivableId: string): ProblemCard | null {
  const r = g.finance.receivables.find((x) => x.id === receivableId);
  if (!r || r.paid !== null || r.due > g.now - 7 * DAY) return null;
  const cl = g.clients[r.clientId];
  const days = Math.floor((g.now - r.due) / DAY);
  const decision = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === r.id);
  const gov = cl?.kind === 'government';
  return {
    subject: { kind: 'invoiceOverdue', ref: { kind: 'contract', id: r.contractId ?? r.id } }, severity: days >= 30 ? 'red' : 'amber',
    title: `${cl?.name ?? 'A client'} is ${days} days late with ${usd(r.amount)}`, what: `${cl?.name ?? 'A client'} is ${days} days late with ${usd(r.amount)}`,
    why: `${gov ? 'Governments pay late; ' : ''}${r.desc} was due ${fmtDay(r.due)}${r.nudged ? `; a reminder went out at ${r.nudged} days` : ''}.`,
    hurt: mkHurt({ money: r.amount, what: 'outstanding' }),
    actions: decision ? [{ id: 'decide', label: 'Decide', open: { modal: 'decision', id: decision.id }, primary: true }] : [{ id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true }],
    details: [`Issued ${fmtDay(r.issued)}, due ${fmtDay(r.due)}`, cl ? `${cl.name} pays on time ${Math.round(cl.payReliability * 100)}% of the time` : ''].filter(Boolean),
    visuals: {}, terms: [], by: r.due,
  };
}

export function lossMonthCard(g: GameState): ProblemCard | null {
  const st = g.finance.history[g.finance.history.length - 1];
  if (!st || !st.closed) return null;
  const tot = statementTotals(st.lines);
  if (tot.profit >= 0) return null;
  const fx = fixedCosts(g, st.month);
  const bh = Math.round(st.bh);
  return {
    subject: { kind: 'lossMonth', ref: { kind: 'statement', id: String(st.month) } }, severity: 'amber',
    title: `${fmtMonth(st.month, false)} lost ${usd(-tot.profit)}`, what: `${fmtMonth(st.month, false)} lost ${usd(-tot.profit)}`,
    why: `${bh} block hours flown against ${usd(fx.rent + fx.insurance + fx.overhead)} of rent, insurance and overhead${bh < 150 * Object.keys(g.fleet).length ? ': the aircraft sat idle' : ''}.`,
    hurt: mkHurt({ money: -tot.profit, what: 'lost' }),
    actions: [{ id: 'findWork', label: 'Find work', open: { tab: 'contracts' }, primary: true }, { id: 'finance', label: 'Finance', open: { tab: 'finance' } }],
    details: [`Revenue ${usd(tot.revenue)}, costs ${usd(tot.costs)}`], visuals: {}, terms: ['blockHours', 'mgh'], by: nextMonthStart(g.now),
  };
}

export function leaseDueCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return null;
  const due = nextMonthStart(g.now);
  if (due - g.now > 7 * DAY) return null;
  const fc = cashForecast(g, 7);
  const low = Math.min(...fc.map((p) => p.cash));
  if (low >= 0) return null;
  return {
    subject: { kind: 'leaseDue', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber',
    title: `${ac.reg}'s rent of ${usd(ac.ownership.rentPerMonth)} is due ${fmtDay(due)}`, what: `${ac.reg}'s rent of ${usd(ac.ownership.rentPerMonth)} is due ${fmtDay(due)}`,
    why: `The forecast dips to ${usd(low)} that week; ${ac.ownership.lessor} expects the rent on the first.`,
    hurt: mkHurt({ money: ac.ownership.rentPerMonth, what: 'due' }),
    actions: [{ id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true }], details: [], visuals: {}, terms: [], by: due,
  };
}

export function moneyProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const cash = cashLowCard(g);
  if (cash) out.push(cash);
  for (const r of g.finance.receivables) {
    const c = invoiceOverdueCard(g, r.id);
    if (c) out.push(c);
  }
  const loss = lossMonthCard(g);
  if (loss && g.now - nextMonthStart(g.now - 31 * DAY) <= 7 * DAY) out.push(loss);
  if (cash) for (const ac of Object.values(g.fleet)) {
    const l = leaseDueCard(g, ac.id);
    if (l) out.push(l);
  }
  return out;
}
