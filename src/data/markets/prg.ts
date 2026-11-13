// Czechia: the researched markets from Prague (PRG) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is PRG (or another airport in Czechia: it then becomes a route base of a PRG game). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/** Station costs for a 767-300ER turn (other types scale): PRG itself (overhead 0: our home) and the destinations. */
export const PRG_STATIONS: RouteStation[] = [
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  { code: 'PRG', fuelX: 1.0, airport: 2_600, handling: 4_400, paxCharge: 2.2, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 40 },
];

/** The catalogue from Prague. */
export const PRG_MARKETS: RouteMarket[] = [];
