// Debug round (26 Oct 2026): a bot game (seed 3, saved 25 Oct) whose A320 CS-TBL is AOG at Riyadh. Fixed by the
// engineering team at 05:21 the next morning, it is late for its next job in London. The empty move out of Riyadh was
// planned to leave at once with no crew there: its departure re-rostered, the gap re-planned the same leg anew at the
// same minute with a fresh red crew alarm and pause, and the clock never moved on (Play paused again at once).

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { safetyTrips } from '../core/safety';
import { resolveDecision } from '../ops';
import { deserialize } from '../save';
import { advanceTo, settle } from '../sim';

describe('relink: a late empty move waits for a crew', () => {
  it('the clock gets past the AOG fix without a pause loop', () => {
    const g = deserialize(fixture('v011-relink'));
    const t0 = g.now;
    const end = t0 + 36 * 60;
    let calls = 0;
    const trips = safetyTrips.length;
    // As the bot plays it: 6-hour steps, the AOG fixed by a team, other decisions by default.
    while (g.now < end && calls < 60) {
      calls++;
      const grid = g.started + (Math.floor((g.now - g.started) / 360) + 1) * 360;
      advanceTo(g, Math.min(end, grid));
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.kind === 'aog' && d.options.some((o) => o.id === 'team') ? 'team' : d.defaultOption);
      settle(g);
    }
    expect(g.now).toBe(end);
    expect(calls).toBeLessThan(20);
    expect(safetyTrips.length).toBe(trips);
    const reds = g.messages.filter((m) => m.t > t0 && /^CREW SHORTAGE/.test(m.title));
    expect(reds.length).toBeLessThan(4);
  }, 60_000);
});
