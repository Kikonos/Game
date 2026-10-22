// v0.7.3 "Day length X of Y · Why Y?" (UPDATE-0.7.3.md §2.6 item 5, §7): the plain-language reasons behind a duty's
// limit (report band, sectors, acclimatisation, rest facilities, the cabin crew's table, extension, split duty,
// standby, delayed report, discretion) and the player's "Fly it with 4 pilots".

import type { ActionResult, GameState } from '../core/types';

export interface FdpWhy {
  fdp: number;
  limit: number;
  mode: 'basic' | 'split' | 'ext' | 'aug1' | 'aug2';
  /** 'Day length 15:20 of 16:00'. */
  title: string;
  /** 'Why 16:00? 3 pilots with bunks (class 1) allow 16 h. With business seats it would be 15 h; with no rest, 13 h.' */
  why: string;
  /** 'Cabin crew: 15:35 day (report 15 min earlier) → each needs 2:15 rest (band 15:31–16:00, class 1).' */
  cabin: string | null;
  /** Report band / sectors / acclimatisation; extension, split, standby, delayed report, discretion lines. */
  notes: string[];
  /** No rest 13:00 · Extension — · 3 pilots 16:00 · 4 pilots 17:00. */
  options: { label: string; max: number | null }[];
}

/** v0.7.3 why a duty's limit is what it is. Pure. STUB */
export function fdpWhy(_g: GameState, _dutyId: string): FdpWhy | null {
  return null;
}

/** v0.7.3 'Fly it with 4 pilots' (aug 2) or back to the planner's choice (null); re-rosters the pairing. STUB */
export function setDutyAugment(_g: GameState, _dutyId: string, _aug: 2 | null): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
