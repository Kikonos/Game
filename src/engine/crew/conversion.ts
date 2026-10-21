// v0.6 bulk type-rating conversion (UPDATE-0.6.md §F2): classes of at most BAL.conv.classMax, pilot and cabin
// courses, staggering, refunds and fleet-short warnings. Read APIs are pure.

import type { RatingFamily } from '../../data/acmiTypes';
import type { ActionResult, GameState, Minute, TrainingClass } from '../core/types';

export interface ConversionRequest {
  crewIds: string[];
  family: RatingFamily;
  start: Minute;
  drop?: Record<string, RatingFamily>;
}

export interface ConversionClassPlan {
  no: string;
  group: 'pilot' | 'cabin';
  course: 'full' | 'ccq';
  start: Minute;
  end: Minute;
  crewIds: string[];
  costPerHead: number;
  cost: number;
  phases: { label: string; from: Minute; to: Minute }[];
}

export interface ConversionPlan {
  ok: boolean;
  classes: ConversionClassPlan[];
  cost: number;
  skipped: { crewId: string; why: string }[];
  warnings: { level: 'warn' | 'bad'; text: string }[];
  dutiesAffected: number;
  /** Per included crew member: ratings after completion (pilots drop the old type unless CCQ; cabin keep ≤ 3). */
  ratingsAfter: Record<string, RatingFamily[]>;
  /** Cabin crew at 3 types: the default rating they give up (player may override via drop). */
  dropDefault: Record<string, RatingFamily>;
  earliest: Minute;
}

const LABEL: Partial<Record<RatingFamily, string>> = { 'A330/340': 'A330', 'B757/767': 'B767' };

/** Short label of a rating family: 'A330/340' → 'A330', 'B757/767' → 'B767'. */
export function familyLabel(f: RatingFamily): string {
  return LABEL[f] ?? f;
}

/** Plan a conversion without booking it. Pure. (stub) */
export function conversionPlan(g: GameState, _r: ConversionRequest): ConversionPlan {
  return { ok: false, classes: [], cost: 0, skipped: [], warnings: [], dutiesAffected: 0, ratingsAfter: {}, dropDefault: {}, earliest: g.now };
}

/** Book the conversion: classes, costs, blocks. (stub) */
export function startConversion(_g: GameState, _r: ConversionRequest): ActionResult<{ classIds: string[] }> {
  return { ok: false, error: 'v0.6 stub' };
}

/** Cancel a class or one member of it, with the refund. (stub) */
export function cancelConversion(_g: GameState, _classId: string, _crewId?: string): ActionResult<{ refund: number }> {
  return { ok: false, error: 'v0.6 stub' };
}

/** Planned and running classes by start. Pure. */
export function conversionClasses(g: GameState): TrainingClass[] {
  return Object.values(g.classes ?? {}).filter((k) => k.status === 'planned' || k.status === 'running').sort((a, b) => a.start - b.start);
}

/** The planned or running class of a crew member. Pure. */
export function classOf(g: GameState, crewId: string): TrainingClass | null {
  return conversionClasses(g).find((k) => k.crewIds.includes(crewId)) ?? null;
}
