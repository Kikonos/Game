import { describe, expect, it } from 'vitest';
import { AIRCRAFT, AIRCRAFT_BY_ID } from '../data/aircraft';
import { AIRPORTS, AIRPORT_BY_CODE } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { REGIONS } from '../data/regions';
import { SEAT_PRODUCTS } from '../data/seats';
import * as A from './actions';
import { cabinPresets, defaultCabin, maxRowsFor, validateCabin } from './cabin';
import { baseDemand, competition, forecastRoute, marketDemand, optimizePrices, routeSupply, totalOf } from './demand';
import { equity, fixedMonthlyCosts, marketFare, monthProfit, newLeaseRate, refFare } from './economy';
import { rivalReactions, scheduledFor } from './events';
import { distance } from './geo';
import { createGame } from './newGame';
import { GOAL_BY_ID, regionUnlock } from './progression';
import { deserialize, serialize } from './save';
import { advanceDay } from './sim';
import type { GameState, Route } from './types';
import { dayToDate, yearOf } from './util';

const newGame = (hub = 'MAD', seed = 1) =>
  createGame({ name: 'Test Air', code: 'TA', ceo: 'Tester', hub, difficulty: 'normal', seed, livery: { primary: '#123456', secondary: '#ffffff', tail: 'solid' } });

/** Lease a brand-new aircraft of any type at the hub, delivered tomorrow (tests only). */
function leaseType(g: GameState, typeId: string, hub = g.hubs[0].code) {
  const t = AIRCRAFT_BY_ID[typeId];
  g.market.leases.push({
    id: `test-${g.fleet.length}-${typeId}`, typeId, isNew: true, builtDay: g.day, condition: 100, monthly: newLeaseRate(t),
    termMonths: 96, deliveryDays: 1, qty: 1, lessor: 'Test Leasing', expiresDay: g.day + 30,
  });
  const res = A.leaseAircraft(g, g.market.leases[g.market.leases.length - 1].id, hub, defaultCabin(t));
  if (!res.ok) throw new Error(res.error);
  return g.fleet[g.fleet.length - 1];
}

function openRoute(g: GameState, to: string): Route {
  const res = A.openRoute(g, g.hubs[0].code, to);
  if (!res.ok) throw new Error(res.error);
  return g.routes.find((r) => r.id === res.routeId)!;
}

function runMonths(g: GameState, months: number, each?: () => void) {
  const end = g.finance.history.length + months;
  while (g.finance.history.length < end && !g.gameOver) {
    advanceDay(g);
    for (const d of [...g.decisions]) A.resolveDecision(g, d.id, d.options[d.options.length - 1].id);
    g.yearReview = null;
    each?.();
  }
}

function findNaN(obj: unknown, path = 'state'): string | null {
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = findNaN(obj[i], `${path}[${i}]`);
      if (r) return r;
    }
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const r = findNaN(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
}

