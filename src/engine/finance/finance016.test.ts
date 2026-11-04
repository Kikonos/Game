// v0.16 Finance (UPDATE-0.16.md §A): the credit line and its covenants, loans on owned aircraft, sale and leaseback,
// invoice factoring, the client deposit as a negotiation lever, interest on spare cash, the forecast and the cards.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { invoice } from '../core/ledger';
import { DAY, monthKey, monthStart, nextMonthStart, yearOf } from '../core/time';
import type { GameState, MonthStatement } from '../core/types';
import { acceptOffer, counterOffer, feasibilityAll } from '../contracts';
import { counterOdds } from '../contracts/counter';
import { newGame, offer, owned } from '../contracts/testkit';
import { fixedCosts, forecastItems, newStatement, onPayment } from '../ops/finance';
import { latePaymentDecision } from '../ops/events';
import { resolveDecision, saleQuote } from '../ops';
import { covenantBreachCard, creditHeadroomCard, factorRecourseCard, loanDueCard } from '../problems/money';
import { deserialize, serialize } from '../save';
import {
  annuity, benchmarkRate, covenantCheck, creditLimitFor, creditOpenWhy, creditView, dailyTreasury, depositEffect, depositNorm, depositSigned, drawCredit, ebitda12, factorInvoice, factorQuote, leasebackQuote,
  loadTreasury, loanOn, loanQuote, loanTermsFor, monthlyTreasury, moneyMarketBalance, openCreditLine, repayCredit, repayLoan, sellAndLeaseBack, takeLoan, treasury, treasuryForecastItems,
} from '.';

const F = BAL.v016.finance;

/** `n` closed statements before the current month, each with this much ACMI revenue and fuel (profit = the difference). */
function statements(g: GameState, n: number, revenue: number, costs = 300_000): void {
  const k0 = g.finance.current.month;
  for (let i = n; i >= 1; i--) {
    const st: MonthStatement = { ...newStatement(k0 - i, g.company.cash), lines: { acmiRevenue: revenue, fuel: -costs }, bh: 300, closed: true };
    g.finance.history.push(st);
  }
}

const line = (g: GameState, cat: keyof MonthStatement['lines']) => g.finance.current.lines[cat] ?? 0;
const fit = (g: GameState, oid: string) => feasibilityAll(g, oid).find((r) => r.level !== 'no')!.aircraftId;

/** A new Established game with a year of good statements and a credit line open. */
function withLine(cash = 3_000_000): GameState {
  const g = newGame();
  g.company.cash = cash;
  statements(g, 12, 1_200_000);
  expect(openCreditLine(g).ok).toBe(true);
  return g;
}

