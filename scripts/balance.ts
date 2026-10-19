// Headless balance check: a reasonably skilled bot plays the game for several years and prints a
// progress report. Run with `npm run balance -- [hub] [years] [difficulty] [seed]`.
// The bot plans with the same forecasts the player sees: it adds the aircraft type and route the
// planner rates best, re-prices weekly, re-tunes frequencies, closes losers, hands back aircraft that
// no longer pay their way (e.g. after rivals pile in) and renews old aircraft.

import { AIRCRAFT_BY_ID } from '../src/data/aircraft';
import { AIRPORTS, AIRPORT_BY_CODE } from '../src/data/airports';
import { REGIONS } from '../src/data/regions';
import * as A from '../src/engine/actions';
import { cabinSeats, defaultCabin } from '../src/engine/cabin';
import { baseDemand, competition, optimizePrices, routeSupply, totalOf } from '../src/engine/demand';
import {
  MAX_WEEKLY_HOURS, aircraftMonthlyCost, ageYears, creditRating, fixedMonthlyCosts, leaseCapacity, leaseCommitments, monthProfit, monthRevenue, trainingCost,
} from '../src/engine/economy';
import { airlineRank } from '../src/engine/market';
import { createGame } from '../src/engine/newGame';
import { LONG_HAUL_FEE, continentUnlock, maxHubs, regionUnlock } from '../src/engine/progression';
import { advanceDay } from '../src/engine/sim';
import { homeContinent, isHub } from '../src/engine/state';
import type { Aircraft, GameState } from '../src/engine/types';
import { formatDate } from '../src/engine/util';

const hub = process.argv[2] ?? 'MAD';
const years = Number(process.argv[3] ?? 8);
const difficulty = (process.argv[4] ?? 'normal') as 'easy' | 'normal' | 'hard';
const seed = Number(process.argv[5] ?? 42);
const quiet = process.env.QUIET === '1';

const state = createGame({
  name: 'Bot Air', code: 'BT', ceo: 'Bot', hub, difficulty, seed,
  livery: { primary: '#2266ff', secondary: '#ffffff', tail: 'solid' },
});

/** Types the bot considers for a distance (few families keeps training and overhead down). */
function typesFor(s: GameState, dist: number): string[] {
  const ids = dist < 700 ? ['atr72', 'a220_100', 'a220_300', 'a320neo']
    : dist < 3500 ? ['a220_100', 'a220_300', 'a320neo', 'a321neo']
    : dist < 7000 ? ['a321xlr', 'a321neo', 'a320neo', 'b788', 'b789']
    : ['b788', 'b789', 'a359', 'b77w'];
  return ids.filter((id) => AIRCRAFT_BY_ID[id].minLevel <= s.level && AIRCRAFT_BY_ID[id].rangeKm >= dist);
}

const fixed = (s: GameState) => fixedMonthlyCosts(s);
const reserve = (s: GameState) => 2.5 * fixed(s) + 4_000_000;
const families = (s: GameState) => new Set(s.fleet.map((a) => AIRCRAFT_BY_ID[a.typeId].family));

/** One-off and monthly cost of adding a type the airline doesn't fly yet, spread over two years. */
function familyPenalty(s: GameState, typeId: string): number {
  const t = AIRCRAFT_BY_ID[typeId];
  if (families(s).has(t.family)) return 0;
  return (s.familiesTrained.includes(t.family) ? 0 : trainingCost(t) / 24) + (s.fleet.length ? 120_000 : 0);
}

/** Unserved destinations from a hub worth a look: the biggest markets, plus less contested ones. */
function candidateDests(s: GameState, from: string, n: number): string[] {
  const all = AIRPORTS.filter((a) => !A.routeCheck(s, from, a.code))
    .map((a) => ({ code: a.code, m: baseDemand(from, a.code), c: competition(s, from, a.code).level }));
  const top = (score: (x: (typeof all)[number]) => number, k: number) => [...all].sort((x, y) => score(y) - score(x)).slice(0, k).map((x) => x.code);
  return [...new Set([...top((x) => x.m / (0.5 + x.c), n), ...top((x) => x.m / (0.2 + x.c) ** 2, n / 2)])];
}

