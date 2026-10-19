// Balance scenarios: a cautious beginner (T1), naive mistakes (T2) and an idle airline (T3).
// Run with `npx tsx scripts/scenarios.ts [hub] [seed] [difficulty] [t1,t2,t3]`.

import { AIRCRAFT_BY_ID } from '../src/data/aircraft';
import { AIRPORTS } from '../src/data/airports';
import * as A from '../src/engine/actions';
import { defaultCabin } from '../src/engine/cabin';
import * as D from '../src/engine/demand';
import { aircraftMonthlyCost, monthProfit, monthRevenue, newLeaseRate } from '../src/engine/economy';
import { distance } from '../src/engine/geo';
import { createGame } from '../src/engine/newGame';
import { advanceDay } from '../src/engine/sim';
import { newId } from '../src/engine/state';
import type { Difficulty, GameState, MonthFinance, Route } from '../src/engine/types';

const hub = process.argv[2] ?? 'MAD';
const seed = Number(process.argv[3] ?? 7);
const difficulty = (process.argv[4] ?? 'normal') as Difficulty;
const only = (process.argv[5] ?? 't1,t2,t3').split(',');

const M = (v: number) => `${(v / 1e6).toFixed(2)}M`.padStart(7);
const P = (v: number) => `${Math.round(v * 100)}%`.padStart(4);

function game(): GameState {
  return createGame({ name: 'Scenario Air', code: 'SC', ceo: 'S', hub, difficulty, seed, livery: { primary: '#000', secondary: '#fff', tail: 'solid' } });
}

/** Best destinations by the planner's opportunity score within a distance band. */
function destinations(s: GameState, n: number, lo: number, hi: number, minMarket = 0, maxMarket = Infinity): string[] {
  return AIRPORTS.filter((a) => !A.routeCheck(s, hub, a.code))
    .map((a) => ({ a, d: distance(hub, a.code), m: D.totalOf(D.marketDemand(s, hub, a.code)) * 2, c: D.competition(s, hub, a.code).level }))
    .filter((x) => x.d >= lo && x.d <= hi && x.m >= minMarket && x.m <= maxMarket)
    .sort((x, y) => y.m / (0.5 + y.c) - x.m / (0.5 + x.c))
    .slice(0, n)
    .map((x) => x.a.code);
}

/** Lease a new aircraft, creating a lessor offer if the market has none. */
function lease(s: GameState, typeId: string): string | null {
  let offer = s.market.leases.find((o) => o.typeId === typeId && o.isNew);
  if (!offer) {
    offer = {
      id: newId(s, 'l'), typeId, isNew: true, builtDay: s.day, condition: 100, monthly: newLeaseRate(AIRCRAFT_BY_ID[typeId]),
      termMonths: 96, deliveryDays: 14, qty: 1, lessor: 'Scenario Leasing', expiresDay: s.day + 60,
    };
    s.market.leases.push(offer);
  }
  offer.deliveryDays = Math.min(offer.deliveryDays, 21);
  const res = A.leaseAircraft(s, offer.id, hub, defaultCabin(AIRCRAFT_BY_ID[typeId]));
  return res.ok ? s.fleet[s.fleet.length - 1].id : null;
}

function route(s: GameState, to: string): Route {
  return routeIn(s, to);
}

function routeIn(s: GameState, to: string): Route {
  const existing = s.routes.find((r) => r.to === to);
  if (existing) return existing;
  const r = A.openRoute(s, hub, to);
  if (!r.ok) throw new Error(`${hub}-${to}: ${r.error}`);
  return s.routes.find((x) => x.id === r.routeId)!;
}

interface Fc { lf: number; rev: number; profit?: number }
function forecast(s: GameState, r: Route): Fc {
  const fc = D.forecastRoute(s, r, D.routeSupply(s, r, false)) as D.Forecast & { profitPerDay?: number };
  return { lf: fc.loadFactor, rev: fc.revenuePerDay * 30, profit: fc.profitPerDay !== undefined ? fc.profitPerDay * 30 : undefined };
}

function deliver(s: GameState) {
  // Skip the delivery wait so scenarios start flying on day 1.
  for (const ac of s.fleet) if (ac.status === 'delivering') ac.statusUntil = s.day;
}

