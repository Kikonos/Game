// v0.17.2 player's report (bug bmw5r4e4p6hpq): the crew who flew TRN–GRU stayed a night in São Paulo and flew home on an
// airline ticket the next evening, while our own empty GRU–LIS left 48 min after they landed. "They should hitch a ride
// back to LIS." Crew now ride our empty legs home as well as our passenger flights: straight on from the gate (the whole
// cabin to sleep in; positioning after the last sector is duty, not FDP), or after their rest.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { addAircraft, legsOffer, newGame, run } from '../contracts/testkit';
import { cancelFlight } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { addCrew } from './fixtures';
import { evalSegs } from './rules';
import { ctxOf, RIDE_EMPTY_DAY, segsOf } from './timeline';

/** An A330 one-way charter LIS–GRU on day 3 at 08:00: the aircraft comes home empty with two ferry pilots. */
function saoPaulo(): { g: GameState; k: string; job: Flight; home: Flight } {
  const g = newGame(31);
  g.company.approvals.push('widebody', 'etops120', 'etops180', 'augmented');
  addCrew(g, { CPT: 5, FO: 5, PUR: 3, CC: 24 }, 'A330/340');
  const ac = addAircraft(g, 'a332');
  const o = legsOffer(g, [['LIS', 'GRU', Math.floor(g.now / DAY) * DAY + 3 * DAY + 8 * 60]]);
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const k = r.data!.contractId;
  const fl = Object.values(g.flights).filter((f) => f.contractId === k);
  const job = fl.find((f) => f.kind === 'revenue')!;
  const home = fl.find((f) => f.kind === 'positioning' && f.from === 'GRU')!;
  return { g, k, job, home };
}

describe('v0.17.2 crew ride our empty legs home', () => {
  it('the crew who flew LIS–GRU ride the empty GRU–LIS home straight on, not an airline the next night', () => {
    const { g, job, home } = saoPaulo();
    run(g, job.std - 60);
    const crew = [...job.crewIds];
    expect(crew.length).toBeGreaterThan(2);
    // Their way home is our own empty leg: no airline ticket GRU–LIS.
    expect(home.riders ?? []).toEqual(expect.arrayContaining(crew));
    expect(Object.values(g.flights).some((f) => f.kind === 'deadhead' && f.from === 'GRU' && f.to === 'LIS' && f.status !== 'cancelled')).toBe(false);
    const d = g.duties[job.dutyId!];
    expect(d.deadheadIds).toContain(home.id);
    // Straight on from the gate, the day to landing home within RIDE_EMPTY_DAY, every crew member legal.
    expect(home.std - d.release).toBeLessThanOrEqual(3 * 60);
    expect(home.sta - d.report).toBeLessThanOrEqual(RIDE_EMPTY_DAY);
    for (const id of crew) expect(evalSegs(ctxOf(g, g.crew[id]), segsOf(g, g.crew[id])).filter((i) => i.level === 'illegal')).toEqual([]);
    run(g, home.sta + 3 * 60);
    expect(home.status).toBe('done');
    for (const id of crew) expect(g.crew[id].loc).toBe('LIS');
  });

  it('the empty leg cancelled: its riders get a way home at once', () => {
    const { g, job, home } = saoPaulo();
    run(g, g.duties[job.dutyId!].release + 5);
    const riders = [...(home.riders ?? [])];
    expect(riders.length).toBeGreaterThan(2);
    cancelFlight(g, home);
    run(g, g.now + 60);
    for (const id of riders) expect(wayHome(g, id)).toBe(true);
  });

  it('cancelled while the crew still fly the job: the trip re-plans their way home', () => {
    const { g, job, home } = saoPaulo();
    run(g, job.sta - 60);
    const riders = [...(home.riders ?? [])];
    expect(riders.length).toBeGreaterThan(2);
    cancelFlight(g, home);
    run(g, g.duties[job.dutyId!].release + 60);
    for (const id of riders) expect(wayHome(g, id)).toBe(true);
  });
});

/** A ticket or a ride GRU–LIS still to fly (or flying) for crew member id. */
const wayHome = (g: GameState, id: string): boolean =>
  Object.values(g.flights).some((f) => f.from === 'GRU' && f.to === 'LIS' && (f.status === 'scheduled' || f.status === 'enroute') && (f.kind === 'deadhead' ? f.crewIds.includes(id) : !!f.riders?.includes(id)));
