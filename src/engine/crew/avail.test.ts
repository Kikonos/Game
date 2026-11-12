// v0.23 crew planned person by person: the one reading of "busy" the planner and the crew-alarm cross-check share.

import { describe, expect, it } from 'vitest';
import type { CrewMember, GameState, Pairing } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { dutyClash, guestOn, heldDuties } from './avail';
import { otherTrip } from './check';
import { crewIx } from './timeline';
import { memberTours, tourSpan } from './tours';

const H = 60;

describe('avail: busy means their own duties', () => {
  it('dutyClash: a duty overlapping the window, never the days between duties', () => {
    const duties = [{ report: 10 * H, release: 18 * H }, { report: 58 * H, release: 66 * H }, { report: 130 * H, release: 140 * H }];
    expect(dutyClash(duties, 0, 10 * H)).toBe(-1);
    expect(dutyClash(duties, 17 * H, 20 * H)).toBe(0);
    expect(dutyClash(duties, 18 * H, 58 * H)).toBe(-1);
    expect(dutyClash(duties, 30 * H, 59 * H)).toBe(1);
    expect(dutyClash(duties, 70 * H, 129 * H)).toBe(-1);
    expect(dutyClash(duties, 139 * H, 200 * H)).toBe(2);
    expect(dutyClash([], 0, 1e9)).toBe(-1);
  });

  it('guestOn: only the seat marked as a guest\'s', () => {
    const p = { slots: [{ role: 'CPT', crewId: 'a' }, { role: 'FO', crewId: 'b', guest: true }, { role: 'CC', crewId: null }] } as unknown as Pairing;
    expect(guestOn(p, 'a')).toBe(false);
    expect(guestOn(p, 'b')).toBe(true);
    expect(guestOn(p, 'zz')).toBe(false);
  });

  it('a set member on station: held duties are their own, and the planner calls them busy only over those (the player\'s Riyadh save)', () => {
    const data = JSON.parse(fixture('v0221-riyadh')) as { state: GameState };
    data.state.stats.sideTripRedo = true;
    data.state.stats.perCrewRedo = true;
    const g = deserialize(JSON.stringify(data));
    const c = Object.values(g.crew).find((x) => `${x.first} ${x.last}` === 'Rui Ribeiro') as CrewMember;
    const mine = heldDuties(g, c, Object.values(g.pairings));
    expect(mine.length).toBeGreaterThan(2);
    for (let i = 1; i < mine.length; i++) expect(mine[i].start).toBeGreaterThanOrEqual(mine[i - 1].start);
    // Every held duty is on a trip he is seated on, still to fly.
    for (const x of mine) {
      expect(x.pairing.slots.some((s) => s.crewId === c.id)).toBe(true);
      expect(x.duty.done).toBeFalsy();
    }
    // The same through the crew index (what the planner reads).
    expect(heldDuties(g, c, crewIx(g).pairingsOf.get(c.id) ?? []).map((x) => x.duty.id)).toEqual(mine.map((x) => x.duty.id));
    // A free day between two of his duties: no other trip stands in the way of work there, inside his rotation.
    const tour = memberTours(g, c.id).find((q) => (tourSpan(g, q)?.to ?? 0) > g.now)!;
    const span = tourSpan(g, tour)!;
    const gap = mine.findIndex((x, i) => i > 0 && x.start - mine[i - 1].end > 3 * 24 * H);
    expect(gap).toBeGreaterThan(0);
    const from = mine[gap - 1].end + 24 * H;
    const to = from + 10 * H;
    expect(from).toBeGreaterThan(span.from);
    expect(to).toBeLessThan(span.to);
    const other = Object.values(g.pairings).find((p) => !!p.tour && p.status === 'planned' && !p.slots.some((s) => s.crewId === c.id))!;
    expect(otherTrip(g, c, other, from, to, false, undefined, undefined, true)).toBeNull();
    // Over one of his own duties he is busy, guest or not.
    expect(otherTrip(g, c, other, mine[gap].start + H, mine[gap].end - H, false, undefined, undefined, true)).not.toBeNull();
    // And as a member of another set's rotation he cannot join while his own runs.
    expect(otherTrip(g, c, other, from, to, false, undefined, undefined, false)).not.toBeNull();
  });
});
