// Statements, receivables, solvency and the cash forecast (B3). DESIGN.md §5.7, BUILD-PLAN B3 acceptance.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { invoice, statementTotals } from '../core/ledger';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fromUTC, monthKey, monthStart } from '../core/time';
import type { Client, Contract, GameState, LedgerCat, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { mghInMonth } from '../contracts/pricing';
import { addAircraft, hamBase, leased, legsOffer, newGame, owned, run } from '../contracts/testkit';
import { salaryBill } from '../crew';
import { advanceTo } from '../sim';
import { cashForecast, fixedCosts, resolveDecision } from '.';
import { subcharterCost, subcharterLegs } from './flights';

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
    expect(fc.insurance).toBe(2 * typeOf('a320ceo').insuranceMonth);
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
    expect(fc.insurance).toBe(Math.round(base.insurance + typeOf('a320ceo').insuranceMonth * share));
    expect(fc.overhead).toBe(Math.round(BAL.overheadBase + BAL.overheadPerAircraft * (2 + share)));
    // A lease ending on the 10th pays a third of the rent.
    const l = leased(g);
    if (l.ownership.kind !== 'dryLeaseIn') throw new Error('leased');
    const leaseEnd = l.ownership.leaseEnd;
    l.ownership.leaseEnd = monthStart(k) + 10 * DAY;
    expect(fixedCosts(g, k).rent).toBe(Math.round((l.ownership.rentPerMonth * 10) / days));
    expect(fixedCosts(g, k).insurance).toBe(Math.round(typeOf('a320ceo').insuranceMonth * (1 + 10 / days + share)));
    l.ownership.leaseEnd = leaseEnd;
    // Not delivered until the month after next: nothing.
    ac.deliveredAt = monthStart(k + 2);
    expect(fixedCosts(g, k)).toEqual(base);
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
    const reminders = g.messages.filter((m) => m.title === `Invoice overdue: ${gov.name}`);
    expect(reminders).toHaveLength(2);
    expect(reminders[0].body).toMatch(/7 days past due\. Reminder sent/);
    skip(g, a.due + 30 * DAY + 60);
    expect(a.nudged).toBe(30);
    const dA = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === a.id)!;
    const dB = g.decisions.find((d) => d.kind === 'latePayment' && d.data?.receivableId === b.id)!;
    expect(dA && dB).toBeTruthy();
    expect(dA.options.map((o) => o.id)).toEqual(['wait', 'factor', 'threaten']);
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
    expect(withInv[19].cash).toBe(idle[19].cash);
    expect(withInv[20].cash).toBe(idle[20].cash + r.amount);
    expect(withInv[90].cash).toBe(idle[90].cash + r.amount);
    const c = signBase(g, g.now + 5 * DAY, 60, [leased(g).id]);
    expect(c.product.kind).toBe('wet');
    const withBase = cashForecast(g, 90);
    expect(withBase[90].cash).toBeGreaterThan(withInv[90].cash);
  });
});

describe('flying costs and billing', () => {
  it('wet-lease legs carry no fuel or fees; charter legs pay fuel, fees and catering; MGH invoiced at month end', () => {
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
