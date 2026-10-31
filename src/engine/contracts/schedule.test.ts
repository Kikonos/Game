// Base patterns, flight generation, rolling extension and positioning (B1).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY, fromUTC, localMinuteOfDay, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer, planPositioning } from '.';
import { baseDays, chainBackward, chainForward, computeWaves, flownRotations, gapMoves, localToUTC, type BasePattern } from './plan';
import { curfewOk } from '../core/curfew';
import { hamBase, leased, legsOffer, newGame, offer, owned, run } from './testkit';
import { relinkPositioning } from './schedule';
import { anchorsOf } from './plan';

const liveFlights = (g: GameState, id: string) => flightsOf(g, id).filter((f) => f.status !== 'cancelled');

function turnsOk(g: GameState, id: string) {
  const turn = typeOf(g.fleet[id].typeId).turnMin;
  const fl = liveFlights(g, id);
  for (let i = 1; i < fl.length; i++) {
    const gap = fl[i].std - fl[i - 1].sta;
    // Fuel stops on one sector use the shorter tech-stop ground time.
    if (fl[i].kind === 'techstop') expect(gap).toBeGreaterThanOrEqual(45);
    else expect(gap).toBeGreaterThanOrEqual(turn);
    expect(fl[i].from).toBe(fl[i - 1].to);
  }
}

describe('wave times', () => {
  it('HAM–PMI on an A320: 06:00 / 12:30 / 19:00 local, or the first two', () => {
    expect(computeWaves('HAM', ['PMI'], 'a320ceo', 3)).toEqual([360, 750, 1140]);
    expect(computeWaves('HAM', ['PMI'], 'a320ceo', 2)).toEqual([360, 750]);
  });
  it('long rotations get fewer waves instead of colliding', () => {
    const w = computeWaves('HAM', ['TFS'], 'a320ceo', 3);
    expect(w.length).toBeLessThan(3);
  });
});

describe('v0.12.1 night curfews in the empty-move planner (A7)', () => {
  const day = (code: string, hh: number, mm = 0, d = 10) => localToUTC(code, (Math.floor(fromUTC(2027, 2, 1) / DAY) + d) * DAY + hh * 60 + mm);
  it('backward: a move that would land in the Heathrow night lands before it starts', () => {
    const latest = day('LHR', 5, 30);
    const ch = chainBackward('a320ceo', 'LIS', 'LHR', latest - DAY, latest)!;
    expect(ch).not.toBeNull();
    for (const l of ch) expect(curfewOk(l.from, l.std) && curfewOk(l.to, l.sta)).toBe(true);
    expect(localMinuteOfDay('LHR', ch[ch.length - 1].sta)).toBeLessThan(23 * 60 + 30);
    // No room before the curfew: no backward move (the planner then flies it forward, late).
    expect(chainBackward('a320ceo', 'LIS', 'LHR', latest - 3 * 60, latest)).toBeNull();
  });
  it('forward: leaving late in the evening, a move lands when the curfew lifts (06:00 local), never inside it', () => {
    const ch = chainForward('a320ceo', 'LIS', 'LHR', day('LIS', 22))!;
    for (const l of ch) expect(curfewOk(l.from, l.std) && curfewOk(l.to, l.sta)).toBe(true);
    expect(localMinuteOfDay('LHR', ch[ch.length - 1].sta)).toBeGreaterThanOrEqual(6 * 60);
    // A Hamburg departure at 05:00 local waits for 06:00.
    const h = chainForward('a320ceo', 'HAM', 'PMI', day('HAM', 5))!;
    expect(localMinuteOfDay('HAM', h[0].std)).toBeGreaterThanOrEqual(6 * 60);
  });
});

