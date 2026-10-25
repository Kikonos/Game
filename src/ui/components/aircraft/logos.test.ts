import { describe, expect, it } from 'vitest';
import { LOGO_IDS } from '../../../data/livery';
import { LOGOS } from './logos';

describe('logos', () => {
  it('24 marks keyed exactly by LOGO_IDS', () => {
    expect(Object.keys(LOGOS).sort()).toEqual([...LOGO_IDS].sort());
    expect(LOGO_IDS).toHaveLength(24);
    for (const id of LOGO_IDS) expect(LOGOS[id].id).toBe(id);
  });

  it('unique names', () => {
    const names = LOGO_IDS.map((id) => LOGOS[id].name);
    expect(new Set(names).size).toBe(24);
  });

  it('every path is non-empty, closed, at most two tones, coordinates within 0–100', () => {
    for (const id of LOGO_IDS) {
      const def = LOGOS[id];
      expect(def.paths.length).toBeGreaterThan(0);
      for (const p of def.paths) {
        expect(p.d.length).toBeGreaterThan(8);
        expect(p.d.trim().endsWith('Z')).toBe(true);
        expect([1, 2]).toContain(p.tone);
        for (const n of p.d.match(/-?\d*\.?\d+/g) ?? []) {
          expect(Number(n), `${id}: ${n}`).toBeGreaterThanOrEqual(0);
          expect(Number(n), `${id}: ${n}`).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
