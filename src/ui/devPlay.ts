// Dev-only fast-forward with a simple player policy (accept the best workable offer, take decision defaults,
// hire to staffing), so screens can be checked on real engine data: __contrail.dev.autoplay(days).
// Mirrors the headless bot (scripts/acmi-bot.ts) in a smaller form; never used by the game itself.

import { acceptOffer, feasibilityAll } from '../engine/contracts';
import { clearPause } from '../engine/core/pause';
import { DAY, HOUR } from '../engine/core/time';
import type { GameState, Role } from '../engine/core/types';
import { hireCrew, staffing } from '../engine/crew';
import { resolveDecision } from '../engine/ops';
import { advanceTo, settle } from '../engine/sim';

function policy(g: GameState, newDay: boolean): void {
  for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
  if (!newDay) return;
  for (const l of staffing(g)) {
    if (l.have < l.need) hireCrew(g, { role: l.role as Role, family: l.family, base: g.company.homeBase, count: Math.min(30, l.need - l.have) });
  }
  const open = Object.values(g.offers).filter((o) => o.status === 'open' && o.start >= g.now && o.start < g.now + 30 * DAY);
  for (const o of open.sort((a, b) => b.estValue - a.estValue)) {
    const best = feasibilityAll(g, o.id).find((r) => r.level !== 'no' && r.estMargin > 0);
    if (best) acceptOffer(g, o.id, [best.aircraftId]);
  }
  settle(g);
}

/** Plays `days` game days in 6-hour steps. Returns the number of steps taken. */
export function autoplay(g: GameState, days: number): number {
  const end = g.now + Math.round(days * DAY);
  let steps = 0;
  let day = Math.floor(g.now / DAY);
  policy(g, true);
  while (g.now < end && !g.gameOver && steps < 100_000) {
    advanceTo(g, Math.min(end, g.now + 6 * HOUR));
    const nd = Math.floor(g.now / DAY);
    policy(g, nd !== day);
    day = nd;
    steps++;
  }
  clearPause();
  return steps;
}
