// Player bot round (Nov 2026), a crew alarm the cross-check judged WRONG while the planner was right: the player's
// Chevron game played on by the player-like bot (--player --from chev2, 27 Jul 2027). XY3060 RUH–MCT 29 Jul 03:00 was
// short of a first officer; the check offered Duarte Oliveira, "at Riyadh". He was finishing a trip at Düsseldorf and
// held its ticket home to Riyadh landing 28 Jul 16:45, 9:15 before the 02:00 report. Positioning is duty and owes its
// rest (10 h away from base): the planner refused him, rightly. The check never saw the ticket: it read tickets only
// through trips still open, and his trip was already flown.
// Pinned: the check reads every ticket a crew member holds.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { crossCheck } from './crossCheck';
import { judgePerson } from './selfCheck';

const load = (): GameState => deserialize(fixture('v023-xy3060'));

describe('XY3060: a ticket home of a finished trip owes its rest', () => {
  it('the cross-check no longer offers a first officer landing 9:15 before the report', () => {
    const g = load();
    const until = g.now + 2;
    while (g.now < until) advanceTo(g, until);
    const f = Object.values(g.flights).find((x) => x.no === 'XY3060' && x.status === 'scheduled')!;
    const duarte = Object.values(g.crew).find((c) => c.first === 'Duarte' && c.last === 'Oliveira')!;
    const d = g.duties[f.dutyId!];
    const r = judgePerson(g, duarte, d, g.pairings[d.pairingId]);
    expect(r.values.rest).toBeTruthy();
    expect(r.values.rest![0]).toBeLessThan(r.values.rest![1]);
    const x = crossCheck(g, f.id, 'short');
    expect(x.plan.some((s) => s.crewId === duarte.id)).toBe(false);
  });
});