describe('the credit line', () => {
  it('needs two closed statements, is sized on revenue and the owned fleet, and costs an arrangement fee', () => {
    const g = newGame();
    expect(creditOpenWhy(g)).toMatch(/statements/);
    expect(openCreditLine(g).ok).toBe(false);
    statements(g, 6, 1_000_000);
    const limit = creditLimitFor(g);
    const owned = Object.values(g.fleet).reduce((s, a) => s + (a.ownership.kind === 'owned' ? a.ownership.bookValue : 0), 0);
    expect(limit).toBe(Math.max(F.credit.limit[0], Math.min(F.credit.limit[1], Math.round((1.5 * 1_000_000 + 0.1 * owned) / 100_000) * 100_000)));
    const cash = g.company.cash;
    expect(openCreditLine(g).ok).toBe(true);
    const fee = Math.max(F.credit.arrangementMin, Math.round(limit * F.credit.arrangementFee));
    expect(g.company.cash).toBe(cash - fee);
    expect(line(g, 'bankFees')).toBe(-fee);
    expect(g.treasury?.credit?.limit).toBe(limit);
    expect(g.treasury?.credit?.margin).toBe(F.credit.margin[1]);
    expect(openCreditLine(g).ok).toBe(false);
  });

  it('a Newcomer is capped at $1M', () => {
    const g = newGame(7, 'LIS', true);
    statements(g, 6, 5_000_000);
    expect(creditLimitFor(g)).toBe(F.credit.newcomerCap);
  });

  it('draws in $50K steps, accrues interest and the commitment fee daily, posts them at the month end and repays', () => {
    const g = withLine();
    const cash = g.company.cash;
    expect(drawCredit(g, 120_000).ok).toBe(true);
    expect(g.treasury!.credit!.drawn).toBe(100_000);
    expect(g.company.cash).toBe(cash + 100_000);
    expect(drawCredit(g, 10_000).ok).toBe(false);
    const rate = benchmarkRate(g) + g.treasury!.credit!.margin;
    for (let d = 0; d < 30; d++) dailyTreasury(g);
    const v = creditView(g)!;
    expect(v.rate).toBeCloseTo(rate, 6);
    expect(v.line.accrued).toBeCloseTo((100_000 * rate * 30) / 365, 2);
    expect(v.line.accruedFee).toBeCloseTo((v.undrawn * F.credit.commitmentFee * 30) / 365, 2);
    expect(v.lines.length).toBeGreaterThanOrEqual(4);
    monthlyTreasury(g, g.finance.current.month);
    expect(line(g, 'interest')).toBe(-Math.round((100_000 * rate * 30) / 365));
    expect(line(g, 'bankFees')).toBeLessThan(-Math.round((v.undrawn * F.credit.commitmentFee * 30) / 365) + 1);
    expect(g.treasury!.credit!.accrued).toBe(0);
    expect(g.treasury!.credit!.breaches).toBe(0);
    expect(repayCredit(g, 60_000).ok).toBe(true);
    expect(g.treasury!.credit!.drawn).toBe(40_000);
    expect(repayCredit(g, 1_000_000).ok).toBe(true);
    expect(g.treasury!.credit!.drawn).toBe(0);
    expect(repayCredit(g, 1).ok).toBe(false);
  });

  it('a breach costs the waiver fee and shows the red card; a second month steps the margin up; a third freezes the line and repays it in thirds', () => {
    const g = withLine(200_000);
    const t = g.treasury!;
    const cr = t.credit!;
    // Losses all year: EBITDA ≤ 0, so any net debt breaks the leverage covenant; cash under the bill breaks liquidity.
    g.finance.history = [];
    statements(g, 12, 100_000, 400_000);
    expect(ebitda12(g)).toBeLessThan(0);
    expect(drawCredit(g, cr.limit).ok).toBe(true);
    g.company.cash = 50_000;
    const cov = covenantCheck(g);
    expect(cov.liquidity).toBe(false);
    expect(cov.leverage).toBe(false);
    const margin = cr.margin;
    monthlyTreasury(g, g.finance.current.month);
    expect(cr.breaches).toBe(1);
    expect(line(g, 'bankFees')).toBeLessThanOrEqual(-Math.round(cr.limit * F.credit.waiverFee));
    const card = covenantBreachCard(g)!;
    expect(card.severity).toBe('red');
    expect(card.what).toMatch(/covenant/);
    expect(card.why.length).toBeGreaterThan(10);
    expect(card.actions[0].label).toBe('Finance');
    expect(g.messages.some((m) => m.problem?.kind === 'covenantBreach')).toBe(true);
    monthlyTreasury(g, g.finance.current.month + 1);
    expect(cr.breaches).toBe(2);
    expect(cr.stepUp).toBe(true);
    expect(cr.margin).toBeCloseTo(margin + F.credit.stepUp, 9);
    monthlyTreasury(g, g.finance.current.month + 2);
    expect(cr.breaches).toBe(3);
    expect(cr.frozen).toBeTruthy();
    expect(drawCredit(g, 50_000).ok).toBe(false);
    expect(cr.repay!.length).toBe(F.credit.repayParts);
    expect(cr.repay!.reduce((s, r) => s + r.amount, 0)).toBe(cr.drawn);
    // The thirds are swept at the next month ends, even below zero.
    const drawn = cr.drawn;
    const first = cr.repay![0];
    monthlyTreasury(g, monthKey(first.at) - 1);
    expect(cr.drawn).toBe(drawn - first.amount);
    expect(treasuryForecastItems(g, 120).some((x) => x.what === 'credit line repayments')).toBe(true);
    // Cured: cash in, debt gone → breaches reset; the step-up falls away after three clean months.
    g.company.cash = 10_000_000;
    cr.drawn = 0;
    cr.repay = [];
    for (let i = 0; i < F.credit.cleanMonths; i++) monthlyTreasury(g, g.finance.current.month + 4 + i);
    expect(cr.breaches).toBe(0);
    expect(cr.stepUp).toBe(false);
    expect(cr.margin).toBe(margin);
  });

  it('the headroom card shows when cash plus undrawn credit is under the month\'s bill', () => {
    const g = withLine(3_000_000);
    expect(creditHeadroomCard(g)).toBeNull();
    g.company.cash = 10_000;
    g.treasury!.credit!.drawn = g.treasury!.credit!.limit;
    const c = creditHeadroomCard(g)!;
    expect(c).not.toBeNull();
    expect(c.severity).toBe('amber');
    expect(c.what).toMatch(/headroom/);
  });

  it('the line survives a save round trip', () => {
    const g = withLine();
    drawCredit(g, 150_000);
    const back = deserialize(serialize(g));
    loadTreasury(back);
    expect(back.treasury?.credit?.drawn).toBe(150_000);
    expect(back.treasury?.credit?.clean).toBe(0);
  });
});

