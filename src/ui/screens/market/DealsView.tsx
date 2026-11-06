// v0.17 Fleet › Market (UPDATE-0.17.md §N; lane `market-ui`): In progress: one row per deal and per transition, stage chips and the next action (§N.1).
// Step 0: a slot that renders nothing until the lane fills it.

import type { GameState } from '../../../engine/core/types';

export function DealsView({ g }: { g: GameState }) {
  void g;
  return null;
}
