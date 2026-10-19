// Offer generation per archetype and the offer lifecycle (B1). DESIGN.md §5.1.

import type { GameState, SimEvent, Archetype, ContractOffer } from '../core/types';

/** Queues the next 'offer.spawn' (Poisson process, BAL.offersPerWeek scaled by fleet and season). TODO(B1) */
export function scheduleNextOffer(_g: GameState): void {
  // TODO(B1): schedule(g, g.now + exponential gap, 'offer.spawn')
}

/**
 * Builds one offer of the given (or a weighted random) archetype with a fictional client,
 * schedule pattern, requirements, price (pricing.ts) and expiry; adds it to g.offers and queues 'offer.expire'.
 * Returns null when no sensible offer could be built. TODO(B1)
 */
export function generateOffer(_g: GameState, _archetype?: Archetype): ContractOffer | null {
  return null;
}

/** 'offer.spawn': generate an offer, request an 'urgentOffer' pause for urgent ones, schedule the next spawn. TODO(B1) */
export function onOfferSpawn(g: GameState, _ev: SimEvent): void {
  generateOffer(g);
  scheduleNextOffer(g);
}

/** 'offer.expire': open/countered offers expire (rivals took them); no penalty. TODO(B1) */
export function onOfferExpire(_g: GameState, _ev: SimEvent): void {}

/** 'offer.reply': client answers a counter (accept at the countered price → contract on the chosen aircraft, or refuse). TODO(B1) */
export function onOfferReply(_g: GameState, _ev: SimEvent): void {}

/** Daily: prune old expired/declined offers (keep 14 days for the "missed" list). TODO(B1) */
export function dailyOffers(_g: GameState): void {}
