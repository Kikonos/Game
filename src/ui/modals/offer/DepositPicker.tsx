// v0.16 the offer dialog's Deposit row (UPDATE-0.16.md §A.6; lane finance): 0 / 10 / 20 / 30 / 40 / 50 % with what it
// does to the client's answer in words. Step 0: renders nothing (the charter's own deposit shows in the terms).

import type { ContractOffer, GameState } from '../../../engine/core/types';

export function DepositPicker(_props: { g: GameState; o: ContractOffer; value: number; onChange: (pct: number) => void }) {
  return null;
}
