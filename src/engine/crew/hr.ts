// Hiring, training and staffing (B2). DESIGN.md §5.4.

import type { RatingFamily } from '../../data/acmiTypes';
import type { ActionResult, GameState, Minute, Role, SimEvent, TrainingKind } from '../core/types';

export interface HireRequest {
  role: Role;
  family: RatingFamily;
  base: string;
  count: number;
}

export function hireQuote(_g: GameState, _r: HireRequest): { cost: number; readyAt: Minute } {
  return { cost: 0, readyAt: 0 };
}

/** Creates 'joining' crew members, charges hiring cost, queues 'crew.join' at readyAt. TODO(B2) */
export function hireCrew(_g: GameState, _r: HireRequest): ActionResult<{ crewIds: string[] }> {
  return { ok: false, error: 'Hiring is not built yet' };
}

/** Type rating, command upgrade, SCCM course or conversion: status 'training' until done. TODO(B2) */
export function trainCrew(_g: GameState, _crewId: string, _kind: TrainingKind, _family: RatingFamily): ActionResult {
  return { ok: false, error: 'Training is not built yet' };
}

export interface Availability {
  /** Complete crew sets (complements) free across [from, to). */
  sets: number;
  byRole: Partial<Record<Role, number>>;
}

/** Rough crew capacity for feasibility (B1 calls this): rated, not training/leave, not rostered in the window. TODO(B2) */
export function crewAvailability(_g: GameState, _family: RatingFamily, _typeId: string, _from: Minute, _to: Minute): Availability {
  return { sets: 0, byRole: {} };
}

export interface StaffingLine {
  family: RatingFamily;
  role: Role;
  have: number;
  need: number;
}

/** Staffing vs need (≈ 5 crew sets per aircraft of the family) for the Crew screen. TODO(B2) */
export function staffing(_g: GameState): StaffingLine[] {
  return [];
}

/** 'crew.join': status → available at base. TODO(B2) */
export function onCrewJoin(_g: GameState, _ev: SimEvent): void {}

/** 'training.done': add the rating / role, status → available. TODO(B2) */
export function onTrainingDone(_g: GameState, _ev: SimEvent): void {}
