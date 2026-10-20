// Cross-module plumbing the builders rely on: pauses, deadheads, reassign/sub-charter, change marks,
// pure read APIs and compact saves (DESIGN.md §3.3, §4.1–4.2, §7.2).

import { describe, expect, it } from 'vitest';
import { acceptOffer, contractProgress, feasibility, feasibilityAll, generateOffer, productValue } from '../contracts';
import { crewAvailability, crewWindows, flightCrewStatus, hireQuote, rosterOf, staffing } from '../crew';
import { demoFlights } from '../dev';
import { createGame } from '../newGame';
import { aogChance, cashForecast, checkStatus } from '../ops';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { addDeadhead, flightsOf, reassignFlights, retimeFlight, subcharterFlights, takeFlightChanges } from './entities';
import { requestPause, takePause } from './pause';
import { compactQueue } from './queue';
import { DAY } from './time';
import type { Archetype, GameState } from './types';

const newGame = (seed = 11): GameState =>
  createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('auto-pause', () => {
  it('keeps every reason and returns the highest honoured one', () => {
    requestPause('monthEnd');
    requestPause('crewShortage');
    expect(takePause(new Set(['crewShortage', 'aog']))).toBe('crewShortage');
    requestPause('monthEnd');
    expect(takePause(new Set(['aog']))).toBeNull();
    // dropped, not leaked into the next event
    expect(takePause()).toBeNull();
  });

  it('advanceTo stops only on honoured reasons', () => {
    const g = newGame();
    const target = g.now + 40 * DAY;
    const res = advanceTo(g, target, new Set(['aog']));
    expect(res.pause).toBeNull();
    expect(g.now).toBe(target);
  });
});

describe('flight helpers', () => {
  it('deadheads arrive without an aircraft and are marked done', () => {
    const g = newGame();
    const crewIds = Object.keys(g.crew).slice(0, 3);
    const f = addDeadhead(g, { crewIds, from: 'LIS', to: 'HAM', std: g.now + 60, sta: g.now + 260, cost: 750 });
    expect(g.queue.filter((e) => e.id === f.id).map((e) => e.type)).toEqual(['flight.arr']);
    advanceTo(g, g.now + 300);
    expect(g.flights[f.id].status).toBe('done');
  });

  it('reassigns and sub-charters flights, marking the aircraft for crew re-sync', () => {
    const g = newGame();
    demoFlights(g, undefined, 2);
    const [a, b] = Object.keys(g.fleet);
    const fa = flightsOf(g, a).filter((f) => f.status === 'scheduled');
    takeFlightChanges(g);
    reassignFlights(g, [fa[0].id], b);
    expect(g.flights[fa[0].id].aircraftId).toBe(b);
    expect(flightsOf(g, b).some((f) => f.id === fa[0].id)).toBe(true);
    const ch = takeFlightChanges(g);
    expect([...ch.keys()].sort()).toEqual([a, b].sort());
    subcharterFlights(g, [fa[1].id], 'rival1');
    expect(g.flights[fa[1].id].aircraftId).toBeNull();
    expect(g.flights[fa[1].id].operatedBy).toBe('rival1');
    retimeFlight(g, fa[2], fa[2].std + 30, fa[2].sta + 30);
    expect(takeFlightChanges(g).get(a)).toBeDefined();
    advanceTo(g, g.flights[fa[1].id].sta + 1, new Set());
    expect(g.flights[fa[1].id].status).toBe('done');
  });
});

describe('determinism of read APIs', () => {
  it('reads and quotes never touch state or the RNG', () => {
    const g = newGame();
    demoFlights(g, undefined, 3);
    for (const a of ['seasonBase', 'adhoc', 'repatriation'] as Archetype[]) generateOffer(g, a);
    // B1: a signed contract so contractProgress has something to read.
    const first = Object.values(g.offers).find((o) => feasibilityAll(g, o.id)[0]?.level !== 'no');
    if (first) acceptOffer(g, first.id, [feasibilityAll(g, first.id)[0].aircraftId]);
    advanceTo(g, g.now + 2 * DAY);
    const before = JSON.stringify(g);
    const t = g.now;
    for (let i = 0; i < 100; i++) {
      for (const o of Object.values(g.offers)) {
        feasibilityAll(g, o.id);
        for (const id of Object.keys(g.fleet)) feasibility(g, o.id, id);
        productValue(o.product, o.estBH, o.start, o.end);
      }
      for (const c of Object.values(g.contracts)) contractProgress(g, c.id);
      for (const ac of Object.values(g.fleet)) {
        checkStatus(g, ac);
        aogChance(g, ac, ac.at);
      }
      for (const f of Object.values(g.flights)) flightCrewStatus(g, f.id);
      for (const c of Object.values(g.crew).slice(0, 10)) {
        crewWindows(g, c, t);
        rosterOf(g, c.id, t, t + 14 * DAY);
      }
      crewAvailability(g, 'A320', 'a320ceo', t, t + 30 * DAY, 200);
      hireQuote(g, { role: 'FO', family: 'A320', base: 'LIS', count: 2 });
      staffing(g);
      cashForecast(g, 90);
    }
    expect(JSON.stringify(g)).toBe(before);
  });
});

describe('saves', () => {
  it('drop stale queue events and still round-trip', () => {
    const g = newGame();
    demoFlights(g, undefined, 2);
    const f = flightsOf(g, Object.keys(g.fleet)[0])[0];
    retimeFlight(g, f, f.std + 20, f.sta + 20);
    const loaded = deserialize(serialize(g));
    expect(loaded.queue.length).toBe(compactQueue(g).length);
    expect(loaded.queue.length).toBeLessThan(g.queue.length);
    expect(loaded.queue.filter((e) => e.id === f.id)).toHaveLength(1);
  });
});
