// Developer helpers (console: __contrail.dev). Lets the map and screens be built before the
// contract generator exists: demo flights on the fleet. Not used by the game itself.

import { addFlight, ownFlightNo } from './core/entities';
import { blockMinutes } from './core/perf';
import { flightsOf } from './core/entities';
import type { GameState } from './core/types';

/** Out-and-back legs from each aircraft's position, starting in 30 min, for `days` days. */
export function demoFlights(g: GameState, dests = ['FAO', 'FNC', 'PMI', 'TFS', 'OPO', 'AGP'], days = 3): number {
  let n = 0;
  Object.values(g.fleet).forEach((ac, i) => {
    const last = flightsOf(g, ac.id).at(-1);
    let t = Math.max(g.now + 30, last ? last.sta + 60 : 0);
    let at = last ? last.to : ac.at;
    const home = at;
    for (let d = 0; d < days * 2; d++) {
      const to = d % 2 === 0 ? dests[(i + d) % dests.length] : home;
      const block = blockMinutes(ac.typeId, at, to);
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: at, to, std: t, sta: t + block });
      t += block + 50 + (d % 2 === 1 ? 6 * 60 : 0);
      at = to;
      n++;
    }
  });
  return n;
}
