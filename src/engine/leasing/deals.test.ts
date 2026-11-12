// v0.17 lane `deals` (UPDATE-0.17.md §F, §G, §K.1, §T): letter of intent → credit check → lease → transition; more
// security, declines, walking away, the forfeit on the statement; the transition plan and CAMO slots; letters of credit.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { creditView } from '../finance';
import { lcInUse, lcWhy, monthlyLc, dailyLc } from '../finance/lc';
import { camoCapacity, camoLoad, inductionPlan } from './induction';
import { cashToSign, dealsOpen, depositDue, leasingForecastItems, loiQuote, meetConditions, signLease, signLoi, usesLoi, walkAway } from './deals';
import { lessorRating } from './credit';
import { newGame, v17Offer } from './deals017.helpers';
import { problems } from '../problems';

// Day by day (advanceTo stops at a pause request).
const runDays = (g: ReturnType<typeof newGame>, d: number) => {
  const end = g.now + d * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY));
};

describe('v0.17 letter of intent to lease (§F)', () => {
  it('signs the letter of intent: holding deposit, the offer leaves the market, a deal at the credit check', () => {
    const g = newGame(21);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    expect(usesLoi(g, o)).toBe(true);
    const q = loiQuote(g, o.id)!;
    expect(q.why).toBeNull();
    expect(q.holding).toBe(o.rentPerMonth);
    expect(q.steps.length).toBeGreaterThan(2);
    const cash = g.company.cash;
    const r = signLoi(g, o.id, { autoSign: true });
    expect(r.ok).toBe(true);
    expect(g.company.cash).toBe(cash - q.holding);
    expect(g.market.aircraft.some((x) => x.id === o.id)).toBe(false);
    const d = dealsOpen(g)[0];
    expect(d.stage).toBe('committee');
    expect(d.committeeAt).toBeGreaterThanOrEqual(g.now + 10 * DAY);
    expect(leasingForecastItems(g, 60).length).toBeGreaterThan(0);
  });

  it('approved and signed automatically: the aircraft in transition, the transition cost on the statement', () => {
    const g = newGame(22);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    signLoi(g, o.id, { autoSign: true, paint: true });
    const d = dealsOpen(g)[0];
    // Keep the rating where it was (the committee compares grades).
    runDays(g, Math.ceil((d.committeeAt - g.now) / DAY) + 1);
    expect(['signed', 'conditions']).toContain(d.stage);
    if (d.stage === 'conditions') meetConditions(g, d.id, 'cash');
    expect(d.stage).toBe('signed');
    const ac = g.fleet[d.aircraftId!];
    expect(ac.status).toBe('delivering');
    expect(ac.induction).toBeDefined();
    expect(ac.delivery?.handover).toBe(ac.induction!.ready);
    expect(ac.ownership.kind === 'dryLeaseIn' && ac.ownership.lessorId).toBe('carlyle');
    expect(ac.ownership.kind === 'dryLeaseIn' && ac.ownership.minFH).toBe(BAL.v017.terms.minFH.narrow);
    const lines = g.finance.current.lines;
    const hist = g.finance.history.at(-1)?.lines ?? {};
    expect((lines.transition ?? 0) + (hist.transition ?? 0)).toBeLessThan(0);
    // 6–12 weeks from letter of intent to handover for a same-family narrowbody.
    const weeks = (ac.induction!.ready - d.loiAt) / (7 * DAY);
    expect(weeks).toBeGreaterThan(4);
    expect(weeks).toBeLessThan(14);
  });

  it('a grade lower at the committee: more security asked (a card); walking away refunds the holding deposit', () => {
    const g = newGame(23);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    signLoi(g, o.id);
    const d = dealsOpen(g)[0];
    d.gradeAtOffer = 'B';
    runDays(g, Math.ceil((d.committeeAt - g.now) / DAY) + 1);
    expect(d.stage).toBe('conditions');
    expect(d.conditions!.extraDeposit).toBe(2 * o.rentPerMonth);
    expect(problems(g).some((c) => c.subject.kind === 'leaseConditions')).toBe(true);
    const cash = g.company.cash;
    expect(walkAway(g, d.id).ok).toBe(true);
    expect(g.company.cash).toBe(cash + d.holding);
    expect(d.stage).toBe('walked');
  });

  it('two grades lower: declined, the holding deposit back, the lessor looks again after 30 days', () => {
    const g = newGame(24);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    signLoi(g, o.id);
    const d = dealsOpen(g)[0];
    d.gradeAtOffer = 'A';
    runDays(g, Math.ceil((d.committeeAt - g.now) / DAY) + 1);
    expect(d.stage).toBe('declined');
    expect(g.leasing!.quiet[`carlyle:${o.typeId}`]).toBeGreaterThan(g.now);
  });

  it('approved with automatic signing off: the sign card; walking away then forfeits the holding deposit (a lease transition cost)', () => {
    const g = newGame(25);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    signLoi(g, o.id, { autoSign: false });
    const d = dealsOpen(g)[0];
    runDays(g, Math.ceil((d.committeeAt - g.now) / DAY) + 1);
    if (d.stage === 'conditions') meetConditions(g, d.id, 'cash');
    expect(d.stage).toBe('approved');
    expect(problems(g).some((c) => c.subject.kind === 'leaseSign')).toBe(true);
    const rent0 = g.finance.current.lines.rent ?? 0;
    const tr0 = g.finance.current.lines.transition ?? 0;
    const cash = g.company.cash;
    walkAway(g, d.id);
    expect(g.company.cash).toBe(cash);
    // v0.22.1 a cost of the lease deal that fell through ('Lease transitions'), not aircraft rent.
    expect((g.finance.current.lines.transition ?? 0) - tr0).toBe(-d.holding);
    expect((g.finance.current.lines.rent ?? 0) - rent0).toBe(0);
    expect(g.leasing!.stats.forfeited).toBe(d.holding);
  });

  it('the signing window lapses: signed when the cash is there', () => {
    const g = newGame(26);
    g.company.cash = 20_000_000;
    const o = v17Offer(g);
    signLoi(g, o.id, { autoSign: false });
    const d = dealsOpen(g)[0];
    runDays(g, Math.ceil((d.committeeAt - g.now) / DAY) + 1);
    if (d.stage === 'conditions') meetConditions(g, d.id, 'cash');
    g.company.cash = 20_000_000;
    runDays(g, BAL.v017.deal.signDays + 1);
    expect(d.stage).toBe('signed');
  });

  it('legacy offers and purchases do not use a letter of intent', () => {
    const g = newGame(27);
    const o = v17Offer(g, 'a320ceo', 'carlyle', { source: undefined });
    expect(usesLoi(g, o)).toBe(false);
    const b = v17Offer(g, 'a320ceo', 'vallair', { kind: 'buy' });
    expect(usesLoi(g, b)).toBe(false);
    expect(signLoi(g, b.id).ok).toBe(false);
  });

  it('§T an exotic at C: 4 more months of deposit and 3 months of reserves up front', () => {
    const g = newGame(28);
    g.company.cash = 80_000_000;
    g.company.approvals.push('widebody', 'augmented', 'etops180', 'etops120');
    const o = v17Offer(g, 'a388', 'amedeo', { builtYear: 2010, minFH: 150 });
    const q = loiQuote(g, o.id)!;
    expect(q.exoticSecurity).toBe(4 * o.rentPerMonth);
    expect(q.reservesDeposit).toBe(3 * 150 * o.reservesPerFH);
    expect(signLoi(g, o.id).ok).toBe(true);
    const d = dealsOpen(g)[0];
    expect(depositDue(d)).toBe(Math.max(0, o.deposit - d.holding) + 4 * o.rentPerMonth);
    expect(cashToSign(g, d)).toBeGreaterThan(depositDue(d));
  });
});

