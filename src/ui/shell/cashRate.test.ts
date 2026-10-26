import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { DAY, daysInMonth, monthStart } from '../../engine/core/time';
import { profitPerDay } from './cashRate';

describe('v0.12 profit per day (top bar)', () => {
  it('spreads the month-end costs over the month: no flying means a red rate', () => {
    const g = newGame();
    g.now = monthStart(g.finance.current.month) + 10 * DAY;
    g.finance.current.lines = {};
    const r = profitPerDay(g)!;
    expect(r.basis).toBe('month');
    expect(r.perDay).toBeLessThan(0);
  });
  it('turns green when the month has earned more than its share of the costs', () => {
    const g = newGame();
    g.now = monthStart(g.finance.current.month) + 10 * DAY;
    g.finance.current.lines = { acmiRevenue: 50_000_000 } as typeof g.finance.current.lines;
    expect(profitPerDay(g)!.perDay).toBeGreaterThan(0);
  });
  it('in the first two days of a month shows last month\'s average', () => {
    const g = newGame();
    const k = g.finance.current.month;
    g.finance.history.push({ ...g.finance.current, month: k - 1, lines: { overhead: -310_000 } as typeof g.finance.current.lines, closed: true });
    g.now = monthStart(k) + 0.5 * DAY;
    const r = profitPerDay(g)!;
    expect(r.basis).toBe('lastMonth');
    expect(r.perDay).toBeCloseTo(-310_000 / daysInMonth(k - 1));
  });
});
