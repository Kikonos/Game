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
