// v0.16 the bot's sales policy (UPDATE-0.16.md §C; lane sales), run once a day from scripts/acmi-bot.ts: register with
// two brokers in month 2, send a proposal on every lead, pitch two airlines a season, hire one sales manager for the home
// market once cash allows. Pure in g. Step 0: nothing (the game plays exactly as before).

import type { GameState } from '../../src/engine/core/types';

/** Returns true when it acted (the bot settles after). */
export function botSales(_g: GameState): boolean {
  return false;
}
