// v0.15.1 (perf) the app-only read caches: problem look-ups and an offer's quick reports answer from a cache between
// engine steps, never inside one, and start over after a player edit or when the state's revisions move.
import { describe, expect, it } from 'vitest';
import { quickReports } from '../contracts/feasibility';
import { legsOffer, newGame } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { problemAt } from '../problems';
import { advanceTo } from '../sim';
import { DAY, HOUR, dayStart } from './time';
import { asStep, enableReadCache, readCache, touchUi } from './uiRev';

// The switch is global to the module: this file turns it on; other test files run in their own workers and never see it.
describe('v0.15.1 read-side caches', () => {
  it('is off until the app enables it, and off inside an engine step', () => {
    const g = newGame();
    const t = dayStart(g.now) + 12 * DAY + 8 * HOUR;
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * HOUR]], 150);
    expect(readCache()).toBe(false);
    const a = quickReports(g, o.id);
    const b = quickReports(g, o.id);
    expect(a).not.toBe(b); // fresh each time while off
    enableReadCache();
    expect(readCache()).toBe(true);
    const c = quickReports(g, o.id);
    expect(quickReports(g, o.id)).toBe(c); // shared while nothing changed
    asStep(() => expect(readCache()).toBe(false));
    expect(asStep(() => quickReports(g, o.id))).not.toBe(c); // an engine step computes afresh
  });

  it('starts over after a player edit, a flight change or a new game hour', () => {
    const g = newGame();
    enableReadCache();
    const t = dayStart(g.now) + 12 * DAY + 8 * HOUR;
    // A 280-seat job with an A320 fleet: a fit card ('seats') from the start.
    const big = legsOffer(g, [['LIS', 'FAO', t + 30], ['FAO', 'LIS', t + 3 * HOUR + 30]], 280);
    const r0 = quickReports(g, big.id);
    expect(quickReports(g, big.id)).toBe(r0);
    const c0 = problemAt(g, { kind: 'offer', id: big.id });
    expect(c0).not.toBeNull();
    expect(problemAt(g, { kind: 'offer', id: big.id })).toBe(c0); // cached while nothing changed
    touchUi();
    expect(quickReports(g, big.id)).not.toBe(r0);
    const c1 = problemAt(g, { kind: 'offer', id: big.id });
    expect(c1).not.toBe(c0);
    expect(c1).toEqual(c0);
    // A flight change (new legs on the schedule) moves the revisions: fresh without any edit mark.
    const r1 = quickReports(g, big.id);
    asStep(() => demoFlights(g, undefined, 1, 'revenue'));
    expect(quickReports(g, big.id)).not.toBe(r1);
    expect(problemAt(g, { kind: 'offer', id: big.id })).not.toBe(c1);
    // The next game hour computes afresh (advanceTo is a step itself; the look-up after it sees a new hour).
    const r2 = quickReports(g, big.id);
    expect(quickReports(g, big.id)).toBe(r2);
    advanceTo(g, g.now + HOUR);
    expect(quickReports(g, big.id)).not.toBe(r2);
  });
});
