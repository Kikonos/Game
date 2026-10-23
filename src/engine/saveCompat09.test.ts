// v0.9 save compatibility (UPDATE-0.9.md §10, §14): every older fixture, and a real v0.8 save, loads with the v0.9
// defaults; heads locked or backfilled with one message; 60 days with no illegal duty flown; serialise/reload equal.

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';
import { bad, fixture, play } from './fixtures/compatKit';
import { headsView } from './ops/heads';
import { achievementsView } from './ops/achievements';

describe('v0.9 load: heads, achievements, roster planning, stats (UPDATE-0.9.md §10)', () => {
  for (const name of ['v052', 'v06', 'v07', 'v071', 'v072', 'v073', 'v08']) {
    it(`${name}: §10 defaults, heads locked or backfilled once${name === 'v08' ? ', 60 days legal, round-trip' : ''}`, () => {
      const text = fixture(name);
      const file = JSON.parse(text) as { state: GameState };
      expect(file.state.heads).toBeUndefined();
      const g = deserialize(text);
      // §10 defaults.
      expect(Object.keys(g.heads ?? {}).sort()).toEqual(['analyst', 'credit', 'crewDesk', 'fleetPlanner', 'maintPlanner', 'opsControl', 'watch']);
      for (const h of Object.values(g.heads!)) {
        expect(h.hired).toBeNull();
        expect(Array.isArray(h.proposals) && Array.isArray(h.log)).toBe(true);
      }
      expect(g.achievements).toBeDefined();
      expect(g.dayPlan).toBeDefined();
      expect(headsView(g).length).toBe(7);
      expect(achievementsView(g).length).toBe(24);
      // At most one message each: achievements earned before, heads available, roster planning changed.
      const titles = g.messages.slice(0, 6).map((m) => m.title);
      expect(titles.filter((t) => /achievements already earned$/.test(t)).length).toBeLessThanOrEqual(1);
      expect(titles.filter((t) => /department heads? (is|are) available/.test(t)).length).toBeLessThanOrEqual(1);
      expect(g.messages.filter((m) => m.topic === 'achievement').length).toBe(0);
      const unlocked = Object.values(g.heads!).filter((h) => h.unlockedAt !== null).length;
      if (unlocked) expect(titles.some((t) => /department heads? (is|are) available/.test(t))).toBe(true);
      if (name !== 'v08') return;
      const ill0 = g.stats.illegalFlown ?? 0;
      const end = g.now + 60 * DAY;
      while (g.now < end && !g.gameOver) {
        advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
        play(g);
      }
      expect(g.gameOver).toBeNull();
      expect(g.stats.illegalFlown ?? 0).toBe(ill0);
      expect(bad(g)).toEqual([]);
      const again = deserialize(serialize(g));
      expect(JSON.parse(serialize(again)).state).toEqual(JSON.parse(serialize(g)).state);
    }, 240_000);
  }
});
