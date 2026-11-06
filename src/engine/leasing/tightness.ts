// v0.17 market tightness per type (UPDATE-0.17.md §A; lane `supply`). Step 0: neutral bodies. `tightNow` returns the
// type's `scarcity`, so the lessor-call weights `1 − tightNow` equal the v0.16 market's `1 − scarcity` exactly.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import type { GameState, SupplyShock, WorldEvent } from '../core/types';

const S = () => BAL.v017.supply;

/** The type's base tightness (§A.2); a type missing from the table falls back on its scarcity. Pure. */
export function baseTight(typeId: string): number {
  return S().base[typeId] ?? typeOf(typeId).scarcity;
}

/**
 * Tightness now, 0 (easy) to 1 (none to be had): the stored value + the season + today's supply shocks (§A.1).
 * Step 0: the type's scarcity (the v0.16 market). Pure.
 */
export function tightNow(g: GameState, typeId: string): number {
  void g;
  return typeOf(typeId).scarcity;
}

/** 'Easy' · 'Normal' · 'Tight' · 'Very tight' · 'Almost none' (§A.1). Pure. */
export function tightWord(x: number): string {
  for (const [lim, w] of S().words) if (x < lim) return w;
  return S().words[S().words.length - 1][1];
}

/** Monthly (refreshMarket via monthlyLeasing): each type pulled toward its target (§A.3). Step 0: nothing moves. */
export function stepTightness(g: GameState): void {
  void g;
}

/** The outlook's supply line (§A.4): the three tightest and the two easiest types near us, with a trend. Step 0: none. Pure. */
export function supplyOutlook(g: GameState): { typeId: string; word: string; trend: -1 | 0 | 1 }[] {
  void g;
  return [];
}

/** Supply shocks from world events (§A.3), one hook in ops/world.ts startEvent and one in commercial/crises.ts. Step 0: none. */
export function onSupplyEvent(g: GameState, e: WorldEvent): void {
  void g;
  void e;
}

/** Shocks live now on a type (read by tightNow). Pure. */
export function shocksOn(g: GameState, typeId: string): SupplyShock[] {
  const fam = typeOf(typeId).family;
  return (g.leasing?.shocks ?? []).filter((s) => s.until > g.now && (s.typeIds?.includes(typeId) || s.families?.includes(fam)));
}
