// v0.6 save compatibility (UPDATE-0.6.md §10): a real v0.5.2 save (made by the release build, 30 days into a game
// with one extra cabin crew by policy) loads with defaults, plays on and serialises with no NaN. Then the v0.7, v0.7.1
// and v0.7.2 loads of the fixtures up to v0.7.1. Later eras: saveCompat073/08/09.test.ts.

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { migrateRanks, moraleSummary, rosterBoard } from './crew';
import { evalSegs } from './crew/rules';
import { ctxOf, segsOf } from './crew/timeline';
import { typeOf } from './core/perf';
import { problems } from './ops';
import { deserialize, serialize } from './save';
import { bad, fixture, playTo } from './fixtures/compatKit';

const raw = () => fixture('v052');
const v06 = () => fixture('v06');
const v07 = () => fixture('v07');

/** The fixture as loaded by v0.7.1 tests: a hand-made crewWarned mark on its first scheduled flight; that flight's id. */
function marked(text: string): { text: string; warned?: string } {
  const file = JSON.parse(text) as { state: GameState };
  const warned = Object.values(file.state.flights).find((f) => f.status === 'scheduled' && f.aircraftId);
  if (warned) warned.crewWarned = true;
  return { text: JSON.stringify(file), warned: warned?.id };
}

/**
 * Each fixture (with the crewWarned mark) loaded and played once, 60 days (v0.7.1: 30), with the light player step:
 * every era's after-play checks read the same run (the play is the same code from the same load; one run per
 * fixture, not one per era).
 */
const runs = new Map<string, Promise<GameState>>();
function played(name: string, text: () => string, days = 60): Promise<GameState> {
  let r = runs.get(name);
  if (!r) {
    r = (async () => {
      const g = deserialize(marked(text()).text);
      await playTo(g, g.now + days * DAY);
      return g;
    })();
    runs.set(name, r);
  }
  return r;
}

describe('v0.5.2 saves', () => {
  it('load with v0.6 defaults, play on (60 days) and serialise cleanly', async () => {
    const text = raw();
    expect(text).toContain('"format":"contrail-acmi-save"');
    expect(text).not.toContain('"classes"');
    const g0 = deserialize(text);
    expect(g0.classes).toEqual({});
    expect(Object.values(g0.crew).every((c) => c.notice === undefined && c.moraleWhy === undefined)).toBe(true);
    // Read APIs work on the old state.
    expect(moraleSummary(g0).avg).toBeGreaterThan(0);
    expect(rosterBoard(g0, g0.now, g0.now + 7 * DAY, Object.keys(g0.crew).slice(0, 5))).toHaveLength(5);
    const g = await played('v052', raw);
    expect(g.gameOver).toBeNull();
    expect(bad(g)).toEqual([]);
    const again = deserialize(serialize(g));
    expect(again.now).toBe(g.now);
    // The company default of one extra cabin crew now rides on optional seats.
    expect(Object.values(g.pairings).some((p) => p.slots.some((s) => s.above))).toBe(true);
    expect(Object.values(g.crew).some((c) => c.moraleWhy && Object.keys(c.moraleWhy).length)).toBe(true);
  }, 120_000);
});

// v0.7 (UPDATE-0.7.md §10): the v0.5.2 fixture and a v0.6 save (made by the v0.6 release code: an A321 delivering,
// dry leases) load with the v0.7 defaults, play 60 days with no NaN, and the v0.6 delivery joins at home base.

describe('v0.7 load defaults', () => {
  for (const [name, key, text] of [['v0.5.2', 'v052', raw], ['v0.6', 'v06', v06]] as const) {
    it(`${name}: ladder, market and lease defaults; 60 days played cleanly`, async () => {
      const g0 = deserialize(text());
      expect(g0.company.approvalsAt).toBeDefined();
      for (const id of g0.company.approvals) expect(g0.company.approvalsAt![id]).toBe(g0.started);
      expect(g0.stats.incidents).toEqual([]);
      for (const o of g0.market.aircraft) expect(o.site).toBe(g0.company.homeBase);
      for (const ac of Object.values(g0.fleet)) {
        if (ac.ownership.kind !== 'dryLeaseIn') continue;
        expect(ac.ownership.returnSite).toBe(g0.company.homeBase);
        expect(ac.ownership.deliveredLayout).toBe(ac.cabin.layout);
      }
      expect(g0.goals.map((x) => x.id)).toContain('widebodyOps');
      const delivering = Object.values(g0.fleet).filter((a) => a.status === 'delivering');
      if (name === 'v0.6') expect(delivering.length).toBe(1);
      for (const ac of delivering) expect(ac.delivery).toBeUndefined();
      const g = await played(key, text);
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      for (const ac of delivering) {
        const now = g.fleet[ac.id];
        if (now && now.deliveredAt <= g.now) expect(now.status === 'delivering').toBe(false);
        if (now) expect(now.delivery).toBeUndefined();
      }
      const again = deserialize(serialize(g));
      expect(again.now).toBe(g.now);
    }, 120_000);
  }
});

