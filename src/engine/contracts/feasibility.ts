// Feasibility and aircraft selection (B1). DESIGN.md §5.1.5.

import type { GameState, Minute } from '../core/types';
import type { Availability } from '../crew';

export type CheckId = 'seats' | 'layout' | 'family' | 'range' | 'runway' | 'etops' | 'approvals' | 'availability' | 'maintenance' | 'crew' | 'positioning' | 'lease';
export type CheckLevel = 'ok' | 'warn' | 'no';

export interface FeasibilityCheck {
  id: CheckId;
  level: CheckLevel;
  label: string;
  detail?: string;
}

/** One empty leg of a positioning plan (built with planSector; a fuel stop makes two legs, each an FTL sector). */
export interface PositioningLeg {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
}

export interface FeasibilityReport {
  offerId: string;
  aircraftId: string;
  /** Worst check level. */
  level: CheckLevel;
  checks: FeasibilityCheck[];
  /** Empty legs needed before the first and after the last revenue leg ([] when none; > 1 leg = fuel stops). */
  positionIn: PositioningLeg[];
  positionOut: PositioningLeg[];
  techStops: string[];
  /** Flight ids and maintenance ids that overlap the programme on this aircraft. */
  conflicts: { flights: string[]; maintenance: string[] };
  /** Crew capacity vs the programme's need (crew.crewAvailability): shortfall by role and when it bites. */
  crew: Availability;
  estBH: number;
  estRevenue: number;
  estCost: number;
  estMargin: number;
}

/** Full report for one aircraft. TODO(B1): every check in DESIGN.md §5.1.5. */
export function feasibility(_g: GameState, offerId: string, aircraftId: string): FeasibilityReport {
  return {
    offerId, aircraftId, level: 'warn', checks: [{ id: 'availability', level: 'warn', label: 'Planner not built yet' }],
    positionIn: [], positionOut: [], techStops: [], conflicts: { flights: [], maintenance: [] },
    crew: { setsNeeded: 0, setsAvailable: 0, byRole: {}, firstShort: null }, estBH: 0, estRevenue: 0, estCost: 0, estMargin: 0,
  };
}

/** One report per fleet aircraft, best first (ok before warn before no, then margin). */
export function feasibilityAll(g: GameState, offerId: string): FeasibilityReport[] {
  return Object.keys(g.fleet).map((id) => feasibility(g, offerId, id));
}
