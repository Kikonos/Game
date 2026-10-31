// v0.12.1 (review, found re-running seed 1): crew in the air on a ticket out to a trip whose first legs were then
// sub-chartered kept that ticket on the trip's duty: their timeline dropped it, so they were planned from where they took
// off (a PER–MAA ticket and a hotel standby in Perth while they landed in Saigon: 115 invariant errors). A ticket under
// way that no longer goes where the trip starts is their own (loose) ticket: the timeline lands them where it lands.

import { describe, expect, it } from 'vitest';
import { addDeadhead, addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew } from './roster';
import { locAt, segsOf, touchCrew } from './timeline';

describe('a ticket under way to where the trip no longer starts', () => {
  it("leaves the duty and stays on the crew member's timeline", () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'MAD';
    const std = Math.floor(g.now / DAY) * DAY + DAY + 20 * 60;
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'MAD', to: 'LIS', std, sta: std + 80 });
    addCrew(g, { CPT: 1, FO: 1 });
    touchCrew(g);
    const d = buildDuties(g, ac.id, g.now, g.now + 3 * DAY)[0];
    autoRoster(g, {});
    const p = g.pairings[d.pairingId];
    const id = p.slots.find((s) => s.crewId)!.crewId!;
    // In the air on a ticket to Barcelona (the trip used to start there), still listed on the duty.
    const t = addDeadhead(g, { crewIds: [id], from: 'LIS', to: 'BCN', std: g.now - 60, sta: g.now + 60, cost: 0 });
    d.deadheadIds.push(t.id);
    touchCrew(g);
    releaseCrew(g, p, id);
    expect(d.deadheadIds).not.toContain(t.id);
    expect(g.flights[t.id].crewIds).toContain(id);
    expect(locAt(g.crew[id], segsOf(g, g.crew[id]), g.now + 120)).toBe('BCN');
  });
});
