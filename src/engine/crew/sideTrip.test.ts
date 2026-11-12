// v0.22.1 a side trip between the duties of a trip of several days (the cross-check on bot games: crew at an
// outstation with a free day before their trip's next duty read "busy on another trip" for a flight from there).
// A crew flies Lisbon–Düsseldorf on day 1, rests two nights at Düsseldorf and flies home on day 3. On day 2 another
// aircraft's out-and-back from Düsseldorf needs a captain: theirs can take it, and stays at Düsseldorf after it for
// their own flight home (no ticket to Lisbon in between). A flight that overlaps their own duty is still refused.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { acceptable, otherTrip, planCrew } from './check';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster } from './roster';
import { segsOf } from './timeline';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

function twoTrips(sideAt: number): { g: GameState; side: Pairing; cptId: string; own: Pairing } {
  const g = fixtureGame(5);
  const [a1, a2] = Object.keys(g.fleet);
  g.fleet[a1].at = 'LIS';
  g.fleet[a2].at = 'DUS';
  const day0 = Math.floor(g.now / DAY) * DAY + 2 * DAY;
  const b = blockMinutes(g.fleet[a1].typeId, 'LIS', 'DUS');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [a1], start: day0 - DAY, end: day0 + 4 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } as never });
  const out = addFlight(g, { no: 'AW100', aircraftId: a1, contractId: k.id, kind: 'revenue', from: 'LIS', to: 'DUS', std: day0 + 9 * 60, sta: day0 + 9 * 60 + b, pax: 150 });
  addFlight(g, { no: 'AW101', aircraftId: a1, contractId: k.id, kind: 'revenue', from: 'DUS', to: 'LIS', std: day0 + 2 * DAY + 9 * 60, sta: day0 + 2 * DAY + 9 * 60 + b, pax: 150 });
  addCrew(g, { CPT: 2, FO: 2, PUR: 2, CC: 6 });
  autoRoster(g, { aircraftIds: [a1] });
  const own = g.pairings[g.duties[g.flights[out.id].dutyId!].pairingId];
  // One trip of two duties (out, two nights away, home), fully crewed.
  expect(own.dutyIds.length).toBe(2);
  const cptId = own.slots.find((s) => s.role === 'CPT')!.crewId!;
  expect(cptId).toBeTruthy();
  // The other aircraft's out-and-back from Düsseldorf.
  const k2 = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [a2], start: day0, end: day0 + 4 * DAY, product: { kind: 'charter', price: 90_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false } as never });
  const b2 = blockMinutes(g.fleet[a2].typeId, 'DUS', 'PMI');
  const f = addFlight(g, { no: 'AW200', aircraftId: a2, contractId: k2.id, kind: 'revenue', from: 'DUS', to: 'PMI', std: sideAt + day0, sta: sideAt + day0 + b2, pax: 150 });
  addFlight(g, { no: 'AW201', aircraftId: a2, contractId: k2.id, kind: 'revenue', from: 'PMI', to: 'DUS', std: sideAt + day0 + b2 + 50, sta: sideAt + day0 + 2 * b2 + 50, pax: 150 });
  buildDuties(g, a2, g.now, g.now + 8 * DAY);
  const side = g.pairings[g.duties[g.flights[f.id].dutyId!].pairingId];
  return { g, side, cptId, own };
}

describe('v0.22.1 a side trip between the duties of a trip of several days', () => {
  it('on the free day at the outstation the trip\'s captain can take another flight from there, and stays for their own flight home', () => {
    const { g, side, cptId, own } = twoTrips(DAY + 8 * 60);
    const c = g.crew[cptId];
    const d = g.duties[side.dutyIds[0]];
    expect(otherTrip(g, c, side, d.report, d.release, false)).toBeNull();
    const plan = planCrew(g, c, side, segsOf(g, c), false, 60);
    expect(plan.issues.filter((i) => i.level === 'illegal').map((i) => i.text)).toEqual([]);
    expect(acceptable(g, plan)).toBe(true);
    // Already at Düsseldorf (no ticket out), and no ticket to Lisbon after it: their own trip goes on from there.
    expect(plan.out).toBeNull();
    expect(plan.home).toBeNull();
    // Their own trip is untouched.
    expect(own.slots.find((s) => s.role === 'CPT')!.crewId).toBe(cptId);
  });

  it('a flight over their own duty is still refused', () => {
    const { g, side, cptId } = twoTrips(2 * DAY + 8 * 60);
    const c = g.crew[cptId];
    const d = g.duties[side.dutyIds[0]];
    expect(otherTrip(g, c, side, d.report, d.release, false)).not.toBeNull();
    expect(acceptable(g, planCrew(g, c, side, segsOf(g, c), false, 60))).toBe(false);
  });
});
