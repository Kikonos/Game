// v0.11 ETOPS on ferries and positioning (player decision, 26 Oct 2026): every empty leg respects the lower of the
// company's ETOPS approval and the aircraft's capability (the 60-minute rule without an approval); the long way on
// 60-minute fuel stops when the usual way needs more; a crossing with no such way is refused, with the ways out.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { route } from '../contracts/plan';
import { legsOffer, newGame, run } from '../contracts/testkit';
import { feasibility } from '../contracts';
import { flightsOf, removeFlights, addFlight, ownFlightNo } from '../core/entities';
import { etopsCap, etopsMinutes, etopsNeeded, ADEQUATE_RUNWAY_M } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { deserialize, serialize } from '../save';
import { addCrew } from '../crew/fixtures';
import { devGrantApproval } from './company';
import { deliveryQuote, ferryCap, ferryRoute } from './delivery';
import { etopsLine } from './etops';
import { acquireAircraft, devMarketOffer } from './market';
import { problemFor } from '../problems';

const path = (legs: { from: string; to: string }[]) => (legs.length ? [legs[0].from, ...legs.map((l) => l.to)].join('-') : '');
/** Every leg stays within 60 minutes (one engine, still air) of an adequate airport. */
const within60 = (typeId: string, legs: { from: string; to: string }[]) => legs.every((l) => etopsMinutes(typeId, l.from, l.to) <= 60);

function sign(g: GameState, typeId: string, site: string, delivery?: 'thisSide' | 'ferryCo') {
  g.company.cash = 60_000_000;
  const id = devMarketOffer(g, typeId, { site });
  return { id, r: acquireAircraft(g, id, delivery ? { delivery } : {}) };
}
const acOf = (r: ReturnType<typeof acquireAircraft>): string => {
  if (!r.ok) throw new Error(r.error);
  return r.data!.aircraftId;
};
/** A ledger line over every statement so far (the current month and the closed ones). */
const total = (g: GameState, cat: 'airportFees' | 'fuel') => [g.finance.current, ...g.finance.history.filter((h) => h.month !== g.finance.current.month)].reduce((n, st) => n + (st.lines[cat] ?? 0), 0);

