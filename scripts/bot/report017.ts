// v0.17 the bot's market report line (UPDATE-0.17.md §O.7; lane `market-ui`), read from the state at the end of a run.
// Step 0: the lessor rating only (a pure read); the lane adds requests, deals, transitions, calls and narrowNeedToService.

import type { GameState } from '../../src/engine/core/types';
import { lessorRating } from '../../src/engine/leasing';

export function botMarketReport(g: GameState): string {
  const r = lessorRating(g);
  return `v0.17 market: lessor rating ${r.grade} (${r.score})${g.leasing ? '' : ' · no leasing state'}`;
}
