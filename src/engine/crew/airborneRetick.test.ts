// v0.14.1 (CREW-6, bot seed 7 AT1060) a trip re-planned while its crew are in the air on their ticket out never buys
// them a second ticket out from the city they just left: that ticket lands them at the departure. Before, the
// duplicate made the re-check read them as 'At CMN, not LIS for the ticket to CMN', the whole crew came off the trip
// and a red alarm fired in the night while they slept at the departure.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { advanceTo } from '../sim';
import { acceptable, openDuties, planCrew } from './check';
import { buildDuties } from './duties';
import { fixtureGame } from './fixtures';
import { autoRoster } from './roster';
import { segsOf } from './timeline';

const ticketsTo = (g: GameState, crewId: string, to: string): Flight[] =>
  Object.values(g.flights).filter((t) => t.kind === 'deadhead' && t.status === 'scheduled' && t.to === to && t.crewIds.includes(crewId));

describe('v0.14.1 crew in the air on their ticket out', () => {
  it('a trailing empty leg absorbed into their duty re-plans only the way home', () => {
    const g = fixtureGame();
    const ac = Object.values(g.fleet)[0];
    ac.at = 'OPO';
    const std = Math.floor(g.now / DAY) * DAY + DAY + 14 * 60;
    const f = addFlight(g, { no: 'AW1060', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'OPO', to: 'FAO', std, sta: std + 70 });
    autoRoster(g, {});
    const d = g.duties[f.dutyId!];
    const p = g.pairings[d.pairingId];
    const crew = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
    expect(crew.length).toBeGreaterThan(0);
    const out = openDuties(g, p)[0].deadheadIds.map((id) => g.flights[id]).find((t) => t?.kind === 'deadhead' && t.to === 'OPO' && t.sta <= d.report);
    expect(out).toBeDefined();
    // In the air on it.
    advanceTo(g, out!.std + 10);
    expect(g.flights[out!.id].status).toBe('scheduled');
    expect(g.now).toBeLessThan(out!.sta);
    // The aircraft gets an empty leg home right after the job: the duty's crew take it, their tickets re-planned.
    const pos = addFlight(g, { no: 'AW1061', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'FAO', to: 'LIS', std: f.sta + 45, sta: f.sta + 45 + 60 });
    buildDuties(g, ac.id, g.now, g.now + 3 * DAY);
    expect(g.duties[f.dutyId!].flightIds).toContain(pos.id);
    for (const id of out!.crewIds) {
      expect(ticketsTo(g, id, 'OPO').map((t) => t.id)).toEqual([out!.id]);
      expect(acceptable(g, planCrew(g, g.crew[id], p, segsOf(g, g.crew[id], p.id), true))).toBe(true);
    }
  });
});
