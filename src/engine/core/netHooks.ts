// v0.19 scheduled routes: the network's calls that contracts make (feasibility lists our rotations in a job's window,
// signing clears them). A registry with no imports, filled by engine/network/index.ts, so contracts never import the
// network's modules (which import crew, ops and contracts: an import cycle).

import type { Flight, GameState, Minute } from './types';
import type { RouteChoice } from '../network/types';

export const netHooks: {
  conflicts?: (g: GameState, aircraftId: string, from: Minute, to: Minute) => { rotId: string }[];
  clearForJob?: (g: GameState, aircraftId: string, from: Minute, to: Minute, choices: Record<string, RouteChoice>) => string | null;
  /** r3-fix a C-check's route flights: can this one go, take them off (rotation ids), fly them another way (network/release.ts). */
  routeFree?: (g: GameState, f: Flight) => boolean;
  releaseRoutes?: (g: GameState, flights: Flight[]) => string[];
  coverRoutes?: (g: GameState, rotIds: string[], reg: string, from: Minute, to: Minute) => void;
} = {};
