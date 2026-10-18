// Passenger demand model: a gravity model between airport catchments, split
// into cabin classes, shaped by seasons, economy, trends and live events.

import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { AIRPORT_BY_CODE, type Airport } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { REGION_BY_ID, type ContinentId } from '../data/regions';
import { CLASSES, type CabinClass, seatProduct } from '../data/seats';
import { type Seats, cabinSeats, zeroSeats } from './cabin';
import { ageYears, refFare } from './economy';
import { distance } from './geo';
import { modifierFor } from './modifiers';
import type { Aircraft, Competition, GameState, Route } from './types';
import { clamp, dayOfYear, hashUnit, pairKey } from './util';

const K = 50;
const SIZE_F = [0, 0.65, 0.85, 1.0, 1.25, 1.5];

export const CONTINENT_GROWTH: Record<ContinentId, number> = {
  EU: 0.025, NA: 0.025, SA: 0.035, AF: 0.05, ME: 0.045, AS: 0.05, OC: 0.03,
};

export function airportMass(a: Airport): number {
  const prop = COUNTRIES[a.country]?.prop ?? 0.5;
  return Math.pow(a.pop * prop + a.tour * a.tour * 2, 0.8) * SIZE_F[a.size];
}

/** Islands and remote places where flying is the only practical option. */
const ISOLATED = new Set([
  'PMI', 'IBZ', 'LPA', 'TFS', 'FNC', 'JTR', 'HER', 'RHO', 'MLA', 'CAG', 'CTA', 'PMO', 'LCA', 'JER', 'KEF', 'TOS', 'BGO',
  'TRD', 'RVN', 'INV', 'OGG', 'HNL', 'ANC', 'SJU', 'NAS', 'MBJ', 'PUJ', 'AUA', 'HAV', 'ZNZ', 'MRU', 'SEZ', 'MLE', 'DPS',
  'HKT', 'CEB', 'OKA', 'CJU', 'CTS', 'NAN', 'PPT', 'NOU', 'APW', 'RAR', 'GUM', 'HBA', 'ZQN', 'USH', 'PUQ', 'SYX', 'TNR',
  'DBV', 'BFS', 'DUB', 'ORK', 'CMB', 'TPE', 'KHH', 'MAO', 'DRW', 'PER', 'CNS',
]);

/** How much a country relies on domestic flying (geography, rail competition). */
const DOMESTIC_RELIANCE: Record<string, number> = {
  NO: 2.6, IS: 2, SE: 1.4, FI: 1.4, GR: 1.5, AU: 1.5, NZ: 1.5, CA: 1.4, ID: 1.6, PH: 1.5, CL: 1.4, CO: 1.4, PE: 1.4,
  BR: 1.3, AR: 1.3, US: 1.05, MX: 1.2, ZA: 1.2, IN: 1.0, JP: 0.85, CN: 0.85, KR: 0.6, ES: 0.85, FR: 0.65, DE: 0.75,
  IT: 0.8, GB: 0.8, NL: 0.4, BE: 0.4, CH: 0.5, AT: 0.6, TW: 0.5,
};

function distanceFactor(d: number, isolated: boolean): number {
  if (d < 100) return 0;
  const ramp = isolated ? 1 - Math.exp(-((d / 120) ** 2)) : 1 - Math.exp(-((d / 350) ** 2));
  return ramp * Math.pow(1000 / (d + 600), 0.6);
}

const baseCache = new Map<string, number>();

/** Base daily passengers in one direction between two airports (whole market). */
export function baseDemand(a: string, b: string): number {
  const key = pairKey(a, b);
  const cached = baseCache.get(key);
  if (cached !== undefined) return cached;
  const A = AIRPORT_BY_CODE[a];
  const B = AIRPORT_BY_CODE[b];
  const d = distance(a, b);
  const geo = A.country === B.country ? 1.25 * (DOMESTIC_RELIANCE[A.country] ?? 1) : A.continent === B.continent ? 0.9 : 0.75;
  const tour = 1 + 0.25 * Math.max(A.tour, B.tour);
  const biz = 1 + A.biz * B.biz;
  const isolated = ISOLATED.has(a) || ISOLATED.has(b);
  const v = K * airportMass(A) * airportMass(B) * distanceFactor(d, isolated) * geo * tour * biz;
  baseCache.set(key, v);
  return v;
}

const splitCache = new Map<string, Record<CabinClass, number>>();

