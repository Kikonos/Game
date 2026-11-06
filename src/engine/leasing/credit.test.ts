// v0.17 lane `deals` (UPDATE-0.17.md §C, §K.2): the lessor rating, its cache and messages, exposure and caps, who will
// deal with us, the sale-and-leaseback lessor pick.

import { describe, expect, it } from 'vitest';
import { LESSOR_BY_ID } from '../../data/lessors';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { capOf, dailyCredit, depositMonthsFor, exposureOf, gradeOf, leasebackLessorFor, lessorRating, lessorStance, widebodiesInAll } from './credit';
import { newGame } from './deals017.helpers';

describe('v0.17 lessor rating (§C)', () => {
  it('grades by score; deposits by grade (D 5, or 7 below 25)', () => {
    expect([gradeOf(90), gradeOf(70), gradeOf(40), gradeOf(20)]).toEqual(['A', 'B', 'C', 'D']);
    expect(depositMonthsFor({ grade: 'A', score: 80 })).toBe(1);
    expect(depositMonthsFor({ grade: 'C', score: 40 })).toBe(3);
    expect(depositMonthsFor({ grade: 'D', score: 30 })).toBe(5);
    expect(depositMonthsFor({ grade: 'D', score: 10 })).toBe(7);
  });

  it('cash below zero costs 25 points; a restructuring caps the grade at D', () => {
    const g = newGame(11);
    const before = lessorRating(g).score;
    g.company.cash = -1_000_000;
    const r = lessorRating(g);
    expect(r.parts.some((p) => p.label === 'Cash below zero' && p.pts === -25)).toBe(true);
    expect(r.score).toBeLessThan(before);
    g.company.cash = 5_000_000;
    g.treasury!.distress = { rentDeferrals: [], plans: [], lessorBlock: {}, stats: { deferred: 0, premiums: 0, discounts: 0, furloughSaved: 0, writtenOff: 0 }, per: { labelUntil: g.now + 100 * DAY } } as never;
    expect(lessorRating(g).grade).toBe('D');
  });

  it('is cached daily and a change is told once it holds a week', () => {
    const g = newGame(12);
    dailyCredit(g);
    expect(g.leasing!.credit?.grade).toBe('C');
    const msgs = g.messages.length;
    g.company.cash = -2_000_000;
    for (let d = 0; d < 6; d++) {
      g.now += DAY;
      dailyCredit(g);
    }
    expect(g.leasing!.credit?.grade).toBe('D');
    expect(g.messages.length).toBe(msgs);
    g.now += 2 * DAY;
    dailyCredit(g);
    expect(g.messages[0].title).toBe('Lessor rating down to D');
  });
});

describe('v0.17 exposure and lessor stance (§C.3, §D.3)', () => {
  it("counts legacy leases by the lessor's name; top lessors won't deal at C; mid-life lessors will", () => {
    const g = newGame(13);
    const ac = Object.values(g.fleet)[0];
    if (ac.ownership.kind === 'dryLeaseIn') {
      ac.ownership.lessor = 'Aircastle';
      expect(exposureOf(g, 'aircastle').all).toBe(1);
    }
    expect(lessorStance(g, LESSOR_BY_ID.aercap, 'a320ceo', 'mid').kind).toBe('credit');
    expect(lessorStance(g, LESSOR_BY_ID.carlyle, 'a320ceo', 'mid').ok).toBe(true);
    // At C a widebody must be 15 years or older, and two in all.
    expect(lessorStance(g, LESSOR_BY_ID.carlyle, 'a332', 'young').ok).toBe(false);
    expect(widebodiesInAll(g)).toBe(0);
  });

  it('a lessor at its cap says so; a rent deferral running takes one off the cap', () => {
    const g = newGame(14);
    const def = LESSOR_BY_ID.vallair;
    for (const a of Object.values(g.fleet)) if (a.ownership.kind === 'dryLeaseIn') a.ownership.lessor = 'Vallair';
    const n = exposureOf(g, 'vallair').all;
    expect(capOf(g, def, 'C').all).toBe(3);
    g.treasury!.distress = { rentDeferrals: [{ lessor: 'Vallair', done: undefined }], plans: [], lessorBlock: {}, stats: {} } as never;
    expect(capOf(g, def, 'C').all).toBe(2);
    if (n >= 2) expect(lessorStance(g, def, 'a320ceo', 'old').kind).toBe('exposure');
  });

  it('§T exotics: B or better, C with big security, never a lease at D', () => {
    const g = newGame(15);
    const st = lessorStance(g, LESSOR_BY_ID.amedeo, 'a388', 'old');
    expect(st.ok).toBe(true);
    expect(st.security).toBe(true);
    expect(lessorStance(g, LESSOR_BY_ID.doric, 'a388', 'old').ok).toBe(false);
    g.company.cash = -5_000_000;
    g.leasing!.credit = lessorRating(g);
    expect(g.leasing!.credit.grade).toBe('D');
    expect(lessorStance(g, LESSOR_BY_ID.amedeo, 'a388', 'old').ok).toBe(false);
  });
});

describe('v0.17 sale and leaseback lessor (§K.2)', () => {
  it('at C the top lessors pass it on to a mid-life lessor', () => {
    const g = newGame(16);
    const pick = leasebackLessorFor(g, 'AerCap', ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'Air Lease Corporation', 'BOC Aviation', 'Carlyle Aviation Partners']);
    expect(pick.why).toBeNull();
    expect(pick.lessor).toBe('Carlyle Aviation Partners');
  });

  it('nobody at D but Carlyle (a distressed sale); with Carlyle full, the reason', () => {
    const g = newGame(17);
    g.company.cash = -5_000_000;
    g.leasing!.credit = lessorRating(g);
    expect(leasebackLessorFor(g, 'AerCap', ['AerCap', 'Avolon']).lessor).toBe('Carlyle Aviation Partners');
    for (const a of Object.values(g.fleet)) if (a.ownership.kind === 'dryLeaseIn') a.ownership.lessor = 'Carlyle Aviation Partners';
    if (exposureOf(g, 'carlyle').all >= 1) expect(leasebackLessorFor(g, 'AerCap', ['AerCap', 'Avolon']).why).toMatch(/rating D/);
  });

  it('plays on: the rating is cached daily in a running game', () => {
    const g = newGame(18);
    advanceTo(g, g.now + 3 * DAY);
    expect(g.leasing!.credit?.at).toBeGreaterThan(g.started);
  });
});
