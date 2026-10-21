// v0.6 (UPDATE-0.6.md §C2): governments mostly pay late (RESEARCH §4.3: 30–90 days).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { invoice } from '../core/ledger';
import { DAY } from '../core/time';
import { newGame } from './testkit';

describe('payers', () => {
  it('governments are late in at least 70% of 1,000 invoices, 25–90 days', () => {
    const g = newGame(5);
    const gov = Object.values(g.clients).find((c) => c.kind === 'government')!;
    expect(gov.payReliability).toBe(0.2);
    let late = 0;
    for (let i = 0; i < 1000; i++) {
      const r = invoice(g, { clientId: gov.id, contractId: null, desc: 'Test', amount: 1000, cat: 'charterRevenue', dueDays: 30 });
      const days = (r.payAt - r.due) / DAY;
      if (days > BAL.graceDays) {
        late++;
        expect(days).toBeGreaterThanOrEqual(25);
        expect(days).toBeLessThanOrEqual(90);
      }
    }
    expect(late / 1000).toBeGreaterThanOrEqual(0.7);
  });
});
