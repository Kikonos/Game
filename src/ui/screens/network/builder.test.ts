// v0.19.2 the route builder's pure helpers and the spec sheet's flat range discs.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { discCentreLat, discSvg, discWidthDeg } from '../../specs/rangeDiscs';
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

describe('v0.19.2 flat range discs', () => {
  it('a flat map in the circle, centred on the city, the geodesic range drawn', () => {
    const svg = discSvg(38.78, -9.13, 3000, 132);
    expect(svg).toContain('rd-svg flat');
    expect(svg).toContain('clipPath');
    expect(svg).toMatch(/class="rd-range" d="M[^"]{20,}"/);
    // The city sits on the vertical centre line (centred on its longitude) and, at this range, on the centre.
    const m = /class="rd-city" cx="([\d.]+)" cy="([\d.]+)"/.exec(svg)!;
    expect(Number(m[1])).toBeCloseTo(66, 0);
    expect(Number(m[2])).toBeCloseTo(66, 0);
    expect(discSvg(38.78, -9.13, 3000, 132)).toBe(svg);
  });
  it('no empty polar caps: a long range near the pole moves the centre towards the equator', () => {
    expect(discWidthDeg(500)).toBe(70);
    expect(discWidthDeg(20_000)).toBe(240);
    expect(discCentreLat(38.8, 70)).toBeCloseTo(38.8);
    expect(discCentreLat(64, 240)).toBe(0);
    expect(Math.abs(discCentreLat(60, 160))).toBeLessThanOrEqual(30);
  });
});
