// Simplified EASA FTL (RESEARCH §5.1, DESIGN.md §5.2). All values in minutes. (B2)

import type { CrewMember, Duty, GameState, Legality, Minute } from '../core/types';

export interface FdpInput {
  /** Report time in minutes after local midnight where the crew is acclimatised. */
  reportLocal: number;
  /** Operated sectors (positioning before operating is not a sector). */
  sectors: number;
  /** false = unknown acclimatisation state "X" (base 11:00). */
  acclimatised: boolean;
  /** Extra pilots (in-flight rest). */
  augment: 0 | 1 | 2;
  restClass: 1 | 2 | 3 | null;
  /** Longest sector block time (for the +1:00 augmented bonus). */
  longestBlock: number;
}

/** Max FDP (F1 table, sector penalty, 9:00 floor; F3 augmented table). TODO(B2) */
export function maxFdp(_i: FdpInput): number {
  return 13 * 60;
}

export interface RestInput {
  /** Previous duty length (minutes). */
  dutyMin: number;
  atHome: boolean;
  augmented: boolean;
  /** Time-zone shift of the trip in hours. */
  tzShift: number;
}

/** F8 minimum rest: max(duty, 12 h home / 10 h away); 14 h after augmented or ≥ 4 h shift. TODO(B2) */
export function minRest(i: RestInput): number {
  return Math.max(i.dutyMin, i.atHome ? 12 * 60 : 10 * 60);
}

/** Cumulative limits (F10) and recovery (F9). */
export const LIMITS = {
  duty7d: 60 * 60,
  duty14d: 110 * 60,
  duty28d: 190 * 60,
  block28d: 100 * 60,
  blockYear: 900 * 60,
  recovery: 36 * 60,
  recoveryEvery: 168 * 60,
} as const;

export interface CrewWindows {
  duty7d: number;
  duty14d: number;
  duty28d: number;
  block28d: number;
  blockYear: number;
  restUntil: Minute;
  /** Latest start of the next 36 h recovery rest. */
  recoveryDue: Minute;
}

/** Rolling totals at time t from the log plus planned duties up to t. TODO(B2) */
export function crewWindows(_g: GameState, c: CrewMember, _t: Minute): CrewWindows {
  return { duty7d: 0, duty14d: 0, duty28d: 0, block28d: 0, blockYear: c.blockYear, restUntil: c.restUntil, recoveryDue: c.lastRecovery + LIMITS.recoveryEvery };
}

export type IssueCode = 'fdp' | 'rest' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'recovery' | 'rating' | 'location' | 'status' | 'overlap';

export interface LegalityIssue {
  code: IssueCode;
  level: Legality;
  text: string;
}

export interface LegalityReport {
  level: Legality;
  issues: LegalityIssue[];
}

/** Can this crew member fly this duty (rating, location/positioning, rest, FDP, cumulative, recovery)? TODO(B2) */
export function checkAssignment(_g: GameState, _crewId: string, _dutyId: string): LegalityReport {
  return { level: 'legal', issues: [] };
}

/** Duty-level legality from its FDP vs max FDP: tight within 30 min of the limit. TODO(B2) */
export function dutyLegality(_g: GameState, _d: Duty): Legality {
  return 'legal';
}
