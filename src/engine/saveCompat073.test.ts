// v0.7.3 save compatibility (split from saveCompat.test.ts).

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import { BAL } from './core/balance';
import type { GameState } from './core/types';
import { restPlan } from './crew/restPlan';
import { evalSegs } from './crew/rules';
import { ctxOf, segsOf } from './crew/timeline';
import { typeOf } from './core/perf';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';
import { bad, fixture, play } from './fixtures/compatKit';

// v0.7.3 (UPDATE-0.7.3.md §2.1, §9): a real v0.7.2 save (made by the v0.7.2 code: bot seed 3 --wide, 240 days, plus
// three A330-300s with rest seats / nothing / bunks and an augmented LIS–GRU duty each two days out) loads with the
// new rest facilities, keeps every duty's legality over the first 72 h, and plays 60 days legally.
describe('v0.7.3 load: pilot and cabin crew rest facilities', () => {
  const v072 = () => fixture('v072');
  it('v0.7.2: {bunks, seats} → rest per the migration table, crewed duties kept, 60 days legal, round-trip', () => {
    const file = JSON.parse(v072()) as { state: GameState };
    const before = new Map(Object.values(file.state.duties).map((d) => [d.id, d.legality]));
    const g = deserialize(JSON.stringify(file));
    const reg = (r: string) => Object.values(g.fleet).find((a) => a.reg.endsWith(r))!;
    // (v0.7.4: crew rest recliners are class 2)
    expect(reg('DVR').rest).toEqual({ fc: { cls: 2, kind: 'recliners', places: 2 }, cc: { cls: 2, kind: 'recliners', places: 6 } });
    expect(reg('DVS').rest).toEqual({ fc: null, cc: null });
    expect(reg('DVT').rest).toEqual({ fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: { cls: 1, kind: 'ldmcr', places: 7 } });
    for (const ac of Object.values(g.fleet)) if (typeOf(ac.typeId).body === 'narrow') expect(ac.rest).toEqual({ fc: null, cc: null });
    // crewed duties reporting within 72 h are grandfathered
    const soon = Object.values(g.duties).filter((d) => !d.done && d.report <= g.now + 72 * 60 && g.pairings[d.pairingId]?.slots.some((s) => s.crewId));
    expect(soon.length).toBeGreaterThan(0);
    expect(soon.every((d) => d.legacyRest)).toBe(true);
    // nothing turns illegal over the first 72 h
    const end72 = g.now + 72 * 60;
    while (g.now < end72) {
      advanceTo(g, Math.min(end72, g.now + 60), new Set());
      for (const d of Object.values(g.duties)) if (before.has(d.id) && before.get(d.id) !== 'illegal') expect(d.legality, d.id).not.toBe('illegal');
    }
    expect(g.stats.illegalFlown ?? 0).toBe(file.state.stats.illegalFlown ?? 0);
    const end = g.now + 60 * DAY;
    while (g.now < end && !g.gameOver) {
      advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
      play(g);
    }
    expect(g.gameOver).toBeNull();
    expect(bad(g)).toEqual([]);
    // Inside the published roster (v0.7.4: a far-off duty may carry a stale ticket home until the roster reaches it;
    // the roster re-plans it when it comes within the horizon).
    const horizon = g.now + BAL.rosterHorizonDays * DAY;
    const near = (i: { dutyId?: string }) => !i.dutyId || (g.duties[i.dutyId]?.report ?? 0) <= horizon;
    for (const c of Object.values(g.crew)) expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && i.code !== 'location' && near(i)).map((i) => `${c.id}:${i.code}`)).toEqual([]);
    const again = deserialize(serialize(g));
    expect(JSON.parse(serialize(again)).state).toEqual(JSON.parse(serialize(g)).state);
  }, 240_000);

  it('v0.7.2: a crewed trip is grandfathered per pairing; every other augmented duty is re-planned and flies with a working rest plan', () => {
    const g = deserialize(v072());
    for (const p of Object.values(g.pairings)) {
      const open = p.dutyIds.map((id) => g.duties[id]).filter((d) => d && !d.done);
      // a trip's legs are grandfathered together (a return leg is never stranded at the outstation)
      if (open.some((d) => d.legacyRest)) expect(open.every((d) => d.legacyRest), p.id).toBe(true);
    }
    advanceTo(g, g.now + 60, new Set());
    for (const d of Object.values(g.duties)) {
      if (d.done || d.augment === 0 || d.legacyRest) continue;
      expect(restPlan(g, d.id)?.ok, `${d.id} ${restPlan(g, d.id)?.code}`).toBe(true);
    }
    const flown = new Set<string>();
    const end = g.now + 5 * DAY;
    while (g.now < end) {
      advanceTo(g, Math.min(end, g.now + 60), new Set());
      for (const d of Object.values(g.duties)) {
        if (flown.has(d.id) || !d.done || d.augment === 0 || d.legacyRest) continue;
        flown.add(d.id);
        expect(restPlan(g, d.id)?.ok, `${d.id} ${restPlan(g, d.id)?.code}`).toBe(true);
      }
    }
  }, 120_000);
});