interface Plan { from: string; to: string; routeId?: string; typeId: string; gain: number }

/** Best new aircraft to add: tries candidate routes and types on a scratch copy of the game. */
function bestPlan(s: GameState): Plan | null {
  const scratch = structuredClone(s);
  scratch.cash = 1e12;
  const options: { from: string; to: string; routeId: string; existing: boolean }[] = [];
  for (const r of s.routes) {
    const w = r.history.slice(-4);
    const seats = w.reduce((t, x) => t + x.seats, 0);
    const lf = seats > 0 ? w.reduce((t, x) => t + x.pax, 0) / seats : 1;
    if (lf > 0.78) options.push({ from: r.from, to: r.to, routeId: r.id, existing: true });
  }
  for (const h of s.hubs) {
    for (const to of candidateDests(s, h.code, 12)) {
      const res = A.openRoute(scratch, h.code, to);
      if (res.ok) options.push({ from: h.code, to, routeId: res.routeId!, existing: false });
    }
  }
  let best: Plan | null = null;
  for (const o of options) {
    const r = scratch.routes.find((x) => x.id === o.routeId)!;
    for (const typeId of typesFor(s, r.dist)) {
      if (!leaseOffer(s, typeId) && !canBuy(s, typeId)) continue;
      const p = A.previewAircraft(scratch, typeId, o.routeId);
      if (!p) continue;
      const gain = p.gainMonthly - familyPenalty(s, typeId) - (o.existing ? 0 : 40_000);
      if (gain > 50_000 && (!best || gain > best.gain)) best = { from: o.from, to: o.to, routeId: o.existing ? o.routeId : undefined, typeId, gain };
    }
  }
  return best;
}

/** Lease offer the bot would take for a type: new, or young and in good shape, delivered soon. */
function leaseOffer(s: GameState, typeId: string) {
  return s.market.leases.filter((o) => o.typeId === typeId && o.deliveryDays < 120 && (o.isNew || o.condition > 70) &&
    leaseCommitments(s) + o.monthly <= leaseCapacity(s))
    .sort((a, b) => a.deliveryDays - b.deliveryDays)[0];
}

/** Cash the bot could put into a purchase: its own above the reserve, plus a 10-year loan while credit is sound. */
function buyingPower(s: GameState): number {
  const rating = creditRating(s);
  const credit = rating === 'AAA' || rating === 'AA' || rating === 'A' ? A.loanTerms(s, 120).max : 0;
  return s.cash - reserve(s) * 1.5 + credit * 0.8;
}

/** Buying ties up a lot of capital, so the bot only buys with plenty to spare (a young airline leases). */
const canBuy = (s: GameState, typeId: string) => buyingPower(s) > 2 * A.newOrderQuote(s, typeId, 1, defaultCabin(AIRCRAFT_BY_ID[typeId])).total;

/** Acquire an aircraft of the type: lease if an offer exists, otherwise buy new (borrowing if needed). */
function acquire(s: GameState, typeId: string, base: string): Aircraft | null {
  const t = AIRCRAFT_BY_ID[typeId];
  const offer = leaseOffer(s, typeId);
  let res: A.Result = { ok: false, error: 'none' };
  if (offer) res = A.leaseAircraft(s, offer.id, base, defaultCabin(t));
  if (!res.ok && canBuy(s, typeId)) {
    const need = A.newOrderQuote(s, typeId, 1, defaultCabin(t)).total + reserve(s) - s.cash;
    if (need > 0) A.takeLoan(s, Math.max(1_000_000, need), 120);
    res = A.orderNew(s, typeId, 1, defaultCabin(t), base);
  }
  return res.ok ? s.fleet[s.fleet.length - 1] : null;
}

