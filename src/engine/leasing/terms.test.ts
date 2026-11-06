// v0.17 real lease terms (UPDATE-0.17.md §E): the rent's factors, deposits by grade, reserves by age with minimum
// hours, return conditions, the extension rent, the reference rents; legacy offers keep their terms.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES, RENT_V017 } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { DAY, monthKey } from '../core/time';
import type { CreditGrade, GameState } from '../core/types';
import { newGame } from '../contracts/testkit';
import { acquireAircraft, makeOffer } from '../ops/market';
import { extensionRentX, minHoursBill, quoteTerms, refType, termFactor, type TermsDraft } from './terms';

const draft = (o: Partial<TermsDraft> = {}): TermsDraft => ({
  offerId: 'mo-t', typeId: 'a320ceo', kind: 'dryLeaseIn', builtYear: 2015, newBuild: false, source: 'call', lessorId: 'carlyle',
  rentPerMonth: 0, reservesPerFH: 0, leaseMonths: 0, deposit: 0, price: 0, ...o,
});
const at = (g: GameState, grade: CreditGrade, score = 50) => {
  g.leasing!.credit = { score, grade, parts: [], at: g.now };
};

describe('v0.17 quoteTerms (§E)', () => {
  it('a legacy offer (no source) and the v0.16 market keep the rolled terms', () => {
    const g = newGame(3);
    const d = draft({ source: undefined, rentPerMonth: 210_000, reservesPerFH: 400, leaseMonths: 36, deposit: 420_000 });
    expect(quoteTerms(g, d)).toEqual({ rentPerMonth: 210_000, reservesPerFH: 400, leaseMonths: 36, deposit: 420_000, price: 0 });
    (BAL.v017 as { on: boolean }).on = false;
    try {
      expect(quoteTerms(g, draft({ rentPerMonth: 1, leaseMonths: 2 })).rentPerMonth).toBe(1);
    } finally {
      (BAL.v017 as { on: boolean }).on = true;
    }
  });

  it('rent: short leases and weak ratings cost more; the reference rents of §E.1', () => {
    const g = newGame(4);
    at(g, 'B');
    const short = quoteTerms(g, draft({ monthsWanted: 12, band: 'old', builtYear: 2008 }));
    const long = quoteTerms(g, draft({ monthsWanted: 48, band: 'old', builtYear: 2008 }));
    expect(short.leaseMonths).toBe(12);
    expect(long.leaseMonths).toBe(48);
    expect(short.rentPerMonth / long.rentPerMonth).toBeCloseTo((1 + termFactor(12)) / (1 + termFactor(48)), 1);
    const b = quoteTerms(g, draft({ monthsWanted: 36, band: 'mid' }));
    at(g, 'C');
    const c = quoteTerms(g, draft({ monthsWanted: 36, band: 'mid' }));
    expect(c.rentPerMonth / b.rentPerMonth).toBeGreaterThan(1.03);
    expect(c.why!.map((w) => w.label)).toEqual(expect.arrayContaining(['36 months', 'rating C']));
    expect(refType(ACMI_TYPES.a320ceo).rentMonth).toBe(RENT_V017.a320ceo.rentMonth);
    expect(refType(ACMI_TYPES.a359).rentNew).toBe(1_200_000);
    // A term outside the band moves into it (§E.4): a young A320 is at least 60 months.
    expect(quoteTerms(g, draft({ monthsWanted: 12, band: 'young', builtYear: 2022 })).leaseMonths).toBe(60);
  });

  it('deposit months by grade (A 1 · B 2 · C 3 · D 5, 7 below 25), +1 new build, −1 batch; a holding deposit of one month', () => {
    const g = newGame(5);
    const months: Record<string, number> = {};
    for (const [gr, sc] of [['A', 80], ['B', 60], ['C', 45], ['D', 30], ['D', 20]] as [CreditGrade, number][]) {
      at(g, gr, sc);
      const q = quoteTerms(g, draft({ band: 'mid' }));
      months[`${gr}${sc}`] = q.depositMonths!;
      expect(q.deposit).toBe(q.depositMonths! * q.rentPerMonth);
      expect(q.holding).toBe(q.rentPerMonth);
    }
    expect(months).toEqual({ A80: 1, B60: 2, C45: 3, D30: 5, D20: 7 });
    at(g, 'B', 60);
    expect(quoteTerms(g, draft({ typeId: 'a321neo', newBuild: true, builtYear: 2029, lessorId: 'aercap' })).depositMonths).toBe(3);
    expect(quoteTerms(g, draft({ source: 'batch', band: 'mid' })).depositMonths).toBe(1);
  });

  it('a failure batch is 8–15 % under the same airframe’s call rent; a short-term sublease 15–30 % over mid-life', () => {
    const g = newGame(6);
    at(g, 'C');
    for (let i = 0; i < 20; i++) {
      const call = quoteTerms(g, draft({ offerId: `x${i}`, band: 'mid', monthsWanted: 36 }));
      const batch = quoteTerms(g, draft({ offerId: `x${i}`, band: 'mid', monthsWanted: 36, source: 'batch' }));
      const x = batch.rentPerMonth / call.rentPerMonth;
      expect(x).toBeGreaterThan(0.84);
      expect(x).toBeLessThan(0.93);
      const spot = quoteTerms(g, draft({ offerId: `s${i}`, source: 'spot', monthsWanted: 5 }));
      expect(spot.leaseMonths).toBe(5);
      expect(spot.depositMonths).toBe(1);
      expect(spot.minFH).toBeUndefined();
      expect(spot.halfLifeShare).toBe(0);
    }
  });

  it('reserves by age with minimum hours; return conditions by age; transition cost', () => {
    const g = newGame(7);
    at(g, 'B');
    const young = quoteTerms(g, draft({ band: 'young', builtYear: 2022 }));
    const old = quoteTerms(g, draft({ band: 'old', builtYear: 2004 }));
    expect(old.reservesPerFH).toBeGreaterThan(young.reservesPerFH);
    expect(young.minFH).toBe(80);
    expect(quoteTerms(g, draft({ typeId: 'a332', band: 'old', builtYear: 2006, lessorId: 'aircastle' })).minFH).toBe(150);
    expect(young.halfLifeShare).toBe(0.6);
    expect(old.halfLifeShare).toBe(0.25);
    expect(young.transition).toBe(90_000);
    // A family new to the AOC: × 1.5.
    expect(quoteTerms(g, draft({ typeId: 'b738', band: 'mid' })).transition).toBe(135_000);
  });

  it('grade D asks 3 months of minimum-hours reserves up front', () => {
    const g = newGame(8);
    at(g, 'D', 30);
    const q = quoteTerms(g, draft({ band: 'old', builtYear: 2004, lessorId: 'vallair' }));
    expect(q.reservesDeposit).toBe(Math.round((3 * 80 * q.reservesPerFH) / 1000) * 1000);
  });

  it('extension rent follows tightness (§E.6): a tight type extends up, an easy one down; 36 months 0.04 less', () => {
    const g = newGame(9);
    g.leasing!.tight.a332 = 0.8;
    g.leasing!.tight.a320ceo = 0.3;
    const w = extensionRentX(g, 'a332', 12)!;
    const n = extensionRentX(g, 'a320ceo', 12)!;
    expect(w).toBeGreaterThan(1);
    expect(n).toBeLessThan(1);
    expect(w).toBeLessThanOrEqual(1.06);
    expect(n).toBeGreaterThanOrEqual(0.95);
    expect(extensionRentX(g, 'a332', 36)).toBeCloseTo(w - 0.04, 6);
  });
});

