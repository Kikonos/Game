// v0.19.2 the route builder's pure helpers; the spec sheet's range discs (v0.19.5 the globe again).

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { ACMI_TYPES_LIST } from '../../../data/acmiTypes';
import { rangeFromNm } from '../../../engine/core/perf';
import { DISC_FILL, discExtentDeg, discSvg, nmToDeg } from '../../specs/rangeDiscs';
import { rightsWord, searchAirports } from './networkLogic';

describe('v0.19.2 airport search', () => {
  it('finds by code, city and country, best first; never a fuel-stop field', () => {
    expect(searchAirports('BOS')[0].code).toBe('BOS');
    expect(searchAirports('lisbon')[0].code).toBe('LIS');
    expect(searchAirports('lis', ['LIS']).some((a) => a.code === 'LIS')).toBe(false);
    const pt = searchAirports('portugal', [], 20);
    expect(pt.length).toBeGreaterThan(3);
    expect(pt.every((a) => a.country === 'PT')).toBe(true);
    expect(searchAirports('a')).toEqual([]);
    for (const a of searchAirports('island', [], 50)) expect(AIRPORT_BY_CODE[a.code].enroute).toBeFalsy();
  });
  it('traffic rights in words', () => {
    expect(rightsWord(0)).toMatch(/Open skies/);
    expect(rightsWord(0.6)).toMatch(/Very hard/);
  });
});

describe('v0.19.5 range discs (report bmwalwl3kkqo9): the globe, zoomed to the range', () => {
  const pts = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  it('every type from the five cities: the whole range inside the disc with a margin, closed, the city at the centre', () => {
    const size = 132;
    const c = size / 2;
    const r = c - 1.5;
    for (const t of ACMI_TYPES_LIST) {
      for (const code of ['LIS', 'LHR', 'JFK', 'DXB', 'SIN', 'PEK', 'SYD', 'GRU']) {
        const a = AIRPORT_BY_CODE[code];
        const nm = rangeFromNm(t.id, code);
        const svg = discSvg(a.lat, a.lon, nm, size);
        expect(svg).toContain('rd-svg globe');
        const d = /class="rd-range" d="([^"]+)"/.exec(svg)![1];
        // One closed shape (the boundary never runs off the disc: no second piece along its edge).
        expect(d.match(/M/g)!.length, `${t.id} ${code}`).toBe(1);
        expect(d.trim().endsWith('Z')).toBe(true);
        const dist = pts(d).map(([x, y]) => Math.hypot(x - c, y - c));
        // Inside with a margin, and zoomed to it (not a small ring in a big world), unless the range is the whole world.
        expect(Math.max(...dist), `${t.id} ${code}`).toBeLessThanOrEqual(r * DISC_FILL + 0.6);
        if (nmToDeg(nm) / DISC_FILL < 180) expect(Math.min(...dist), `${t.id} ${code}`).toBeGreaterThanOrEqual(r * DISC_FILL - 0.6);
        expect(svg).toContain(`class="rd-city" cx="${c}" cy="${c}"`);
      }
    }
  });
  it('the map fills the disc: its clip circle is the rim (no blank band above a pole)', () => {
    expect(discExtentDeg(2565)).toBeCloseTo(nmToDeg(2565) / DISC_FILL);
    expect(discExtentDeg(300)).toBe(40);
    expect(discExtentDeg(9000)).toBe(180);
    expect(discSvg(51.47, -0.45, 2700, 132)).not.toContain('rd-void');
  });
});
