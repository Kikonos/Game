// v0.6 save compatibility (UPDATE-0.6.md §10): a real v0.5.2 save (made by the release build, 30 days into a game
// with one extra cabin crew by policy) loads with defaults, plays 30 days and serialises with no NaN. Later eras:
// saveCompat072/073/08.test.ts.

import { describe, expect, it } from 'vitest';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { moraleSummary, rosterBoard } from './crew';
import { problems } from './ops';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';
import { bad, fixture, play } from './fixtures/compatKit';

const raw = () => fixture('v052');
const v06 = () => fixture('v06');

describe('v0.5.2 saves', () => {
  it('load with v0.6 defaults, play 30 days and serialise cleanly', () => {
    const text = raw();
    expect(text).toContain('"format":"contrail-acmi-save"');
    expect(text).not.toContain('"classes"');
    const g = deserialize(text);
    expect(g.classes).toEqual({});
    expect(Object.values(g.crew).every((c) => c.notice === undefined && c.moraleWhy === undefined)).toBe(true);
    // Read APIs work on the old state.
    expect(moraleSummary(g).avg).toBeGreaterThan(0);
    expect(rosterBoard(g, g.now, g.now + 7 * DAY, Object.keys(g.crew).slice(0, 5))).toHaveLength(5);
    const end = g.now + 30 * DAY;
    while (g.now < end && !g.gameOver) {
      advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
      play(g);
    }
    expect(g.gameOver).toBeNull();
    expect(bad(g)).toEqual([]);
    const again = deserialize(serialize(g));
    expect(again.now).toBe(g.now);
    // The company default of one extra cabin crew now rides on optional seats.
    expect(Object.values(g.pairings).some((p) => p.slots.some((s) => s.above))).toBe(true);
    expect(Object.values(g.crew).some((c) => c.moraleWhy && Object.keys(c.moraleWhy).length)).toBe(true);
  }, 60_000);
});

// v0.7 (UPDATE-0.7.md §10): the v0.5.2 fixture and a v0.6 save (made by the v0.6 release code: an A321 delivering,
// dry leases) load with the v0.7 defaults, play 60 days with no NaN, and the v0.6 delivery joins at home base.

describe('v0.7 load defaults', () => {
  for (const [name, text] of [['v0.5.2', raw], ['v0.6', v06]] as const) {
    it(`${name}: ladder, market and lease defaults; 60 days played cleanly`, () => {
      const g = deserialize(text());
      expect(g.company.approvalsAt).toBeDefined();
      for (const id of g.company.approvals) expect(g.company.approvalsAt![id]).toBe(g.started);
      expect(g.stats.incidents).toEqual([]);
      for (const o of g.market.aircraft) expect(o.site).toBe(g.company.homeBase);
      for (const ac of Object.values(g.fleet)) {
        if (ac.ownership.kind !== 'dryLeaseIn') continue;
        expect(ac.ownership.returnSite).toBe(g.company.homeBase);
        expect(ac.ownership.deliveredLayout).toBe(ac.cabin.layout);
      }
      expect(g.goals.map((x) => x.id)).toContain('widebodyOps');
      const delivering = Object.values(g.fleet).filter((a) => a.status === 'delivering');
      if (name === 'v0.6') expect(delivering.length).toBe(1);
      for (const ac of delivering) expect(ac.delivery).toBeUndefined();
      const end = g.now + 60 * DAY;
      while (g.now < end && !g.gameOver) {
        advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
        play(g);
      }
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      for (const ac of delivering) {
        const now = g.fleet[ac.id];
        if (now && now.deliveredAt <= g.now) expect(now.status === 'delivering').toBe(false);
        if (now) expect(now.delivery).toBeUndefined();
      }
      const again = deserialize(serialize(g));
      expect(again.now).toBe(g.now);
    }, 90_000);
  }
});

// v0.7.1 (UPDATE-0.7.1.md §13, §17): the v0.5.2, v0.6 and a v0.7 save (made by the v0.7 release code, 60 days in) load
// with the crew-control defaults, play 60 days and serialise clean; crewWarned marks become the amber stage.
describe('v0.7.1 load defaults', () => {
  const v07 = () => fixture('v07');

  for (const [name, text] of [['v0.5.2', raw], ['v0.6', v06], ['v0.7', v07]] as const) {
    it(`${name}: crewAlert from crewWarned, crewFixes default, the ladder tick queued; 60 days played cleanly`, () => {
      const file = JSON.parse(text()) as { state: GameState };
      // A hand-made crewWarned mark on a scheduled flight loads as the amber stage.
      const warned = Object.values(file.state.flights).find((f) => f.status === 'scheduled' && f.aircraftId);
      if (warned) warned.crewWarned = true;
      const g = deserialize(JSON.stringify(file));
      expect(g.stats.crewFixes).toEqual({});
      expect(g.queue.filter((e) => e.type === 'crew.alert')).toHaveLength(1);
      if (warned) expect(g.flights[warned.id].crewAlert).toBe('amber');
      for (const f of Object.values(g.flights)) if (!f.crewWarned) expect(f.crewAlert).toBeUndefined();
      expect(() => problems(g)).not.toThrow();
      const end = g.now + 60 * DAY;
      while (g.now < end && !g.gameOver) {
        advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
        play(g);
      }
      expect(g.gameOver).toBeNull();
      expect(bad(g)).toEqual([]);
      const again = deserialize(serialize(g));
      expect(again.now).toBe(g.now);
      expect(again.queue.filter((e) => e.type === 'crew.alert')).toHaveLength(1);
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

