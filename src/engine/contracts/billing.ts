// Usage counting and invoicing (B1). DESIGN.md §5.1.10. B3 calls billContractMonth at month end.

import type { Contract, GameState, LedgerCat, MonthKey, SimEvent } from '../core/types';

export interface BillingLine {
  contractId: string;
  clientId: string;
  desc: string;
  amount: number;
  cat: LedgerCat;
}

/** 'flight.arr': add billable block minutes and cycles to contract.use[month]. TODO(B1) */
export function onFlightArrivedContracts(_g: GameState, _ev: SimEvent): void {}

/**
 * Invoice lines for a contract-month: wet = max(MGH, flown) × rate (excess at excessRate, pro-rated in the first/last month)
 * + cycle fees; charter deposits/balances are invoiced by the lifecycle instead. Marks the month billed. TODO(B1)
 */
export function billContractMonth(_g: GameState, _c: Contract, _month: MonthKey): BillingLine[] {
  return [];
}