describe('loans secured on owned aircraft', () => {
  it('the annuity amortises the principal to zero within rounding', () => {
    const P = 3_000_000, rate = 0.075, n = 60;
    const a = annuity(P, rate, n);
    let bal = P;
    let interest = 0;
    for (let m = 0; m < n; m++) {
      const i = Math.round((bal * rate) / 12);
      interest += i;
      bal -= Math.min(bal, a - i);
    }
    expect(bal).toBe(0);
    expect(Math.abs(a * n - (P + interest))).toBeLessThan(n);
  });

  it('quotes 60 % of market value at bank rate + margin, only on owned aircraft young enough, and pays out less the fee', () => {
    const g = newGame();
    const ac = owned(g);
    ac.builtYear = yearOf(g.now) - 10;
    const q = loanQuote(g, ac.id, 5)!;
    expect(q.why).toBeNull();
    expect(loanTermsFor(g, { builtYear: yearOf(g.now) - 21 })).toEqual([3]);
    expect(loanTermsFor(g, { builtYear: yearOf(g.now) - 24 })).toEqual([]);
    expect(q.principal).toBe(Math.floor((q.value * F.loan.ltv) / 10_000) * 10_000);
    expect(q.rate).toBeCloseTo(benchmarkRate(g) + F.loan.margin, 6);
    expect(q.instalment).toBe(annuity(q.principal, q.rate, 60));
    expect(q.terms).toEqual(loanTermsFor(g, ac));
    const leasedAc = Object.values(g.fleet).find((a) => a.ownership.kind === 'dryLeaseIn')!;
    expect(loanQuote(g, leasedAc.id, 5)!.why).toMatch(/own/);
    const cash = g.company.cash;
    expect(takeLoan(g, ac.id, 5).ok).toBe(true);
    expect(g.company.cash).toBe(cash + q.principal - q.fee);
    expect(line(g, 'bankFees')).toBe(-q.fee);
    const l = loanOn(g, ac.id)!;
    expect(l.balance).toBe(q.principal);
    expect(l.nextDue).toBe(nextMonthStart(g.now));
    expect(loanQuote(g, ac.id, 5)!.why).toMatch(/already/);
    // The sale quote names the loan and clears it from the proceeds.
    const sq = saleQuote(g, ac.id);
    expect(sq.loan?.balance).toBe(q.principal);
    // The forecast carries the instalments.
    const items = treasuryForecastItems(g, 70);
    expect(items.filter((x) => x.what === 'loan instalments').length).toBeGreaterThanOrEqual(2);
    expect(forecastItems(g, 70).some((x) => x.what === 'loan instalments')).toBe(true);
  });

  it('takes the instalment at the month end: interest on the statement, principal off the balance; early repayment costs 2 %', () => {
    const g = newGame();
    const ac = owned(g);
    expect(takeLoan(g, ac.id, 3).ok).toBe(true);
    const l = loanOn(g, ac.id)!;
    const cash = g.company.cash;
    const interest = Math.round((l.balance * l.rate) / 12);
    monthlyTreasury(g, g.finance.current.month);
    expect(l.paid).toBe(1);
    expect(l.balance).toBe(l.principal - (l.instalment - interest));
    expect(line(g, 'interest')).toBe(-interest);
    expect(g.company.cash).toBe(cash - l.instalment);
    expect(l.missed.length).toBe(0);
    const fee = Math.round(l.balance * F.loan.earlyFee);
    g.company.cash = 100;
    expect(repayLoan(g, l.id).ok).toBe(false);
    g.company.cash = l.balance + fee + 1_000;
    expect(repayLoan(g, l.id).ok).toBe(true);
    expect(g.company.cash).toBe(1_000);
    expect(loanOn(g, ac.id)).toBeUndefined();
    expect(g.treasury!.repaid).toBe(1);
  });

  it('a short month is still taken with a late fee; two misses in a year and the bank calls the loan, then takes it on the day', () => {
    const g = newGame();
    const ac = owned(g);
    ac.builtYear = yearOf(g.now) - 10;
    expect(takeLoan(g, ac.id, 5).ok).toBe(true);
    const l = loanOn(g, ac.id)!;
    g.company.cash = 0;
    monthlyTreasury(g, g.finance.current.month);
    expect(l.missed.length).toBe(1);
    expect(l.calledAt).toBeUndefined();
    expect(line(g, 'bankFees')).toBeLessThan(-Math.round(l.principal * F.loan.arrangementFee));
    g.company.cash = 0;
    monthlyTreasury(g, g.finance.current.month + 1);
    expect(l.missed.length).toBe(2);
    expect(l.calledAt).toBe(g.now);
    expect(l.calledDue).toBe(g.now + F.loan.callDays * DAY);
    const card = loanDueCard(g, l.id);
    expect(card).toBeNull(); // more than 7 days away
    g.now = l.calledDue! - 2 * DAY;
    const c2 = loanDueCard(g, l.id)!;
    expect(c2.severity).toBe('red');
    expect(c2.what).toMatch(/takes/);
    const bal = l.balance;
    g.now = l.calledDue!;
    const before = g.company.cash;
    dailyTreasury(g);
    expect(g.company.cash).toBe(before - bal);
    expect(g.treasury!.loans.length).toBe(0);
  });

  it('the loanDue card comes when the forecast cannot pay the next instalment', () => {
    const g = newGame();
    const ac = owned(g);
    ac.builtYear = yearOf(g.now) - 10;
    expect(takeLoan(g, ac.id, 5).ok).toBe(true);
    const l = loanOn(g, ac.id)!;
    g.now = l.nextDue - 3 * DAY;
    g.company.cash = 2_000_000;
    expect(loanDueCard(g, l.id)).toBeNull();
    g.company.cash = 1_000;
    const c = loanDueCard(g, l.id)!;
    expect(c).not.toBeNull();
    expect(c.hurt.money).toBe(l.instalment);
    expect(c.actions.map((a) => a.label)).toContain('Finance');
  });
});

