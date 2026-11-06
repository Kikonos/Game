// v0.14.1 copies of the game state: previews (Crew Control dry runs) and an all-or-nothing wrapper for crew changes
// the player or the engine applies (a change that throws half-way is undone, never left half-applied).

import { flightsReplaced } from '../core/entities';
import { safetyTrip } from '../core/safety';
import type { GameState } from '../core/types';
import { touchCrew, touchCrewState } from './timeline';

/**
 * v0.8 speed: a copy of the state for a preview. Duty logs and the inbox only ever grow by new entries, so the copy
 * gets its own arrays holding the same entries (a third cheaper than cloning them).
 */
export function previewCopy(g: GameState): GameState {
  const { crew, messages, ...rest } = g;
  const h = copyData(rest) as GameState;
  h.crew = {};
  for (const id in crew) {
    const { log, ...c } = crew[id];
    h.crew[id] = { ...copyData(c), log: log?.slice() ?? log };
  }
  h.messages = messages.slice();
  return h;
}

/**
 * v0.9 round 4 speed: a deep copy of save data (plain objects, arrays and primitives: what serialize writes), key
 * order and undefined values kept as structuredClone keeps them, at a third of its cost for this shape. Anything
 * else (nothing in a GameState) still goes through structuredClone.
 */
function copyData<T>(v: T): T {
  if (typeof v !== 'object' || v === null) return v;
  if (Array.isArray(v)) {
    const out = new Array<unknown>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = copyData(v[i]);
    return out as T;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return structuredClone(v);
  const out: Record<string, unknown> = {};
  for (const k in v) out[k] = copyData((v as Record<string, unknown>)[k]);
  return out as T;
}

let depth = 0;

/** Puts the state back to a copy taken before a change (previewCopy) and moves every runtime index on. */
export function restoreState(g: GameState, snap: GameState): void {
  const gg = g as unknown as Record<string, unknown>;
  for (const k of Object.keys(gg)) if (!(k in snap)) delete gg[k];
  Object.assign(g, snap);
  flightsReplaced(g);
  touchCrew(g);
  touchCrewState(g);
}

/**
 * v0.14.1 runs a crew change all or nothing: when it throws, the state is put back as it was (a copy taken first),
 * the bug is reported (core/safety: thrown in tests, logged in the game) and `fail` answers the caller. Nested calls
 * run inside the outermost one's copy.
 * v0.14.1 (merge) `refused`: a change that answers 'not possible' is put back too. Crew Control's fly-in took the
 * out-of-hours crew off their seats, then found the jet could seat nobody and said so, leaving the trip with no crew
 * (bot seed 2, EI4041 at Ibiza: its flown first leg then 'released' crew called in at Dublin there).
 */
export function atomic<T>(g: GameState, where: string, fail: (msg: string) => T, fn: () => T, refused?: (r: T) => boolean): T {
  if (depth > 0) return fn();
  const snap = previewCopy(g);
  depth++;
  try {
    const r = fn();
    if (refused?.(r)) restoreState(g, snap);
    return r;
  } catch (e) {
    restoreState(g, snap);
    safetyTrip(where, String((e as Error)?.stack ?? e));
    return fail('That change could not be made: nothing was changed.');
  } finally {
    depth--;
  }
}

/**
 * v0.14.1 (merge) the UI's guard for a player action (store.act): fn on the live state; when it throws, the state is put
 * back to the copy taken before (never half-applied) and `onThrow` answers. Independent of atomic(): the engine's own
 * all-or-nothing changes inside fn still take their own copies (a refused one is still put back).
 */
export function guarded<T>(g: GameState, fn: () => T, onThrow: (e: unknown) => T): T {
  const snap = previewCopy(g);
  try {
    return fn();
  } catch (e) {
    restoreState(g, snap);
    return onThrow(e);
  }
}
