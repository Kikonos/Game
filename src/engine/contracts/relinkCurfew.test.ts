// v0.14.1 hunt 2, OPS lane: the empty-move planner and night curfews (OPS-3, OPS-4), the move home before a check
// (OPS-5), and the crewed ferry home that a 4-min ETA slip re-made with no crew (CREW-1).

import { describe, expect, it } from 'vitest';
import { addFlight, flightsOf, nextId, ownFlightNo, retimeFlight } from '../core/entities';
import { curfewOk } from '../core/curfew';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, fromUTC } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { acceptOffer } from '.';
import { chainBackward, CURFEW_PAD } from './plan';
import { relinkPositioning } from './schedule';
import { leased, legsOffer, newGame } from './testkit';

const H = 60;
const pos = (g: GameState, acId: string): Flight[] => flightsOf(g, acId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled');

describe('OPS-3: an empty move clears a curfew the same morning when the slack allows', () => {
  // 3 Mar 2028: Heathrow on GMT, quota curfew 23:30–06:00 UTC. A 07:00 departure; a charter's 30 min slack before the turn.
  const dep = fromUTC(2028, 3, 3, 7, 0);
  const turn = typeOf('a320ceo').turnMin;

  it('lands at the curfew end inside the slack, not 23:29 the evening before', () => {
    const ch = chainBackward('a320ceo', 'PRG', 'LHR', dep - 2 * DAY, dep - turn - 30, Infinity, Infinity, 30)!;
    expect(ch).toBeTruthy();
    const land = ch[ch.length - 1].sta;
    expect(curfewOk('LHR', land)).toBe(true);
    expect(land).toBeGreaterThanOrEqual(fromUTC(2028, 3, 3, 6, 0));
    expect(land).toBeLessThanOrEqual(dep - turn);
  });

  it('moved to the evening before, it lands half an hour before the curfew starts', () => {
    const ch = chainBackward('a320ceo', 'PRG', 'LHR', dep - 2 * DAY, dep - turn - 30)!;
    expect(ch[ch.length - 1].sta).toBeLessThanOrEqual(fromUTC(2028, 3, 2, 23, 30) - CURFEW_PAD);
  });

  it('relink: the move into a charter at Heathrow flies the same morning', () => {
    const { g, ac, job } = lhrJob();
    const mv = pos(g, ac.id).filter((f) => f.to === 'LHR');
    expect(mv.length).toBe(1);
    expect(curfewOk('LHR', mv[0].sta)).toBe(true);
    // The same morning (not the night before), a turn before the job.
    expect(job.std - mv[0].sta).toBeLessThan(3 * H);
    expect(job.std - mv[0].sta).toBeGreaterThanOrEqual(typeOf(ac.typeId).turnMin);
  });
});

/** A320 at Prague (landed the day before at noon), a charter LHR–BJV leaving 07:00 UTC on 4 Mar 2027 (GMT). */
function lhrJob() {
  const g = newGame(41);
  const ac = leased(g);
  const day = Math.floor(g.now / DAY) * DAY + 3 * DAY;
  const blk = blockMinutes(ac.typeId, 'LIS', 'PRG');
  addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'PRG', std: day - 12 * H - blk, sta: day - 12 * H, pax: 150 });
  const r = acceptOffer(g, legsOffer(g, [['LHR', 'BJV', day + 7 * H]]).id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const job = flightsOf(g, ac.id).find((f) => f.kind === 'revenue' && f.from === 'LHR')!;
  return { g, ac, job };
}

