// v0.12.1 (Round F, C12): salaries were paid for the whole month to a crew member who joined on its last day (April paid
// $11,750 for crew who joined at its end), and nothing for the part month of one who left. Now pro rata: from the day
// they join (payFrom), and a leaver is paid the days worked before the record goes.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY, monthKey, monthStart } from '../core/time';
import { fixtureGame } from './fixtures';
import { monthlySalaries, paidShare, payLeaver } from './costs';

describe('salaries pro rata (C12)', () => {
  it('a joiner on the last day of a 30-day month is paid one day of it, with on-costs', () => {
    const g = fixtureGame(5);
    const k = monthKey(g.now) + 1; // April (the game starts 1 March)
    const a = monthStart(k);
    const b = monthStart(k + 1);
    expect((b - a) / DAY).toBe(30);
    for (const c of Object.values(g.crew)) c.status = 'joining';
    const c = Object.values(g.crew)[0];
    c.status = 'available';
    c.payFrom = b - DAY;
    expect(paidShare(c, a, b)).toBeCloseTo(1 / 30, 9);
    g.now = b;
    const before = g.finance.current.lines.salaries ?? 0;
    monthlySalaries(g);
    expect(before - (g.finance.current.lines.salaries ?? 0)).toBe(Math.round((c.salary / 30) * (1 + BAL.onCosts)));
  });

  it('a leaver on the 15th of a 30-day month is paid half a month', () => {
    const g = fixtureGame(5);
    const k = monthKey(g.now) + 1;
    const a = monthStart(k);
    const c = Object.values(g.crew)[0];
    c.status = 'available';
    g.now = a + 15 * DAY;
    const before = g.finance.current.lines.salaries ?? 0;
    payLeaver(g, c);
    expect(before - (g.finance.current.lines.salaries ?? 0)).toBe(Math.round(c.salary * 0.5 * (1 + BAL.onCosts)));
  });
});
