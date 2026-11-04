// v0.15.1 (seed 1, AWL127 KTM–PVG): an empty move out of a crew-change stop is never timed between the turn the ferry
// crew who flew the aircraft in could still make and the end of their rest (nobody can fly it then: a fresh crew is
// even further off at a far outstation). Pulled from 05:20 to 01:20 for the job's crew, the leg lost its crew and the
// aircraft sat at Kathmandu for eight days, Juneyao's Shanghai legs sub-chartered seven times.

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, ownFlightNo } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { flightCrewStatus, rerosterFrom } from '../crew';
import { restedDeparture } from '../crew/duties';
import { relinkPositioning } from './schedule';
import { leased, newGame, run } from './testkit';

const H = 60;

/**
 * The leased A320 lands at Kathmandu on an empty leg from Tbilisi with a crew (a ferry day), the next job leaves
 * Shanghai `jobAfterH` hours after that landing. The move on to Shanghai is planned by relink.
 */
function setup(seed: number, jobAfterH: number, to = 'XIY') {
  const g = newGame(seed);
  const ac = leased(g);
  ac.at = 'TBS';
  for (const c of Object.values(g.crew)) c.loc = 'TBS';
  const turn = typeOf(ac.typeId).turnMin;
  const std = g.now + 2 * H;
  // A ferry (hard) leg in: the planner keeps it where it is, as it keeps a leg already airborne.
  const inb = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'TBS', to: 'KTM', std, sta: std + blockMinutes(ac.typeId, 'TBS', 'KTM') });
  const jobStd = inb.sta + jobAfterH * H;
  const job = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'PVG', to, std: jobStd, sta: jobStd + blockMinutes(ac.typeId, 'PVG', to), pax: 150 });
  rerosterFrom(g, ac.id, g.now);
  expect(flightCrewStatus(g, inb.id).level).not.toBe('missing');
  return { g, ac, turn, inb, job };
}

const moveOf = (g: GameState, acId: string): Flight[] => flightsOf(g, acId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled' && f.from === 'KTM');

describe('v0.15.1 an empty move after a crew-change night stop leaves when its crew can fly it', () => {
  it('a long job the next day: the move is not pulled early for the job\'s crew into the ferry crew\'s rest', () => {
    const { g, ac, turn, inb } = setup(61, 26, 'DPS');
    run(g, inb.sta + 30);
    expect(inb.status).toBe('done');
    relinkPositioning(g, ac.id);
    const mv = moveOf(g, ac.id);
    expect(mv.length).toBeGreaterThan(0);
    const rested = restedDeparture(g, inb)!;
    expect(rested).toBeGreaterThan(inb.sta + 10 * H);
    const std = mv[0].std;
    // Either the same crew flies straight on, or they fly after their rest: nothing in the dead zone between.
    expect(std <= inb.sta + turn + 3 * H || std >= rested).toBe(true);
  });

  it('the job soon after the landing: the move waits for the rest rather than leaving with nobody', () => {
    const { g, ac, turn, inb } = setup(62, 10);
    run(g, inb.sta + 30);
    relinkPositioning(g, ac.id);
    const mv = moveOf(g, ac.id);
    expect(mv.length).toBeGreaterThan(0);
    const rested = restedDeparture(g, inb)!;
    expect(mv[0].std <= inb.sta + turn + 3 * H || mv[0].std >= rested).toBe(true);
  });
});

void DAY;