function grow(s: GameState) {
  if (s.cash < reserve(s)) return;
  const last = s.finance.history.at(-1);
  if (last && monthProfit(last) < 0 && s.cash < reserve(s) * 2) return;
  const plan = bestPlan(s);
  if (process.env.DEBUG) console.log(formatDate(s.day), 'plan', plan ? `${plan.from}-${plan.to} ${plan.typeId} +${(plan.gain / 1e3).toFixed(0)}K` : 'none', 'cash', fmt(s.cash), 'reserve', fmt(reserve(s)));
  if (!plan) return;
  const ac = acquire(s, plan.typeId, plan.from);
  if (!ac) return;
  let routeId = plan.routeId;
  if (!routeId) {
    const res = A.openRoute(s, plan.from, plan.to);
    if (!res.ok) return;
    routeId = res.routeId!;
  }
  A.assignAircraft(s, ac.id, routeId, A.suggestFreq(s, ac, routeId));
  const r = s.routes.find((x) => x.id === routeId)!;
  r.prices = optimizePrices(s, r, routeSupply(s, r, false));
}

/** Re-tune each schedule to current conditions, then put spare hours where they add the most. */
function tuneSchedules(s: GameState) {
  for (const ac of s.fleet) {
    if (ac.status === 'delivering') continue;
    for (const a of [...ac.assignments]) {
      const f = A.suggestFreq(s, ac, a.routeId);
      if (f !== a.freq) A.assignAircraft(s, ac.id, a.routeId, f);
    }
    if (A.hoursUsed(ac, s) > MAX_WEEKLY_HOURS * 0.75) continue;
    let best: { routeId: string; freq: number; gain: number } | null = null;
    for (const r of s.routes) {
      if (r.from !== ac.hub || ac.assignments.some((x) => x.routeId === r.id) || A.canFly(AIRCRAFT_BY_ID[ac.typeId], r.from, r.to)) continue;
      const before = A.yearlyRouteProfit(s, r.id);
      const f = A.suggestFreq(s, ac, r.id);
      if (f <= 0) continue;
      ac.assignments.push({ routeId: r.id, freq: f });
      const gain = A.yearlyRouteProfit(s, r.id) - before;
      ac.assignments.pop();
      if (gain > 20_000 && (!best || gain > best.gain)) best = { routeId: r.id, freq: f, gain };
    }
    if (best) A.assignAircraft(s, ac.id, best.routeId, best.freq);
  }
}

/** Close routes that keep losing money before aircraft costs or have nothing flying; hand back aircraft left idle. */
function prune(s: GameState) {
  for (const r of [...s.routes]) {
    const h = r.history.slice(-8);
    const served = s.fleet.some((a) => a.assignments.some((x) => x.routeId === r.id && x.freq > 0));
    if ((h.length === 8 && h.reduce((t, w) => t + w.rev - w.cost, 0) < 0) || (!served && s.day - r.createdDay > 28)) A.closeRoute(s, r.id);
  }
  for (const ac of [...s.fleet]) {
    const key = `botIdle:${ac.id}`;
    if (ac.status !== 'active' || ac.assignments.some((a) => a.freq > 0)) {
      delete s.flags[key];
      continue;
    }
    s.flags[key] = (s.flags[key] ?? 0) + 1;
    if (s.flags[key] >= 3) {
      A.sellAircraft(s, ac.id);
      delete s.flags[key];
    }
  }
}

/** What an aircraft actually earned per month over the last eight weeks: its seat share of each route's result. */
function aircraftEarnings(s: GameState, ac: Aircraft): number {
  let total = 0;
  for (const a of ac.assignments) {
    const r = s.routes.find((x) => x.id === a.routeId);
    const h = r?.history.slice(-8) ?? [];
    if (!r || h.length < 8) return Infinity;
    const sup = routeSupply(s, r, false);
    const mine = cabinSeats(AIRCRAFT_BY_ID[ac.typeId], ac.cabin);
    const share = totalOf(sup.seats) > 0 ? (totalOf(mine) * a.freq / 7) / totalOf(sup.seats) : 0;
    total += h.reduce((t, w) => t + w.rev - w.cost, 0) * share * (30 / 56);
  }
  return total;
}

