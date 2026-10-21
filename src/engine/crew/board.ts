// v0.6 roster board (UPDATE-0.6.md §F1): crew × day rows, drop-target verdicts while dragging a duty, and the
// move/swap action. Read APIs are pure.

import type { RatingFamily } from '../../data/acmiTypes';
import type { ActionResult, CrewStatus, GameState, Legality, Minute, Role } from '../core/types';
import { crewCalendar, type CalBlock } from './calendar';

export type MoveScope = 'duty' | 'trip';

export interface BoardBlock extends CalBlock {
  pairingId?: string;
  locked?: boolean;
  /** A duty the player can drag (not flown, not under way). */
  movable: boolean;
}

export interface BoardRow {
  crewId: string;
  name: string;
  role: Role;
  base: string;
  families: RatingFamily[];
  morale: number;
  leaves: Minute | null;
  status: CrewStatus;
  blocks: BoardBlock[];
}

export interface DropTarget {
  crewId: string;
  level: Legality | 'ineligible';
  kind: 'assign' | 'swap' | 'none';
  /** The target's work that would come back to the source crew member (swap). */
  swapDutyId?: string;
  /** Player-facing one-liner: 'Legal · ticket $250', 'Rest 9:10 < 10:00 before NB2341', 'Not rated A330', 'Busy: 2 trips'. */
  reason: string;
  ticket: number;
  lateChange: boolean;
}

/** Rows for the given crew over [from, to). Pure. (v0.6 step-0 stub: maps crewCalendar.) */
export function rosterBoard(g: GameState, from: Minute, to: Minute, crewIds: string[]): BoardRow[] {
  const out: BoardRow[] = [];
  for (const id of crewIds) {
    const c = g.crew[id];
    if (!c) continue;
    out.push({
      crewId: id, name: `${c.last}, ${c.first[0]}.`, role: c.role, base: c.base, families: [...c.ratings], morale: c.morale,
      leaves: c.notice?.leaves ?? null, status: c.status,
      blocks: crewCalendar(g, id, from, to).map((b) => ({ ...b, movable: false })),
    });
  }
  return out;
}

/** Verdict for every crew member for dragging dutyId off fromCrewId. Pure. (stub) */
export function dropTargets(_g: GameState, _dutyId: string, _fromCrewId: string, _scope: MoveScope): Record<string, DropTarget> {
  return {};
}

/** Move (or swap) a duty or the rest of its trip from one crew member to another. (stub) */
export function moveDuty(
  _g: GameState, _dutyId: string, _fromCrewId: string, _toCrewId: string, _scope: MoveScope, _opts?: { force?: boolean },
): ActionResult<{ level: Legality; swapped: boolean }> {
  return { ok: false, error: 'v0.6 stub' };
}
