// Headless balance check: a simple bot plays the game for several years and
// prints a progress report. Run with `npm run balance -- [hub] [years] [difficulty]`.

import { AIRCRAFT_BY_ID, type AircraftType } from '../src/data/aircraft';
import { AIRPORTS, AIRPORT_BY_CODE } from '../src/data/airports';
import { REGIONS } from '../src/data/regions';
import * as A from '../src/engine/actions';
import { defaultCabin } from '../src/engine/cabin';
import { baseDemand, optimizePrices, routeSupply, totalOf } from '../src/engine/demand';
import { creditRating, monthProfit, monthRevenue } from '../src/engine/economy';
import { distance } from '../src/engine/geo';
import { airlineRank } from '../src/engine/market';
import { createGame } from '../src/engine/newGame';
import { LONG_HAUL_FEE, continentUnlock, maxHubs, regionUnlock } from '../src/engine/progression';
import { advanceDay } from '../src/engine/sim';
import { homeContinent, isHub } from '../src/engine/state';
import type { GameState } from '../src/engine/types';
import { formatDate } from '../src/engine/util';

const hub = process.argv[2] ?? 'MAD';
const years = Number(process.argv[3] ?? 8);
const difficulty = (process.argv[4] ?? 'normal') as 'easy' | 'normal' | 'hard';

const state = createGame({
  name: 'Bot Air', code: 'BT', ceo: 'Bot', hub, difficulty, seed: 42,
  livery: { primary: '#2266ff', secondary: '#ffffff', tail: 'solid' },
});

function pickType(dist: number, s: GameState): AircraftType {
  const ids = dist < 500 ? ['atr72'] : dist < 3000 ? ['a320neo'] : dist < 6500 ? ['a321xlr', 'a321neo'] : ['b789', 'a359'];
  for (const id of ids) {
    const t = AIRCRAFT_BY_ID[id];
    if (t.minLevel <= s.level && t.rangeKm >= dist) return t;
  }
  return AIRCRAFT_BY_ID['a320neo'];
}

function botWeek(s: GameState) {
  // Expansion
  for (const r of REGIONS) {
    if (r.continent !== homeContinent(s)) continue;
    const o = regionUnlock(s, r.id);
    if (o.available && s.cash > o.fee * 2.5) A.unlockRegion(s, r.id);
  }
  if (!s.licenses.longHaul && s.level >= 5 && s.cash > LONG_HAUL_FEE * 3) A.buyLongHaulLicense(s);
  if (s.licenses.longHaul) {
    for (const c of ['NA', 'AS', 'ME', 'SA', 'AF', 'OC', 'EU'] as const) {
      const o = continentUnlock(s, c);
      if (o.available && s.cash > o.fee * 2.5) A.unlockContinent(s, c);
    }
  }
  if (s.hubs.length < maxHubs(s.level) && s.cash > 60_000_000) {
    const cand = AIRPORTS.filter((a) => s.unlockedRegions.includes(a.region) && !isHub(s, a.code) && a.size >= 4 &&
      a.continent === homeContinent(s))
      .sort((a, b) => b.pop - a.pop)[0];
    if (cand) A.openHub(s, cand.code);
  }

  // Open routes from hubs to the best unserved markets
  const maxRoutes = 3 + s.fleet.length * 0.8;
  if (s.routes.length < maxRoutes) {
    for (const h of s.hubs) {
      const cands = AIRPORTS.filter((a) => !A.routeCheck(s, h.code, a.code))
        .map((a) => ({ a, d: baseDemand(h.code, a.code) }))
        .sort((x, y) => y.d - x.d);
      const best = cands[0];
      if (best && best.d > 60 && s.cash > 5_000_000) A.openRoute(s, h.code, best.a.code);
    }
  }

  // Fleet: add capacity where loads are high
  for (const r of [...s.routes].sort((x, y) => baseDemand(y.from, y.to) - baseDemand(x.from, x.to))) {
    const sup = routeSupply(s, r, false);
    const seats = totalOf(sup.seats) * 2;
    const w = r.history.at(-1);
    const lf = w && w.seats > 0 ? w.pax / w.seats : 1;
    if (seats > 0 && (lf < 0.82 || !w)) continue;
    const t = pickType(r.dist, s);
    const cur = (ac: (typeof s.fleet)[number]) => ac.assignments.find((x) => x.routeId === r.id)?.freq ?? 0;
    const idle = s.fleet.find((ac) => ac.hub === r.from && ac.status !== 'maintenance' && !A.canFly(AIRCRAFT_BY_ID[ac.typeId], r.from, r.to) && A.maxFreqFor(s, ac, r.id) - cur(ac) >= 3);
    if (idle) {
      A.assignAircraft(s, idle.id, r.id, Math.min(A.maxFreqFor(s, idle, r.id), cur(idle) + 14));
      continue;
    }
    const lastProfit = s.finance.history.at(-1) ? monthProfit(s.finance.history.at(-1)!) : 0;
    const reserve = 6_000_000 + (s.finance.history.at(-1) ? Object.values(s.finance.history.at(-1)!.exp).reduce((a, b) => a + b, 0) * 0.5 : 0);
    if (s.cash < reserve || (lastProfit < 0 && s.cash < reserve * 3)) break;
    let res: A.Result = { ok: false, error: '' };
    const offer = s.market.leases.find((o) => o.typeId === t.id && o.deliveryDays < 150);
    if (offer) res = A.leaseAircraft(s, offer.id, r.from, defaultCabin(t));
    if (!res.ok && s.cash > t.price + reserve * 2) res = A.orderNew(s, t.id, 1, defaultCabin(t), r.from);
    if (!res.ok) {
      const used = s.market.used.find((u) => !A.canFly(AIRCRAFT_BY_ID[u.typeId], r.from, r.to) && AIRCRAFT_BY_ID[u.typeId].minLevel <= s.level && u.price < s.cash * 0.5 && u.condition > 60);
      if (used) res = A.buyUsed(s, used.id, r.from);
    }
    if (res.ok) {
      const ac = s.fleet[s.fleet.length - 1];
      ac.assignments.push({ routeId: r.id, freq: Math.min(A.maxFreqFor(s, ac, r.id), 14) });
    }
  }
  // Close persistent money-losers
  for (const r of [...s.routes]) {
    const h = r.history.slice(-8);
    if (h.length === 8 && h.every((w) => w.rev < w.cost)) A.closeRoute(s, r.id);
  }

  // Pricing
  for (const r of s.routes) {
    const sup = routeSupply(s, r, false);
    if (totalOf(sup.seats) > 0) r.prices = optimizePrices(s, r, sup);
  }
  // Resolve decisions with the first option
  for (const d of [...s.decisions]) A.resolveDecision(s, d.id, d.options[0].id);
}

