// Maintenance planning, checks and AOG (B3). DESIGN.md §5.6.

import type { ActionResult, Aircraft, GameState, MaintKind, Minute, SimEvent } from '../core/types';

export interface CheckStatus {
  /** A-check: flight hours remaining and calendar due date (whichever first). */
  aHoursLeft: number;
  aDue: Minute;
  /** C-check calendar due date and FH remaining. */
  cDue: Minute;
  cHoursLeft: number;
  /** Next planned events. */
  nextA: string | null;
  nextC: string | null;
  /** 0–1 AOG risk indicator for the UI. */
  risk: number;
}

/** TODO(B3) */
export function checkStatus(_g: GameState, ac: Aircraft): CheckStatus {
  return { aHoursLeft: 0, aDue: ac.maint.lastA, cDue: ac.maint.lastC, cHoursLeft: 0, nextA: null, nextC: null, risk: 0 };
}

/** Books a check at an airport from `start` (blocks the aircraft; conflicts must be cleared first). TODO(B3) */
export function scheduleCheck(_g: GameState, _aircraftId: string, _kind: MaintKind, _start: Minute, _at: string): ActionResult<{ maintId: string }> {
  return { ok: false, error: 'Maintenance planning is not built yet' };
}

export function cancelCheck(_g: GameState, _maintId: string): ActionResult {
  return { ok: false, error: 'Maintenance planning is not built yet' };
}

/** Daily: auto-plan A-checks into idle gaps (policy), warn about C-checks due within 60 days. TODO(B3) */
export function planChecks(_g: GameState): void {}

/** AOG probability for the next departure (age, deferred defects, remoteness). TODO(B3) */
export function aogChance(_g: GameState, _ac: Aircraft, _airport: string): number {
  return 0;
}

/** 'maint.start' / 'maint.end'. TODO(B3) */
export function onMaintStart(_g: GameState, _ev: SimEvent): void {}
export function onMaintEnd(_g: GameState, _ev: SimEvent): void {}
