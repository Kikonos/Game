// Leftover-breach round (27 Oct 2026), widebody bot seed 1 (365 d): a tour's last duty was re-planned away after its
// other duties had flown; the tour stayed 'active' and a week later a cabin crew member who left the company still held
// its seat. A trip whose last open duty goes with every other one flown is over (done), as when its last duty releases.

import { describe, expect, it } from 'vitest';
import { addFlight, markFlightsChanged } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import { advanceTo, settle } from '../sim';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster } from './roster';

describe('a trip whose last open duty goes after the others flew', () => {
  it('is over (done): a crew member leaving the company later is in no active trip’s seat', () => {
    const g = fixtureGame(31);
    const acId = Object.keys(g.fleet)[0];
    const ac = g.fleet[acId];
    ac.at = 'LIS';
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
    const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
    const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 3 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } });
    // A night stop at Funchal: out on day 1, back on day 2 (one trip, two duties).
    const out = addFlight(g, { no: 'AW940', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
    const back = addFlight(g, { no: 'AW941', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std + DAY, sta: std + DAY + b, pax: 160 });
    buildDuties(g, acId, g.now, g.now + 5 * DAY);
    for (const id of addCrew(g, { CPT: 2, FO: 2, PUR: 1, CC: 3 })) g.crew[id].off = [];
    autoRoster(g);
    const d1 = g.duties[g.flights[out.id].dutyId!];
    const p = g.pairings[d1.pairingId];
    expect(p.dutyIds.length).toBe(2);
    // Day 1 flown; then the way back is given to another operator (cancelled for us) before it flies.
    while (!d1.done && g.now < std + DAY) advanceTo(g, g.now + 30);
    expect(d1.done).toBe(true);
    expect(p.status).toBe('active');
    g.flights[back.id].status = 'cancelled';
    markFlightsChanged(g, acId, g.now);
    settle(g);
    expect(p.dutyIds.every((id) => g.duties[id]?.done)).toBe(true);
    expect(p.status).toBe('done');
  });
});