describe('sale and leaseback', () => {
  it('sells at 97 % of market value to a real lessor and keeps the aircraft as a lease with rent from today', () => {
    const g = newGame();
    const ac = owned(g);
    ac.ownership = { kind: 'owned', bookValue: 20_000_000 };
    ac.builtYear = yearOf(g.now) - 10;
    const q = leasebackQuote(g, ac.id, 6)!;
    expect(q.why).toBeNull();
    expect(F.leaseback.lessors).toContain(q.lessor);
    expect(q.price % 10_000).toBe(0);
    expect(q.rentPerMonth).toBe(Math.round((q.price * q.lrf) / 1000) * 1000);
    expect(q.lrf).toBeGreaterThanOrEqual(F.leaseback.lrf.clamp[0]);
    expect(q.lrf).toBeLessThanOrEqual(F.leaseback.lrf.clamp[1]);
    expect(q.deposit).toBe(2 * q.rentPerMonth);
    expect(q.gain).toBe(q.price - 20_000_000);
    const cash = g.company.cash;
    const reg = ac.reg;
    const k = g.finance.current.month;
    const rentBefore = fixedCosts(g, k).rent;
    expect(sellAndLeaseBack(g, ac.id, 6).ok).toBe(true);
    expect(g.company.cash).toBe(cash + q.price - q.deposit);
    expect(line(g, 'assetSale')).toBe(q.price - 20_000_000);
    const own = g.fleet[ac.id].ownership;
    expect(own.kind).toBe('dryLeaseIn');
    if (own.kind !== 'dryLeaseIn') return;
    expect(own.leaseback).toBe(true);
    expect(own.lessor).toBe(q.lessor);
    expect(own.rentPerMonth).toBe(q.rentPerMonth);
    expect(own.deposit).toBe(q.deposit);
    expect(own.returnSite).toBe(g.company.homeBase);
    expect(g.fleet[ac.id].reg).toBe(reg);
    // This month's rent runs from today, not from the month's start.
    const share = (nextMonthStart(g.now) - g.now) / (nextMonthStart(g.now) - monthStart(k));
    const rent = fixedCosts(g, k).rent - rentBefore;
    expect(rent).toBeLessThanOrEqual(q.rentPerMonth);
    expect(rent).toBeGreaterThan(0);
    expect(Math.abs(rent - q.rentPerMonth * share)).toBeLessThan(q.rentPerMonth * 0.6);
    expect(leasebackQuote(g, ac.id, 6)!.why).toMatch(/own/);
    expect(g.stats.v016?.leasebacks).toBe(1);
  });

  it('clears a loan on the aircraft from the price', () => {
    const g = newGame();
    const ac = owned(g);
    ac.builtYear = yearOf(g.now) - 8;
    expect(takeLoan(g, ac.id, 5).ok).toBe(true);
    const l = loanOn(g, ac.id)!;
    const q = leasebackQuote(g, ac.id, 8)!;
    expect(q.loanRepaid).toBe(l.balance + Math.round(l.balance * F.loan.earlyFee));
    const cash = g.company.cash;
    expect(sellAndLeaseBack(g, ac.id, 8).ok).toBe(true);
    expect(loanOn(g, ac.id)).toBeUndefined();
    expect(g.company.cash).toBe(cash + q.cashIn);
  });
});

