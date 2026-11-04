// v0.16 counters (UPDATE-0.16.md), created on first use; the bot prints them. Shared by every v0.16 lane.

import type { GameState, StatsV016 } from './types';

export function statsV016(g: GameState): StatsV016 {
  return (g.stats.v016 ??= {
    visibilityFrom: { 1: 0, 2: 0, 3: 0, 4: 0 }, stretchOffers: 0, stretchSigned: 0, hidden: 0,
    leads: 0, leadsCold: 0, leadsLost: 0, leadsSigned: 0, pitches: 0, brokerDeals: 0,
    draws: 0, breaches: 0, loans: 0, leasebacks: 0, factored: 0, rampSaved: 0,
  });
}
