// Core economic formulas: fares, flight costs, aircraft values and overheads.

import { AIRCRAFT_BY_ID, type AircraftType, isWidebody } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import type { CabinClass } from '../data/seats';
import { type Seats, cabinSeats } from './cabin';
import type { Aircraft, GameState } from './types';
import { globalModifier, modifierFor } from './modifiers';
import { clamp } from './util';

export const MAX_WEEKLY_HOURS = 105;
export const MIN_ROUTE_KM = 150;
export const BASE_FUEL_PRICE = 0.78; // USD per kg

// ---------- fares ----------

export function refFare(dist: number, cls: CabinClass): number {
  const y = 48 + 0.15 * Math.pow(dist, 0.9);
  const dl = Math.min(1, dist / 6000);
  switch (cls) {
    case 'Y': return y;
    case 'W': return y * (1.5 + 0.35 * dl);
    case 'J': return y * (2.3 + 2.4 * dl);
    case 'F': return y * (5 + 3 * Math.min(1, dist / 8000));
  }
}

export function refFares(dist: number, idx = 1): Record<CabinClass, number> {
  return { F: round5(refFare(dist, 'F') * idx), J: round5(refFare(dist, 'J') * idx), W: round5(refFare(dist, 'W') * idx), Y: round5(refFare(dist, 'Y') * idx) };
}

// ---------- inflation ----------

/** Wages, airport charges, maintenance and overheads relative to 2026 (rises every January). */
export function costIndex(state: GameState): number {
  return state.inflation.cost * (1 - (state.inflation.relief ?? 0));
}

/** Market fare level relative to 2026. Tracks costs only partly; player fares stay put until re-priced. */
export function fareIndex(state: GameState): number {
  return state.inflation.fare;
}

/** Today's market fare: what rivals charge. Player price ratios are measured against this. */
export function marketFare(state: GameState, dist: number, cls: CabinClass): number {
  return refFare(dist, cls) * fareIndex(state);
}

export function marketFares(state: GameState, dist: number): Record<CabinClass, number> {
  return refFares(dist, fareIndex(state));
}

function round5(v: number): number {
  return Math.max(5, Math.round(v / 5) * 5);
}

// ---------- timing ----------

export function blockHours(t: AircraftType, dist: number): number {
  const taxi = t.body === 'turboprop' ? 0.3 : isWidebody(t) ? 0.5 : 0.42;
  return dist / t.speedKmh + taxi;
}

export function roundTripHours(t: AircraftType, dist: number): number {
  return 2 * (blockHours(t, dist) + t.turnMin / 60);
}

export function maxWeeklyFreq(t: AircraftType, dist: number, hoursAvailable = MAX_WEEKLY_HOURS): number {
  return Math.max(0, Math.floor(hoursAvailable / roundTripHours(t, dist)));
}

// ---------- aircraft condition, age, value ----------

export function ageYears(state: GameState, ac: { builtDay: number }): number {
  return Math.max(0, (state.day - ac.builtDay) / 365);
}

export function marketValue(t: AircraftType, age: number, condition: number): number {
  const legacy = t.generation === 'legacy' ? 0.8 : 1;
  const v = t.price * Math.pow(0.925, age) * (0.7 + 0.3 * (condition / 100)) * legacy;
  return Math.max(t.price * 0.06, v);
}

export function newLeaseRate(t: AircraftType): number {
  return Math.round(t.price * 0.007 / 1000) * 1000;
}

export function usedLeaseRate(t: AircraftType, age: number, condition: number): number {
  return Math.round(Math.max(t.price * 0.0025, marketValue(t, age, condition) * 0.0115) / 1000) * 1000;
}

export function heavyCheckCost(t: AircraftType, age: number): number {
  return t.price * 0.012 * (1 + age * 0.025);
}

export function heavyCheckDays(t: AircraftType): number {
  if (t.body === 'turboprop' || t.body === 'regional') return 7;
  if (t.body === 'narrow') return 10;
  if (t.body === 'jumbo') return 21;
  return 16;
}

