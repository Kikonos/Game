// Player bot round (Nov 2026), an invariant error ("teleport") of the player-like bot (--player seed 1, 1 Dec 2027):
// 2W7102 PMI–BUD left Palma one cabin crew short (a sick call, "fly one cabin crew short" for that sector only). The
// seat was required again for the return 2W7103 BUD–PMI, and the roster filled it with Beatriz Vieira, at Palma, buying
// back her day off: a duty under way was never checked for where a joiner is (its location check waited for the first
// leg). She was booked to leave Budapest at 15:05 from Palma.
// Pinned: a duty under way is joined where its next leg leaves, by someone there; else the seat stays honestly short.

import { describe, expect, it } from 'vitest';
import { fromUTC } from '../core/time';
import type { GameState } from '../core/types';
import { fixture } from '../fixtures/compatKit';
import { resolveDecision } from '../ops';
import { deserialize } from '../save';
import { advanceTo } from '../sim';

const load = (): GameState => deserialize(fixture('v023-2w7103'));

describe('2W7103: a seat emptied on a duty under way', () => {
  it('is never filled by someone at another airport', () => {
    const g = load();
    const end = fromUTC(2027, 12, 1, 16, 0);
    while (g.now < end) {
      advanceTo(g, Math.min(end, g.now + 60));
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    }
    const out = Object.values(g.flights).find((x) => x.no === '2W7102' && x.std > fromUTC(2027, 12, 1) && x.std < fromUTC(2027, 12, 2))!;
    const back = Object.values(g.flights).find((x) => x.no === '2W7103' && x.std > fromUTC(2027, 12, 1) && x.std < fromUTC(2027, 12, 2))!;
    const vieira = Object.values(g.crew).find((c) => c.first === 'Beatriz' && c.last === 'Vieira')!;
    expect(vieira.loc).toBe('PMI');
    expect(back.crewIds).not.toContain(vieira.id);
    // Everyone on the return flew out on 2W7102 (nobody else was at Budapest).
    for (const id of back.crewIds) expect(out.crewIds).toContain(id);
  });
});
