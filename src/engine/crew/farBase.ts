// v0.12.1 far bases: a base so far from home that a crew member who falls sick there can't be replaced from home
// within a day (the fastest ticket home takes over 12 h, or it lies 4 or more time zones away, where crew flown in
// need local nights first). Real ACMI practice stations enough crew there, reserve included, and rotates them in
// planned blocks: the deployment is sized on the programme itself, never on its positioning alone (duties.ts, as every
// base is since v0.12.1), and every crew set on station carries its own reserve (a spare captain and purser, a cabin crew more on a widebody),
// rotating with the set's tours. A reserve flies along as crew above the minimum, so a sick call at the base or at an
// outstation the set slips at (Cairns, Perth, Chennai) is covered on the spot (roster.ts promoteSpares); on the
// days the set does not fly, the reserve stands by at the hotel with it (dayPlan.ts). Pure.

import { BAL } from '../core/balance';
import { blockMinutes, typeOf } from '../core/perf';
import { ticketBlock } from '../ops/commercial';
import type { GameState, Minute, Pairing, Role } from '../core/types';
import { tzDeltaH } from './rules';

/** Ticket hours and time zones from home past which a base is far. */
export const FAR = { ticketH: 12, tzH: 4 };

/** A base far from home: the fastest ticket home over 12 h, or 4+ time zones (at t). Pure. */
export function farBase(home: string, base: string, t: Minute): boolean {
  if (home === base) return false;
  return ticketBlock(base, home) > FAR.ticketH * 60 || tzDeltaH(home, base, t) >= FAR.tzH;
}

/**
 * Crew sets on station a base's pattern asks for before its flights exist (an offer, a base signed months ahead):
 * one per 85 block hours a month (4 for a 747 at 300 BH), at least 2 (3 with three waves a day). v0.12.1 every base
 * (duties.ts chainDeployment; was far bases only); with `typeId`, never more hours than its waves can fly (one wave of
 * HAM–PMI flies about 160 BH a month whatever the target). Pure.
 */
export function patternSets(p: { base: string; dests: string[]; waves: number[]; targetBH: number }, typeId?: string): number {
  let bh = p.targetBH;
  if (typeId && p.dests.length) {
    const rot = p.dests.reduce((s, d) => s + blockMinutes(typeId, p.base, d) + blockMinutes(typeId, d, p.base), 0) / p.dests.length;
    bh = Math.min(bh, (p.waves.length * rot * 30.44) / 60);
  }
  return Math.max(p.waves.length >= 3 ? 3 : 2, Math.ceil(bh / BAL.cabinBHMonth - 1e-9));
}

/**
 * The reserve one crew set at a far base carries: a spare captain (either pilot seat), a spare purser (the purser's
 * or a cabin crew seat), and on a widebody one more cabin crew. Pure.
 */
export function reserveRoles(typeId: string): Role[] {
  return typeOf(typeId).body === 'wide' ? ['CPT', 'PUR', 'CC'] : ['CPT', 'PUR'];
}

/** The far base a pairing is a deployment tour of (null for a trip, or a tour at a near base). Pure. */
export function farTourBase(g: GameState, p: Pairing): string | null {
  if (!p.tour || !p.deploymentId) return null;
  const dep = g.deployments[p.deploymentId];
  return dep && farBase(g.company.homeBase, dep.base, dep.start) ? dep.base : null;
}

/** Per-person costs of a reserve crew member for `days` on station: salary share, per diem, hotel nights. Pure. */
export function reserveDayCost(g: GameState, role: Role, wide: boolean): number {
  const [n, w] = BAL.salary[role] ?? [0, 0];
  const salary = ((wide ? w : n) * (1 + BAL.onCosts)) / 30.44;
  const perDiem = (BAL.perDiem[role] ?? 54) * (g.company.policies.perDiemPct / 100);
  const hotel = BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4];
  return salary + perDiem + hotel;
}
