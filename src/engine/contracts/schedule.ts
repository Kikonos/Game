// Pattern → flights, positioning legs and rolling base schedules (B1). DESIGN.md §5.1.6–5.1.8.

import type { Contract, Flight, GameState, Minute } from '../core/types';

/**
 * Creates the contract's flights on its aircraft: positioning in, revenue legs (split by tech stops),
 * positioning out; for 'base' patterns only up to g.now + BAL.scheduleHorizonDays. Returns created flights. TODO(B1)
 */
export function generateFlights(_g: GameState, _c: Contract): Flight[] {
  return [];
}

/** Daily: roll 'base' patterns forward to the horizon (and stop at contract end). TODO(B1) */
export function extendBaseSchedules(_g: GameState): void {}

/**
 * Adds an empty positioning (billable) or ferry leg so the aircraft is at `to` by `arriveBy`.
 * Departs as late as possible after its previous commitment. Used by B1 and by B3 (maintenance ferries). TODO(B1)
 */
export function planPositioning(_g: GameState, _aircraftId: string, _to: string, _arriveBy: Minute, _kind: 'positioning' | 'ferry', _contractId: string | null): Flight | null {
  return null;
}
