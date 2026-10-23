// v0.8 pre-release: the seed-16 freeze (a late fuel-stop positioning chain re-planned on every settle), the engine's
// safety net for re-planning loops, and dev / market airframes with their own type's hours, cycles, value and rest.

import { afterEach, describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../data/acmiTypes';
import { acceptOffer } from './contracts';
import { generateOffer } from './contracts/offers';
import { addAircraft, leased, newGame, offer } from './contracts/testkit';
import { flightsOf } from './core/entities';
import { safetyTrip, safetyTrips, setSafetyStrict } from './core/safety';
import { DAY, fromUTC } from './core/time';
import { devAddType } from './dev';
import { acquireAircraft, devMarketOffer } from './ops/market';
import { hoursPerCycle, saleQuote } from './ops/sale';
import { advanceTo, settle } from './sim';

afterEach(() => setSafetyStrict(true));

describe('v0.8 pre-release: the clock never stalls on a late fuel-stop positioning chain (bot seed 16 froze on 4275188)', () => {
  it('an aircraft back from an AOG with a late LGW–KAN–LAD chain plays 4 days in hourly steps with a handful of empty legs, not one per settle', () => {
    const g = newGame(31);
    const ac = leased(g);
    const dep = g.now + 6 * DAY;
    const o = offer(g, 'adhoc', { start: dep });
    if (o.pattern.kind === 'legs') o.pattern.legs = [{ from: 'LAD', to: 'LIS', dep, flightNo: '', pax: 150 }];
    o.end = dep + DAY;
    const r = acceptOffer(g, o.id, [ac.id]);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    // Back from an AOG at Gatwick 6 h before the Luanda departure: the only way there lands after it.
    ac.at = 'LGW';
    g.maintenance.mxfp = { id: 'mxfp', aircraftId: ac.id, kind: 'AOG', at: 'LGW', start: g.now, end: dep - 6 * 60, cost: 0, status: 'inWork', planned: false, ev: 0 };
    settle(g);
    // Hourly steps over the chain (each step settles like the UI and the bot do). On 4275188 every settle replaced the
    // chain with a copy (new flight numbers, crews ticketed again); in the bot the clock never got past it.
    const seen = new Set<string>();
    const from = dep - 2 * DAY;
    advanceTo(g, from);
    settle(g);
    const end = dep + 2 * DAY;
    let steps = 0;
    while (g.now < end && steps < 500) {
      advanceTo(g, Math.min(end, g.now + 60));
      settle(g);
      for (const f of flightsOf(g, ac.id)) if (f.kind === 'positioning') seen.add(f.id);
      steps++;
    }
    expect(g.now).toBe(end);
    // 96 hours (a pause request ends a step early now and then).
    expect(steps).toBeLessThan(150);
    // The chain out (2 legs with the fuel stop) and the way home: a few legs, never dozens of copies.
    expect(seen.size).toBeGreaterThan(0);
    expect(seen.size).toBeLessThanOrEqual(8);
    expect(safetyTrips).toEqual([]);
  });
});

describe('v0.8 pre-release: engine safety net', () => {
  it('a trip throws under tests (so a loop the net breaks still fails the suite) and is logged and kept otherwise', () => {
    expect(() => safetyTrip('test', 'strict')).toThrow(/safety net\] test: strict/);
    setSafetyStrict(false);
    const errs: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errs.push(a.join(' '));
    try {
      safetyTrip('test', 'logged');
    } finally {
      console.error = orig;
    }
    expect(errs).toEqual(['[safety net] test: logged']);
    expect(safetyTrips.at(-1)).toBe('[safety net] test: logged');
    safetyTrips.length = 0;
  });
});

