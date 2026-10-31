// v0.12.1 (review): empty legs were planned out of an airport during a world closure (S1027: BLU1574 GOM–NDJ for 29 Oct
// 06:40, Goma shut to 30 Oct): a "no crew" alarm at once, cards offering "rest in Goma first", then the leg held. The
// planner now waits for the reopening (3 h after, as a held leg does) unless the aircraft flies under the event's permit.
// The empty leg next to an overdue leg from elsewhere is no longer removed and made again at every hold, and an
// aircraft's last leg flown is kept by the daily prune (it holds the permit out).

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID } from '../../data/worldEvents';
import { acceptOffer } from '.';
import { relinkPositioning } from './schedule';
import { legsOffer, newGame, owned } from './testkit';
import { addFlight, flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { closedUntil, startEvent } from '../ops/world';
import { pruneFlights } from '../ops/flights';

function tripFrom(g: GameState, acId: string, legs: [string, string, number][]) {
  if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
  const r = acceptOffer(g, legsOffer(g, legs).id, [acId]);
  if (!r.ok) throw new Error(r.error);
  return g.contracts[r.data!.contractId];
}

describe('empty legs and world closures (v0.12.1 review)', () => {
  it('an aircraft at a closed airport leaves no sooner than 3 h after the reopening', () => {
    const g = newGame(41);
    const ac = owned(g);
    ac.at = 'MAD';
    // A trip from Lisbon tomorrow, then a three-day strike at Madrid: the move out still waits for the reopening.
    const t = g.now + DAY;
    tripFrom(g, ac.id, [['LIS', 'PMI', t], ['PMI', 'LIS', t + 300]]);
    const e = startEvent(g, { ...TPL_BY_ID.airspaceIraq, id: 'madClosed', kind: 'strike', at: 'MAD', country: 'ES', zoneId: undefined, closeP: 0, airportDays: [3, 3], days: [3, 3], title: 'Strike closes Madrid', body: '' });
    const until = closedUntil(e);
    expect(until - g.now).toBeGreaterThan(2 * DAY);
    relinkPositioning(g, ac.id);
    const out = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'MAD');
    expect(out.length).toBeGreaterThan(0);
    for (const f of out) expect(f.std).toBeGreaterThanOrEqual(until + 3 * 60);
  });

  it('the empty leg out stays put while a leg from another airport is overdue (no remake at every hold)', () => {
    const g = newGame(41);
    const ac = owned(g);
    ac.at = 'MAD';
    // A ferry out of Barcelona that should have left already: the aircraft is still in Madrid.
    const fe = addFlight(g, { no: 'XX1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'BCN', to: 'LIS', std: g.now - 10, sta: g.now + 80 });
    relinkPositioning(g, ac.id);
    const first = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'MAD' && f.to === 'BCN');
    expect(first.length).toBe(1);
    // The ferry is held an hour; the leg in is the same leg, not a new one.
    fe.std += 60;
    fe.sta += 60;
    relinkPositioning(g, ac.id);
    const again = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' && f.from === 'MAD' && f.to === 'BCN');
    expect(again.map((f) => f.id)).toEqual(first.map((f) => f.id));
  });

  it("the daily prune keeps each aircraft's last leg flown", () => {
    const g = newGame(41);
    const ac = owned(g);
    for (const f of flightsOf(g, ac.id)) delete g.flights[f.id];
    const old = addFlight(g, { no: 'XX2', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'MAD', std: g.now - 12 * DAY, sta: g.now - 12 * DAY + 80 });
    old.status = 'done';
    const older = addFlight(g, { no: 'XX3', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'MAD', to: 'LIS', std: g.now - 14 * DAY, sta: g.now - 14 * DAY + 80 });
    older.status = 'done';
    pruneFlights(g);
    expect(g.flights[old.id]).toBeDefined();
    expect(g.flights[older.id]).toBeUndefined();
  });
});
