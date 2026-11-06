// v0.17 the market's side stream for the leasing modules (UPDATE-0.17.md §L "Determinism"): the same formula as
// ops/market.ts `side`, so every roll is on `${seed}:market:${key}` and never shifts the rest of the game's randomness.
// Keys in use: tight:<month>, rfp:<id>:<lessor>, call:<day>, deal:<id>, ind:<offerId>, spot:<day>, batch:<eventId>.

import type { RngHolder } from '../core/rng';
import type { GameState } from '../core/types';
import { hash } from '../core/util';

export const leasingSide = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:market:${key}`) | 0 });
