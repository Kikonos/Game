// v0.23.2 the researched markets of every start base (data/markets/): the data is whole (airports, stations, seasons,
// segments, rivals), each start fleet flies at least four of its base's markets nonstop, and the game's own business
// case gives each base a believable spread: flights 45–95 % full, some markets that pay and some that lose.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { distanceNm } from '../core/geo';
import { HOME_BASES } from '../../data/naming';
import { ROUTE_MARKETS, ROUTE_STATIONS } from '../../data/routes';
import { START_SETUPS } from '../../data/setups';
import { WORLD_ZONES } from '../../data/worldZones';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { caseDraft, catalogueFor, chainOf, chainProblem, devLaunchRoute, marketFareX, project } from '.';

const country = (code: string) => AIRPORT_BY_CODE[code]?.country;
const fromBase = (base: string) => ROUTE_MARKETS.filter((m) => country(m.from) === country(base));
const NEW_BASES = HOME_BASES.filter((b) => b !== 'LIS');
const game = (base: string) => createGame({ name: 'Blue Charter', code: 'BC', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base, seed: 3 });

describe('v0.23.2 the researched markets of every start base', () => {
  it('every start base lists at least five markets of its own; Lisbon keeps its thirteen', () => {
    for (const base of HOME_BASES) {
      const list = catalogueFor(game(base));
      expect(list.length, base).toBeGreaterThanOrEqual(5);
      expect(list.map((m) => m.id), base).toEqual(fromBase(base).map((m) => m.id));
      for (const m of list) expect(m.id.startsWith(`${m.from}-`), m.id).toBe(true);
    }
    expect(catalogueFor(game('LIS')).length).toBe(13);
    expect(ROUTE_MARKETS.length).toBe(68);
  });

  it('the data is whole: airports, stations, seasons, segments, rivals, fares, timetable', () => {
    for (const base of NEW_BASES) {
      for (const m of fromBase(base)) {
        const tag = m.id;
        expect(m.id, tag).toBe(`${m.from}-${m.to}`);
        for (const c of new Set([...chainOf(m, 'out'), ...chainOf(m, 'back')])) {
          expect(AIRPORT_BY_CODE[c], `${tag} airport ${c}`).toBeDefined();
          expect(ROUTE_STATIONS[c], `${tag} station ${c}`).toBeDefined();
          expect(ROUTE_STATIONS[c].code).toBe(c);
        }
        expect(AIRPORT_BY_CODE[m.to].city === m.city || m.city.length > 2, tag).toBe(true);
        for (const s of [m.season, m.seasonBack]) {
          if (!s) continue;
          expect(s.length, tag).toBe(12);
          expect(s.reduce((a, b) => a + b, 0), tag).toBeCloseTo(12, 1);
          expect(Math.min(...s), tag).toBeGreaterThanOrEqual(0);
        }
        expect(Object.values(m.segments).reduce((a, b) => a + (b ?? 0), 0), tag).toBeCloseTo(1, 2);
        expect(m.models, tag).toContain(m.model);
        expect(!!m.partner, tag).toBe(m.models.includes('partner'));
        expect(m.odPerYear, tag).toBeGreaterThan(1_000);
        expect(m.outShare, tag).toBeGreaterThan(0.2);
        expect(m.outShare, tag).toBeLessThan(0.8);
        expect(m.competitors.length, tag).toBeGreaterThan(0);
        for (const c of m.competitors) {
          expect(c.perWeek > 0 && c.seats > 0 && c.hours > 0 && c.fareX > 0.4 && c.fareX < 1.6, `${tag} ${c.name}`).toBe(true);
          expect(c.stops === 0 ? c.via === undefined : true, `${tag} ${c.name}`).toBe(true);
          if (c.via) expect(AIRPORT_BY_CODE[c.via], `${tag} ${c.name} via ${c.via}`).toBeDefined();
        }
        expect(m.fareY[0], tag).toBeLessThan(m.fareY[1]);
        expect(m.fareJ[0], tag).toBeLessThan(m.fareJ[1]);
        expect(m.fareJ[0], tag).toBeGreaterThan(m.fareY[0]);
        // The fares are net ones: a multiple undoes the engine's discount on published fares (1 … 1.75).
        expect(marketFareX(m), tag).toBeGreaterThanOrEqual(1);
        expect(marketFareX(m), tag).toBeLessThanOrEqual(1.75);
        expect(m.timetable.day >= 0 && m.timetable.day <= 6 && m.timetable.out >= 0 && m.timetable.out < 1_440, tag).toBe(true);
        const km = distanceNm(m.from, m.to) * 1.852;
        // EU261: within the EU every flight over 1,500 km pays the middle band; else the long band starts at 3,500 km.
        if (km <= 3_400) expect(m.eu261, tag).toBe('mid');
        expect(m.navPerSector, tag).toBeGreaterThan(0);
        expect(m.blurb.length, tag).toBeGreaterThan(20);
        expect(m.blurb.length, tag).toBeLessThanOrEqual(110);
        expect(m.blurb, tag).not.toMatch(/Lisbon|Portugal/);
        expect(m.closed, tag).toBeUndefined();
      }
    }
    // The airports the markets added, and Benghazi in Libya's zone.
    for (const c of ['BEN', 'TNG', 'RMF']) expect(AIRPORT_BY_CODE[c]?.region, c).toBe('NAF');
    expect(AIRPORT_BY_CODE.TLL.runwayM).toBe(3_480);
    expect(AIRPORT_BY_CODE.VVI.runwayM).toBe(3_500);
    expect(WORLD_ZONES.find((z) => z.id === 'libya')?.airports).toContain('BEN');
  });

  it('every start fleet flies at least four of its base\'s markets nonstop; each base has one for a widebody later', () => {
    const startTypes = [...new Set(START_SETUPS.flatMap((s) => s.fleet.map((a) => a.typeId)))];
    for (const base of NEW_BASES) {
      const list = fromBase(base);
      for (const typeId of startTypes) {
        const ok = list.filter((m) => !m.via && !chainProblem(m, typeId));
        expect(ok.length, `${base} ${typeId}: ${ok.map((m) => m.id).join(' ')}`).toBeGreaterThanOrEqual(4);
      }
      expect(list.some((m) => startTypes.every((t) => chainProblem(m, t)) && ['b763', 'a332'].some((t) => !chainProblem(m, t))), base).toBe(true);
    }
  });

  it('the business case on the start aircraft: flights 45–95 % full; every base has markets that pay and markets that lose', () => {
    for (const base of NEW_BASES) {
      const g = game(base);
      const typeId = 'a320ceo';
      let pays = 0, loses = 0;
      for (const m of fromBase(base)) {
        if (chainProblem(m, typeId)) continue;
        const id = devLaunchRoute(g, m.id);
        const r = g.network!.routes[id];
        expect(r, `${m.id}: ${id}`).toBeDefined();
        const d0 = caseDraft(g, id)!;
        expect(d0, m.id).toBeTruthy();
        // The best of one, two and three a week (a thin market and a partner keep their own pattern).
        const pats = d0.monthly || (d0.every ?? 1) > 1 || r.model === 'partner' ? [null] : [1, 2, 3];
        let best: ReturnType<typeof project> | null = null;
        for (const n of pats) {
          const d = { ...d0, typeId, layout: 'two-class' as const };
          if (n) { d.days = [4, 2, 0].slice(0, n).reduce((a, x) => a | (1 << x), 0); d.every = 1; delete d.monthly; }
          const p = project(g, r, d, g.now + 30 * DAY, 1);
          if (!best || p.result > best.result) best = p;
        }
        const lf = best!.paxSec / best!.seatSec;
        const margin = best!.result / best!.rev;
        expect(lf, `${m.id} load factor`).toBeGreaterThanOrEqual(0.45);
        expect(lf, `${m.id} load factor`).toBeLessThanOrEqual(0.95);
        // Nothing is a gold mine (Lisbon's best on this aircraft is about 20 %), nothing is absurd.
        expect(margin, `${m.id} margin`).toBeLessThanOrEqual(0.3);
        expect(margin, `${m.id} margin`).toBeGreaterThanOrEqual(-0.7);
        if (margin > 0.02) pays++;
        if (margin < -0.02) loses++;
        r.status = 'closed';
      }
      expect(pays, `${base} markets that pay`).toBeGreaterThanOrEqual(2);
      expect(loses, `${base} markets that lose`).toBeGreaterThanOrEqual(1);
    }
  }, 120_000);
});
