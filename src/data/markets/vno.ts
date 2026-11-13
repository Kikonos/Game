// Lithuania: the researched markets from Vilnius (VNO) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is VNO (or another airport in Lithuania: it then becomes a route base of a VNO game). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/** Station costs for a 767-300ER turn (other types scale): VNO itself (overhead 0: our home) and the destinations. */
export const VNO_STATIONS: RouteStation[] = [
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  { code: 'VNO', fuelX: 1.0, airport: 1_700, handling: 3_600, paxCharge: 1.8, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 30 },
];

/** The catalogue from Vilnius. */
export const VNO_MARKETS: RouteMarket[] = [];
