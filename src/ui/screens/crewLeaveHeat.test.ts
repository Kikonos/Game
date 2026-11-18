// v0.25 Crew › Leave: the 'busiest day away' cells count people ('3/24') and compare with the engine's cap.
import { describe, expect, it } from 'vitest';
import { DAY } from '../../engine/core/time';
import { fixtureGame } from '../../engine/crew/fixtures';
import { leaveCap } from '../../engine/crew';
import { leaveSummary } from './CrewLeave';

describe('v0.25 leave heat cells', () => {
  it('count the most away on one day of each month, and the cap is the engine rule (share rounded, at least one)', () => {
    const g = fixtureGame(3);
    const crew = Object.values(g.crew).filter((c) => !c.notice && c.status !== 'joining');
    const role = crew[0].role;
    const same = crew.filter((c) => c.role === role);
    for (const c of same.slice(0, 2)) c.blocks = [...(c.blocks ?? []), { why: 'leave', annual: true, from: g.now + 2 * DAY, to: g.now + 6 * DAY } as never];
    const r = leaveSummary(g).rows.find((x) => x.role === role)!;
    expect(r.n).toBe(same.length);
    expect(Math.max(...r.away)).toBe(Math.min(2, same.length));
    expect(leaveCap(0.1, 24)).toBe(2);
    expect(leaveCap(0.1, 3)).toBe(1);
  });
});