/** Hand back aircraft whose routes no longer pay for them (two monthly checks in a row). */
function shed(s: GameState) {
  for (const ac of [...s.fleet]) {
    const key = `botWeak:${ac.id}`;
    if (ac.status !== 'active' || s.day - ac.acquiredDay < 180 || !ac.assignments.length ||
      aircraftEarnings(s, ac) > 0.6 * aircraftMonthlyCost(s, ac)) {
      delete s.flags[key];
      continue;
    }
    s.flags[key] = (s.flags[key] ?? 0) + 1;
    if (s.flags[key] >= 2) {
      A.sellAircraft(s, ac.id);
      delete s.flags[key];
    }
  }
}

/** Replace a worn-out airframe: acquire a new one of the type, move the schedule over, sell the old. */
function renew(s: GameState) {
  const old = s.fleet.find((a) => a.status === 'active' && ageYears(s, a) > 16 && a.assignments.length > 0);
  if (!old || s.cash < reserve(s)) return;
  const fresh = acquire(s, old.typeId, old.hub);
  if (!fresh) return;
  for (const a of old.assignments) fresh.assignments.push({ ...a });
  A.sellAircraft(s, old.id);
}

function expand(s: GameState) {
  for (const r of REGIONS) {
    if (r.continent !== homeContinent(s)) continue;
    const o = regionUnlock(s, r.id);
    if (o.available && s.cash > o.fee + reserve(s) * 1.5) A.unlockRegion(s, r.id);
  }
  if (!s.licenses.longHaul && s.level >= 5 && s.cash > LONG_HAUL_FEE + reserve(s) * 1.5) A.buyLongHaulLicense(s);
  if (s.licenses.longHaul) {
    for (const c of ['NA', 'EU', 'AS', 'ME', 'SA', 'AF', 'OC'] as const) {
      const o = continentUnlock(s, c);
      if (o.available && s.cash > o.fee + reserve(s) * 2) A.unlockContinent(s, c);
    }
  }
  if (s.hubs.length < maxHubs(s.level) && s.fleet.length > 15 * s.hubs.length && s.cash > 30_000_000 + reserve(s)) {
    const cand = AIRPORTS.filter((a) => s.unlockedRegions.includes(a.region) && !isHub(s, a.code) && a.size >= 4 && a.continent === homeContinent(s))
      .sort((a, b) => b.pop - a.pop)[0];
    if (cand) A.openHub(s, cand.code);
  }
}

function botWeek(s: GameState) {
  for (const d of [...s.decisions]) A.resolveDecision(s, d.id, d.options[0].id);
  // Borrow rather than slide into bankruptcy.
  if (s.cash < 0) A.takeLoan(s, Math.min(A.loanTerms(s, 60).max, -s.cash + fixed(s)), 60);
  const week = Math.floor(s.day / 7);
  if (week % 4 === 0) {
    prune(s);
    tuneSchedules(s);
    shed(s);
    renew(s);
    expand(s);
  }
  if (week % 2 === 0) grow(s);
  for (const r of s.routes) {
    const sup = routeSupply(s, r, false);
    if (totalOf(sup.seats) > 0) r.prices = optimizePrices(s, r, sup);
  }
}

