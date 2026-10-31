// Statements, receivables, solvency and the cash forecast (B3). DESIGN.md §5.7, BUILD-PLAN B3 acceptance.

import { dailyFinance, forecastItems, headsBill, insuranceOf, monthEndBill, settleDeparture } from './finance';
import { bookRefit } from './cabin';
import { cashLowCard } from '../problems/money';
import { describe, expect, it, onTestFinished } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { COST_CATS, invoice, REVENUE_CATS, statementTotals } from '../core/ledger';
import { LEDGER_LABEL } from '../../ui/screens/screenLogic';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, daysInMonth, fromUTC, monthKey, monthStart } from '../core/time';
import type { Client, Contract, Flight, GameState, LedgerCat, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { mghInMonth } from '../contracts/pricing';
import { addAircraft, hamBase, leased, legsOffer, newGame, owned, run } from '../contracts/testkit';
import { salaryBill } from '../crew';
import { advanceTo } from '../sim';
import { cashForecast, fixedCosts, resolveDecision } from '.';
import { legCostEstimate, paysFuel, subcharterCost, subcharterLegs } from './flights';

/** Advances with no auto-pause honoured (decisions expire into their defaults). */
const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());
/** Statement line summed over every month so far. */
const line = (g: GameState, cat: LedgerCat) => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);
const government = (g: GameState): Client => Object.values(g.clients).find((c) => c.kind === 'government')!;

function signBase(g: GameState, start: Minute, days: number, ids: string[]): Contract {
  const o = hamBase(g, start, days);
  o.broker = undefined;
  const res = acceptOffer(g, o.id, ids);
  if (!res.ok) throw new Error(res.error);
  return g.contracts[res.data!.contractId];
}

/** Runs until a rescue decision is open (other decisions are left to expire). */
function untilRescue(g: GameState, days: number) {
  const until = g.now + days * DAY;
  while (g.now < until && !g.gameOver && !g.decisions.some((d) => d.kind === 'rescue')) advanceTo(g, until, new Set(['decision']));
  const d = g.decisions.find((d) => d.kind === 'rescue');
  if (!d) throw new Error('no rescue decision');
  return d;
}

