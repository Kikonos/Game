// v0.25 ferry and fuel stops: never at a slot-coordinated hub (the ferry routes stopped at Heathrow and Washington
// National); the North Atlantic stops real ferry crews use come first.

import { describe, expect, it } from 'vitest';
import { route } from '../contracts/plan';

describe('v0.25 technical stops', () => {
  it('Malta to New York, Boston and Washington on an A320 without ETOPS: no stop at Heathrow, Frankfurt or Paris', () => {
    for (const to of ['JFK', 'BOS', 'IAD']) {
      const r = route('a320ceo', 'MLA', to, 0)!;
      expect(r.length).toBeGreaterThan(1);
      const stops = r.slice(0, -1).map((h) => h.to);
      for (const s of stops) expect(['LHR', 'LGW', 'CDG', 'FRA', 'AMS', 'DCA']).not.toContain(s);
      expect(stops.some((s) => ['SNN', 'KEF', 'YFB'].includes(s))).toBe(true);
    }
  });
});
