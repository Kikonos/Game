// Developer helpers (console: __contrail.dev). Lets the map and screens be built before the
// contract generator exists: demo flights on the fleet. Not used by the game itself.

import { addFlight, ownFlightNo } from './core/entities';
import { blockMinutes } from './core/perf';
import { flightsOf } from './core/entities';
import { nextId } from './core/entities';
import type { GameState, Role } from './core/types';
import { escalateShortages } from './crew/control';
import { recheckPairing, releaseCrew, setFlightsCrew } from './crew/roster';

/** Out-and-back legs from each aircraft's position, starting in 30 min, for `days` days (ferries by default: no client). */
export function demoFlights(g: GameState, dests = ['FAO', 'FNC', 'PMI', 'TFS', 'OPO', 'AGP'], days = 3, kind: 'ferry' | 'revenue' = 'ferry'): number {
  let n = 0;
  Object.values(g.fleet).forEach((ac, i) => {
    const last = flightsOf(g, ac.id).at(-1);
    let t = Math.max(g.now + 30, last ? last.sta + 60 : 0);
    let at = last ? last.to : ac.at;
    const home = at;
    for (let d = 0; d < days * 2; d++) {
      const to = d % 2 === 0 ? dests[(i + d) % dests.length] : home;
      const block = blockMinutes(ac.typeId, at, to);
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind, from: at, to, std: t, sta: t + block });
      t += block + 50 + (d % 2 === 1 ? 6 * 60 : 0);
      at = to;
      n++;
    }
  });
  return n;
}

/** Stress fleet for map/screen perf work: clones of the first aircraft at home base (n total). */
export function devFleet(g: GameState, n = 10): number {
  const base = Object.values(g.fleet)[0];
  if (!base) return 0;
  let added = 0;
  for (let k = Object.keys(g.fleet).length; k < n; k++, added++) {
    const id = nextId(g, 'a');
    const reg = `${g.company.regPrefix}DV${String.fromCharCode(65 + (k % 26))}`;
    g.fleet[id] = { ...structuredClone(base), id, reg, at: g.company.homeBase, flightId: null, status: 'available', maintId: null };
  }
  return added;
}

/** v0.6: crew member resigns now (notice period from BAL.morale.noticeDays). Dev/test helper. */
export { resignNow } from './crew/morale';

/** v0.7: posts a market offer now (type, kind, new-build, handover site); returns its id. Dev/test helper. */
export { devMarketOffer } from './ops/market';
/** v0.7: grants an approval now (as if the authority finished). Dev/test helper. */
export { devGrantApproval } from './ops/company';

/**
 * v0.7.1: empties the required seats (`roles`, default the pilots) of the next crewed flight departing within
 * `hours` (default 10) and runs the ladder, so Crew Control has something to show; returns the flight id ('' when
 * nothing qualifies). Dev/test helper.
 */
export function devCrewShortage(g: GameState, opts: { hours?: number; roles?: Role[] } = {}): string {
  const hours = opts.hours ?? 10;
  const roles = opts.roles ?? ['CPT', 'FO'];
  const cands = Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.aircraftId && f.kind !== 'deadhead' && f.dutyId && f.std > g.now && f.std <= g.now + hours * 60 && f.crewIds.length > 0)
    .sort((a, b) => a.std - b.std || (a.id < b.id ? -1 : 1));
  for (const f of cands) {
    const d = g.duties[f.dutyId!];
    const p = d ? g.pairings[d.pairingId] : undefined;
    if (!p || d.flightIds[0] !== f.id || d.report <= g.now) continue;
    for (const s of p.slots) if (s.crewId && roles.includes(s.role)) releaseCrew(g, p, s.crewId);
    setFlightsCrew(g, p);
    recheckPairing(g, p);
    escalateShortages(g);
    return f.id;
  }
  return '';
}
