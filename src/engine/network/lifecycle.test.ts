// v0.24.1 a live route's lifecycle: suspend (fly or refund the booked), resume, wind down (fly the booked, then close)
// and close now, with their quotes, the slot lapse, the money through the ledger and a save mid wind-down.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import type { Route } from './types';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { closeRoute, devLaunchRoute, quoteRouteLife, resumeRoute, routeActions, routeMonthCosts, suspendRoute, windDownRoute } from '.';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const biggest = (g: GameState) => Object.values(g.fleet).sort((a, b) => b.cabin.total - a.cabin.total)[0];
const run = (g: GameState, days: number) => {
  const end = g.now + days * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
};
const live = (r: Route) => r.rotations.filter((x) => x.status === 'planned' || x.status === 'flights');
const booked = (r: Route) => live(r).filter((x) => x.sectors.some((s) => s.bookedJ + s.bookedY > 0));

/** A route on sale three weeks, so the next departures carry bookings and later ones are empty. */
function setup(seed: number) {
  const g = newGame(seed);
  const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
  run(g, 21);
  const r = g.network!.routes[id];
  return { g, r, id };
}

describe('v0.24.1 route lifecycle', () => {
  it('quotes: booked and empty rotations, refund cost against flying cost, wind down vs close', () => {
    const { g, id } = setup(21);
    const q = quoteRouteLife(g, id);
    expect(q.ok).toBe(true);
    expect(q.booked).toBeGreaterThan(0);
    expect(q.empty).toBeGreaterThan(0);
    expect(q.pax).toBeGreaterThan(0);
    expect(q.refunds).toBeGreaterThan(0);
    expect(q.refundCost).toBe(q.refunds + q.comp - q.subBack);
    expect(q.flyCost).toBeGreaterThan(0);
    expect(q.saved).toBe(Math.round(q.refundCost - q.flyCost - q.flyOverhead));
    expect(q.lastFlight).toBeGreaterThan(g.now);
    expect(q.monthSuspended).toBeLessThan(q.monthNow);
    expect(q.slotsKeep).toBe(q.lastFlight! + BAL.v019.life.slotHoldDays * DAY);
    expect(routeActions(g.network!.routes[id])).toEqual(['suspend', 'windDown', 'close']);
  });

  it('close now: every rotation not flown goes, tickets refunded, the cost as quoted, the route closed', () => {
    const { g, r, id } = setup(22);
    const q = quoteRouteLife(g, id);
    const cash0 = g.company.cash;
    const comp0 = g.finance.current.lines.paxComp ?? 0;
    expect(closeRoute(g, id)).toBeNull();
    expect(r.status).toBe('closed');
    expect(live(r).length).toBe(0);
    expect(r.unearned).toBeLessThanOrEqual(1);
    // Refunds leave as cash, passenger costs go through the statement.
    expect(Math.abs((g.finance.current.lines.paxComp ?? 0) - comp0 + q.comp)).toBeLessThanOrEqual(2);
    expect(cash0 - g.company.cash).toBeGreaterThanOrEqual(q.refunds - 2);
    expect(closeRoute(g, id)).toMatch(/closed/);
    run(g, 5);
    expect(r.status).toBe('closed');
  });

  it('suspend and refund: booked rotations cancelled, empty ones dropped free; half station cost, no marketing', () => {
    const { g, r, id } = setup(23);
    const q = quoteRouteLife(g, id);
    const cancels0 = g.network!.stats.cancels;
    expect(suspendRoute(g, id, true)).toBeNull();
    expect(r.status).toBe('suspended');
    expect(live(r).length).toBe(0);
    // Only the booked ones count as cancellations (the empty filed ones are withdrawn).
    expect(g.network!.stats.cancels - cancels0).toBe(q.booked);
    const full = routeMonthCosts({ ...r, status: 'operating', suspended: undefined });
    const half = routeMonthCosts(r);
    expect(half.routeSetup).toBe(Math.round((full.routeSetup ?? 0) / 2));
    expect(half.marketing).toBe(0);
    expect(r.suspended!.slotsUntil).toBe(q.slotsRefund);
    expect(routeActions(r)).toEqual(['resume', 'windDown', 'close']);
  });

  it('suspend and fly the booked: no refunds, the booked rotations fly, no new sales; the slots lapse and the route closes', () => {
    const { g, r, id } = setup(24);
    const keep = booked(r).map((x) => x.id);
    const cash0 = g.company.cash;
    expect(suspendRoute(g, id, false)).toBeNull();
    expect(live(r).map((x) => x.id)).toEqual(keep);
    expect(g.company.cash).toBe(cash0);
    const pax0 = keep.map((k) => r.rotations.find((x) => x.id === k)!.sectors[0].bookedY);
    run(g, 3);
    // No new bookings while suspended.
    const still = keep.map((k) => r.rotations.find((x) => x.id === k)!).filter((x) => x.status === 'planned' || x.status === 'flights');
    for (const x of still) expect(x.sectors[0].bookedY).toBe(pax0[keep.indexOf(x.id)]);
    const until = r.suspended!.slotsUntil;
    run(g, Math.ceil((until - g.now) / DAY) - 3);
    expect(r.status).toBe('suspended');
    expect(g.messages.some((m) => /slots lapse/.test(m.title))).toBe(true);
    // Every kept rotation flew.
    for (const k of keep) expect(r.rotations.find((x) => x.id === k)?.status).toBe('flown');
    run(g, 5);
    expect(r.status).toBe('closed');
    expect(g.messages.some((m) => /slots lapsed/.test(m.title))).toBe(true);
  });

  it('resume: back on sale, filed from 14 days out, bookings build up again (not instantly full)', () => {
    const { g, r, id } = setup(25);
    suspendRoute(g, id, true);
    run(g, 10);
    expect(resumeRoute(g, id)).toBeNull();
    expect(['onSale', 'operating']).toContain(r.status);
    expect(r.suspended).toBeUndefined();
    const first = live(r)[0];
    expect(first.dep).toBeGreaterThanOrEqual(g.now + 14 * DAY - DAY);
    run(g, 3);
    const lf = (x: typeof first) => (x.sectors[0].bookedJ + x.sectors[0].bookedY) / (x.sectors[0].capJ + x.sectors[0].capY);
    // A fresh launch on the same seed for comparison: the resumed route sells less of the same departure.
    expect(lf(live(r)[0])).toBeLessThan(0.95);
    expect(live(r).some((x) => x.sectors[0].bookedY > 0)).toBe(true);
  });

  it('wind down: no refunds, empty rotations dropped, the booked fly; it closes by itself after the last flight; resume undoes it', () => {
    const { g, r, id } = setup(26);
    const q = quoteRouteLife(g, id);
    const keep = booked(r).map((x) => x.id);
    const cash0 = g.company.cash;
    const cancels0 = g.network!.stats.cancels;
    expect(windDownRoute(g, id)).toBeNull();
    expect(g.company.cash).toBe(cash0);
    expect(g.network!.stats.cancels).toBe(cancels0);
    expect(r.closing?.last).toBe(q.lastFlight);
    expect(live(r).map((x) => x.id)).toEqual(keep);
    expect(routeActions(r)).toEqual(['resume', 'close']);
    // Undo, then wind down again.
    expect(resumeRoute(g, id)).toBeNull();
    expect(r.closing).toBeUndefined();
    expect(windDownRoute(g, id)).toBeNull();
    // Save and load mid wind-down: the same state carries on.
    run(g, 2);
    const g2 = deserialize(serialize(g));
    const r2 = g2.network!.routes[id];
    expect(r2.closing).toEqual(r.closing);
    run(g2, Math.ceil((r2.closing!.last - g2.now) / DAY) + 3);
    expect(r2.status).toBe('closed');
    for (const k of keep) expect(['flown', 'cancelled']).toContain(r2.rotations.find((x) => x.id === k)?.status);
    expect(r2.rotations.filter((x) => x.status === 'flown').length).toBeGreaterThan(0);
    expect(r2.unearned).toBeLessThanOrEqual(1);
    expect(g2.messages.some((m) => /closed/.test(m.title) && /last booked flight/.test(m.body ?? ''))).toBe(true);
    // Nothing new was sold after the wind-down began.
    expect(r2.rotations.every((x) => x.dep <= (r2.closing?.last ?? 0) || x.status !== 'planned')).toBe(true);
  });

  it('wind down with nobody booked closes at once at no cost', () => {
    const g = newGame(27);
    const id = devLaunchRoute(g, 'LIS-OXB', biggest(g).id);
    const r = g.network!.routes[id];
    for (const x of r.rotations) for (const s of x.sectors) { s.bookedJ = 0; s.bookedY = 0; s.sold = 0; }
    r.unearned = 0;
    const cash0 = g.company.cash;
    expect(windDownRoute(g, id)).toBeNull();
    expect(r.status).toBe('closed');
    expect(g.company.cash).toBe(cash0);
  });

  it('deterministic: the same seed and actions give the same money', () => {
    const play = () => {
      const { g, r, id } = setup(28);
      windDownRoute(g, id);
      run(g, 20);
      return JSON.stringify({ cash: g.company.cash, pnl: r.pnl, st: r.status, c: r.closing });
    };
    expect(play()).toBe(play());
  });
});
