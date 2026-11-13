// Every start base (player report: an airline based at Malta was shown Lisbon's markets and its network planner
// suggested nothing). The catalogue lists only the markets from our own bases; the planner has a shortlist from every
// start base on every start setup; route costs and text name the route's own base, not Lisbon; Lisbon games keep
// their list as it was.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { LIS_MARKETS, LIS_STATIONS } from '../../data/markets/lis';
import { MAD_MARKETS } from '../../data/markets/mad';
import { MLA_MARKETS } from '../../data/markets/mla';
import { PRG_MARKETS } from '../../data/markets/prg';
import { RIX_MARKETS } from '../../data/markets/rix';
import { SOF_MARKETS } from '../../data/markets/sof';
import { TLL_MARKETS } from '../../data/markets/tll';
import { VNO_MARKETS } from '../../data/markets/vno';
import { HOME_BASES } from '../../data/naming';
import { ROUTE_MARKETS, ROUTE_STATIONS, routeStation, type RouteMarket } from '../../data/routes';
import { tieBetween } from '../../data/routeTies';
import { START_SETUPS } from '../../data/setups';
import { BAL } from '../core/balance';
import type { GameState } from '../core/types';
import { createGame } from '../newGame';
import { hireHead, unlockHead } from '../ops/heads';
import { deserialize, serialize } from '../save';
import {
  catalogueFor, chainProblem, customId, customMarket, devLaunchRoute, marketFareX, marketOfRoute, quoteMoveRotation, routeBases, routeIdeas, routeIdeasNone, sectorCost,
  startStudy, studyBlock,
} from '.';
import type { SetupId } from '../../data/setups';

const game = (base: string, setup: SetupId = 'classic', seed = 3): GameState =>
  createGame({ name: 'Blue Charter', code: 'BC', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base, seed, setup });
const withPlanner = (g: GameState): GameState => { unlockHead(g, 'netPlanner', true); hireHead(g, 'netPlanner', 2); return g; };
const country = (code: string) => AIRPORT_BY_CODE[code]?.country;
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** Lisbon's list before the catalogue was split by base: ids in order, and the data's fingerprint. */
const LIS_IDS = ['LIS-OXB', 'LIS-TMS', 'LIS-DIL', 'LIS-RAI', 'LIS-SID', 'LIS-BVC', 'LIS-LAD', 'LIS-MPM', 'LIS-REC', 'LIS-FOR', 'OPO-RAI', 'OPO-OXB', 'LIS-CCS'];
const LIS_MARKETS_SHA = '45df5a96ca340d359c7d8d8ffeb23f8398e249e8273f320fdfba45187189c08b';
const LIS_STATIONS_SHA = '54acb193e2a650fe81c132e0283f4cc7a70f33e6f038eb01f902336a1e2c7e55';
const LIS_STATION_CODES = ['LIS', 'OPO', 'OXB', 'TMS', 'DIL', 'DXB', 'KUL', 'RAI', 'SID', 'BVC', 'LAD', 'MPM', 'REC', 'FOR', 'CCS'];

const BY_BASE: Record<string, RouteMarket[]> = {
  LIS: LIS_MARKETS, VNO: VNO_MARKETS, MLA: MLA_MARKETS, MAD: MAD_MARKETS, RIX: RIX_MARKETS, PRG: PRG_MARKETS, SOF: SOF_MARKETS, TLL: TLL_MARKETS,
};