describe('OPS-4: a kept empty leg inside a curfew is planned again', () => {
  it('a move landing at Heathrow 05:50 (from an old save) is re-planned clear of the curfew', () => {
    const { g, ac, job } = lhrJob();
    const mv = pos(g, ac.id).find((f) => f.to === 'LHR')!;
    const blk = mv.sta - mv.std;
    const sta = job.std - 70; // 05:50 UTC: inside the LHR ban (to 06:00)
    retimeFlight(g, mv, sta - blk, sta);
    expect(curfewOk('LHR', mv.sta)).toBe(false);
    relinkPositioning(g, ac.id);
    const now = pos(g, ac.id).filter((f) => f.to === 'LHR');
    expect(now.length).toBe(1);
    expect(curfewOk('LHR', now[0].sta)).toBe(true);
    expect(curfewOk(now[0].from, now[0].std)).toBe(true);
    // Retimed, the same leg (its crew kept), and a fixed point.
    expect(now[0].id).toBe(mv.id);
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
  });
});

describe('OPS-5: before a check at home, a long wait away is spent at home', () => {
  it('flies home right after the last job, not 13 days later at night', () => {
    const g = newGame(43);
    const ac = leased(g);
    const day = Math.floor(g.now / DAY) * DAY + 2 * DAY;
    const blk = blockMinutes(ac.typeId, 'LIS', 'PRG');
    const inb = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'PRG', std: day + 10 * H, sta: day + 10 * H + blk, pax: 150 });
    const start = day + 14 * DAY + 5 * H;
    const id = nextId(g, 'm');
    g.maintenance[id] = { id, aircraftId: ac.id, kind: 'A', at: 'LIS', start, end: start + DAY, cost: 0, status: 'planned', planned: true, ev: 0 };
    relinkPositioning(g, ac.id);
    const home = pos(g, ac.id).filter((f) => f.from === 'PRG' && f.to === 'LIS');
    expect(home.length).toBe(1);
    expect(home[0].std - inb.sta).toBeLessThan(DAY);
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
  });
});

describe('CREW-1: a few minutes of ETA slip retime the crewed ferry home, whatever job each leg is tagged to', () => {
  it('FCO–LIS (the pilgrimage) then LIS–AMS (the next job, 13 days on): the ferry home keeps its id and its job', () => {
    const g = newGame(44);
    const ac = leased(g);
    const dep = Math.floor(g.now / DAY) * DAY + 3 * DAY + 10 * H + 45;
    const r1 = acceptOffer(g, legsOffer(g, [['LIS', 'FCO', dep]]).id, [ac.id]);
    if (!r1.ok) throw new Error(r1.error);
    const r2 = acceptOffer(g, legsOffer(g, [['AMS', 'AYT', dep + 13 * DAY]]).id, [ac.id]);
    if (!r2.ok) throw new Error(r2.error);
    const k1 = r1.data!.contractId as string;
    const a = flightsOf(g, ac.id).find((f) => f.kind === 'revenue' && f.to === 'FCO')!;
    const ferry = pos(g, ac.id).find((f) => f.from === 'FCO')!;
    expect(ferry?.to).toBe('LIS');
    expect(ferry.contractId).toBe(k1);
    const out = pos(g, ac.id).find((f) => f.from === 'LIS' && f.to === 'AMS')!;
    expect(out).toBeTruthy();
    expect(out.contractId).not.toBe(k1);
    const turn = typeOf(ac.typeId).turnMin;
    // Planned straight after the inbound (its crew's day carries it).
    expect(ferry.std).toBeLessThanOrEqual(a.sta + turn + 5);
    const std0 = ferry.std;
    const outStd = out.std;
    // The pilgrimage leaves; its ETA slips 4 min past the ferry's planned departure.
    g.now = a.std + 1;
    a.status = 'enroute';
    a.atd = a.std;
    a.eta = ferry.std - turn + 4;
    relinkPositioning(g, ac.id);
    const now = pos(g, ac.id).filter((f) => f.from === 'FCO');
    expect(now.map((f) => f.id)).toEqual([ferry.id]);
    expect(now[0].contractId).toBe(k1);
    expect(now[0].std).toBeGreaterThanOrEqual(a.eta + turn);
    expect(now[0].std - std0).toBeLessThanOrEqual(10);
    // The move out to the next job, days later, stays as it was.
    expect(g.flights[out.id]?.std).toBe(outStd);
  });
});
