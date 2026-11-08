// v0.19 scheduled routes: the network's calls that contracts make (feasibility lists our rotations in a job's window,
// signing clears them). A registry with no imports, filled by engine/network/index.ts, so contracts never import the
// network's modules (which import crew, ops and contracts: an import cycle).

import type { GameState, Minute } from './types';
import type { RouteChoice } from '../network/types';

export const netHooks: {
  conflicts?: (g: GameState, aircraftId: string, from: Minute, to: Minute) => { rotId: string }[];
  clearForJob?: (g: GameState, aircraftId: string, from: Minute, to: Minute, choices: Record<string, RouteChoice>) => string | null;
} = {};