describe('month end', () => {
  it('posts rent, insurance, overhead and salaries exactly once, closes the statement and opens the next', () => {
    const g = newGame(21);
    const k = monthKey(g.now);
    const fc = fixedCosts(g, k);
    const sal = salaryBill(g);
    const cash0 = g.company.cash;
    const own = leased(g).ownership;
    expect(fc.rent).toBe(own.kind === 'dryLeaseIn' ? own.rentPerMonth : 0);
    expect(fc.insurance).toBe(Object.values(g.fleet).reduce((t, a) => t + insuranceOf(g, a), 0));
    expect(fc.overhead).toBe(BAL.overheadBase + 2 * BAL.overheadPerAircraft);
    skip(g, g.now + 32 * DAY);
    expect(g.finance.history).toHaveLength(1);
    const st = g.finance.history[0];
    expect(st.month).toBe(k);
    expect(st.closed).toBe(true);
    expect(st.lines.rent).toBe(-fc.rent);
    expect(st.lines.insurance).toBe(-fc.insurance);
    expect(st.lines.overhead).toBe(-fc.overhead);
    expect(st.lines.salaries).toBe(-sal);
    // An idle month moves cash only through the ledger: cashEnd = cashStart + profit.
    const { profit } = statementTotals(st.lines);
    expect(st.cashStart).toBe(cash0);
    expect(st.cashEnd).toBe(cash0 + profit);
    expect(g.stats.bestMonthProfit).toBe(Math.max(0, profit));
    expect(g.finance.current.month).toBe(k + 1);
    expect(g.finance.current.closed).toBe(false);
    expect(g.finance.current.cashStart).toBe(st.cashEnd);
    expect(g.finance.current.lines.rent).toBeUndefined();
    expect(g.messages.filter((m) => m.cat === 'finance' && /statement$/.test(m.title))).toHaveLength(1);
  });

  it('an honoured monthEnd pause stops at the boundary and resuming never posts the fixed lines twice', () => {
    const g = newGame(36);
    const k = monthKey(g.now);
    const fc = fixedCosts(g, k);
    const r = advanceTo(g, g.now + 40 * DAY, new Set(['monthEnd']));
    expect(r.pause).toBe('monthEnd');
    expect(g.now).toBe(monthStart(k + 1));
    expect(g.finance.history).toHaveLength(1);
    expect(g.finance.current.month).toBe(k + 1);
    skip(g, g.now + 5 * DAY);
    expect(g.finance.history).toHaveLength(1);
    expect(g.finance.history[0].lines.rent).toBe(-fc.rent);
    expect(g.finance.history[0].lines.overhead).toBe(-fc.overhead);
    expect(g.finance.current.lines.rent).toBeUndefined();
    expect(g.finance.current.lines.insurance).toBeUndefined();
    expect(g.finance.current.lines.overhead).toBeUndefined();
    expect(g.finance.current.lines.salaries).toBeUndefined();
    expect(g.messages.filter((m) => m.cat === 'finance' && /statement$/.test(m.title))).toHaveLength(1);
  });

  it('pro-rates insurance, overhead and rent to the days on the AOC', () => {
    const g = newGame(22);
    const k = monthKey(g.now);
    const days = (monthStart(k + 1) - monthStart(k)) / DAY;
    const base = fixedCosts(g, k);
    const ac = addAircraft(g, 'a320ceo');
    ac.deliveredAt = monthStart(k) + 15 * DAY;
    const share = (days - 15) / days;
    const fc = fixedCosts(g, k);
    expect(fc.rent).toBe(base.rent);
    expect(fc.insurance).toBe(Math.round(base.insurance + insuranceOf(g, ac) * share));
    expect(fc.overhead).toBe(Math.round(BAL.overheadBase + BAL.overheadPerAircraft * (2 + share)));
    // A lease ending on the 10th pays a third of the rent.
    const l = leased(g);
    if (l.ownership.kind !== 'dryLeaseIn') throw new Error('leased');
    const leaseEnd = l.ownership.leaseEnd;
    l.ownership.leaseEnd = monthStart(k) + 10 * DAY;
    expect(fixedCosts(g, k).rent).toBe(Math.round((l.ownership.rentPerMonth * 10) / days));
    expect(fixedCosts(g, k).insurance).toBe(Math.round(insuranceOf(g, owned(g)) + insuranceOf(g, l) * (10 / days) + insuranceOf(g, ac) * share));
    l.ownership.leaseEnd = leaseEnd;
    // Not delivered until the month after next: nothing.
    ac.deliveredAt = monthStart(k + 2);
    expect(fixedCosts(g, k)).toEqual(base);
  });

  it('a lease returned mid-month pays its days once, at return, and month end does not count it again', () => {
    const g = newGame(37);
    const k = monthKey(g.now);
    const days = (monthStart(k + 1) - monthStart(k)) / DAY;
    const l = leased(g);
    if (l.ownership.kind !== 'dryLeaseIn') throw new Error('leased');
    const rent = l.ownership.rentPerMonth;
    const end = Math.min(g.now + 10 * DAY, monthStart(k + 1) - DAY);
    l.ownership.leaseEnd = end;
    // A lease with no return conditions (handed back at the lease end; v0.12.1 one with them rolls on instead).
    delete l.ownership.returnSite;
    schedule(g, end, 'lease.end', l.id);
    const share = (end - Math.max(monthStart(k), l.deliveredAt)) / (days * DAY);
    const fc = fixedCosts(g, k); // still counts the leased aircraft, pro-rated to its last day
    expect(fc.rent).toBe(Math.round(rent * share));
    skip(g, end + 60);
    expect(g.fleet[l.id]).toBeUndefined();
    expect(g.messages.some((m) => m.title === `${l.reg} returned`)).toBe(true);
    expect(g.finance.current.lines.rent).toBe(-Math.round(rent * share));
    expect(g.finance.current.lines.insurance).toBe(-Math.round(insuranceOf(g, l) * share));
    skip(g, monthStart(k + 1) + DAY);
    const st = g.finance.history[0];
    expect(st.month).toBe(k);
    expect(st.lines.rent).toBe(-fc.rent);
    // Same totals as if month end had seen it (each part rounded on its own: ±$2).
    expect(Math.abs(st.lines.insurance! + fc.insurance)).toBeLessThanOrEqual(2);
    expect(Math.abs(st.lines.overhead! + fc.overhead)).toBeLessThanOrEqual(2);
    // The month after: only the owned aircraft.
    expect(fixedCosts(g, k + 1)).toEqual({ rent: 0, insurance: insuranceOf(g, owned(g)), overhead: BAL.overheadBase + BAL.overheadPerAircraft });
  });
});

