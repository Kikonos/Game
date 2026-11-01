// v0.14.1 (merge) the airspace-closed card: a title that starts with a capital (the zone's adjective can be lowercase:
// 'eastern Congolese'), and a hurt line that answers first, 'No:' when none of our legs is touched, 'Yes:' when some are.

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID } from '../../data/worldEvents';
import { newGame } from '../contracts/testkit';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import { startEvent } from '../ops/world';
import { airspaceClosedCard } from './world';

describe('v0.14.1 airspace closed card', () => {
  it('reads "Eastern Congolese airspace is closed" and "No: …" with nothing of ours held', () => {
    const g = newGame(3);
    const e = startEvent(g, { ...TPL_BY_ID.unrestGoma, closeP: 1 })!;
    expect(e.closed).toBe(true);
    const k = airspaceClosedCard(g, e.id)!;
    expect(k.title).toBe('Eastern Congolese airspace is closed');
    expect(k.hurt.text).toMatch(/^No: /);
  });
  it('reads "Yes: 1 leg held …" when one of our legs waits for it', () => {
    const g = newGame(3);
    const e = startEvent(g, { ...TPL_BY_ID.unrestGoma, closeP: 1 })!;
    const ac = Object.values(g.fleet)[0];
    const f = addFlight(g, { no: 'AW100', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'KGL', std: g.now + DAY, sta: g.now + DAY + 480 });
    f.closedBy = e.id;
    expect(airspaceClosedCard(g, e.id)!.hurt.text).toMatch(/^Yes: 1 leg held, 0 rerouted/);
  });
});
