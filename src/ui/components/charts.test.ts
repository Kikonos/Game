import { describe, expect, it } from 'vitest';
import { niceTicks } from './charts';

describe('niceTicks', () => {
  it('covers the data range', () => {
    for (const [lo, hi] of [[0, 3.2e6], [0, 3.49e6], [0, 1.2e6], [-4.1e5, 2.7e6], [0, 7], [12, 13]]) {
      const t = niceTicks(lo, hi);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
    }
  });
  it('keeps round steps', () => {
    expect(niceTicks(0, 3.2e6)).toEqual([0, 1e6, 2e6, 3e6, 4e6]);
    expect(niceTicks(0, 3e6)).toEqual([0, 1e6, 2e6, 3e6]);
  });
});