describe('data', () => {
  it('has unique airport codes with known regions and countries', () => {
    const codes = new Set(AIRPORTS.map((a) => a.code));
    expect(codes.size).toBe(AIRPORTS.length);
    for (const a of AIRPORTS) {
      expect(REGIONS.some((r) => r.id === a.region)).toBe(true);
      expect(COUNTRIES[a.country], a.code).toBeDefined();
      expect(Math.abs(a.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(a.lon)).toBeLessThanOrEqual(180);
    }
  });

  it('every region has enough airports to play', () => {
    for (const r of REGIONS) expect(AIRPORTS.filter((a) => a.region === r.id).length).toBeGreaterThanOrEqual(10);
  });

  it('computes realistic great-circle distances', () => {
    expect(distance('LHR', 'JFK')).toBeGreaterThan(5400);
    expect(distance('LHR', 'JFK')).toBeLessThan(5700);
    expect(distance('SYD', 'MEL')).toBeGreaterThan(650);
    expect(distance('SYD', 'MEL')).toBeLessThan(750);
  });
});

describe('cabins', () => {
  it('every preset is valid and respects the exit limit', () => {
    for (const t of AIRCRAFT) {
      for (const p of cabinPresets(t)) {
        const v = validateCabin(t, p.config);
        expect(v.errors, `${t.id}/${p.id}`).toEqual([]);
        expect(v.total).toBeLessThanOrEqual(t.maxSeats);
      }
    }
  });

  it('default cabins land near real-world typical seat counts', () => {
    for (const id of ['a320neo', 'b38m', 'b789', 'a359', 'atr72', 'e195e2']) {
      const t = AIRCRAFT_BY_ID[id];
      const v = validateCabin(t, defaultCabin(t));
      expect(v.total, id).toBeGreaterThan(t.typicalSeats * 0.8);
      expect(v.total, id).toBeLessThan(t.typicalSeats * 1.25);
    }
  });

  it('rejects oversized cabins', () => {
    const t = AIRCRAFT_BY_ID.a320neo;
    expect(validateCabin(t, { Y: { product: 'y_dense', rows: 60 } }).ok).toBe(false);
    expect(validateCabin(t, { F: { product: 'f_suite', rows: 2 } }).ok).toBe(false);
  });

  it('maxRowsFor fits the remaining space', () => {
    const t = AIRCRAFT_BY_ID.b789;
    const cabin = { J: { product: 'j_flat', rows: 7 } };
    const rows = maxRowsFor(t, cabin, 'Y', 'y_std');
    expect(validateCabin(t, { ...cabin, Y: { product: 'y_std', rows } }).ok).toBe(true);
    expect(validateCabin(t, { ...cabin, Y: { product: 'y_std', rows: rows + 1 } }).ok).toBe(false);
  });

  it('seat products have sane geometry', () => {
    for (const p of SEAT_PRODUCTS) {
      for (const t of AIRCRAFT.filter((x) => p.available(x))) {
        expect(p.abreast(t)).toBeGreaterThan(0);
        expect(p.abreast(t)).toBeLessThanOrEqual(t.yAbreastMax + 1);
        expect(p.pitch(t)).toBeGreaterThanOrEqual(28);
      }
    }
  });
});

describe('demand & economics', () => {
  it('produces plausible market sizes', () => {
    expect(baseDemand('LHR', 'JFK')).toBeGreaterThan(1500);
    expect(baseDemand('MAD', 'BCN')).toBeGreaterThan(1500);
    expect(baseDemand('BIO', 'SVQ')).toBeLessThan(600);
    expect(baseDemand('LHR', 'LGW')).toBe(0);
  });

  it('fares rise with distance and cabin', () => {
    expect(refFare(1000, 'Y')).toBeGreaterThan(refFare(400, 'Y'));
    expect(refFare(8000, 'J')).toBeGreaterThan(refFare(8000, 'W'));
    expect(refFare(8000, 'F')).toBeGreaterThan(refFare(8000, 'J'));
  });

  it('has seasonal swings for leisure destinations', () => {
    const g = newGame();
    const winter = totalOf(marketDemand(g, 'MAD', 'PMI', 15));
    const summer = totalOf(marketDemand(g, 'MAD', 'PMI', 200));
    expect(summer).toBeGreaterThan(winter * 1.2);
  });

  it('schedules real-world events in the right year', () => {
    for (const year of [2026, 2027, 2030]) {
      for (const e of scheduledFor(year)) {
        expect(yearOf(e.start), e.id).toBe(year);
        expect(e.end).toBeGreaterThanOrEqual(e.start);
      }
    }
    const hajj27 = scheduledFor(2027).find((e) => e.id === 'hajj2027')!;
    expect(dayToDate(hajj27.end).getUTCMonth()).toBe(4);
  });
});

describe('player actions', () => {
  it('runs the core loop: lease, open route, assign, fly', () => {
    const g = newGame();
    const offer = g.market.leases.find((o) => o.typeId === 'a320neo')!;
    expect(A.leaseAircraft(g, offer.id, 'MAD', defaultCabin(AIRCRAFT_BY_ID.a320neo)).ok).toBe(true);
    const r = A.openRoute(g, 'MAD', 'BCN');
    expect(r.ok).toBe(true);
    const ac = g.fleet[0];
    const f = A.suggestFreq(g, ac, r.routeId!);
    expect(f).toBeGreaterThan(0);
    expect(A.assignAircraft(g, ac.id, r.routeId!, f).ok).toBe(true);
    for (let i = 0; i < 60; i++) advanceDay(g);
    expect(g.stats.totalPax).toBeGreaterThan(10_000);
    expect(g.finance.history.length).toBe(2);
    expect(totalOf(routeSupply(g, g.routes[0]).seats)).toBeGreaterThan(0);
  });

  it('validates bad requests', () => {
    const g = newGame();
    expect(A.openRoute(g, 'MAD', 'JFK').ok).toBe(false); // locked region
    expect(A.openRoute(g, 'BCN', 'MAD').ok).toBe(false); // not a hub
    expect(A.openRoute(g, 'MAD', 'MAD').ok).toBe(false);
    expect(A.orderNew(g, 'b779', 1, defaultCabin(AIRCRAFT_BY_ID.b779), 'MAD').ok).toBe(false); // level locked
    expect(A.orderNew(g, 'a388', 1, defaultCabin(AIRCRAFT_BY_ID.a388), 'MAD').ok).toBe(false); // out of production
    expect(A.takeLoan(g, 1e12, 60).ok).toBe(false);
    expect(regionUnlock(g, 'UKI').available).toBe(false); // level 2 needed
  });

  it('caps leasing by lessor credit', () => {
    const g = newGame();
    let signed = 0;
    for (const o of [...g.market.leases]) {
      while (A.leaseAircraft(g, o.id, 'MAD').ok) signed++;
    }
    const monthly = g.fleet.reduce((s, a) => s + a.leaseMonthly, 0);
    expect(signed).toBeGreaterThan(0);
    expect(monthly).toBeLessThan(3_000_000);
  });

  it('transferring between hubs does not act as a free heavy check', () => {
    const g = newGame();
    g.level = 3;
    g.cash = 1e9;
    expect(A.openHub(g, 'BCN').ok).toBe(true);
    const offer = g.market.leases.find((o) => o.typeId === 'a320neo')!;
    A.leaseAircraft(g, offer.id, 'MAD');
    const ac = g.fleet[0];
    ac.status = 'active';
    ac.condition = 60;
    expect(A.transferAircraft(g, ac.id, 'BCN').ok).toBe(true);
    for (let i = 0; i < 5; i++) advanceDay(g);
    expect(ac.status).toBe('active');
    expect(ac.condition).toBeLessThanOrEqual(60);
  });

  it('prevents assigning an aircraft beyond its range', () => {
    const g = newGame();
    const offer = g.market.leases.find((o) => o.typeId === 'atr72')!;
    A.leaseAircraft(g, offer.id, 'MAD');
    const r = A.openRoute(g, 'MAD', 'TFS'); // ~1,800 km, beyond ATR 72 range
    expect(A.assignAircraft(g, g.fleet[0].id, r.routeId!, 5).ok).toBe(false);
  });
});

describe('simulation', () => {
  function playBot(g: GameState, days: number) {
    const hub = g.hubs[0].code;
    const dests = AIRPORTS.filter((a) => a.region === AIRPORT_BY_CODE[hub].region && a.code !== hub && distance(hub, a.code) > 200)
      .sort((a, b) => baseDemand(hub, b.code) - baseDemand(hub, a.code)).slice(0, 4);
    for (const d of dests) {
      const offer = g.market.leases.find((o) => AIRCRAFT_BY_ID[o.typeId].rangeKm > distance(hub, d.code) && !A.canFly(AIRCRAFT_BY_ID[o.typeId], hub, d.code));
      if (!offer || !A.leaseAircraft(g, offer.id, hub).ok) continue;
      const r = A.openRoute(g, hub, d.code);
      if (r.ok) A.assignAircraft(g, g.fleet[g.fleet.length - 1].id, r.routeId!, A.suggestFreq(g, g.fleet[g.fleet.length - 1], r.routeId!));
    }
    for (let i = 0; i < days; i++) {
      advanceDay(g);
      for (const dcs of [...g.decisions]) A.resolveDecision(g, dcs.id, dcs.options[0].id);
      g.yearReview = null;
    }
  }

  it('stays numerically sound over three years', () => {
    const g = newGame('SYD', 7);
    playBot(g, 365 * 3);
    expect(findNaN(g)).toBeNull();
    expect(g.gameOver).toBeNull();
    expect(Number.isFinite(equity(g))).toBe(true);
  });

  it('a sensible small airline turns a profit', () => {
    const g = newGame('MAD', 3);
    playBot(g, 240);
    const last3 = g.finance.history.slice(-3).reduce((s, m) => s + monthProfit(m), 0);
    expect(last3).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = newGame('JFK', 11);
    const b = newGame('JFK', 11);
    playBot(a, 200);
    playBot(b, 200);
    expect(a.cash).toBeCloseTo(b.cash, 4);
    expect(a.messages.length).toBe(b.messages.length);
  });
});

describe('economy & pacing', () => {
  it('inflates costs every January while market fares follow only partly', () => {
    const g = newGame();
    const r = openRoute(g, 'BCN');
    const fare = r.prices.Y;
    const market = marketFare(g, r.dist, 'Y');
    while (yearOf(g.day) === 2026) advanceDay(g);
    expect(g.inflation.cost).toBeGreaterThan(1.015);
    expect(g.inflation.fare).toBeGreaterThan(1);
    expect(g.inflation.fare).toBeLessThan(g.inflation.cost);
    expect(r.prices.Y).toBe(fare); // fares set by hand stay put until re-priced
    expect(marketFare(g, r.dist, 'Y')).toBeGreaterThan(market);
  });

  it('forecasts classic beginner mistakes as losses', () => {
    const g = newGame();
    g.level = 4;
    g.cash = 300_000_000;
    // A widebody shuttling on a short route.
    const short = openRoute(g, 'BCN');
    const wide = leaseType(g, 'b789');
    expect(A.assignAircraft(g, wide.id, short.id, A.maxFreqFor(g, wide, short.id)).ok).toBe(true);
    expect(forecastRoute(g, short, routeSupply(g, short, false)).profitPerDay).toBeLessThan(0);
    // Fares 40% above market on a sensibly flown narrowbody route.
    const r = openRoute(g, 'LIS');
    const nb = leaseType(g, 'a320neo');
    A.assignAircraft(g, nb.id, r.id, A.suggestFreq(g, nb, r.id));
    const fair = forecastRoute(g, r, routeSupply(g, r, false));
    for (const c of ['F', 'J', 'W', 'Y'] as const) r.prices[c] = Math.round(r.prices[c] * 1.4);
    const greedy = forecastRoute(g, r, routeSupply(g, r, false));
    expect(greedy.profitPerDay).toBeLessThan(0);
    expect(greedy.profitPerDay).toBeLessThan(fair.profitPerDay);
    expect(greedy.loadFactor).toBeLessThan(fair.loadFactor);
  });

  it('previews an aircraft on a route without touching the game', () => {
    const g = newGame();
    const r = openRoute(g, 'BCN');
    const before = JSON.stringify(g);
    const p = A.previewAircraft(g, 'a320neo', r.id);
    expect(p).not.toBeNull();
    expect(p!.freq).toBeGreaterThan(0);
    expect(p!.forecast.loadFactor).toBeGreaterThan(0.3);
    expect(Number.isFinite(p!.gainMonthly)).toBe(true);
    expect(JSON.stringify(g)).toBe(before);
    expect(A.previewAircraft(g, 'atr42', openRoute(g, 'TFS').id)).toBeNull(); // out of range
  });

  it('passive play does not snowball', () => {
    const g = newGame('MAD', 4);
    for (const [to, type] of [['BCN', 'a220_100'], ['PMI', 'a220_100'], ['LIS', 'a220_100']] as const) {
      const r = openRoute(g, to);
      const ac = leaseType(g, type);
      A.assignAircraft(g, ac.id, r.id, A.suggestFreq(g, ac, r.id));
      r.prices = optimizePrices(g, r, routeSupply(g, r, false));
    }
    const yearResult = () => {
      const xp0 = g.xp;
      const goals0 = g.completedGoals.length;
      let profit = 0;
      runMonths(g, 12);
      for (const m of g.finance.history.slice(-12)) profit += monthProfit(m) - m.rev.other + m.exp.other + m.exp.training;
      const goalXp = g.completedGoals.slice(goals0).reduce((s, id) => s + GOAL_BY_ID[id].reward.xp, 0);
      return { profit, xp: g.xp - xp0 - goalXp };
    };
    const y1 = yearResult();
    const y2 = yearResult();
    const y3 = yearResult();
    expect(g.gameOver).toBeNull();
    // Costs inflate and rivals react, so an airline left alone earns less every year…
    expect(y2.profit).toBeLessThan(y1.profit);
    expect(y3.profit).toBeLessThan(y1.profit * 0.8);
    // …and flying the same schedule earns almost no experience.
    expect(y2.xp).toBeLessThan(800);
    expect(y3.xp).toBeLessThan(800);
  });
});

describe('alerts', () => {
  it('are cleared at the start of every day', () => {
    const g = newGame();
    g.alerts.push({ kind: 'cash', title: 'x', body: '', msgId: 'm', count: 1 });
    advanceDay(g);
    expect(g.alerts.every((a) => a.title !== 'x')).toBe(true);
  });

  it('flag low cash once and re-arm after recovery', () => {
    const g = newGame();
    leaseType(g, 'a320neo');
    g.cash = fixedMonthlyCosts(g) * 0.5;
    advanceDay(g);
    expect(g.alerts.map((a) => a.kind)).toContain('cash');
    advanceDay(g);
    expect(g.alerts.some((a) => a.kind === 'cash')).toBe(false);
  });

  it('warn when rivals attack a lucrative route, and are rate-limited', () => {
    const g = newGame();
    const r = openRoute(g, 'BCN');
    const ac = leaseType(g, 'a320neo');
    A.assignAircraft(g, ac.id, r.id, 21);
    // Eight weeks of fat margins and full aircraft.
    for (let w = 0; w < 8; w++) r.history.push({ week: w, pax: 4900, seats: 5000, rev: 2_000_000, cost: 600_000, connPax: 0 });
    const level = competition(g, r.from, r.to).level;
    let raised = 0;
    for (let i = 0; i < 12 && raised === 0; i++) {
      g.alerts = [];
      rivalReactions(g);
      raised = g.alerts.filter((a) => a.kind === 'competition').length;
    }
    expect(raised).toBe(1);
    const c = competition(g, r.from, r.to);
    expect(c.level > level || c.priceIdx < 1).toBe(true);
    // A second strike right away is suppressed: same route is on cooldown, and the alert kind too.
    g.alerts = [];
    for (let i = 0; i < 5; i++) rivalReactions(g);
    expect(g.alerts.length).toBe(0);
  });

  it('never change with game speed: the same days give the same alerts', () => {
    const a = newGame('JFK', 3);
    const b = newGame('JFK', 3);
    const log = (g: GameState) => {
      const out: string[] = [];
      const r = openRoute(g, 'BOS');
      A.assignAircraft(g, leaseType(g, 'a320neo').id, r.id, 20);
      for (let i = 0; i < 200; i++) {
        advanceDay(g);
        for (const x of g.alerts) out.push(`${g.day}:${x.kind}:${x.title}`);
      }
      return out;
    };
    expect(log(a)).toEqual(log(b));
  });
});

describe('save games', () => {
  it('round-trips through serialisation and keeps simulating identically', () => {
    const g = newGame('DXB', 5);
    const offer = g.market.leases[0];
    A.leaseAircraft(g, offer.id, 'DXB');
    for (let i = 0; i < 40; i++) advanceDay(g);
    const copy = deserialize(serialize(g));
    expect(copy).toEqual(g);
    for (let i = 0; i < 30; i++) {
      advanceDay(g);
      advanceDay(copy);
    }
    expect(copy.cash).toBeCloseTo(g.cash, 6);
  });

  it('loads saves from before the rebalance', () => {
    const g = newGame('DXB', 5);
    leaseType(g, 'a320neo');
    for (let i = 0; i < 40; i++) advanceDay(g);
    const old = JSON.parse(serialize(g));
    delete old.state.inflation;
    delete old.state.alerts;
    delete old.state.stats.bestMonthPax;
    delete old.state.stats.bestMonthProfit;
    const copy = deserialize(JSON.stringify(old));
    expect(copy.inflation.cost).toBe(1);
    expect(copy.inflation.relief).toBeGreaterThan(0); // a fading discount while the airline adapts
    expect(copy.alerts).toEqual([]);
    for (let i = 0; i < 400; i++) advanceDay(copy);
    expect(findNaN(copy)).toBeNull();
    expect(copy.inflation.relief).toBe(0);
  });

  it('rejects foreign files', () => {
    expect(() => deserialize('{"hello":1}')).toThrow();
    expect(() => deserialize('not json')).toThrow();
  });
});
