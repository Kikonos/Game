// Player bot round (Nov 2026), a WRONG crew alarm of the standard bot (seed 1 --wide, 2 Apr 2027): XY3001 LHE–RUH on
// 5 Apr had no captain while Vasco Mendes sat at Kangerlussuaq with nothing until his ticket SFJ–RUH on 16 Apr, out to
// his set's Riyadh tour. The trip ends at Riyadh, so the planner did not send him back to Kangerlussuaq after it ("a
// ticket that only takes them where this trip ends is bought again"), but a set member's ticket out to their tour is
// never bought again: he was refused, "due in Kangerlussuaq for their ticket out to XY3040". The cross-check flew him
// out and back to Kangerlussuaq in time.
// Pinned: a member's ticket out to their tour is a reason to go back to where it leaves from.

import { describe, expect, it } from 'vitest';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { advanceTo } from '../sim';

const load = (): GameState => deserialize(fixture('v023-xy3001'));

describe('XY3001: a captain waiting for his ticket out to his tour takes a trip ending at the tour station', () => {
  it('is seated, and goes home after it (the tour would keep him away past the rotation)', () => {
    const g = load();
    const until = g.now + 70;
    while (g.now < until) advanceTo(g, until);
    const f = Object.values(g.flights).find((x) => x.no === 'XY3001' && x.status === 'scheduled')!;
    const vasco = Object.values(g.crew).find((c) => c.first === 'Vasco' && c.last === 'Mendes')!;
    expect(f.crewIds).toContain(vasco.id);
    expect(f.crewAlert ?? null).toBeNull();
    // v0.25 r2 (crew-awaychain): away since 14 Mar, the Riyadh tour to 23 May would keep him away 70 days, past the
    // five-week rotation. He goes home after the trip and flies out to the tour from home (was: back to Kangerlussuaq
    // for his ticket on to Riyadh).
    const tix = Object.values(g.flights).filter((x) => x.kind === 'deadhead' && x.status === 'scheduled' && x.crewIds.includes(vasco.id)).sort((a, b) => a.std - b.std);
    const home = tix.find((x) => x.std > f.std && x.to === vasco.base);
    expect(home).toBeTruthy();
    expect(tix.some((x) => x.to === 'SFJ' && x.std > f.std)).toBe(false);
    const out = tix.find((x) => x.std > home!.sta && x.from === vasco.base && x.to === 'RUH');
    if (out) expect(out.std - home!.sta).toBeGreaterThan(0);
  });
});