const alertLog = new WeakMap<GameState, string[]>();
const alertCount = (s: GameState) => alertLog.get(s)?.length ?? 0;

function runMonths(s: GameState, months: number, each?: (m: MonthFinance, i: number) => void) {
  const start = s.finance.history.length;
  while (s.finance.history.length < start + months && !s.gameOver) {
    advanceDay(s);
    if (s.alerts?.length) {
      const log = alertLog.get(s) ?? [];
      for (const a of s.alerts) log.push(`${a.kind}: ${a.title}`);
      alertLog.set(s, log);
    }
    for (const d of [...s.decisions]) A.resolveDecision(s, d.id, d.options[d.options.length - 1].id);
    s.yearReview = null;
    if (s.finance.history.length > start && each) {
      const i = s.finance.history.length - start - 1;
      if ((s as { _seen?: number })._seen !== s.finance.history.length) {
        (s as { _seen?: number })._seen = s.finance.history.length;
        each(s.finance.history[s.finance.history.length - 1], i);
      }
    }
  }
}

function weekLf(s: GameState, weeks = 4): number {
  let pax = 0, seats = 0;
  for (const r of s.routes) for (const w of r.history.slice(-weeks)) { pax += w.pax; seats += w.seats; }
  return seats > 0 ? pax / seats : 0;
}


// ---------- T1: cautious beginner ----------

function t1(label: string, typeId: string, freqMode: 'suggest' | 21, fareMult = 1, nRoutes = 2) {
  const s = game();
  const dests = destinations(s, nRoutes, 300, 1600);
  const fcs: Fc[] = [];
  for (const d of dests) {
    const r = route(s, d);
    const id = lease(s, typeId);
    if (!id) { console.log('  lease failed'); continue; }
    deliver(s);
    const ac = s.fleet.find((a) => a.id === id)!;
    const f = freqMode === 'suggest' ? A.suggestFreq(s, ac, r.id) : Math.min(21, A.maxFreqFor(s, ac, r.id));
    A.assignAircraft(s, id, r.id, f);
    if (fareMult !== 1) for (const c of ['F', 'J', 'W', 'Y'] as const) r.prices[c] = Math.round(r.prices[c] * fareMult);
    fcs.push(forecast(s, r));
  }
  const freqs = s.routes.map((r) => s.fleet.reduce((t, a) => t + (a.assignments.find((x) => x.routeId === r.id)?.freq ?? 0), 0));
  console.log(`T1 ${label}: ${s.routes.map((r, i) => `${r.from}-${r.to} ${r.dist}km ${freqs[i]}/wk`).join(', ')}`);
  console.log(`  forecast LF ${fcs.map((f) => P(f.lf)).join(' ')}  profit/mo ${fcs.map((f) => (f.profit !== undefined ? M(f.profit) : 'n/a')).join(' ')}`);
  const rows: string[] = [];
  let sumP = 0, sumR = 0, neg = 0, lfSum = 0;
  runMonths(s, 12, (m) => {
    // Operating result: goal rewards and start-up one-offs (training, cabin fit-out) left out.
    const p = monthProfit(m) - m.rev.other + m.exp.other + m.exp.training;
    const rev = monthRevenue(m) - m.rev.other;
    sumP += p; sumR += rev; if (p < 0) neg++;
    const lf = weekLf(s);
    lfSum += lf;
    rows.push(`${P(lf)} ${M(p)}`);
  });
  console.log(`  months (LF profit): ${rows.join(' |')}`);
  console.log(`  => avg LF ${P(lfSum / 12)} avg profit/mo ${M(sumP / 12)} margin ${P(sumP / sumR)} neg months ${neg} cash ${M(s.cash)} lvl ${s.level} xp ${Math.round(s.xp)} alerts ${alertCount(s)}`);
  const h = s.finance.history.at(-1)!;
  console.log('  last month', Object.entries({ ...h.rev, ...h.exp }).filter(([, v]) => v > 1000).map(([k, v]) => `${k} ${Math.round(v / 1e3)}K`).join(', '));
}

