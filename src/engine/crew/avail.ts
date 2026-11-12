// v0.23 crew planned person by person (the player: "each crew member should be separate with their own availabilities
// and duties. They should fill whatever needs to be filled"). What a crew member holds is their own work and nothing
// else: the duties still to fly of the trips and tour parts they are seated on. A seat is no claim on the days between
// those duties. This is the one reading of "busy" shared by the planner (check.ts otherTrip) and by the crew-alarm
// cross-check (crossCheck.ts), so the two cannot disagree about who is free. Legality (rest, the day's length, the
// cumulative limits, where they are) stays apart: rules.ts evalSegs for the planner, selfCheck.ts judgePerson for the
// cross-check. Pure.

import type { CrewMember, Duty, GameState, Minute, Pairing } from '../core/types';
import { standsBy } from './timeline';

/**
 * crewId's seat on p is a guest's: this part's duties only (a duty or two of another set's tour, between their own
 * work), then back to where they need to be. Not a member of the set (crew/tours.ts).
 */
export function guestOn(p: Pairing, crewId: string): boolean {
  for (const s of p.slots) if (s.crewId === crewId) return !!s.guest;
  return false;
}

/** One duty a crew member holds: still to fly, on a trip or tour part they are seated on. */
export interface HeldDuty {
  pairing: Pairing;
  duty: Duty;
  /** Report and release (the duty's own; a ticket out or home is not part of it). */
  start: Minute;
  end: Minute;
  /** They stand by at the station for it (a far base's reserve, a relief pilot on a plain day): not flying. */
  standsBy: boolean;
}

/**
 * The duties c holds among `pairings` (the trips they are seated on; a finished or broken one holds nothing), in report
 * order. `but`: a pairing left out (the one being planned).
 */
export function heldDuties(g: GameState, c: CrewMember, pairings: Iterable<Pairing>, but?: string): HeldDuty[] {
  const out: HeldDuty[] = [];
  for (const p of pairings) {
    if (p.id === but || p.status === 'done' || p.status === 'broken') continue;
    let seated = false;
    for (const s of p.slots) if (s.crewId === c.id) seated = true;
    if (!seated) continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (!d || d.done) continue;
      out.push({ pairing: p, duty: d, start: d.report, end: d.release, standsBy: standsBy(g, p, d, c.id) });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The first open duty among `duties` (in report order) that overlaps [from, to), or null: the person is free of them. */
export function dutyClash(duties: readonly { report: Minute; release: Minute }[], from: Minute, to: Minute): number {
  for (let i = 0; i < duties.length; i++) {
    const d = duties[i];
    if (d.report >= to) break;
    if (d.release > from) return i;
  }
  return -1;
}
