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
  catalogueFor, chainProblem, customFacts, customId, customMarket, devLaunchRoute, IDEA_MARGIN, marketFareX, marketOfRoute, quoteMoveRotation, routeBases, routeIdeas,
  routeIdeasKey, routeIdeasNone, sectorCost, sisters, startStudy, studyBlock, TOUR_PULL, UNSERVED_X,
} from '.';
import { devAddType, devGrantApproval } from '../dev';
import { directCarriers } from '../ops/commercial';
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
          expect(x.margin, `${tag} ${x.marketId}`).toBeGreaterThanOrEqual(IDEA_MARGIN);
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

  it('the ideas follow the base\'s own ties: Bulgarians in Germany and Britain, Italians and Britons in Malta, Lithuanians in London', () => {
    // The planner's ideas and the researched markets together (a pair researched later leaves the ideas).
    const tos = (base: string) => { const g = withPlanner(game(base)); return [...routeIdeas(g).map((x) => x.to), ...catalogueFor(g).map((m) => m.to)]; };
    expect(tos('SOF').some((t) => ['GB', 'DE', 'TR'].includes(country(t)!))).toBe(true);
    // Italians and Britons in Malta, Lithuanians in London (researched through Luton: one city, one market).
    expect(tos('MLA').some((t) => ['IT', 'GB'].includes(country(t)!))).toBe(true);
    expect(tos('VNO').some((t) => AIRPORT_BY_CODE[t].city === 'London')).toBe(true);
    for (const [a, b] of [['MT', 'IT'], ['LT', 'NO'], ['LV', 'GB'], ['EE', 'SE'], ['CZ', 'SK'], ['BG', 'DE'], ['ES', 'MA']]) expect(tieBetween(a, b), `${a}-${b}`).toBeGreaterThan(0);
  }, 60_000);
});

