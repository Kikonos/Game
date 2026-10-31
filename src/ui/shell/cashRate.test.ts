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
  it('v0.12.1 a one-off counts once for the month, spread over all its days (S1118: a refit on the 11th)', () => {
    const g = newGame();
    const k = g.finance.current.month;
    g.now = monthStart(k) + 10 * DAY;
    g.finance.current.lines = {};
    const base = profitPerDay(g)!.perDay;
    // A $1.6M refit and $1.44M of compensation on day 10 lower the rate by their month share, not by a tenth each.
    g.finance.current.lines = { refit: -1_600_000, penalties: -1_440_000 } as typeof g.finance.current.lines;
    expect(profitPerDay(g)!.perDay - base).toBeCloseTo(-3_040_000 / daysInMonth(k));
    // A dry lease's month of rent invoiced in advance likewise (not ×3 on day 10).
    g.finance.current.lines = { leaseIncome: 400_000 } as typeof g.finance.current.lines;
    expect(profitPerDay(g)!.perDay - base).toBeCloseTo(400_000 / daysInMonth(k));
    // The month's flying still runs at its daily pace.
    g.finance.current.lines = { charterRevenue: 1_000_000 } as typeof g.finance.current.lines;
    expect(profitPerDay(g)!.perDay - base).toBeCloseTo(100_000);
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
