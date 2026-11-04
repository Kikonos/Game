// v0.16 the bot's finance policy (UPDATE-0.16.md §A; lane finance), run once a day from scripts/acmi-bot.ts: open the
// credit line once the bank allows it, draw when the 30-day forecast dips below zero and repay when cash is
// comfortable, sell invoices to the bank before cash runs short, borrow against an owned aircraft when the line is
// used up, and sell and lease back only when cash has been negative for a while. Pure in g (engine actions only).

import { BAL } from '../../src/engine/core/balance';
import { DAY, monthKey } from '../../src/engine/core/time';
import type { GameState } from '../../src/engine/core/types';
import {
  creditOpenWhy, creditView, drawCredit, drawStepOf, factorInvoice, factorQuote, leasebackQuote, loanOn, loanQuote, marketValueOf, openCreditLine, repayCredit, sellAndLeaseBack, takeLoan,
} from '../../src/engine/finance';
import { cashForecast, monthEndBill } from '../../src/engine/ops/finance';

const F = BAL.v016.finance;
/** Cash the bot likes to keep in hand before it repays the line. */
const COMFORT = 1_500_000;

/** The 30-day cash low from the forecast. */
const low30 = (g: GameState): number => cashForecast(g, 30).reduce((m, p) => Math.min(m, p.cash), g.company.cash);

/** Returns true when it acted (the bot settles after). */
export function botFinance(g: GameState): boolean {
  if (g.gameOver) return false;
  let acted = false;
  const cash = g.company.cash;
  const bill = monthEndBill(g, monthKey(g.now)).total;

  // 1. The credit line, as soon as the bank allows it (cheap insurance: 0.5 % on the undrawn part).
  if (!g.treasury?.credit && !creditOpenWhy(g) && openCreditLine(g).ok) acted = true;

  const low = low30(g);
  const v = creditView(g);

  // 2. Draw when the month ahead dips below zero: enough to cover the dip plus a cushion, in the bank's steps.
  if (v && !v.line.frozen && v.undrawn > 0 && low < 0) {
    const want = Math.min(v.undrawn, Math.ceil((-low + 150_000) / F.credit.drawStep) * F.credit.drawStep);
    if (want > 0 && drawCredit(g, want).ok) acted = true;
  }

  // 3. Repay when cash is comfortable: what is above the comfort level and next month's bill.
  if (v && v.line.drawn > 0 && low > 0) {
    const spare = cash - COMFORT - bill;
    const amount = Math.min(v.line.drawn, drawStepOf(spare));
    if (amount >= F.credit.drawStep && repayCredit(g, amount).ok) acted = true;
  }

  // 4. Still short with the line used up: sell the biggest eligible invoices to the bank (with recourse), largest first.
  if (low30(g) < 0) {
    const open = g.finance.receivables.filter((r) => r.paid === null && !r.factor && !r.factored && !r.written).sort((a, b) => b.amount - a.amount);
    for (const r of open) {
      if (low30(g) >= 0) break;
      const q = factorQuote(g, r.id, true);
      if (q && !q.why && factorInvoice(g, r.id, true).ok) acted = true;
    }
  }

  // 5. Still short: borrow against the most valuable owned aircraft (5 years).
  if (low30(g) < -200_000) {
    const owned = Object.values(g.fleet).filter((a) => a.ownership.kind === 'owned' && !a.sale && a.status !== 'delivering' && !loanOn(g, a.id)).sort((a, b) => marketValueOf(g, b) - marketValueOf(g, a));
    for (const ac of owned) {
      const q = loanQuote(g, ac.id, 5);
      if (q && !q.why && takeLoan(g, ac.id, q.terms.includes(5) ? 5 : q.years).ok) {
        acted = true;
        break;
      }
    }
  }

  // 6. Insolvent for ten days with nothing else left: sell and lease back the most valuable owned aircraft.
  const negSince = g.finance.negSince;
  if (cash < 0 && negSince != null && g.now - negSince >= 10 * DAY && low30(g) < 0) {
    const owned = Object.values(g.fleet).filter((a) => a.ownership.kind === 'owned' && !a.sale && a.status !== 'delivering').sort((a, b) => marketValueOf(g, b) - marketValueOf(g, a));
    for (const ac of owned) {
      const q = leasebackQuote(g, ac.id, 6);
      if (q && !q.why && q.cashIn > 0 && sellAndLeaseBack(g, ac.id, q.years).ok) {
        acted = true;
        break;
      }
    }
  }
  return acted;
}
