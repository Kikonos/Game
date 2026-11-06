// v0.17 short-term aircraft from airlines (UPDATE-0.17.md §I; lane `supply`): subleases of an airline's spare aircraft
// in its quiet season. Step 0: none come, none can be asked for.

import type { RatingFamily } from '../../data/acmiTypes';
import type { ActionResult, GameState, Minute } from '../core/types';

export interface SpotDraft { family: RatingFamily; months: number; from: Minute }

/** Airlines with a spare aircraft of the family in that window (the dialog's line). Step 0: none. Pure. */
export function spotSources(g: GameState, d: SpotDraft): string[] {
  void g;
  void d;
  return [];
}

/** Asks the airlines (§I.3). Step 0: refused. */
export function askSpot(g: GameState, d: SpotDraft): ActionResult<{ rfpId: string }> {
  void g;
  void d;
  return { ok: false, error: 'Short-term aircraft are not on the market yet' };
}

/** Daily: short-term calls and answers. Step 0: nothing. */
export function dailySpot(g: GameState): void {
  void g;
}
