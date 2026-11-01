// v0.14.1 (h-crew suspect, S1027 Goma) a captain off in Goma for 90 h read as 'At LIS, not GOM' and 'due a weekly
// rest (36 h off) first' for a trip out of Goma: his loose ticket home from Goma two days later (bought for after the
// airport reopened) stayed in his plan after the trip took him to N'Djamena and home from there. A later ticket home
// from the departure that the trip makes useless is dropped with the trip, as one the same day already was.

import { describe, expect, it } from 'vitest';
import { addDeadhead, addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { planCrew } from './check';
import { buildDuties } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { segsOf, touchCrew } from './timeline';

describe('v0.14.1 a stale ticket home from the departure', () => {
  it('is dropped by a trip that ends elsewhere: no location break, no recovery break', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'GOM';
    const std = Math.floor(g.now / DAY) * DAY + DAY + 8 * 60;
    addFlight(g, { no: 'AW1573', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'GOM', to: 'NDJ', std, sta: std + 195 });
    const [id] = addCrew(g, { CPT: 1 });
    const c = g.crew[id];
    c.loc = 'GOM';
    c.awaySince = g.now - 3 * DAY;
    c.restUntil = g.now - 2 * DAY;
    c.off = [];
    delete c.standby;
    // His way home, bought for two days after the trip: Goma–Lisbon.
    const t = addDeadhead(g, { crewIds: [id], from: 'GOM', to: 'LIS', std: std + 2 * DAY, sta: std + 2 * DAY + 9 * 60, cost: 900 });
    touchCrew(g);
    const d = buildDuties(g, ac.id, g.now, g.now + 3 * DAY)[0];
    const p = g.pairings[d.pairingId];
    const plan = planCrew(g, c, p, segsOf(g, c, p.id));
    expect(plan.issues.filter((i) => i.level === 'illegal')).toEqual([]);
    expect(plan.drop).toContain(t.id);
    expect(plan.home?.from).toBe('NDJ');
  });
});