// v0.23.2 review: a city's second airport read as "Nobody flies it nonstop" (Malta–Sabiha Gökçen, Prague–Orly); the
// first guesses ran far richer than the researched markets; the list stayed stale after an ETOPS approval.
describe('the planner\'s ideas: one city one market, sober first guesses, a fresh list', () => {
  it('an airline flying nonstop to the city\'s other airport is a nonstop rival, named with its airport', () => {
    for (const [from, to, main, rival] of [['MLA', 'SAW', 'IST', /^Turkish Airlines \(Istanbul Airport\)$/], ['PRG', 'ORY', 'CDG', /^Air France \(Charles de Gaulle\)$/], ['SOF', 'ORY', 'CDG', /\(Charles de Gaulle\)$/], ['LIS', 'SAW', 'IST', /\(Istanbul Airport\)$/]] as const) {
      expect(sisters(to).map((a) => a.code), to).toContain(main);
      const m = customMarket({ from, to })!;
      const there = customMarket({ from, to: main })!.competitors.filter((c) => c.stops === 0);
      const nonstop = m.competitors.filter((c) => c.stops === 0);
      expect(there.length, `${from}-${main}`).toBeGreaterThan(0);
      expect(nonstop.length, m.id).toBe(there.length);
      expect(nonstop.some((c) => rival.test(c.name)), `${m.id}: ${nonstop.map((c) => c.name).join(', ')}`).toBe(true);
      expect(nonstop.reduce((s, c) => s + c.perWeek, 0), m.id).toBe(there.reduce((s, c) => s + c.perWeek, 0));
      // Nobody "connects" at the city itself, and the same airline is not listed twice.
      for (const c of m.competitors.filter((x) => x.stops > 0)) {
        expect(sisters(to).map((a) => a.code), `${m.id} ${c.name}`).not.toContain(c.via);
        expect(nonstop.some((n) => c.name.startsWith(n.name.replace(/ \(.*\)$/, ''))), `${m.id} ${c.name}`).toBe(false);
      }
      expect(m.blurb, m.id).not.toMatch(/no nonstop|no airline/);
    }
    // An airport with nonstop flights of its own keeps its own rivals (Heathrow from Malta, JFK from Lisbon).
    for (const [from, to] of [['MLA', 'LHR'], ['LIS', 'JFK'], ['MLA', 'IST'], ['PRG', 'CDG']] as const) {
      const own = customMarket({ from, to })!.competitors.filter((c) => c.stops === 0);
      expect(own.length, `${from}-${to}`).toBe(directCarriers(from, to).length);
      expect(own.some((c) => /\(/.test(c.name)), `${from}-${to}`).toBe(false);
    }
  });

  it('no idea says "Nobody flies it nonstop" where a sister airport has a nonstop rival; a researched city is no idea', () => {
    for (const base of HOME_BASES) {
      for (const setup of ['classic', START_SETUPS[START_SETUPS.length - 1].id] as SetupId[]) {
        const g = withPlanner(game(base, setup));
        const cat = catalogueFor(g);
        for (const x of routeIdeas(g)) {
          const tag = `${base} ${setup} ${x.marketId}`;
          const all = [x.to, ...sisters(x.to).map((a) => a.code)];
          const flown = all.some((b) => directCarriers(x.from, b).length > 0);
          if (flown) expect(x.why, tag).not.toMatch(/Nobody flies it nonstop/);
          else expect(x.why, tag).toMatch(/Nobody flies it nonstop/);
          expect(cat.some((m) => m.from === x.from && all.includes(m.to)), `${tag} is researched through another airport`).toBe(false);
          // Holidays are sold to a holiday place only.
          if (x.model === 'tour') expect(AIRPORT_BY_CODE[x.to].tour, tag).toBeGreaterThanOrEqual(TOUR_PULL);
        }
      }
    }
  }, 240_000);

  it('a pair nobody flies is guessed smaller than the same cities with a direct flight; ties travel anyway', () => {
    // Prague–Gothenburg, Madrid–Shannon: no airline of our list flies them. Business and holiday travel are cut.
    for (const [a, b, most] of [['PRG', 'GOT', 75_000], ['MAD', 'SNN', 55_000], ['PRG', 'EIN', 70_000]] as const) {
      expect(directCarriers(a, b), `${a}-${b}`).toEqual([]);
      const f = customFacts(a, b)!;
      expect(f.od, `${a}-${b}`).toBeLessThan(most);
      expect(customMarket({ from: a, to: b })!.models, `${a}-${b}`).toEqual(['own']);
    }
    // Sofia–Ankara: unserved too, but the Turkish families of Bulgaria still travel (the ties are not cut).
    const esb = customFacts('SOF', 'ESB')!;
    expect(esb.links).toBeGreaterThan(25_000);
    expect(esb.links / esb.od).toBeGreaterThan(0.35);
    // A served pair keeps its size; a city's second airport is served when the first is.
    expect(customFacts('PRG', 'CPH')!.od).toBeGreaterThan(300_000);
    expect(customFacts('PRG', 'ORY')!.od).toBeGreaterThan(300_000);
    expect(UNSERVED_X).toBeLessThan(1);
    // A holiday island keeps its holiday series.
    expect(customMarket({ from: 'MLA', to: 'CAG' })!.models).toContain('tour');
    // First guesses sit near the researched markets now (Prague's used to be 19–22 %, all "sold as holidays").
    for (const base of HOME_BASES) for (const x of routeIdeas(withPlanner(game(base)))) expect(x.margin, `${base} ${x.marketId}`).toBeLessThan(0.3);
  }, 120_000);

  it('an ETOPS approval won this month changes the list at once (the cache and the screen follow it)', () => {
    const g = withPlanner(game('LIS'));
    devAddType(g, 'b763');
    const k0 = routeIdeasKey(g);
    const before = routeIdeas(g).map((x) => x.marketId);
    for (const id of ['widebody', 'etops120', 'etops180'] as const) devGrantApproval(g, id);
    const k1 = routeIdeasKey(g);
    expect(k1).not.toBe(k0);
    const after = routeIdeas(g).map((x) => x.marketId);
    // The same list a game gets that held the approvals before it first asked.
    const g2 = withPlanner(game('LIS'));
    devAddType(g2, 'b763');
    for (const id of ['widebody', 'etops120', 'etops180'] as const) devGrantApproval(g2, id);
    expect(after).toEqual(routeIdeas(g2).map((x) => x.marketId));
    expect(after).not.toEqual(before);
    // No planner: no key (the screen shows nothing).
    expect(routeIdeasKey(game('LIS'))).toBe('');
  }, 120_000);
});

