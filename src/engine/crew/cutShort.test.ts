// v0.12.1 (Round F, C5): a trip cancelled while its crew were on duty left them holding its ticket home from a station
// they never reached (S1118: f1zcj VRA–LIS with ten crew aboard, all at Lisbon), a false roster and timeline.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead, cancelFlight } from '../core/entities';
import { DAY } from '../core/time';
import { advanceTo } from '../sim';
import { segsOf, touchCrew } from './timeline';

describe('a trip cancelled at the gate (C5)', () => {
  it('its crew keep no ticket home from the station the leg never reached', () => {
    const g = newGame(21);
    const ac = leased(g);
    const dep = Math.ceil(g.now / DAY) * DAY + DAY + 9 * 60;
    // Out to Palma, the aircraft waiting there for the next leg days later: the crew fly home on a ticket.
    const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 4 * DAY]]).id, [ac.id]);
    expect(r.ok).toBe(true);
    advanceTo(g, g.now + 1, new Set());
    const leg = Object.values(g.flights).find((f) => f.contractId === (r.ok ? r.data?.contractId : '') && f.to === 'PMI')!;
    const d = g.duties[leg.dutyId!];
    const crew = [...leg.crewIds];
    expect(crew.length).toBeGreaterThan(0);
    // The trip's ticket home from Palma (its crew stay there; here the aircraft flies home empty without them).
    const t = addDeadhead(g, { crewIds: crew, from: 'PMI', to: 'LIS', std: leg.sta + 3 * 60, sta: leg.sta + 6 * 60, cost: 0, contractId: leg.contractId });
    d.deadheadIds.push(t.id);
    touchCrew(g);
    // Reported at Lisbon, then the leg goes.
    advanceTo(g, d.report + 10, new Set());
    for (const id of [...d.flightIds]) cancelFlight(g, g.flights[id], 'Test');
    advanceTo(g, g.now + 1, new Set());
    for (const id of crew) {
      const left = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.from === 'PMI' && f.crewIds.includes(id));
      expect(left.map((f) => f.id), g.crew[id].loc).toEqual([]);
      expect(segsOf(g, g.crew[id]).some((x) => x.kind === 'pos' && x.from === 'PMI')).toBe(false);
    }
  });
});