// ---------- T2: naive play ----------

function t2(label: string, setup: (s: GameState) => Route[] | null) {
  const s = game();
  s.level = Math.max(s.level, 4);
  s.cash = 120_000_000;
  const routes = setup(s);
  if (!routes) { console.log(`T2 ${label.padEnd(34)} (no suitable route from ${hub})`); return; }
  deliver(s);
  const fcs = routes.map((r) => forecast(s, r));
  const rows: string[] = [];
  runMonths(s, 3, (m) => rows.push(M(monthProfit(m) - m.rev.other)));
  const lf = weekLf(s);
  // Route result over the last four weeks, net of the aircraft's lease and overhead.
  const own = (r: Route) => s.fleet.filter((a) => a.assignments.some((x) => x.routeId === r.id)).reduce((t, a) => t + aircraftMonthlyCost(s, a), 0);
  const routeProfit = routes.map((r) => r.history.slice(-4).reduce((t, w) => t + w.rev - w.cost, 0) * 30 / 28 - own(r));
  console.log(`T2 ${label.padEnd(34)} ${routes.map((r) => `${r.to} ${r.dist}km`).join('/')} | forecast LF ${fcs.map((f) => P(f.lf)).join('/')} profit/mo ${fcs.map((f) => (f.profit !== undefined ? M(f.profit) : 'n/a')).join('/')} | actual LF ${P(lf)} profit/mo ${routeProfit.map(M).join('/')} | airline op. profit/mo ${rows.join(' ')}`);
}

function assignMax(s: GameState, acId: string | null, r: Route, cap = 99) {
  if (!acId) { console.log('  lease failed'); return; }
  const ac = s.fleet.find((a) => a.id === acId)!;
  A.assignAircraft(s, acId, r.id, Math.min(cap, A.maxFreqFor(s, ac, r.id)));
}

function t2all() {
  t2('787-9 on a short route, max freq', (s) => {
    const r = route(s, destinations(s, 1, 300, 800)[0]);
    assignMax(s, lease(s, 'b789'), r);
    return [r];
  });
  t2('A350 on a short route, 14/wk', (s) => {
    const r = route(s, destinations(s, 1, 300, 800)[0]);
    assignMax(s, lease(s, 'a359'), r, 14);
    return [r];
  });
  t2('4x A320neo on one thin route', (s) => {
    const d = destinations(s, 1, 300, 1200, 150, 500)[0] ?? destinations(s, 1, 300, 1600, 100, 900)[0];
    if (!d) return null;
    const r = route(s, d);
    for (let i = 0; i < 4; i++) assignMax(s, lease(s, 'a320neo'), r);
    return [r];
  });
  t2('A320neo, fares +40%', (s) => {
    const r = route(s, destinations(s, 1, 300, 1600)[0]);
    assignMax(s, lease(s, 'a320neo'), r, 21);
    for (const c of ['F', 'J', 'W', 'Y'] as const) r.prices[c] = Math.round(r.prices[c] * 1.4);
    return [r];
  });
  t2('787-9 half-empty medium haul, 7/wk', (s) => {
    const d = destinations(s, 1, 1500, 3500, 0, 900)[0] ?? destinations(s, 1, 1200, 4000, 0, 1500)[0];
    if (!d) return null;
    const r = route(s, d);
    assignMax(s, lease(s, 'b789'), r, 7);
    return [r];
  });
}

// ---------- T3: idle airline ----------

/** Per-route view of the last eight weeks (set ROUTES=1). */
function routeDetail(s: GameState) {
  for (const r of s.routes) {
    const h = r.history.slice(-8);
    const sum = (f: (w: (typeof h)[number]) => number) => h.reduce((t, w) => t + f(w), 0);
    const rev = sum((w) => w.rev), cost = sum((w) => w.cost);
    const sup = D.routeSupply(s, r, false);
    const own = D.routeFlightCost(s, r, sup.aircraft).ownership * 7 * h.length;
    const c = D.competition(s, r.from, r.to);
    const depth = D.marketDepth(D.totalOf(D.marketDemand(s, r.from, r.to)), r.dist);
    console.log(`    ${r.from}-${r.to} ${r.dist}km LF ${P(sum((w) => w.pax) / Math.max(1, sum((w) => w.seats)))} margin ${P((rev - cost - own) / Math.max(1, rev))} ` +
      `L ${c.level.toFixed(2)}/${D.baseCompetition(r.from, r.to).toFixed(2)} pIdx ${c.priceIdx.toFixed(2)} fare ${D.fareRatio(s, r).toFixed(2)} x ${(sup.weightedFlights / depth).toFixed(2)} depth ${depth.toFixed(1)}`);
  }
}