export function classSplit(a: string, b: string): Record<CabinClass, number> {
  const key = pairKey(a, b);
  const cached = splitCache.get(key);
  if (cached) return cached;
  const A = AIRPORT_BY_CODE[a];
  const B = AIRPORT_BY_CODE[b];
  const d = distance(a, b);
  const biz = (A.biz + B.biz) / 2;
  const dl = clamp(d / 6000, 0, 1);
  const leisure = 1 - 0.3 * Math.max(A.tour, B.tour) * (1 - biz);
  const F = d > 2500 ? 0.012 * biz * Math.min(1, d / 5000) : 0;
  const J = (0.035 + 0.075 * biz) * (0.8 + 0.4 * dl) * leisure;
  const W = 0.03 + 0.05 * dl;
  const out = { F, J, W, Y: 1 - F - J - W };
  splitCache.set(key, out);
  return out;
}

export function seasonality(code: string, day: number): number {
  const a = AIRPORT_BY_CODE[code];
  const doy = dayOfYear(day);
  let peak: number;
  let amp: number;
  if (a.lat > 23) { peak = 200; amp = 0.24; }
  else if (a.lat < -23) { peak = 15; amp = 0.22; }
  else { peak = 30; amp = 0.12; }
  const tourAmp = amp * (0.3 + a.tour);
  let s = 1 + tourAmp * Math.cos((2 * Math.PI * (doy - peak)) / 365);
  // Christmas & New Year rush
  if (doy >= 352 || doy <= 3) s *= 1.08;
  return s;
}

export function growthFactor(state: GameState, a: Airport): number {
  return Math.pow(1 + CONTINENT_GROWTH[a.continent], state.day / 365);
}

/** Dynamic multiplier on the base demand of a pair for the current day. */
export function demandMultiplier(state: GameState, a: string, b: string, day = state.day): number {
  const A = AIRPORT_BY_CODE[a];
  const B = AIRPORT_BY_CODE[b];
  const econ = (state.market.econ[A.continent] + state.market.econ[B.continent]) / 2;
  const trend = Math.sqrt((state.market.trend[a] ?? 1) * (state.market.trend[b] ?? 1));
  const growth = Math.sqrt(growthFactor(state, A) * growthFactor(state, B));
  const season = (seasonality(a, day) + seasonality(b, day)) / 2;
  return econ * trend * growth * season * modifierFor(state, 'demand', a, b);
}

/** Whole-market daily demand (one direction) per class. */
export function marketDemand(state: GameState, a: string, b: string, day = state.day): Seats {
  const total = baseDemand(a, b) * demandMultiplier(state, a, b, day);
  const split = classSplit(a, b);
  return { F: total * split.F, J: total * split.J, W: total * split.W, Y: total * split.Y };
}

export function totalOf(s: Seats): number {
  return s.F + s.J + s.W + s.Y;
}

// ---------- competition ----------

export function baseCompetition(a: string, b: string): number {
  const A = AIRPORT_BY_CODE[a];
  const B = AIRPORT_BY_CODE[b];
  const d = distance(a, b);
  const noise = 0.75 + 0.5 * hashUnit(pairKey(a, b));
  const longHaul = d > 4000 ? 0.85 : 1;
  return (0.15 + 0.17 * (A.size + B.size - 2)) * noise * longHaul;
}

export function competition(state: GameState, a: string, b: string): Competition {
  return state.competition[pairKey(a, b)] ?? { level: baseCompetition(a, b), priceIdx: 1 };
}

export function competitionLabel(level: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (level < 0.45) return { label: 'Low', tone: 'good' };
  if (level < 0.95) return { label: 'Moderate', tone: 'warn' };
  return { label: 'High', tone: 'bad' };
}

// ---------- supply & quality ----------

export interface RouteSupply {
  /** Seats per day per direction by class. */
  seats: Seats;
  flightsPerDay: number;
  quality: Record<CabinClass, number>;
  aircraft: { ac: Aircraft; freq: number }[];
}

export function aircraftQuality(state: GameState, ac: Aircraft): number {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const gen = t.generation === 'new' ? 20 : t.generation === 'current' ? 6 : -8;
  const age = ageYears(state, ac);
  return clamp(55 + gen - Math.max(0, age - 8) * 2.5 + (ac.condition - 80) * 0.2, 0, 100);
}

export function serviceQuality(state: GameState, cls: CabinClass, hubCode: string): number {
  const p = state.policies;
  const wifi = p.wifi === 2 ? 10 : p.wifi === 1 ? 4 : 0;
  const hub = state.hubs.find((h) => h.code === hubCode);
  const lounge = hub?.upgrades.lounge && (cls === 'J' || cls === 'F') ? 12 : 0;
  let base: number;
  switch (cls) {
    case 'Y': base = [22, 52, 78][p.cateringY] - (p.bagsFee ? 8 : 0); break;
    case 'W': base = 72; break;
    case 'J': base = [60, 88][p.cateringPremium]; break;
    case 'F': base = [66, 96][p.cateringPremium]; break;
  }
  return clamp(base + wifi + lounge, 0, 100);
}

