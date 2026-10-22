// Flight execution state machine, ripple and recovery, AOG, cancellations and pruning (B3). DESIGN.md §5.5.

import { afterEach, describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, removeFlights } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, LedgerCat, Minute } from '../core/types';
import { acceptOffer } from '../contracts';
import { hamBase, leased, legsOffer, newGame, owned, run } from '../contracts/testkit';
import { demoFlights } from '../dev';
import { serialize } from '../save';
import { advanceTo } from '../sim';
import { aogChance, delayFlight, resolveDecision } from '.';
import { cancelLegs, delayChain, pickRival, planHold, pruneFlights, subcharterCost, subcharterLegs, unitOf } from './flights';

// ---------- helpers ----------

type Knobs = 'delayChance' | 'techDelayChance' | 'aogBase';
const bal = BAL as unknown as Record<Knobs, number>;
const saved = { delayChance: BAL.delayChance, techDelayChance: BAL.techDelayChance, aogBase: BAL.aogBase };
/** No random delays or AOGs unless a test turns them on (restored after each test). */
function calm(patch: Partial<Record<Knobs, number>> = {}) {
  Object.assign(bal, { delayChance: 0, techDelayChance: 0, aogBase: 0 }, patch);
}
afterEach(() => Object.assign(bal, saved));

/** Advances with no auto-pause honoured (decisions expire into their defaults). */
const skip = (g: GameState, t: Minute) => advanceTo(g, t, new Set());
const line = (g: GameState, cat: LedgerCat) => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);
const live = (g: GameState, ac: Aircraft) => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled');
const isRev = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';

function expectTurnMinima(g: GameState, ac: Aircraft) {
  const legs = flightsOf(g, ac.id).filter((f) => f.status !== 'cancelled');
  const turn = typeOf(ac.typeId).turnMin;
  for (let i = 1; i < legs.length; i++) expect(legs[i].std).toBeGreaterThanOrEqual(legs[i - 1].sta + turn);
}

