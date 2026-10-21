// v0.6 save compatibility (UPDATE-0.6.md §10): a real v0.5.2 save (made by the release build, 30 days into a game
// with one extra cabin crew by policy) loads with defaults, plays 30 days and serialises with no NaN.

import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { acceptOffer, feasibilityAll } from './contracts';
import { DAY } from './core/time';
import type { GameState } from './core/types';
import { moraleSummary, rosterBoard } from './crew';
import { resolveDecision } from './ops';
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
describe('v0.7 load defaults', () => {
  const v06 = () => LZString.decompressFromBase64(readFileSync(new URL('./fixtures/save-v06.lz.txt', import.meta.url), 'utf8'))!;

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
