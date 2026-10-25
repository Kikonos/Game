// Crew rest per airframe. v0.7.2: bunks (class 1) or crew rest seats. v0.7.3 (UPDATE-0.7.3.md §2.1, §2.5): separate
// pilot and cabin crew facilities (crew/restPlan.ts restOf). v0.7.4: every aircraft has curtained economy seats (class
// 3) and, with business seats in the cabin, curtained business seats (class 2). Seats of a seat-based facility
// (business / economy seats, crew rest recliners) sell unless someone rests in them on that leg.

import { ACMI_TYPES } from '../../data/acmiTypes';
import { crewInPaxSeats } from '../core/perf';
import type { GameState } from '../core/types';
import { restOf, restPlan } from './restPlan';

/**
 * v0.7.2 crew rest for an airframe with nothing recorded (old saves, the start fleet): widebodies whose type had a
 * rest facility keep bunks. v0.7.3: only the migration reads it (crew/restPlan.ts migrateRest).
 */
export function defaultCrewRest(typeId: string): { bunks: boolean; seats: number } {
  const t = ACMI_TYPES[typeId];
  return { bunks: !!t && t.body === 'wide' && t.restClass === 1, seats: 0 };
}

/** @deprecated v0.7.3: the pilots' facility class (restOf(…).fc?.cls); null without one. Pure. */
export function restClassAt(g: GameState, aircraftId: string | null): 1 | 2 | 3 | null {
  return restOf(g, aircraftId).fc?.cls ?? null;
}

/** Seats blocked for crew rest on a flight: the seat-based facilities someone rests in on that leg (augmented duties only). Pure. */
export function restSeatsBlocked(g: GameState, flightId: string): number {
  const f = g.flights[flightId];
  if (!f?.dutyId || !f.aircraftId) return 0;
  const d = g.duties[f.dutyId];
  if (!d || d.augment === 0) return 0;
  return restPlan(g, d.id)?.blocked[flightId] ?? 0;
}

/**
 * v0.10 passenger seats crew take on a flight because the jump seats (or the cockpit's observer seats) are full:
 * the duty's crew slots beyond the type's crew seats. Pure.
 */
export function crewSeatsBlocked(g: GameState, flightId: string): number {
  const f = g.flights[flightId];
  if (!f?.dutyId || !f.aircraftId) return 0;
  const d = g.duties[f.dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  const ac = g.fleet[f.aircraftId];
  if (!p || !ac) return 0;
  return crewInPaxSeats(ac.typeId, p.slots.map((s) => s.role));
}

/** Seats that can be sold on a flight: the cabin less any blocked for crew rest or taken by crew beyond the crew seats. Pure. */
export function sellableSeats(g: GameState, flightId: string): number {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  return ac ? ac.cabin.total - restSeatsBlocked(g, flightId) - crewSeatsBlocked(g, flightId) : 0;
}
