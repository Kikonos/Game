// v0.25 the cash cards count what open invoices will still bring in: a sold invoice only its last part (the bank
// advanced the rest). The player's save read $1.9M 'outstanding' on the cash card with most of it already sold.

import { describe, expect, it } from 'vitest';
import { invoice } from '../core/ledger';
import { newGame } from '../contracts/testkit';
import { factorInvoice, factorQuote } from '../finance';
import { cashNegativeCard, stillToCome } from './money';

describe('v0.25 still to come from invoices', () => {
  it('a sold invoice counts only the balance the bank has not advanced', () => {
    const g = newGame();
    const c = Object.values(g.clients)[0].id;
    const a = invoice(g, { clientId: c, contractId: null, desc: 'sold', amount: 200_000, cat: 'charterRevenue', dueDays: 30 });
    invoice(g, { clientId: c, contractId: null, desc: 'kept', amount: 100_000, cat: 'charterRevenue', dueDays: 30 });
    const before = stillToCome(g);
    const adv = factorQuote(g, a.id, true)!.advance;
    expect(factorInvoice(g, a.id, true).ok).toBe(true);
    expect(stillToCome(g)).toBe(before - adv);
    g.company.cash = -50_000;
    const card = cashNegativeCard(g)!;
    expect(card.details).toContain(`Still to come from invoices ${'$'}${Math.round((before - adv) / 1000)}K`);
  });
});
