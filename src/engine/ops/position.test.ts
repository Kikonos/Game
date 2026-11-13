// v0.23.3 Position an aircraft from the Schedule's idle line (ops/position.ts): the quote, its refusals, the booking
// through the ferry machinery, the cancel, the schedule's own empty legs from where the aircraft was put, save and load.

import { describe, expect, it } from 'vitest';
import { AIRPORTS } from '../../data/airports';
import { acceptOffer } from '../contracts';
import { addAircraft, hamBase, leased, newGame, owned, run } from '../contracts/testkit';
import { liveFlightsOf } from '../core/entities';
import { runwayFit } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { flightCrewStatus } from '../crew';
import { awayIdle } from '../contracts/schedule';
import { deserialize, serialize } from '../save';
import { ferryCost } from './delivery';
import { cancelPosition, positionAircraft, positionLegs, positionTargets, quotePosition } from './position';

const state = (g: GameState) => JSON.stringify((JSON.parse(serialize(g)) as { state: unknown }).state);
const live = (g: GameState, id: string) => liveFlightsOf(g, id).map((f) => `${f.kind} ${f.from}-${f.to}`);

describe('position quote', () => {
  it('a short hop: one leg from where the aircraft stands, no sooner than a crew can report, the ferry cost model, a legal crew', () => {
    const g = newGame(3);
    const ac = owned(g);
    const before = state(g);
    const q = quotePosition(g, ac.id, 'FRA', { from: g.now });
    expect(q).toMatchObject({ ok: true, reason: null, from: 'LIS', to: 'FRA', full: true, stops: [] });
    expect(q.legs.map((l) => `${l.from}-${l.to}`)).toEqual(['LIS-FRA']);
    expect(q.depart).toBeGreaterThanOrEqual(g.now + 120);
    expect(q.depart).toBe(q.earliest);
    expect(q.arrive! - q.depart!).toBe(q.block);
    const c = ferryCost(ac.typeId, q.legs, g.market.fuelPrice);
    expect([q.fuel, q.fees]).toEqual([c.fuel, c.fees]);
    expect(q.crewCost).toBeGreaterThan(0);
    expect(q.total).toBe(q.fuel + q.fees + q.crewCost);
    expect(q.crew?.level).toBe('ok');
    expect(q.crew?.names).toMatch(/^Capt .+, FO .+/);
    expect(q.notes.join(' ')).toContain('stays at Frankfurt');
    // A quote changes nothing.
    expect(state(g)).toBe(before);
  });

  it('beyond its range it flies with fuel stops and a night stop; a later start is taken', () => {
    const g = newGame(3);
    const ac = owned(g);
    const q = quotePosition(g, ac.id, 'JFK', { from: g.now });
    expect(q.ok).toBe(true);
    expect(q.legs.length).toBeGreaterThan(1);
    expect(q.legs[0].from).toBe('LIS');
    expect(q.legs[q.legs.length - 1].to).toBe('JFK');
    expect(q.stops.length).toBe(q.legs.length - 1);
    expect(q.legs.some((l) => l.night)).toBe(true);
    const later = quotePosition(g, ac.id, 'FRA', { from: g.now, later: 12 * 60 });
    expect(later.ok).toBe(true);
    expect(later.depart).toBeGreaterThanOrEqual(later.earliest! + 12 * 60);
  });

  it('the shortlist: home base away from it, the next job, open offers nearby; never where it stands', () => {
    const g = newGame(3);
    const ac = leased(g);
    const o = hamBase(g, g.now + 6 * DAY, 45);
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    const list = positionTargets(g, ac.id, g.now);
    expect(list.some((x) => x.code === 'LIS')).toBe(false);
    expect(list.find((x) => x.code === 'HAM')?.tag).toBe('Next job');
    expect(list.length).toBeLessThanOrEqual(8);
    expect(positionAircraft(g, ac.id, 'FRA', { from: g.now }).ok).toBe(true);
    run(g, g.now + DAY);
    expect(positionTargets(g, ac.id, g.now)[0]).toMatchObject({ code: 'LIS', tag: 'Home base' });
  });
});

