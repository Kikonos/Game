// Crew-planning round (private jets): a jet is wheels up 2 h after the call from the nearest business-aviation base
// (later only when that base is far), flies the crew direct at its class's real speed, stops for fuel only past its
// range (a long-range jet crosses an ocean nonstop), looks at crew resting nearby before crew free an ocean away, and
// with a night's rest on arrival waits the rest the check really asks (14 h across 4+ time zones).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight } from '../core/entities';
import { distance } from '../core/geo';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import { crewControl, jetQuote } from '.';
import { nearestJetBase } from './control';
import { touchCrew } from './timeline';

const J = BAL.crewControl.jet;
const NM = 1.852;

describe('jet quotes', () => {
  it('real speeds and ranges: nonstop when a class can, a long-range jet over the Atlantic, a fuel stop only past every range', () => {
    const g = fixtureGame();
    const gru = jetQuote(g, 'LIS', 'GRU', 10, g.now);
    // LIS–GRU is past a heavy jet's 4,000 nm: the long-range class flies it nonstop at ~485 kt.
    expect(distance('LIS', 'GRU') / NM).toBeGreaterThan(J.rangeNm.heavy);
    expect(gru.cls).toBe('long');
    expect(gru.fuelStop).toBeNull();
    expect(gru.block).toBe(Math.round((distance('LIS', 'GRU') / NM / J.cruiseKt.long) * 60 + J.taxiMin));
    // Forced onto a heavy jet, it stops once.
    expect(jetQuote(g, 'LIS', 'GRU', 10, g.now, 'heavy').fuelStop).not.toBeNull();
    // About $13K an hour with the empty legs: a long-range jet LIS–GRU is in the $110–200K range.
    expect(gru.cost).toBeGreaterThan(110_000);
    expect(gru.cost).toBeLessThan(200_000);
  });

  it('wheels up 2 h after the call from a business-aviation base, later from an island far from one', () => {
    const g = fixtureGame();
    expect(nearestJetBase('LIS')).toEqual({ base: 'LIS', nm: 0 });
    const lis = jetQuote(g, 'LIS', 'MAD', 4, g.now);
    expect(lis.wheelsUp).toBe(Math.ceil((g.now + J.fboLeadMin) / 15) * 15);
    const far = nearestJetBase('BDA');
    expect(far.nm).toBeGreaterThan(500);
    const bda = jetQuote(g, 'BDA', 'MBJ', 2, g.now);
    expect(bda.wheelsUp - g.now).toBeGreaterThan(J.fboLeadMin);
    expect(bda.wheelsUp - g.now).toBeLessThanOrEqual(5 * 60);
    // Bermuda–Montego Bay is a short hop: about 3 h of flying.
    expect(bda.block).toBeLessThan(3.5 * 60);
  });
});

/** A narrowbody trip from Montego Bay reporting `hoursBefore` from now: nobody can get there by airline in time. */
function mbj(hoursBefore = 10): { g: GameState; flightId: string } {
  const g = fixtureGame(5);
  const ac = Object.values(g.fleet)[0];
  ac.at = 'MBJ';
  addCrew(g, { CPT: 14, FO: 2, PUR: 2, CC: 6 });
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * 60;
  const b = blockMinutes(ac.typeId, 'MBJ', 'SJU');
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [ac.id], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f = addFlight(g, { no: 'AW700', aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'MBJ', to: 'SJU', std, sta: std + b, pax: 150 });
  addFlight(g, { no: 'AW701', aircraftId: ac.id, contractId: k.id, kind: 'revenue', from: 'SJU', to: 'MBJ', std: std + b + 50, sta: std + 2 * b + 50, pax: 150 });
  buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
  autoRoster(g);
  const d = g.duties[g.flights[f.id].dutyId!];
  const p = g.pairings[d.pairingId];
  // Every seat crewed but the captain's (who goes on leave).
  const was = p.slots.find((x) => x.role === 'CPT')!.crewId!;
  releaseCrew(g, p, was);
  setFlightsCrew(g, p);
  g.crew[was].blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }];
  g.crew[was].status = 'leave';
  g.now = d.report - hoursBefore * 60;
  touchCrew(g);
  return { g, flightId: f.id };
}

describe('jets in Crew Control', () => {
  it('looks at a captain resting a short hop away before the captains free in Lisbon', () => {
    const { g, flightId } = mbj(5);
    const d = g.duties[g.flights[flightId].dutyId!];
    const cpt = Object.values(g.crew).filter((c) => c.role === 'CPT' && c.ratings.includes('A320') && c.status !== 'leave')[0];
    // Resting at Bermuda after a duty: free in an hour.
    cpt.loc = 'BDA';
    cpt.awaySince = g.now - DAY;
    cpt.log = [{ start: g.now - 16 * 60, end: g.now - 9 * 60, fdp: 6 * 60, block: 5 * 60, sectors: 2, augmented: false, disruptive: false }];
    cpt.restUntil = g.now + 60;
    touchCrew(g);
    const v = crewControl(g, flightId)!;
    const jet = v.solutions.find((s) => s.id === 'jet')!;
    expect(jet.available, jet.why).toBe(true);
    expect(jet.consequences.join(' ')).toContain(cpt.last);
    // Flown in the same day: a short wait for the jet, not a night's rest after an Atlantic crossing.
    expect((jet.newDeparture ?? g.flights[flightId].std) - g.flights[flightId].std).toBeLessThan(4 * 60);
    expect(d.report).toBeGreaterThan(g.now);
  });

  it('with a night\'s rest on arrival, waits the 14 h the check asks after crossing the Atlantic, and the preview crews it', () => {
    const { g, flightId } = mbj();
    const v = crewControl(g, flightId)!;
    const jet = v.solutions.find((s) => s.id === 'jet')!;
    expect(jet.available, jet.why).toBe(true);
    const f = g.flights[flightId];
    expect(jet.newDeparture).not.toBeNull();
    // Lisbon–Montego Bay is 5 time zones: 14 h rest after the jet lands, then the report lead.
    const arrives = Math.min(...(jet.options ?? []).map((o) => o.arrives ?? Infinity));
    expect(jet.newDeparture! - arrives).toBeGreaterThanOrEqual(14 * 60);
    expect(jet.preview.after.level).not.toBe('missing');
    expect(jet.preview.after.level).not.toBe('illegal');
    expect(f.status).toBe('scheduled');
  });
});
