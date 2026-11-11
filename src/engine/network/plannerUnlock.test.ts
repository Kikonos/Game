// v0.22 final check: the business case offers "Hire a network planner", but the planner (earned by the first finished
// study) stayed locked until the next daily check: the day's achievements are checked before the network's own daily
// step finishes the study, and a save from before v0.21 with a study already done waited for the next day too. The
// Team page then read "Locked: Your first market study finished". Now it is earned the moment the study is done, and
// on load for an older save.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { hireHead } from '../ops/heads';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { startStudy } from '.';

const newGame = (seed = 5) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('the network planner is earned the moment the first study is done', () => {
  it('in play: unlocked in the same step that finishes the study (no day of "Locked")', () => {
    const g = newGame(10);
    const res = startStudy(g, 'LIS-OXB', 'desk');
    expect(res.routeId).toBeTruthy();
    const r = g.network!.routes[res.routeId!];
    expect(g.heads!.netPlanner.unlockedAt).toBeNull();
    for (let i = 0; i < 120 && r.status === 'study'; i++) advanceTo(g, g.now + DAY, new Set());
    expect(r.status).toBe('case');
    expect(r.study!.done).toBeDefined();
    const h = g.heads!.netPlanner;
    expect(h.unlockedAt).toBe(r.study!.done);
    expect(g.achievements!.firstStudy).toBe(r.study!.done);
    expect(h.candidates!.length).toBe(3);
    expect(hireHead(g, 'netPlanner', 0).ok).toBe(true);
  }, 120_000);

  it('an older save with a study done and no planner yet earns it on load; loading again changes nothing', () => {
    const g = newGame(11);
    const res = startStudy(g, 'LIS-OXB', 'desk');
    const r = g.network!.routes[res.routeId!];
    for (let i = 0; i < 120 && r.status === 'study'; i++) advanceTo(g, g.now + DAY, new Set());
    expect(r.status).toBe('case');
    // As v0.20 left it: no such achievement, the head locked.
    delete g.achievements!.firstStudy;
    g.heads!.netPlanner.unlockedAt = null;
    delete g.heads!.netPlanner.candidates;
    const old = deserialize(serialize(g));
    expect(old.achievements!.firstStudy).toBe(old.now);
    expect(old.heads!.netPlanner.unlockedAt).toBe(old.now);
    expect(old.heads!.netPlanner.candidates!.length).toBe(3);
    const state = (x: typeof old) => JSON.stringify(JSON.parse(serialize(x)).state);
    const again = deserialize(serialize(old));
    expect(state(again) === state(old)).toBe(true);
  }, 120_000);

  it('a save with no study done stays locked on load', () => {
    const g = newGame(12);
    const back = deserialize(serialize(g));
    expect(back.heads!.netPlanner.unlockedAt).toBeNull();
    expect(back.achievements?.firstStudy).toBeUndefined();
  });
});
