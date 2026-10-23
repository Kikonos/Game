// Base patterns, flight generation, rolling extension and positioning (B1).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY, fromUTC, localMinuteOfDay, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer, planPositioning } from '.';
import { baseDays, computeWaves, flownRotations, gapMoves, type BasePattern } from './plan';
import { hamBase, leased, newGame, offer, owned, run } from './testkit';

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
