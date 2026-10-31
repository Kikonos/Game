// v0.12.1 (Round F, lane A's report): generateOffer threw "Cannot read properties of undefined (reading 0)" when every
// archetype weight was zero (weightedPick found nothing to pick). It now makes no offer instead.

import { describe, expect, it } from 'vitest';
import { generateOffer } from './offers';
import { newGame } from './testkit';

describe('offer archetypes all weighted zero', () => {
  it('no offer and no throw', () => {
    const g = newGame(7);
    const zero = new Proxy({}, { get: () => 0 });
    g.scen = { ...(g.scen ?? {}), bias: zero } as never;
    expect(() => generateOffer(g)).not.toThrow();
    expect(generateOffer(g)).toBeNull();
  });
});
