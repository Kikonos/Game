// v0.12.1 (Round F merge, seed 6): a captain who fell sick at Düsseldorf was 'never boarded' on his ticket home (crew
// off sick or on leave do not travel), stayed there, and a new ticket home was bought every morning for a week. A
// flight home is the exception: they fly home as passengers. A flight away from home still is not.

import { describe, expect, it } from 'vitest';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { fixtureGame } from './fixtures';
import { touchCrew } from './timeline';

describe('crew off sick or on leave away from base', () => {
  it('fly home on their ticket; a ticket away from base still leaves them behind', () => {
    const g = fixtureGame(4);
    const [a, b] = Object.values(g.crew).filter((c) => c.status === 'available' && c.base === 'LIS');
    a.loc = 'DUS';
    a.awaySince = g.now - DAY;
    a.blocks = [...(a.blocks ?? []), { from: g.now, to: g.now + 4 * DAY, why: 'sick' }];
    b.blocks = [...(b.blocks ?? []), { from: g.now, to: g.now + 4 * DAY, why: 'leave' }];
    const home = addDeadhead(g, { crewIds: [a.id], from: 'DUS', to: 'LIS', std: g.now + 120, sta: g.now + 300, cost: 0, contractId: null });
    const away = addDeadhead(g, { crewIds: [b.id], from: 'LIS', to: 'FRA', std: g.now + 120, sta: g.now + 300, cost: 0, contractId: null });
    touchCrew(g);
    advanceTo(g, g.now + 360, new Set());
    expect(g.flights[home.id].status).toBe('done');
    expect(a.loc).toBe('LIS');
    expect(a.awaySince).toBeNull();
    expect(b.loc).toBe('LIS');
    expect(g.flights[away.id]?.crewIds ?? []).not.toContain(b.id);
  });
});
