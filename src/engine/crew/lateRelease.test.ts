// Debug round (26 Oct 2026): a duty ends at the last sector's actual on-blocks plus the post-flight duty. Before, a leg
// landing late (winds) left the duty released at its planned time, before the aircraft was on the ground: the FDP and
// the duty logged short and the crew's rest counted from too early (seed 2: XY3103 landed 17:33, crew logged off 17:20,
// then 10:40 rest at Riyadh where 14 h were due).

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { reportMinutes } from '../core/perf';
import { createGame } from '../newGame';
import { play } from '../fixtures/compatKit';
import { advanceTo } from '../sim';
import { typeIdOf } from './timeline';

describe('duty release after a late landing', () => {
  it('logs the duty to the actual on-blocks plus the post-flight duty', () => {
    const g = createGame({ name: 'Late Air', code: 'LA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 7 });
    const end = g.now + 40 * DAY;
    let late = 0;
    const seen = new Set<string>();
    while (g.now < end) {
      play(g);
      advanceTo(g, g.now + 6 * 60);
      for (const d of Object.values(g.duties)) {
        if (!d.done || seen.has(d.id)) continue;
        seen.add(d.id);
        const p = g.pairings[d.pairingId];
        const f = d.flightIds.map((id) => g.flights[id]).filter((x) => x && x.status === 'done').pop();
        if (!p || !f?.ata || !p.slots.some((s) => s.crewId)) continue;
        if (f.ata > f.sta) late++;
        expect(d.release).toBeGreaterThanOrEqual(f.ata + reportMinutes(typeIdOf(g, p)).post);
        // Every crew member's log holds the duty to that release.
        for (const s of p.slots) {
          const c = s.crewId ? g.crew[s.crewId] : undefined;
          if (c) expect(c.log.some((e) => e.start <= (f.atd ?? f.std) && e.end >= d.release)).toBe(true);
        }
      }
    }
    expect(late).toBeGreaterThan(3);
  }, 120_000);
});
