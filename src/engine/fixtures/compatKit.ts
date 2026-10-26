// Shared by the save-compatibility tests (one file per fixture era, so vitest spreads them over workers).

import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { acceptOffer, feasibilityAll } from '../contracts';
import type { GameState, Minute } from '../core/types';
import { resolveDecision } from '../ops';
import { advanceTo } from '../sim';
import { breathe } from '../../test/breathe';

/** A fixture save as JSON text (fixtures/save-<name>.lz.txt). */
export const fixture = (name: string): string => LZString.decompressFromBase64(readFileSync(new URL(`./save-${name}.lz.txt`, import.meta.url), 'utf8'))!;

/** Paths holding non-finite numbers (first few). */
export function bad(o: unknown, path = 'g', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) out.push(`${path}=${o}`);
  } else if (Array.isArray(o)) o.forEach((v, i) => bad(v, `${path}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) bad(v, `${path}.${k}`, out);
  return out;
}

/** A light player step: decisions by default, the best feasible open offer signed. */
export function play(g: GameState): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && g.now < o.expires).sort((a, b) => b.estValue - a.estValue || (a.id < b.id ? -1 : 1));
  for (const o of open.slice(0, 3)) {
    const r = feasibilityAll(g, o.id).find((x) => (x.level === 'ok' || x.level === 'warn') && x.estMargin > 0);
    if (r && acceptOffer(g, o.id, [r.aircraftId]).ok) return;
  }
}

/** Plays on to `end` in 6-hour steps with the light player step (until game over); the test worker breathes between steps. */
export async function playTo(g: GameState, end: Minute): Promise<void> {
  while (g.now < end && !g.gameOver) {
    advanceTo(g, Math.min(end, g.now + 6 * 60), new Set());
    play(g);
    await breathe();
  }
}