describe('invoice factoring', () => {
  const someClient = (g: GameState) => Object.values(g.clients).find((c) => c.kind !== 'government')!;

  it('advances 95 % with recourse less a fee by days to due; the balance comes when the client pays', () => {
    const g = newGame();
    const r = invoice(g, { clientId: someClient(g).id, contractId: null, desc: 'test invoice', amount: 200_000, cat: 'charterRevenue', dueDays: 30 });
    const q = factorQuote(g, r.id, true)!;
    expect(q.why).toBeNull();
    expect(q.advance).toBe(190_000);
    expect(q.feePct).toBeCloseTo(F.factoring.feeBase + F.factoring.feePerDay * 30, 6);
    expect(q.balance).toBe(200_000 - q.advance);
    expect(q.now).toBe(q.advance - q.fee);
    const nr = factorQuote(g, r.id, false)!;
    expect(nr.advance).toBe(184_000);
    expect(nr.feePct).toBeCloseTo(q.feePct + F.factoring.nonRecourse, 6);
    const cash = g.company.cash;
    expect(factorInvoice(g, r.id, true).ok).toBe(true);
    expect(g.company.cash).toBe(cash + q.advance - q.fee);
    expect(line(g, 'bankFees')).toBe(-q.fee);
    expect(r.factor?.recourse).toBe(true);
    expect(g.treasury!.factored).toContain(r.id);
    expect(factorQuote(g, r.id, true)!.why).toMatch(/Already/);
    // The forecast expects only the balance.
    expect(forecastItems(g, 90).filter((x) => x.what === 'invoices paid').reduce((s, x) => s + x.amount, 0)).toBe(q.balance);
    r.payAt = g.now;
    onPayment(g, { type: 'payment', id: r.id, t: g.now } as never);
    expect(r.paid).toBe(g.now);
    expect(g.company.cash).toBe(cash - q.fee + r.amount);
    expect(r.factor?.settled).toBe(g.now);
    expect(g.treasury!.factored).not.toContain(r.id);
  });

  it('refuses small, far-off or long-overdue invoices', () => {
    const g = newGame();
    const c = someClient(g).id;
    const small = invoice(g, { clientId: c, contractId: null, desc: 'small', amount: 10_000, cat: 'charterRevenue', dueDays: 10 });
    expect(factorQuote(g, small.id, true)!.why).toMatch(/minimum/);
    const far = invoice(g, { clientId: c, contractId: null, desc: 'far', amount: 100_000, cat: 'charterRevenue', dueDays: 120 });
    expect(factorQuote(g, far.id, true)!.why).toMatch(/within/);
    const old = invoice(g, { clientId: c, contractId: null, desc: 'old', amount: 100_000, cat: 'charterRevenue', dueDays: 1 });
    g.now += 40 * DAY;
    expect(factorQuote(g, old.id, true)!.why).toMatch(/overdue/);
  });

  it('with recourse the bank hands an unpaid invoice back at 90 days past due and takes its advance; the card warns from 60', () => {
    const g = newGame();
    const r = invoice(g, { clientId: someClient(g).id, contractId: null, desc: 'slow', amount: 100_000, cat: 'charterRevenue', dueDays: 10 });
    factorInvoice(g, r.id, true);
    const adv = r.factor!.advance;
    g.now = r.due + 61 * DAY;
    expect(factorRecourseCard(g, r.id)).not.toBeNull();
    dailyTreasury(g);
    expect(g.messages.some((m) => m.problem?.kind === 'factorRecourse')).toBe(true);
    expect(r.factor!.boughtBack).toBeUndefined();
    const cash = g.company.cash;
    g.now = r.due + F.factoring.buyBackDays * DAY;
    dailyTreasury(g);
    expect(r.factor!.boughtBack).toBe(g.now);
    expect(r.factored).toBe(false);
    expect(g.company.cash).toBe(cash - adv);
    expect(g.treasury!.factored).not.toContain(r.id);
    // Paid later anyway: the whole amount is ours again.
    r.payAt = g.now;
    onPayment(g, { type: 'payment', id: r.id, t: g.now } as never);
    expect(g.company.cash).toBe(cash - adv + r.amount);
  });

  it('without recourse a written-off invoice is the bank\'s loss', () => {
    const g = newGame();
    const r = invoice(g, { clientId: someClient(g).id, contractId: null, desc: 'gone', amount: 100_000, cat: 'charterRevenue', dueDays: 10 });
    factorInvoice(g, r.id, false);
    const cash = g.company.cash;
    r.written = true;
    dailyTreasury(g);
    expect(r.factor!.settled).toBe(g.now);
    expect(g.company.cash).toBe(cash);
  });

  it('the late-payment decision\'s "sell the invoice" goes through the bank when the invoice is eligible', () => {
    const g = newGame();
    const r = invoice(g, { clientId: someClient(g).id, contractId: null, desc: 'late', amount: 100_000, cat: 'charterRevenue', dueDays: 1 });
    g.now = r.due + 10 * DAY;
    latePaymentDecision(g, r);
    const d = g.decisions.find((x) => x.kind === 'latePayment' && x.data?.receivableId === r.id)!;
    const fq = factorQuote(g, r.id, true)!;
    expect(d.options.find((o) => o.id === 'factor')!.chips![0]).toBe(`+$${Math.round(fq.now / 1000)}K now`);
    expect(resolveDecision(g, d.id, 'factor').ok).toBe(true);
    expect(r.factor?.recourse).toBe(true);
    expect(r.paid).toBeNull();
  });
});

