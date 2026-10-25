// v0.10 types taken out of the game. The 777-200LR (b77l) went at the player's request: every reference in an older
// save (airframes, market offers, contracts, deliveries, queued events, per-type tallies, text) becomes the
// 777-200ER (b772). Crew ratings are by family (B777), so they stay valid. Runs first on load; idempotent. Pure.

import type { GameState } from '../core/types';

/** Retired type id → the type that replaces it. */
export const RETIRED_TYPES: Readonly<Record<string, string>> = { b77l: 'b772' };

/** Display names of retired types → the replacement's (messages, ledger lines, history). */
const RETIRED_TEXT: readonly [RegExp, string][] = [
  [/777-200LR/g, '777-200ER'],
  [/\bB77L\b/g, 'B772'],
];

function fixString(s: string): string {
  if (RETIRED_TYPES[s]) return RETIRED_TYPES[s];
  if (!s.includes('777-200LR') && !s.includes('B77L')) return s;
  return RETIRED_TEXT.reduce((t, [re, to]) => t.replace(re, to), s);
}

function walk(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return fixString(v);
  if (!v || typeof v !== 'object' || depth > 40) return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = walk(v[i], depth + 1);
    return v;
  }
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const val = walk(o[k], depth + 1);
    const to = RETIRED_TYPES[k];
    if (to) {
      // a per-type record: the retired key joins the replacement's (kept when both exist)
      delete o[k];
      if (!(to in o)) o[to] = val;
    } else o[k] = val;
  }
  return o;
}

/** Replaces every retired type in a loaded save. Returns how many airframes changed type. */
export function retireTypes(g: GameState): number {
  const n = Object.values(g.fleet ?? {}).filter((ac) => RETIRED_TYPES[ac.typeId]).length;
  walk(g, 0);
  return n;
}
