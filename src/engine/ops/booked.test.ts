// v0.24 the 'booked' figure: sold flying as a share of the hours an aircraft was ours, back and ahead.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, newGame, owned, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { Flight } from '../core/types';
import { bookedPct, bookedPeriods, loadBooked, noteBooked } from './booked';

const by = (g: Parameters<typeof bookedPeriods>[0], id: string, ids?: string[]) => bookedPeriods(g, ids).find((p) => p.id === id)!;

describe('v0.24 booked', () => {
  it('a new game: nothing flown, nothing booked; shares are 0 or none', () => {
    const g = newGame();
    const ps = bookedPeriods(g);
    expect(ps.map((p) => p.id)).toEqual(['last7', 'last30', 'last90', 'ytd', 'next7', 'next30', 'next90']);
    for (const p of ps.filter((x) => x.past)) expect(p.share ?? 0).toBe(0);
    for (const ac of Object.values(g.fleet)) expect(ac.bookDays).toEqual([]);
  });

  it('only sold legs count: a revenue leg yes, a ferry or positioning leg no', () => {
    const g = newGame();
    const ac = owned(g);
    noteBooked(ac, { kind: 'positioning' } as Flight, 120, g.now);
    noteBooked(ac, { kind: 'ferry' } as Flight, 120, g.now);
    expect(ac.bookDays).toEqual([]);
    noteBooked(ac, { kind: 'revenue' } as Flight, 150, g.now);
    noteBooked(ac, { kind: 'techstop' } as Flight, 30, g.now);
    expect(ac.bookDays).toEqual([[Math.floor(g.now / DAY), 180]]);
  });

  it('a signed base programme is booked ahead past the four weeks filed, and flown back once it has flown', () => {
    const g = newGame();
    const ac = owned(g);
    const start = g.now + 3 * DAY;
    const o = hamBase(g, start, 120, 2);
    const r = acceptOffer(g, o.id, [ac.id]);
    expect(r.ok).toBe(true);
    const n7 = by(g, 'next7', [ac.id]);
    const n90 = by(g, 'next90', [ac.id]);
    expect(n90.bh).toBeGreaterThan(n7.bh);
    // Two HAM–PMI rotations a day (about 2 × 5 h): far more than the four weeks the schedule files.
    expect(n90.bh).toBeGreaterThan(80 * 7);
    expect(n90.share!).toBeGreaterThan(0.25);
    expect(n90.share!).toBeLessThan(0.6);
    run(g, start + 10 * DAY);
    const l7 = by(g, 'last7', [ac.id]);
    expect(l7.bh).toBeGreaterThan(30);
    expect(l7.share!).toBeGreaterThan(0.2);
    expect(l7.perDay!).toBeCloseTo(l7.share! * 24, 0);
    const ytd = by(g, 'ytd', [ac.id]);
    expect(ytd.bh).toBeGreaterThanOrEqual(l7.bh);
    // The fleet line holds this aircraft and the idle ones.
    expect(by(g, 'last7').share!).toBeLessThanOrEqual(l7.share!);
    expect(bookedPct(l7.share)).toMatch(/^\d+ %$/);
    expect(bookedPct(null)).toBe('–');
  }, 60_000);

  it('an older save: the record is rebuilt from the sold legs it still holds', () => {
    const g = newGame();
    const ac = owned(g);
    const start = g.now + 2 * DAY;
    const r = acceptOffer(g, hamBase(g, start, 60, 2).id, [ac.id]);
    expect(r.ok).toBe(true);
    run(g, start + 5 * DAY);
    const kept = ac.bookDays!.reduce((s, d) => s + d[1], 0);
    expect(kept).toBeGreaterThan(0);
    for (const a of Object.values(g.fleet)) { delete a.bookDays; delete a.bookSince; }
    delete g.stats.v024;
    loadBooked(g);
    const rebuilt = ac.bookDays!.reduce((s, d) => s + d[1], 0);
    expect(Math.abs(rebuilt - kept)).toBeLessThan(kept * 0.1);
    expect(ac.bookSince).toBeLessThan(Math.floor(g.now / DAY));
  }, 60_000);
});

describe('v0.24 booked: a record younger than the period says where it begins', () => {
  it('a new game: the last 30 days count from the start', () => {
    const g = newGame();
    g.now += 3 * DAY;
    const p = bookedPeriods(g).find((x) => x.id === 'last30')!;
    expect(p.since).toBeDefined();
    expect(p.since!).toBeGreaterThanOrEqual(g.now - 3 * DAY - DAY);
    expect(p.hours).toBeLessThanOrEqual(Object.keys(g.fleet).length * 4 * 24);
    expect(bookedPeriods(g).find((x) => x.id === 'next30')!.since).toBeUndefined();
  });
});