describe('base pattern plan', () => {
  const g = newGame();
  for (const waves of [2, 3]) {
    it(`${waves} waves: maintenance nights every 7 days and monthly BH within 5% of target`, () => {
      const o = hamBase(g, fromUTC(2027, 4, 1), 91, waves);
      const p = o.pattern as BasePattern;
      expect(p.waves).toHaveLength(waves);
      const t = typeOf('a320ceo');
      const days = flownRotations(p, 'a320ceo');
      expect(days.length).toBe(baseDays(p));
      for (let k = 6; k < days.length - 1; k += 7) {
        // Night stop long enough for an A-check (+ 2 h) before the next morning's first wave.
        const last = days[k][days[k].length - 1]?.backSta ?? -Infinity;
        const next = days[k + 1][0]?.outStd ?? Infinity;
        expect(next - last).toBeGreaterThanOrEqual(t.aCheckHours * 60 + 120);
      }
      // Full month (May): scheduled block hours within 5% of targetBH.
      const may = monthKey(fromUTC(2027, 5, 10));
      let min = 0;
      for (const d of days) for (const r of d) if (monthKey(r.outStd) === may) min += r.outSta - r.outStd + r.backSta - r.backStd;
      expect(Math.abs(min / 60 - p.targetBH) / p.targetBH).toBeLessThan(0.05);
      // Rotations never overlap and keep the turn.
      for (const d of days) for (let i = 1; i < d.length; i++) expect(d[i].outStd - d[i - 1].backSta).toBeGreaterThanOrEqual(t.turnMin);
    });
  }
});

