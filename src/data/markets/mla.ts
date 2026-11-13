// Malta: the researched markets from Malta (MLA) and the stations they use. Same shape as markets/lis.ts.
// A market's `from` is MLA (or another airport in Malta: it then becomes a route base of a game based at MLA). Ids are
// '<FROM>-<TO>' and never change once released (saves name them). A station already listed in another base's file is
// not repeated here.

import type { RouteMarket, RouteStation } from '../routes';

/**
 * Station costs for a 767-300ER turn (other types scale), by code: MLA itself and the destinations. The office
 * (`overhead`) is paid at a route's far end and stops only, so MLA's is what a route from another base pays there.
 */
export const MLA_STATIONS: Record<string, RouteStation> = {
  // [E] the home station, set against Lisbon's row: replace with the researched numbers.
  MLA: { code: 'MLA', fuelX: 1.03, airport: 2_300, handling: 4_300, paxCharge: 2.0, overhead: 6_000, cat: 'A', caterer: true, euCargo: true, taxes: 36 },
};

/** The catalogue from Malta. */
export const MLA_MARKETS: RouteMarket[] = [];
