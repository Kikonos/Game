// v0.12 Visual B: rank stripes as worn (captain 4, first officer 3, relief pilot 2); cabin crew wear wings.
import { describe, expect, it } from 'vitest';
import { RANK_STRIPES, stripeXs } from './RankMark';

describe('rank marks', () => {
  it('gives captains four stripes, first officers three, cabin crew none', () => {
    expect(RANK_STRIPES).toMatchObject({ CPT: 4, FO: 3, CRP: 2, PUR: 0, CC: 0 });
    expect(stripeXs(4)).toHaveLength(4);
    for (const x of stripeXs(4)) expect(x).toBeGreaterThan(8);
  });
});
