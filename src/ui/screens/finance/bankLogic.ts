// v0.22 Finance › The bank: what the "Credit line" row says while no line is open. The row and the dialog behind its
// button read the same offer (engine/finance creditTerms): below zero the bank lends against security only, a smaller
// line than the normal one, so the row must not promise the normal limit. Pure.

import type { GameState } from '../../../engine/core/types';
import { creditOpenWhy, creditTerms } from '../../../engine/finance';
import { money } from '../../format';

export interface CreditOfferWords {
  /** Why no line can be asked for now (the button is off), else null. */
  why: string | null;
  /** The line under the row's name. */
  line: string;
  /** The amount on offer today (0: none to name). */
  limit: number;
  secured: boolean;
}

export function creditOfferWords(g: GameState): CreditOfferWords {
  const why = creditOpenWhy(g);
  const t = creditTerms(g);
  const limit = why ? 0 : Math.max(0, t.limit);
  const line = why ?? (limit ? `About ${money(limit)} on offer${t.secured ? ', against security' : ''}` : 'Draw and repay any time');
  return { why, line, limit, secured: t.secured };
}