function sign(g: GameState, offerId: string, ac: Aircraft): Contract {
  const r = acceptOffer(g, offerId, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  return g.contracts[r.data!.contractId];
}

/** A HAM–PMI base (3 waves) on the owned A320, run to `day` days after its start, 2 h before a wave leaves HAM. */
function onBase(seed: number, day = 2) {
  const g = newGame(seed);
  const ac = owned(g);
  const c = sign(g, hamBase(g, g.now + 2 * DAY, 30, 3).id, ac);
  const p = c.pattern;
  const outs = () => live(g, ac).filter((f) => isRev(f) && f.from === 'HAM' && f.contractId === c.id);
  run(g, p.kind === 'base' ? p.from + day * DAY : g.now);
  const w1 = outs().find((f) => f.std > g.now + 3 * 60 && !f.delay)!;
  run(g, w1.std - 120);
  return { g, ac, c, outs };
}

// ---------- departure and arrival ----------

describe('departure and arrival', () => {
  it('flies a leg block to block: off-blocks at STD, eta with wind noise, parked at the destination with hours, cycles and costs', () => {
    calm();
    const g = newGame(3);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const [out] = live(g, ac);
    const { hours, cycles } = ac;
    const { deferred, fhSinceA } = ac.maint;
    const fuel0 = line(g, 'fuel');
    const fees0 = line(g, 'airportFees');
    const maint0 = line(g, 'maintenance');
    run(g, out.std);
    expect(out.status).toBe('enroute');
    expect(out.atd).toBe(out.std);
    expect(ac).toMatchObject({ status: 'flying', flightId: out.id, at: 'LIS' });
    expect(Math.abs(out.eta! - out.atd! - out.block)).toBeLessThanOrEqual(Math.ceil(out.block * BAL.windNoise));
    expect(g.stats.departures).toBe(Object.keys(g.fleet).length);
    run(g, out.eta!);
    expect(out).toMatchObject({ status: 'done', ata: out.eta });
    expect(ac).toMatchObject({ status: 'available', flightId: null, at: 'FAO', cycles: cycles + 1 });
    const fh = (out.ata! - out.atd! - 20) / 60;
    expect(ac.hours - hours).toBeCloseTo(fh, 6);
    expect(ac.maint.fhSinceA - fhSinceA).toBeCloseTo(fh, 6);
    expect(ac.maint.deferred).toBeGreaterThan(deferred);
    // A ferry is ours to pay: fuel, fees and maintenance reserves.
    expect(line(g, 'fuel')).toBeLessThan(fuel0);
    // Every ferry that has landed by now paid its fees (the other aircraft's may land first).
    const landed = Object.values(g.flights).filter((f) => f.kind === 'ferry' && f.status === 'done').length;
    expect(landed).toBeGreaterThanOrEqual(1);
    expect(line(g, 'airportFees')).toBe(fees0 - BAL.airportFees[0] * landed);
    expect(line(g, 'maintenance')).toBeLessThan(maint0);
  });

  it('waits for a late inbound aircraft: the next leg leaves a turn after on-blocks', () => {
    calm();
    const g = newGame(3);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const [out, back] = live(g, ac);
    // The out leg leaves 90 min late; the return was planned 50 min after its arrival.
    delayFlight(g, out.id, 90, 'Late VIP');
    run(g, back.std + 1);
    expect(back.std).toBeGreaterThanOrEqual(out.sta + typeOf(ac.typeId).turnMin);
    run(g, back.sta + 120);
    expect(back.status).toBe('done');
    expect(back.atd).toBeGreaterThanOrEqual(out.ata! + typeOf(ac.typeId).turnMin);
  });
});

// ---------- delays, ripple, recovery ----------

describe('delays and ripple', () => {
  it('a player delay ripples to later legs with turn minima kept and moves a planned check behind them', async () => {
    calm();
    const { scheduleCheck } = await import('./maintenance');
    const g = newGame(4);
    const ac = owned(g);
    demoFlights(g, ['FAO', 'OPO'], 2);
    const legs = live(g, ac);
    const last = legs[legs.length - 1];
    const ck = scheduleCheck(g, ac.id, 'A', last.sta + 60, 'LIS');
    expect(ck.ok).toBe(true);
    const m = g.maintenance[ck.ok ? ck.data!.maintId : ''];
    const std0 = legs.map((f) => f.std);
    const r = delayFlight(g, legs[0].id, 10 * 60, 'VIP hold');
    expect(r.ok).toBe(true);
    expect(legs[0].std).toBe(std0[0] + 600);
    expect(legs[0].schedStd).toBe(std0[0]);
    expect(legs.every((f) => f.status === 'scheduled')).toBe(true);
    expect(legs[1].std).toBeGreaterThan(std0[1]);
    expectTurnMinima(g, ac);
    expect(m.start).toBeGreaterThanOrEqual(last.sta);
    expect(m.end - m.start).toBe(typeOf(ac.typeId).aCheckHours * 60);
  });

  it('rejects delays on flights that left or are out of range', () => {
    calm();
    const g = newGame(4);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const [out] = live(g, ac);
    expect(delayFlight(g, out.id, 2, 'x').ok).toBe(false);
    expect(delayFlight(g, out.id, 25 * 60, 'x').ok).toBe(false);
    expect(delayFlight(g, 'nope', 30, 'x').ok).toBe(false);
    run(g, out.std + 5);
    expect(delayFlight(g, out.id, 30, 'x').ok).toBe(false);
  });

  it('random delays move on-time stats; a charter leg more than 3 h late costs perDelay', () => {
    calm({ delayChance: 1 });
    const g = newGame(5);
    const ac = owned(g);
    const t = g.now + 2 * DAY;
    const c = sign(g, legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * 60]]).id, ac);
    const [a, b] = live(g, ac).filter(isRev);
    // Every departure rolls one operational delay (≤ 3 h), once.
    run(g, a.std + 1);
    expect(a.delayReason).toBeTruthy();
    expect(a.std - a.schedStd!).toBeGreaterThanOrEqual(5);
    expect(a.std - a.schedStd!).toBeLessThanOrEqual(BAL.delayCap);
    calm();
    // The player then holds the return 4 h: it leaves over 3 h late and the client is compensated.
    const pen0 = line(g, 'penalties');
    expect(delayFlight(g, b.id, 4 * 60, 'Late passengers').ok).toBe(true);
    run(g, b.sta + 60);
    expect(a.status).toBe('done');
    expect(b.status).toBe('done');
    expect(g.stats.legs).toBe(2);
    expect(g.stats.delayed).toBeGreaterThanOrEqual(1);
    expect(g.stats.onTime + g.stats.delayed).toBe(2);
    expect(line(g, 'penalties')).toBe(pen0 - c.penalties.perDelay);
  });

  it('reliability follows on-time performance', () => {
    calm();
    const g = newGame(5);
    const ac = owned(g);
    const t = g.now + DAY;
    sign(g, legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * 60]]).id, ac);
    const r0 = g.company.reputation.reliable;
    run(g, t + 8 * 60);
    expect(g.stats.onTime).toBe(2);
    expect(g.company.reputation.reliable).toBeGreaterThan(r0);
  });
});

