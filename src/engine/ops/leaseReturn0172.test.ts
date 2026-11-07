// v0.17.2 two player reports on lease returns.
// - CS-TCS (bug bmw6lnjpzbdkk): the check dialog said "Going back to the lessor: return check from 23 Apr" on both hubs
//   and would not book the C-check due 15 Feb. The return was years away (no year shown), and a return months away
//   left the player guessing. A C-check due before the return can now be booked; near the return the dialog weighs
//   the ways (book it, fly on, park it, hand it back early) with costs, days lost and one recommendation.
// - "I set a few aircraft to return at the end of the lease, then changed my mind and want to return them early, but
//   after choosing 'return at end of lease' the option is gone": the choice changes until the return check starts.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { Aircraft, GameState } from '../core/types';
import { leased, newGame } from '../contracts/testkit';
import { cCheckOptions } from './cHub';
import { checkBeforeReturn, chooseLease, earlyReturnQuote, returnEarly, returnQuote } from './leaseReturn';
import { cDueAt, disposalWhy } from './maintenance';

const MONTH = 30.44 * DAY;
type Lease = Extract<Aircraft['ownership'], { kind: 'dryLeaseIn' }>;

/** A leased A320 whose C-check falls due in `dueIn` days and whose lease ends in `endIn` days, its return booked. */
function going(dueIn: number, endIn: number, seed = 5): { g: GameState; ac: Aircraft; own: Lease } {
  const g = newGame(seed);
  const ac = leased(g);
  const own = ac.ownership as Lease;
  ac.maint.fhSinceC = 0;
  ac.maint.lastC = g.now + dueIn * DAY - 24 * MONTH;
  own.leaseEnd = g.now + endIn * DAY;
  own.noticeGiven = false;
  const r = chooseLease(g, ac.id, 'return');
  if (!r.ok) throw new Error(r.error);
  return { g, ac, own };
}

const hubOf = (g: GameState, id: string) => {
  const o = cCheckOptions(g, id).find((x) => x.ok)!;
  return { total: o.total, ok: o.ok, awayDays: o.awayDays, start: o.start, end: o.end, city: o.hub.city, why: o.why };
};

describe('v0.17.2 a C-check due before a lease return', () => {
  it('a return years away: the C-check is simply needed and can be booked; the note names the year', () => {
    const { g, ac } = going(90, 4 * 365);
    expect(cDueAt(g, ac)).toBeLessThan(g.maintenance[ac.returning!.maintId].start);
    expect(disposalWhy(g, ac, 'C')).toBeNull();
    const o = cCheckOptions(g, ac.id);
    expect(o.some((x) => x.ok && x.ferryOut.length > 0)).toBe(true);
    expect(checkBeforeReturn(g, ac.id, hubOf(g, ac.id))).toBeNull();
    // A refit on an aircraft going back is still refused, and the reason carries the year.
    expect(disposalWhy(g, ac)).toMatch(/return check from \d+ \w{3} \d{4}/);
  });

  it('a return five months away: book it, fly on the tolerance, park it, or hand it back early; booking recommended when it costs less', () => {
    const { g, ac } = going(90, 160);
    const cbr = checkBeforeReturn(g, ac.id, hubOf(g, ac.id))!;
    expect(cbr).not.toBeNull();
    expect(cbr.ways.map((w) => w.id)).toEqual(['book', 'fly', 'park', 'early']);
    const [book, fly, park, early] = cbr.ways;
    expect(book.ok).toBe(true);
    // Not done, the lessor has it done at the return on our money (the reserves pay their share).
    expect(cbr.atReturn).toBe(Math.round(BAL.checkCost.C[0] * (1 - BAL.cReserveCover)));
    expect(returnQuote(g, ac.id)!.lines.map((l) => l.label)).toContain('C-check due before the return');
    expect(fly.ok).toBe(cbr.groundedAt >= cbr.stop);
    expect(park.idle).toBe(Math.round((cbr.stop - cbr.due) / DAY));
    // Under 90 days of the lease would be left: the lessor won't take it back early.
    expect(early.ok).toBe(false);
    expect(early.lines[0]).toMatch(/won't: it would leave under 90 days/);
    expect(cbr.recommend).toBe(book.cost <= cbr.atReturn ? 'book' : cbr.recommend);
    expect(cbr.why.length).toBeGreaterThan(10);
  });

  it('a return before the C-check falls due: no C-check needed, none can be booked', () => {
    const { g, ac } = going(200, 100);
    expect(disposalWhy(g, ac, 'C')).toMatch(/before the C-check is due/);
    expect(cCheckOptions(g, ac.id).every((o) => !o.ok)).toBe(true);
    expect(checkBeforeReturn(g, ac.id)).toBeNull();
  });

  it('the C-check due at the return is judged when it stops flying, not a week into the return check', () => {
    // Due 95 days before the lease end: at the end it is past the 10 % tolerance (73 days), but still inside it on the
    // day it goes in for the return check (the lessor's check follows): the check is ours.
    const { g, ac, own } = going(400, 400 + 75);
    void own;
    const q = returnQuote(g, ac.id)!;
    expect(q.lines.map((l) => l.label)).toContain('C-check due before the return');
  });
});

describe('v0.17.2 the lease-end choice changes until the return starts', () => {
  it('a return booked at the lease end can become an early return, go back to the lease end, or be extended', () => {
    const { g, ac, own } = going(600, 400);
    const end0 = own.leaseEnd;
    const q = earlyReturnQuote(g, ac.id);
    expect(q.ok).toBe(true);
    expect(q.end).toBeLessThan(end0);
    const r = returnEarly(g, ac.id, q.end);
    expect(r.ok).toBe(true);
    expect(own.leaseEnd).toBe(q.end);
    expect(ac.returning?.wasEnd).toBe(end0);
    expect(ac.returning?.earlyFee).toBe(q.fee);
    // Only one return check booked.
    expect(Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && m.kind === 'return' && m.status === 'planned').length).toBe(1);
    // Moved again: a month later.
    const q2 = earlyReturnQuote(g, ac.id, q.end + 30 * DAY);
    expect(q2.ok).toBe(true);
    expect(returnEarly(g, ac.id, q2.end).ok).toBe(true);
    expect(own.leaseEnd).toBe(q2.end);
    expect(ac.returning?.wasEnd).toBe(end0);
    // Back to the lease end: no fee, the original end.
    expect(chooseLease(g, ac.id, 'return').ok).toBe(true);
    expect(own.leaseEnd).toBe(end0);
    expect(ac.returning?.wasEnd).toBeUndefined();
    expect(ac.returning?.earlyFee).toBeUndefined();
    expect(Object.values(g.maintenance).filter((m) => m.aircraftId === ac.id && m.kind === 'return' && m.status === 'planned').length).toBe(1);
    // Or extended: the return goes.
    expect(chooseLease(g, ac.id, 'extend12').ok).toBe(true);
    expect(ac.returning).toBeUndefined();
    expect(own.leaseEnd).toBeGreaterThan(end0 + 11 * MONTH);
  });

  it('a failed early booking leaves the booked return as it was', () => {
    const { g, ac, own } = going(600, 400);
    const m0 = ac.returning!.maintId;
    const end0 = own.leaseEnd;
    expect(returnEarly(g, ac.id, g.now + 5 * DAY).ok).toBe(false);
    expect(ac.returning?.maintId).toBe(m0);
    expect(own.leaseEnd).toBe(end0);
  });
});
