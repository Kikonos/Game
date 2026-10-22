// v0.7.2 where our crew are away from base (UPDATE-0.7.2.md F1): the map's hotel dots and the top bar's crew line.

import type { GameState } from '../core/types';
import { crewRev } from './timeline';

export interface CrewAway {
  /** Airport → crew ids there and away from their own base (resting, waiting for a ticket, between duties). */
  at: Map<string, string[]>;
  /** Crew on duty now. */
  onDuty: number;
  /** Crew away from base and not on duty (at hotels). */
  atHotels: number;
}

const memo = new WeakMap<GameState, { rev: number; v: CrewAway }>();

/** Crew away from their base by airport (joining crew excluded). Cached per crewRev. Pure. */
export function crewAway(g: GameState): CrewAway {
  const rev = crewRev(g);
  const hit = memo.get(g);
  if (hit && hit.rev === rev) return hit.v;
  const at = new Map<string, string[]>();
  let onDuty = 0;
  let atHotels = 0;
  for (const c of Object.values(g.crew)) {
    if (c.status === 'onDuty') onDuty++;
    if (c.status === 'joining' || c.loc === c.base) continue;
    const l = at.get(c.loc);
    if (l) l.push(c.id);
    else at.set(c.loc, [c.id]);
    if (c.status !== 'onDuty') atHotels++;
  }
  const v = { at, onDuty, atHotels };
  memo.set(g, { rev, v });
  return v;
}
