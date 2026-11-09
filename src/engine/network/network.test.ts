// v0.19 step 0 (UPDATE-0.19.md §S): the network skeleton is in place and neutral — the state on a new game and on an
// old save, hooks that do nothing without routes, a consistent catalogue.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { ROUTE_MARKETS, ROUTE_STATIONS, routeStation } from '../../data/routes';
import { BAL } from '../core/balance';
import { distanceNm } from '../core/geo';
import { COST_CATS, REVENUE_CATS } from '../core/ledger';
import { maxSectorNm, runwayFit } from '../core/perf';
import { DAY } from '../core/time';
import { fixture } from '../fixtures/compatKit';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo, MODULES } from '../sim';
import { dailyNetwork, loadNetwork, monthlyNetwork, routesOn } from '.';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('v0.19 step 0: state and load', () => {
  it('a new game has an empty network', () => {
    const g = newGame();
    expect(g.network).toEqual({ routes: {}, stats: { launched: 0, rotations: 0, pax: 0, swaps: 0, subs: 0, moves: 0, cancels: 0, downgrades: 0 } });
    expect(routesOn(g)).toEqual([]);
    expect(MODULES.map((m) => m.name)).toContain('network');
  });

  it('an old save loads with the same empty network, and a new game and a reloaded one serialise alike', () => {
    const old = deserialize(fixture('v0162-blu2003'));
    expect(old.network?.routes).toEqual({});
    const g = newGame(4);
    advanceTo(g, g.now + 10 * DAY);
    const a = serialize(g);
    const state = (s: string) => JSON.stringify(JSON.parse(s).state);
    expect(state(serialize(deserialize(a)))).toBe(state(a));
  });

  it('every hook does nothing without routes (no money, no rolls)', () => {
    const g = newGame(5);
    const before = JSON.stringify({ cash: g.company.cash, lines: g.finance.current.lines, rng: g.rng });
    dailyNetwork(g);
    monthlyNetwork(g);
    loadNetwork(g);
    expect(JSON.stringify({ cash: g.company.cash, lines: g.finance.current.lines, rng: g.rng })).toBe(before);
  });

  it('the ledger knows the route lines', () => {
    for (const c of ['ticketRevenue', 'cargoRevenue', 'ancillaryRevenue'] as const) expect(REVENUE_CATS).toContain(c);
    for (const c of ['handling', 'catering', 'paxServices', 'navCharges', 'distribution', 'marketing', 'paxComp', 'routeSetup'] as const) expect(COST_CATS).toContain(c);
    expect(BAL.v019.on).toBe(true);
    expect(BAL.v019.ops.materialiseDays).toBe(120);
  });
});

describe('v0.19 the catalogue', () => {
  it('every airport and station exists, ids are unique, shares add up', () => {
    const ids = new Set<string>();
    for (const m of ROUTE_MARKETS) {
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
      expect(m.id).toBe(`${m.from}-${m.to}`);
      for (const c of [m.from, m.to, ...(m.via ?? []), ...(m.viaBack ?? [])]) {
        expect(AIRPORT_BY_CODE[c], c).toBeDefined();
        expect(ROUTE_STATIONS[c], c).toBeDefined();
      }
      const seg = Object.values(m.segments).reduce((s, x) => s + x, 0);
      expect(seg).toBeCloseTo(1, 2);
      expect(m.models).toContain(m.model);
      expect(m.fareY[0]).toBeLessThan(m.fareY[1]);
      expect(m.fareJ[0]).toBeGreaterThan(m.fareY[0]);
      for (const s of [m.season, m.seasonBack]) if (s) expect(s).toHaveLength(12);
    }
    expect(routeStation('ZZZ').code).toBe('ZZZ');
  });

  it('the three Euro Atlantic routes fly on a 767: OXB and TMS nonstop, DIL out via DXB and back via KUL and DXB', () => {
    for (const id of ['LIS-OXB', 'LIS-TMS']) {
      const m = ROUTE_MARKETS.find((x) => x.id === id)!;
      expect(distanceNm(m.from, m.to)).toBeLessThan(maxSectorNm('b763', m.from, m.to));
      expect(distanceNm(m.to, m.from)).toBeLessThan(maxSectorNm('b763', m.to, m.from));
    }
    const dil = ROUTE_MARKETS.find((x) => x.id === 'LIS-DIL')!;
    const chain = (pts: string[]) => pts.slice(1).map((to, i) => [pts[i], to] as const);
    for (const [a, b] of [...chain([dil.from, ...dil.via!, dil.to]), ...chain([dil.to, ...dil.viaBack!, dil.from])]) {
      expect(runwayFit('b763', a), `${a}`).not.toBe('no');
      expect(distanceNm(a, b), `${a}-${b}`).toBeLessThan(maxSectorNm('b763', a, b));
    }
    // DIL's 1,850 m runway: the 767 can't make Dubai from Dili nonstop (that is why it stops in Kuala Lumpur).
    expect(distanceNm('DIL', 'DXB')).toBeGreaterThan(maxSectorNm('b763', 'DIL', 'DXB'));
  });
});
