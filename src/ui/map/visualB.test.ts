// v0.12 Visual B: sky phases from the sun's real elevation; label thinning on the map; airline-leg silhouettes.
import { describe, expect, it } from 'vitest';
import { skyAt } from '../components/SkyArt';
import { airlineType } from './airlineTypes';
import { thinLabels } from './mapLogic';
import { SIL_TYPES } from './silhouettes';
import { skyPhase } from './sky';

/** Game minute of a UTC date (game minutes count from 1 Jan 2000 00:00 UTC). */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(2000, 0, 1)) / 60_000;

describe('sky phase', () => {
  it('reads day above +6°, night below −6°, dawn or dusk between by the sun rising or setting', () => {
    expect(skyPhase(30, true)).toBe('day');
    expect(skyPhase(6, false)).toBe('day');
    expect(skyPhase(5.9, true)).toBe('dawn');
    expect(skyPhase(5.9, false)).toBe('dusk');
    expect(skyPhase(-6, false)).toBe('dusk');
    expect(skyPhase(-6.1, true)).toBe('night');
    expect(skyPhase(-40, false)).toBe('night');
  });
  it('follows the local sun at an airport (Lisbon, 15 March 2027)', () => {
    expect(skyAt('LIS', at(2027, 3, 15, 13))).toBe('day');
    expect(skyAt('LIS', at(2027, 3, 15, 2))).toBe('night');
    expect(skyAt('LIS', at(2027, 3, 15, 6, 45))).toBe('dawn'); // sunrise ~07:10 UTC
    expect(skyAt('LIS', at(2027, 3, 15, 18, 55))).toBe('dusk'); // sunset ~18:40 UTC
  });
  it('is the local time, not UTC: noon UTC is night in Auckland and day in Lisbon', () => {
    expect(skyAt('AKL', at(2027, 3, 15, 12))).toBe('night');
    expect(skyAt('LIS', at(2027, 3, 15, 12))).toBe('day');
  });
});

describe('map label thinning', () => {
  const reg = (ac: string, x: number, y: number) => ({ id: `${ac}:reg`, ac, x, y, w: 50, h: 12 });
  const tag = (ac: string, x: number, y: number) => ({ id: `${ac}:tag`, ac, x, y, w: 40, h: 11 });
  it('keeps the selected aircraft labels even under a pile of others', () => {
    const pile = [reg('a', 100, 100), reg('b', 104, 102), reg('c', 98, 99), tag('b', 100, 80), tag('c', 101, 81), reg('sel', 101, 100), tag('sel', 100, 80)];
    const kept = thinLabels(pile, 'sel', new Set());
    expect(kept.has('sel:reg')).toBe(true);
    expect(kept.has('sel:tag')).toBe(true);
    expect(['a:reg', 'b:reg', 'c:reg', 'b:tag', 'c:tag'].filter((id) => kept.has(id))).toEqual([]);
  });
  it('thins overlapping labels to one each, keeps the ones apart, and holds the one shown before', () => {
    const ls = [reg('a', 100, 100), reg('b', 110, 102), reg('c', 400, 100)];
    expect([...thinLabels(ls, undefined, new Set())].sort()).toEqual(['a:reg', 'c:reg']);
    // b was showing last frame: it keeps its place (no flicker as a arrives)
    expect([...thinLabels(ls, undefined, new Set(['b:reg']))].sort()).toEqual(['b:reg', 'c:reg']);
    // a parked label (fixed) beats an airborne one passing over it
    expect([...thinLabels(ls, undefined, new Set(['a:reg']), new Set(['b:reg']))].sort()).toEqual(['b:reg', 'c:reg']);
  });
  it('a selected aircraft keeps its labels whatever else is fixed', () => {
    const ls = [reg('p', 100, 100), reg('s', 100, 100)];
    expect(thinLabels(ls, 's', new Set(['p:reg']), new Set(['p:reg'])).has('s:reg')).toBe(true);
  });
});

describe('airline legs carrying our crew', () => {
  it('draw the carrier’s own type: a 737 for 737 operators, an A320 otherwise, a widebody on a long leg', () => {
    expect(airlineType('FR', 'STN', 'DUB')).toBe('b738');
    expect(airlineType('U2', 'LIS', 'LGW')).toBe('a320ceo');
    expect(airlineType('ZZ', 'LIS', 'MAD')).toBe('a320ceo');
    expect(airlineType('EK', 'DXB', 'LIS')).toBe('b77w');
    expect(airlineType('ZZ', 'LIS', 'GRU')).toBe('a333');
    for (const t of ['b738', 'a320ceo', 'b77w', 'a333', 'a359', 'a346', 'b789', 'a35k', 'a339', 'b788', 'b772', 'a332']) expect(SIL_TYPES).toContain(t);
  });
});

describe('map label thinning around icons', () => {
  it('never lays a label over another aircraft (fixed icon boxes), but beside its own', () => {
    const icon = (ac: string, x: number, y: number) => ({ id: `${ac}:i`, ac, x, y, w: 18, h: 18 });
    const reg = (ac: string, x: number, y: number) => ({ id: `${ac}:reg`, ac, x, y, w: 50, h: 12 });
    const ls = [icon('a', 100, 100), reg('a', 100, 112), icon('b', 100, 125), reg('b', 100, 137)];
    const kept = thinLabels(ls, undefined, new Set(), new Set(['a:i', 'b:i']));
    expect(kept.has('a:reg')).toBe(false);
    expect(kept.has('b:reg')).toBe(true);
    expect(thinLabels(ls, 'a', new Set(), new Set(['a:i', 'b:i'])).has('a:reg')).toBe(true);
  });
});
