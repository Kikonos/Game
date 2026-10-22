// v0.5.2 flight types: operating / positioning (full crew) / ferry (pilots only) / deadhead.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { isPilot } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { autoRoster } from '../crew';
import { addCrew, at, fixtureContract, fixtureGame, seasonBase } from '../crew/fixtures';
import { flightCrewAboard, flightType } from './flightType';

function trip(g: GameState) {
  const ac = Object.values(g.fleet)[0];
  ac.at = 'LIS';
  addCrew(g, { CPT: 3, FO: 3, PUR: 3, CC: 9 });
  const c = fixtureContract(g, { aircraftIds: [ac.id], start: at(g, 2), end: at(g, 5), pattern: { kind: 'legs', legs: [] }, archetype: 'adhoc' });
  const mk = (kind: Flight['kind'], from: string, to: string, d: number, hhmm: number, blk: number) =>
    addFlight(g, { no: `X${d}${hhmm}`, aircraftId: ac.id, contractId: c.id, kind, from, to, std: at(g, d, hhmm), sta: at(g, d, hhmm) + blk });
  const posIn = mk('positioning', 'LIS', 'ZAG', 2, 10 * 60, 185);
  const r1 = mk('revenue', 'ZAG', 'SVQ', 3, 8 * 60, 195);
  const r2 = mk('revenue', 'SVQ', 'ZAG', 3, 12 * 60, 195);
  const posOut = mk('positioning', 'ZAG', 'LIS', 4, 10 * 60, 185);
  return { ac, posIn, r1, r2, posOut };
}

describe('flight types', () => {
  it('predicts types before the roster: legs into revenue work carry the cabin, trailing ones are ferries', () => {
    const g = fixtureGame(41);
    g.company.policies.autoRoster = false;
    const t = trip(g);
    expect(flightType(g, t.posIn)).toBe('positioning');
    expect(flightType(g, t.r1)).toBe('operating');
    expect(flightType(g, t.posOut)).toBe('ferry');
  });

  it('the roster flies the trailing empty leg with pilots only; the cabin crew deadhead home and log no duty on it', () => {
    const g = fixtureGame(42);
    const t = trip(g);
    autoRoster(g, { aircraftIds: [t.ac.id], to: g.now + 10 * DAY });
    expect(flightType(g, t.posIn)).toBe('positioning');
    expect(flightType(g, t.r2)).toBe('operating');
    expect(flightType(g, t.posOut)).toBe('ferry');
    const revCrew = t.r2.crewIds.map((id) => g.crew[id]);
    expect(revCrew.some((c) => !isPilot(c.role))).toBe(true);
    expect(t.posIn.crewIds.some((id) => !isPilot(g.crew[id].role))).toBe(true);
    // Ferry: pilots only.
    expect(t.posOut.crewIds.length).toBeGreaterThan(0);
    expect(t.posOut.crewIds.every((id) => isPilot(g.crew[id].role))).toBe(true);
    // The revenue trip's cabin crew have a ticket home (deadhead), not a seat on the ferry.
    const cabin = revCrew.filter((c) => !isPilot(c.role)).map((c) => c.id);
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.from === 'ZAG');
    for (const id of cabin) expect(tickets.some((f) => f.crewIds.includes(id)), id).toBe(true);
    expect(flightCrewAboard(g, t.posOut).operating.every((id) => isPilot(g.crew[id].role))).toBe(true);
    expect(flightType(g, tickets[0])).toBe('deadhead');
    // The trip's pilots fly on (their ticket home is dropped).
    expect([...t.posOut.crewIds].sort()).toEqual(revCrew.filter((c) => isPilot(c.role)).map((c) => c.id).sort());
  });

  it('a maintenance ferry on its own is a ferry', () => {
    const g = fixtureGame(43);
    const ac = Object.values(g.fleet)[0];
    ac.at = 'FAO';
    const f = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'FAO', to: 'LIS', std: at(g, 1, 9 * 60), sta: at(g, 1, 9 * 60) + 70 });
    autoRoster(g, { aircraftIds: [ac.id] });
    expect(flightType(g, f)).toBe('ferry');
  });

  it('into a deployment from an outstation: a pilots-only ferry; the tour cabin crew deadhead to the base', () => {
    const g = fixtureGame(44);
    addCrew(g, { CPT: 4, FO: 4, PUR: 4, CC: 12 });
    const ac = Object.values(g.fleet)[0];
    const c = seasonBase(g, ac.id, 'HAM', 'PMI', [6 * 60, 13 * 60], 21);
    ac.at = 'ZAG';
    const posIn = addFlight(g, { no: 'AWL1', aircraftId: ac.id, contractId: c.id, kind: 'positioning', from: 'ZAG', to: 'HAM', std: c.start - 10 * 60, sta: c.start - 10 * 60 + 110 });
    autoRoster(g, { aircraftIds: [ac.id], to: g.now + 14 * DAY });
    expect(flightType(g, posIn)).toBe('ferry');
    expect(posIn.crewIds.length).toBeGreaterThan(0);
    expect(posIn.crewIds.every((id) => isPilot(g.crew[id].role))).toBe(true);
    const first = Object.values(g.flights).filter((f) => f.kind === 'revenue' && f.crewIds.length).sort((a, b) => a.std - b.std)[0];
    const cabin = first.crewIds.filter((id) => !isPilot(g.crew[id].role));
    expect(cabin.length).toBeGreaterThan(0);
    expect(Object.values(g.flights).some((f) => f.kind === 'deadhead' && f.to === 'HAM' && cabin.some((id) => f.crewIds.includes(id)))).toBe(true);
  });
});
