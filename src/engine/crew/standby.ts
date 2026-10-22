// v0.7.3 home standby (ORO.FTL.225, CS FTL.1.225(b); UPDATE-0.7.3.md §3.7): a few crew per rating family on call at
// home 06:00–18:00 for the next days, called first by Crew Control (no overtime, a shorter day after 6 h).

import type { GameState, Minute } from '../core/types';

/** The home standby window a crew member is on at t, else null. Pure. */
export function onStandby(g: GameState, crewId: string, t: Minute): { from: Minute; to: Minute } | null {
  const c = g.crew[crewId];
  const w = c?.standby?.find((s) => s.from <= t && t < s.to && s.calledAt === undefined);
  return w ? { from: w.from, to: w.to } : null;
}