// v0.7.1 (UPDATE-0.7.1.md §13, §17): the v0.5.2, v0.6 and a v0.7 save (made by the v0.7 release code, 60 days in) load
// with the crew-control defaults, play 60 days and serialise clean; crewWarned marks become the amber stage.
describe('v0.7.1 load defaults', () => {
  for (const [name, key, text] of [['v0.5.2', 'v052', raw], ['v0.6', 'v06', v06], ['v0.7', 'v07', v07]] as const) {
    it(`${name}: crewAlert from crewWarned, crewFixes default, the ladder tick queued; 60 days played cleanly`, async () => {
      // A hand-made crewWarned mark on a scheduled flight loads as the amber stage.
      const { text: withMark, warned } = marked(text());
      const g0 = deserialize(withMark);
      expect(g0.stats.crewFixes).toEqual({});
      expect(g0.queue.filter((e) => e.type === 'crew.alert')).toHaveLength(1);
      if (warned) expect(g0.flights[warned].crewAlert).toBe('amber');
      for (const f of Object.values(g0.flights)) if (!f.crewWarned) expect(f.crewAlert).toBeUndefined();
      expect(() => problems(g0)).not.toThrow();
      const g = await played(key, text);
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      const again = deserialize(serialize(g));
      expect(again.now).toBe(g.now);
      expect(again.queue.filter((e) => e.type === 'crew.alert')).toHaveLength(1);
    }, 120_000);
  }
});

// v0.7.2 (UPDATE-0.7.2.md §4, §3.1): CSD and SCC become PUR (crew, slots, hires), old widebodies keep bunks; a real
// v0.7.1 save (made by the v0.7.1 code, 60 days in, an A320 pair and a 767 with CSD/SCC crew) plays on cleanly.
describe('v0.7.2 load: ranks merged into PUR, crew rest defaults', () => {
  const v071 = () => fixture('v071');
  for (const [name, key, text] of [['v0.5.2', 'v052', raw], ['v0.6', 'v06', v06], ['v0.7', 'v07', v07], ['v0.7.1', 'v071', v071]] as const) {
    it(`${name}: no CSD/SCC left, nothing lost, one purser a widebody crew, bunks on old widebodies; ${key === 'v071' ? 30 : 60} days legal`, async () => {
      const file = JSON.parse(text()) as { state: GameState };
      const ids = Object.keys(file.state.crew).sort();
      const roles0 = Object.values(file.state.crew).map((c) => c.role as string);
      const g0 = deserialize(JSON.stringify(file));
      expect(Object.keys(g0.crew).sort()).toEqual(ids);
      const has = (r: string) => Object.values(g0.crew).some((c) => (c.role as string) === r) || Object.values(g0.pairings).some((p) => p.slots.some((s) => (s.role as string) === r)) || g0.hires.some((h) => (h.role as string) === r);
      expect(has('CSD') || has('SCC')).toBe(false);
      expect(Object.values(g0.crew).filter((c) => c.role === 'PUR').length).toBe(roles0.filter((r) => r === 'CSD' || r === 'SCC' || r === 'PUR').length);
      for (const p of Object.values(g0.pairings)) {
        if (p.status !== 'planned' || !p.slots.some((s) => s.role === 'PUR' || s.role === 'CC')) continue;
        expect(p.slots.filter((s) => s.role === 'PUR').length).toBe(1);
      }
      // v0.7.3 old widebodies keep bunks for pilots and cabin crew (v0.7.4: never the 767, bunks always as a pair);
      // narrowbodies have nothing fitted (their curtained economy seats follow the cabin).
      for (const ac of Object.values(g0.fleet)) {
        const t = typeOf(ac.typeId);
        expect(!!ac.rest?.fc && ac.rest.fc.cls === 1 && ac.rest.cc?.cls === 1, ac.typeId).toBe(t.body === 'wide' && t.rest.bunkShare > 0);
        expect(ac.rest?.fc?.cls === 1).toBe(ac.rest?.cc?.cls === 1);
      }
      expect(migrateRanks(g0)).toBe(0);
      const g = await played(key, text, key === 'v071' ? 30 : 60);
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      // FTL limits hold for everyone (a trip under way can read 'location' at an instant: the same in v0.7.1).
      for (const c of Object.values(g.crew)) expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && i.code !== 'location').map((i) => `${c.id}:${i.code}`)).toEqual([]);
      const again = deserialize(serialize(g));
      expect(JSON.parse(serialize(again)).state).toEqual(JSON.parse(serialize(g)).state);
    }, 120_000);
  }
});

describe('v0.7 reload keeps pending approvals pending', () => {
  it('a widebody signed while Widebody operations is pending: a save and reload grants nothing', async () => {
    const { newGame } = await import('./contracts/testkit');
    const { devMarketOffer } = await import('./ops/market');
    const { acquireAircraft } = await import('./ops');
    const g = newGame(11);
    g.company.pendingApprovals.push({ id: 'widebody', started: g.now, done: g.now + 120 * DAY, cost: 300_000 });
    g.company.cash = 10_000_000;
    const r = acquireAircraft(g, devMarketOffer(g, 'a332', { site: 'IST' }));
    if (!r.ok) throw new Error(r.error);
    const again = deserialize(serialize(g));
    expect(again.company.approvals).not.toContain('widebody');
    expect(again.company.pendingApprovals.map((p) => p.id)).toEqual(['widebody']);
    expect(deserialize(serialize(again)).company.approvals).toEqual(g.company.approvals);
  });
});