describe('schedule recovery', () => {
  it('drops the one wave that would leave over the cap and keeps the next on time', () => {
    calm();
    // v0.7: seed moved (the market's own RNG stream shifted the main sequence; 30 now builds a 2-wave day).
    const { g, ac, outs } = onBase(31);
    const [w1, w2] = outs();
    const back1 = unitOf(g, ac, w1)[1];
    expect(back1).toMatchObject({ from: w1.to, to: 'HAM' });
    const std2 = w2.std;
    delayChain(g, w1, w1.std + BAL.holdMax + 60, 'Test hold');
    expect(w1.status).toBe('cancelled');
    expect(back1.status).toBe('cancelled');
    expect(w1.delayReason).toBe('Recovery: Test hold');
    expect(w2).toMatchObject({ status: 'scheduled', std: std2 });
    expect(g.messages[0].title).toMatch(/2 legs cancelled/);
  });

  it('a shorter hold moves the wave and only pushes the next one as far as the turn needs', () => {
    calm();
    const { g, ac, outs } = onBase(31);
    const [w1, w2] = outs();
    const std2 = w2.std;
    const n = delayChain(g, w1, w1.std + 3 * 60, 'Test hold');
    expect(w1.status).toBe('scheduled');
    expect(n).toBeGreaterThanOrEqual(1);
    expect(w2.status).toBe('scheduled');
    expect(w2.std).toBeGreaterThanOrEqual(std2);
    expect(w2.std - std2).toBeLessThan(3 * 60);
    expectTurnMinima(g, ac);
  });

  it("away from the station a wave's return waits (the aircraft must come home); the waves after it are dropped", () => {
    calm();
    const { g, ac, outs } = onBase(32);
    const [w1] = outs();
    const back1 = unitOf(g, ac, w1)[1];
    run(g, w1.std + w1.block + 30);
    expect(ac.at).toBe(w1.to);
    const later = outs().filter((f) => f.std < g.now + 12 * 60);
    delayChain(g, back1, g.now + 10 * 60, 'Waiting for a rescue crew');
    expect(back1.status).toBe('scheduled');
    expect(back1.std).toBeGreaterThanOrEqual(g.now + 10 * 60);
    for (const f of later) expect(f.status).toBe('cancelled');
    expectTurnMinima(g, ac);
  });

  it('a player-held leg is never dropped by later recovery for the lateness the player accepted', () => {
    calm();
    const { g, outs } = onBase(31);
    const [w1] = outs();
    expect(delayFlight(g, w1.id, BAL.holdMax + 60, 'VIP').ok).toBe(true);
    expect(w1.status).toBe('scheduled');
    delayChain(g, w1, w1.std + 20, 'ATC slot');
    expect(w1.status).toBe('scheduled');
  });
});

// ---------- AOG ----------

