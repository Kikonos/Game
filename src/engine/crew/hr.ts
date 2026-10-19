// Hiring, training and staffing (B2). DESIGN.md §5.4.

import type { RatingFamily } from '../../data/acmiTypes';
import type { ActionResult, GameState, Minute, Role, SimEvent, TrainingKind } from '../core/types';

export interface HireRequest {
  role: Role;
  family: RatingFamily;
  base: string;
  count: number;
}

/** Pure quote (no g.rng): ready date jitter from hashUnit(role + base + now); hireCrew stores this exact date. TODO(B2) */
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

export interface RoleCapacity {
  /** Crew-days the programme needs vs free crew-days left after existing pairings, in the window. */
  need: number;
  free: number;
  /** Extra crew of this role to hire or move (0 when covered). */
  short: number;
}

export interface Availability {
  /** Complements the programme needs, and how many the free capacity covers. */
  setsNeeded: number;
  setsAvailable: number;
  byRole: Partial<Record<Role, RoleCapacity>>;
  /** First day the shortfall bites (null when covered). */
  firstShort: Minute | null;
}

/**
 * Capacity, not idleness (B1 feasibility check 11): free duty-days per role in [from, to) after existing pairings,
 * days off and the 100 h/28 d block limit, vs the programme's need (RESEARCH §5.3 sizing from `programmeBH`).
 * Pure: no g.rng, no ids. TODO(B2)
 */
export function crewAvailability(_g: GameState, _family: RatingFamily, _typeId: string, _from: Minute, _to: Minute, _programmeBH: number): Availability {
  return { setsNeeded: 0, setsAvailable: 0, byRole: {}, firstShort: null };
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