export function isFlying(ac: Aircraft, day: number): boolean {
  return ac.status === 'active' && ac.lastDisruption !== day;
}

export function routeSupply(state: GameState, route: Route, onlyFlying = true): RouteSupply {
  const seats = zeroSeats();
  const qualSum = zeroSeats();
  let flightsPerDay = 0;
  const aircraft: { ac: Aircraft; freq: number }[] = [];
  for (const ac of state.fleet) {
    if (onlyFlying && !isFlying(ac, state.day)) continue;
    for (const asg of ac.assignments) {
      if (asg.routeId !== route.id || asg.freq <= 0) continue;
      const t = AIRCRAFT_BY_ID[ac.typeId];
      const s = cabinSeats(t, ac.cabin);
      const perDay = asg.freq / 7;
      flightsPerDay += perDay;
      aircraft.push({ ac, freq: asg.freq });
      const aq = aircraftQuality(state, ac);
      for (const c of CLASSES) {
        if (s[c] <= 0) continue;
        const sec = ac.cabin[c]!;
        const seatQ = seatProduct(sec.product).comfort;
        const q = 0.45 * seatQ + 0.2 * aq + 0.35 * serviceQuality(state, c, route.from);
        seats[c] += s[c] * perDay;
        qualSum[c] += q * s[c] * perDay;
      }
    }
  }
  const quality = { F: 0, J: 0, W: 0, Y: 0 };
  for (const c of CLASSES) quality[c] = seats[c] > 0 ? qualSum[c] / seats[c] : 0;
  return { seats, flightsPerDay, quality, aircraft };
}

// ---------- market share ----------

// Below the market fare, demand responds smoothly; above it, passengers
// quickly defect to competitors.
const ELASTICITY_LOW: Record<CabinClass, number> = { F: 0.5, J: 0.7, W: 1.0, Y: 1.2 };
const ELASTICITY_HIGH: Record<CabinClass, number> = { F: 1.2, J: 1.6, W: 2.2, Y: 2.6 };
const STIMULATION: Record<CabinClass, number> = { F: 0.2, J: 0.3, W: 0.5, Y: 0.7 };

export function priceFactor(price: number, ref: number, cls: CabinClass): number {
  const r = Math.max(0.05, price / ref);
  return r <= 1 ? Math.min(3, Math.pow(r, -ELASTICITY_LOW[cls])) : Math.exp(-ELASTICITY_HIGH[cls] * (r - 1));
}

export function frequencyFactor(flightsPerDay: number, dist: number): number {
  const k = dist < 1200 ? 1.6 : dist < 3500 ? 1.1 : 0.7;
  return 1 - Math.exp(-flightsPerDay / k);
}

export function reputationFactor(rep: number): number {
  return 0.65 + 0.7 * (rep / 100);
}

export function qualityFactor(q: number, dist: number): number {
  return 1 + ((q - 55) / 100) * (0.5 + Math.min(0.7, dist / 8000));
}

export function marketingFactor(state: GameState, route: Route): number {
  let f = 1;
  const A = AIRPORT_BY_CODE[route.from];
  const B = AIRPORT_BY_CODE[route.to];
  for (const c of state.campaigns) {
    if (c.startDay > state.day || c.endDay < state.day) continue;
    if (c.type === 'route' && c.target === route.id) f *= 1 + c.boost;
    else if (c.type === 'regional' && (c.target === A.region || c.target === B.region)) f *= 1 + c.boost;
    else if (c.type === 'social' && (c.target === A.region || c.target === B.region)) f *= 1 + c.boost;
    else if (c.type === 'global') f *= 1 + c.boost;
  }
  if (state.loyalty.active) f *= 1 + Math.min(0.12, 0.03 + state.loyalty.members / 40_000_000);
  return f;
}

export interface ShareInput {
  dist: number;
  flightsPerDay: number;
  quality: number;
  price: number;
  ref: number;
  cls: CabinClass;
  rep: number;
  marketing: number;
  comp: Competition;
  supersonic?: boolean;
}

export function attractiveness(i: ShareInput): number {
  const priceF = priceFactor(i.price, i.ref, i.cls);
  const speed = i.supersonic && (i.cls === 'J' || i.cls === 'F') ? 1.6 : 1;
  return frequencyFactor(i.flightsPerDay, i.dist) * priceF * qualityFactor(i.quality, i.dist) *
    reputationFactor(i.rep) * i.marketing * speed;
}

export function marketShare(i: ShareInput, extraFriction = 0): number {
  const A = attractiveness(i);
  const comp = i.comp.level / Math.max(0.5, i.comp.priceIdx);
  return A / (A + comp + 0.3 + extraFriction);
}