describe('the catalogue by start base', () => {
  it('a Lisbon game lists exactly what it listed before: the same markets in the same order, the same numbers', () => {
    const g = game('LIS');
    expect(routeBases(g)).toEqual(['LIS', 'OPO']);
    expect(catalogueFor(g).map((m) => m.id)).toEqual(LIS_IDS);
    expect(LIS_MARKETS.map((m) => m.id)).toEqual(LIS_IDS);
    expect(sha(LIS_MARKETS)).toBe(LIS_MARKETS_SHA);
    // The stations too (the lounge flag is new: Lisbon's lounge was a line of code before).
    expect(sha(LIS_STATION_CODES.map((c) => { const { lounge: _l, ...st } = ROUTE_STATIONS[c]; void _l; return st; }))).toBe(LIS_STATIONS_SHA);
    expect(Object.keys(LIS_STATIONS)).toEqual(LIS_STATION_CODES);
    for (const [code, st] of Object.entries(LIS_STATIONS)) expect(st.code).toBe(code);
    // The catalogue starts with Lisbon's markets, whatever the other bases add behind them.
    expect(ROUTE_MARKETS.slice(0, LIS_IDS.length).map((m) => m.id)).toEqual(LIS_IDS);
  });

  it('every start base has its own file; its markets leave from its own country; stations are listed once', () => {
    expect(Object.keys(BY_BASE).sort()).toEqual([...HOME_BASES].sort());
    for (const base of HOME_BASES) {
      for (const m of BY_BASE[base]) {
        expect(country(m.from), `${m.id} leaves from ${base}'s country`).toBe(country(base));
        expect(m.custom, m.id).toBeUndefined();
      }
      // The home station is researched: a caterer of ours and cargo security, whatever the airport's size.
      const st = ROUTE_STATIONS[base];
      expect(st, base).toBeDefined();
      expect(st.caterer && st.euCargo, base).toBe(true);
    }
    expect(ROUTE_MARKETS.length).toBe(Object.values(BY_BASE).reduce((n, l) => n + l.length, 0));
    expect(new Set(ROUTE_MARKETS.map((m) => m.id)).size).toBe(ROUTE_MARKETS.length);
    for (const [code, st] of Object.entries(ROUTE_STATIONS)) expect(st.code).toBe(code);
  });

  it('every start base lists only the markets from its own bases: no market from another country', () => {
    for (const base of HOME_BASES) {
      const g = game(base);
      const bases = routeBases(g);
      expect(bases[0]).toBe(base);
      for (const b of bases) expect(country(b), `${base}: ${b}`).toBe(country(base));
      const list = catalogueFor(g);
      for (const m of list) {
        expect(bases, `${base} lists ${m.id}`).toContain(m.from);
        expect(country(m.from), `${base} lists ${m.id}`).toBe(country(base));
      }
      expect(list.map((m) => m.id)).toEqual(ROUTE_MARKETS.filter((m) => country(m.from) === country(base)).map((m) => m.id));
      if (base !== 'LIS') {
        expect(bases).not.toContain('LIS');
        expect(bases).not.toContain('OPO');
        expect(list.some((m) => m.from === 'LIS' || m.from === 'OPO')).toBe(false);
      }
    }
  });

  it('a market from a base we do not have cannot be studied; a crew base there opens it', () => {
    const g = game('MLA');
    expect(studyBlock(g, 'LIS-OXB')).toBe('We have no base at Lisbon.');
    expect(startStudy(g, 'LIS-OXB', 'full').why).toBe('We have no base at Lisbon.');
    expect(studyBlock(g, customId({ from: 'LIS', to: 'BOS' }))).toBe('We have no base at Lisbon.');
    expect(studyBlock(g, customId({ from: 'MLA', to: 'BEG' }))).toBeNull();
    expect(studyBlock(game('LIS'), 'LIS-OXB')).toBeNull();
    expect(studyBlock(game('LIS'), 'OPO-RAI')).toBeNull();
    // A crew base at Lisbon makes Lisbon a route base: its markets are listed and can be studied.
    Object.values(g.crew)[0].base = 'LIS';
    expect(routeBases(g)).toEqual(['MLA', 'LIS']);
    expect(catalogueFor(g).filter((m) => m.from === 'LIS').length).toBeGreaterThan(0);
    expect(catalogueFor(g).some((m) => m.from === 'OPO')).toBe(false);
    expect(studyBlock(g, 'LIS-OXB')).toBeNull();
  });

  it('a save from before the rule keeps a route it already has from another base, and loads the same', () => {
    const g = game('MLA');
    Object.values(g.crew)[0].base = 'LIS';
    const res = startStudy(g, 'LIS-OXB', 'full');
    expect(res.routeId).toBeDefined();
    Object.values(g.crew)[0].base = 'MLA';
    const back = deserialize(serialize(g));
    const r = back.network!.routes[res.routeId!];
    expect(marketOfRoute(r)?.id).toBe('LIS-OXB');
    expect(r).toEqual(g.network!.routes[res.routeId!]);
    expect(catalogueFor(back).some((m) => m.from === 'LIS')).toBe(false);
  });
});

