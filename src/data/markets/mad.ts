// Spain: the researched markets from Madrid (MAD) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is MAD (or another airport in Spain: it then becomes a route base of a MAD game). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/** Station costs for a 767-300ER turn (other types scale): MAD itself (overhead 0: our home) and the destinations. */
export const MAD_STATIONS: RouteStation[] = [
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  { code: 'MAD', fuelX: 1.0, airport: 3_000, handling: 4_800, paxCharge: 2.4, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 42 },
];

/** The catalogue from Madrid. */
export const MAD_MARKETS: RouteMarket[] = [];