const t0 = Date.now();
const fmt = (v: number) => `${(v / 1e6).toFixed(1)}M`;
const milestones: string[] = [];
let lastLevel = 1;
console.log(`Hub ${hub} (${AIRPORT_BY_CODE[hub].city}), ${difficulty}, seed ${seed}, ${years} years`);
for (let d = 0; d < years * 365; d++) {
  advanceDay(state);
  state.yearReview = null;
  if (state.level > lastLevel) {
    milestones.push(`L${state.level} ${formatDate(state.day)}`);
    lastLevel = state.level;
  }
  if (state.day % 7 === 1) botWeek(state);
  if (process.env.DEBUG && state.day % 30 === 0) {
    for (const r of state.routes) {
      const h = r.history.slice(-4);
      const rev = h.reduce((t, w) => t + w.rev, 0), cost = h.reduce((t, w) => t + w.cost, 0), pax = h.reduce((t, w) => t + w.pax, 0), seats = h.reduce((t, w) => t + w.seats, 0);
      const acs = state.fleet.filter((a) => a.assignments.some((x) => x.routeId === r.id)).map((a) => `${a.typeId}x${a.assignments.find((x) => x.routeId === r.id)!.freq}`);
      const c = competition(state, r.from, r.to);
      console.log(`   ${r.from}-${r.to} ${r.dist}km ${acs.join(',')} LF ${(pax / Math.max(1, seats) * 100).toFixed(0)}% contrib/4wk ${fmt(rev - cost)} yearly ${fmt(A.yearlyRouteProfit(state, r.id))} comp ${c.level.toFixed(2)}/${c.priceIdx.toFixed(2)}`);
    }
  }
  if (state.gameOver) {
    console.log('GAME OVER', formatDate(state.day), state.gameOver.reason);
    break;
  }
  if (state.day % 365 === 0 || (!quiet && state.day % 91 === 0)) {
    const last3 = state.finance.history.slice(-3);
    const profit = last3.reduce((s, m) => s + monthProfit(m) - m.rev.other, 0) / Math.max(1, last3.length);
    const rev = last3.reduce((s, m) => s + monthRevenue(m) - m.rev.other, 0) / Math.max(1, last3.length);
    const lf = state.routes.reduce((s, r) => s + (r.history.at(-1)?.pax ?? 0), 0) /
      Math.max(1, state.routes.reduce((s, r) => s + (r.history.at(-1)?.seats ?? 0), 0));
    const negMonths = state.finance.history.slice(-12).filter((m) => monthProfit(m) < 0).length;
    console.log(
      `${formatDate(state.day).padEnd(12)} lvl ${state.level} xp ${Math.round(state.xp).toString().padStart(7)} cash ${fmt(state.cash).padStart(8)} ` +
      `fleet ${String(state.fleet.length).padStart(3)} routes ${String(state.routes.length).padStart(3)} regions ${state.unlockedRegions.length} hubs ${state.hubs.length} ` +
      `rev/mo ${fmt(rev).padStart(7)} op.profit/mo ${fmt(profit).padStart(7)} (${rev ? Math.round((profit / rev) * 100) : 0}%) neg/12 ${negMonths} ` +
      `LF ${(lf * 100).toFixed(0)}% rep ${state.reputation.toFixed(0)} debt ${fmt(state.loans.reduce((s, l) => s + l.balance, 0))} ${creditRating(state)} ` +
      `rank ${airlineRank(state)} goals ${state.completedGoals.length}`,
    );
  }
}
const elapsed = Date.now() - t0;
console.log(`Levels: ${milestones.join(', ')}`);
console.log(`Simulated ${state.day} days in ${elapsed} ms (${(elapsed / Math.max(1, state.day)).toFixed(2)} ms/day)`);
if (!quiet) {
  const top = [...state.routes].sort((a, b) => (b.lifetime.rev - b.lifetime.cost) - (a.lifetime.rev - a.lifetime.cost)).slice(0, 6);
  for (const r of top) {
    const w = r.history.at(-1);
    console.log(`  ${r.from}-${r.to} ${r.dist}km profit ${fmt(r.lifetime.rev - r.lifetime.cost)} LF ${w ? ((w.pax / Math.max(1, w.seats)) * 100).toFixed(0) : '-'}% conn ${w?.connPax ?? 0}`);
  }
  const types = new Map<string, number>();
  for (const a of state.fleet) types.set(a.typeId, (types.get(a.typeId) ?? 0) + 1);
  console.log('fleet', Object.fromEntries(types));
  const m = state.finance.history.at(-1);
  if (m) console.log('last month', Object.fromEntries(Object.entries({ ...m.rev, ...m.exp }).filter(([, v]) => v > 0).map(([k, v]) => [k, fmt(v)])));
}
if (process.env.SAVE_OUT) {
  const { writeFileSync } = await import('node:fs');
  const { serialize } = await import('../src/engine/save');
  state.yearReview = null;
  state.decisions = [];
  writeFileSync(process.env.SAVE_OUT, serialize(state));
  console.log('saved', process.env.SAVE_OUT);
}