describe('who pays fuel', () => {
  it('we pay on charter, ferry and non-billable positioning legs; the wet-lease client pays the rest', () => {
    const g = newGame(38);
    const c = signBase(g, g.now + 5 * DAY, 30, [leased(g).id]);
    if (c.product.kind !== 'wet') throw new Error('wet');
    const leg = (kind: Flight['kind'], contractId: string | null) => ({ kind, contractId }) as Flight;
    expect(paysFuel(g, leg('ferry', null))).toBe(true);
    expect(paysFuel(g, leg('ferry', c.id))).toBe(true);
    expect(paysFuel(g, leg('positioning', null))).toBe(true);
    c.product.positioningBillable = true;
    for (const k of ['revenue', 'positioning', 'techstop'] as const) expect(paysFuel(g, leg(k, c.id))).toBe(false);
    c.product.positioningBillable = false;
    expect(paysFuel(g, leg('positioning', c.id))).toBe(true);
    expect(paysFuel(g, leg('revenue', c.id))).toBe(false);
    const ch = { ...c, id: 'ch', product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } } as Contract;
    g.contracts[ch.id] = ch;
    for (const k of ['revenue', 'positioning', 'techstop'] as const) expect(paysFuel(g, leg(k, ch.id))).toBe(true);
  });

  it('a non-billable positioning leg into a wet lease posts fuel and fees without catering', () => {
    const g = newGame(39);
    const ac = leased(g);
    const c = signBase(g, g.now + 3 * DAY, 30, [ac.id]);
    if (c.product.kind !== 'wet') throw new Error('wet');
    c.product.positioningBillable = false;
    const first = flightsOf(g, ac.id).find((f) => f.contractId === c.id && f.kind === 'revenue')!;
    run(g, first.sta + 60);
    const pos = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'positioning' && f.status === 'done');
    expect(pos.length).toBeGreaterThanOrEqual(1);
    expect(line(g, 'fuel')).toBeLessThan(0);
    expect(line(g, 'airportFees')).toBe(-pos.length * BAL.airportFees[0]);
  });
});

