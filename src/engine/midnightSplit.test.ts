// v0.25 (perf, core-i1) the midnight work runs in phases; the UI frame loop (advanceTo split) may draw a frame between
// two of them. The game must play out exactly as with one call per step, and a save taken between two phases loads
// and finishes that midnight.

import { describe, expect, it } from 'vitest';
import { fixture } from './fixtures/compatKit';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { resolveDecision } from './ops';
import { deserialize, serialize } from './save';
import { advanceTo, midDay } from './sim';

const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);
const decide = (g: GameState) => {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
};

describe('midnight in phases', () => {
  it('plays the same with a frame between the phases as in one step', () => {
    const raw = fixture('v0242-v7892');
    const a = deserialize(raw);
    const b = deserialize(raw);
    const start = a.now;
    let halves = 0;
    for (let h = 1; h <= 3 * 24; h++) {
      const t = start + h * 60;
      advanceTo(a, t);
      for (let i = 0; i < 20; i++) {
        const r = advanceTo(b, t, undefined, true);
        if (!r.midDay) break;
        halves++;
        expect(midDay(b)).toBe(true);
        expect(b.now % DAY).toBe(0);
      }
      decide(a);
      decide(b);
      expect(b.now).toBe(a.now);
    }
    // Three midnights, each stopped twice (crew roster and crew plan are phases of their own).
    expect(halves).toBe(6);
    expect(state(b)).toBe(state(a));
  });

  it('a save between two phases loads and finishes the day', () => {
    const g = deserialize(fixture('v0242-v7892'));
    const mid = Math.ceil((g.now + 1) / DAY) * DAY;
    advanceTo(g, mid - 1);
    expect(advanceTo(g, mid + 60, undefined, true).midDay).toBe(true);
    const h = deserialize(serialize(g));
    expect(midDay(h)).toBe(true);
    advanceTo(h, mid + 60);
    expect(midDay(h)).toBe(false);
    expect(h.now).toBe(mid + 60);
    expect(h.queue.filter((e) => e.type === 'day').map((e) => [e.t, e.v])).toEqual([[mid + DAY, 0]]);
  });
});
