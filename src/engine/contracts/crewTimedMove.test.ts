// v0.14.1 (player report, S0228 CS-TTL): an empty move into a job is timed for the crew who fly the job. Corendon moved
// AMS–VRA (A330, 10:25 block) from 08:30 to 11:30; the FRA–AMS positioning stayed at 05:45 ("on time"), and the crew of
// the trip flew both in one day: 17:40 of 12:15, after the aircraft had sat empty at Frankfurt for 49 h (2028 has a
// 29 Feb). The trip was only flagged, and slipped 60 h at the gate. Now: the move goes the evening before when one crew could fly both only with
// more crew than the job needs alone (or not at all), and the crewed duty is cut at the night's rest.

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo, retimeFlight } from '../core/entities';
import { blockMinutes, reportMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { positioningFit, restBeforeJob, type MoveLeg } from '../crew/duties';
import { restOf } from '../crew/restPlan';
import { relinkPositioning } from './schedule';
import { addAircraft, newGame } from './testkit';

const H = 60;

/** An A330 that lands at Frankfurt `idleH` before AMS–VRA leaves at `depH` UTC on day 4. */
function setup(depH: number, inH: number) {
  const g = newGame(31);
  g.company.approvals.push('widebody', 'etops120', 'augmented');
  const ac = addAircraft(g, 'a332');
  const day4 = Math.floor(g.now / DAY) * DAY + 4 * DAY;
  const inSta = day4 + inH * H;
  const blkIn = blockMinutes(ac.typeId, 'LIS', 'FRA');
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FRA', std: inSta - blkIn, sta: inSta, pax: 200 });
  const std = day4 + depH * H;
  const op = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'AMS', to: 'VRA', std, sta: std + 625, pax: 249 });
  return { g, ac, op };
}
const moveOf = (g: GameState, acId: string): Flight[] => flightsOf(g, acId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled' && f.to === 'AMS');
const legs = (fl: { from: string; to: string; std: number; sta: number }[]): MoveLeg[] => fl.map((f) => ({ from: f.from, to: f.to, std: f.std, sta: f.sta }));

describe('v0.14.1 positioning into a long sector is timed for the job crew', () => {
  it('a day before when the aircraft is idle: lands a full rest ahead of the report, not 1:50 before departure', () => {
    const { g, ac, op } = setup(11.5, -20);
    relinkPositioning(g, ac.id);
    const mv = moveOf(g, ac.id);
    expect(mv.map((f) => `${f.from}-${f.to}`)).toEqual(['FRA-AMS']);
    const gap = op.std - mv[0].sta;
    expect(gap).toBeGreaterThanOrEqual(restBeforeJob(g, ac.typeId, legs(mv), op.std));
    expect(positioningFit(g, ac.typeId, restOf(g, ac.id), legs(mv), legs([op]))).toBe(0);
    // The late move (the old plan) would have made one crew's day need in-flight rest the job alone does not.
    const late = { from: 'FRA', to: 'AMS', std: op.std - typeOf(ac.typeId).turnMin - 55, sta: op.std - typeOf(ac.typeId).turnMin };
    expect(positioningFit(g, ac.typeId, restOf(g, ac.id), [late], legs([op]))).toBeGreaterThan(0);
    // A fixed point.
    const ids = moveOf(g, ac.id).map((f) => `${f.id}@${f.std}`).join();
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(moveOf(g, ac.id).map((f) => `${f.id}@${f.std}`).join()).toBe(ids);
  });

  it('a kept move left early by a later departure (Corendon +3 h) is retimed, the same leg', () => {
    const { g, ac, op } = setup(11.5, -20);
    relinkPositioning(g, ac.id);
    const mv = moveOf(g, ac.id)[0];
    // As it stood in the save: FRA–AMS 05:45–06:40 on the day, AMS–VRA at 11:30.
    const t = op.std - 5 * H - 45;
    retimeFlight(g, mv, t, t + 55);
    expect(positioningFit(g, ac.typeId, restOf(g, ac.id), legs([mv]), legs([op]))).toBe(2);
    relinkPositioning(g, ac.id);
    const now = moveOf(g, ac.id);
    expect(now.map((f) => f.id)).toEqual([mv.id]);
    expect(op.std - now[0].sta).toBeGreaterThanOrEqual(restBeforeJob(g, ac.typeId, legs(now), op.std));
  });

  it('no room the day before: the move stays late, one crew with in-flight rest', () => {
    // In at 04:20, out at 11:30 the same day: 7 h on the ground.
    const { g, ac, op } = setup(11.5, 4 + 20 / 60);
    relinkPositioning(g, ac.id);
    const mv = moveOf(g, ac.id);
    expect(mv.length).toBe(1);
    expect(op.std - mv[0].sta).toBeLessThanOrEqual(typeOf(ac.typeId).turnMin + 30);
    expect(positioningFit(g, ac.typeId, restOf(g, ac.id), legs(mv), legs([op]))).toBe(1);
    const rm = reportMinutes(ac.typeId);
    expect(op.sta - (mv[0].std - rm.report)).toBeLessThanOrEqual(17 * H);
  });
});