describe('receivables', () => {
  it('government invoices mostly pay late, and each late payment is reported', () => {
    const g = newGame(23);
    g.company.cash = 50_000_000;
    const gov = government(g);
    expect(gov.payReliability).toBeLessThan(0.5);
    const ids = Array.from({ length: 20 }, (_, i) => invoice(g, { clientId: gov.id, contractId: null, desc: `Airlift ${i}`, amount: 100_000, cat: 'otherRevenue', dueDays: 30 }).id);
    expect(g.finance.current.lines.otherRevenue).toBe(2_000_000);
    const cash = g.company.cash;
    skip(g, g.now + 130 * DAY);
    const recs = g.finance.receivables.filter((r) => ids.includes(r.id));
    expect(recs).toHaveLength(20);
    expect(recs.every((r) => r.paid !== null && r.paid === r.payAt && r.payAt >= r.due)).toBe(true);
    const late = recs.filter((r) => (r.paid! - r.due) / DAY > BAL.graceDays);
    expect(late.length).toBeGreaterThanOrEqual(10);
    expect(g.messages.length).toBeLessThan(300);
    const told = g.messages.filter((m) => m.cat === 'finance' && /^.+ paid \d+ days late$/.test(m.title) && m.title.startsWith(gov.name));
    expect(told).toHaveLength(late.length);
    // Collections never touch the statement again (accrued at issue): cash moved by exactly the posted lines plus the 2M collected.
    expect(line(g, 'otherRevenue')).toBe(2_000_000);
    const posted = [g.finance.current, ...g.finance.history].reduce((s, st) => s + statementTotals(st.lines).profit, 0);
    expect(g.company.cash - cash).toBe(posted);
  });

  it('reminds at +7, asks at +30, and the options wait / factor / threaten work', () => {
    const g = newGame(24);
    g.company.cash = 50_000_000;
    const gov = government(g);
    const mk = (desc: string) => {
      const r = invoice(g, { clientId: gov.id, contractId: null, desc, amount: 200_000, cat: 'otherRevenue', dueDays: 10 });
      r.payAt = r.due + 90 * DAY; // the payment queued at the rolled date is ignored (now < payAt)
      schedule(g, r.payAt, 'payment', r.id);
      return r;
    };
    const a = mk('Airlift A');
    const b = mk('Airlift B');
    skip(g, a.due + 8 * DAY);
    expect(a.nudged).toBe(7);
    expect(a.paid).toBeNull();
    // v0.12.1 one reminder per client and day: both invoices in one note.
    const reminders = g.messages.filter((m) => m.title === `Invoice overdue: ${gov.name}`);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toMatch(/^2 invoices, \$400K, a week or more past due\. Reminder sent/);
    skip(g, a.due + 30 * DAY + 60);
    expect(a.nudged).toBe(30);
    const dA = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === a.id)!;
    const dB = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === b.id)!;
    expect(dA && dB).toBeTruthy();
    expect(dA.options.map((o) => o.id)).toEqual(['wait', 'waive', 'factor', 'threaten']);
    expect(dA.defaultOption).toBe('wait');
    // Factor: cash now less 8%, booked as interest; the receivable is settled.
    const cash = g.company.cash;
    expect(resolveDecision(g, dA.id, 'factor').ok).toBe(true);
    const fee = Math.round(a.amount * BAL.factorDiscount);
    expect(a.factored).toBe(true);
    expect(a.paid).toBe(g.now);
    expect(g.company.cash).toBe(cash + a.amount - fee);
    expect(g.finance.current.lines.interest).toBe(-fee);
    expect(g.decisions.some((d) => d.id === dA.id)).toBe(false);
    // Threaten: relation −20; 70% of the time the date is pulled in to within a week.
    const rel = gov.relation;
    const payAt0 = b.payAt;
    expect(resolveDecision(g, dB.id, 'threaten').ok).toBe(true);
    expect(gov.relation).toBe(rel - 20);
    expect(b.payAt).toBeLessThanOrEqual(payAt0);
    if (b.payAt < payAt0) {
      expect(b.payAt).toBeLessThanOrEqual(g.now + 7 * DAY);
      skip(g, b.payAt + 60);
      expect(b.paid).toBe(b.payAt);
    }
    // Wait: nothing changes and the client pays on its own date.
    const c = mk('Airlift C');
    skip(g, c.due + 31 * DAY); // due mid-day: the +30 check runs at the next midnight
    const dC = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === c.id)!;
    expect(dC).toBeTruthy();
    expect(resolveDecision(g, dC.id, 'wait').ok).toBe(true);
    expect(g.decisions.some((d) => d.id === dC.id)).toBe(false);
    expect(c.paid).toBeNull();
    skip(g, c.payAt + 60);
    expect(c.paid).toBe(c.payAt);
    expect(g.messages.some((m) => m.title === `${gov.name} paid 90 days late`)).toBe(true);
    // Factored invoices are never paid twice.
    expect(line(g, 'otherRevenue')).toBe(600_000);
  });
});

describe('v0.9 round 4: one cash problem at a time', () => {
  it('the day cash crosses zero: the red cash-below-zero card and no fortnightly low-cash warning beside it', () => {
    const g = newGame(27);
    g.company.cash = -120_000;
    g.finance.lowCashAt = undefined;
    dailyFinance(g);
    expect(g.finance.negSince).toBe(g.now);
    expect(g.messages.filter((m) => /^Cash is below zero/.test(m.title))).toHaveLength(1);
    expect(g.messages.some((m) => /^Cash runs out/.test(m.title) || m.title === 'Cash is running out')).toBe(false);
    // Still negative a day later: no low-cash warning either (the red card stands).
    skip(g, g.now + DAY + 60);
    expect(g.messages.some((m) => /^Cash runs out/.test(m.title) || m.title === 'Cash is running out')).toBe(false);
  });
});

