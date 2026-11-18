// v0.25.1 (ops-curfews) the curfews added from the airports' own rules (sources in data/opsData.ts).

import { describe, expect, it } from 'vitest';
import { CURFEWS } from '../../data/opsData';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { shutLocal } from './curfew';

const h = (hh: number, mm = 0) => hh * 60 + mm;

describe('sourced curfews', () => {
  it('Adelaide and Gold Coast 23:00–06:00, Innsbruck open 06:30–20:00, Itami 07:00–21:00', () => {
    for (const c of ['ADL', 'OOL', 'INN', 'ITM']) expect(AIRPORT_BY_CODE[c], c).toBeDefined();
    expect(shutLocal('ADL', h(23, 30))).toBe(true);
    expect(shutLocal('ADL', h(6))).toBe(false);
    expect(shutLocal('OOL', h(5, 59))).toBe(true);
    expect(shutLocal('INN', h(20, 15))).toBe(true);
    expect(shutLocal('INN', h(6, 15))).toBe(true);
    expect(shutLocal('INN', h(6, 30))).toBe(false);
    expect(shutLocal('INN', h(19, 59))).toBe(false);
    expect(shutLocal('ITM', h(21))).toBe(true);
    expect(shutLocal('ITM', h(7))).toBe(false);
    // Short plain notes (they appear on the curfew cards).
    for (const c of Object.values(CURFEWS)) expect(c.note.length).toBeLessThanOrEqual(80);
  });
});
