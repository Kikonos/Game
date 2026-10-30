// Crew-planning round (debug round, bot seeds 2 and 5): trips the roster could never crew, and crew it left where they
// were. Each case as the bot found it.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { minRest } from './rules';
import { autoRoster, rerosterFrom } from './roster';
import { planCrew } from './check';
import { segsOf, touchCrew } from './timeline';

const H = 60;

describe('a layover shorter than the rest the duty before needs', () => {
  it('is two trips (a fresh crew positioned out to the second), never one trip nobody can fly', () => {
    const g = fixtureGame(5);
    const ac = Object.values(g.fleet)[0];
    addCrew(g, { CPT: 4, FO: 4, PUR: 2, CC: 8 });
    // Day 1: LIS–TLV–LCA–ATH, about 11:30 on duty; day 2: ATH–LIS 12 h after landing (10:30 after release: more than
    // a flat 10 h, less than the day before).
    const t0 = Math.floor(g.now / DAY) * DAY + 4 * DAY + 6 * H;
    const b1 = blockMinutes(ac.typeId, 'LIS', 'TLV');
    const b2 = blockMinutes(ac.typeId, 'TLV', 'LCA');
    const b3 = blockMinutes(ac.typeId, 'LCA', 'ATH');
    const f1 = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'TLV', std: t0, sta: t0 + b1, pax: 150 });
    const f2 = addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'TLV', to: 'LCA', std: f1.sta + 60, sta: f1.sta + 60 + b2, pax: 150 });
    const f3 = addFlight(g, { no: 'AW3', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LCA', to: 'ATH', std: f2.sta + 50, sta: f2.sta + 50 + b3, pax: 150 });
    const f4 = addFlight(g, { no: 'AW4', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'ATH', to: 'LIS', std: f3.sta + 12 * H, sta: f3.sta + 12 * H + blockMinutes(ac.typeId, 'ATH', 'LIS'), pax: 150 });
    buildDuties(g, ac.id, g.now, g.now + 8 * DAY);
    const d1 = g.duties[g.flights[f1.id].dutyId!];
    const d2 = g.duties[g.flights[f4.id].dutyId!];
    expect(d1.id).not.toBe(d2.id);
    expect(g.flights[f3.id].dutyId).toBe(d1.id);
    const need = minRest({ dutyMin: d1.release - d1.report, atHome: false, augmented: false, tzShift: 0 });
    expect(d2.report - d1.release).toBeLessThan(need);
    expect(d2.report - d1.release).toBeGreaterThanOrEqual(10 * H);
    // Two trips, each crewed by the roster.
    expect(d1.pairingId).not.toBe(d2.pairingId);
    autoRoster(g);
    for (const d of [g.duties[g.flights[f1.id].dutyId!], g.duties[g.flights[f4.id].dutyId!]]) {
      const p = g.pairings[d.pairingId];
      expect(p.slots.filter((s) => !s.above).every((s) => s.crewId), d.id).toBe(true);
      expect(p.legality).not.toBe('illegal');
    }
  });
});

describe('a locked crew member somewhere else', () => {
  it('is re-ticketed to the trip by the rolling re-plan, not left there with a red alarm a day', () => {
    const g = fixtureGame(5);
    const ac = Object.values(g.fleet)[0];
    ac.at = 'DUS';
    addCrew(g, { CPT: 3, FO: 3, PUR: 2, CC: 6 });
    const std = Math.floor(g.now / DAY) * DAY + 4 * DAY + 9 * H;
    const b = blockMinutes(ac.typeId, 'DUS', 'FNC');
    addFlight(g, { no: 'AW816', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'DUS', to: 'FNC', std, sta: std + b, pax: 150 });
    addFlight(g, { no: 'AW817', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'DUS', std: std + b + 50, sta: std + 2 * b + 50, pax: 150 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 8 * DAY);
    autoRoster(g);
    const p = g.pairings[g.duties[d.id].pairingId];
    const seat = p.slots.find((s) => s.role === 'CPT')!;
    const c = g.crew[seat.crewId!];
    seat.locked = true;
    // Their ticket out is gone (a disruption) and they are in Lisbon: illegal for the trip.
    for (const id of [...g.duties[d.id].deadheadIds]) {
      const t = g.flights[id];
      if (t && t.crewIds.includes(c.id) && t.to === 'DUS') t.crewIds = t.crewIds.filter((x) => x !== c.id);
    }
    touchCrew(g);
    expect(planCrew(g, c, p, segsOf(g, c, p.id), true).issues.some((i) => i.code === 'location' && i.level === 'illegal')).toBe(true);
    rerosterFrom(g, ac.id, g.now);
    const q = g.pairings[g.duties[d.id].pairingId];
    expect(q.slots.find((s) => s.role === 'CPT')!.crewId).toBe(c.id);
    const plan = planCrew(g, c, q, segsOf(g, c, q.id), true);
    expect(plan.issues.filter((i) => i.level === 'illegal'), JSON.stringify(plan.issues)).toEqual([]);
    expect(Object.values(g.flights).some((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.to === 'DUS' && f.crewIds.includes(c.id))).toBe(true);
  });
});

describe('a widebody layover the cabin crew cannot rest (code review)', () => {
  it("counts the cabin crew's earlier report at both ends: two trips, both crewed, not one with every cabin seat empty", () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.typeId = 'a332';
    ac.cabin = { ...ac.cabin, total: 263, y: 263, j: 0, w: 0 };
    ac.at = 'LIS';
    addCrew(g, { CPT: 3, FO: 3, PUR: 3, CC: 16 }, 'A330/340');
    const b = blockMinutes('a332', 'LIS', 'FNC');
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 17 * H;
    const f1 = addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FNC', std, sta: std + b, pax: 263 });
    const d1 = buildDuties(g, ac.id, g.now, g.now + 5 * DAY)[0];
    // Day 2 from Funchal: the pilots report 10:05 after the release, the cabin crew 15 min earlier (9:50 of rest).
    const std2 = d1.release + 10 * H + 5 + (f1.std - d1.report);
    addFlight(g, { no: 'AW2', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FNC', to: 'LIS', std: std2, sta: std2 + b, pax: 263 });
    const [a, c] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    expect(c.report - a.release).toBe(10 * H + 5);
    expect(c.cabinEarly).toBe(15);
    expect(a.pairingId).not.toBe(c.pairingId);
    autoRoster(g, {});
    for (const d of [a, c]) expect(g.pairings[g.duties[d.id].pairingId].slots.filter((s) => !s.above).every((s) => s.crewId)).toBe(true);
  });
});
