// v0.14.1 (CODE-02) our own legs crew ride on as passengers are never removed as if they were airline tickets. A
// duty retimed past its old release drops its stale ride home (crew/duties.ts syncDuty): for an airline ticket the
// ticket goes; for one of our own flights only this trip's crew come off it, the leg and its passengers stay.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { Duty, Flight } from '../core/types';
import { syncDuty } from './duties';

describe('v0.14.1 own rides are kept when a trip drops them', () => {
  it('a duty retimed past its ride home keeps the ridden leg flying', () => {
    const g = newGame(21);
    const ac = leased(g);
    const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days: 60 });
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    run(g, g.contracts[r.data!.contractId].start + 20 * DAY);
    // A duty still to fly with a ride home on one of our own legs.
    let hit: { d: Duty; ride: Flight } | null = null;
    for (const d of Object.values(g.duties).sort((a, b) => a.report - b.report)) {
      if (d.done || d.report < g.now + 60) continue;
      const ride = d.deadheadIds.map((id) => g.flights[id]).find((f) => f && f.kind !== 'deadhead' && f.status === 'scheduled' && f.std >= d.release && f.riders?.length);
      if (ride) { hit = { d, ride }; break; }
    }
    expect(hit).not.toBeNull();
    const { d, ride } = hit!;
    const p = g.pairings[d.pairingId];
    const crew = p.slots.map((s) => s.crewId).filter((x): x is string => !!x);
    const pax = ride.pax;
    // The duty's legs slip so the new report falls after the ride home has landed.
    const shift = ride.sta - d.report + 60;
    for (const id of d.flightIds) {
      const f = g.flights[id];
      f.std += shift;
      f.sta += shift;
    }
    syncDuty(g, d, p);
    expect(g.flights[ride.id]).toBeDefined();
    expect(g.flights[ride.id].status).toBe('scheduled');
    expect(g.flights[ride.id].pax).toBe(pax);
    expect(d.deadheadIds).not.toContain(ride.id);
    for (const id of crew) expect(g.flights[ride.id].riders ?? []).not.toContain(id);
  });
});
