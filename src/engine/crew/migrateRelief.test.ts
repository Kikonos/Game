// v0.18.3 old saves: cruise relief pilots become first officers (crew, seats, hire orders), one Inbox note, once.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { deserialize, serialize } from '../save';
import '../sim';
import { rollingRoster } from '../../test/rolling';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { complement, canFill } from '../core/perf';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { autoRoster, buildDuties, crewPay, migrateRelief, restPlan, setDutyAugment } from '.';

// The 14-day roster (the planner fills the days ahead in tests as before the monthly roster).
rollingRoster();

/** An old save's shape: a relief pilot on the books, in a seat and on order (roles the game no longer has). */
function oldSave(): { g: GameState; crp: string } {
  const g = fixtureGame();
  const [crp] = addCrew(g, { FO: 1 }, 'A330/340');
  const c = g.crew[crp] as unknown as { role: string; salary: number; hired: number };
  c.role = 'CRP';
  c.salary = 5_500;
  const p = Object.values(g.pairings)[0];
  if (p) (p.slots as { role: string; crewId: string | null; above?: boolean }[]).push({ role: 'CRP', crewId: null, above: true });
  (g.hires as unknown as { role: string }[]).push({ ...(g.hires[0] ?? { id: 'h1', family: 'A330/340', base: 'LIS', crewId: crp, ordered: g.now, ready: g.now, cost: 0 }), role: 'CRP' });
  return { g, crp };
}

describe('v0.18.3 no cruise relief rank', () => {
  it('3 pilots are 1 CPT + 2 FO, 4 are 2 + 2; a captain may sit in any FO seat', () => {
    expect(complement('a333', 300, { augment: 1 }).filter((r) => r === 'CPT' || r === 'FO')).toEqual(['CPT', 'FO', 'FO']);
    expect(complement('a333', 300, { augment: 2 }).filter((r) => r === 'CPT' || r === 'FO')).toEqual(['CPT', 'CPT', 'FO', 'FO']);
    expect(canFill('FO', 'CPT')).toBe(true);
    expect(canFill('CPT', 'FO')).toBe(false);
  });
  it('a relief pilot becomes a first officer: same ratings and hire date, FO pay, seats and orders too, one note', () => {
    const { g, crp } = oldSave();
    const before = { ...g.crew[crp] };
    const n0 = g.messages.length;
    expect(migrateRelief(g)).toBeGreaterThan(0);
    const c = g.crew[crp];
    expect(c.role).toBe('FO');
    expect(c.ratings).toEqual(before.ratings);
    expect(c.hired).toBe(before.hired);
    expect(c.salary).toBe(Math.max(5_500, crewPay(g, c)));
    expect(c.salary).toBeGreaterThan(5_500);
    expect(Object.values(g.pairings).every((p) => p.slots.every((s) => (s.role as string) !== 'CRP'))).toBe(true);
    expect(g.hires.every((h) => (h.role as string) !== 'CRP')).toBe(true);
    expect(g.messages.length).toBe(n0 + 1);
    expect(g.messages[0].title).toBe('Cruise relief pilots are now first officers');
    // Once only.
    expect(migrateRelief(g)).toBe(0);
    expect(g.messages.length).toBe(n0 + 1);
  });
  it('an old save loads with them as first officers and the note', () => {
    const { g, crp } = oldSave();
    const h = deserialize(serialize(g));
    expect(h.crew[crp].role).toBe('FO');
    expect(h.messages.filter((m) => m.title === 'Cruise relief pilots are now first officers')).toHaveLength(1);
    const again = deserialize(serialize(h));
    expect(again.messages.filter((m) => m.title === 'Cruise relief pilots are now first officers')).toHaveLength(1);
  });
});

describe('v0.18.3 augmented pairs use captains as first officers when no FO is free', () => {
  const longHaul = (cpt: number, fo: number) => {
    const g = fixtureGame();
    g.company.approvals.push('augmented');
    const ac = Object.values(g.fleet)[0];
    ac.typeId = 'a333';
    ac.cabin = { ...ac.cabin, total: 300, y: 300, j: 0, w: 0 };
    ac.rest = { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } };
    const ids = addCrew(g, { CPT: cpt, FO: fo, PUR: 4, CC: 14 }, 'A330/340');
    for (const id of ids) g.crew[id].off = [];
    const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + 20 * 60;
    fixtureContract(g, { aircraftIds: [ac.id], start: std, end: std + DAY, pattern: { kind: 'legs', legs: [] }, product: { kind: 'charter', price: 1, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false } });
    addFlight(g, { no: 'AW1', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std, sta: std + 12 * 60 + 30 });
    const [d] = buildDuties(g, ac.id, g.now, g.now + 5 * DAY);
    return { g, ac, d };
  };
  const pilots = (g: GameState, dutyId: string) => {
    const p = g.pairings[g.duties[dutyId].pairingId];
    return p.slots.filter((s) => (s.role === 'CPT' || s.role === 'FO') && !s.above).map((s) => `${s.role}:${s.crewId ? g.crew[s.crewId].role : '-'}`);
  };
  it('3 pilots with 2 captains and 1 first officer: a captain sits in the second FO seat (2 CPT + 1 FO)', () => {
    const { g, ac, d } = longHaul(2, 1);
    expect(d.augment).toBe(1);
    const r = autoRoster(g, { aircraftIds: [ac.id] });
    expect(r.uncovered).toEqual([]);
    expect(pilots(g, d.id).sort()).toEqual(['CPT:CPT', 'FO:CPT', 'FO:FO']);
    expect(restPlan(g, d.id)!.pilots.every((t) => t.crewIds.length === 1)).toBe(true);
  });
  it('4 pilots with 3 captains and 1 first officer: legal, a captain in the right seat of pair B', () => {
    const { g, ac, d } = longHaul(3, 1);
    expect(setDutyAugment(g, d.id, 2).ok).toBe(true);
    const r = autoRoster(g, { aircraftIds: [ac.id] });
    expect(r.uncovered).toEqual([]);
    expect(pilots(g, d.id).sort()).toEqual(['CPT:CPT', 'CPT:CPT', 'FO:CPT', 'FO:FO']);
  });
});
