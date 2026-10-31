// v0.12.1 night curfews as a pure module (moved from ops/disrupt.ts), so the planners (contracts/schedule.ts,
// contracts/plan.ts, crew deadheads) can read them without importing ops code. The data is opsData CURFEWS
// (local time); a curfew bars departures and landings alike (strict = no grace for delayed flights).

import { CURFEWS } from '../../data/opsData';
import { fromUTC, localMinuteOfDay, localOffset } from './time';
import type { Minute } from './types';

/** True when a landing at `code` at `t` falls in its night curfew (`delayed` legs may use the grace). Pure. */
export function inCurfew(code: string, t: Minute, delayed = true): boolean {
  const c = CURFEWS[code];
  if (!c) return false;
  const m = localMinuteOfDay(code, t);
  const from = c.from + (delayed ? c.grace : 0);
  const inside = (x: number, a: number, b: number) => (a <= b ? x >= a && x < b : x >= a || x < b);
  return inside(m, from % 1440, c.to);
}

/** When a curfew at `code` that covers `t` ends (UTC). */
export function curfewEnd(code: string, t: Minute): Minute {
  const c = CURFEWS[code];
  if (!c) return t;
  let x = t;
  for (let i = 0; i < 48 && inCurfew(code, x, false); i++) x += 30;
  return x + 15;
}

/** v0.12.1 (A7) a local wall-clock minute (any day; wraps) falls in the strict curfew at `code`. Pure. */
export function shutLocal(code: string, local: number): boolean {
  const c = CURFEWS[code];
  if (!c) return false;
  const m = ((local % 1440) + 1440) % 1440;
  return c.from <= c.to ? m >= c.from && m < c.to : m >= c.from || m < c.to;
}

const zoneCache = new Map<string, number[]>();
/**
 * v0.12.1 (A7) every clock difference (minutes, `to` local minus `from` local) the two airports have over a year:
 * one value, or two or three where their summer times differ (EU vs Egypt or the US). Sampled weekly. Pure.
 */
export function zoneDiffs(from: string, to: string): number[] {
  const key = `${from}|${to}`;
  let out = zoneCache.get(key);
  if (!out) {
    const set = new Set<number>();
    for (let t = fromUTC(2028, 1, 3, 12); t < fromUTC(2029, 1, 3, 12); t += 7 * 1440) set.add(localOffset(to, t) - localOffset(from, t));
    zoneCache.set(key, (out = [...set]));
  }
  return out;
}

/** v0.12.1 a planned departure or landing at `code` at `t` is allowed (strict: no grace). Pure. */
export const curfewOk = (code: string, t: Minute): boolean => !inCurfew(code, t, false);

/**
 * v0.12.1 the nearest minute outside the strict curfew: the first allowed minute after it ('after'), or the last
 * allowed minute before it began ('before'). `t` itself when it is outside. Pure.
 */
export function curfewShift(code: string, t: Minute, dir: 'before' | 'after'): Minute {
  const c = CURFEWS[code];
  if (!c || curfewOk(code, t)) return t;
  const m = localMinuteOfDay(code, t);
  // Minutes from the curfew's start to m, and from m to its end (both through local midnight).
  const since = (m - c.from + 1440) % 1440;
  const left = (c.to - m + 1440) % 1440;
  let x = dir === 'after' ? t + left : t - since - 1;
  // A summer-time change inside the night moves the local clock by an hour: step to the edge.
  const step = dir === 'after' ? 1 : -1;
  for (let i = 0; i < 180 && !curfewOk(code, x); i++) x += step;
  // ...or past it (the clock jumped): walk back towards t while the minute before is still allowed.
  for (let i = 0; i < 180 && curfewOk(code, x - step); i++) x -= step;
  return x;
}
