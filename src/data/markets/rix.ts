// Latvia: the researched markets from Riga (RIX) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is RIX (or another airport in Latvia: it then becomes a route base of a RIX game). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/** Station costs for a 767-300ER turn (other types scale): RIX itself (overhead 0: our home) and the destinations. */
export const RIX_STATIONS: RouteStation[] = [
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  { code: 'RIX', fuelX: 1.0, airport: 1_800, handling: 3_700, paxCharge: 1.8, overhead: 0, cat: 'A', caterer: true, euCargo: true, taxes: 30 },
];

/** The catalogue from Riga. */
export const RIX_MARKETS: RouteMarket[] = [];
