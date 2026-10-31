// v0.12.1 (Round F, Round B leftover): both player saves warned "duty du1jfo lists missing ticket f10t3": an empty
// positioning leg carrying riders was removed by the relink (it is often flown again under a new id) and the duties of
// its riders kept listing it. A ride gone comes off every duty that listed it, and a load repairs old saves.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead, addFlight, removeFlights } from '../core/entities';
import { DAY } from '../core/time';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { openDuties } from './check';
import { noteRiders, touchCrew } from './timeline';

function withRide() {
  const g = newGame(21);
  const ac = leased(g);
  const dep = Math.ceil(g.now / DAY) * DAY + 3 * DAY + 8 * 60;
  const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['PMI', 'LIS', dep + 4 * 60]]).id, [ac.id]);
  expect(r.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const p = Object.values(g.pairings).find((q) => q.aircraftId === ac.id && q.status === 'planned' && q.slots.some((s) => s.crewId) && openDuties(g, q).some((d) => d.flightIds.some((id) => g.flights[id]?.to === 'PMI')))!;
  const d = openDuties(g, p)[0];
  const id = p.slots.find((s) => s.crewId)!.crewId!;
  // An empty leg of another aircraft the crew member rides out on.
  const other = Object.values(g.fleet).find((a) => a.id !== ac.id)!;
  const leg = addFlight(g, { no: 'AW900', aircraftId: other.id, contractId: null, kind: 'positioning', from: 'LIS', to: 'PMI', std: d.report - 5 * 60, sta: d.report - 3 * 60 });
  leg.riders = [id];
  noteRiders(g, leg);
  d.deadheadIds.push(leg.id);
  touchCrew(g);
  return { g, d, leg };
}

describe('a ride on an empty leg that is removed (Round B leftover)', () => {
  it('comes off the duties that listed it', () => {
    const { g, d, leg } = withRide();
    advanceTo(g, g.now + 1, new Set());
    removeFlights(g, [leg.id]);
    advanceTo(g, g.now + 1, new Set());
    expect(d.deadheadIds).not.toContain(leg.id);
    for (const x of Object.values(g.duties)) if (!x.done) for (const fid of x.deadheadIds) expect(g.flights[fid], `${x.id} lists ${fid}`).toBeDefined();
  });

  it('an old save listing a ride already gone is repaired on load', () => {
    const { g, d, leg } = withRide();
    delete g.flights[leg.id];
    const h = deserialize(serialize(g));
    expect(h.duties[d.id].deadheadIds).not.toContain(leg.id);
  });

  it('a flown ticket pruned while its duty is still open comes off it too (S1027 duqdx / f1gl0)', () => {
    const { g, d } = withRide();
    const t = addDeadhead(g, { crewIds: [], from: 'LIS', to: 'PMI', std: g.now - 3 * DAY, sta: g.now - 3 * DAY + 150, cost: 0 });
    t.status = 'done';
    d.deadheadIds.push(t.id);
    touchCrew(g);
    removeFlights(g, [t.id]);
    advanceTo(g, g.now + 1, new Set());
    expect(d.deadheadIds).not.toContain(t.id);
  });
});
