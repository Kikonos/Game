// Scarce aircraft market and lease lifecycle (B3). DESIGN.md §5.10.

import type { ActionResult, GameState, SimEvent } from '../core/types';

/** Monthly: add 0–2 offers weighted by scarcity and tier, drop expired ones; fuel price drift. TODO(B3) */
export function refreshMarket(_g: GameState): void {}

/** Signs a dry lease in (or purchase): deposit, aircraft 'delivering' until leadDays, 'aircraft.delivery' queued. TODO(B3) */
export function acquireAircraft(_g: GameState, _offerId: string): ActionResult<{ aircraftId: string }> {
  return { ok: false, error: 'The aircraft market is not built yet' };
}

/** 'aircraft.delivery' / 'lease.end'. TODO(B3) */
export function onDelivery(_g: GameState, _ev: SimEvent): void {}
export function onLeaseEnd(_g: GameState, _ev: SimEvent): void {}
