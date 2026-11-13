// Estonia: the researched markets from Tallinn (TLL) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is TLL (or another airport in Estonia: it then becomes a route base of a game based at TLL). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: TLL itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so TLL's is what a route from another base pays there.
 */
export const TLL_STATIONS: Record<string, RouteStation> = {
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  TLL: { code: 'TLL', fuelX: 1.0, airport: 1_800, handling: 3_800, paxCharge: 1.8, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 28 },
};

/** The catalogue from Tallinn. */
export const TLL_MARKETS: RouteMarket[] = [];
