// Bug report 1108b #4 (the player's CP7040 MNL–KIX: "a rolling error on the aircraft"): the in-flight rest marks
// (ops/flights.ts restOutOfHours, limit 'inflightRest') are about ONE augmented duty whose rest plan failed at its gate
// after a delay. They sat on the seats of the whole pairing, so on a deployment tour every later duty of the set (a
// plain 10:25 day of 11:15 with no in-flight rest at all) read "the cabin crew cannot all rest in this cruise": a red
// alarm at each report, holds and cancellations (CP7020, CP7000, CP7040), and the self-check could not judge the claim.
// A mark now names its duty and speaks only for it while that duty is augmented, reported and not yet flown. Pure,
// except the clean-ups at release and on load.

import type { CrewSlot, Duty, GameState, Pairing } from '../core/types';

/** The seat's in-flight rest mark holds for duty d: the mark is d's (legacy marks without a duty: made after d reported). */
export function restMarkLive(d: Duty | undefined, s: CrewSlot): boolean {
  const m = s.ooh;
  if (!m || m.limit !== 'inflightRest' || !s.crewId || !d || d.done || d.augment <= 0) return false;
  return m.dutyId !== undefined ? m.dutyId === d.id : m.at >= d.report;
}

/** Some seat of p carries a live in-flight rest mark for duty d. */
export function restMarked(p: Pairing | undefined, d: Duty | undefined): boolean {
  return !!p && !!d && p.slots.some((s) => restMarkLive(d, s));
}

/** The pairing's open duty a mark could still be about: the first one not flown. */
function openDuty(g: GameState, p: Pairing): Duty | undefined {
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (d && !d.done) return d;
  }
  return undefined;
}

/**
 * Drops in-flight rest marks that no longer speak for any duty: the duty they were about has flown, was cancelled or
 * re-cut, or the pairing's next duty is another (a plain day, or an augmented one whose plan was never judged).
 * At a duty's release (`only`: that pairing) and on load (every pairing: older saves kept them for weeks). Returns
 * the number dropped.
 */
export function dropStaleRestMarks(g: GameState, only?: Pairing): number {
  let n = 0;
  for (const p of only ? [only] : Object.values(g.pairings)) {
    if (!p.slots.some((s) => s.ooh?.limit === 'inflightRest')) continue;
    const d = openDuty(g, p);
    for (const s of p.slots) {
      if (s.ooh?.limit !== 'inflightRest' || restMarkLive(d, s)) continue;
      delete s.ooh;
      n++;
    }
  }
  return n;
}
