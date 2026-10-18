// Aircraft markets (used & leasing), fuel, economy and city trends.

import { AIRCRAFT, AIRCRAFT_BY_ID, type AircraftType } from '../data/aircraft';
import { AIRPORTS } from '../data/airports';
import { LESSORS, SELLERS } from '../data/flavor';
import { CONTINENT_ORDER } from '../data/regions';
import { cabinPresets, defaultCabin } from './cabin';
import { BASE_FUEL_PRICE, marketValue, newLeaseRate, usedLeaseRate } from './economy';
import * as R from './rng';
import { newId } from './state';
import type { GameState, LeaseOffer, UsedListing } from './types';
import { clamp, dateToDay, yearOf } from './util';

function usedEligible(state: GameState): AircraftType[] {
  const year = yearOf(state.day);
  return AIRCRAFT.filter((t) => t.eis <= year - 1 && t.body !== 'supersonic');
}

function randomAge(state: GameState, t: AircraftType): number {
  const year = yearOf(state.day);
  const maxAge = Math.max(1, year - t.eis);
  const minAge = t.inProduction ? 1 : Math.min(maxAge, 6);
  const lo = Math.min(minAge, maxAge);
  const hi = Math.min(maxAge, t.generation === 'legacy' ? 28 : 18);
  return R.range(state, lo, Math.max(lo + 0.5, hi));
}

function randomUsedCabin(state: GameState, t: AircraftType) {
  const presets = cabinPresets(t);
  return R.pick(state, presets).config;
}

export function makeUsedListing(state: GameState): UsedListing {
  const t = R.weightedPick(state, usedEligible(state), (x) => (x.inProduction ? 1 : 1.6) * (x.minLevel <= state.level + 1 ? 1 : 0.3))!;
  const age = randomAge(state, t);
  const condition = Math.round(clamp(95 - age * 1.6 + R.range(state, -12, 6), 35, 98));
  const price = marketValue(t, age, condition) * R.range(state, 0.88, 1.08);
  return {
    id: newId(state, 'u'),
    typeId: t.id,
    builtDay: Math.round(state.day - age * 365),
    condition,
    price: Math.round(price / 50_000) * 50_000,
    cabin: randomUsedCabin(state, t),
    seller: R.pick(state, SELLERS),
    expiresDay: state.day + R.int(state, 45, 120),
  };
}

export function makeLeaseOffer(state: GameState, forceNew?: boolean): LeaseOffer {
  const year = yearOf(state.day);
  const isNew = forceNew ?? R.chance(state, 0.5);
  const pool = isNew
    ? AIRCRAFT.filter((t) => t.inProduction && t.availableFrom <= year + 1 && t.body !== 'supersonic')
    : usedEligible(state);
  const t = R.weightedPick(state, pool, (x) => (x.minLevel <= state.level + 1 ? 1 : 0.25) * (x.body === 'jumbo' ? 0.5 : 1))!;
  const age = isNew ? 0 : randomAge(state, t);
  const condition = isNew ? 100 : Math.round(clamp(92 - age * 1.4 + R.range(state, -8, 6), 45, 98));
  const monthly = isNew ? newLeaseRate(t) * R.range(state, 0.95, 1.08) : usedLeaseRate(t, age, condition) * R.range(state, 0.9, 1.1);
  const availFrom = Math.max(0, dateToDay(t.availableFrom, 1, 1) - state.day);
  return {
    id: newId(state, 'l'),
    typeId: t.id,
    isNew,
    builtDay: Math.round(state.day - age * 365),
    condition,
    monthly: Math.round(monthly / 1000) * 1000,
    termMonths: isNew ? R.pick(state, [72, 96, 120]) : R.pick(state, [24, 36, 48, 60]),
    deliveryDays: isNew ? Math.max(availFrom, R.int(state, 30, 120)) : R.int(state, 7, 21),
    qty: isNew ? R.int(state, 1, 4) : R.int(state, 1, 2),
    lessor: R.pick(state, LESSORS),
    expiresDay: state.day + R.int(state, 45, 110),
  };
}

