// Debug round (26 Oct 2026): a standby window is kept where the crew member will be. A bot game (seed 1, 2 Apr):
// cabin crew member Rita Mendes went home sick from the Dublin deployment and kept her hotel standbys at Dublin
// (3, 7 and 8 Apr) while at home in Lisbon; the day planner now drops such windows and plans the day where she is.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { DAY } from '../core/time';
import { deserialize } from '../save';
import { advanceTo } from '../sim';

describe('standby where the crew are', () => {
  it('no running standby window at a station the crew member is not at', () => {
    const g = deserialize(fixture('v011-standby'));
    const end = g.now + 8 * DAY;
    const bad: string[] = [];
    while (g.now < end) {
      advanceTo(g, g.now + 60);
      for (const c of Object.values(g.crew)) {
        const w = c.standby?.find((x) => x.from <= g.now && g.now < x.to && x.calledAt === undefined);
        if (w && c.status !== 'onDuty' && (w.at ?? c.base) !== c.loc) bad.push(`${c.first} ${c.last} ${w.kind ?? 'home'} at ${w.at ?? c.base}, is at ${c.loc}`);
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  }, 120_000);
});
