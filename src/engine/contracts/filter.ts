// v0.16 the offer filter (UPDATE-0.16.md §D; lane `ops`): what you tell your sales team and the brokers not to bring
// you. Applied when an offer is created (offers.ts finalize): a hidden offer gets `hidden`, no cue, no message, no
// pause; it still exists and expires as usual (the Market tab counts them). Changing the filter re-evaluates the open
// offers without a chime. Humanitarian urgencies always ring.
//
// Step 0 (the shared skeleton): nothing is ever hidden; the lane fills it in.

import type { ActionResult, ContractOffer, GameState, OfferFilter } from '../core/types';

/** The filter as set (undefined = none). Pure. */
export const offerFilter = (g: GameState): OfferFilter | undefined => g.filter;

/** Load: nothing to repair (an absent filter is "no filter"). */
export function loadFilter(_g: GameState): void {}

/** Set (merge) the filter and re-evaluate the open offers. Step 0: not yet. */
export function setOfferFilter(_g: GameState, _patch: Partial<OfferFilter>): ActionResult {
  return { ok: false, error: 'Not available yet' };
}

/** Whether the filter hides this offer (pure; read at creation and on a filter change). Step 0: never. */
export function offerHidden(_g: GameState, _o: ContractOffer): boolean {
  return false;
}

/** Open offers hidden by the filter. Pure. */
export function hiddenOffers(g: GameState): ContractOffer[] {
  return Object.values(g.offers).filter((o) => o.hidden && (o.status === 'open' || o.status === 'countered'));
}

/** Re-evaluate every open offer against the filter (hidden ↔ shown, no chime). Step 0: nothing. */
export function refilterOffers(_g: GameState): void {}
