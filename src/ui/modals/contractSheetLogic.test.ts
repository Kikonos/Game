// v0.24 the signed contract read back (Contracts › Active › the contract's sheet).

import { describe, expect, it } from 'vitest';
import { acceptOffer, cancelCost } from '../../engine/contracts';
import { money } from '../format';
import { hamBase, newGame, offer, owned } from '../../engine/contracts/testkit';
import { DAY } from '../../engine/core/time';
import { contractSheet } from './contractSheetLogic';

const row = (rows: [string, string][], k: string) => rows.find((r) => r[0] === k)?.[1];

describe('v0.24 contract sheet', () => {
  it('a wet base: rate, guarantee, positioning, penalties; legs flown and left, the cost of cancelling now', () => {
    const g = newGame();
    const o = hamBase(g, g.now + 20 * DAY, 60);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    expect(r.ok).toBe(true);
    const c = g.contracts[r.ok ? r.data!.contractId : ''];
    const s = contractSheet(g, c);
    expect(row(s.terms, 'Rate')).toMatch(/^\$[\d,]+ per block hour$/);
    expect(row(s.terms, 'Minimum guarantee')).toMatch(/BH/);
    expect(row(s.terms, 'Positioning')).toBeDefined();
    expect(row(s.terms, 'If we cancel')).toBe('60+ days before: 15 % · 30+ days before: 35 % · 14+ days before: 60 % · under 14 days: 100 %');
    expect(row(s.terms, 'Fuel')).toBe('Client pays fuel');
    expect(row(s.status, 'Legs')).toMatch(/^0 flown · \d+ left$/);
    expect(row(s.status, 'Cancel now')).toMatch(/^Penalty \$/);
  });

  it('v0.25 a broker deal shows the broker and its own commission (ACS 4 %)', () => {
    const g = newGame();
    const o = hamBase(g, g.now + 20 * DAY, 60);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    const c = g.contracts[r.ok ? r.data!.contractId : ''];
    expect(row(contractSheet(g, c).terms, 'Broker commission')).toBeUndefined();
    c.broker = 'Air Charter Service';
    c.brokerId = 'acs';
    expect(row(contractSheet(g, c).terms, 'Broker commission')).toBe('Air Charter Service · 4% of each invoice');
  });

  it('a signed wet lease that starts next month shows no "0 of 0 BH" this month; it does once it flies', () => {
    const g = newGame();
    const o = hamBase(g, g.now + 40 * DAY, 60);
    const r = acceptOffer(g, o.id, [owned(g).id]);
    expect(r.ok).toBe(true);
    const c = g.contracts[r.ok ? r.data!.contractId : ''];
    expect(row(contractSheet(g, c).status, 'This month')).toBeUndefined();
    g.now = c.start + 2 * DAY;
    expect(row(contractSheet(g, c).status, 'This month')).toMatch(/^\d+ of [1-9]\d* BH guaranteed$/);
  });

  it('a charter: the price, its deposit and what has been invoiced', () => {
    const g = newGame();
    const o = offer(g, 'adhoc', { start: g.now + 10 * DAY });
    const r = acceptOffer(g, o.id, [owned(g).id]);
    expect(r.ok).toBe(true);
    const c = g.contracts[r.ok ? r.data!.contractId : ''];
    if (c.product.kind !== 'charter') return;
    const s = contractSheet(g, c);
    expect(row(s.terms, 'Price')).toMatch(/all-in/);
    expect(row(s.status, 'Invoiced so far')).toMatch(/ of \$/);
    // v0.25 the penalty, then what goes back to the client and the sum, as the Cancel dialog.
    expect(row(s.status, 'Cancel now')).toBe(`Penalty ${money(cancelCost(g, c.id).penalty)}`);
    // The client pays the deposit invoice: cancelling now pays it back, on top of the penalty.
    for (const r of g.finance.receivables) if (r.contractId === c.id) r.paid = g.now;
    const cc = cancelCost(g, c.id);
    expect(cc.refund).toBeGreaterThan(0);
    expect(row(contractSheet(g, c).status, 'Cancel now')).toBe(`Penalty ${money(cc.penalty)} + ${money(cc.refund)} paid back to the client · ${money(cc.total)} in all`);
    c.status = 'completed';
    expect(row(contractSheet(g, c).status, 'Cancel now')).toBeUndefined();
  });
});
