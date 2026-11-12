// v0.23 crew planned person by person. The player's Chevron game, 27 May 2027 21:00 (bug export of 12 Nov 2026, two crew
// alarms sharing one snapshot), an A320 base at Riyadh with three sets on station:
// 1. XY3120 RUH–DOH 29 May 03:00 had no cabin crew at all. The card said "Rui Ribeiro is in Lisbon, not Riyadh" while
//    he, Inês Pereira, Bruno Lopes and Teresa Ribeiro sat in Riyadh with nothing until 7 Jun. The planner was the wrong
//    side: a seat on a tour part meant "member for the rotation", so its plan ended with a ticket home to Lisbon, and
//    their own next duty at Riyadh then read "in Lisbon, not Riyadh".
// 2. XY3102 RUH–SSH 4 Jun 12:05 was short of a purser: the part also held a duty on 7 Jun, so whoever was free on the
//    4th but busy on the 7th could not take the seat (a seat was filled for the whole part or not at all).
// Pinned: crew on station cover one duty of a tour part as guests (no tickets, they stay at Riyadh for their own
// duties); a part is covered duty by duty when nobody can take all of it; the save heals on load; the days fly crewed.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { acceptable, planCrew } from './check';
import { crossCheck } from './crossCheck';
import { dutyCrew } from './rosterActions';
import { segsOf } from './timeline';
import { coversOther } from './tours';

const load = (): GameState => deserialize(fixture('v0221-riyadh'));
/** The save as v0.22.1 left it: the once-on-load re-rosters switched off. */
const raw = (): GameState => {
  const data = JSON.parse(fixture('v0221-riyadh')) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  data.state.stats.perCrewRedo = true;
  return deserialize(JSON.stringify(data));
};
const leg = (g: GameState, no: string, day: number): Flight => Object.values(g.flights).find((f) => f.no === no && f.status !== 'cancelled' && new Date(f.std * 60_000).getUTCDate() === day)!;
const seatsOf = (g: GameState, f: Flight) => g.pairings[g.duties[f.dutyId!].pairingId].slots;
const byName = (g: GameState, name: string) => Object.values(g.crew).find((c) => `${c.first} ${c.last}` === name)!;

describe('v0.23 the Riyadh base: crew on station cover single duties of another part', () => {
  it('the save as it was: XY3120 has no cabin crew and XY3102 no purser, with four cabin crew idle at Riyadh', () => {
    const g = raw();
    expect(seatsOf(g, leg(g, 'XY3120', 29)).filter((s) => !s.crewId && !s.above).map((s) => s.role)).toEqual(['PUR', 'CC', 'CC', 'CC']);
    expect(seatsOf(g, leg(g, 'XY3102', 4)).filter((s) => !s.crewId && !s.above).map((s) => s.role)).toEqual(['PUR']);
    for (const n of ['Rui Ribeiro', 'Inês Pereira', 'Bruno Lopes', 'Teresa Ribeiro']) expect(byName(g, n).loc).toBe('RUH');
  });

  it('the planner takes Rui Ribeiro for XY3120 as a guest: no ticket, he stays at Riyadh (never "in Lisbon, not Riyadh")', () => {
    const g = raw();
    const f = leg(g, 'XY3120', 29);
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    for (const n of ['Rui Ribeiro', 'Inês Pereira', 'Bruno Lopes', 'Teresa Ribeiro']) {
      const c = byName(g, n);
      const plan = planCrew(g, c, p, segsOf(g, c), false, 60);
      expect(acceptable(g, plan), n).toBe(true);
      expect(plan.guest).toBe(true);
      expect(plan.out).toBeNull();
      expect(plan.home).toBeNull();
      expect(plan.issues.some((i) => i.code === 'location' && i.level === 'illegal')).toBe(false);
    }
  });

  it('on load both flights are crewed, the marks are gone and the cross-check has nothing left to find', () => {
    const g = load();
    for (const [no, day] of [['XY3120', 29], ['XY3102', 4]] as const) {
      const f = leg(g, no, day);
      expect(seatsOf(g, f).filter((s) => !s.crewId && !s.above), no).toEqual([]);
      expect(f.crewAlert, no).toBeUndefined();
      expect(crossCheck(g, f.id).verdict, no).not.toBe('WRONG');
    }
    // The purser of XY3102 flies that duty alone: the part was cut around it (its 7 Jun duty is another part's).
    const p = g.pairings[g.duties[leg(g, 'XY3102', 4).dutyId!].pairingId];
    expect(p.dutyIds.filter((id) => !g.duties[id].done).length).toBe(1);
    // Every cover is someone already at Riyadh: nobody is flown out, no ticket is bought for it.
    for (const s of [...seatsOf(g, leg(g, 'XY3120', 29)), ...p.slots]) if (s.guest) expect(g.crew[s.crewId!].loc).toBe('RUH');
    // A second load changes nothing (the repair runs once).
    const again = deserialize(JSON.stringify({ format: 'contrail-acmi-save', meta: {}, state: JSON.parse(JSON.stringify(g)) }));
    expect(leg(again, 'XY3120', 29).crewIds).toEqual(leg(g, 'XY3120', 29).crewIds);
  });

  it('the duty sheet says who is covering for another set, and only them', () => {
    const g = load();
    const f = leg(g, 'XY3102', 4);
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    const view = dutyCrew(g, f.id)!;
    for (const s of view.slots) expect(!!s.guest).toBe(!!s.crewId && coversOther(g, p, s.crewId));
    expect(view.slots.some((s) => s.guest)).toBe(true);
  });

  it('they fly: XY3120 and XY3102 leave on time with a full crew, and the covering crew fly their own XY3060 on 7 Jun', () => {
    const g = load();
    const a = leg(g, 'XY3120', 29);
    const b = leg(g, 'XY3102', 4);
    const cover = seatsOf(g, a).filter((s) => s.guest).map((s) => s.crewId!);
    expect(cover.length).toBeGreaterThanOrEqual(4);
    advanceTo(g, a.std + DAY, new Set());
    expect(g.flights[a.id].status).toBe('done');
    expect(g.flights[a.id].operatedBy).toBeUndefined();
    expect(g.flights[a.id].atd! - a.std).toBeLessThan(30);
    for (const id of cover) expect(g.crew[id].loc).toBe('RUH');
    advanceTo(g, b.std + DAY, new Set());
    expect(g.flights[b.id].status).toBe('done');
    expect(g.flights[b.id].operatedBy).toBeUndefined();
    const own = leg(g, 'XY3060', 7);
    advanceTo(g, own.std + DAY, new Set());
    expect(g.flights[own.id].status).toBe('done');
    expect(g.flights[own.id].operatedBy).toBeUndefined();
    expect(seatsOf(g, g.flights[own.id]).filter((s) => !s.crewId && !s.above)).toEqual([]);
  }, 180_000);
});