describe('position refused', () => {
  it('already there, out of range, a runway too short, an unknown airport', () => {
    const g = newGame(3);
    const ac = owned(g);
    expect(quotePosition(g, ac.id, 'LIS', { from: g.now })).toMatchObject({ ok: false, reason: `${ac.reg} is already at Lisbon` });
    expect(quotePosition(g, ac.id, 'SYD', { from: g.now }).reason).toMatch(/out of range/);
    const wide = addAircraft(g, 'b77w');
    const short = AIRPORTS.find((x) => runwayFit(wide.typeId, x.code) === 'no' && !x.enroute)!;
    expect(quotePosition(g, wide.id, short.code, { from: g.now }).reason).toMatch(/^The runway at .+ is too short for the /);
    expect(quotePosition(g, ac.id, 'ZZZ', { from: g.now }).reason).toBe('Unknown airport');
    expect(positionAircraft(g, ac.id, 'SYD', { from: g.now }).ok).toBe(false);
    expect(liveFlightsOf(g, ac.id)).toEqual([]);
  });

  it('a clash with what is scheduled after the idle stretch: no time to be back for the next job', () => {
    const g = newGame(3);
    const ac = leased(g);
    const o = hamBase(g, g.now + 30 * 60, 45);
    expect(acceptOffer(g, o.id, [ac.id]).ok).toBe(true);
    // New York and back to Hamburg does not fit before the first wave; Frankfurt does.
    const far = quotePosition(g, ac.id, 'JFK', { from: g.now });
    expect(far.ok).toBe(false);
    expect(far.reason).toMatch(/^Too late at HAM for /);
    expect(quotePosition(g, ac.id, 'FRA', { from: g.now }).ok).toBe(true);
  });

  it('no crew: nobody rated and free to fly it', () => {
    const g = newGame(3);
    const ac = owned(g);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT') c.blocks = [{ from: g.now, to: g.now + 90 * DAY, why: 'leave' }];
    const q = quotePosition(g, ac.id, 'FRA', { from: g.now });
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/No crew can fly it/);
    expect(positionAircraft(g, ac.id, 'FRA', { from: g.now }).ok).toBe(false);
    expect(liveFlightsOf(g, ac.id)).toEqual([]);
  });
});

describe('position booked', () => {
  it('real ferry legs as quoted, crewed at once; fuel and fees post when it lands; the aircraft stays there', () => {
    const g = newGame(3);
    const ac = owned(g);
    const q = quotePosition(g, ac.id, 'FRA', { from: g.now });
    const r = positionAircraft(g, ac.id, 'FRA', { from: g.now });
    if (!r.ok) throw new Error(r.error);
    const f = g.flights[r.data!.flightIds[0]];
    expect(f).toMatchObject({ kind: 'ferry', contractId: null, from: 'LIS', to: 'FRA', std: q.depart, sta: q.arrive, status: 'scheduled' });
    expect(f.pos?.to).toBe('FRA');
    expect(f.crewIds.length).toBe(2);
    expect(flightCrewStatus(g, f.id).level).toBe('ok');
    expect(g.messages[0].title).toBe(`Positioning booked: ${ac.reg} to Frankfurt`);
    const fuel0 = g.finance.current.lines.fuel ?? 0;
    const fees0 = g.finance.current.lines.airportFees ?? 0;
    const month = g.finance.current;
    run(g, f.sta + 6 * 60);
    expect(f.status).toBe('done');
    expect(ac.at).toBe('FRA');
    expect(ac.parked).toBe('FRA');
    if (g.finance.current === month) {
      expect((g.finance.current.lines.fuel ?? 0) - fuel0).toBeLessThan(-q.fuel * 0.8);
      expect((g.finance.current.lines.fuel ?? 0) - fuel0).toBeGreaterThan(-q.fuel * 1.2);
      expect((g.finance.current.lines.airportFees ?? 0) - fees0).toBe(-q.fees);
    }
    // Three weeks on: still there (no ferry home planned, no "idle away" card).
    run(g, g.now + 21 * DAY);
    expect(ac.at).toBe('FRA');
    expect(liveFlightsOf(g, ac.id)).toEqual([]);
    expect(awayIdle(g, ac.id)).toBeNull();
  });

  it('cancelled before it leaves: the legs go, the crew are free, nothing is charged; not once it has left', () => {
    const g = newGame(3);
    const ac = owned(g);
    const cash = g.company.cash;
    const r = positionAircraft(g, ac.id, 'JFK', { from: g.now });
    if (!r.ok) throw new Error(r.error);
    const ids = r.data!.flightIds;
    expect(ids.length).toBeGreaterThan(1);
    expect(positionLegs(g, ids[1]).map((f) => f.id)).toEqual(ids);
    expect(cancelPosition(g, ids[1]).ok).toBe(true);
    expect(ids.every((id) => !g.flights[id])).toBe(true);
    expect(liveFlightsOf(g, ac.id)).toEqual([]);
    expect(Object.values(g.duties).some((d) => d.flightIds.some((id) => ids.includes(id)))).toBe(false);
    expect(g.company.cash).toBe(cash);
    run(g, g.now + 2 * DAY);
    expect(ac.at).toBe('LIS');
    // Under way: the leg in the air stays, the legs still to fly can go; the aircraft then finds its own way home.
    const r2 = positionAircraft(g, ac.id, 'JFK', { from: g.now });
    if (!r2.ok) throw new Error(r2.error);
    const first = g.flights[r2.data!.flightIds[0]];
    run(g, first.std + 30);
    expect(first.status).toBe('enroute');
    expect(cancelPosition(g, 'nope').ok).toBe(false);
    expect(cancelPosition(g, first.id).ok).toBe(true);
    expect(first.status).toBe('enroute');
    expect(r2.data!.flightIds.slice(1).every((id) => !g.flights[id])).toBe(true);
    run(g, first.sta + 3 * 60);
    expect(ac.parked).toBeUndefined();
    expect(live(g, ac.id).at(-1)).toMatch(/positioning .+-LIS$/);
  });
});

