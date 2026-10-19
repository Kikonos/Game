// Duties, pairings and the auto-roster (B2). DESIGN.md §5.3.

import type { ActionResult, Duty, GameState, Minute, Role } from '../core/types';

/**
 * Groups an aircraft's flights in [from, to) into duties (report/release, sectors, augmentation from FDP need)
 * and pairings (base → base or deployment), replacing unassigned planned ones. TODO(B2)
 */
export function buildDuties(_g: GameState, _aircraftId: string, _from: Minute, _to: Minute): Duty[] {
  return [];
}

export interface RosterResult {
  /** Slots filled. */
  assigned: number;
  /** Flights still missing crew. */
  uncovered: string[];
  deadheads: number;
  /** Ticket + hotel cost committed. */
  cost: number;
}

/**
 * Greedy auto-roster: fill every open slot of planned pairings in [from, to) (default: now → roster horizon)
 * with the best-scoring legal crew member; add deadheads to position crew. TODO(B2)
 */
export function autoRoster(_g: GameState, _opts: { from?: Minute; to?: Minute; aircraftIds?: string[] } = {}): RosterResult {
  return { assigned: 0, uncovered: [], deadheads: 0, cost: 0 };
}

/**
 * Cheap re-sync after another module changed an aircraft's flights from t (retime, cancel, removal, reassign,
 * sub-charter); called from crew's settle hook, never directly. Drops cancelled/removed/foreign flights from duties
 * (and Flight.crewIds), recomputes report/release/fdp where flightsEv changed, bumps duty.ev and re-queues
 * duty.report/release, re-checks legality; a duty that became illegal or uncovered within the roster horizon
 * goes through rerosterFrom. TODO(B2)
 */
export function onFlightsChanged(_g: GameState, _aircraftId: string, _t: Minute): void {}

/** Commander's discretion (B3 crewShort decision): maxFdp +2:00 (+3:00 augmented), crew.discretion++, morale −3. TODO(B2) */
export function applyDiscretion(_g: GameState, _dutyId: string): ActionResult {
  return { ok: false, error: 'Rostering is not built yet' };
}

/** Replaces one slot's crew member: the given one, or the best legal candidate (deadhead included). TODO(B2) */
export function replaceCrew(_g: GameState, _pairingId: string, _slot: number, _crewId?: string): ActionResult<{ crewId: string }> {
  return { ok: false, error: 'Rostering is not built yet' };
}

/** Takes a crew member off every slot overlapping [from, to) (sickness, leave) and re-rosters those pairings. TODO(B2) */
export function removeCrew(g: GameState, _crewId: string, from: Minute, to: Minute): RosterResult {
  return autoRoster(g, { from, to });
}

/** After an AOG or sickness: rebuild duties from t on the aircraft and find new crew where needed. TODO(B2) */
export function rerosterFrom(g: GameState, aircraftId: string, t: Minute): RosterResult {
  return autoRoster(g, { from: t, aircraftIds: [aircraftId] });
}

/** Manual override from the roster view (illegal assignments are allowed but flagged red). TODO(B2) */
export function assignCrew(_g: GameState, _pairingId: string, _slot: number, _crewId: string): ActionResult {
  return { ok: false, error: 'Rostering is not built yet' };
}

export function unassignCrew(_g: GameState, _pairingId: string, _slot: number): ActionResult {
  return { ok: false, error: 'Rostering is not built yet' };
}

/** A crew member's duties overlapping [from, to), in time order. TODO(B2): runtime index crewId → duties. */
export function rosterOf(_g: GameState, _crewId: string, _from: Minute, _to: Minute): Duty[] {
  return [];
}

export interface FlightCrewStatus {
  level: 'ok' | 'tight' | 'missing' | 'illegal';
  missing: Role[];
}

/** Crew coverage of a flight (Schedule and map panels colour by this). TODO(B2) */
export function flightCrewStatus(_g: GameState, _flightId: string): FlightCrewStatus {
  return { level: 'missing', missing: [] };
}