describe('AOG', () => {
  it('pauses, posts the 5-option decision, holds departures until resolved; maint.end restores the aircraft', () => {
    calm({ aogBase: 10 });
    const g = newGame(6);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    removeFlights(g, live(g, leased(g)).map((f) => f.id));
    const [out] = live(g, ac);
    const r = advanceTo(g, out.std + 10);
    expect(r.pause).toBe('aog');
    expect(ac.status).toBe('aog');
    const m = g.maintenance[ac.maintId!];
    expect(m).toMatchObject({ kind: 'AOG', status: 'inWork', at: 'LIS' });
    expect(m.end - m.start).toBeGreaterThanOrEqual(BAL.aogHours[0] * 60);
    expect(g.stats.aogs).toBe(1);
    const d = g.decisions.find((x) => x.kind === 'aog')!;
    expect(d.options.map((o) => o.id)).toEqual(['courier', 'team', 'swap', 'subcharter', 'cancel']);
    calm();
    // Departures stay blocked while the decision is open.
    for (let t = g.now + 30; t < d.expires - 5; t += 30) {
      advanceTo(g, t, new Set());
      expect(out.status).toBe('scheduled');
      expect(out.atd).toBeUndefined();
    }
    const deferred = ac.maint.deferred;
    const maint0 = line(g, 'maintenance');
    expect(resolveDecision(g, d.id, 'courier').ok).toBe(true);
    expect(out.std).toBeGreaterThanOrEqual(m.end);
    expectTurnMinima(g, ac);
    skip(g, m.end);
    expect(m.status).toBe('done');
    expect(ac).toMatchObject({ status: 'available', maintId: null });
    expect(ac.maint.deferred).toBeCloseTo(deferred * 0.7, 9);
    expect(line(g, 'maintenance')).toBe(maint0 - m.cost);
    // Back in service, the leg is no longer held for the aircraft: it leaves, or (when the crew that reported
    // before the AOG is now out of hours) waits for crew re-rostering (B2).
    skip(g, out.std + 1);
    // (v0.7: or held a few minutes at the gate while a re-rostered crew boards.)
    expect(out.status === 'enroute' || out.status === 'done' || out.delayReason === 'Waiting for crew' || (!!out.crewHeld && out.delay > 0 && out.delay <= 30), `${out.status} ${out.delayReason} ${out.delay} ${out.crewHeld}`).toBe(true);
  });

  it('the AOG chance is one roll per departure at about 1–3 a year for the startup fleet', () => {
    const g = newGame(7);
    // ~120 departures a month on a season base (DESIGN §5.6), deferred defects mid-interval.
    for (const ac of Object.values(g.fleet)) {
      const perYear = aogChance(g, { ...ac, maint: { ...ac.maint, deferred: 0.15 } }, g.company.homeBase) * 120 * 12;
      expect(perYear).toBeGreaterThan(0.8);
      expect(perYear).toBeLessThan(3.5);
    }
    const ac = owned(g);
    // Outstations without our engineers are riskier; deferred defects raise it.
    expect(aogChance(g, ac, 'TFS')).toBeCloseTo(aogChance(g, ac, 'LIS') * BAL.aogOutstation, 12);
    expect(aogChance(g, { ...ac, maint: { ...ac.maint, deferred: 0.5 } }, 'LIS')).toBeGreaterThan(aogChance(g, { ...ac, maint: { ...ac.maint, deferred: 0.1 } }, 'LIS'));
  });

  it('technical delays never become an AOG', () => {
    calm({ techDelayChance: 1 });
    const g = newGame(8);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const [out] = live(g, ac);
    run(g, out.std + 1);
    expect(out.delayReason).toMatch(/^Technical/);
    expect(ac.status).not.toBe('aog');
    skip(g, out.std + 6 * 60);
    expect(out.status).not.toBe('scheduled');
    expect(g.stats.aogs ?? 0).toBe(0);
  });

  it('an AOG hold ripples a wave\'s return past a stale positioning leg the planner left between its legs (v0.7.1 fix 2)', () => {
    calm();
    const g = newGame(34);
    const ac = owned(g);
    removeFlights(g, live(g, ac).map((f) => f.id));
    ac.at = 'FLR';
    const turn = typeOf(ac.typeId).turnMin;
    const t0 = g.now + 3 * 60;
    const b = (a: string, c: string) => blockMinutes(ac.typeId, a, c);
    const inbound = addFlight(g, { no: 'AT842', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'FLR', to: 'CMN', std: t0, sta: t0 + b('FLR', 'CMN'), pax: 150 });
    const out = addFlight(g, { no: 'AT1102', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'CMN', to: 'VCE', std: t0 + 14 * 60, sta: t0 + 14 * 60 + b('CMN', 'VCE'), pax: 150 });
    // The planner's soft leg against the AOG's maintenance node: FLR→CMN, departing between the wave's two legs.
    const stale = addFlight(g, { no: 'AWL129', aircraftId: ac.id, contractId: null, kind: 'positioning', from: 'FLR', to: 'CMN', std: t0 + 14 * 60 + 20, sta: t0 + 14 * 60 + 20 + b('FLR', 'CMN') });
    const back = addFlight(g, { no: 'AT1103', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'VCE', to: 'CMN', std: t0 + 18 * 60, sta: t0 + 18 * 60 + b('VCE', 'CMN'), pax: 150 });
    const plan = planHold(g, ac, 'FLR', t0 + 14 * 60);
    const moved = new Map(plan.moves.map((m) => [m.f.id, m.std]));
    expect(moved.get(inbound.id)).toBe(t0 + 14 * 60);
    const outStd = moved.get(out.id)!;
    expect(outStd).toBeGreaterThanOrEqual(t0 + 14 * 60 + b('FLR', 'CMN') + turn);
    // The return leg follows its outbound (it used to stay at its old time, reversing the chain).
    expect(moved.get(back.id)).toBeGreaterThanOrEqual(outStd + b('CMN', 'VCE') + turn);
    expect(plan.moves.some((m) => m.f.id === stale.id)).toBe(false);
    expect(plan.cancels).toEqual([]);
  });

  it('waiting for the part keeps the legs within the fix window and drops base waves over the cap', () => {
    calm();
    const { g, ac, outs } = onBase(33);
    const [w1] = outs();
    const plan = planHold(g, ac, 'HAM', g.now + 20 * 60);
    expect(plan.cancels).toContain(w1);
    for (const { f, std } of plan.moves) expect(std).toBeGreaterThanOrEqual(Math.max(f.std, g.now));
  });
});

