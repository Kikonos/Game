// Final debug round (Nov 2026), a WRONG crew alarm of the standard bot (seed 2 --wide, 26 Nov 2027): DK983 CPH–VIE,
// a one-day trip whose cabin crew member Diogo Silva flew out DUB–CPH the same morning (the ticket joins the day: a duty
// from 09:00). A 39-minute ground-handling delay pushed the release to 21:14. His ticket out had already landed, so the
// re-plan of his way home (retick) left it out, sized the rest on the flights alone and moved his ticket home EARLIER,
// 10:00 → 09:00 the next morning, into the rest the whole day needs ('Rest 10:46 < 12:14'). The gate then took him off
// and the flight left two hours late. The same at DK785 (3 Dec, a 7-minute delay: sub-chartered, 4 h late).
// Pinned: a ticket home never moves into the rest; it moves to after the rest of the whole day, ticket out included.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { crewIssuesFor } from './check';
import { segsOf } from './timeline';

const load = (): GameState => deserialize(fixture('v0231-dk983'));
const dk983 = (g: GameState) => Object.values(g.flights).find((f) => f.no === 'DK983' && f.std > g.now - 6 * 60)!;

describe('DK983: a short delay on a day that starts with a ticket out already flown', () => {
  it('the crew stay on, and the ticket home moves after the rest of the whole day', () => {
    const g = load();
    const f0 = dk983(g);
    const std0 = f0.std;
    const crew0 = [...f0.crewIds].sort();
    const diogo = g.crew.c15;
    expect(diogo.last).toBe('Silva');
    expect(crew0).toContain('c15');
    // Play past the delay (14:19) to just before departure.
    const until = g.now + 3 * 60 + 30;
    while (g.now < until) advanceTo(g, until);
    const f = dk983(g);
    expect(f.std).toBeGreaterThan(std0);
    expect(f.status).toBe('scheduled');
    expect([...f.crewIds].sort()).toEqual(crew0);
    expect(crewIssuesFor(g, g.duties[f.dutyId!])).toEqual([]);
    expect(g.messages.some((m) => /taken off DK983/.test(m.title))).toBe(false);
    // His day runs from the ticket out's check-in; the ticket home leaves after that day's rest.
    const segs = segsOf(g, diogo);
    const duty = segs.find((s) => s.kind === 'duty' && s.dutyId === f.dutyId)!;
    expect(duty.out).toBeTruthy();
    const home = segs.find((s) => s.kind === 'pos' && s.start > duty.end)!;
    expect(home.start - duty.end).toBeGreaterThanOrEqual(duty.rest);
  }, 60_000);
});
