// v0.8 more contract types (UPDATE-0.8.md §2): Hajj airlifts, UN multi-year rotations, presidential flights,
// deportation (a moral choice), war-zone evacuations, medical airbridges, music tours, Antarctica on blue ice,
// capacity leases, rivals hiring us (sub-charter in) and dry leases out. Builders are registered in offers.ts.

import type { GameState } from '../core/types';

/** A Hajj offer on a widebody fleet; the offer id ('' when none could be built). Dev/test helper. */
export function devHajj(_g: GameState): string {
  return '';
}
/** A dry-lease offer for the owned A320; the offer id. Dev/test helper. */
export function devDryLease(_g: GameState): string {
  return '';
}
/** An Air Sénégal A330 'all but the purser' contract signed and rostered; a duty id. Dev/test helper. */
export function devMixedCrew(_g: GameState): string {
  return '';
}
/** A deportation offer; the offer id. Dev/test helper. */
export function devDeportation(_g: GameState): string {
  return '';
}
/** An evacuation offer; the offer id. Dev/test helper. */
export function devEvacuation(_g: GameState): string {
  return '';
}
