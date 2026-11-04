// v0.7.1 money problems as ProblemCards (UPDATE-0.7.1.md §9.3): cash running out, overdue invoices, a loss month,
// a rent due when the forecast dips. Numbers from ops/finance read APIs. Pure.

import { BAL } from '../core/balance';
import { COST_CATS, statementTotals } from '../core/ledger';
import { DAY, fmtDay, fmtMonth, monthKey, nextMonthStart } from '../core/time';
import type { GameState, LedgerCat, MonthStatement } from '../core/types';
import { cashForecast, cashSeries, daysOverdue, forecastItems, monthEndBill } from '../ops/finance';
import { usd } from '../ops/util';
import { mkHurt, type ProblemCard, type TimelineSpec } from './types';

export function cashLowCard(g: GameState): ProblemCard | null {
  // Round 4: below zero the red cashNegative card is the one cash problem (one event, one card).
  if (g.company.cash < 0) return null;
  // v0.15.1 (perf) one forecast pass for the series and the biggest cost (was two).
  const items = forecastItems(g, 30);
  const fc = cashSeries(g, items, 30);
  if (!fc.length) return null;
  let low = fc[0];
  for (const p of fc) if (p.cash < low.cash) low = p;
  const first = fc.find((p) => p.cash < 0);
  if (!first || low.cash >= 0) return null;
  const bill = monthEndBill(g, monthKey(g.now));
  const monthEnd = nextMonthStart(g.now);
  // v0.12.1 WHY names what really pulls it under: the biggest outgoing up to the first day below zero.
  const by = new Map<string, number>();
  // v0.14.1 (UI-3) up to the end of that calendar day (the forecast's points are calendar days).
  const dayEnd = (Math.floor(first.t / DAY) + 1) * DAY;
  for (const x of items) if (x.amount < 0 && x.t < dayEnd) by.set(x.what, (by.get(x.what) ?? 0) + x.amount);
  const top = [...by].sort((a, b) => a[1] - b[1])[0];
  const timeline: TimelineSpec = {
    from: g.now, to: g.now + 30 * DAY,
    marks: [{ t: first.t, label: 'cash < 0', tone: 'bad' }, { t: monthEnd, label: 'month end', tone: 'warn' }],
    spans: [{ from: first.t, to: g.now + 30 * DAY, label: 'short', tone: 'bad' }],
  };
  const decision = g.decisions.find((d) => d.kind === 'latePayment');
  return {
    subject: { kind: 'cashLow', ref: { kind: 'cash', id: 'cash' } }, severity: first.t - g.now <= 7 * DAY ? 'red' : 'amber',
    title: `Cash runs out on ${fmtDay(first.t)}`, what: `Cash runs out on ${fmtDay(first.t)}`,
    why: `The 30-day forecast dips to ${usd(low.cash)}${top ? `. Biggest cost before then: ${top[0]} (${usd(-top[1])})` : ''}.`,
    hurt: mkHurt({ money: -low.cash, what: `short on ${fmtDay(low.t)}`, extra: `salaries late = morale ${BAL.morale.salaryLate}` }),
    actions: [
      { id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true },
      { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } },
      ...(decision ? [{ id: 'factor', label: 'Sell an invoice', open: { modal: 'decision' as const, id: decision.id } }] : []),
    ],
    details: [`Cash now ${usd(g.company.cash)}`, `Month end ${fmtDay(monthEnd)}: fixed costs ${usd(bill.rent + bill.insurance + bill.overhead)}, salaries ${usd(bill.salaries + bill.heads)}`, `Outstanding invoices ${usd(g.finance.receivables.filter((r) => r.paid === null).reduce((s, r) => s + r.amount, 0))}`],
    // v0.14.1 no `by` on the gauge (it prints a time of day only: '00:00' now the points are calendar days); the hurt
    // line has the date.
    visuals: { timeline, gauges: [{ id: 'cash', label: 'Cash', value: Math.max(0, g.company.cash), limit: Math.max(1, g.company.cash - low.cash), unit: 'usd', text: `${usd(g.company.cash)} now, ${usd(low.cash)} at the low`, tone: 'bad' }] },
    terms: ['blockHours'], by: first.t,
  };
}

