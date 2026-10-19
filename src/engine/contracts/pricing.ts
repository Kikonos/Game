// Pricing per RESEARCH §4 (B1). DESIGN.md §5.1.4.

import type { Archetype, GameState, Minute, Product } from '../core/types';

export interface PriceInput {
  archetype: Archetype;
  typeId: string;
  /** Planned block hours (incl. positioning for charters) and the programme window. */
  estBH: number;
  start: Minute;
  end: Minute;
  /** Lead time from offer creation to start (minutes). */
  lead: number;
}

/** Asking product for an offer: wet (rate/MGH), charter (all-in price) or dry. TODO(B1) */
export function priceProduct(_g: GameState, _p: PriceInput): Product {
  return { kind: 'wet', ratePerBH: 0, mghPerMonth: 0, excessRate: 0.95, cycleFee: 0, positioningBillable: true };
}

/** Contract value at a price (wet: max(MGH, est) × rate over the months; charter: price). TODO(B1) */
export function productValue(_product: Product, _estBH: number, _start: Minute, _end: Minute): number {
  return 0;
}
