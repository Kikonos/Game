// v0.7.2 crew rest per airframe (UPDATE-0.7.2.md §3): bunks (class 1), crew rest seats (class 3), blocked seats,
// passengers offloaded, and the cabin crew's earlier report on widebodies (ORO.FTL.205(c)).

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { offloadRestSeats } from '../ops/flights';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { defaultCrewRest, restClassAt, restSeatsBlocked, sellableSeats } from './crewRest';
import { dutySegs } from './timeline';
import { buildDuties } from '.';

const wide = (g: GameState, rest: { bunks: boolean; seats: number }) => {
  g.company.approvals.push('augmented');
  const ac = Object.values(g.fleet)[0];
  ac.typeId = 'a333';
  ac.cabin = { ...ac.cabin, total: 300, y: 300, j: 0, w: 0 };
  ac.crewRest = rest;
  addCrew(g, { CPT: 3, FO: 4, PUR: 4, CC: 14 }, 'A330/340');
  return ac;
};
const longLeg = (g: GameState, acId: string, blockMin = 12 * 60 + 30) => {
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 20 * 60;
  fixtureContract(g, { aircraftIds: [acId], start: std, end: std + DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } });
  const f = addFlight(g, { no: 'AW1', aircraftId: acId, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + blockMin, pax: 300 });
  const [d] = buildDuties(g, acId, g.now, g.now + 5 * DAY);
  return { f, d };
};

describe('crew rest per airframe', () => {
  it('restClassAt: bunks → 1, crew rest seats → 3, none → null; old widebodies default to bunks', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    expect(restClassAt(g, ac.id)).toBeNull();
    ac.crewRest = { bunks: false, seats: 8 };
    expect(restClassAt(g, ac.id)).toBe(3);
    ac.crewRest = { bunks: true, seats: 0 };
    expect(restClassAt(g, ac.id)).toBe(1);
    expect(defaultCrewRest('a333')).toEqual({ bunks: true, seats: 0 });
    expect(defaultCrewRest('b763')).toEqual({ bunks: true, seats: 0 });
    expect(defaultCrewRest('a320ceo')).toEqual({ bunks: false, seats: 0 });
    expect(restClassAt(g, null)).toBeNull();
  });

  it('an augmented duty on crew rest seats gets the class 3 limit; bunks the class 1 limit; none: no augmentation', () => {
    const seats = fixtureGame();
    const a = longLeg(seats, wide(seats, { bunks: false, seats: 8 }).id);
    expect(a.d.augment).toBe(1);
    expect(a.d.maxFdp).toBe(15 * 60); // 14:00 + 1:00 (one sector over 9 h)
    const bunks = fixtureGame();
    const b = longLeg(bunks, wide(bunks, { bunks: true, seats: 0 }).id);
    expect(b.d.augment).toBe(1);
    expect(b.d.maxFdp).toBe(17 * 60);
    const none = fixtureGame();
    const c = longLeg(none, wide(none, { bunks: false, seats: 0 }).id);
    expect(c.d.augment).toBe(0);
    expect(c.d.legality).toBe('illegal');
  });

  it('rest seats are blocked only when the duty needs in-flight rest; passengers beyond the sellable seats are offloaded once', () => {
    const g = fixtureGame();
    const ac = wide(g, { bunks: false, seats: 8 });
    const { f } = longLeg(g, ac.id);
    expect(restSeatsBlocked(g, f.id)).toBe(8);
    expect(sellableSeats(g, f.id)).toBe(292);
    const short = addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'GRU', to: 'GIG', std: f.sta + 5 * DAY, sta: f.sta + 5 * DAY + 60, pax: 300 });
    buildDuties(g, ac.id, g.now, g.now + 10 * DAY);
    expect(restSeatsBlocked(g, short.id)).toBe(0);
    expect(sellableSeats(g, short.id)).toBe(300);
    const before = g.finance.current.lines.penalties ?? 0;
    offloadRestSeats(g, f, ac);
    offloadRestSeats(g, f, ac);
    expect(f.pax).toBe(292);
    expect((g.finance.current.lines.penalties ?? 0) - before).toBe(-8 * 350);
    expect(g.messages.filter((m) => m.problem?.kind === 'restSeats').length).toBe(1);
    // With bunks nothing is blocked.
    ac.crewRest = { bunks: true, seats: 0 };
    expect(restSeatsBlocked(g, f.id)).toBe(0);
  });
});

describe('cabin crew report 15 min earlier on widebodies', () => {
  const segStart = (g: GameState, role: 'CPT' | 'CC') => {
    const d = Object.values(g.duties)[0];
    const p = g.pairings[d.pairingId];
    const c = Object.values(g.crew).find((x) => x.role === role)!;
    const [s] = dutySegs(g, c, p, d, null, null);
    return { s, d };
  };
  it('widebody: the cabin seg starts 15 min before report, its FDP and max FDP +15; narrowbody: no difference', () => {
    const g = fixtureGame();
    longLeg(g, wide(g, { bunks: true, seats: 0 }).id);
    const cpt = segStart(g, 'CPT');
    const cc = segStart(g, 'CC');
    expect(cpt.s.start).toBe(cpt.d.report);
    expect(cc.s.start).toBe(cc.d.report - 15);
    expect(cc.s.fdp - cpt.s.fdp).toBe(15);
    expect(cc.s.maxFdp - cpt.s.maxFdp).toBe(15);
    const n = fixtureGame();
    const ac = Object.values(n.fleet)[0];
    const std = Math.floor(n.now / DAY) * DAY + 2 * DAY + 8 * 60;
    addFlight(n, { no: 'AW3', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std, sta: std + 60 });
    buildDuties(n, ac.id, n.now, n.now + 5 * DAY);
    expect(segStart(n, 'CC').s.start).toBe(segStart(n, 'CPT').s.start);
  });
});
