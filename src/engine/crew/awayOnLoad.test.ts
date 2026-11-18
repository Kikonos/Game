// v0.25 r2 (crew-awaychain, round 2 sign-off) tours an older build planned past the rotation are crewed again from home
// once on load: the player's save (27 Jul 2027) had cabin crew member c14y, away since 17 Jun (SCL), planned on the NTE
// tour of 1–23 Aug: 73 days away. Round 2 changed only new assignments.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize, serialize } from '../save';
import { DAY } from '../core/time';
import { crewPlan } from './sets';

describe('v0.25 r2 tours past the rotation repaired once on load', () => {
  it('the crew member kept away goes home: the tour is crewed again from home, every seat filled', () => {
    const raw = fixture('v025-c14y');
    const before = JSON.parse(raw);
    expect(before.state.stats.awayOnLoad).toBeUndefined();
    const tour = before.state.pairings.pbua;
    expect(tour.slots.some((s: { crewId: string | null }) => s.crewId === 'c14y')).toBe(true);
    const g = deserialize(raw);
    expect(g.stats.awayOnLoad).toBe(true);
    const p = g.pairings.pbua;
    expect(p.status).toBe('planned');
    expect(p.slots.some((s) => s.crewId === 'c14y')).toBe(false);
    expect(p.slots.every((s) => !!s.crewId || !!s.extra)).toBe(true);
    // No other planned tour keeps her away (she flies her present work and goes home).
    const away = Object.values(g.pairings).filter((x) => x.status === 'planned' && x.tour && x.start > g.now + 2 * DAY && x.slots.some((s) => s.crewId === 'c14y'));
    expect(away).toEqual([]);
    // Saved and loaded again: nothing more changes.
    const again = deserialize(serialize(g));
    expect(again.pairings.pbua.slots.map((s) => s.crewId)).toEqual(p.slots.map((s) => s.crewId));
  }, 60_000);

  it('a save written by this build (the flag set) is not repaired again', () => {
    const d = JSON.parse(fixture('v025-c14y'));
    d.state.stats.awayOnLoad = true;
    const g = deserialize(JSON.stringify(d));
    expect(g.pairings.pbua.slots.some((s) => s.crewId === 'c14y')).toBe(true);
  }, 60_000);

  it('Crew › Planning on the same save straight after Continue: the grown detachment sets are not hired for', () => {
    const g = deserialize(fixture('v025-c14y'));
    const p = crewPlan(g).find((x) => x.family === 'A320')!;
    // Was 26 needed, 23 complete, short 1 CPT, 1 FO, 9 CC until the first midnight.
    expect(p.setsNeeded).toBe(24);
    expect(p.roles.filter((r) => r.balance < 0)).toEqual([]);
  }, 60_000);
});
