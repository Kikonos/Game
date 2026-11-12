// Crew alarm round (Nov 2026), the player's VY1040 BCN–HER 2 Feb: a Barcelona trip's first day ran late and its crew were
// 4 minutes short of the rest before the second (Rest 11:28 < 11:32). All seven came off, the second day was split off,
// and a red alarm said it needed a whole crew 12 h before departure. A trip's next day now waits for its own crew when
// the rest missing is small (at most an hour): its first leg moves by the minutes missing, the crew stay.

import { describe, expect, it } from 'vitest';
import { addFlight, retimeFlight } from '../core/entities';
import { blockMinutes, reportMinutes } from '../core/perf';
import { DAY } from '../core/time';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, flightCrewStatus, rerosterFrom } from './roster';
import { syncDuty } from './duties';
import { touchCrew } from './timeline';

/** LIS–FNC on day 1, a night at Funchal, FNC–LIS on day 2 with `spare` minutes of rest over the 10 h minimum. */
function trip(spare: number) {
  const g = fixtureGame(21);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = 'LIS';
  const rm = reportMinutes(ac.typeId);
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 9 * 60;
  const b = blockMinutes(ac.typeId, 'LIS', 'FNC');
  const release = std + b + rm.post;
  const std2 = release + 10 * 60 + spare + rm.report;
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std2 + DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f1 = addFlight(g, { no: 'AW910', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 170 });
  const f2 = addFlight(g, { no: 'AW911', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'FNC', to: 'LIS', std: std2, sta: std2 + b, pax: 160 });
  buildDuties(g, acId, g.now, g.now + 5 * DAY);
  for (const id of addCrew(g, { CPT: 1, FO: 1, PUR: 1, CC: 3 })) g.crew[id].off = [];
  autoRoster(g);
  return { g, acId, f1, f2 };
}

describe('a trip\'s next day waits a few minutes for its own crew\'s rest (VY1040)', () => {
  it('day one lands 20 minutes late: day two leaves later, the crew stay', () => {
    const { g, acId, f1, f2 } = trip(10);
    const d1 = g.duties[g.flights[f1.id].dutyId!];
    const d2 = g.duties[g.flights[f2.id].dutyId!];
    expect(d1.pairingId).toBe(d2.pairingId);
    const crew = g.pairings[d2.pairingId].slots.map((s) => s.crewId);
    expect(crew.every((id) => !!id)).toBe(true);
    // Day one's leg is held 20 minutes (the rest at Funchal is now 10 minutes short).
    const a = g.flights[f1.id];
    retimeFlight(g, a, a.std + 20, a.sta + 20);
    syncDuty(g, d1, g.pairings[d1.pairingId]);
    touchCrew(g);
    const was = g.flights[f2.id].std;
    rerosterFrom(g, acId, g.now);
    const f = g.flights[f2.id];
    expect(f.std + f.delay - was).toBeGreaterThanOrEqual(10);
    expect(f.std + f.delay - was).toBeLessThanOrEqual(60);
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    expect(p.slots.map((s) => s.crewId)).toEqual(crew);
    expect(flightCrewStatus(g, f.id, { live: false }).level).not.toMatch(/missing|illegal/);
  });
});
