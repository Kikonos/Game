// v0.17 the bot's fleet planning on the aircraft market (UPDATE-0.17.md §O; lane `market-ui`): requests to lessors
// for narrowbody growth and the widebody, short-term aircraft in the summer, tech reps, and the `--greedy` probe of the
// caps. Step 0: does nothing (the existing fleet rules in acmi-bot.ts sign lessor calls as before).

import type { GameState } from '../../src/engine/core/types';

export interface BotMarketOpts {
  /** --greedy: every 30 days a request for every widebody type the gate allows; signs every proposal it can afford. */
  greedy: boolean;
  /** --newfam: a 737-800 variation in month 8 (tests §H). */
  newfam: boolean;
}

/** Once a day from acmi-bot.ts policy(). True when it acted (the caller re-plans). Step 0: never acts. */
export function botMarket(g: GameState, opts: BotMarketOpts): boolean {
  void g;
  void opts;
  return false;
}
