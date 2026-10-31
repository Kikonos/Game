// v0.12.1 (Round F, EV-S01 / D18 with C9): a closure that starts after crew tickets were bought left those tickets
// flying into or out of the shut airport (S1027: three Goma tickets still flown). The closure now drops them and the
// trips are re-planned on seats that exist.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import { TPL_BY_ID } from '../../data/worldEvents';
import { closedAirport, startEvent } from '../ops/world';
import { advanceTo } from '../sim';
import { touchCrew } from './timeline';

describe('a closure drops crew tickets through the shut airport (D18)', () => {
  it('the ticket home from Funchal inside the closure goes; no duty lists a missing ticket', () => {
    const g = newGame(21);
    const ac = leased(g);
    const dep = Math.ceil(g.now / DAY) * DAY + DAY + 9 * 60;
    const r = acceptOffer(g, legsOffer(g, [['LIS', 'FNC', dep], ['FNC', 'LIS', dep + 4 * DAY]]).id, [ac.id]);
    expect(r.ok).toBe(true);
    advanceTo(g, g.now + 1, new Set());
    const leg = Object.values(g.flights).find((f) => f.contractId === (r.ok ? r.data?.contractId : '') && f.to === 'FNC')!;
    const d = g.duties[leg.dutyId!];
    const crew = [...leg.crewIds];
    expect(crew.length).toBeGreaterThan(0);
    const t = addDeadhead(g, { crewIds: crew, from: 'FNC', to: 'LIS', std: leg.sta + 3 * 60, sta: leg.sta + 5 * 60, cost: 0, contractId: leg.contractId });
    d.deadheadIds.push(t.id);
    touchCrew(g);
    advanceTo(g, leg.sta + 30, new Set());
    const e = startEvent(g, { ...TPL_BY_ID.windMadeira, airportDays: [2, 2], days: [2, 2] });
    expect(closedAirport(g, 'FNC', t.std)?.id).toBe(e.id);
    expect(g.flights[t.id]?.status === 'scheduled' && g.flights[t.id].crewIds.length).toBeFalsy();
    for (const x of Object.values(g.duties)) for (const id of x.deadheadIds) expect(g.flights[id], `${x.id} lists ${id}`).toBeTruthy();
    // Whatever ticket they hold now flies once Funchal is open again.
    for (const f of Object.values(g.flights)) {
      if (f.kind !== 'deadhead' || f.status !== 'scheduled' || !crew.some((c) => f.crewIds.includes(c))) continue;
      expect(closedAirport(g, f.from, f.std) || closedAirport(g, f.to, f.sta)).toBeNull();
    }
  });
});
