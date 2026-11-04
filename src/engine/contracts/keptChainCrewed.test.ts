// v0.15.1 (integration, seed 4 AWL121): a kept empty chain the roster has crewed is never "timed for nobody". The chain's
// night at New York counts from the scheduled landing (plan.ts nextDay: release + 14 h + report), restedDeparture from
// the ETA. The moment BOG–JFK took off 11 minutes behind, the legal, crewed JFK–SFJ–SNN–LIS at 14:35 (rested 14:46) was
// re-made to leave at landing, lost its crew, and the aircraft sat six days at New York: a quarter of the year's legs.
// Without a crew the guard still holds: the move leaves after the inbound crew's rest.

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo } from '../core/entities';
import { blockMinutes, reportMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { buildDuties, restedDeparture } from '../crew/duties';
import { addCrew } from '../crew/fixtures';
import { autoRoster } from '../crew/roster';
import { relinkPositioning } from './schedule';
import { addAircraft, newGame } from './testkit';

const H = 60;

/** An A320 at Bogotá with its crewed way home (BOG–JFK, night, JFK–SFJ–SNN, night, SNN–LIS) ahead of a London job. */
function setup() {
  const g = newGame(31);
  const ac = addAircraft(g, 'a320ceo');
  ac.at = 'BOG';
  addCrew(g, { CPT: 6, FO: 6, PUR: 3, CC: 12 }, 'A320');
  const t = ac.typeId;
  const rm = reportMinutes(t);
  const turn = typeOf(t).turnMin;
  const day = Math.floor(g.now / DAY) * DAY + 4 * DAY;
  const leg = (from: string, to: string, std: number, kind: Flight['kind'] = 'positioning', pax?: number): Flight =>
    addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind, from, to, std, sta: std + blockMinutes(t, from, to), ...(pax ? { pax } : {}) });
  const night = (f: Flight): number => f.sta + rm.post + 14 * H + rm.report;
  const f0 = leg('BOG', 'JFK', day + 17 * H + 35);
  const f1 = leg('JFK', 'SFJ', night(f0));
  const f2 = leg('SFJ', 'SNN', f1.sta + turn);
  const f3 = leg('SNN', 'LIS', night(f2));
  const job = leg('LHR', 'IST', day + 8 * DAY + 14 * H + 20, 'revenue', 150);
  const f4 = leg('LIS', 'LHR', job.std - turn - blockMinutes(t, 'LIS', 'LHR'));
  buildDuties(g, ac.id, g.now, g.now + 12 * DAY);
  autoRoster(g, {});
  return { g, ac, f0, f1, f2, f3, f4, job };
}
const chainOf = (g: GameState, acId: string): Flight[] => flightsOf(g, acId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled').sort((a, b) => a.std - b.std);
const stamp = (fl: Flight[]): string => fl.map((f) => `${f.id} ${f.from}-${f.to}@${f.std}`).join(', ');
/** Off blocks, 11 minutes behind schedule (the wind). */
const depart = (g: GameState, f: Flight): void => {
  g.now = f.std + 1;
  f.status = 'enroute';
  f.atd = f.std;
  f.eta = f.sta + 11;
};

describe('v0.15.1 a crewed chain is not "timed for nobody"', () => {
  it('before: the chain is crewed and legal, a fixed point of the planner', () => {
    const { g, ac, f0, f1 } = setup();
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(f1.crewIds.length).toBeGreaterThan(0);
    expect(g.duties[f1.dutyId!].legality).not.toBe('illegal');
    expect(f1.std).toBeGreaterThan(f0.sta + 3 * H);
  });

  it('BOG–JFK takes off 11 min behind: the crewed chain out of New York stays as it is, same legs, times and crew', () => {
    const { g, ac, f0, f1 } = setup();
    const before = stamp(chainOf(g, ac.id).filter((f) => f.id !== f0.id));
    const crew = [...f1.crewIds];
    depart(g, f0);
    // The estimate now reads the crew rested 11 minutes after the chain leaves: "timed for nobody" without the crew.
    const rested = restedDeparture(g, f0)!;
    expect(rested - f1.std).toBe(11);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(stamp(chainOf(g, ac.id))).toBe(before);
    expect(f1.crewIds).toEqual(crew);
    expect(f1.status).toBe('scheduled');
  });

  it('with no crew on it, the same chain is not kept: it is re-made outside the window nobody can fly (the Kathmandu rule)', () => {
    const { g, ac, f0, f1, f2, f3, f4 } = setup();
    const before = stamp(chainOf(g, ac.id).filter((f) => f.id !== f0.id));
    for (const f of [f1, f2, f3, f4]) f.crewIds = [];
    depart(g, f0);
    const rested = restedDeparture(g, f0)!;
    relinkPositioning(g, ac.id);
    expect(stamp(chainOf(g, ac.id))).not.toBe(before);
    const out = chainOf(g, ac.id).filter((f) => f.from === 'JFK');
    expect(out.length).toBe(1);
    // Either the inbound crew carry on within 3 h of landing, or a rested crew after their rest: never in between.
    expect(out[0].std <= f0.eta! + 3 * H || out[0].std >= rested, `left ${out[0].std - f0.eta!} min after landing`).toBe(true);
  });
});
