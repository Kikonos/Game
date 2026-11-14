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

  it('a rolling window that starts inside a day counts that day\'s flying pro rata (not the whole day)', () => {
    const g = newGame();
    const ac = owned(g);
    // The record covers 40 days back; 10 sold hours on each day.
    const today = Math.floor(g.now / DAY);
    ac.bookSince = today - 40;
    ac.deliveredAt = Math.min(ac.deliveredAt, (today - 40) * DAY);
    ac.bookDays = Array.from({ length: 41 }, (_, i) => [today - 40 + i, 600] as [number, number]);
    // 21:00 UTC: the 7-day window opens at 21:00 a week ago, 3 h before that day ends.
    g.now = today * DAY + 21 * 60;
    const l7 = by(g, 'last7', [ac.id]);
    // 7 days and 3 hours' worth of a 10 h day: 6 whole days, today (10 h), and 3/24 of the first day.
    expect(l7.bh).toBeCloseTo(6 * 10 + 10 + (10 * 3) / 24, 1);
    expect(l7.hours).toBe(7 * 24);
    // The same rate over 7 and 30 days (it read 7 days higher before: a whole extra day of flying in the week).
    const l30 = by(g, 'last30', [ac.id]);
    expect(Math.abs(l7.share! - l30.share!)).toBeLessThan(0.01);
    // An aircraft that arrived inside the window keeps its whole first day (it flew nothing for us before).
    const b = { ...ac, id: 'nb', deliveredAt: (today - 3) * DAY + 18 * 60, bookSince: undefined, bookDays: [[today - 3, 120], [today - 2, 600]] as [number, number][] };
    g.fleet.nb = b;
    expect(by(g, 'last7', ['nb']).bh).toBeCloseTo(2 + 10, 1);
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
