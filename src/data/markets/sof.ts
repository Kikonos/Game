// Bulgaria: the researched markets from Sofia (SOF) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is SOF (or another airport in Bulgaria: it then becomes a route base of a game based at SOF). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: SOF itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so SOF's is what a route from another base pays there.
 */
export const SOF_STATIONS: Record<string, RouteStation> = {
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  SOF: { code: 'SOF', fuelX: 1.0, airport: 1_800, handling: 3_500, paxCharge: 1.8, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 28 },
};

/** The catalogue from Sofia. */
export const SOF_MARKETS: RouteMarket[] = [];