describe('route costs and words at any home base', () => {
  it('the business lounge is at the home base, the tanker fuel at the route\'s base; no outstation rule falls on home', () => {
    for (const base of HOME_BASES) {
      const g = game(base);
      const to = base === 'LIS' ? 'BOS' : base === 'MAD' ? 'OTP' : 'LHR';
      const m = customMarket({ from: base, to })!;
      const route = { marketId: m.id, custom: m, model: 'own' as const };
      const typeId = Object.values(g.fleet)[0].typeId;
      const out = sectorCost(g, route, base, to, typeId, null, { j: 8, y: 100, cargoKg: 0, sold: 20_000 });
      const noJ = sectorCost(g, route, base, to, typeId, null, { j: 0, y: 108, cargoKg: 0, sold: 20_000 });
      const C = BAL.v019.cost;
      expect(out.paxServices - noJ.paxServices, base).toBeCloseTo(C.lounge * 8, 6);
      // The way back leaves from the outstation: no lounge of ours there.
      const back = sectorCost(g, route, to, base, typeId, null, { j: 8, y: 100, cargoKg: 0, sold: 20_000 });
      const backNoJ = sectorCost(g, route, to, base, typeId, null, { j: 0, y: 108, cargoKg: 0, sold: 20_000 });
      expect(back.paxServices - backNoJ.paxServices, base).toBeCloseTo(0, 6);
      // Home catering is single (a caterer of ours), whatever the airport's size.
      expect(routeStation(base).caterer, base).toBe(true);
    }
    // Lisbon's lounge stays where a foreign airline with a crew base flies from Lisbon; Porto has none, as before.
    expect(ROUTE_STATIONS.LIS.lounge).toBe(true);
    expect(ROUTE_STATIONS.OPO.lounge).toBeUndefined();
  });

  it('a market\'s own fare multiple is used when the balance table has none; the table wins', () => {
    expect(marketFareX({ id: 'LIS-DIL' })).toBe(BAL.v019.fares.marketX['LIS-DIL']);
    expect(marketFareX({ id: 'LIS-DIL', fareX: 0.5 })).toBe(BAL.v019.fares.marketX['LIS-DIL']);
    expect(marketFareX({ id: 'MLA-XXX', fareX: 0.9 })).toBe(0.9);
    expect(marketFareX({ id: 'MLA-XXX' })).toBe(1);
  });

  it('moving a flight far from its slot names the route\'s own airport', () => {
    const g = game('MLA');
    const rid = devLaunchRoute(g, customId({ from: 'MLA', to: 'BEG' }));
    const r = g.network!.routes[rid];
    expect(r, rid).toBeDefined();
    const rot = r.rotations.find((x) => x.status === 'planned' || x.status === 'flights')!;
    const q = [120, 180, -120, -180, 240].map((d) => quoteMoveRotation(g, rot.id, d)).find((x) => x.ok)!;
    expect(q, 'a legal move').toBeDefined();
    expect(q.notes.join(' ')).toMatch(/Valletta gives a new slot/);
    expect(q.notes.join(' ')).not.toMatch(/Lisbon/);
  });
});

describe('the network planner at every start base', () => {
  it('has at least three ideas from its own base on every start setup, each flyable and worth it', () => {
    for (const base of HOME_BASES) {
      for (const s of START_SETUPS) {
        const g = withPlanner(game(base, s.id));
        const bases = routeBases(g);
        const ideas = routeIdeas(g);
        const tag = `${base} ${s.id}`;
        expect(ideas.length, tag).toBeGreaterThanOrEqual(3);
        expect(ideas.length, tag).toBeLessThanOrEqual(BAL.v019.planner.ideas);
        expect(routeIdeasNone(g), tag).toBeNull();
        for (const x of ideas) {
          expect(bases, `${tag} ${x.marketId}`).toContain(x.from);
          expect(country(x.from), `${tag} ${x.marketId}`).toBe(country(base));
          expect(Object.values(g.fleet).some((a) => a.typeId === x.typeId), `${tag} ${x.marketId}`).toBe(true);
          expect(chainProblem({ from: x.from, to: x.to }, x.typeId), `${tag} ${x.marketId}`).toBeNull();
          expect(x.margin, `${tag} ${x.marketId}`).toBeGreaterThanOrEqual(0.06);
          expect(ROUTE_MARKETS.some((m) => m.from === x.from && m.to === x.to), `${tag} ${x.marketId} is not researched already`).toBe(false);
        }
        // Best first; a city once, a country at most twice.
        expect([...ideas].sort((p, q) => q.result - p.result)).toEqual(ideas);
        const cities = ideas.map((x) => `${country(x.to)}:${AIRPORT_BY_CODE[x.to].city}`);
        expect(new Set(cities).size, tag).toBe(cities.length);
        for (const c of new Set(ideas.map((x) => country(x.to)))) expect(ideas.filter((x) => country(x.to) === c).length, `${tag} ${c}`).toBeLessThanOrEqual(2);
      }
    }
  }, 240_000);

  it('the ideas follow the base\'s own ties: Bulgarians in Germany and Britain, Serbs in Malta, Lithuanians in London', () => {
    // The planner's ideas and the researched markets together (a pair researched later leaves the ideas).
    const tos = (base: string) => { const g = withPlanner(game(base)); return [...routeIdeas(g).map((x) => x.to), ...catalogueFor(g).map((m) => m.to)]; };
    expect(tos('SOF').some((t) => ['GB', 'DE', 'TR'].includes(country(t)!))).toBe(true);
    expect(tos('MLA')).toContain('BEG');
    expect(tos('VNO')).toContain('LHR');
    for (const [a, b] of [['MT', 'IT'], ['LT', 'NO'], ['LV', 'GB'], ['EE', 'SE'], ['CZ', 'SK'], ['BG', 'DE'], ['ES', 'MA']]) expect(tieBetween(a, b), `${a}-${b}`).toBeGreaterThan(0);
  }, 60_000);
});
