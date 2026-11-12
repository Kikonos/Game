// Player bot round (Nov 2026), a WRONG crew alarm of the standard bot (seed 2 --wide, 8 Jun 2027 10:40): TB954
// BRU–FLR–BRU, a one-day trip whose crew fly out LIS–BRU the same morning (09:00, the ticket joins the day: a 12 h duty
// from 08:00). A 9-minute delay pushed the release to 20:39; the re-check found the ticket home at 10:00 the next
// morning 18 minutes inside the rest after a 12:39 day and tried to move it, but the way home was re-planned on the
// duty alone (15:09–20:39, 10 h of rest), kept the 10:00 seat, and the whole crew of six were taken off a legal day
// (a red shortage, three days off bought back). The cross-check rightly found them free at Brussels.
// Pinned: every re-plan of the way home sizes the rest on the crew member's whole day, ticket out included (outExtra).

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { segsOf } from './timeline';

const load = (): GameState => deserialize(fixture('v023-tb954'));
const tb954 = (g: GameState) => Object.values(g.flights).find((f) => f.no === 'TB954' && f.status === 'scheduled')!;
const named = (g: GameState, last: string) => Object.values(g.crew).find((c) => c.last === last && c.first === 'Ilda')!;

describe('TB954: a 9-minute delay on a day that starts with the ticket out', () => {
  it('the crew stay on the trip and the ticket home moves past the longer rest', () => {
    const g = load();
    const f0 = tb954(g);
    const std0 = f0.std;
    const crew0 = [...f0.crewIds].sort();
    expect(crew0.length).toBe(6);
    const until = g.now + 12;
    while (g.now < until) advanceTo(g, until);
    const f = tb954(g);
    // The delay happened.
    expect(f.std).toBeGreaterThan(std0);
    expect([...f.crewIds].sort()).toEqual(crew0);
    expect(f.crewAlert ?? null).toBeNull();
    // Ilda Tavares's day runs from the ticket's check-in; her ticket home leaves after that day's rest.
    const c = named(g, 'Tavares');
    const segs = segsOf(g, c);
    const duty = segs.find((s) => s.kind === 'duty' && s.dutyId === f.dutyId)!;
    expect(duty.out).toBeTruthy();
    const home = segs.find((s) => s.kind === 'pos' && s.start > duty.end)!;
    expect(home.start - duty.end).toBeGreaterThanOrEqual(duty.end - duty.start);
  });
});