/** Condition after a heavy check — older airframes never come back as new. */
export function restoredCondition(age: number): number {
  return clamp(100 - age * 0.8, 72, 100);
}

export function refitDays(t: AircraftType): number {
  return isWidebody(t) ? 21 : t.body === 'narrow' ? 12 : 7;
}

export function trainingCost(t: AircraftType): number {
  switch (t.body) {
    case 'turboprop':
    case 'regional': return 800_000;
    case 'narrow': return 1_500_000;
    case 'wide': return 3_000_000;
    case 'jumbo': return 4_000_000;
    case 'supersonic': return 6_000_000;
  }
}

// ---------- airports ----------

const LANDING_PER_TONNE = [0, 5, 6, 7, 9, 11];
/** Passenger charges (terminal, security, PRM) per departing or arriving passenger. */
const PAX_FEE = [0, 5, 7, 9, 12, 15];
export const STATION_OPEN = [0, 100_000, 200_000, 400_000, 750_000, 1_200_000];
export const STATION_MONTHLY = [0, 10_000, 18_000, 30_000, 50_000, 75_000];
export const HUB_OPEN = [0, 2_000_000, 4_000_000, 8_000_000, 15_000_000, 25_000_000];
export const HUB_MONTHLY = [0, 80_000, 150_000, 260_000, 420_000, 650_000];

/** Hub running costs scale with how many aircraft are based there (you only rent the gates you use). */
export function hubMonthlyCost(state: GameState, code: string): number {
  const based = state.fleet.filter((a) => a.hub === code && a.status !== 'delivering').length;
  return HUB_MONTHLY[AIRPORT_BY_CODE[code].size] * Math.min(1, 0.15 + based / 24) * costIndex(state);
}

export function feeMult(state: GameState, code: string): number {
  return (state.feeMult[code] ?? 1) * modifierFor(state, 'fees', code) * costIndex(state);
}

export function landingFee(state: GameState, t: AircraftType, code: string): number {
  return LANDING_PER_TONNE[AIRPORT_BY_CODE[code].size] * t.mtow * feeMult(state, code);
}

export function paxFee(state: GameState, code: string): number {
  return PAX_FEE[AIRPORT_BY_CODE[code].size] * feeMult(state, code);
}

// ---------- per-flight cost model ----------

export interface LegCost {
  fuel: number;
  crew: number;
  maintenance: number;
  navigation: number;
  landing: number;
  handling: number;
  total: number;
  block: number;
}

export function crewCount(s: Seats): number {
  return Math.max(1, Math.ceil(s.Y / 50) + Math.ceil(s.W / 35) + Math.ceil(s.J / 12) + Math.ceil(s.F / 5));
}

export function maintenanceMultiplier(state: GameState, ac: Aircraft): number {
  const age = ageYears(state, ac);
  const policy = [0.82, 1, 1.25][state.policies.maintenance];
  const hub = state.hubs.find((h) => h.code === ac.hub);
  const base = hub?.upgrades.maintenance ? 0.85 : 1;
  // Warranty years are cheap; shop visits and ageing parts push costs up from year 5.
  const ageF = 0.9 + 0.02 * Math.min(age, 5) + 0.045 * Math.max(0, age - 5);
  return ageF * (1 + (100 - ac.condition) / 150) * policy * base;
}

/** Effective fuel price after hedging. */
export function fuelPrice(state: GameState): number {
  const spot = state.market.fuel;
  const h = state.hedge;
  if (!h || h.until < state.day) return spot;
  return h.price * h.pct + spot * (1 - h.pct);
}