export function stimulation(price: number, ref: number, cls: CabinClass): number {
  const r = Math.max(0.05, price / ref);
  return r <= 1 ? Math.min(1.8, Math.pow(r, -STIMULATION[cls])) : Math.max(0.4, Math.exp(-STIMULATION[cls] * 1.5 * (r - 1)));
}

export interface LocalDemand {
  demand: Seats;
  market: Seats;
  share: number;
}

/**
 * Passengers that would choose this route today (one direction), with spill
 * between classes when a cabin isn't offered.
 */
export function localDemand(state: GameState, route: Route, supply: RouteSupply, day = state.day): LocalDemand {
  const market = marketDemand(state, route.from, route.to, day);
  const comp = competition(state, route.from, route.to);
  const marketing = marketingFactor(state, route) * (route.promoUntil >= day ? 1.15 : 1);
  const supersonic = supply.aircraft.some(({ ac }) => AIRCRAFT_BY_ID[ac.typeId].body === 'supersonic');
  const demand = zeroSeats();
  let shareSum = 0;
  let shareW = 0;
  for (const c of CLASSES) {
    if (market[c] <= 0) continue;
    const ref = refFare(route.dist, c);
    const price = route.prices[c];
    const q = supply.seats[c] > 0 ? supply.quality[c] : supply.quality.Y || 50;
    const share = marketShare({
      dist: route.dist, flightsPerDay: supply.flightsPerDay, quality: q, price, ref, cls: c,
      rep: state.reputation, marketing, comp, supersonic,
    });
    demand[c] = market[c] * stimulation(price, ref, c) * share;
    shareSum += share * market[c];
    shareW += market[c];
  }
  // Spill demand for cabins that aren't offered.
  if (supply.seats.F <= 0) {
    if (supply.seats.J > 0) demand.J += demand.F * 0.5;
    else demand.Y += demand.F * 0.2;
    demand.F = 0;
  }
  if (supply.seats.J <= 0) {
    if (supply.seats.W > 0) demand.W += demand.J * 0.3;
    else demand.Y += demand.J * 0.35;
    demand.J = 0;
  }
  if (supply.seats.W <= 0) {
    demand.Y += demand.W * 0.6;
    demand.W = 0;
  }
  return { demand, market, share: shareW > 0 ? shareSum / shareW : 0 };
}

// ---------- forecasting helpers for the UI ----------

export interface Forecast {
  demand: Seats;
  seats: Seats;
  pax: Seats;
  loadFactor: number;
  revenuePerDay: number;
  share: number;
}

export function forecastRoute(state: GameState, route: Route, supply: RouteSupply): Forecast {
  const { demand, share } = localDemand(state, route, supply);
  const pax = zeroSeats();
  let rev = 0;
  for (const c of CLASSES) {
    pax[c] = Math.min(demand[c], supply.seats[c]);
    rev += pax[c] * route.prices[c] * 2;
  }
  const totalSeats = totalOf(supply.seats);
  return {
    demand,
    seats: supply.seats,
    pax,
    loadFactor: totalSeats > 0 ? totalOf(pax) / totalSeats : 0,
    revenuePerDay: rev,
    share,
  };
}

/** Find fares that roughly maximise revenue for the given supply. */
export function optimizePrices(state: GameState, route: Route, supply: RouteSupply): Record<CabinClass, number> {
  const best = { ...route.prices };
  const tmp: Route = { ...route, prices: { ...route.prices } };
  for (const c of CLASSES) {
    if (supply.seats[c] <= 0) continue;
    const ref = refFare(route.dist, c);
    let bestRev = -1;
    let bestPrice = route.prices[c];
    for (let m = 0.6; m <= 2.21; m += 0.04) {
      tmp.prices[c] = ref * m;
      const { demand } = localDemand(state, tmp, supply);
      // Fill rate below ~92% is penalised slightly to leave room for connections.
      const rev = Math.min(demand[c], supply.seats[c] * 0.97) * ref * m;
      if (rev > bestRev) {
        bestRev = rev;
        bestPrice = ref * m;
      }
    }
    tmp.prices[c] = bestPrice;
    best[c] = Math.max(5, Math.round(bestPrice / 5) * 5);
  }
  return best;
}

/** Estimated whole-market demand from a hub to a destination (for research screens). */
export function marketSnapshot(state: GameState, from: string, to: string) {
  const m = marketDemand(state, from, to);
  return { total: totalOf(m), byClass: m, comp: competition(state, from, to) };
}

export function regionOf(code: string) {
  return REGION_BY_ID[AIRPORT_BY_CODE[code].region];
}
