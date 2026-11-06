// v0.17 lessor calls (UPDATE-0.17.md §J.1; lane `supply`): the daily random offers become lessor calls (narrowbody and
// widebody rolls, lessors that fit our grade and caps). Step 0: today's dailyMarket body, unchanged.

import type { GameState } from '../core/types';
import { dailyMarketLegacy } from '../ops/market';

/** Daily (dailyMarket while BAL.v017.on): lessor calls. Step 0: the v0.16 market's daily roll. */
export function dailyCalls(g: GameState): void {
  dailyMarketLegacy(g);
}
