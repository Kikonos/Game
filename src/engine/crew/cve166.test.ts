// v0.22.1 the player's CVE166 (save "Chevron", 4 May 2027): CS-TSM flew a base programme out of Jeddah with three crew
// sets on station; its legs of 3–8 May were sub-leased so the aircraft could cover a grounded jet at Gatwick. The ferry
// out, JED–LGW, went uncrewed five times ("CVE161 … CVE166 has no crew") and each time the first Gatwick legs were
// sub-chartered, while three captains and three first officers sat at Jeddah with nothing until 9 May: a tour held its
// crew "busy" for the whole rotation (check.ts otherTrip). Pinned here:
// 1. a set on station flies a side trip that fits between its own tour duties, and goes back to the station after it;
// 2. the tour's own days stay protected (a trip over a tour duty is still refused);
// 3. the save heals on load (the red mark goes, the ferry is crewed from Jeddah) and the days after fly without a
//    crew alarm on the ferry or on the Jeddah programme.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { acceptable, otherTrip, planCrew } from './check';
import { segsOf } from './timeline';

const load = (): GameState => deserialize(fixture('v022-cve166'));
/** The save as the older build left it: the once-on-load re-roster switched off. */
const raw = (): GameState => {
  const text = fixture('v022-cve166');
  const data = JSON.parse(text) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  return deserialize(JSON.stringify(data));
};

describe('CVE166: a set on station flies a side trip between its own tour duties', () => {
  it('the save as it was: the ferry out of Jeddah is red with nobody aboard', () => {
    const g = raw();
    const f = g.flights.f39l;
    expect(f.no).toBe('CVE166');
    expect(f.crewAlert).toBe('red');
    expect(f.crewIds).toEqual([]);
    // Three captains and three first officers at Jeddah, rested, their next tour duty days away.
    const jed = Object.values(g.crew).filter((c) => c.loc === 'JED' && (c.role === 'CPT' || c.role === 'FO') && c.restUntil <= g.now);
    expect(jed.length).toBe(6);
  });

  it('a Jeddah pilot can take it, with the way back to Jeddah (not home to Lisbon)', () => {
    const g = raw();
    const p = g.pairings[g.duties[g.flights.f39l.dutyId!].pairingId];
    const c = g.crew.c9;
    const plan = planCrew(g, c, p, segsOf(g, c), false, 60);
    expect(acceptable(g, plan)).toBe(true);
    expect(plan.out).toBeNull();
    expect(plan.home?.from).toBe('LGW');
    expect(plan.home?.to).toBe('JED');
    expect(plan.backTo).toBe('JED');
    // Back on station well before the set's next duty (F37080 on 9 May 03:00).
    expect(plan.home!.sta).toBeLessThan(g.flights.f1zx.std - DAY);
  });

  it('the tour still holds its crew over its own duties', () => {
    const g = raw();
    const p = g.pairings[g.duties[g.flights.f39l.dutyId!].pairingId];
    const c = g.crew.c9;
    const f = g.flights.f1zx;
    // A window over F37080 (9 May): the tour wins; the gap before it: free.
    expect(otherTrip(g, c, p, f.std - 60, f.sta + 30, false)?.tour).toBeTruthy();
    expect(otherTrip(g, c, p, g.flights.f39l.std - 60, g.flights.f39l.sta + 30, false)).toBeNull();
    // Not for someone who is not on the station.
    const lis = g.crew.c4;
    expect(lis.loc).toBe('LIS');
    expect(planCrew(g, lis, p, segsOf(g, lis), false, 60).backTo).toBeUndefined();
  });

  it('on load the ferry is crewed from Jeddah and the mark is gone', () => {
    const g = load();
    const f = g.flights.f39l;
    expect(f.crewAlert).toBeUndefined();
    expect(f.crewIds.length).toBe(2);
    for (const id of f.crewIds) expect(g.crew[id].loc).toBe('JED');
    const p = g.pairings[g.duties[f.dutyId!].pairingId];
    expect(p.slots.every((s) => s.backTo === 'JED')).toBe(true);
    const back = g.duties[f.dutyId!].deadheadIds.map((id) => g.flights[id]).filter((t) => t.kind === 'deadhead');
    expect(back.length).toBe(1);
    expect(back[0].from).toBe('LGW');
    expect(back[0].to).toBe('JED');
    expect([...back[0].crewIds].sort()).toEqual([...f.crewIds].sort());
    // A second load changes nothing (the repair runs once).
    const again = deserialize(JSON.stringify({ format: 'contrail-acmi-save', meta: {}, state: JSON.parse(JSON.stringify(g)) }));
    expect(again.flights.f39l.crewIds).toEqual(f.crewIds);
  });

  it('it flies on time, the pilots are back at Jeddah the next day and fly their tour', () => {
    const g = load();
    const ferry = g.flights.f39l;
    const ids = [...ferry.crewIds];
    const std = ferry.std;
    advanceTo(g, std + 2 * DAY, new Set());
    expect(g.flights.f39l.status).toBe('done');
    expect(g.flights.f39l.atd! - std).toBeLessThan(30);
    for (const id of ids) expect(g.crew[id].loc).toBe('JED');
    // The first Gatwick legs of 5 May flew with our own crew (no further sub-charter for want of a ferry crew).
    expect(g.flights.f309.operatedBy).toBeUndefined();
    expect(g.flights.f309.status).toBe('done');
    advanceTo(g, g.flights.f1zx.std + DAY, new Set());
    // F37080 on 9 May left Jeddah with its own set, on our aircraft.
    expect(g.flights.f1zx.status).toBe('done');
    expect(g.flights.f1zx.operatedBy).toBeUndefined();
    expect(g.flights.f1zx.crewIds.length).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