describe('solvency', () => {
  it('offers a rescue after 30 days below zero; accepting restores cash; a second insolvency ends the game', () => {
    const g = newGame(25);
    g.company.cash = -50_000;
    const d = untilRescue(g, 40);
    expect(g.now - g.started).toBeGreaterThanOrEqual(BAL.rescueDays * DAY);
    expect(g.now - g.started).toBeLessThan((BAL.rescueDays + 2) * DAY);
    const amount = Number(d.data!.amount);
    expect(amount).toBeGreaterThanOrEqual(BAL.rescueCash[0]);
    expect(amount).toBeLessThanOrEqual(BAL.rescueCash[1]);
    expect(d.defaultOption).toBe('accept');
    const cash = g.company.cash;
    const rep = g.company.reputation.reliable;
    expect(resolveDecision(g, d.id, 'accept').ok).toBe(true);
    expect(g.company.cash).toBe(cash + amount);
    expect(g.finance.rescues).toBe(1);
    expect(g.finance.negSince).toBeNull();
    expect(g.company.reputation.reliable).toBe(rep - 5);
    expect(g.gameOver).toBeNull();
    // Insolvent again after the rescue: no second investor.
    g.company.cash = -1_000;
    skip(g, g.now + 40 * DAY);
    expect(g.gameOver?.reason).toMatch(/Insolvent again/);
    expect(g.messages[0].title).toBe('The company has failed');
  });

  it('refusing: no second offer while still negative, forgotten after a recovery, game over below the floor', () => {
    const g = newGame(26);
    g.company.cash = -10_000;
    const d = untilRescue(g, 40);
    const cash = g.company.cash;
    expect(resolveDecision(g, d.id, 'refuse').ok).toBe(true);
    expect(g.company.cash).toBe(cash);
    expect(g.finance.refusedRescue).toBe(true);
    expect(g.finance.rescues ?? 0).toBe(0);
    skip(g, g.now + 20 * DAY);
    expect(g.company.cash).toBeLessThan(0);
    expect(g.company.cash).toBeGreaterThan(BAL.bankruptFloor);
    expect(g.gameOver).toBeNull();
    expect(g.decisions.some((x) => x.kind === 'rescue')).toBe(false);
    // Recovered on our own: the refusal is forgotten and a later insolvency gets a fresh offer.
    g.company.cash = 1_500_000;
    skip(g, g.now + 2 * DAY);
    expect(g.finance.negSince).toBeNull();
    expect(g.finance.refusedRescue).toBe(false);
    g.company.cash = -10_000;
    const d2 = untilRescue(g, 40);
    expect(resolveDecision(g, d2.id, 'refuse').ok).toBe(true);
    g.company.cash = BAL.bankruptFloor - 1;
    skip(g, g.now + 2 * DAY);
    expect(g.gameOver?.reason).toMatch(/rescue was refused/);
  });
});

describe('cashForecast', () => {
  it('is pure and books salaries and fixed costs at the next month start', () => {
    const g = newGame(27);
    skip(g, g.now + 3 * DAY);
    const before = JSON.stringify(g);
    const a = cashForecast(g, 60);
    expect(cashForecast(g, 60)).toEqual(a);
    expect(JSON.stringify(g)).toBe(before);
    expect(a).toHaveLength(61);
    expect(a[0]).toEqual({ t: g.now, cash: g.company.cash });
    const k = monthKey(g.now);
    const fc = fixedCosts(g, k);
    const d = Math.floor((monthStart(k + 1) - g.now) / DAY);
    const checks = Object.values(g.maintenance).filter((m) => m.status === 'planned' && Math.floor((m.end - g.now) / DAY) === d).reduce((s, m) => s + m.cost, 0);
    expect(a[d - 1].cash - a[d].cash).toBe(fc.rent + fc.insurance + fc.overhead + salaryBill(g) + checks);
    expect(a[60].cash).toBeLessThan(a[0].cash - 2 * (fc.rent + fc.insurance + fc.overhead));
  });

  it('counts open receivables at their due date and a wet programme at MGH', () => {
    const g = newGame(28);
    skip(g, g.now + DAY);
    const idle = cashForecast(g, 90);
    const r = invoice(g, { clientId: government(g).id, contractId: null, desc: 'Airlift', amount: 300_000, cat: 'otherRevenue', dueDays: 20 });
    const withInv = cashForecast(g, 90);
    // A slow payer (government) is expected at the midpoint of its usual lateness after the due date.
    const cl = government(g);
    const at = 20 + Math.floor((cl.lateDays[0] + cl.lateDays[1]) / 2);
    expect(withInv[at - 1].cash).toBe(idle[at - 1].cash);
    expect(withInv[at].cash).toBe(idle[at].cash + r.amount);
    expect(withInv[90].cash).toBe(idle[90].cash + r.amount);
    // Overdue: never counted as cash arriving today.
    r.due = g.now - 3 * DAY;
    const over = cashForecast(g, 90);
    expect(over[6].cash).toBe(idle[6].cash);
    expect(over[90].cash).toBe(idle[90].cash + r.amount);
    const c = signBase(g, g.now + 5 * DAY, 60, [leased(g).id]);
    expect(c.product.kind).toBe('wet');
    const withBase = cashForecast(g, 90);
    expect(withBase[90].cash).toBeGreaterThan(withInv[90].cash);
  });
});

