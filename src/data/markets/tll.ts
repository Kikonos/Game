// Estonia: the researched markets from Tallinn (TLL) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is TLL (or another airport in Estonia: it then becomes a route base of a TLL game). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/** Station costs for a 767-300ER turn (other types scale): TLL itself (overhead 0: our home) and the destinations. */
export const TLL_STATIONS: RouteStation[] = [
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  { code: 'TLL', fuelX: 1.0, airport: 1_800, handling: 3_800, paxCharge: 1.8, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 28 },
];

/** The catalogue from Tallinn. */
export const TLL_MARKETS: RouteMarket[] = [];
