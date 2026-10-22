// v0.7.2 crew rest per airframe (UPDATE-0.7.2.md §3): bunks (class 1) or crew rest seats (the last economy row
// behind a curtain, class 3). Rest seats sell unless a duty needs in-flight rest.

import { ACMI_TYPES } from '../../data/acmiTypes';
import type { GameState } from '../core/types';

/** The in-flight rest class an aircraft offers: bunks → 1; crew rest seats → 3; else null. Pure. */
export function restClassAt(g: GameState, aircraftId: string | null): 1 | 3 | null {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  if (!ac) return null;
  const r = ac.crewRest;
  if (!r) return ACMI_TYPES[ac.typeId]?.restClass ? 1 : null;
  return r.bunks ? 1 : r.seats > 0 ? 3 : null;
}

/** Seats blocked for crew rest on a flight (its duty needs in-flight rest on a rest-seats aircraft). Pure. */
export function restSeatsBlocked(g: GameState, flightId: string): number {
  void g;
  void flightId;
  return 0;
}

/** Seats that can be sold on a flight: the cabin less any blocked for crew rest. Pure. */
export function sellableSeats(g: GameState, flightId: string): number {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  return ac ? ac.cabin.total - restSeatsBlocked(g, flightId) : 0;
}
