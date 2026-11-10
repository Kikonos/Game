import { describe, expect, it } from 'vitest';
import { COST_CATS, REVENUE_CATS, statementTotals } from '../core/ledger';
import { monthStart } from '../core/time';
import type { LedgerCat, MonthStatement } from '../core/types';
import {
  biggestChanges, cashPath, COST_GROUPS, costGroupOf, financeTips, groupMonth, monthVerdict, perBlockHour, REV_GROUPS, revGroupOf, type GlanceFacts,
} from './glance';

// The player's save s0108 (Blue Airlines): November and December 2028, in $K.
const K = (o: Partial<Record<LedgerCat, number>>) => Object.fromEntries(Object.entries(o).map(([c, v]) => [c, v! * 1000])) as Partial<Record<LedgerCat, number>>;
const NOV = K({ leaseIncome: 268, perDiem: -289, hotels: -88, reserves: -630, maintenance: -1071, fuel: -618, airportFees: -160, charterRevenue: 1443, deadhead: -26, warRisk: -29, otherRevenue: 247, disruption: -10, salaries: -2127, hiring: -374, penalties: -30, acmiRevenue: 4433, transition: -75, interestIncome: 5, rent: -1123, insurance: -93, overhead: -550 });
const DEC = K({ leaseIncome: 285, perDiem: -282, hotels: -70, reserves: -627, maintenance: -972, checks: -192, deadhead: -53, penalties: -215, subcharter: -179, salaries: -2069, crewJet: -84, fuel: -175, otherRevenue: 302, airportFees: -61, charterRevenue: 486, marketing: -195, sales: -4, acmiRevenue: 4094, leaseReturn: -5500, rent: -1120, insurance: -93, overhead: -549, interestIncome: 4 });
const MONTH = 24346; // Nov 2028
const st = (month: number, lines: Partial<Record<LedgerCat, number>>, cashStart: number, cashEnd: number, bh = 1000): MonthStatement => ({ month, lines, bh, cashStart, cashEnd, closed: true });
const FACTS: GlanceFacts = { pilots: { have: 144, need: 111 }, cabin: { have: 250, need: 231 }, aircraft: 7, pilotHours28: 15.6, surplusCost: 330_875, overdue: 0, cashNow: 1_000_000, zeroAt: null };
const label = (c: LedgerCat) => (c === 'leaseReturn' ? 'Lease return' : c);

