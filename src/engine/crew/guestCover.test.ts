// v0.25 crew-guestfix (bot seed 11, Vilnius, 3 Jul 2027): VJ723 SGN–CGK on 4 Jul carried a red 'crew out of hours' alarm
// for 47 h: its purser had worked six hotel standby days in a row at Saigon and would go past 168 h without a 36 h rest,
// while a purser of another set on station was free. The re-check judged the purser 'prior work only' without those
// standby days (they read as later work, since the tour began before them) and found her legal, so nobody acted until
// the gate. Work already begun is history: the duty goes back to the deployment's planner and another set flies it.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { resolveDecision } from '../ops';
import { deserialize } from '../save';
import { advanceTo } from '../sim';
import { flightCrewStatus } from './index';

describe('VJ723: a seat out of hours is re-crewed before the gate', () => {
  it('another set on station flies it; no red alarm', () => {
    const g = deserialize(fixture('v0242-vj723'));
    const n0 = g.messages.length;
    const f = Object.values(g.flights).filter((x) => x.no === 'VJ723' && x.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
    const laura = Object.values(g.crew).find((c) => c.first === 'Laura' && c.last === 'Urbonaitė')!;
    // Up to 4 Jul 03:00, before the gate's own check (2 h before the 05:15 report).
    const end = f.std - 3 * 60 - 15;
    while (g.now < end) {
      for (const d of [...g.decisions]) if (d.expires <= g.now + 60) resolveDecision(g, d.id, d.defaultOption);
      advanceTo(g, Math.min(end, g.now + 60), new Set());
    }
    const d = g.duties[g.flights[f.id].dutyId!];
    const crew = g.pairings[d.pairingId].slots.filter((s) => !s.above).map((s) => s.crewId);
    expect(crew.every(Boolean)).toBe(true);
    expect(crew).not.toContain(laura.id);
    expect(['ok', 'tight']).toContain(flightCrewStatus(g, f.id).level);
    expect(g.messages.slice(0, g.messages.length - n0).some((m) => m.title.includes('VJ723') && /OUT OF HOURS|out of hours/.test(m.title))).toBe(false);
  });
});
