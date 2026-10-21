// Flight types shown everywhere (v0.5.2): map paths, Up Next, Schedule, flight details, crew roster.
//   Operating   revenue leg (incl. fuel-stop legs)                         solid green
//   Positioning our aircraft empty, full crew aboard (cabin crew needed)    dotted amber
//   Ferry       our aircraft empty, pilots only                            dotted amber + FERRY tag
//   Deadhead    our crew as passengers on another airline                  grey icon, thin grey dotted
// The crew engine decides pilots-only vs full crew: an empty trip, or empty duties after a trip's last revenue
// duty, fly with pilots only (crew/duties.ts buildTrips); empty legs leading into revenue work carry the cabin.

import { flightsOf } from '../core/entities';
import { isPilot } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';

export type FlightType = 'operating' | 'positioning' | 'ferry' | 'deadhead';

export const FLIGHT_TYPES: FlightType[] = ['operating', 'positioning', 'ferry', 'deadhead'];

export const FLIGHT_TYPE_LABEL: Record<FlightType, string> = {
  operating: 'Operating',
  positioning: 'Positioning',
  ferry: 'Ferry',
  deadhead: 'Deadhead',
};

export const FLIGHT_TYPE_HINT: Record<FlightType, string> = {
  operating: 'Revenue flight with passengers',
  positioning: 'Our aircraft empty, full crew aboard (cabin crew needed at the destination)',
  ferry: 'Our aircraft empty, pilots only',
  deadhead: 'Our crew as passengers on another airline',
};

const empty = (f: Flight) => f.kind === 'positioning' || f.kind === 'ferry';

/** Cabin crew on an empty leg not yet crewed: when the aircraft's next leg after it (within 3 days) carries passengers. */
function cabinNeededAfter(g: GameState, f: Flight): boolean {
  if (!f.aircraftId) return false;
  const fl = flightsOf(g, f.aircraftId);
  let t = f.sta;
  for (let i = fl.indexOf(f) + 1; i > 0 && i < fl.length; i++) {
    const x = fl[i];
    if (x.status === 'cancelled' || x.aircraftId !== f.aircraftId) continue;
    if (x.std - t > 3 * DAY) return false;
    if (!empty(x)) return true;
    t = x.sta;
  }
  return false;
}

/** The flight's type for every view. Pure and cheap (per frame on the map). */
export function flightType(g: GameState, f: Flight): FlightType {
  if (f.kind === 'deadhead') return 'deadhead';
  if (!empty(f)) return 'operating';
  // Flown: who was really aboard. Planned: the complement of its trip. Not planned yet: what follows it.
  if (f.status !== 'scheduled' && f.crewIds.length) return f.crewIds.some((id) => g.crew[id] && !isPilot(g.crew[id].role)) ? 'positioning' : 'ferry';
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (p && p.slots.length) return p.slots.some((s) => !isPilot(s.role)) ? 'positioning' : 'ferry';
  return cabinNeededAfter(g, f) ? 'positioning' : 'ferry';
}

/** Our crew on a flight: operating (ours) or riding as passengers (our empty legs, airline tickets). */
export function flightCrewAboard(g: GameState, f: Flight): { operating: string[]; riding: string[] } {
  if (f.kind === 'deadhead') return { operating: [], riding: f.crewIds.filter((id) => g.crew[id]) };
  return { operating: f.crewIds.filter((id) => g.crew[id]), riding: (f.riders ?? []).filter((id) => g.crew[id]) };
}