describe('flying costs and billing', () => {
  it('wet-lease legs carry no fuel or fees; charter legs pay fuel, fees and catering; MGH invoiced at month end', () => {
    // No AOG on the measured leg (an AOG roll would hold it: v0.8 shifted this seed's luck).
    const bal = BAL as unknown as { aogBase: number };
    const aog0 = bal.aogBase;
    bal.aogBase = 0;
    onTestFinished(() => {
      bal.aogBase = aog0;
    });
    const g = newGame(29);
    const ac = leased(g);
    const c = signBase(g, g.now + 3 * DAY, 30, [ac.id]);
    const first = flightsOf(g, ac.id).find((f) => f.contractId === c.id && f.kind === 'revenue')!;
    run(g, first.sta + 60);
    const flown = Object.values(g.flights).filter((f) => f.contractId === c.id && f.status === 'done');
    expect(flown.length).toBeGreaterThanOrEqual(2); // positioning in + the first leg
    expect(line(g, 'fuel')).toBe(0);
    expect(line(g, 'airportFees')).toBe(0);
    expect(line(g, 'maintenance') + line(g, 'reserves')).toBeLessThan(0);
    expect(g.finance.current.bh).toBeGreaterThan(0);
    // A charter on the owned aircraft: fuel, fees and catering appear with the leg.
    const dep = g.now + 20 * DAY;
    const oc = legsOffer(g, [['LIS', 'FAO', dep], ['FAO', 'LIS', dep + 6 * 60]]);
    oc.broker = undefined;
    const res = acceptOffer(g, oc.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    const cc = g.contracts[res.data!.contractId];
    expect(cc.product.kind).toBe('charter');
    const leg = flightsOf(g, owned(g).id).find((f) => f.contractId === cc.id && f.kind === 'revenue')!;
    const fuel0 = line(g, 'fuel');
    const fees0 = line(g, 'airportFees');
    run(g, leg.sta + 60);
    expect(g.flights[leg.id].status).toBe('done');
    const t = typeOf('a320ceo');
    const wide = 0;
    expect(fuel0 - line(g, 'fuel')).toBeGreaterThanOrEqual(Math.round(t.fuelTBH * (leg.block / 60) * g.market.fuelPrice) * 0.8);
    expect(fees0 - line(g, 'airportFees')).toBe(BAL.airportFees[wide] + BAL.catering[wide]);
    expect(line(g, 'acmiRevenue')).toBe(0);
    // Month end: one acmiRevenue invoice for March at least the pro-rated guarantee; accrual equals the invoice.
    run(g, fromUTC(2027, 4, 1) + 60);
    const k = monthKey(c.start);
    const inv = g.finance.receivables.filter((r) => r.contractId === c.id && r.cat === 'acmiRevenue');
    expect(inv).toHaveLength(1);
    if (c.product.kind !== 'wet') throw new Error('wet');
    expect(inv[0].amount).toBeGreaterThanOrEqual(Math.round(mghInMonth(c.product.mghPerMonth, c.start, c.end, k) * c.product.ratePerBH));
    expect(g.finance.history[0].lines.acmiRevenue).toBe(inv[0].amount);
    expect(inv[0].due - inv[0].issued).toBe(c.payment.dueDays * DAY);
  });

  it('sub-chartered legs cost the rival price, leave our aircraft and are still billed', () => {
    const g = newGame(30);
    const ac = leased(g);
    const c = signBase(g, g.now + 3 * DAY, 30, [ac.id]);
    run(g, c.start + 2 * DAY);
    expect(c.status).toBe('active');
    const list = flightsOf(g, ac.id).filter((f) => f.contractId === c.id && f.status === 'scheduled' && f.kind === 'revenue' && f.std > g.now + DAY);
    const i = list.findIndex((f, j) => j + 1 < list.length && f.from === 'HAM' && list[j + 1].to === 'HAM' && list[j + 1].from === f.to);
    expect(i).toBeGreaterThanOrEqual(0);
    const legs = [list[i], list[i + 1]];
    const rival = g.rivals[0].id;
    const cost = subcharterCost(g, legs, 1.5);
    if (c.product.kind !== 'wet') throw new Error('wet');
    expect(cost).toBe(Math.round(legs.reduce((s, f) => s + (f.block / 60) * 1.5, 0) * c.product.ratePerBH));
    const sub0 = line(g, 'subcharter');
    expect(subcharterLegs(g, legs, rival, cost)).toBe(2);
    expect(line(g, 'subcharter')).toBe(sub0 - cost);
    expect(legs.every((f) => f.aircraftId === null && f.operatedBy === rival)).toBe(true);
    expect(g.stats.subchartered).toBe(2);
    run(g, legs[1].sta + 60);
    expect(legs.every((f) => f.status === 'done')).toBe(true);
    const k = monthKey(legs[1].sta);
    expect(c.use[k].blockMin).toBeGreaterThanOrEqual(legs[0].block + legs[1].block);
  });
});

describe('v0.12.1 cash forecast: money on the day it moves', () => {
  it('a refit is paid at its start: once in work it is not counted again; planned 5 days out the drop is on day 5', () => {
    const g = newGame(5);
    const ac = owned(g);
    const start = g.now + 5 * DAY + 60;
    const r = bookRefit(g, ac.id, '24J/90Y', 'LIS', start);
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[r.data!.maintId];
    const fc = cashForecast(g, 30);
    const cost = m.cost;
    m.cost = 0;
    const free = cashForecast(g, 30);
    m.cost = cost;
    expect(fc[4].cash).toBe(free[4].cash);
    expect(free[5].cash - fc[5].cash).toBe(cost);
    // In work: already paid (onMaintStart), so the forecast matches one without the cost.
    run(g, start + 60);
    expect(m.status).toBe('inWork');
    const inWork = cashForecast(g, 30);
    m.cost = 0;
    expect(cashForecast(g, 30)).toEqual(inWork);
    m.cost = cost;
  });
  it("the month-end drop is the month-end bill, heads included, and the cash really moves by it", () => {
    const g = newGame(27);
    const k = monthKey(g.now);
    const h = Object.values(g.heads ?? {})[0];
    expect(h).toBeTruthy();
    h.hired = { name: 'Ana Costa', skill: 3, salary: 9_000, since: monthStart(k) - DAY };
    const bill = monthEndBill(g, k);
    expect(bill.heads).toBe(9_000);
    expect(bill.total).toBe(bill.rent + bill.insurance + bill.overhead + salaryBill(g) + 9_000);
    const t = monthStart(k + 1);
    const fc = cashForecast(g, Math.ceil((t - g.now) / DAY) + 1);
    const d = Math.floor((t - g.now) / DAY);
    const checks = Object.values(g.maintenance).filter((m) => (m.status === 'planned' || m.status === 'inWork') && Math.floor((m.end - g.now) / DAY) === d).reduce((s, m) => s + m.cost, 0);
    expect(fc[d - 1].cash - fc[d].cash).toBe(bill.total + checks);
    skip(g, t - 1);
    const before = g.company.cash;
    skip(g, t + 1);
    expect(before - g.company.cash).toBe(bill.total + checks);
  });
  it('v0.12.1 (C12) crew who joined mid-month are billed from the day they joined, as the month-end run pays them', () => {
    const g = newGame(27);
    const k = monthKey(g.now);
    const a = monthStart(k), b = monthStart(k + 1);
    const c = Object.values(g.crew).find((x) => x.status !== 'joining')!;
    const full = monthEndBill(g, k).salaries;
    c.payFrom = a + Math.round((b - a) / 2);
    const half = monthEndBill(g, k).salaries;
    expect(full - half).toBeCloseTo(c.salary * 0.5 * (1 + BAL.onCosts), -1);
    expect(monthEndBill(g, k + 1).salaries).toBe(full);
    skip(g, b - 1);
    const before = g.company.cash;
    const bill = monthEndBill(g, k);
    skip(g, b + 1);
    const checks = Object.values(g.maintenance).filter((m) => m.end > b - 1 && m.end <= b + 1).reduce((s, m) => s + m.cost, 0);
    expect(before - g.company.cash).toBe(bill.total + checks);
  });
  it('a head hired mid-month is paid from the day they joined', () => {
    const g = newGame(27);
    const k = monthKey(g.now);
    const h = Object.values(g.heads ?? {})[0];
    const a = monthStart(k), b = monthStart(k + 1);
    h.hired = { name: 'Ana Costa', skill: 3, salary: 9_000, since: a + Math.round((b - a) / 2) };
    expect(headsBill(g, k)).toBeCloseTo(4_500, -1);
    expect(headsBill(g, k + 1)).toBe(9_000);
  });
  it('scheduled flying costs (fuel, fees, maintenance) come off on the day the leg lands', () => {
    const g = newGame(42);
    const dep = g.now + 3 * DAY;
    const o = legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + DAY]]);
    o.payment = { basis: 'onCompletion', dueDays: 7, depositPct: 0 };
    const res = acceptOffer(g, o.id, [owned(g).id]);
    if (!res.ok) throw new Error(res.error);
    const legs = Object.values(g.flights).filter((f) => f.contractId === res.data!.contractId && f.aircraftId);
    const items = forecastItems(g, 10).filter((x) => x.what.startsWith('flying costs'));
    const want = legs.reduce((s, f) => { const x = legCostEstimate(g, f, g.fleet[f.aircraftId!]); return s + Math.round(x.maint + x.reserves + x.fuel + x.fees); }, 0);
    expect(items.reduce((s, x) => s + x.amount, 0)).toBe(-want);
    expect(want).toBeGreaterThan(0);
  });
});

