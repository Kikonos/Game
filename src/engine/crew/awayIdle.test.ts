// v0.12.1 (Round F, C1): crew left at an outstation sat there for 11-14 days (S1027: a captain in Frankfurt, an FO in
// Manchester), because the ticket out of there for their next trip, bought from where they were, read as "a ticket from
// where they are takes them on". A trip days ahead no longer keeps them away: they go home, and that trip's ticket out is
// bought from base. A trip leaving soon after their rest still keeps them at the hotel.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, legsOffer, newGame } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import type { CrewMember, Flight, GameState, Pairing } from '../core/types';
import { advanceTo } from '../sim';
import { openDuties } from './check';
import { recheckPairing, sendStrandedHome } from './roster';
import { crewIx, touchCrew } from './timeline';

const ticketsOf = (g: GameState, id: string): Flight[] =>
  Object.values(g.flights).filter((f) => f.status === 'scheduled' && (f.kind === 'deadhead' ? f.crewIds : f.riders ?? []).includes(id));

/**
 * A FRA–PMI–FRA charter `hours` ahead, crewed from base (the aircraft positions LIS–FRA with them); one of its FOs is
 * then left at HAM with the trip's ticket out of there (to base, for the positioning leg).
 */
function setup(hours: number): { g: GameState; c: CrewMember; p: Pairing } {
  const g = newGame(21);
  const ac = leased(g);
  const t0 = Math.ceil(g.now / DAY) * DAY + 8 * 60;
  const dep = t0 + hours * 60;
  const r = acceptOffer(g, legsOffer(g, [['FRA', 'PMI', dep], ['PMI', 'FRA', dep + 4 * 60]]).id, [ac.id]);
  expect(r.ok).toBe(true);
  advanceTo(g, g.now + 1, new Set());
  const leg = Object.values(g.flights).find((f) => f.contractId === (r.ok ? r.data?.contractId : '') && f.from === 'FRA' && f.to === 'PMI')!;
  const p = g.pairings[g.duties[leg.dutyId ?? '']?.pairingId ?? ''];
  expect(p, 'a crewed trip').toBeDefined();
  const c = g.crew[p.slots.find((s) => s.crewId && g.crew[s.crewId]?.role === 'FO')!.crewId!];
  // Left at Hamburg (a trip that ended there), rested, nothing else planned: the ticket out to FRA is re-bought from HAM.
  c.loc = 'HAM';
  c.restUntil = g.now - 60;
  delete c.standby;
  const d0 = openDuties(g, p)[0];
  const at = g.flights[d0.flightIds[0]].from;
  const t = addDeadhead(g, { crewIds: [c.id], from: 'HAM', to: at, std: d0.report - 4 * 60, sta: d0.report - 2 * 60, cost: 0, contractId: p.contractId });
  d0.deadheadIds.push(t.id);
  touchCrew(g);
  return { g, c, p };
}

describe('crew left at an outstation (C1)', () => {
  it('go home when their next trip is days ahead, and fly out to it from base', () => {
    const { g, c, p } = setup(10 * 24);
    sendStrandedHome(g);
    const mine = ticketsOf(g, c.id);
    const home = mine.find((f) => f.from === 'HAM' && f.to === c.base);
    expect(home, 'a ticket home').toBeDefined();
    expect(home!.std - g.now).toBeLessThan(DAY);
    // Nothing else leaves Hamburg any more: the trip is flown from base (its ticket out, if it needs one, from there).
    expect(mine.some((f) => f.from === 'HAM' && f.to !== c.base)).toBe(false);
    expect(recheckPairing(g, p).illegal).not.toContain(c.id);
    // Still on the trip.
    expect(p.slots.some((s) => s.crewId === c.id)).toBe(true);
    expect(crewIx(g).ticketDuty.get(home!.id)).toBeUndefined();
  });

  it('stay at the hotel when the trip leaves within a day of their rest', () => {
    const { g, c } = setup(20);
    const before = ticketsOf(g, c.id).map((f) => `${f.from}-${f.to}`).sort();
    sendStrandedHome(g);
    expect(ticketsOf(g, c.id).map((f) => `${f.from}-${f.to}`).sort()).toEqual(before);
    // No second ticket home: the trip's own ticket out of Hamburg stays theirs.
    expect(ticketsOf(g, c.id).filter((f) => f.from === 'HAM').every((f) => crewIx(g).ticketDuty.has(f.id))).toBe(true);
  });
});
