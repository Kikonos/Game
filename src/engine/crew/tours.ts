// Rotations round (v0.16.4): a deployment tour holds its crew for the whole rotation period, not only for the duties
// known so far (the programme's flights roll in 28 days ahead). Real ACMI practice: a crew set stays on station until
// its rotation ends (days off at the hotel), and goes home early only when a legal limit leaves no on-station answer.
// Pure helpers read by the roster (check.ts otherTrip, roster.ts fillPairing / sendHome / tourHomeTickets).

import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { CrewMember, Deployment, GameState, Minute, Pairing } from '../core/types';
import { crewIx } from './timeline';

/** The deployment of a tour pairing. */
export const deploymentOf = (g: GameState, p: Pairing): Deployment | undefined => (p.tour && p.deploymentId ? g.deployments[p.deploymentId] : undefined);

/** The period a tour pairing's crew are committed to: the rotation period, cut at the deployment's end. */
export function tourSpan(g: GameState, p: Pairing): { from: Minute; to: Minute } | null {
  const dep = deploymentOf(g, p);
  if (!dep || !p.tour) return null;
  return { from: p.tour.from, to: Math.min(p.tour.to, dep.end) };
}

/** Two pairings are parts of one set's tour (a tour split into parts keeps set and period). */
export const sameTour = (p: Pairing, q: Pairing): boolean =>
  !!p.tour && !!q.tour && p.deploymentId === q.deploymentId && p.tour.set === q.tour.set && p.tour.from === q.tour.from;

/**
 * The period's last duty is known: its end (or the deployment's) lies inside the schedule horizon, so the roster can
 * book the ticket home after the real last duty. Before that the crew keep no ticket home (it would move every day).
 */
export function tourEndKnown(g: GameState, p: Pairing): boolean {
  const span = tourSpan(g, p);
  return !span || span.to <= g.now + (BAL.scheduleHorizonDays - 1) * DAY;
}

/**
 * The tour that keeps crew member c on station now: seated on a tour pairing whose period is under way and not over,
 * at its base, with work of that period still to come or its end not yet known. Null when they are free to go home
 * (the period is over, every known duty flown and the end known, a block ahead inside the period, or not at the base).
 */
export function tourHolding(g: GameState, c: CrewMember): Pairing | null {
  let hold: Pairing | null = null;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (!q.tour || q.status === 'broken') continue;
    const dep = deploymentOf(g, q);
    const span = tourSpan(g, q);
    if (!dep || !span || c.loc !== dep.base) continue;
    if (span.from > g.now + DAY || span.to <= g.now + 12 * 60) continue;
    if (c.blocks?.some((b) => b.from < span.to && b.to > g.now)) continue;
    if (q.dutyIds.some((id) => { const d = g.duties[id]; return !!d && !d.done && d.report > g.now; }) || !tourEndKnown(g, q)) hold = q;
  }
  return hold;
}

/** Rotations round: how far into its period a set is, in whole days (for the Crew view and the inbox). */
export function tourDay(g: GameState, p: Pairing): { day: number; of: number } | null {
  const span = tourSpan(g, p);
  if (!span) return null;
  return { day: Math.max(1, Math.min(Math.ceil((g.now - span.from) / DAY), Math.round((span.to - span.from) / DAY))), of: Math.round((span.to - span.from) / DAY) };
}
