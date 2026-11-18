// v0.25 crew-sethome (the player's save): Crew › People read 'Set 3 at London · 2 of 16 days · home 1 Aug 2027' while
// the set flew out on 4 Aug and home on 10 Aug: 'home 1 Aug' was an FO's Nantes–Malta ticket from an earlier trip, and
// the day count ran from the period's start, before the set arrived. Pinned: only a ticket home out of the station (or
// one after the set's first duty) is the set's way home; the days count from its arrival.

import { describe, expect, it } from 'vitest';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { deploymentSets } from './tours';
import { touchCrew } from './timeline';

describe('the sets on station', () => {
  it('ignore a ticket home of an earlier trip, from elsewhere, before the set starts', () => {
    const g = deserialize(fixture('v0221-riyadh'));
    const line = deploymentSets(g).find((l) => l.set === 1)!;
    const dep = g.deployments[line.deploymentId];
    const parts = dep.pairingIds.map((id) => g.pairings[id]).filter((p) => p?.tour?.set === 1);
    // The set's duties move three weeks later (it has not started yet).
    for (const p of parts) for (const id of p.dutyIds) if (g.duties[id]) g.duties[id].report += 21 * DAY;
    const member = parts.flatMap((p) => p.slots).find((s) => s.crewId && !s.guest)!.crewId!;
    const home0 = deploymentSets(g).find((l) => l.set === 1)!.home;
    addDeadhead(g, { crewIds: [member], from: 'NTE', to: g.company.homeBase, std: g.now + 60, sta: g.now + 200, cost: 0 });
    touchCrew(g);
    const after = deploymentSets(g).find((l) => l.set === 1)!;
    expect(after.home).toBe(home0);
    expect(after.home).toBeGreaterThan(g.now + 60);
  });
});