/** Cost of one flight leg (one direction) excluding passenger-driven costs. */
export function legCost(state: GameState, ac: Aircraft, dist: number, arrival: string): LegCost {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const block = blockHours(t, dist);
  // Cruise burn plus ~300 km worth for taxi, take-off and climb: ≈2.2 t per block hour for an A320neo.
  const fuel = t.fuelBurn * 1.15 * (dist + 300) * fuelPrice(state);
  const pilotMult = block > 12 ? 2 : block > 8 ? 1.5 : 1;
  const seats = cabinSeats(t, ac.cabin);
  // Fully loaded crew cost (salary, per diems, hotels, reserves, training) per block hour.
  const crew = block * (t.pilotRate * 1.6 * pilotMult + crewCount(seats) * 82) * state.crewMult * globalModifier(state, 'crew') * costIndex(state);
  const maintenance = block * t.maintHour * 1.55 * maintenanceMultiplier(state, ac) * costIndex(state);
  // En-route charges, Eurocontrol-style: distance × √MTOW (≈ $1/km for an A320).
  const navigation = dist * 0.12 * Math.sqrt(t.mtow) * costIndex(state);
  const landing = landingFee(state, t, arrival);
  const handling = handlingFee(state, seats, arrival);
  return { fuel, crew, maintenance, navigation, landing, handling, total: fuel + crew + maintenance + navigation + landing + handling, block };
}

/** Sales & distribution (GDS, card fees, commissions, call centres) as a share of ticket revenue. */
export const DISTRIBUTION_RATE = 0.045;

/** Ground handling per turnaround: ramp, check-in, cleaning, pushback. */
export function handlingFee(state: GameState, seats: Seats, code: string): number {
  return (160 + 3.6 * (seats.F + seats.J + seats.W + seats.Y)) * feeMult(state, code);
}

/** Catering & passenger service cost per passenger. */
export function serviceCostPerPax(state: GameState, cls: CabinClass, dist: number): number {
  const df = (0.4 + Math.min(3.6, dist / 2500)) * costIndex(state);
  const p = state.policies;
  switch (cls) {
    case 'Y': return [0.5, 3, 8][p.cateringY] * df;
    case 'W': return 14 * df;
    case 'J': return [22, 50][p.cateringPremium] * df;
    case 'F': return [90, 180][p.cateringPremium] * df;
  }
}

export function ancillaryPerPax(state: GameState, dist: number): number {
  const p = state.policies;
  const base = 4 + (p.bagsFee ? 11 : 0) + (p.cateringY === 0 ? 3 : 0) + (p.wifi === 1 ? 1.5 : 0);
  return base * Math.min(1.6, 0.6 + dist / 2500);
}

export function cargoRevenuePerLeg(state: GameState, t: AircraftType, dist: number, econ: number): number {
  return t.cargoT * 0.55 * 0.3 * dist * econ * (state.market.fuel / BASE_FUEL_PRICE) ** 0.3 * fareIndex(state);
}

// ---------- fixed costs ----------

/** Head-office cost each aircraft brings (staff, IT, sales, spares), scaled by its size. */
export function aircraftOverhead(t: AircraftType): number {
  return 20_000 + 550 * t.typicalSeats;
}

/** Monthly cost of having an aircraft at all: lease (or ~0.6% of its price if owned) plus its overhead. */
export function aircraftMonthlyCost(state: GameState, ac: Aircraft): number {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  return (ac.ownership === 'leased' ? ac.leaseMonthly : t.price * 0.006) + aircraftOverhead(t) * costIndex(state);
}

/** Monthly head-office overhead: staff, IT, sales, plus complexity from extra aircraft families. */
export function overheadMonthly(state: GameState): number {
  let fleet = 0;
  const fam = new Set<string>();
  for (const a of state.fleet) {
    if (a.status === 'delivering') continue;
    const t = AIRCRAFT_BY_ID[a.typeId];
    fleet += aircraftOverhead(t);
    fam.add(t.family);
  }
  return (60_000 + fleet + 6_000 * state.routes.length + Math.max(0, fam.size - 1) * 120_000 +
    (state.licenses.revenueMgmt ? 150_000 : 0)) * costIndex(state);
}

