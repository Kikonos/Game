// v0.8 save compatibility (split from saveCompat.test.ts).

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';
import { bad, fixture, play } from './fixtures/compatKit';

describe('v0.8 load: relations, rivals, market cycle, world (UPDATE-0.8.md §10)', () => {
  const v073 = () => fixture('v073');
  it('v0.7.3: every §10 default, levels computed without messages, 60 days legal, round-trip', () => {
    const file = JSON.parse(v073()) as { state: GameState };
    const msgs0 = file.state.messages.length;
    const g = deserialize(v073());
    // §10 defaults.
    expect(g.world).toEqual({ events: [] });
    expect(g.market.cycle?.phase).toBe('steady');
    expect(g.market.shocks).toEqual([]);
    expect(g.stats.v08).toBeDefined();
    expect([0, 1, 2]).toContain(g.company.standing);
    for (const c of Object.values(g.clients)) {
      expect(c.level).toBeDefined();
      expect(c.jobs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(c.log)).toBe(true);
    }
    for (const r of g.rivals) {
      expect(r.status).toBe('active');
      expect(r.clientId && g.clients[r.clientId]?.rivalId).toBe(r.id);
      expect(typeof r.load).toBe('number');
      expect(r.won ?? 0).toBe(0);
    }
    // A client the old game worked for is at least Known; nothing announced on load.
    expect(Object.values(g.clients).some((c) => c.level === 'known' || c.level === 'trusted' || c.level === 'partner')).toBe(true);
    // (v0.9: one note that roster planning changed; one each for achievements and heads already earned.)
    const v09Note = (t: string) => t === 'Roster planning changed' || /achievements already earned$|^A department head is available|department heads are available$/.test(t);
    expect(g.messages.filter((m) => !v09Note(m.title)).length).toBe(Math.min(msgs0, 300));
    // 60 days: no illegal duty flown, nothing non-finite.
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
});