/** Starter-friendly lease offers so a new airline always has options. */
export function seedMarkets(state: GameState) {
  state.market.used = [];
  state.market.leases = [];
  const starters = ['atr72', 'e175', 'a220_100', 'a320neo', 'b38m', 'atr42', 'e190e2'];
  for (const id of starters) {
    const t = AIRCRAFT_BY_ID[id];
    state.market.leases.push({
      id: newId(state, 'l'), typeId: id, isNew: true, builtDay: state.day, condition: 100,
      monthly: newLeaseRate(t), termMonths: 72, deliveryDays: R.int(state, 10, 25), qty: 2,
      lessor: R.pick(state, LESSORS), expiresDay: state.day + 90,
    });
  }
  for (let i = 0; i < 6; i++) state.market.leases.push(makeLeaseOffer(state));
  const usedStarters = ['atr72', 'b738', 'a320ceo', 'q400', 'crj900'];
  for (const id of usedStarters) {
    const t = AIRCRAFT_BY_ID[id];
    const age = R.range(state, 8, 16);
    const condition = R.int(state, 60, 85);
    state.market.used.push({
      id: newId(state, 'u'), typeId: id, builtDay: Math.round(state.day - age * 365), condition,
      price: Math.round((marketValue(t, age, condition) * 0.95) / 50_000) * 50_000,
      cabin: defaultCabin(t), seller: R.pick(state, SELLERS), expiresDay: state.day + 120,
    });
  }
  for (let i = 0; i < 10; i++) state.market.used.push(makeUsedListing(state));
}

export function refreshMarkets(state: GameState) {
  state.market.used = state.market.used.filter((u) => u.expiresDay > state.day);
  state.market.leases = state.market.leases.filter((l) => l.expiresDay > state.day && l.qty > 0);
  const usedTarget = 16 + Math.min(10, state.level * 1);
  while (state.market.used.length < usedTarget) state.market.used.push(makeUsedListing(state));
  const leaseTarget = 10 + Math.min(10, state.level);
  while (state.market.leases.length < leaseTarget) state.market.leases.push(makeLeaseOffer(state));
  state.market.deals = state.market.deals.filter((d) => d.until >= state.day);
}

export function updateFuel(state: GameState) {
  const p = state.market.fuel;
  const drift = 0.004 * Math.log(BASE_FUEL_PRICE / p);
  state.market.fuel = clamp(p * Math.exp(drift + R.gaussian(state) * 0.007), 0.35, 1.9);
}

export function updateEconomyMonthly(state: GameState) {
  for (const c of CONTINENT_ORDER) {
    const e = state.market.econ[c];
    const drift = 0.06 * (1 - e);
    state.market.econ[c] = clamp(e + drift + R.gaussian(state) * 0.012, 0.7, 1.3);
  }
  // City-level demand trends random-walk slowly so the market keeps shifting.
  for (const a of AIRPORTS) {
    const t = state.market.trend[a.code] ?? 1;
    const next = clamp(t + 0.03 * (1 - t) + R.gaussian(state) * 0.015, 0.7, 1.45);
    state.market.trend[a.code] = Math.round(next * 1000) / 1000;
  }
}

export function updateAiAirlines(state: GameState) {
  for (const ai of state.ai) {
    const g = ai.growth + R.gaussian(state) * 0.004 + (state.market.econ[ai.continent] - 1) * 0.05;
    ai.paxM = Math.max(1, ai.paxM * (1 + g / 12));
    ai.fleet = Math.max(10, Math.round(ai.fleet * (1 + g / 12)));
  }
}

export function airlineRank(state: GameState): number {
  const myPaxM = Math.max(state.stats.yearPax, state.stats.lastYearPax) / 1e6;
  return state.ai.filter((a) => a.paxM > myPaxM).length + 1;
}
