// Player actions on offers and contracts, and the contract lifecycle (B1). DESIGN.md §5.1.9.

import type { ActionResult, GameState, Minute, SimEvent } from '../core/types';

/**
 * Signs the offer on the chosen aircraft: creates the Contract, generates flights (schedule.ts),
 * books the deposit receivable, queues contract.start/end, asks crew to roster (crew.autoRoster). TODO(B1)
 */
export function acceptOffer(_g: GameState, _offerId: string, _aircraftIds: string[]): ActionResult<{ contractId: string }> {
  return { ok: false, error: 'Contracts are not built yet' };
}

/** Proposes a different price (rate or charter price); the client replies after BAL.counterReplyHours. TODO(B1) */
export function counterOffer(_g: GameState, _offerId: string, _price: number, _aircraftIds: string[]): ActionResult {
  return { ok: false, error: 'Contracts are not built yet' };
}

export function declineOffer(g: GameState, offerId: string): ActionResult {
  const o = g.offers[offerId];
  if (!o) return { ok: false, error: 'Offer not found' };
  o.status = 'declined';
  return { ok: true };
}

/** Cancels a signed/active contract: removes future flights, charges the penalty, reputation hit. TODO(B1) */
export function cancelContract(_g: GameState, _contractId: string): ActionResult {
  return { ok: false, error: 'Contracts are not built yet' };
}

/** Penalty if cancelled now (for the confirm dialog). TODO(B1) */
export function cancelPenalty(_g: GameState, _contractId: string): number {
  return 0;
}

export interface ContractProgress {
  legsDone: number;
  legsTotal: number;
  /** This month: billable block hours vs MGH (wet). */
  bhMonth: number;
  mgh: number;
  revenueToDate: number;
  nextFlightId: string | null;
  /** First uncrewed or illegal flight, if any. */
  problemFlightId: string | null;
}

/** Progress summary for cards and the contract panel. TODO(B1) */
export function contractProgress(_g: GameState, _contractId: string): ContractProgress {
  return { legsDone: 0, legsTotal: 0, bhMonth: 0, mgh: 0, revenueToDate: 0, nextFlightId: null, problemFlightId: null };
}

/** 'contract.start': status → active, message. TODO(B1) */
export function onContractStart(_g: GameState, _ev: SimEvent): void {}

/** 'contract.end': status → completed, charter balance invoice, reputation/relationship effects. TODO(B1) */
export function onContractEnd(_g: GameState, _ev: SimEvent): void {}

/** Days until start (UI helper). */
export function leadDays(g: GameState, start: Minute): number {
  return Math.floor((start - g.now) / 1440);
}
