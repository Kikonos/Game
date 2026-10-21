// v0.6 extra crew above the legal minimum (UPDATE-0.6.md §F4): per aircraft or contract, optional seats that
// never block a departure. Read APIs are pure.

import type { ActionResult, CrewExtra, GameState } from '../core/types';

/** Cost and benefit estimate of an extra-crew setting on one aircraft. Pure. (stub) */
export function crewExtraQuote(
  _g: GameState, _aircraftId: string, _x: CrewExtra,
): { minimum: { pilots: number; cabin: number }; extraPeople: number; perMonth: number; morale: 'up' | 'none'; service: number } {
  return { minimum: { pilots: 2, cabin: 0 }, extraPeople: 0, perMonth: 0, morale: 'none', service: 0 };
}

/** Set (or with null reset) the extra crew of an aircraft or a contract. (stub) */
export function setCrewExtra(_g: GameState, _target: { aircraftId: string } | { contractId: string }, _x: CrewExtra | null): ActionResult {
  return { ok: false, error: 'v0.6 stub' };
}