describe('ETOPS on ferries (v0.11)', () => {
  it('a twin with no approval ferries Lisbon–Halifax and Frankfurt–San Juan the northern way, every hop within 60 minutes of an adequate airport', () => {
    const g = newGame(1);
    expect(ferryCap(g, 'a320ceo')).toBe(0);
    // The usual way needs ETOPS (LIS–YHZ direct is 90+ minutes from land; FRA–Azores–San Juan far more).
    expect(etopsNeeded('a320ceo', 'LIS', 'YHZ')).toBeGreaterThan(0);
    for (const [a, b] of [['LIS', 'YHZ'], ['FRA', 'SJU'], ['YUL', 'LIS']] as const) {
      const r = ferryRoute('a320ceo', a, b, 0)!;
      expect(r, `${a}-${b}`).not.toBeNull();
      expect(within60('a320ceo', r), path(r)).toBe(true);
      // North of the Azores: a stop in Iceland, Greenland or Arctic Canada, never the mid-Atlantic.
      expect(r.some((l) => ['KEF', 'SFJ', 'YFB', 'YYR', 'UAK'].includes(l.to) || ['KEF', 'SFJ', 'YFB', 'YYR', 'UAK'].includes(l.from)), path(r)).toBe(true);
      expect(r.some((l) => l.to === 'PDL' || l.to === 'TER')).toBe(false);
      // Real stops: adequate runways, each leg within the A320's range.
      for (const l of r) expect(AIRPORT_BY_CODE[l.to].runwayM).toBeGreaterThanOrEqual(2000);
    }
    // A delivery from Montréal to Lisbon: planned that way, as ferry days with night stops.
    const { r } = sign(g, 'a320ceo', 'YUL');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    const ac = g.fleet[acOf(r)];
    const legs = ac.delivery!.ferryIds.map((id) => g.flights[id]);
    expect(legs.length).toBeGreaterThanOrEqual(3);
    expect(within60(ac.typeId, legs), path(legs)).toBe(true);
    expect(legs[0].from).toBe('YUL');
    expect(legs[legs.length - 1].to).toBe('LIS');
    const q = deliveryQuote(g, 'a320ceo', 'YUL', g.now + 10 * DAY);
    expect(q.longWay).toBe(true);
    expect(q.text).toContain('the 60-minute way');
  });

  it('with ETOPS 180 approved and a 180-capable twin it may fly direct', () => {
    const g = newGame(1);
    devGrantApproval(g, 'etops120');
    devGrantApproval(g, 'etops180');
    expect(ferryCap(g, 'a321neo')).toBe(180);
    const r = ferryRoute('a321neo', 'LIS', 'YHZ', ferryCap(g, 'a321neo'))!;
    expect(path(r)).toBe('LIS-YHZ');
    expect(route('a321neo', 'LIS', 'YHZ', ferryCap(g, 'a321neo'))!.length).toBe(1);
    expect(etopsLine(g, 'a321neo')).toBe('capable of 180 min · approved 180 min');
  });

  it('an aircraft capable of only 120 minutes is capped at 120 even when the company holds ETOPS 180', () => {
    const g = newGame(1);
    devGrantApproval(g, 'etops120');
    devGrantApproval(g, 'etops180');
    expect(etopsCap(g.company.approvals, 'a320ceo')).toBe(120);
    expect(etopsLine(g, 'a320ceo')).toBe('capable of 120 min · approved 180 min → flies up to 120 min');
    // LIS–Halifax needs 120: direct. Los Angeles–Honolulu needs 180: no legal way for the A320.
    expect(etopsNeeded('a320ceo', 'LIS', 'YHZ')).toBe(120);
    expect(path(ferryRoute('a320ceo', 'LIS', 'YHZ', 120)!)).toBe('LIS-YHZ');
    expect(etopsNeeded('a320ceo', 'LAX', 'HNL')).toBe(180);
    expect(ferryRoute('a320ceo', 'LAX', 'HNL', 120)).toBeNull();
    expect(ferryRoute('a321neo', 'LAX', 'HNL', ferryCap(g, 'a321neo'))).not.toBeNull();
    // With no approval the Fleet card says what the rules use.
    expect(etopsLine(newGame(1), 'a320ceo')).toBe('capable of 120 min · approved 60 min → ferries go the northern way');
  });

  it('four engines are not limited by the twin rules', () => {
    const g = newGame(1);
    expect(etopsCap(g.company.approvals, 'b744')).toBe(Infinity);
    expect(etopsLine(g, 'b744')).toBe('not needed (four engines)');
    expect(path(ferryRoute('b744', 'LIS', 'YHZ', ferryCap(g, 'b744'))!)).toBe(path(ferryRoute('b744', 'LIS', 'YHZ')!));
    const q = deliveryQuote(g, 'b744', 'SEA', g.now + 10 * DAY);
    expect(q.longWay).toBe(false);
    expect(q.blocked ?? null).toBeNull();
  });

  it('an impossible crossing (no 60-minute way across the Pacific) is refused with a clear reason and the ways out', () => {
    const g = newGame(1);
    const q = deliveryQuote(g, 'a320ceo', 'HNL', g.now + 20 * DAY);
    expect(q.legs).toEqual([]);
    expect(q.blocked).toBeTruthy();
    expect(q.text).toMatch(/^No legal ferry home from Honolulu: every way crosses water more than 60 minutes from an airport/);
    expect(q.blocked!.worst.min).toBeGreaterThan(60);
    // The A320 is capable of 120: ETOPS 120 would not do (the Pacific needs 180): no approval opens it.
    expect(q.blocked!.approval).toBeNull();
    // The A321neo (180-capable) would need ETOPS 180.
    expect(deliveryQuote(g, 'a321neo', 'HNL', g.now + 20 * DAY).blocked!.approval).toBe('etops180');
    g.company.cash = 60_000_000;
    const id = devMarketOffer(g, 'a320ceo', { site: 'HNL' });
    const before = Object.keys(g.fleet).length;
    const r = acquireAircraft(g, id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/No legal ferry home/);
    expect(Object.keys(g.fleet).length).toBe(before);
    // The four-line card: what, why (the worst leg against our limit), does it hurt, what you can do.
    const card = problemFor(g, { kind: 'noFerry', ref: { kind: 'market', id } })!;
    expect(card.what).toBe('We may not ferry this A320 home from Honolulu');
    expect(card.why).toMatch(/more than 60 minutes from an airport .*we hold no ETOPS approval/);
    expect(card.hurt.text).toMatch(/^Not yet: nothing is signed/);
    expect(card.actions.map((a) => a.id)).toEqual(['thisSide', 'ferryCo']);
    // Positioning to a job out there is refused too, plainly.
    const t0 = Math.ceil((g.now + 20 * DAY) / 60) * 60;
    const o = legsOffer(g, [['HNL', 'OGG', t0], ['OGG', 'HNL', t0 + 4 * 60]]);
    const rep = feasibility(g, o.id, Object.keys(g.fleet)[0]);
    const pos = rep.checks.find((c) => c.id === 'positioning')!;
    expect(pos.level).toBe('no');
    expect(pos.label).toMatch(/No legal way to position it: every routing crosses water more than 60 minutes from an airport/);
  });

  it('a ferry company or a handover on this side: paid at signing through the ledger', () => {
    const g = newGame(1);
    const q = deliveryQuote(g, 'a320ceo', 'HNL', g.now + 20 * DAY);
    const fee = q.blocked!.ferryCo.fee;
    expect(fee).toBeGreaterThan(30_000);
    g.company.cash = 60_000_000;
    const id = devMarketOffer(g, 'a320ceo', { site: 'HNL' });
    const o = g.market.aircraft.find((x) => x.id === id)!;
    const cash0 = g.company.cash;
    const line0 = g.finance.current.lines.delivery ?? 0;
    const r = acquireAircraft(g, id, { delivery: 'ferryCo' });
    expect(r.ok).toBe(true);
    const ac = g.fleet[acOf(r)];
    expect(ac.delivery!.site).toBe('LIS');
    expect(ac.delivery!.ferryIds).toEqual([]);
    expect(g.finance.current.lines.delivery! - line0).toBe(-fee);
    expect(cash0 - g.company.cash).toBe(o.deposit + fee);
    // This side: handed over at a lessor site in Europe, then our own (60-minute) ferry home.
    const g2 = newGame(1);
    const b2 = deliveryQuote(g2, 'a320ceo', 'HNL', g2.now + 20 * DAY).blocked!;
    expect(b2.thisSide).toBeTruthy();
    const s = sign(g2, 'a320ceo', 'HNL', 'thisSide');
    expect(s.r.ok).toBe(true);
    const ac2 = g2.fleet[acOf(s.r)];
    expect(ac2.delivery!.site).toBe(b2.thisSide!.site);
    expect(AIRPORT_BY_CODE[ac2.delivery!.site].continent).toBe('EU');
    expect(g2.finance.current.lines.delivery).toBe(-b2.thisSide!.fee);
  });

  it('each fuel stop of the northern way is flown and paid like any leg (fuel, landing and handling in the ledger)', () => {
    // A 767 from Montréal with its own rated pilots (as the delivery tests do): no approval, so the 60-minute way.
    const g = newGame(7);
    devGrantApproval(g, 'widebody');
    addCrew(g, { CPT: 4, FO: 4 }, 'B757/767');
    const { r } = sign(g, 'b763', 'YUL');
    const ac = g.fleet[acOf(r)];
    const legs = ac.delivery!.ferryIds.map((id) => g.flights[id]);
    const fees0 = total(g, 'airportFees');
    const fuel0 = total(g, 'fuel');
    expect(path(legs)).toBe('YUL-SFJ-SNN-LIS');
    run(g, legs[legs.length - 1].sta + DAY);
    const flown = ac.delivery!.ferryIds.map((id) => g.flights[id]).filter((f) => f?.status === 'done');
    expect(flown.length).toBe(legs.length);
    expect(ac.delivery!.arrived).toBeDefined();
    expect(ac.at).toBe('LIS');
    // Airport fees grew by at least one fee per ferry leg (other flying adds more), fuel too.
    expect(fees0 - total(g, 'airportFees')).toBeGreaterThanOrEqual(legs.length * 1000);
    expect(total(g, 'fuel')).toBeLessThan(fuel0);
  }, 60_000);

  it('positioning to a job across the ocean goes the northern way too (and is no longer refused for ETOPS)', () => {
    const g = newGame(1);
    const t0 = Math.ceil((g.now + 25 * DAY) / 60) * 60;
    const o = legsOffer(g, [['YYZ', 'YUL', t0], ['YUL', 'YYZ', t0 + 4 * 60]]);
    const acId = Object.keys(g.fleet)[0];
    const rep = feasibility(g, o.id, acId);
    expect(rep.checks.find((c) => c.id === 'etops')!.level).toBe('ok');
    expect(rep.positionIn.length).toBeGreaterThanOrEqual(2);
    expect(within60(g.fleet[acId].typeId, rep.positionIn), path(rep.positionIn)).toBe(true);
    expect(within60(g.fleet[acId].typeId, rep.positionOut), path(rep.positionOut)).toBe(true);
  });

  it('save/load: a game with a northern-way delivery continues identically; an old straight-across ferry is re-planned on load', () => {
    const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);
    const g = newGame(3);
    const { r } = sign(g, 'a320ceo', 'YUL');
    const ac = g.fleet[acOf(r)];
    const first = g.flights[ac.delivery!.ferryIds[0]];
    run(g, first.std + 60);
    const h = deserialize(serialize(g));
    expect(state(h)).toBe(state(g));
    const end = g.now + 6 * DAY;
    run(g, end);
    run(h, end);
    expect(state(h)).toBe(state(g));

    // An older save: the delivery ferry planned straight across (YUL–LIS, a one-off ferry permit).
    const o = newGame(4);
    const s = sign(o, 'a320ceo', 'YUL');
    const oac = o.fleet[acOf(s.r)];
    const planned = oac.delivery!.ferryIds.map((id) => o.flights[id]);
    const std = planned[0].std;
    removeFlights(o, planned.map((f) => f.id));
    const old = addFlight(o, { no: ownFlightNo(o), aircraftId: oac.id, contractId: null, kind: 'ferry', from: 'YUL', to: 'LIS', std, sta: std + 6 * 60 });
    old.purpose = 'delivery';
    oac.delivery!.ferryIds = [old.id];
    const loaded = deserialize(serialize(o));
    const lac = loaded.fleet[oac.id];
    const now = lac.delivery!.ferryIds.map((id) => loaded.flights[id]);
    expect(loaded.flights[old.id]).toBeUndefined();
    expect(now[0].std).toBe(std);
    expect(path(now)).toBe(path(planned));
    expect(within60(lac.typeId, now)).toBe(true);
    expect(flightsOf(loaded, lac.id).filter((f) => f.purpose === 'delivery').length).toBe(now.length);
  }, 120_000);

  it('the en-route fields are real adequate aerodromes (published runways) and never job destinations', () => {
    for (const c of ['KEF', 'SFJ', 'YFB', 'YYR', 'YQX', 'BDA']) expect(AIRPORT_BY_CODE[c].runwayM, c).toBeGreaterThanOrEqual(ADEQUATE_RUNWAY_M);
    expect(AIRPORT_BY_CODE.UAK.runwayM).toBe(1830);
    for (const c of ['SFJ', 'UAK', 'YFB', 'YYR', 'YQX', 'YYT', 'BDA', 'ANF', 'IQQ']) expect(AIRPORT_BY_CODE[c].enroute, c).toBe(true);
    expect(AIRPORT_BY_CODE.SFJ.country).toBe('GL');
  });
});