describe('v0.17 minimum hours (§E.3)', () => {
  it('a v0.17 lease that does not fly is billed its minimum hours; flown hours count against it', () => {
    const g = newGame(10);
    g.company.cash = 50_000_000;
    const o = makeOffer(g, ACMI_TYPES.a320ceo, { source: 'call', lessorId: 'carlyle', band: 'mid' });
    g.market.aircraft.push(o);
    const r = acquireAircraft(g, o.id);
    expect(r.ok).toBe(true);
    const ac = g.fleet[(r as { data: { aircraftId: string } }).data.aircraftId];
    expect(ac.ownership.kind === 'dryLeaseIn' && ac.ownership.minFH).toBe(80);
    // A whole month after the handover, parked.
    const own = ac.ownership as Extract<typeof ac.ownership, { kind: 'dryLeaseIn' }>;
    own.leaseStart = g.now - 400 * DAY;
    g.now += 60 * DAY;
    const k = monthKey(g.now) - 1;
    const full = minHoursBill(g, k);
    expect(full).toBe(Math.round(80 * own.reservesPerFH));
    // 50 hours flown in that month.
    const d0 = Math.floor((g.now - 40 * DAY) / DAY);
    ac.bhDays = [[d0, 50 * 60]];
    const less = minHoursBill(g, monthKey(d0 * DAY));
    expect(less).toBeLessThan(full);
  });
});