describe('client deposits', () => {
  it('norms by client kind, lower for a level 3–4 client, none for a government', () => {
    const g = newGame();
    const by = (kind: string) => Object.values(g.clients).find((c) => c.kind === kind);
    const to = by('tourOperator');
    if (to) expect(depositNorm(g, to.id)).toBe(0.2);
    const gov = by('government');
    if (gov) expect(depositNorm(g, gov.id)).toBe(0);
    const al = by('airline');
    if (al) {
      const was = al.prestige;
      al.prestige = 2;
      expect(depositNorm(g, al.id)).toBe(0.2);
      al.prestige = 4;
      expect(depositNorm(g, al.id)).toBe(0.1);
      al.prestige = was;
    }
  });

  it('above the norm the client accepts less often; below it more, and its floor eases', () => {
    const g = newGame();
    const o = offer(g, 'adhoc');
    expect(o.product.kind).toBe('charter');
    const norm = depositNorm(g, o.clientId);
    const up = depositEffect(g, o.id, Math.min(0.5, norm + 0.2));
    expect(up.acceptDelta).toBeCloseTo(F.deposit.abovePer10 * 2, 9);
    expect(up.text).toMatch(/Lower chance/);
    const same = depositEffect(g, o.id, norm);
    expect(same.acceptDelta).toBe(0);
    if (norm >= 0.1) {
      const down = depositEffect(g, o.id, norm - 0.1);
      expect(down.acceptDelta).toBeCloseTo(F.deposit.belowPer10, 9);
      expect(down.floorDelta).toBeCloseTo(F.deposit.belowFloorPer10, 9);
      expect(down.text).toMatch(/Better chance/);
    }
    const base = counterOdds({ urgency: 'normal', floor: 1.1 }, 1.05);
    const harder = counterOdds({ urgency: 'normal', floor: 1.1, depositAsk: { pct: 0.5, acceptDelta: -0.12, floorDelta: 0 } }, 1.05);
    const easier = counterOdds({ urgency: 'normal', floor: 1.1, depositAsk: { pct: 0.1, acceptDelta: 0.04, floorDelta: 0.005 } }, 1.05);
    expect(harder.accept).toBeCloseTo(base.accept - 0.12, 9);
    expect(easier.accept).toBeGreaterThan(base.accept);
    expect(harder.accept + harder.halfway + harder.refuse).toBeCloseTo(1, 9);
  });

  it('a plain accept signs with the deposit asked (or the norm when the client insists); a counter carries it to the reply', () => {
    const g = newGame();
    const o = offer(g, 'adhoc');
    const norm = depositNorm(g, o.clientId);
    const id = fit(g, o.id);
    const res = acceptOffer(g, o.id, [id], { depositPct: norm });
    expect(res.ok).toBe(true);
    const c = g.contracts[res.data!.contractId];
    expect(c.product.kind === 'charter' && c.product.depositPct).toBe(norm);
    if (norm > 0) {
      const dep = g.finance.receivables.find((r) => r.contractId === c.id && /Deposit/.test(r.desc))!;
      expect(dep.desc).toMatch(`${Math.round(norm * 100)}%`);
    }
    // Far above the norm: the client signs at the norm sometimes, never above what we asked.
    const o2 = offer(g, 'adhoc');
    const signed = depositSigned(g, o2, 0.5);
    expect([0.5, depositNorm(g, o2.clientId)]).toContain(signed);
    expect(depositSigned(g, o2, depositNorm(g, o2.clientId))).toBe(depositNorm(g, o2.clientId));
    // A counter stores the ask and its effect on the offer.
    const o3 = offer(g, 'adhoc');
    const id3 = fit(g, o3.id);
    const price = o3.product.kind === 'charter' ? o3.product.price * 1.05 : 0;
    expect(counterOffer(g, o3.id, price, [id3], { depositPct: 0.4 }).ok).toBe(true);
    expect(o3.depositAsk?.pct).toBe(0.4);
    expect(o3.depositAsk!.acceptDelta).toBeLessThanOrEqual(0);
  });
});