describe('the schedule plans on from where the aircraft was put', () => {
  it('a job signed later: its empty leg leaves from there, with no hop home first; home again after the job', () => {
    const g = newGame(3);
    const ac = leased(g);
    expect(positionAircraft(g, ac.id, 'FRA', { from: g.now }).ok).toBe(true);
    run(g, g.now + DAY);
    expect(ac.at).toBe('FRA');
    const o = hamBase(g, g.now + 9 * DAY, 30);
    const res = acceptOffer(g, o.id, [ac.id]);
    if (!res.ok) throw new Error(res.error);
    const fl = liveFlightsOf(g, ac.id);
    expect(fl[0]).toMatchObject({ kind: 'positioning', from: 'FRA', to: 'HAM' });
    expect(fl.some((f) => f.to === 'LIS' && f.std < fl[1].std)).toBe(false);
    // As late as possible: it waits at Frankfurt, not at Hamburg.
    expect(fl[1].std - fl[0].sta).toBeLessThan(DAY);
    run(g, fl[0].std + 60);
    expect(ac.parked).toBeUndefined();
  });

  it('positioned to where the next job starts: it waits there (no out-and-back home), and the job flies', () => {
    const g = newGame(3);
    const ac = leased(g);
    const o = hamBase(g, g.now + 8 * DAY, 30);
    const res = acceptOffer(g, o.id, [ac.id]);
    if (!res.ok) throw new Error(res.error);
    expect(live(g, ac.id)[0]).toBe('positioning LIS-HAM');
    const q = quotePosition(g, ac.id, 'HAM', { from: g.now });
    expect(q.ok).toBe(true);
    expect(q.notes.join(' ')).toContain('No longer flown: LIS–HAM');
    expect(positionAircraft(g, ac.id, 'HAM', { from: g.now }).ok).toBe(true);
    const fl = liveFlightsOf(g, ac.id);
    expect(fl[0]).toMatchObject({ kind: 'ferry', from: 'LIS', to: 'HAM' });
    expect(fl.filter((f) => f.kind === 'positioning' && f.std < o.start)).toEqual([]);
    run(g, g.now + DAY);
    expect(ac).toMatchObject({ at: 'HAM', parked: 'HAM' });
    run(g, o.start + 2 * DAY);
    // A week at Hamburg, then the job from there: no empty leg was flown or is planned before it.
    expect(g.stats.legs).toBeGreaterThan(2);
    expect(Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.kind === 'positioning' && f.std < o.start + DAY)).toEqual([]);
    expect(ac.parked).toBeUndefined();
    // Cancelled instead, the schedule's own empty leg comes back.
    const g2 = newGame(3);
    const ac2 = leased(g2);
    const o2 = hamBase(g2, g2.now + 8 * DAY, 30);
    expect(acceptOffer(g2, o2.id, [ac2.id]).ok).toBe(true);
    const r2 = positionAircraft(g2, ac2.id, 'HAM', { from: g2.now });
    if (!r2.ok) throw new Error(r2.error);
    expect(cancelPosition(g2, r2.data!.flightIds[0]).ok).toBe(true);
    expect(live(g2, ac2.id)[0]).toBe('positioning LIS-HAM');
  });
});

describe('position: save, load, continue', () => {
  it('a booked move plays on the same after a reload, before it leaves and once the aircraft stands there', () => {
    // (A new game once through a save: the loader's own defaults are in both copies.)
    const g = deserialize(serialize(newGame(5)));
    const ac = owned(g);
    const r = positionAircraft(g, ac.id, 'JFK', { from: g.now });
    if (!r.ok) throw new Error(r.error);
    const h = deserialize(serialize(g));
    expect(state(h)).toBe(state(g));
    expect(h.flights[r.data!.flightIds[0]].pos).toEqual(g.flights[r.data!.flightIds[0]].pos);
    run(g, g.now + 4 * DAY);
    run(h, h.now + 4 * DAY);
    expect(g.fleet[ac.id]).toMatchObject({ at: 'JFK', parked: 'JFK' });
    expect(state(h)).toBe(state(g));
    const h2 = deserialize(serialize(g));
    expect(h2.fleet[ac.id].parked).toBe('JFK');
    run(g, g.now + 10 * DAY);
    run(h2, h2.now + 10 * DAY);
    expect(state(h2)).toBe(state(g));
    expect(g.fleet[ac.id].at).toBe('JFK');
    // The same quote from the same state, twice.
    expect(quotePosition(h2, ac.id, 'LIS', { from: h2.now })).toEqual(quotePosition(g, ac.id, 'LIS', { from: g.now }));
  });
});
