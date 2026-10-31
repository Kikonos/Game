// Statements, receivables, fixed costs and solvency (B3). DESIGN.md §5.7.
// Money moves only through core/ledger.ts (post, accrue, cashOnly, invoice).

import { v09Stats } from '../crew/dayPlan';
import { BAL } from '../core/balance';
import { cashOnly, post, statementTotals } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { cardMeta, cashLowCard, cashNegativeCard, invoiceOverdueCard, postProblem } from '../problems';
import { requestPause } from '../core/pause';
import { typeOf } from '../core/perf';
import { DAY, daysInMonth, fmtDay, fmtMonth, monthKey, monthStart } from '../core/time';
import type { GameState, Minute, MonthKey, MonthStatement, SimEvent } from '../core/types';
import { joinsAt, paidShare } from '../crew';
import { brokerCut } from '../contracts/accept';
import { mghFor, wetMonthLines } from '../contracts/billing';
import { warRiskCost } from '../contracts/missionChecks';
import { legCostEstimate } from './flights';
import { warRiskAt } from './world';
import { latePaymentDecision, rescueDecision } from './events';
import { stats, usd } from './util';

export function newStatement(month: MonthKey, cash: number): MonthStatement {
  return { month, lines: {}, bh: 0, cashStart: cash, cashEnd: cash, closed: false };
}

export const monthProfit = (st: MonthStatement) => statementTotals(st.lines).profit;

/**
 * Share of month k an aircraft is on the AOC (delivered and not yet returned). v0.12.1 `leaveAt`: it leaves the
 * fleet then (sold, returned), so the share stops there for every kind of ownership.
 */
function shareOfMonth(ac: GameState['fleet'][string], k: MonthKey, leaveAt?: Minute): number {
  const a = monthStart(k);
  const b = monthStart(k + 1);
  const from = Math.max(a, ac.deliveredAt);
  let to = Math.min(b, leaveAt ?? b);
  if (ac.ownership.kind === 'dryLeaseIn') to = Math.min(to, Math.max(ac.ownership.leaseEnd, from));
  return Math.max(0, Math.min(1, (to - from) / (b - a)));
}

/** v0.12.1 share of month k an aircraft was out on a dry lease (the lessee insures the airframe then). Pure. */
function leasedOutShare(g: GameState, ac: GameState['fleet'][string], k: MonthKey, upTo?: Minute): number {
  const a = monthStart(k);
  const b = Math.min(monthStart(k + 1), upTo ?? Infinity);
  let out = 0;
  for (const c of Object.values(g.contracts)) {
    const d = c.dry;
    if (!d || d.leasedAt === undefined || !c.aircraftIds.includes(ac.id)) continue;
    const back = d.returnedAt ?? Infinity;
    out += Math.max(0, Math.min(b, back) - Math.max(a, d.leasedAt));
  }
  return Math.min(1, out / (monthStart(k + 1) - a));
}

/**
 * v0.12.1 rent of a leased-in aircraft for month k: its days on lease, and a holdover past the lease end while it
 * is still with us (the lessor's +10%), so an aircraft kept after its lease never flies rent-free.
 */
function rentOf(g: GameState, ac: GameState['fleet'][string], k: MonthKey, leaveAt?: Minute): number {
  if (ac.ownership.kind !== 'dryLeaseIn') return 0;
  const own = ac.ownership;
  const a = monthStart(k), b = monthStart(k + 1);
  let rent = own.rentPerMonth * shareOfMonth(ac, k, leaveAt);
  const end = Math.min(b, leaveAt ?? b);
  const held = Math.max(a, own.leaseEnd, ac.deliveredAt);
  if (own.leaseEnd <= g.now && !ac.returning && end > held) rent += own.rentPerMonth * 1.1 * ((end - held) / (b - a));
  return rent;
}

/** Fixed monthly costs of month k: rent, insurance, overhead (each fleet aircraft pro-rated to its days). */
export function fixedCosts(g: GameState, k: MonthKey): { rent: number; insurance: number; overhead: number } {
  let rent = 0;
  let insurance = 0;
  let n = 0;
  for (const ac of Object.values(g.fleet)) {
    const s = shareOfMonth(ac, k);
    rent += rentOf(g, ac, k);
    if (s <= 0) continue;
    n += s;
    // v0.8 a dry lease out: the lessee insures the airframe; our rent and overhead keep running (v0.12.1 by days).
    insurance += typeOf(ac.typeId).insuranceMonth * Math.max(0, s - leasedOutShare(g, ac, k));
  }
  return { rent: Math.round(rent), insurance: Math.round(insurance), overhead: Math.round(BAL.overheadBase + BAL.overheadPerAircraft * n) };
}