describe('season base at HAM on the leased A320', () => {
  const g = newGame(3);
  const ac = leased(g);
  const start = g.now + 5 * DAY;
  const o = hamBase(g, start, 45);
  const res = acceptOffer(g, o.id, [ac.id]);
  const cid = res.ok ? res.data!.contractId : '';
  const c = g.contracts[cid];

  it('signs and positions LIS→HAM before the start (billable)', () => {
    expect(res.ok).toBe(true);
    const fl = liveFlights(g, ac.id);
    expect(fl[0]).toMatchObject({ kind: 'positioning', from: 'LIS', to: 'HAM', contractId: cid });
    expect(fl[0].sta).toBeLessThan(fl[1].std);
    expect(c.product.kind === 'wet' && c.product.positioningBillable).toBe(true);
  });

  it('generates 2–3 out-and-back waves a day for the next 28 days at the local wave times', () => {
    const rev = liveFlights(g, ac.id).filter((f) => f.kind === 'revenue');
    const outs = rev.filter((f) => f.from === 'HAM');
    expect(outs.length).toBeGreaterThan(20);
    for (const f of outs) expect([360, 750, 1140]).toContain(localMinuteOfDay('HAM', f.std));
    const perDay = new Map<number, number>();
    for (const f of outs) perDay.set(Math.floor((f.std + 60) / DAY), (perDay.get(Math.floor((f.std + 60) / DAY)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(3);
    const lastOut = outs[outs.length - 1].std;
    expect(lastOut).toBeLessThanOrEqual(g.now + 29 * DAY);
    expect(lastOut).toBeGreaterThan(g.now + 26 * DAY);
    turnsOk(g, ac.id);
  });

  it('extends the schedule daily and positions home after the end', () => {
    run(g, g.now + 10 * DAY);
    const outs = liveFlights(g, ac.id).filter((f) => f.kind === 'revenue' && f.from === 'HAM');
    expect(outs[outs.length - 1].std).toBeGreaterThan(g.now + 26 * DAY);
    run(g, g.now + 25 * DAY);
    const fl = liveFlights(g, ac.id).filter((f) => f.contractId === cid);
    const last = fl[fl.length - 1];
    expect(last).toMatchObject({ kind: 'positioning', from: 'HAM', to: 'LIS' });
    expect(last.std).toBeGreaterThanOrEqual(c.end - DAY);
    turnsOk(g, ac.id);
  }, 30_000); // 35 days of simulation: about 5 s on a busy machine

  it('bills the positioning out before the contract completes', () => {
    run(g, c.end + 2 * DAY);
    expect(c.status).toBe('completed');
    const posOut = Object.values(g.flights).find((f) => f.contractId === cid && f.kind === 'positioning' && f.to === 'LIS')!;
    expect(posOut.status).toBe('done');
    const k = monthKey(posOut.ata!);
    expect(c.use[k].blockMin).toBeGreaterThan(0);
    expect(c.billedMonths).toContain(k);
  });
});

describe('legs patterns and positioning', () => {
  it('repatriation KBL→LIS on the A320: fuel stop and a 2-leg positioning in', () => {
    const g = newGame(4);
    const ac = owned(g);
    const o = offer(g, 'repatriation', { airport: 'KBL', rotations: 1, start: g.now + 40 * 60 });
    const res = acceptOffer(g, o.id, [ac.id]);
    expect(res.ok).toBe(true);
    const fl = liveFlights(g, ac.id);
    expect(fl.map((f) => f.kind)).toEqual(['positioning', 'positioning', 'revenue', 'techstop']);
    expect(fl[0].from).toBe('LIS');
    expect(fl[1].to).toBe('KBL');
    expect(fl[3].to).toBe('LIS');
    turnsOk(g, ac.id);
  });

  it('planPositioning: [] when there, legs when not, null when it cannot make it', () => {
    const g = newGame(5);
    const ac = owned(g);
    expect(planPositioning(g, ac.id, 'LIS', g.now + DAY, 'ferry', null)).toEqual([]);
    expect(planPositioning(g, ac.id, 'KBL', g.now + 3 * 60, 'ferry', null)).toBeNull();
    const legs = planPositioning(g, ac.id, 'KBL', g.now + 2 * DAY, 'ferry', null)!;
    expect(legs.length).toBe(2);
    expect(legs[1].sta).toBeLessThanOrEqual(g.now + 2 * DAY - typeOf(ac.typeId).turnMin);
    expect(legs.every((f) => f.kind === 'ferry')).toBe(true);
  });

  it('relinks positioning when a second job follows at another airport', () => {
    const g = newGame(6);
    const ac = owned(g);
    const a = offer(g, 'adhoc', { variant: 'oneway', airport: 'BCN', start: g.now + 4 * DAY });
    // v0.7: pinned to a one-way that ends at Barcelona (the generator's sub-variant follows the RNG).
    if (a.pattern.kind === 'legs') Object.assign(a.pattern.legs[0], { from: 'MAD', to: 'BCN' });
    expect(acceptOffer(g, a.id, [ac.id]).ok).toBe(true);
    // Home leg BCN→LIS exists; a job from BCN two days later replaces it.
    expect(liveFlights(g, ac.id).some((f) => f.kind === 'positioning' && f.from === 'BCN' && f.to === 'LIS')).toBe(true);
    const b = offer(g, 'adhoc', { variant: 'oneway', airport: 'PMI', start: liveFlights(g, ac.id)[0].sta + 2 * DAY });
    b.pattern.kind === 'legs' && (b.pattern.legs[0].from = 'BCN');
    expect(acceptOffer(g, b.id, [ac.id]).ok).toBe(true);
    const fl = liveFlights(g, ac.id);
    expect(fl.filter((f) => f.kind === 'positioning' && f.from === 'BCN' && f.to === 'LIS')).toHaveLength(0);
    turnsOk(g, ac.id);
  });
});

describe('positioning across a long gap', () => {
  const t0 = fromUTC(2027, 3, 4, 20, 0);
  it('spends a long wait at home: back to base at once, out to the next station late', () => {
    const ch = gapMoves('a320ceo', 'ARN', 'RIX', t0, t0 + 27 * DAY, 'VNO', true)!;
    expect(ch.map((l) => `${l.from}-${l.to}`)).toEqual(['ARN-VNO', 'VNO-RIX']);
    expect(ch[0].std).toBe(t0);
    expect(ch[1].sta).toBeLessThanOrEqual(t0 + 27 * DAY);
    expect(ch[1].std).toBeGreaterThan(t0 + 26 * DAY);
  });
  it('goes home early when home is the next station, and flies direct over a short gap', () => {
    const home = gapMoves('a320ceo', 'ARN', 'VNO', t0, t0 + 10 * DAY, 'VNO', true)!;
    expect(home).toHaveLength(1);
    expect(home[0].std).toBe(t0);
    const short = gapMoves('a320ceo', 'ARN', 'RIX', t0, t0 + 2 * DAY, 'VNO', true)!;
    expect(short.map((l) => `${l.from}-${l.to}`)).toEqual(['ARN-RIX']);
    expect(gapMoves('a320ceo', 'ARN', 'RIX', t0, t0 + 27 * DAY, 'VNO', false)!.map((l) => l.to)).toEqual(['RIX']);
  });
});

describe('relinkPositioning', () => {
  it('is a fixed point: a second pass keeps every leg (a late leg out of a gap included)', async () => {
    const { relinkPositioning } = await import('.');
    const g = newGame(31);
    const ac = leased(g);
    // A base starting right after an away charter lands: the positioning leg can only leave after the first wave.
    const dep = g.now + 10 * DAY;
    const away = offer(g, 'adhoc', { start: dep });
    expect(acceptOffer(g, away.id, [ac.id]).ok).toBe(true);
    const last = liveFlights(g, ac.id).filter((f) => f.contractId).at(-1)!;
    const base = hamBase(g, last.sta + 30, 40);
    acceptOffer(g, base.id, [ac.id]);
    for (let i = 0; i < 2; i++) relinkPositioning(g, ac.id);
    const ids = liveFlights(g, ac.id).map((f) => f.id).join();
    relinkPositioning(g, ac.id);
    expect(liveFlights(g, ac.id).map((f) => f.id).join()).toBe(ids);
  });

  it('v0.9 fix: a late inbound retimes the empty legs after it (same flights, crews kept) instead of re-making them', async () => {
    const { relinkPositioning } = await import('.');
    const { retimeFlight } = await import('../core/entities');
    const g = newGame(31);
    const ac = leased(g);
    const away = offer(g, 'adhoc', { start: g.now + 10 * DAY });
    expect(acceptOffer(g, away.id, [ac.id]).ok).toBe(true);
    const last = liveFlights(g, ac.id).filter((f) => f.contractId && f.kind !== 'positioning').at(-1)!;
    const after = () => liveFlights(g, ac.id).filter((f) => f.kind === 'positioning' && f.std >= last.sta);
    const before = after();
    expect(before.length).toBeGreaterThan(0);
    // The inbound lands 40 min later than the empty leg home can leave after it.
    const turn = typeOf(ac.typeId).turnMin;
    const late = before[0].std - turn + 40 - last.sta;
    expect(late).toBeGreaterThan(0);
    retimeFlight(g, last, last.std + late, last.sta + late);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    const now = after();
    expect(now.map((f) => f.id)).toEqual(before.map((f) => f.id));
    expect(now[0].std).toBeGreaterThanOrEqual(last.sta + turn);
    turnsOk(g, ac.id);
  });

  // v0.9 round 3: a widebody (80 min turn) whose next job leaves a short hop after it lands somewhere else: the empty
  // leg can only leave after that hop has landed, so it falls in the next gap, and each pass made an identical copy of
  // it in the gap it serves (the safety net tripped on every settle: "CS-DVJ re-planned 2 empty leg(s) unchanged").
  for (const [a, b, late] of [[['LIS', 'GRU'], ['LIS', 'OPO'], 'GRU-LIS'], [['GRU', 'LIS'], ['GRU', 'GIG'], 'LIS-GRU']] as const) {
    it(`v0.9 round 3: a late ${late} empty leg after ${a.join('–')} then ${b.join('–')} is planned once and kept (no copy, no safety trip)`, async () => {
      const { relinkPositioning } = await import('.');
      const { addFlight, ownFlightNo } = await import('../core/entities');
      const { blockMinutes } = await import('../core/perf');
      const { addAircraft } = await import('./testkit');
      const { safetyTrips } = await import('../core/safety');
      const g = newGame(31);
      // v0.11 an A330 flying Lisbon–São Paulo holds ETOPS 180 (without it the empty leg goes the 60-minute way).
      (await import('../ops/company')).devGrantApproval(g, 'etops180');
      const ac = addAircraft(g, 'a332');
      expect(typeOf(ac.typeId).turnMin).toBeGreaterThan(blockMinutes(ac.typeId, b[0], b[1]) + 5);
      const t = Math.ceil((g.now + 5 * DAY) / 60) * 60;
      const first = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: a[0], to: a[1], std: t, sta: t + blockMinutes(ac.typeId, a[0], a[1]), pax: 100 });
      const hop = first.sta + 5;
      addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'revenue', from: b[0], to: b[1], std: hop, sta: hop + blockMinutes(ac.typeId, b[0], b[1]), pax: 100 });
      const trips = safetyTrips.length;
      relinkPositioning(g, ac.id);
      const empty = liveFlights(g, ac.id).filter((f) => f.kind === 'positioning' && f.std > first.sta);
      expect(empty.map((f) => `${f.from}-${f.to}`)).toEqual([late]);
      const ids = liveFlights(g, ac.id).map((f) => f.id).join();
      for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
      expect(liveFlights(g, ac.id).map((f) => f.id).join()).toBe(ids);
      expect(safetyTrips.length).toBe(trips);
    });
  }

  it('v0.8 fix pack: a late chain with a fuel stop (LGW–KAN–LAD after an AOG) is a fixed point too, not re-planned on every pass', async () => {
    const { relinkPositioning } = await import('.');
    const g = newGame(31);
    const ac = leased(g);
    const dep = g.now + 6 * DAY;
    const o = offer(g, 'adhoc', { start: dep });
    if (o.pattern.kind === 'legs') o.pattern.legs = [{ from: 'LAD', to: 'LIS', dep, flightNo: '', pax: 150 }];
    o.end = dep + DAY;
    const r = acceptOffer(g, o.id, [ac.id]);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    // An AOG at Gatwick ending 6 h before the departure from Luanda: the only way there lands after it.
    ac.at = 'LGW';
    g.maintenance.mxfp = { id: 'mxfp', aircraftId: ac.id, kind: 'AOG', at: 'LGW', start: g.now, end: dep - 6 * 60, cost: 0, status: 'inWork', planned: false, ev: 0 };
    relinkPositioning(g, ac.id);
    const pos = liveFlights(g, ac.id).filter((f) => f.kind === 'positioning' && f.std >= dep - 6 * 60 && f.std < dep + DAY);
    expect(pos.map((f) => `${f.from}-${f.to}`).join(' ')).toMatch(/^LGW-\w{3} \w{3}-LAD$/);
    expect(pos[pos.length - 1].sta).toBeGreaterThan(dep);
    const ids = liveFlights(g, ac.id).map((f) => f.id).join();
    for (let i = 0; i < 3; i++) expect(relinkPositioning(g, ac.id)).toEqual([]);
    expect(liveFlights(g, ac.id).map((f) => f.id).join()).toBe(ids);
  });
});