describe('spare cash and the forecast', () => {
  it('cash above the float earns interest daily, posted at the month end as interest on cash', () => {
    const g = newGame();
    g.company.cash = 3_250_000;
    expect(moneyMarketBalance(g)).toBe(3_000_000);
    dailyTreasury(g);
    const rate = Math.max(F.moneyMarket.floor, benchmarkRate(g) - F.moneyMarket.spread);
    expect(treasury(g).mmAccrued).toBeCloseTo((3_000_000 * rate) / 365, 4);
    expect(treasuryForecastItems(g, 40).some((x) => x.what === 'interest on cash' && x.amount > 0)).toBe(true);
    monthlyTreasury(g, g.finance.current.month);
    expect(line(g, 'interestIncome')).toBe(Math.round((3_000_000 * rate) / 365));
    expect(treasury(g).mmAccrued).toBe(0);
    g.company.cash = 200_000;
    dailyTreasury(g);
    expect(treasury(g).mmAccrued).toBe(0);
  });

  it('a save without a finance record loads with the defaults and plays on', () => {
    const g = newGame();
    delete g.treasury;
    loadTreasury(g);
    expect(g.treasury).toEqual({ loans: [], mmAccrued: 0, factored: [], stats: { interest: 0, fees: 0, factored: 0, leasebacks: 0, loans: 0, drawnMax: 0 } });
    dailyTreasury(g);
    monthlyTreasury(g, g.finance.current.month);
    expect(treasuryForecastItems(g, 30)).toEqual([]);
    expect(creditView(g)).toBeNull();
  });
});