/** Costs that arrive every month whatever you fly: leases, overhead, stations, hubs and loan payments. */
export function fixedMonthlyCosts(state: GameState): number {
  let total = overheadMonthly(state) + state.loans.reduce((s, l) => s + l.payment, 0);
  for (const ac of state.fleet) if (ac.ownership === 'leased' && ac.status !== 'delivering') total += ac.leaseMonthly;
  for (const h of state.hubs) total += hubMonthlyCost(state, h.code);
  const st = new Set(state.routes.map((r) => r.to).filter((c) => !state.hubs.some((h) => h.code === c)));
  for (const code of st) total += STATION_MONTHLY[AIRPORT_BY_CODE[code].size] * costIndex(state);
  return total;
}

// ---------- credit ----------

export function ownedFleetValue(state: GameState): number {
  return state.fleet.filter((a) => a.ownership === 'owned').reduce((s, a) => s + a.bookValue, 0);
}

export function totalDebt(state: GameState): number {
  return state.loans.reduce((s, l) => s + l.balance, 0);
}

export function trailingProfit(state: GameState, months = 12): number {
  const h = state.finance.history.slice(-months);
  return h.reduce((s, m) => s + monthProfit(m), 0);
}

export function monthRevenue(m: { rev: Record<string, number> }): number {
  return Object.values(m.rev).reduce((a, b) => a + b, 0);
}

export function monthExpenses(m: { exp: Record<string, number> }): number {
  return Object.values(m.exp).reduce((a, b) => a + b, 0);
}

export function monthProfit(m: { rev: Record<string, number>; exp: Record<string, number> }): number {
  return monthRevenue(m) - monthExpenses(m);
}

export function equity(state: GameState): number {
  const deposits = state.fleet.reduce((s, a) => s + (a.ownership === 'leased' ? a.leaseDeposit : 0), 0);
  return state.cash + ownedFleetValue(state) + deposits - totalDebt(state);
}

export function companyValue(state: GameState): number {
  return Math.max(0, equity(state) + Math.max(0, trailingProfit(state)) * 6);
}

export const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC'] as const;
export type Rating = (typeof RATINGS)[number];

export function creditRating(state: GameState): Rating {
  const debt = totalDebt(state);
  const eq = Math.max(1, equity(state));
  const profit = trailingProfit(state);
  let score = 3;
  const de = debt / eq;
  if (de < 0.2) score -= 2;
  else if (de < 0.6) score -= 1;
  else if (de > 2) score += 2;
  else if (de > 1.2) score += 1;
  if (profit > 0 && state.finance.history.length >= 3) score -= 1;
  if (profit < 0) score += 1;
  if (state.cash < 0) score += 2;
  return RATINGS[clamp(score, 0, 6)];
}

export function interestRate(rating: Rating): number {
  return [0.045, 0.052, 0.06, 0.07, 0.085, 0.105, 0.14][RATINGS.indexOf(rating)];
}

export function creditLimit(state: GameState): number {
  const base = 15_000_000 + ownedFleetValue(state) * 0.5 + Math.max(0, trailingProfit(state));
  const r = creditRating(state);
  const factor = r === 'CCC' ? 0.3 : r === 'B' ? 0.6 : 1;
  return base * factor;
}

export function availableCredit(state: GameState): number {
  return Math.max(0, creditLimit(state) - totalDebt(state));
}

/** Monthly lease payments currently committed (including aircraft still being delivered). */
export function leaseCommitments(state: GameState): number {
  return state.fleet.reduce((s, a) => s + (a.ownership === 'leased' ? a.leaseMonthly : 0), 0);
}

/** Lessors cap total lease exposure based on the airline's size and strength. */
export function leaseCapacity(state: GameState): number {
  const h = state.finance.history.slice(-3);
  const rev = h.length ? h.reduce((s, m) => s + monthRevenue(m), 0) / h.length : 0;
  return 1_000_000 + 0.03 * Math.max(0, equity(state)) + 0.04 * rev;
}

export function loanPayment(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}