describe('v0.8 pre-release: airframes carry their own type’s hours, cycles, value and rest', () => {
  it('dev addType b744: a 747-400 frame (2009 at most), ~8.5 h per cycle, its own market value, bunks from the type’s rest roll', () => {
    const g = newGame(2);
    const a320 = Object.values(g.fleet)[0];
    const ac = g.fleet[devAddType(g, 'b744')];
    expect(ac.builtYear).toBeLessThanOrEqual(2009);
    expect(ac.hours).not.toBe(a320.hours);
    expect(ac.hours / ac.cycles).toBeGreaterThanOrEqual(8);
    expect(ac.hours / ac.cycles).toBeLessThanOrEqual(10);
    expect(ac.ownership.kind).toBe('owned');
    if (ac.ownership.kind === 'owned') {
      expect(ac.ownership.bookValue).not.toBe(9_500_000);
      expect(ac.ownership.bookValue).toBeGreaterThan(4_000_000);
      expect(ac.ownership.bookValue).toBeLessThan(10_000_000);
    }
    // The type's roll (90 % of 747-400s carry crew rest compartments); this airframe has them.
    expect(ac.rest?.fc?.cls).toBe(1);
    expect(ac.rest?.cc?.cls).toBe(1);
    // A sale quote reads its hours and cycles against the 747's own norm: neither high nor low use.
    const q = saleQuote(g, ac.id);
    expect(q.lines.find((l) => /hours and cycles/.test(l.label))?.amount).toBe(0);
  });

  it('dev aircraft of other types are their own frames too (an A330-200 is not the A320 clone)', () => {
    const g = newGame(2);
    const a320 = Object.values(g.fleet)[0];
    const ac = g.fleet[devAddType(g, 'a332')];
    expect(ac.builtYear).not.toBe(a320.builtYear);
    expect(ac.cycles).toBeLessThan(a320.cycles);
    expect(ac.hours / ac.cycles).toBeCloseTo(hoursPerCycle('a332'), 0);
    expect(ac.etops).toBe(180);
  });

  it('the market never gives a widebody narrowbody-like cycles; the start fleet keeps its A320 numbers', () => {
    for (const t of ACMI_TYPES_LIST) {
      if (t.body === 'wide') expect(hoursPerCycle(t.id), t.id).toBeGreaterThanOrEqual(5);
      else expect(hoursPerCycle(t.id), t.id).toBeLessThan(3);
    }
    expect(hoursPerCycle('b744')).toBeGreaterThanOrEqual(8);
    expect(hoursPerCycle('b744')).toBeLessThanOrEqual(10);
    const g = newGame(5);
    for (const a of Object.values(g.fleet)) expect(a.hours / a.cycles).toBeCloseTo(1.7, 1);
    g.company.cash = 1e9;
    g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
    for (const typeId of ['b744', 'a332', 'b763', 'a388']) {
      const id = devMarketOffer(g, typeId, { kind: 'dryLeaseIn' });
      const r = acquireAircraft(g, id);
      if (!r.ok) throw new Error(`${typeId}: ${r.error}`);
      const ac = g.fleet[r.data!.aircraftId];
      expect(ac.hours / ac.cycles, typeId).toBeCloseTo(hoursPerCycle(typeId), 0);
      expect(ac.hours / ac.cycles, typeId).toBeGreaterThan(4.9);
    }
  });
});

describe('v0.8 pre-release: seats = passengers keeps the widebody work a first widebody can fly (balance check of the fix pack)', () => {
  it('widebody tour series, repatriations, evacuations and pre-season tours seat 240–265 (a two-class 767-300 has 267), not 260–300', () => {
    const g = newGame(7);
    g.company.approvals.push('widebody', 'etops120', 'etops180');
    const b763 = addAircraft(g, 'b763');
    const asks: Record<string, number[]> = {};
    for (const a of ['tourSeries', 'repatriation', 'evacuation', 'sports'] as const) {
      for (let i = 0; i < 40; i++) {
        g.now += 3 * 60;
        const o = generateOffer(g, a, { wide: true, window: false, paint: false, cabin: false });
        if (o && o.requirements.minSeats > 235) (asks[a] ??= []).push(o.requirements.minSeats);
        if (o) delete g.offers[o.id];
      }
    }
    for (const a of ['tourSeries', 'repatriation', 'evacuation', 'sports']) {
      expect(asks[a]?.length ?? 0, a).toBeGreaterThan(0);
      for (const n of asks[a]) {
        expect(n, a).toBeGreaterThanOrEqual(240);
        expect(n, a).toBeLessThanOrEqual(Math.min(265, b763.cabin.total));
      }
    }
  });

  it('a widebody Hajj airlift fills 300 seats most often (a 767’s 309Y takes it); 440 and 500 are the rarer big cabins', () => {
    const g = newGame(4);
    g.company.standing = 1;
    const seen: number[] = [];
    for (let i = 0; i < 400 && seen.length < 60; i++) {
      g.now = fromUTC(2028, 1, 10) + (i % 60) * DAY;
      g.rng = (i * 7919 + 13) >>> 0;
      const o = generateOffer(g, 'hajj', { wide: true, window: false, paint: false, cabin: false });
      if (o && o.requirements.body === 'wide') seen.push(o.requirements.minSeats);
      if (o) delete g.offers[o.id];
    }
    expect(seen.length).toBeGreaterThanOrEqual(30);
    const share = (n: number) => seen.filter((x) => x === n).length / seen.length;
    expect(share(300)).toBeGreaterThan(0.47);
    expect(share(440) + share(500)).toBeLessThan(0.26);
    expect(seen.every((x) => [300, 330, 440, 500].includes(x))).toBe(true);
  });
});