const STARTER_TYPES = ['a320neo', 'b38m', 'a220_300', 'a220_100', 'e195e2', 'e190e2', 'atr72'];

/**
 * A sane builder: each new aircraft goes where the planner forecasts the biggest profit gain
 * (new or existing route, best-suited starter type), skipping anything forecast to lose money.
 */
function buildSane(s: GameState, dests: string[], target: number): number {
  let placed = 0;
  while (s.fleet.length < target) {
    let best: { to: string; typeId: string; gain: number; freq: number } | null = null;
    for (const to of dests) {
      // Plan on a copy so trial routes cost nothing.
      const tmp = structuredClone(s);
      const r = routeIn(tmp, to);
      for (const typeId of STARTER_TYPES) {
        if (AIRCRAFT_BY_ID[typeId].minLevel > s.level) continue;
        const p = A.previewAircraft(tmp, typeId, r.id);
        if (p && p.gainMonthly > 0 && (!best || p.gainMonthly > best.gain)) best = { to, typeId, gain: p.gainMonthly, freq: p.freq };
      }
    }
    if (!best) break;
    const r = route(s, best.to);
    const id = lease(s, best.typeId);
    if (!id) break;
    deliver(s);
    A.assignAircraft(s, id, r.id, best.freq);
    r.prices = D.optimizePrices(s, r, D.routeSupply(s, r, false));
    placed++;
  }
  return placed;
}

function t3() {
  const s = game();
  const dests = destinations(s, 15, 250, 2500);
  buildSane(s, dests, 3);
  runMonths(s, 2);
  buildSane(s, dests, 6);
  runMonths(s, 2);
  buildSane(s, dests, 6);
  const fleet = s.fleet.map((a) => `${a.typeId}@${a.assignments.map((x) => `${s.routes.find((r) => r.id === x.routeId)?.to}x${x.freq}`).join('+')}`);
  console.log(`T3 idle from ${hub}: ${fleet.join(' ')}; then no decisions for 5 years`);
  for (let y = 0; y < 5; y++) {
    const xp0 = s.xp;
    const a0 = alertCount(s);
    let p = 0, rev = 0, neg = 0;
    runMonths(s, 12, (m) => { const mp = monthProfit(m) - m.rev.other; p += mp; rev += monthRevenue(m) - m.rev.other; if (mp < 0) neg++; });
    const comp = s.routes.map((r) => D.competition(s, r.from, r.to));
    console.log(`  year ${y + 1}: op. profit ${M(p)} margin ${P(rev ? p / rev : 0)} neg months ${String(neg).padStart(2)} LF ${P(weekLf(s, 13))} cash ${M(s.cash)} ` +
      `lvl ${s.level} xp +${String(Math.round(s.xp - xp0)).padStart(5)} rep ${s.reputation.toFixed(0)} comp ${comp.map((c) => `${c.level.toFixed(1)}${c.priceIdx < 0.95 ? '$' : ''}`).join('/')} ` +
      `alerts +${alertCount(s) - a0}${s.gameOver ? ' GAME OVER' : ''}`);
    if (process.env.ROUTES) routeDetail(s);
    if (s.gameOver) break;
  }
  if (process.env.ALERTS) console.log(alertLog.get(s)?.join('\n'));
}

console.log(`=== ${hub} seed ${seed} ${difficulty} ===`);
if (only.includes('t1')) {
  t1('2x A320neo, suggested freq', 'a320neo', 'suggest');
  t1('2x A320neo, 21/wk', 'a320neo', 21);
}
if (only.includes('t2')) t2all();
if (only.includes('t3')) t3();