/**
 * An aircraft leaving the fleet mid-month (sold, lease returned): posts its share of this month's rent, insurance and
 * per-aircraft overhead now, since month end only sees the fleet that is left. Call just before it is deleted.
 * v0.12.1 the share runs to `leaveAt` (now), not to the month end.
 */
export function settleDeparture(g: GameState, ac: GameState['fleet'][string], leaveAt: Minute = g.now): void {
  const k = g.finance.current.month;
  const s = shareOfMonth(ac, k, leaveAt);
  const rent = rentOf(g, ac, k, leaveAt);
  if (rent > 0) post(g, 'rent', -Math.round(rent));
  if (s <= 0) return;
  const ins = typeOf(ac.typeId).insuranceMonth * Math.max(0, s - leasedOutShare(g, ac, k, leaveAt));
  if (ins > 0) post(g, 'insurance', -Math.round(ins));
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
  const week = new Map<string, GameState['finance']['receivables']>();
  for (const r of f.receivables) {
    if (r.paid !== null) continue;
    const over = Math.floor((g.now - r.due) / DAY);
    if (over >= 30 && (r.nudged ?? 0) < 30) {
      r.nudged = 30;
      if (g.decisions.length < BAL.maxOpenDecisions) latePaymentDecision(g, r);
      else pushMessage(g, { tone: 'warn', cat: 'finance', title: `${g.clients[r.clientId]?.name ?? 'A client'} is 30 days late`, body: `${usd(r.amount)} for ${r.desc}.`, ref: r.contractId ? { kind: 'contract', id: r.contractId } : undefined, ...cardMeta(invoiceOverdueCard(g, r.id)) });
    } else if (over >= 7 && (r.nudged ?? 0) < 7) {
      r.nudged = 7;
      // v0.12.1 one reminder per client and day (grouped below).
      const x = week.get(r.clientId) ?? [];
      x.push(r);
      week.set(r.clientId, x);
    }
  }
  for (const [clientId, rs] of week) {
    // Late interest (BAL.lateInterest a year) is flavour in v0.5: shown, never collected.
    const amount = rs.reduce((s, r) => s + r.amount, 0);
    const interest = Math.round(rs.reduce((s, r) => s + (r.amount * BAL.lateInterest * Math.floor((g.now - r.due) / DAY)) / 365, 0));
    const tail = `Reminder sent${interest >= 100 ? ` (late interest so far ${usd(interest)}, which nobody in this business pays)` : ''}.`;
    const r0 = rs[0];
    pushMessage(g, {
      tone: 'info', cat: 'finance', title: `Invoice overdue: ${g.clients[clientId]?.name ?? 'client'}`,
      body: rs.length === 1 ? `${usd(r0.amount)} for ${r0.desc}, ${Math.floor((g.now - r0.due) / DAY)} days past due. ${tail}` : `${rs.length} invoices, ${usd(amount)}, a week or more past due. ${tail}`,
    });
  }
  if (f.receivables.length > 80) f.receivables = f.receivables.filter((r) => r.paid === null || r.paid > g.now - 120 * DAY);
  // Solvency (fail forward).
  const cash = g.company.cash;
  if (cash < 0) {
    if (f.negSince === null || f.negSince === undefined) {
      // v0.9 round 4 (§S): the day cash crosses zero: the triple and the four-line card (the rescue decision follows).
      f.negSince = g.now;
      const card = cashNegativeCard(g);
      if (card) postProblem(g, card, { cat: 'finance', tone: 'bad', cue: 'cashNegative', tail: 'Find work, chase receivables or cut costs.' });
    }
    if (f.refusedRescue && cash < BAL.bankruptFloor) return gameOver(g, `Cash fell below ${usd(BAL.bankruptFloor)} after the rescue was refused.`);
    // v0.12 Scenarios (Cash Crunch): no investor comes; below the floor the creditors close the company.
    if (g.scen?.noRescue) {
      if (cash < BAL.bankruptFloor) return gameOver(g, `Cash fell below ${usd(BAL.bankruptFloor)}: the creditors closed the company.`);
    } else if (g.now - f.negSince >= BAL.rescueDays * DAY) {
      if ((f.rescues ?? 0) >= 1) return gameOver(g, `Insolvent again for ${BAL.rescueDays} days after the rescue.`);
      if (!f.refusedRescue && !g.decisions.some((d) => d.kind === 'rescue')) rescueDecision(g);
    }
  } else {
    // Recovered on our own after refusing the investor: the offer may come round again next time.
    if (f.negSince !== null && f.refusedRescue) f.refusedRescue = false;
    f.negSince = null;
  }
  // Low-cash warning (every two weeks at most) when the 30-day forecast dips below zero. Round 4: never while cash is
  // already below zero (that is the red card above; the fortnight restarts from the day it went under).
  if (cash < 0) f.lowCashAt = g.now;
  else if (g.now - (f.lowCashAt ?? -Infinity) >= 14 * DAY) {
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
 * v0.12.1 department heads' pay for month k: each hired head's salary, pro-rated from the day they joined when that
 * was inside the month (the month-end bill and the cash forecast read the same). Pure.
 */
export function headsBill(g: GameState, k: MonthKey = monthKey(g.now)): number {
  let pay = 0;
  const a = monthStart(k), b = monthStart(k + 1);
  for (const h of Object.values(g.heads ?? {})) {
    if (!h.hired) continue;
    const from = Math.max(a, h.hired.since ?? a);
    if (from < b) pay += h.hired.salary * ((b - from) / (b - a));
  }
  return Math.round(pay);
}

/** v0.12.1 what the month-end run of month k takes out: rent, insurance, overhead, crew and heads' pay. Pure. */
export interface MonthEndBill { rent: number; insurance: number; overhead: number; salaries: number; heads: number; total: number }

/**
 * v0.12.1 the month-end bill of month k, the one figure the forecast, the cash card and the top bar read: fixed
 * costs, crew salaries with on-costs (crew joining before that month end included: they are on the payroll by then)
 * and the department heads. Pure.
 */
export function monthEndBill(g: GameState, k: MonthKey): MonthEndBill {
  const fc = fixedCosts(g, k);
  const end = monthStart(k + 1);
  // v0.12.1 (C12) pro rata as the month-end run pays: from the day each joined (payFrom), a joiner from the day they
  // join, so the forecast and the cash card show the bill that really comes.
  const a = monthStart(k);
  let pay = 0;
  for (const c of Object.values(g.crew)) {
    if (c.status !== 'joining') pay += c.salary * paidShare(c, a, end);
    else {
      const at = joinsAt(g, c);
      if (at !== null && at < end) pay += c.salary * paidShare({ ...c, payFrom: at }, a, end);
    }
  }
  const salaries = Math.round(pay * (1 + BAL.onCosts));
  const heads = headsBill(g, k);
  return { ...fc, salaries, heads, total: fc.rent + fc.insurance + fc.overhead + salaries + heads };
}

/** v0.12.1 one cash movement of the forecast, kept with what it is (the cash card names the biggest). */
export interface ForecastItem { t: Minute; amount: number; what: string }

/**
 * Projected cash movements for the next `days` days from known commitments: receivables at their expected payment,
 * wet-lease invoices (v0.12.1 the open month's own lines, MGH for later months, Hajj phases and the broker),
 * charter instalments, the month-end bill, maintenance when it is paid (refits and returns at the start, the return
 * deposit back at the end, checks at the end) and every scheduled leg's flying costs (fuel, fees, maintenance and
 * reserves, war risk) with the crew's travel at this month's daily rate. Pure (no RNG).
 */
export function forecastItems(g: GameState, days: number): ForecastItem[] {
  const end = g.now + days * DAY;
  const out: ForecastItem[] = [];
  const add = (t: number, amount: number, what: string) => {
    if (t <= end && amount) out.push({ t: Math.max(g.now, t), amount, what });
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
    add(t, r.amount, 'invoices paid');
  }
  const k0 = monthKey(g.now);
  for (let k = k0; monthStart(k) <= end; k++) {
    const t = monthStart(k + 1);
    add(t, -monthEndBill(g, k).total, `month-end rent, insurance and salaries on ${fmtDay(t)}`);
    for (const c of Object.values(g.contracts)) {
      if ((c.status !== 'active' && c.status !== 'signed') || c.product.kind !== 'wet' || c.billedMonths.includes(k)) continue;
      // The open month: its own invoice lines so far (flown, lost hours, excess); later months: the guarantee.
      const v = k === k0 ? wetMonthLines(c, k).reduce((s, l) => s + l.amount, 0) : c.product.ratePerBH * mghFor(c, k) * (1 - brokerCut(c));
      add(t + c.payment.dueDays * DAY, Math.round(v), 'wet-lease invoices');
    }
  }
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'active' && c.status !== 'signed') continue;
    for (const it of c.instalments ?? []) add(it.at + c.payment.dueDays * DAY, it.amount, 'charter balances');
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.status !== 'planned' && m.status !== 'inWork') continue;
    const reg = g.fleet[m.aircraftId]?.reg ?? 'an aircraft';
    if (m.kind === 'refit') {
      // Paid when the work starts (maintenance.ts onMaintStart): in work = already paid.
      if (m.status === 'planned') add(m.start, -m.cost, `${reg}'s cabin refit on ${fmtDay(m.start)}`);
    } else if (m.kind === 'return') {
      const ac = g.fleet[m.aircraftId];
      if (m.status === 'planned') add(m.start, -((ac?.returning?.quote ?? m.cost) + (ac?.returning?.earlyFee ?? 0)), `${reg}'s lease return on ${fmtDay(m.start)}`);
      const dep = ac?.ownership.kind === 'dryLeaseIn' ? ac.ownership.deposit ?? 0 : 0;
      add(m.end, dep, 'lease deposit back');
    } else add(m.end, -m.cost, `${reg}'s ${m.kind === 'AOG' ? 'repair' : m.kind === 'paint' ? 'paint' : `${m.kind}-check`} on ${fmtDay(m.end)}`);
  }
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.std > end) continue;
    const ac = g.fleet[f.aircraftId];
    if (!ac) continue;
    const x = legCostEstimate(g, f, ac);
    add(f.sta, -Math.round(x.maint + x.reserves + x.fuel + x.fees), 'flying costs (fuel, fees, maintenance)');
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    // Fuel at cost: the client pays the burn back (invoiced on arrival).
    if (x.fuel && c?.product.kind === 'charter' && c.product.fuelAtCost && (f.kind === 'revenue' || f.kind === 'techstop')) add(f.sta + (c.payment.basis === 'arrears' ? c.payment.dueDays : 7) * DAY, Math.round(x.fuel), 'fuel re-billed');
    if (f.kind !== 'deadhead') {
      const war = warRiskCost(warRiskAt(g, f.to), typeOf(ac.typeId).body === 'wide');
      add(f.sta, -war, 'war-risk cover');
      if (war && c?.product.kind === 'wet') add(f.sta + c.payment.dueDays * DAY, war, 'war-risk cover re-billed');
    }
  }
  // Crew away (per diems, hotels, tickets): this month's daily rate so far (last month's in its first days).
  const cur = g.finance.current;
  const elapsed = (g.now - monthStart(cur.month)) / DAY;
  const last = g.finance.history[g.finance.history.length - 1];
  const travel = (l: MonthStatement['lines']) => -((l.perDiem ?? 0) + (l.hotels ?? 0) + (l.deadhead ?? 0) + (l.crewJet ?? 0));
  const rate = elapsed >= 3 || !last ? travel(cur.lines) / Math.max(1, elapsed) : travel(last.lines) / daysInMonth(last.month);
  if (rate > 0) for (let d = 1; d <= days; d++) add(g.now + d * DAY, -Math.round(rate), 'crew travel (per diems, hotels, tickets)');
  return out;
}

/** Projected cash for the next `days` days (forecastItems by day). Pure (no RNG). */
export function cashForecast(g: GameState, days: number): { t: number; cash: number }[] {
  const delta = new Map<number, number>();
  for (const x of forecastItems(g, days)) {
    const d = Math.max(0, Math.floor((x.t - g.now) / DAY));
    delta.set(d, (delta.get(d) ?? 0) + x.amount);
  }
  const out: { t: number; cash: number }[] = [];
  let cash = g.company.cash;
  for (let d = 0; d <= days; d++) {
    cash += delta.get(d) ?? 0;
    out.push({ t: g.now + d * DAY, cash: Math.round(cash) });
  }
  return out;
}