describe('v0.17 transition and CAMO (§G)', () => {
  it('the plan: records, check, registration, acceptance; the same plan rolled twice', () => {
    const g = newGame(31);
    const o = v17Offer(g);
    const a = inductionPlan(g, o);
    const b = inductionPlan(g, o);
    expect(a).toEqual(b);
    const i = a.induction!;
    expect(i.records[1] - i.records[0]).toBeGreaterThanOrEqual(21 * DAY);
    expect(a.ready).toBeGreaterThan(i.check[1]);
    const days = (a.ready - g.now) / DAY;
    expect(days).toBeGreaterThan(20);
    expect(days).toBeLessThan(60);
    // Paint adds days; tech reps cut the records review.
    expect(inductionPlan(g, o, { paint: true }).ready).toBeGreaterThanOrEqual(a.ready);
    expect(inductionPlan(g, o, { techReps: true }).induction!.records[1]).toBeLessThan(i.records[1]);
  });

  it('our CAMO runs one transition at a time with two aircraft: the second waits', () => {
    const g = newGame(32);
    g.company.cash = 30_000_000;
    expect(camoCapacity(g)).toBe(1);
    const ids: string[] = [];
    for (const lessor of ['carlyle', 'aircastle'] as const) {
      const o = v17Offer(g, 'a320ceo', lessor);
      signLoi(g, o.id, { autoSign: true });
      ids.push(dealsOpen(g).at(-1)!.id);
    }
    for (const id of ids) {
      const d = g.leasing!.deals.find((x) => x.id === id)!;
      d.stage = 'approved';
      d.signBy = g.now + 7 * DAY;
      expect(signLease(g, id).ok).toBe(true);
    }
    const [a, b] = ids.map((id) => g.fleet[g.leasing!.deals.find((x) => x.id === id)!.aircraftId!].induction!);
    expect(b.slot).toBeGreaterThanOrEqual(a.ready);
    expect(b.waitedCamo).toBeGreaterThan(0);
    for (let t = g.now; t < b.ready; t += DAY) expect(camoLoad(g, t)).toBeLessThanOrEqual(1);
  });
});

describe('v0.17 letters of credit (§K.1)', () => {
  it('at B with an open line: lowers the undrawn limit and charges 1.25 % a year at the month end', () => {
    const g = newGame(41);
    g.treasury!.credit = { limit: 3_000_000, drawn: 0, margin: 0.03, openedAt: g.now, renewsAt: g.now + 365 * DAY, accrued: 0, accruedFee: 0, breaches: 0 };
    expect(lcWhy(g, 'carlyle', 'B', 500_000)).toBeNull();
    expect(lcWhy(g, 'aercap', 'B', 500_000)).toMatch(/cash/);
    expect(lcWhy(g, 'carlyle', 'C', 500_000)).toMatch(/cash/);
    const before = creditView(g)!.undrawn;
    g.leasing!.lc.x = 1_000_000;
    // The letter is tied to nothing in the fleet: kept here only as a deal's id would be.
    g.leasing!.lc = { deal99: 1_000_000 };
    g.leasing!.deals.push({ id: 'deal99', stage: 'committee' } as never);
    expect(lcInUse(g)).toBe(1_000_000);
    expect(creditView(g)!.undrawn).toBe(before - 1_000_000);
    for (let d = 0; d < 30; d++) dailyLc(g);
    const fees0 = g.finance.current.lines.bankFees ?? 0;
    monthlyLc(g);
    const fee = (g.finance.current.lines.bankFees ?? 0) - fees0;
    expect(Math.abs(fee)).toBeCloseTo((1_000_000 * 0.0125 * 30) / 365, -1);
    void lessorRating;
  });
});
