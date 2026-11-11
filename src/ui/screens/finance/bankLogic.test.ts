// v0.22 final check: on the player's save (cash −$1.92M, no line open) the bank's "Credit line" row said "About $9.70M
// on offer" while the dialog behind "Ask for one" offered a secured line of $3.70M. The row now reads the same offer.

import { describe, expect, it } from 'vitest';
import { invoice } from '../../../engine/core/ledger';
import type { GameState, MonthStatement } from '../../../engine/core/types';
import { newGame } from '../../../engine/contracts/testkit';
import { creditLimitFor, creditTerms, openCreditLine } from '../../../engine/finance';
import { newStatement } from '../../../engine/ops/finance';
import { money } from '../../format';
import { creditOfferWords } from './bankLogic';

function game(cash: number): GameState {
  const g = newGame();
  const k0 = g.finance.current.month;
  for (let i = 6; i >= 1; i--) {
    const st: MonthStatement = { ...newStatement(k0 - i, g.company.cash), lines: { acmiRevenue: 900_000, fuel: -300_000 }, bh: 300, closed: true };
    g.finance.history.push(st);
  }
  invoice(g, { clientId: Object.keys(g.clients)[0], contractId: null, desc: 'Winter wet lease', amount: 400_000, cat: 'acmiRevenue', dueDays: 30 });
  g.company.cash = cash;
  return g;
}

describe('Finance › The bank: the credit line row with no line open', () => {
  it('above zero it names the normal limit, the one the dialog opens', () => {
    const g = game(500_000);
    const w = creditOfferWords(g);
    expect(w.why).toBeNull();
    expect(w.secured).toBe(false);
    expect(w.limit).toBe(creditLimitFor(g));
    expect(w.line).toBe(`About ${money(w.limit)} on offer`);
    expect(openCreditLine(g).ok).toBe(true);
    expect(g.treasury!.credit!.limit).toBe(w.limit);
  });

  it('below zero it names the secured line (smaller), not the normal limit', () => {
    const g = game(-600_000);
    const w = creditOfferWords(g);
    expect(w.why).toBeNull();
    expect(w.secured).toBe(true);
    expect(w.limit).toBe(creditTerms(g).limit);
    expect(w.limit).not.toBe(creditLimitFor(g));
    expect(w.line).toBe(`About ${money(w.limit)} on offer, against security`);
    expect(openCreditLine(g).ok).toBe(true);
    expect(g.treasury!.credit!.limit).toBe(w.limit);
  });

  it('when the bank will not lend, the reason is the line and no amount is promised', () => {
    const g = newGame();
    const w = creditOfferWords(g);
    expect(w.why).toBeTruthy();
    expect(w.line).toBe(w.why);
    expect(w.limit).toBe(0);
  });
});
