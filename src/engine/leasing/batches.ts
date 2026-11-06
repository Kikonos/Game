// v0.17 failure batches (UPDATE-0.17.md §J.3; lane `supply`): an airline failure releases 3–6 of its aircraft below
// market rent. Step 0: nothing is released.

import type { GameState, WorldEvent } from '../core/types';

/** An airline failed (ops/world.ts airlineFailure, or a client's administration in commercial/crises.ts). Step 0: nothing. */
export function onAirlineFailure(g: GameState, e: WorldEvent): void {
  void g;
  void e;
}