describe('v0.12.1 relink keeps the plan whole (A11, A9, A16)', () => {
  const chained = (g: GameState, id: string) => {
    const turn = typeOf(g.fleet[id].typeId).turnMin;
    const fl = flightsOf(g, id).filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);
    for (let i = 1; i < fl.length; i++) {
      expect(fl[i].from, `${fl[i - 1].no} ${fl[i - 1].from}-${fl[i - 1].to} then ${fl[i].no} ${fl[i].from}-${fl[i].to}`).toBe(fl[i - 1].to);
      expect(fl[i].std).toBeGreaterThanOrEqual(fl[i - 1].sta + (fl[i].kind === 'techstop' ? 45 : turn));
    }
  };
  it('a hop home whose return belongs to next week is not kept in the gap before a trip signed in between (A11)', () => {
    const g = newGame(12);
    const ac = owned(g);
    const d0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const a = acceptOffer(g, legsOffer(g, [['AMS', 'RHO', d0 + 8 * 60], ['RHO', 'AMS', d0 + 13 * 60], ['AMS', 'RHO', d0 + 7 * DAY + 8 * 60], ['RHO', 'AMS', d0 + 7 * DAY + 13 * 60]]).id, [ac.id]);
    expect(a.ok).toBe(true);
    const b = acceptOffer(g, legsOffer(g, [['AMS', 'AYT', d0 + 6 * DAY + 7 * 60], ['AYT', 'AMS', d0 + 6 * DAY + 12 * 60]]).id, [ac.id]);
    expect(b.ok).toBe(true);
    relinkPositioning(g, ac.id);
    chained(g, ac.id);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    chained(g, ac.id);
  });

  it('a new empty leg after the last leg of a job, to our own maintenance, is not tagged to that job (A9)', () => {
    const g = newGame(12);
    const ac = owned(g);
    const d0 = Math.floor(g.now / DAY) * DAY + 3 * DAY;
    const a = acceptOffer(g, legsOffer(g, [['LIS', 'FAO', d0 + 8 * 60], ['FAO', 'OPO', d0 + 12 * 60]]).id, [ac.id]);
    expect(a.ok).toBe(true);
    const ka = a.ok ? a.data!.contractId : '';
    const [l1, l2] = flightsOf(g, ac.id).filter((x) => x.contractId === ka && x.kind === 'revenue');
    // The job's last leg is in the air; an A-check at Madrid follows (booked after it).
    g.now = l2.std + 5;
    l1.status = 'done';
    l2.status = 'enroute';
    ac.flightId = l2.id;
    for (const f of flightsOf(g, ac.id).filter((x) => x.kind === 'positioning' && x.status === 'scheduled')) f.status = 'cancelled';
    g.maintenance.mxa = { id: 'mxa', aircraftId: ac.id, kind: 'A', at: 'MAD', start: d0 + 2 * DAY, end: d0 + 2 * DAY + 10 * 60, cost: 0, status: 'planned', planned: true, ev: 0 };
    const made = relinkPositioning(g, ac.id).filter((f) => f.to === 'MAD');
    expect(made.length).toBeGreaterThan(0);
    for (const f of made) expect(f.contractId).toBeNull();
  });

  it('the base tail starts after the last generated rotation is home, not at local midnight (A16)', () => {
    const g = newGame(3);
    const ac = leased(g);
    const o = offer(g, 'seasonBase', { airport: 'LIS', dests: ['DUS'], waves: 3, start: g.now + 5 * DAY, days: 40 });
    const r = acceptOffer(g, o.id, [ac.id]);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    const last = Math.max(...flightsOf(g, ac.id).filter((f) => f.contractId === c.id && f.status === 'scheduled').map((f) => f.sta));
    // The schedule is generated up to a local midnight that falls between an evening wave's departure and its landing.
    c.generatedUntil = last - 120;
    const tail = anchorsOf(g, ac.id).find((x) => x.kind === 'base' && x.contractId === c.id)!;
    expect(tail.std).toBeGreaterThanOrEqual(last);
    expect(relinkPositioning(g, ac.id)).toEqual([]);
    // No empty leg is a twin of a revenue leg.
    const fl = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
    for (const p of fl.filter((f) => f.kind === 'positioning')) expect(fl.some((f) => f.kind === 'revenue' && f.from === p.from && f.to === p.to && f.std === p.std)).toBe(false);
  });
});
