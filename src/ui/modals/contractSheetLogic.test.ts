// v0.24 the signed contract read back (Contracts › Active › the contract's sheet).

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../../engine/contracts';
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
    expect(row(s.terms, 'If we cancel')).toMatch(/d \d+%/);
    expect(row(s.terms, 'Fuel')).toBe('Client pays fuel');
    expect(row(s.status, 'Legs')).toMatch(/^0 flown · \d+ left$/);
    expect(row(s.status, 'Cancel now')).toMatch(/\$/);
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
    c.status = 'completed';
    expect(row(contractSheet(g, c).status, 'Cancel now')).toBeUndefined();
  });
});