describe('v0.20 finance at a glance: plain groups', () => {
  it('every ledger category has exactly one group, revenue and cost lists apart', () => {
    for (const c of COST_CATS) expect(COST_GROUPS.filter((g) => g.cats.includes(c)).length, c).toBe(1);
    for (const c of REVENUE_CATS) expect(REV_GROUPS.filter((g) => g.cats.includes(c)).length, c).toBe(1);
    expect(costGroupOf('salaries')).toBe('crew');
    expect(costGroupOf('reserves')).toBe('mx');
    expect(costGroupOf('leaseReturn')).toBe('oneOff');
    expect(revGroupOf('ticketRevenue')).toBe('routes');
    // Fixed order, 'Other' last in both.
    expect(COST_GROUPS[COST_GROUPS.length - 1].id).toBe('other');
    expect(REV_GROUPS[REV_GROUPS.length - 1].id).toBe('other');
  });

  it('groups add up to the statement totals, shares to 1; the fixed order holds whatever the sizes', () => {
    for (const lines of [NOV, DEC]) {
      const gm = groupMonth(lines);
      const t = statementTotals(lines);
      expect(gm.costs.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(-t.costs, 3);
      expect(gm.revenue.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(t.revenue, 3);
      expect(gm.costs.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
      expect(gm.costs.map((x) => x.id)).toEqual(COST_GROUPS.map((g) => g.id));
    }
    const dec = groupMonth(DEC);
    expect(dec.costs.find((x) => x.id === 'crew')!.amount).toBe(2_069_000);
    expect(dec.costs.find((x) => x.id === 'crewTravel')!.amount).toBe(489_000);
    expect(dec.costs.find((x) => x.id === 'mx')!.lines.map((l) => l.cat)).toEqual(['maintenance', 'reserves', 'checks']);
    expect(dec.revenue.find((x) => x.id === 'acmi')!.share).toBeCloseTo(4094 / 5171, 4);
  });

  it('a refund lowers its group, a negative group draws as nothing but keeps its line', () => {
    const gm = groupMonth({ acmiRevenue: 100, distress: 50, leaseReturn: -20 });
    const one = gm.costs.find((x) => x.id === 'oneOff')!;
    expect(one.amount).toBe(0);
    expect(one.lines.map((l) => l.amount)).toEqual([20, -50]);
    expect(gm.totals.profit).toBe(130);
  });
});

describe('v0.20 verdict, per block hour and changes', () => {
  it('December: lost, most of it the one-off lease return', () => {
    const v = monthVerdict(DEC);
    expect(Math.round(v.profit / 1000)).toBe(-7_269);
    expect(v.oneOffs).toBe(5_500_000);
    expect(v.biggestOneOff?.cat).toBe('leaseReturn');
    expect(Math.round(v.underlying / 1000)).toBe(-1_769);
    expect(monthVerdict({}).margin).toBeNull();
  });

  it('per block hour leaves the one-offs out and says so', () => {
    const p = perBlockHour({ lines: DEC, bh: 1081 })!;
    expect(p.earn).toBeCloseTo(5_171_000 / 1081, 3);
    expect(p.oneOffsLeftOut).toBe(5_500_000);
    expect(p.costs.some((c) => c.id === 'oneOff')).toBe(false);
    expect(p.costs.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(p.cost, 6);
    expect(p.profit).toBeCloseTo(-1_769_000 / 1081, 3);
    expect(perBlockHour({ lines: DEC, bh: 5 })).toBeNull();
  });

  it('the three biggest changes, cost up is bad, revenue up good', () => {
    const ch = biggestChanges(DEC, NOV);
    expect(ch.map((c) => `${c.label} ${Math.round(c.delta / 1000)} ${c.good ? 'good' : 'bad'}`)).toEqual([
      'One-offs 5425 bad', 'Charters -957 bad', 'Fuel & airports -571 good',
    ]);
    expect(biggestChanges(NOV, NOV)).toEqual([]);
  });
});

describe('v0.20 plain-language tips', () => {
  it('crew pay above the usual share, with too many pilots: points at Crew › Utilisation', () => {
    const tips = financeTips(NOV, 'November', FACTS, label);
    const crew = tips.find((t) => t.id === 'crewShare')!;
    expect(crew.text).toContain('Crew pay is 39% of what you earned in November');
    expect(crew.text).toContain('144 pilots for 7 flying aircraft');
    expect(crew.text).toContain('about 111');
    expect(crew.text).toContain('16 h in the last 4 weeks');
    expect(crew.link).toEqual({ label: 'Crew › Utilisation', tab: 'crew', view: 'use' });
  });

  it('crew right-sized: more block hours, not fewer crew', () => {
    const tips = financeTips(NOV, 'November', { ...FACTS, pilots: { have: 112, need: 111 } }, label);
    expect(tips.find((t) => t.id === 'crewShare')!.link?.tab).toBe('contracts');
  });

  it('cash below zero first, then the one-off; at most three', () => {
    const tips = financeTips(DEC, 'December', { ...FACTS, cashNow: -3_443_108, overdue: 400_000 }, label);
    expect(tips.length).toBe(3);
    expect(tips[0].id).toBe('cashBelow');
    expect(tips[0].link?.view).toBe('debt');
    const one = financeTips(DEC, 'December', FACTS, label).find((t) => t.id === 'oneOff')!;
    expect(one.text).toBe('December had a one-off: Lease return −$5.5M. Without the one-offs you would still have lost $1.8M.');
  });

  it('a good month says so, plainly', () => {
    const good = K({ acmiRevenue: 5000, salaries: -1200, rent: -1000, maintenance: -800 });
    const tips = financeTips(good, 'March', FACTS, label);
    expect(tips.map((t) => t.id)).toContain('goodMonth');
    expect(tips.find((t) => t.id === 'goodMonth')!.text).toBe('A good month: you kept 40 cents of every dollar earned.');
  });
});

describe('v0.20 cash path', () => {
  it('month ends, now, then the forecast; the lease return marked; zero day found', () => {
    const hist = [st(MONTH - 1, NOV, 3_183_000, 1_337_000), st(MONTH, NOV, 1_337_000, 317_000), st(MONTH + 1, DEC, 317_000, -5_684_000)];
    const now = monthStart(MONTH + 2) + 7 * 1440;
    const p = cashPath(hist, MONTH + 2, -3_443_000, now, [{ t: now, cash: -3_443_000 }, { t: now + 1440, cash: -1_000_000 }, { t: now + 2 * 1440, cash: 200_000 }]);
    expect(p.points.map((x) => x.cash)).toEqual([3_183_000, 1_337_000, 317_000, -5_684_000, -3_443_000, -1_000_000, 200_000]);
    expect(p.points.filter((x) => x.ahead).length).toBe(2);
    expect(p.events).toEqual([{ t: monthStart(MONTH + 2), cash: -5_684_000, cat: 'leaseReturn', amount: -5_500_000, month: MONTH + 1 }]);
    expect(p.zeroAt).toBeNull();
    expect(p.backAt).toBe(now + 2 * 1440);
    expect(p.trend3).toBe(-3_443_000 - 3_183_000);
    const q = cashPath(hist, MONTH + 2, 500_000, now, [{ t: now + 1440, cash: 100_000 }, { t: now + 2 * 1440, cash: -50_000 }]);
    expect(q.zeroAt).toBe(now + 2 * 1440);
    expect(cashPath([], MONTH, 10, now, []).points).toEqual([{ t: now, cash: 10, ahead: false }]);
  });
});
