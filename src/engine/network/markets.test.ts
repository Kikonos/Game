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
import { hireHead, unlockHead } from '../ops/heads';
import {
  caseAdvice, caseDraft, catalogueFor, chainOf, chainProblem, customMarket, devLaunchRoute, localMonth, marketFareX, monthsWords, project, routeMonthCosts, routeResting,
  seasonMonths, seriesDates,
} from '.';

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

// v0.23.2 review: Tenerife from Vilnius, Riga and Tallinn could not pay on any narrowbody (−43 to −61 % on the A320),
// because the timetable flew all year through a summer when almost nobody goes. A market with a dead season is now
// planned, costed and flown for its season only.
describe('v0.23.2 a seasonal route flies its season only', () => {
  const mk = (id: string) => ROUTE_MARKETS.find((m) => m.id === id)!;
  const OCT_APR = [0, 1, 2, 3, 9, 10, 11].reduce((a, i) => a | (1 << i), 0);

  it('the season of a market: winter sun October to April, the beach in summer, none where people travel all year', () => {
    for (const id of ['VNO-TFS', 'RIX-TFS', 'TLL-TFS', 'RIX-SSH', 'TLL-HRG']) {
      expect(seasonMonths(mk(id)), id).toBe(OCT_APR);
      expect(monthsWords(seasonMonths(mk(id))!), id).toBe('Oct–Apr');
    }
    expect(monthsWords(seasonMonths(mk('PRG-HER'))!)).toBe('May–Oct');
    expect(monthsWords(seasonMonths(mk('VNO-AYT'))!)).toBe('Apr–Oct');
    // Families, business and the islands of Cabo Verde fly all year; so does every market of Lisbon's and every pair
    // nobody researched.
    for (const m of ROUTE_MARKETS.filter((x) => x.from === 'LIS' || x.from === 'OPO')) expect(seasonMonths(m), m.id).toBeNull();
    for (const id of ['VNO-LTN', 'MLA-MAN', 'SOF-FRA', 'TLL-ARN', 'PRG-TFS']) expect(seasonMonths(mk(id)), id).toBeNull();
    for (const [a, b] of [['MLA', 'CAG'], ['PRG', 'IST'], ['LIS', 'FNC'], ['RIX', 'AYT']]) expect(seasonMonths(customMarket({ from: a, to: b })!), `${a}-${b}`).toBeNull();
    expect(monthsWords(4095)).toBe('All year');
    expect(monthsWords(0b100000000001)).toBe('Dec–Jan');
    expect(monthsWords(0b000110110000)).toBe('May–Jun, Aug–Sep');
  });

  it('the business case plans the season: no flights out of it, and Tenerife from the Baltics pays on a new narrowbody', () => {
    for (const id of ['VNO-TFS', 'RIX-TFS', 'TLL-TFS']) {
      const g = game(id.slice(0, 3));
      const rid = devLaunchRoute(g, id);
      const r = g.network!.routes[rid];
      const d0 = caseDraft(g, rid)!;
      expect(d0.season, id).toBe(true);
      const year = (typeId: string, season: boolean) => {
        const d = { ...d0, typeId, layout: 'two-class' as const };
        if (!season) delete d.season;
        return project(g, r, d, g.now + 30 * DAY, 1);
      };
      const all = year('a320ceo', false);
      const ceo = year('a320ceo', true);
      const neo = year('a320neo', true);
      // Five months of the year without a flight, a seat or a passenger; the station kept, at a cost.
      const quiet = ceo.months.filter((x) => x.seats === 0);
      expect(quiet.length, id).toBe(5);
      for (const x of quiet) {
        expect(x.rev, id).toBe(0);
        expect(x.cost, id).toBeGreaterThan(0);
      }
      expect(ceo.rotations, id).toBeLessThan(all.rotations * 0.65);
      // Far better than flying it all year (it lost 43–61 %), and it pays on an A320neo; the older A320 is short of
      // payload at six hours and still loses a little.
      expect(ceo.result, id).toBeGreaterThan(all.result + 700_000);
      expect(ceo.result / ceo.rev, id).toBeGreaterThan(-0.25);
      expect(neo.result, id).toBeGreaterThan(0);
      expect(neo.result / neo.rev, id).toBeLessThan(0.2);
      r.status = 'closed';
    }
    // A market with no dead season has no such plan.
    const g = game('VNO');
    const rid = devLaunchRoute(g, 'VNO-LTN');
    expect(caseDraft(g, rid)!.season).toBeUndefined();
  });

  it('the timetable flies in the season only, starts in it, and the route rests at half its station cost', () => {
    const g = game('RIX');
    const rid = devLaunchRoute(g, 'RIX-TFS');
    const r = g.network!.routes[rid];
    const s = r.series[0];
    expect(s.months).toBe(OCT_APR);
    // The game starts in March: the first flight is in March or April, never in the summer.
    expect(OCT_APR & (1 << localMonth('RIX', r.firstFlight!))).toBeTruthy();
    const dates = seriesDates(g, r, s);
    expect(dates.length).toBeGreaterThan(20);
    for (const dep of dates) expect(OCT_APR & (1 << localMonth('RIX', dep)), String(dep)).toBeTruthy();
    // The same series flown all year has about 52 dates.
    expect(seriesDates(g, r, { ...s, months: undefined }).length).toBeGreaterThan(dates.length + 15);
    for (const rot of r.rotations) expect(OCT_APR & (1 << localMonth('RIX', rot.dep))).toBeTruthy();
    // July: resting. January: flying.
    const july = g.started + 130 * DAY;
    const jan = g.started + 320 * DAY;
    expect(routeResting(r, july)).toBe(true);
    expect(routeResting(r, jan)).toBe(false);
    const on = routeMonthCosts(r, false);
    const off = routeMonthCosts(r, true);
    expect(off.routeSetup).toBe(Math.round(on.routeSetup! / 2));
    expect(off.marketing).toBe(0);
    expect(on.marketing).toBeGreaterThan(0);
    // A route flown all year never rests.
    const r2 = g.network!.routes[devLaunchRoute(g, 'RIX-OSL')];
    expect(r2.series[0].months).toBeUndefined();
    expect(routeResting(r2, july)).toBe(false);
  });

  it('the analyst names the season when the plan flies all year', () => {
    const g = game('TLL');
    unlockHead(g, 'analyst', true);
    hireHead(g, 'analyst', 2);
    const rid = devLaunchRoute(g, 'TLL-HRG');
    const r = g.network!.routes[rid];
    r.status = 'case';
    const d0 = caseDraft(g, rid)!;
    const allYear = { ...d0 };
    delete allYear.season;
    const a = caseAdvice(g, rid, allYear).list.find((x) => x.key === 'season');
    expect(a?.title).toBe('Fly Oct–Apr only');
    expect(a?.patch).toEqual({ season: true });
    expect(a!.gain).toBeGreaterThan(100_000);
    expect(caseAdvice(g, rid, { ...d0, season: true }).list.find((x) => x.key === 'season')).toBeUndefined();
  });
});

