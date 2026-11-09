// v0.19 the network's side stream (UPDATE-0.19.md, ground rules): every roll for scheduled routes is drawn on
// `${seed}:network:${key}`, never on the engine's main RNG, so opening a route never shifts the rest of the game.
// Keys in use: study:<routeId>, stage:<routeId>:<stage>, sale:<rotId>:<day>, show:<rotId>:<sector>,
// cargo:<rotId>:<sector>, rep:<routeId>:<day>, rival:<routeId>, slot:<routeId>:<n>, group:<routeId>:<day>.

import type { RngHolder } from '../core/rng';
import { next } from '../core/rng';
import type { GameState } from '../core/types';
import { hash } from '../core/util';

/** A fresh RNG holder for one key: use it with rng.ts (chance, int, range, gaussian, pick). */
export const netSide = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:network:${key}`) | 0 });

/** One number in [0, 1) for a key (a single roll). */
export const netRoll = (g: GameState, key: string): number => next(netSide(g, key));