// ---------- cancellations and sub-charter ----------

describe('cancellations and sub-charter', () => {
  it('cancelLegs compensates per revenue leg, costs relation −2 a leg and reliability, removes empty legs', () => {
    calm();
    const g = newGame(9);
    const ac = leased(g);
    const c = sign(g, hamBase(g, g.now + 3 * DAY, 30, 2).id, ac);
    const pos = live(g, ac).find((f) => f.kind === 'positioning')!;
    const legs = live(g, ac).filter(isRev).slice(0, 2);
    const client = g.clients[c.clientId];
    const rel0 = client.relation;
    const rep0 = g.company.reputation.reliable;
    const pen0 = line(g, 'penalties');
    const pen = cancelLegs(g, [pos, ...legs], 'Test', 1);
    expect(pen).toBe(2 * c.penalties.perCancelledLeg);
    expect(line(g, 'penalties')).toBe(pen0 - pen);
    // v0.8: −3 a leg we cancel (§1.3).
    expect(client.relation).toBe(rel0 + 2 * BAL.v08.rel.cancelLeg);
    expect(g.stats.cancelled).toBe(2);
    expect(g.company.reputation.reliable).toBeLessThan(rep0 - 2);
    expect(legs.every((f) => f.status === 'cancelled' && f.delayReason === 'Test')).toBe(true);
    expect(g.flights[pos.id]).toBeUndefined();
  });

  it('agreed drops (notice) cost nothing here', () => {
    calm();
    const g = newGame(9);
    const ac = leased(g);
    const c = sign(g, hamBase(g, g.now + 3 * DAY, 30, 2).id, ac);
    const legs = live(g, ac).filter(isRev).slice(0, 2);
    const rel0 = g.clients[c.clientId].relation;
    expect(cancelLegs(g, legs, 'A-check', 0, true)).toBe(0);
    expect(g.clients[c.clientId].relation).toBe(rel0);
    expect(g.stats.cancelled).toBe(0);
  });

  it('sub-chartered legs keep their contract and billing, leave our aircraft and post the cost', () => {
    calm();
    const g = newGame(10);
    const ac = owned(g);
    const c = sign(g, hamBase(g, g.now + 2 * DAY, 30, 2).id, ac);
    const legs = live(g, ac).filter(isRev).slice(0, 2);
    const rival = pickRival(g, ac.typeId);
    const cost = subcharterCost(g, legs, 1.5);
    expect(cost).toBeGreaterThan(0);
    const sub0 = line(g, 'subcharter');
    expect(subcharterLegs(g, legs, rival, cost)).toBe(2);
    expect(line(g, 'subcharter')).toBe(sub0 - cost);
    for (const f of legs) expect(f).toMatchObject({ aircraftId: null, operatedBy: rival, contractId: c.id, status: 'scheduled' });
    skip(g, legs[1].sta + 60);
    for (const f of legs) expect(f.status).toBe('done');
    const use = c.use[monthKey(legs[0].std)];
    expect(use.blockMin).toBeGreaterThanOrEqual(legs[0].block + legs[1].block);
    expect(g.stats.subchartered).toBe(2);
  });
});

// ---------- housekeeping and determinism ----------

describe('pruning', () => {
  it('drops done flights a week after on-blocks, not before', () => {
    calm();
    const g = newGame(12);
    const ac = owned(g);
    demoFlights(g, ['FAO'], 1);
    const ids = live(g, ac).map((f) => f.id);
    const lastOn = Math.max(...ids.map((id) => g.flights[id].sta));
    skip(g, lastOn + 6 * DAY);
    expect(ids.every((id) => g.flights[id]?.status === 'done')).toBe(true);
    skip(g, lastOn + 9 * DAY);
    expect(ids.some((id) => g.flights[id])).toBe(false);
    pruneFlights(g);
  });
});

describe('determinism', () => {
  function play(seed: number): string {
    const g = newGame(seed);
    sign(g, hamBase(g, g.now + 3 * DAY, 60, 3).id, owned(g));
    demoFlights(g, ['FAO', 'OPO'], 2);
    const end = g.now + 90 * DAY;
    while (g.now < end && !g.gameOver) {
      advanceTo(g, end, new Set(['decision', 'aog']));
      for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    }
    const save = JSON.parse(serialize(g));
    delete save.meta.savedAt;
    return JSON.stringify(save);
  }

  it('90 days with the same seed and actions give identical saves', () => {
    const a = play(41);
    expect(play(41) === a).toBe(true);
    expect(play(42) === a).toBe(false);
  }, 60_000);
});
