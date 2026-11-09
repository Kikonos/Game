import { describe, expect, it } from 'vitest';
import { fitLabels, niceTicks } from './charts';

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

describe('fitLabels', () => {
  const months = ['Dec ’27', 'Jan ’28', 'Feb ’28', 'Mar ’28', 'Apr ’28', 'May ’28', 'Jun ’28', 'Jul ’28', 'Aug ’28', 'Sep ’28', 'Oct ’28', 'Nov ’28 so far'];
  const spans = (labels: string[], xs: number[], on: boolean[], fs: number) =>
    labels.map((l, i) => [xs[i] - (l.length * fs * 0.56) / 2, xs[i] + (l.length * fs * 0.56) / 2]).filter((_, i) => on[i]);
  it('never draws two labels that touch, and keeps the long last one', () => {
    // A phone-width bar chart: 12 slots in 240 px, every 4th label.
    const xs = months.map((_, i) => 20 + i * 20 + 10);
    const on = fitLabels(months, xs, 11, 270, 4);
    expect(on[months.length - 1]).toBe(true);
    expect(on[0]).toBe(true);
    const shown = on.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    // 'Aug ’28' (index 8) would sit under the right-anchored last label.
    expect(shown).not.toContain(8);
    expect(spans(months, xs, on, 11).length).toBe(shown.length);
  });
  it('leaves a wide chart as it was', () => {
    const xs = months.map((_, i) => 40 + i * 80);
    const on = fitLabels(months, xs, 11, 1000, 1);
    expect(on.every(Boolean)).toBe(true);
  });
});
