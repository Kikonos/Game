// v0.12 Visual B: the Finance 12-month series.
import { describe, expect, it } from 'vitest';
import type { MonthStatement } from '../../engine/core/types';
import { monthSeries, seriesKey } from './financeCharts';

const st = (month: number, rev: number, cost: number, cashEnd: number, closed = true): MonthStatement => ({ month, lines: { charter: rev, fuel: -cost } as never, bh: 0, cashStart: 0, cashEnd, closed });

describe('monthSeries', () => {
  it('ends with this month (cash now), costs as positive amounts, oldest first, at most 12', () => {
    const history = Array.from({ length: 20 }, (_, i) => st(100 + i, 1000 * i, 500, 10_000 + i));
    const pts = monthSeries({ current: st(120, 70, 30, 0, false), history }, 99_000);
    expect(pts).toHaveLength(12);
    expect(pts[0].month).toBe(109);
    expect(pts[11]).toMatchObject({ month: 120, revenue: 70, costs: 30, cash: 99_000, current: true });
    expect(pts[10]).toMatchObject({ month: 119, revenue: 19_000, costs: 500, cash: 10_019, current: false });
  });
  it('works on the first month of a game', () => {
    const pts = monthSeries({ current: st(5, 0, 0, 0, false), history: [] }, 3e6);
    expect(pts).toEqual([{ month: 5, revenue: 0, costs: 0, cash: 3e6, current: true }]);
  });
  it('keys only on what the chart draws (thousands)', () => {
    const a = monthSeries({ current: st(5, 1000, 0, 0, false), history: [] }, 3e6);
    const b = monthSeries({ current: st(5, 1200, 0, 0, false), history: [] }, 3e6 + 100);
    expect(seriesKey(a)).toBe(seriesKey(b));
  });
});
