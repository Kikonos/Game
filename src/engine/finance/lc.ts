// v0.17 letters of credit on the v0.16 credit line (UPDATE-0.17.md §K.1; lane `deals`): a lease deposit as a standby
// letter of credit uses that much of the undrawn limit, at 1.25 % a year. Step 0: none are issued (lcInUse 0).

import type { GameState, MonthKey } from '../core/types';

/** Letters of credit out now (they lower the undrawn limit: creditView, drawCredit, covenantCheck). Pure. */
export function lcInUse(g: GameState): number {
  const lc = g.leasing?.lc;
  if (!lc) return 0;
  let s = 0;
  for (const v of Object.values(lc)) s += v;
  return s;
}

/** The letter-of-credit fees of month k (posted to bankFees at the month end). Step 0: 0. Pure. */
export function lcFeeBill(g: GameState, k: MonthKey): number {
  void g;
  void k;
  return 0;
}