describe('v0.12.1 the cash card names what pulls cash under', () => {
  it('a big refit before the month end: the WHY names the refit', () => {
    const g = newGame(5);
    const ac = owned(g);
    const r = bookRefit(g, ac.id, '24J/90Y', 'LIS', g.now + 3 * DAY);
    if (!r.ok) throw new Error(r.error);
    g.company.cash = 500_000;
    const card = cashLowCard(g);
    expect(card?.why).toContain(`${ac.reg}'s cabin refit`);
  });
});

describe('v0.12.1 fixed costs by the days the aircraft is ours', () => {
  it('a sale on day 22 pays 22 days of insurance and overhead, not the month', () => {
    const g = newGame(27);
    const k = monthKey(g.now);
    const ac = owned(g);
    const days = daysInMonth(k);
    g.now = monthStart(k) + 22 * DAY;
    const before = { ...g.finance.current.lines };
    settleDeparture(g, ac);
    const share = (g.now - Math.max(monthStart(k), ac.deliveredAt)) / (days * DAY);
    expect((g.finance.current.lines.insurance ?? 0) - (before.insurance ?? 0)).toBe(-Math.round(insuranceOf(g, ac) * share));
    expect((g.finance.current.lines.overhead ?? 0) - (before.overhead ?? 0)).toBe(-Math.round(BAL.overheadPerAircraft * share));
  });
  it('leased out from day 3: our insurance for the first days only; back on day 27: those days again', () => {
    const g = newGame(27);
    const k = monthKey(g.now) + 1;
    const ac = owned(g);
    ac.deliveredAt = Math.min(ac.deliveredAt, monthStart(k - 1));
    const a = monthStart(k), len = monthStart(k + 1) - a;
    const ins = insuranceOf(g, ac);
    const others = fixedCosts(g, k).insurance - ins;
    g.contracts.kx = { id: 'kx', aircraftIds: [ac.id], dry: { leasedAt: a + 2 * DAY } } as never;
    expect(fixedCosts(g, k).insurance - others).toBe(Math.round(ins * (2 * DAY) / len));
    g.contracts.kx.dry!.returnedAt = a + 26 * DAY;
    expect(fixedCosts(g, k).insurance - others).toBe(Math.round(ins * (len - 24 * DAY) / len));
  });
});

describe('v0.12.1 statement totals by category', () => {
  it('a loss on a sale is negative revenue; insurance and overhead are costs', () => {
    expect(statementTotals({ assetSale: -1_040_000, insurance: -42_000, overhead: -60_000 })).toEqual({ revenue: -1_040_000, costs: -102_000, profit: -1_142_000 });
    // A refund lowers costs instead of counting as revenue.
    expect(statementTotals({ charterRevenue: 100_000, refit: 5_000, fuel: -20_000 })).toEqual({ revenue: 100_000, costs: -15_000, profit: 85_000 });
  });
  it('every ledger category is a revenue or a cost row (crew jets included)', () => {
    for (const cat of Object.keys(LEDGER_LABEL) as LedgerCat[]) expect(REVENUE_CATS.includes(cat) !== COST_CATS.includes(cat)).toBe(true);
    expect(COST_CATS).toContain('crewJet');
  });
});
