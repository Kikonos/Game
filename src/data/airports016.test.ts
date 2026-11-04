// v0.16 review: the airports table stays one row per code (a duplicate draws two pins and two list rows), and every
// far route's airports exist.

import { describe, expect, it } from 'vitest';
import { AIRPORTS, AIRPORT_BY_CODE } from './airports';
import { FAR_ROUTES } from '../engine/contracts/missions';

describe('airports data (v0.16 additions)', () => {
  it('one row per code', () => {
    const seen = new Map<string, number>();
    for (const a of AIRPORTS) seen.set(a.code, (seen.get(a.code) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([c]) => c)).toEqual([]);
  });
  it('every far route flies between airports in the table', () => {
    for (const t of FAR_ROUTES) for (const c of [...t.out, ...t.back]) expect(AIRPORT_BY_CODE[c], `${t.id}: ${c}`).toBeTruthy();
  });
});
