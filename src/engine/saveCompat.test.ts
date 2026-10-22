// v0.6 save compatibility (UPDATE-0.6.md §10): a real v0.5.2 save (made by the release build, 30 days into a game
// with one extra cabin crew by policy) loads with defaults, plays 30 days and serialises with no NaN.

import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibilityAll } from './contracts';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { migrateRanks, moraleSummary, rosterBoard } from './crew';
import { restPlan } from './crew/restPlan';
import { evalSegs } from './crew/rules';
import { ctxOf, segsOf } from './crew/timeline';
import { typeOf } from './core/perf';
import { problems, resolveDecision } from './ops';
import { deserialize, serialize } from './save';
import { advanceTo } from './sim';

const raw = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v052.lz.txt', import.meta.url), 'utf8'))!;

function bad(o: unknown, path = 'g', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(`${path}=${o}`);
  } else if (Array.isArray(o)) o.forEach((v, i) => bad(v, `${path}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) bad(v, `${path}.${k}`, out);
  return out;
}

function play(g: GameState): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
  for (const o of open.slice(0, 3)) {
    const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
    if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) return;
  }
}

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
const v06 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v06.lz.txt', import.meta.url), 'utf8'))!;

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
  const v07 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v07.lz.txt', import.meta.url), 'utf8'))!;

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

// v0.7.2 (UPDATE-0.7.2.md §4, §3.1): CSD and SCC become PUR (crew, slots, hires), old widebodies keep bunks; a real
// v0.7.1 save (made by the v0.7.1 code, 60 days in, an A320 pair and a 767 with CSD/SCC crew) plays on cleanly.
describe('v0.7.2 load: ranks merged into PUR, crew rest defaults', () => {
  const v07 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v07.lz.txt', import.meta.url), 'utf8'))!;
  const v071 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v071.lz.txt', import.meta.url), 'utf8'))!;
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

// v0.7.3 (UPDATE-0.7.3.md §2.1, §9): a real v0.7.2 save (made by the v0.7.2 code: bot seed 3 --wide, 240 days, plus
// three A330-300s with rest seats / nothing / bunks and an augmented LIS–GRU duty each two days out) loads with the
// new rest facilities, keeps every duty's legality over the first 72 h, and plays 60 days legally.
describe('v0.7.3 load: pilot and cabin crew rest facilities', () => {
  const v072 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v072.lz.txt', import.meta.url), 'utf8'))!;
  it('v0.7.2: {bunks, seats} → rest per the migration table, crewed duties kept, 60 days legal, round-trip', () => {
    const file = JSON.parse(v072()) as { state: GameState };
    const before = new Map(Object.values(file.state.duties).map((d) => [d.id, d.legality]));
    const g = deserialize(JSON.stringify(file));
    const reg = (r: string) => Object.values(g.fleet).find((a) => a.reg.endsWith(r))!;
    expect(reg('DVR').rest).toEqual({ fc: { cls: 3, kind: 'recliners', places: 2 }, cc: { cls: 3, kind: 'recliners', places: 6 } });
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
    for (const c of Object.values(g.crew)) expect(evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal' && i.code !== 'location').map((i) => `${c.id}:${i.code}`)).toEqual([]);
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

describe('v0.8 load: relations, rivals, market cycle, world (UPDATE-0.8.md §10)', () => {
  const v073 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v073.lz.txt', import.meta.url), 'utf8'))!;
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
    expect(g.messages.length).toBe(Math.min(msgs0, 300));
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
