// v0.7.2 save compatibility (split from saveCompat.test.ts).

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { migrateRanks } from './crew';
import { evalSegs } from './crew/rules';
import { ctxOf, segsOf } from './crew/timeline';
import { typeOf } from './core/perf';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';
import { bad, fixture, play } from './fixtures/compatKit';

const raw = () => fixture('v052');
const v06 = () => fixture('v06');

// v0.7.2 (UPDATE-0.7.2.md §4, §3.1): CSD and SCC become PUR (crew, slots, hires), old widebodies keep bunks; a real
// v0.7.1 save (made by the v0.7.1 code, 60 days in, an A320 pair and a 767 with CSD/SCC crew) plays on cleanly.
describe('v0.7.2 load: ranks merged into PUR, crew rest defaults', () => {
  const v07 = () => fixture('v07');
  const v071 = () => fixture('v071');
  for (const [name, text] of [['v0.5.2', raw], ['v0.6', v06], ['v0.7', v07], ['v0.7.1', v071]] as const) {
    it(`${name}: no CSD/SCC left, nothing lost, one purser a widebody crew, bunks on old widebodies; 30 days legal`, () => {
      const file = JSON.parse(text()) as { state: GameState };
      const ids = Object.keys(file.state.crew).sort();
      const roles0 = Object.values(file.state.crew).map((c) => c.role as string);
      const g = deserialize(JSON.stringify(file));
      expect(Object.keys(g.crew).sort()).toEqual(ids);
      const has = (r: string) => Object.values(g.crew).some((c) => (c.role as string) === r) || Object.values(g.pairings).some((p) => p.slots.some((s) => (s.role as string) === r)) || g.hires.some((h) => (h.role as string) === r);
      expect(has('CSD') || has('SCC')).toBe(false);
      expect(Object.values(g.crew).filter((c) => c.role === 'PUR').length).toBe(roles0.filter((r) => r === 'CSD' || r === 'SCC' || r === 'PUR').length);
      for (const p of Object.values(g.pairings)) {
        if (p.status !== 'planned' || !p.slots.some((s) => s.role === 'PUR' || s.role === 'CC')) continue;
        expect(p.slots.filter((s) => s.role === 'PUR').length).toBe(1);
      }
      // v0.7.3 old widebodies keep bunks for pilots and cabin crew; narrowbodies have no in-flight rest.
      for (const ac of Object.values(g.fleet)) expect(!!ac.rest?.fc && ac.rest.fc.cls === 1 && ac.rest.cc?.cls === 1).toBe(typeOf(ac.typeId).body === 'wide');
      expect(migrateRanks(g)).toBe(0);
      const end = g.now + 30 * DAY;
      while (g.now < end && !g.gameOver) {
        advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
        play(g);
      }
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      // FTL limits hold for everyone (a trip under way can read 'location' at an instant: the same in v0.7.1).
      for (const c of Object.values(g.crew)) expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && i.code !== 'location').map((i) => `${c.id}:${i.code}`)).toEqual([]);
      const again = deserialize(serialize(g));
      expect(JSON.parse(serialize(again)).state).toEqual(JSON.parse(serialize(g)).state);
    }, 120_000);
  }
});

