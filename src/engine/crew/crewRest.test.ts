// Crew rest per airframe. v0.7.2 (UPDATE-0.7.2.md §3) blocked seats, passengers offloaded, the cabin crew's earlier
// report on widebodies (ORO.FTL.205(c)); v0.7.3 (UPDATE-0.7.3.md §2.1) separate pilot and cabin crew facilities and
// the migration of the v0.7.2 {bunks, seats}.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { offloadRestSeats } from '../ops/flights';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { defaultCrewRest, restClassAt, restSeatsBlocked, sellableSeats } from './crewRest';
import { migrateRest, restOf } from './restPlan';
import type { AcRest } from '../core/types';
import { dutySegs } from './timeline';
import { buildDuties } from '.';

const wide = (g: GameState, old: { bunks: boolean; seats: number }) => {
  g.company.approvals.push('augmented');
  const ac = Object.values(g.fleet)[0];
  ac.typeId = 'a333';
  ac.cabin = { ...ac.cabin, total: 300, y: 300, j: 0, w: 0 };
  ac.crewRest = old;
  ac.rest = migrateRest({ ...ac, rest: undefined });
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
  it('v0.7.3 migration of the v0.7.2 {bunks, seats} (UPDATE-0.7.3.md §2.1 table)', () => {
    const cab = (j: number) => ({ j, w: 0, y: 300 - j, total: 300, label: '', layout: 'two-class' as const });
    const fc1 = { cls: 1, kind: 'fcrc', places: 2 };
    // (a 767 keeps the game's bunks here; the v0.7.4 load takes them off: loadRest074)
    expect(migrateRest({ typeId: 'b763', cabin: cab(16), crewRest: { bunks: true, seats: 0 } })).toEqual({ fc: fc1, cc: { cls: 1, kind: 'ldmcr', places: 4 } });
    expect(migrateRest({ typeId: 'b772', cabin: cab(30), crewRest: { bunks: true, seats: 0 } })).toEqual({ fc: fc1, cc: { cls: 1, kind: 'ccrc', places: 8 } });
    // grandfathered recliners (v0.7.4: class 2 crew rest recliners)
    expect(migrateRest({ typeId: 'a333', cabin: cab(0), crewRest: { bunks: false, seats: 8 } })).toEqual({ fc: { cls: 2, kind: 'recliners', places: 2 }, cc: { cls: 2, kind: 'recliners', places: 6 } });
    // nothing fitted (v0.7.4: the cabin's curtained seats are not stored; they follow the cabin)
    expect(migrateRest({ typeId: 'a333', cabin: cab(24), crewRest: { bunks: false, seats: 0 } })).toEqual({ fc: null, cc: null });
    expect(migrateRest({ typeId: 'a333', cabin: cab(0), crewRest: { bunks: false, seats: 0 } })).toEqual({ fc: null, cc: null });
    // absent (older saves, start fleet): widebodies whose type had a rest class get bunks
    expect(migrateRest({ typeId: 'a332', cabin: cab(18) })).toEqual({ fc: fc1, cc: { cls: 1, kind: 'ldmcr', places: 7 } });
    expect(migrateRest({ typeId: 'a320ceo', cabin: cab(0) })).toEqual({ fc: null, cc: null });
    // idempotent
    const r: AcRest = { fc: null, cc: { cls: 2, kind: 'jSeats', places: 4 } };
    expect(migrateRest({ typeId: 'a333', cabin: cab(24), rest: r })).toBe(r);
    expect(defaultCrewRest('a333')).toEqual({ bunks: true, seats: 0 });
    expect(defaultCrewRest('a320ceo')).toEqual({ bunks: false, seats: 0 });
  });
  it('restOf / restClassAt (deprecated: the pilots\' class)', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    // v0.7.4 every aircraft: curtained economy seats (class 3) for both crews
    expect(restClassAt(g, ac.id)).toBe(3);
    expect(restOf(g, ac.id)).toEqual({ fc: { cls: 3, kind: 'ySeats', places: 2 }, cc: { cls: 3, kind: 'ySeats', places: 2 } });
    ac.rest = { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } };
    expect(restClassAt(g, ac.id)).toBe(2);
    expect(restClassAt(g, null)).toBeNull();
    expect(restOf(g, null)).toEqual({ fc: null, cc: null });
  });

  it('an augmented duty on crew rest recliners gets the class 2 limit; bunks the class 1 limit; nothing fitted: economy seats, class 3', () => {
    const seats = fixtureGame();
    const a = longLeg(seats, wide(seats, { bunks: false, seats: 8 }).id);
    expect(a.d.augment).toBe(1);
    expect(a.d.maxFdp).toBe(16 * 60); // class 2: 15:00 + 1:00 (one sector over 9 h)
    const bunks = fixtureGame();
    const b = longLeg(bunks, wide(bunks, { bunks: true, seats: 0 }).id);
    expect(b.d.augment).toBe(1);
    expect(b.d.maxFdp).toBe(17 * 60);
    // v0.7.4 curtained economy seats (class 3): 14:00 + 1:00 with 3 pilots
    const none = fixtureGame();
    const c = longLeg(none, wide(none, { bunks: false, seats: 0 }).id);
    expect(c.d.augment).toBe(1);
    expect(c.d.maxFdp).toBe(15 * 60);
  });

  it('rest seats are blocked only when someone rests in them; passengers beyond the sellable seats are offloaded once', () => {
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
    ac.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } };
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

describe('dev helpers (v0.7.2)', () => {
  it('devRestSeats books an augmented duty on a rest-seats widebody; devSaleReady frees an owned aircraft', async () => {
    const { devRestSeats, devSaleReady } = await import('../dev');
    const { createGame } = await import('../newGame');
    const { saleQuote } = await import('../ops/sale');
    const g = createGame({ name: 'Dev Air', code: 'DV', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 9 });
    const fid = devRestSeats(g);
    expect(fid).not.toBe('');
    expect(restSeatsBlocked(g, fid)).toBe(8);
    expect(sellableSeats(g, fid)).toBe(g.fleet[g.flights[fid].aircraftId!].cabin.total - 8);
    const id = devSaleReady(g);
    expect(saleQuote(g, id).ok).toBe(true);
  });
});
