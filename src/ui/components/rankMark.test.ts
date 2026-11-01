// v0.12 Visual B: rank stripes as worn (captain 4, first officer 3, relief pilot 2); cabin crew wear wings.
import { describe, expect, it } from 'vitest';
import { RANK_BAR, RANK_STRIPES, stripeXs, wingFeathers } from './RankMark';

describe('rank marks', () => {
  it('gives captains four stripes, first officers three, cabin crew none', () => {
    expect(RANK_STRIPES).toMatchObject({ CPT: 4, FO: 3, CRP: 2, PUR: 0, CC: 0 });
    expect(stripeXs(4)).toHaveLength(4);
    for (const x of stripeXs(4)) expect(x).toBeGreaterThan(8);
  });

  it('v0.14 keeps one bar weight: stripes never touch, inside the board; wing feathers stack without touching', () => {
    for (const n of [2, 3, 4]) {
      const xs = stripeXs(n);
      for (let i = 1; i < xs.length; i++) expect(xs[i - 1] - xs[i]).toBeGreaterThan(RANK_BAR + 1);
      // board runs from the collar point (5.5 where it is full height) to 25
      for (const x of xs) expect(x - RANK_BAR / 2).toBeGreaterThan(5.5);
      for (const x of xs) expect(x + RANK_BAR / 2).toBeLessThan(25);
    }
    const f = wingFeathers();
    expect(f).toHaveLength(3);
    for (let i = 1; i < f.length; i++) {
      expect(f[i][1] - f[i - 1][1]).toBeGreaterThan(RANK_BAR); // roots apart
      expect(Math.abs(f[i][2] - f[i][0])).toBeLessThan(Math.abs(f[i - 1][2] - f[i - 1][0])); // each shorter
    }
    for (const [x0, y0, x1, y1] of f) {
      expect(y1).toBeLessThan(y0); // swept up
      expect(x1).toBeGreaterThanOrEqual(RANK_BAR / 2); // inside the 26-wide box
      expect(x0).toBeLessThan(13 - 2.5); // clear of the crest
    }
  });
});