export function invoiceOverdueCard(g: GameState, receivableId: string): ProblemCard | null {
  // By receivable id, or (the card's own ref is the contract) the oldest overdue invoice of that contract.
  const r = g.finance.receivables.find((x) => x.id === receivableId)
    ?? g.finance.receivables.filter((x) => x.contractId === receivableId && x.paid === null && x.due <= g.now - 7 * DAY).sort((a, b) => a.due - b.due)[0];
  if (!r || r.paid !== null || r.due > g.now - 7 * DAY) return null;
  const cl = g.clients[r.clientId];
  const days = daysOverdue(g, r);
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

const FIXED: readonly LedgerCat[] = ['rent', 'insurance', 'overhead', 'salaries'];

/** v0.14.1 (UI-6) cost lines as the loss card names them (lower case, in a sentence). */
const COST_WORD: Partial<Record<LedgerCat, string>> = {
  fuel: 'fuel', airportFees: 'airport fees', rent: 'rent', reserves: 'maintenance reserves', salaries: 'salaries', perDiem: 'per diems',
  hotels: 'crew hotels', deadhead: 'crew deadheads', crewJet: 'crew jets', maintenance: 'line maintenance', checks: 'checks', paint: 'paint',
  insurance: 'insurance', overhead: 'overhead', training: 'training', hiring: 'hiring', penalties: 'penalties', subcharter: 'sub-charters',
  approvals: 'approvals', interest: 'interest', capex: 'aircraft bought', refit: 'cabin refits', leaseReturn: 'lease returns', warRisk: 'war-risk cover',
  disruption: 'disruptions', compliance: 'safety and compliance', delivery: 'ferry companies', sales: 'sales trips', badDebt: 'bad debts', consent: 'lessor consent fees',
};

/**
 * A closed month that lost money. v0.14.1 (UI-6) the WHY reads the statement itself: the cost lines that grew most on
 * the month before (or the biggest, with no month before), and 'fewer hours flown' only when revenue fell and that,
 * not the costs, is what turned it. Was a re-estimate of rent, insurance and overhead from today's fleet and 'the
 * aircraft sat idle' whenever under 150 BH an aircraft, whatever the cause.
 */
export function lossMonthCard(g: GameState): ProblemCard | null {
  const h = g.finance.history;
  const st = h[h.length - 1];
  if (!st || !st.closed) return null;
  const tot = statementTotals(st.lines);
  if (tot.profit >= 0) return null;
  const prev = h.length >= 2 && h[h.length - 2].month === st.month - 1 ? h[h.length - 2] : null;
  const before = prev ? statementTotals(prev.lines) : null;
  const bh = Math.round(st.bh);
  const cost = (l: MonthStatement['lines'], c: LedgerCat) => (COST_CATS.includes(c) ? -(l[c] ?? 0) : 0);
  // The lines that drove it: the biggest rises on last month (the biggest lines with no month before).
  const rises = COST_CATS.map((c) => ({ c, v: cost(st.lines, c), d: cost(st.lines, c) - (prev ? cost(prev.lines, c) : 0) }))
    .filter((x) => x.d >= Math.max(10_000, 0.05 * -tot.profit)).sort((a, b) => b.d - a.d).slice(0, 3);
  const revDrop = before ? before.revenue - tot.revenue : 0;
  const costRise = before ? -tot.costs - -before.costs : Infinity;
  const fewer = before !== null && revDrop > 0 && revDrop >= costRise;
  // Only the running costs (rent, insurance, overhead, pay) behind it: too little work for the fleet.
  const idle = fewer || rises.every((x) => FIXED.includes(x.c));
  const named = rises.map((x) => `${COST_WORD[x.c] ?? x.c} ${prev ? `+${usd(x.d)}` : usd(x.v)}`).join(', ');
  const pm = prev ? fmtMonth(prev.month, false) : '';
  const why = `Revenue ${usd(tot.revenue)} did not cover costs of ${usd(-tot.costs)}.`
    + (fewer ? ` Revenue fell ${usd(revDrop)} on ${pm}: ${bh} block hours flown (${Math.round(prev!.bh)} before).` : '')
    + (named ? ` ${prev ? `Costs up on ${pm}` : 'Biggest costs'}: ${named}.` : '');
  return {
    subject: { kind: 'lossMonth', ref: { kind: 'statement', id: String(st.month) } }, severity: 'amber',
    title: `${fmtMonth(st.month, false)} lost ${usd(-tot.profit)}`, what: `${fmtMonth(st.month, false)} lost ${usd(-tot.profit)}`,
    why,
    hurt: mkHurt({ money: -tot.profit, what: 'lost' }),
    actions: idle
      ? [{ id: 'findWork', label: 'Find work', open: { tab: 'contracts' }, primary: true }, { id: 'finance', label: 'Finance', open: { tab: 'finance' } }]
      : [{ id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true }, { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } }],
    details: [`Revenue ${usd(tot.revenue)}, costs ${usd(-tot.costs)}`, `Rent, insurance and overhead ${usd(cost(st.lines, 'rent') + cost(st.lines, 'insurance') + cost(st.lines, 'overhead'))}`, `${bh} block hours flown`],
    visuals: {}, terms: ['blockHours'], by: nextMonthStart(g.now),
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

/**
 * v0.9 round 4 (§S): cash below zero, the day it happens. WHAT the fact; WHY what pushed it under; DOES IT HURT the
 * rescue clock (an investor's offer after BAL.rescueDays days, the game lost on a second time); WHAT YOU CAN DO as the
 * low-cash card. Null while cash is at or above zero. Pure.
 */
export function cashNegativeCard(g: GameState): ProblemCard | null {
  const cash = g.company.cash;
  if (cash >= 0) return null;
  const since = g.finance.negSince ?? g.now;
  const rescueAt = since + BAL.rescueDays * DAY;
  const daysLeft = Math.max(0, Math.ceil((rescueAt - g.now) / DAY));
  const bill = monthEndBill(g, monthKey(g.now));
  const owed = g.finance.receivables.filter((r) => r.paid === null).reduce((s, r) => s + r.amount, 0);
  const again = (g.finance.rescues ?? 0) >= 1;
  const decision = g.decisions.find((d) => d.kind === 'latePayment');
  return {
    subject: { kind: 'cashNegative', ref: { kind: 'cash', id: 'cash' } }, severity: 'red',
    title: `Cash is below zero (${usd(cash)})`, what: `Cash is below zero (${usd(cash)})`,
    why: `Costs outran what came in: about ${usd(bill.total)} a month in rent, insurance and salaries before any flying${owed ? `; ${usd(owed)} of invoices are still unpaid` : ''}.`,
    hurt: mkHurt({ money: -cash, what: 'short', extra: again ? `the company fails after ${BAL.rescueDays} days in the red` : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'} an investor offers a rescue for a quarter of the company` }),
    actions: [
      { id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true },
      { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } },
      ...(decision ? [{ id: 'factor', label: 'Sell an invoice', open: { modal: 'decision' as const, id: decision.id } }] : []),
    ],
    details: [`Below zero since ${fmtDay(since)}`, `Fixed costs this month ${usd(bill.rent + bill.insurance + bill.overhead)}, salaries ${usd(bill.salaries + bill.heads)}`, `Outstanding invoices ${usd(owed)}`],
    // The gauge carries no `by`: Gauge prints a time of day for it, and the hurt line already gives the date.
    visuals: { gauges: [{ id: 'cash', label: 'Days in the red', value: Math.min(BAL.rescueDays, Math.floor((g.now - since) / DAY)), limit: BAL.rescueDays, unit: 'hm', text: `${Math.floor((g.now - since) / DAY)} of ${BAL.rescueDays} days`, tone: 'bad' }] },
    terms: [], by: rescueAt,
  };
}

export function moneyProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const neg = cashNegativeCard(g);
  if (neg) out.push(neg);
  const cash = cashLowCard(g);
  if (cash) out.push(cash);
  // One card per contract (its subject): two overdue invoices of one contract are one problem.
  const seen = new Set<string>();
  for (const r of g.finance.receivables) {
    const c = invoiceOverdueCard(g, r.id);
    if (c && !seen.has(c.subject.ref.id)) { seen.add(c.subject.ref.id); out.push(c); }
  }
  const loss = lossMonthCard(g);
  if (loss && g.now - nextMonthStart(g.now - 31 * DAY) <= 7 * DAY) out.push(loss);
  if (cash || neg) for (const ac of Object.values(g.fleet)) {
    const l = leaseDueCard(g, ac.id);
    if (l) out.push(l);
  }
  return out;
}
