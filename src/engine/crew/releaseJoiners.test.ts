// v0.14.1 (merge, bot seed 2 teleports at Ibiza and Lisbon):
// - Crew Control's fly-in took the out-of-hours crew off EI4041's seats, then found the jet could seat nobody and said
//   so: a refused change is now put back (atomic(…, refused)), never left half-applied.
// - crew placed on a trip after a duty's legs had flown were 'released' where that duty ended (they never flew there).
// - a crew member listed twice on one ride home moved with the first entry and was taken off the flown ride by the
//   second ('never boarded').

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { demoFlights } from '../dev';
import { advanceTo } from '../sim';
import { atomic } from './atomic';
import { addCrew, fixtureGame } from './fixtures';
import { touchCrew } from './timeline';

function withFlights(): GameState {
  const g = fixtureGame(5);
  demoFlights(g, undefined, 3, 'revenue');
  advanceTo(g, g.now + 60);
  return g;
}

describe('v0.14.1 crew changes and releases (merge)', () => {
  it('a change that answers "not possible" is put back, with no safety trip', () => {
    const g = withFlights();
    const p = Object.values(g.pairings).find((x) => x.slots.some((s) => s.crewId))!;
    const before = JSON.stringify(p.slots);
    const cash = g.company.cash;
    const r = atomic(g, 'test', (error) => ({ ok: false as const, error }), () => {
      for (const s of g.pairings[p.id].slots) s.crewId = null;
      g.company.cash -= 1000;
      return { ok: false as const, error: 'Even flown in by jet, nobody is legal for the trip' };
    }, (x) => !x.ok);
    expect(r).toEqual({ ok: false, error: 'Even flown in by jet, nobody is legal for the trip' });
    expect(JSON.stringify(g.pairings[p.id].slots)).toBe(before);
    expect(g.company.cash).toBe(cash);
    // A change that goes through stays.
    atomic<{ ok: boolean; error?: string }>(g, 'test', (error) => ({ ok: false, error }), () => {
      g.company.cash -= 1000;
      return { ok: true };
    }, (x) => !x.ok);
    expect(g.company.cash).toBe(cash - 1000);
  });

  it('crew placed on a trip after its duty flew are not released where that duty ended', () => {
    const g = withFlights();
    const d = Object.values(g.duties).filter((x) => x.report > g.now && x.flightIds.length >= 1 && g.pairings[x.pairingId]?.slots.some((s) => s.crewId)).sort((a, b) => a.report - b.report)[0];
    const p = g.pairings[d.pairingId];
    const last = g.flights[d.flightIds.at(-1)!];
    const from = g.flights[d.flightIds[0]].from;
    advanceTo(g, (last.sta) + 1);
    expect(g.flights[last.id].status).toBe('done');
    expect(g.duties[d.id].done).toBeFalsy();
    // A cabin crew member called in now, at home, for the trip's next work: placed on its seat.
    const [joiner] = addCrew(g, { CC: 1 });
    const c = g.crew[joiner];
    c.loc = from === last.to ? 'OPO' : from;
    const seat = p.slots.find((s) => s.role === 'CC' && s.crewId)!;
    const flewIt = seat.crewId!;
    seat.crewId = joiner;
    touchCrew(g);
    const logs = c.log.length;
    const loc = c.loc;
    advanceTo(g, g.duties[d.id].release + 120);
    expect(g.duties[d.id].done).toBe(true);
    expect(c.loc).toBe(loc);
    expect(c.log.length).toBe(logs);
    // The crew member who flew it is not in the seat any more; the others who flew rest where it ended.
    expect(flewIt).not.toBe(joiner);
    for (const s of p.slots) if (s.crewId && s.crewId !== joiner) expect(g.crew[s.crewId].loc).toBe(g.duties[d.id].restAt);
  });

  it('a crew member listed twice on a ride lands with it and stays on its passenger list', () => {
    const g = withFlights();
    const f = Object.values(g.flights).filter((x) => x.kind === 'revenue' && x.status === 'scheduled' && x.std > g.now + 60).sort((a, b) => a.std - b.std)[0];
    const [id] = addCrew(g, { CC: 1 });
    const c = g.crew[id];
    c.loc = f.from;
    f.riders = [id, id];
    touchCrew(g);
    advanceTo(g, f.sta + 30);
    expect(g.flights[f.id].status).toBe('done');
    expect(c.loc).toBe(f.to);
    expect(g.flights[f.id].riders).toContain(id);
  });
});
