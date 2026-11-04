// v0.16 the bot's finance policy (UPDATE-0.16.md §A; lane finance), run once a day from scripts/acmi-bot.ts: open the
// credit line once two statements are closed, draw when the 30-day forecast dips below zero and repay when cash is
// comfortable, factor a late invoice before cash runs short, never a leaseback unless insolvent. Pure in g.
// Step 0: nothing (the game plays exactly as before).

import type { GameState } from '../../src/engine/core/types';

/** Returns true when it acted (the bot settles after). */
export function botFinance(_g: GameState): boolean {
  return false;
}
