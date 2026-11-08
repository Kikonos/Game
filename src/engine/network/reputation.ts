// v0.19 route reputation 0–100 (UPDATE-0.19.md §I): moves after each sector and with planned changes, fades toward
// the start value (half-life BAL.v019.rep.halfLife) and enters the share as a 30-day average.

import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import type { Route } from './types';

/** Moves a route's reputation by `delta` (clamped 0–100). */
export function bumpRoute(g: GameState, routeId: string, delta: number, _why: string): void {
  const r = g.network?.routes[routeId];
  if (!r || !delta) return;
  r.reputation = Math.max(0, Math.min(100, Math.round((r.reputation + delta) * 100) / 100));
}

/** Daily: reputation fades toward the start value (half-life BAL.v019.rep.halfLife days). */
export function fadeReputation(_g: GameState, r: Route): void {
  const R = BAL.v019.rep;
  const k = Math.pow(0.5, 1 / R.halfLife);
  r.reputation = Math.round((R.start + (r.reputation - R.start) * k) * 100) / 100;
}

/** §I words. */
export function repWord(rep: number): string {
  for (const [lim, w] of BAL.v019.rep.words) if (rep < lim) return w;
  return 'Very good';
}

export const REP_DAY = DAY;
