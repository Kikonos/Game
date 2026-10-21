import { describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { demoFlights } from '../dev';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { flightsOf, liveFlightsOf, takeRelink, touchFlights, touchStatus } from './entities';
import { blockMinutes, cabinMinimum, complement, etopsNeeded, planSector, runwayFit } from './perf';
import { pop, schedule } from './queue';
import { DAY, START, fmtTime, fromUTC, localOffset, monthKey } from './time';
import type { GameState } from './types';

const newGame = (seed = 7): GameState =>
  createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('new game (Startup)', () => {
  it('creates two A320ceo at base, one owned and one leased', () => {
    const g = newGame();
    const fleet = Object.values(g.fleet);
    expect(fleet).toHaveLength(2);
    expect(fleet.every((a) => a.typeId === 'a320ceo' && a.at === 'LIS' && a.status === 'available')).toBe(true);
    expect(fleet.map((a) => a.ownership.kind).sort()).toEqual(['dryLeaseIn', 'owned']);
    expect(fleet[0].reg.startsWith('CS-T')).toBe(true);
    expect(g.now).toBe(START);
  });

  it('hires about five crew sets per aircraft, all A320-rated and named', () => {
    const g = newGame();
    const crew = Object.values(g.crew);
    expect(crew).toHaveLength(60);
    expect(crew.filter((c) => c.role === 'CPT')).toHaveLength(10);
    expect(crew.every((c) => c.ratings.includes('A320') && c.first && c.last && c.base === 'LIS')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(JSON.stringify(newGame(42))).toEqual(JSON.stringify(newGame(42)));
    const a = newGame(42);
    const b = newGame(42);
    expect(Object.values(a.crew).map((c) => c.last)).toEqual(Object.values(b.crew).map((c) => c.last));
  });
});

describe('event queue and clock', () => {
  it('pops in (time, seq) order', () => {
    const g = newGame();
    g.queue = [];
    schedule(g, 50, 'payment', 'b');
    schedule(g, 10, 'payment', 'a');
    schedule(g, 50, 'payment', 'c');
    expect([pop(g)!.id, pop(g)!.id, pop(g)!.id]).toEqual(['a', 'b', 'c']);
  });

  it('runs daily rollovers and closes the month statement', () => {
    const g = newGame();
    // Honour no pause reasons: urgent offers (B1) and month-end (B3) would otherwise stop the clock.
    const r = advanceTo(g, START + 32 * DAY, new Set());
    expect(r.events).toBeGreaterThanOrEqual(32);
    expect(g.now).toBe(START + 32 * DAY);
    expect(g.finance.history).toHaveLength(1);
    expect(g.finance.history[0].month).toBe(monthKey(START));
    expect(g.finance.current.month).toBe(monthKey(START) + 1);
  });

  it('flies demo flights: aircraft depart and arrive on time', () => {
    const g = newGame();
    demoFlights(g, ['FAO'], 1);
    const ac = Object.values(g.fleet)[0];
    const [out, back] = flightsOf(g, ac.id);
    advanceTo(g, out.std + 5);
    expect(ac.status).toBe('flying');
    expect(ac.flightId).toBe(out.id);
    advanceTo(g, back.sta + 1);
    expect(out.status).toBe('done');
    expect(ac.at).toBe('LIS');
    expect(ac.cycles).toBeGreaterThan(0);
  });

  it('v0.7 status-only touches: lists stay put, live legs follow, only that aircraft is due a relink', () => {
    const g = newGame();
    demoFlights(g, ['FAO'], 1);
    const ac = Object.values(g.fleet)[0];
    const list = flightsOf(g, ac.id);
    const [out] = list;
    takeRelink(g);
    advanceTo(g, out.std + 5);
    expect(out.status).toBe('enroute');
    expect(flightsOf(g, ac.id)).toBe(list);
    expect(liveFlightsOf(g, ac.id)).toContain(out);
    advanceTo(g, out.sta + 30);
    expect(out.status).toBe('done');
    expect(liveFlightsOf(g, ac.id)).not.toContain(out);
    expect(liveFlightsOf(g, ac.id).every((f) => f.status === 'scheduled' || f.status === 'enroute')).toBe(true);
    touchStatus(g, ac.id);
    expect(takeRelink(g)).toEqual({ all: false, ids: new Set([ac.id]) });
    touchFlights(g);
    expect(takeRelink(g).all).toBe(true);
  });
});

describe('saves', () => {
  it('round-trips through JSON', () => {
    const g = newGame();
    advanceTo(g, START + 3 * DAY);
    const back = deserialize(serialize(g));
    expect(back.now).toBe(g.now);
    expect(Object.keys(back.crew)).toEqual(Object.keys(g.crew));
    expect(back.queue.length).toBe(g.queue.length);
  });
});

describe('time zones', () => {
  it('applies EU summer time', () => {
    expect(localOffset('LIS', fromUTC(2027, 1, 15))).toBe(0);
    expect(localOffset('LIS', fromUTC(2027, 7, 15))).toBe(60);
    expect(localOffset('VNO', fromUTC(2027, 7, 15))).toBe(180);
    expect(fmtTime(fromUTC(2027, 7, 15, 12), 'MAD')).toBe('14:00');
    expect(localOffset('JFK', fromUTC(2027, 7, 15))).toBe(-240);
    expect(localOffset('DEL', fromUTC(2027, 7, 15))).toBe(330);
  });
});

describe('performance and fit', () => {
  it('has data for every shortlist type and airport runway lengths', () => {
    expect(ACMI_TYPES_LIST.length).toBeGreaterThanOrEqual(15);
    for (const c of ['KBL', 'DIL', 'JED', 'MED', 'BKO', 'GOM', 'JUB', 'MGQ', 'BGF']) expect(AIRPORT_BY_CODE[c]?.runwayM).toBeGreaterThan(1000);
  });

  it('gives plausible block times', () => {
    const lisFao = blockMinutes('a320ceo', 'LIS', 'FAO');
    expect(lisFao).toBeGreaterThanOrEqual(45);
    expect(lisFao).toBeLessThanOrEqual(65);
    const lisGru = blockMinutes('b763', 'LIS', 'GRU');
    expect(lisGru).toBeGreaterThan(9 * 60);
    expect(lisGru).toBeLessThan(11 * 60);
  });

  it('reproduces the Dili case: 777 prohibited, 767 payload-limited with stops', () => {
    expect(runwayFit('b772', 'DIL')).toBe('no');
    expect(runwayFit('b763', 'DIL')).toBe('limited');
    expect(planSector('b772', 'LIS', 'DIL').ok).toBe(false);
    const p = planSector('b763', 'DXB', 'DIL');
    expect(p.ok).toBe(true);
    expect(p.techStops.length).toBeGreaterThan(0);
  });

  it('needs ETOPS for an oceanic twin sector but not inside Europe', () => {
    expect(etopsNeeded('a320ceo', 'LIS', 'MAD')).toBe(0);
    expect(etopsNeeded('b763', 'LIS', 'GRU')).toBeGreaterThanOrEqual(120);
    expect(etopsNeeded('a343', 'LIS', 'GRU')).toBe(0);
  });

  it('builds crew complements', () => {
    expect(cabinMinimum(180)).toBe(4);
    expect(complement('a320ceo', 180)).toEqual(['CPT', 'FO', 'SCC', 'CC', 'CC', 'CC']);
    expect(complement('b763', 267, { augment: 1, extraCabin: 1 })).toEqual(['CPT', 'FO', 'CRP', 'CSD', 'CC', 'CC', 'CC', 'CC', 'CC', 'CC']);
    expect(complement('a35u', 161).slice(0, 3)).toEqual(['CPT', 'FO', 'CSD']);
    expect(complement('a35u', 161, { augment: 2 }).slice(0, 4)).toEqual(['CPT', 'CPT', 'FO', 'FO']);
  });
});