const t0 = Date.now();
const fmt = (v: number) => `${(v / 1e6).toFixed(1)}M`;
console.log(`Hub ${hub} (${AIRPORT_BY_CODE[hub].city}), ${difficulty}, ${years} years`);
for (let d = 0; d < years * 365; d++) {
  advanceDay(state);
  if (state.day % 7 === 1) botWeek(state);
  if (state.gameOver) {
    console.log('GAME OVER', state.gameOver.reason);
    break;
  }
  if (state.day % 91 === 0) {
    const last3 = state.finance.history.slice(-3);
    const profit = last3.reduce((s, m) => s + monthProfit(m), 0) / Math.max(1, last3.length);
    const rev = last3.reduce((s, m) => s + monthRevenue(m), 0) / Math.max(1, last3.length);
    const lf = state.routes.reduce((s, r) => s + (r.history.at(-1)?.pax ?? 0), 0) /
      Math.max(1, state.routes.reduce((s, r) => s + (r.history.at(-1)?.seats ?? 0), 0));
    console.log(
      `${formatDate(state.day).padEnd(12)} lvl ${state.level} xp ${Math.round(state.xp).toString().padStart(7)} cash ${fmt(state.cash).padStart(8)} ` +
      `fleet ${String(state.fleet.length).padStart(3)} routes ${String(state.routes.length).padStart(3)} regions ${state.unlockedRegions.length} hubs ${state.hubs.length} ` +
      `rev/mo ${fmt(rev).padStart(7)} profit/mo ${fmt(profit).padStart(7)} LF ${(lf * 100).toFixed(0)}% rep ${state.reputation.toFixed(0)} ` +
      `pax/wk ${(state.stats.weeklyPax.at(-1) ?? 0).toLocaleString().padStart(9)} debt ${fmt(state.loans.reduce((s, l) => s + l.balance, 0))} ${creditRating(state)} rank ${airlineRank(state)} goals ${state.completedGoals.length}`,
    );
  }
}
const elapsed = Date.now() - t0;
console.log(`Simulated ${state.day} days in ${elapsed} ms (${(elapsed / state.day).toFixed(2)} ms/day)`);
const top = [...state.routes].sort((a, b) => (b.lifetime.rev - b.lifetime.cost) - (a.lifetime.rev - a.lifetime.cost)).slice(0, 6);
for (const r of top) {
  const w = r.history.at(-1);
  console.log(`  ${r.from}-${r.to} ${r.dist}km profit ${fmt(r.lifetime.rev - r.lifetime.cost)} LF ${w ? ((w.pax / Math.max(1, w.seats)) * 100).toFixed(0) : '-'}% conn ${w?.connPax ?? 0}`);
}
const worst = [...state.routes].sort((a, b) => (a.lifetime.rev - a.lifetime.cost) - (b.lifetime.rev - b.lifetime.cost)).slice(0, 3);
for (const r of worst) console.log(`  worst ${r.from}-${r.to} ${r.dist}km profit ${fmt(r.lifetime.rev - r.lifetime.cost)}`);
const m = state.finance.history.at(-1);
if (m) console.log('last month', Object.fromEntries(Object.entries({ ...m.rev, ...m.exp }).map(([k, v]) => [k, fmt(v)])));
void distance;
if (process.env.SAVE_OUT) {
  const { writeFileSync } = await import('node:fs');
  const { serialize } = await import('../src/engine/save');
  state.yearReview = null;
  state.decisions = [];
  writeFileSync(process.env.SAVE_OUT, serialize(state));
  console.log('saved', process.env.SAVE_OUT);
}
