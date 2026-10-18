// Player commands. Each validates its inputs, mutates the state and returns a result.

import { AIRCRAFT_BY_ID, type AircraftType, minAirportSize } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { COUNTRIES } from '../data/countries';
import { REGIONS, type ContinentId } from '../data/regions';
import type { CabinClass } from '../data/seats';
import { type CabinConfig, cabinInstallCost, cabinSeats, defaultCabin, totalSeats, validateCabin } from './cabin';
import { forecastRoute, routeSupply, totalOf } from './demand';
import {
  HUB_OPEN, MAX_WEEKLY_HOURS, MIN_ROUTE_KM, STATION_OPEN, ageYears, availableCredit, creditRating, heavyCheckCost,
  heavyCheckDays, interestRate, leaseCapacity, leaseCommitments, loanPayment, marketValue, newLeaseRate, refFares, refitDays, roundTripHours,
  trainingCost,
} from './economy';
import { resolveDecision as resolveEvent } from './events';
import { distance } from './geo';
import {
  LONG_HAUL_FEE, LONG_HAUL_LEVEL, REVENUE_MGMT_FEE, REVENUE_MGMT_LEVEL, continentUnlock, maxHubs, regionUnlock,
} from './progression';
import * as R from './rng';
import { capex, isAirportUnlocked, isHub, message, newId, spend } from './state';
import type { Aircraft, CampaignType, GameState, HubUpgrades, Policies } from './types';
import { dateToDay, pairKey } from './util';

export type Result = { ok: true; msg?: string } | { ok: false; error: string };
const ok = (msg?: string): Result => ({ ok: true, msg });
const fail = (error: string): Result => ({ ok: false, error });

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';

export function makeRegistration(state: GameState, hub: string): string {
  const country = AIRPORT_BY_CODE[hub].country;
  const prefix = COUNTRIES[country]?.reg ?? 'N';
  const taken = new Set(state.fleet.map((a) => a.reg));
  for (let i = 0; i < 200; i++) {
    let reg: string;
    if (prefix === 'N') reg = `N${R.int(state, 100, 999)}${state.airline.code.slice(0, 2)}`;
    else if (prefix === 'JA') reg = `JA${R.int(state, 10, 99)}${state.airline.code.slice(0, 1)}${R.pick(state, LETTERS.split(''))}`;
    else if (prefix === 'HL') reg = `HL${R.int(state, 7000, 8999)}`;
    else {
      let s = '';
      for (let k = 0; k < 3; k++) s += LETTERS[R.int(state, 0, LETTERS.length - 1)];
      reg = `${prefix}${s}`;
    }
    if (!taken.has(reg)) return reg;
  }
  return `${prefix}${state.nextId}`;
}

function requireTraining(state: GameState, t: AircraftType): number {
  return state.familiesTrained.includes(t.family) ? 0 : trainingCost(t);
}

function payTraining(state: GameState, t: AircraftType) {
  const cost = requireTraining(state, t);
  if (cost > 0) {
    spend(state, 'training', cost);
    state.familiesTrained.push(t.family);
    message(state, 'info', 'fleet', `${t.family} type rating`, `Pilots and engineers are being trained on the ${t.family} family ($${(cost / 1e6).toFixed(1)}M).`);
  }
}

function baseAircraft(state: GameState, t: AircraftType, hub: string, cabin: CabinConfig): Aircraft {
  return {
    id: newId(state, 'a'), typeId: t.id, reg: makeRegistration(state, hub), name: '', hub,
    ownership: 'owned', leaseMonthly: 0, leaseEndDay: 0, leaseDeposit: 0, purchasePrice: 0, bookValue: 0,
    builtDay: state.day, condition: 100, hours: 0, cycles: 0, cabin, status: 'delivering', statusUntil: state.day,
    assignments: [], acquiredDay: state.day, lifetimeRevenue: 0, lifetimeCost: 0, monthRevenue: 0, monthCost: 0,
    lastMonthProfit: 0, lastDisruption: -1,
  };
}

function checkHub(state: GameState, hub: string): Result | null {
  if (!isHub(state, hub)) return fail('Aircraft must be based at one of your hubs.');
  return null;
}

function checkCabin(t: AircraftType, cabin: CabinConfig): Result | null {
  const v = validateCabin(t, cabin);
  return v.ok ? null : fail(v.errors[0]);
}

export function dealDiscount(state: GameState, typeId: string): number {
  return state.market.deals.find((d) => d.typeId === typeId && d.until >= state.day)?.discount ?? 0;
}

export function bulkDiscount(qty: number): number {
  return qty >= 10 ? 0.12 : qty >= 5 ? 0.07 : qty >= 3 ? 0.04 : 0;
}

export function newOrderQuote(state: GameState, typeId: string, qty: number, cabin: CabinConfig) {
  const t = AIRCRAFT_BY_ID[typeId];
  const discount = Math.min(0.25, bulkDiscount(qty) + dealDiscount(state, typeId));
  const unit = t.price * (1 - discount) + cabinInstallCost(t, cabin);
  const training = requireTraining(state, t);
  const firstDelivery = Math.max(state.day + t.leadMonths * 30, dateToDay(t.availableFrom, 1, 15));
  return { unit, total: unit * qty + training, discount, training, firstDelivery, interval: 21 };
}

export function orderNew(state: GameState, typeId: string, qty: number, cabin: CabinConfig, hub: string): Result {
  const t = AIRCRAFT_BY_ID[typeId];
  if (!t || !t.inProduction) return fail('This aircraft is no longer in production.');
  if (state.level < t.minLevel) return fail(`Requires airline level ${t.minLevel}.`);
  if (qty < 1 || qty > 30) return fail('Order between 1 and 30 aircraft.');
  const e = checkHub(state, hub) ?? checkCabin(t, cabin);
  if (e) return e;
  const q = newOrderQuote(state, typeId, qty, cabin);
  if (state.cash < q.total) return fail('Not enough cash for this order.');
  payTraining(state, t);
  for (let i = 0; i < qty; i++) {
    const ac = baseAircraft(state, t, hub, structuredClone(cabin));
    ac.purchasePrice = q.unit;
    ac.bookValue = t.price * (1 - q.discount);
    ac.statusUntil = q.firstDelivery + i * q.interval;
    ac.builtDay = ac.statusUntil;
    capex(state, q.unit);
    state.fleet.push(ac);
  }
  message(state, 'good', 'fleet', `Order placed: ${qty}× ${t.name}`, `First delivery expected in ${Math.round((q.firstDelivery - state.day) / 30)} months.`);
  return ok(`Ordered ${qty}× ${t.name}`);
}

export function buyUsed(state: GameState, listingId: string, hub: string): Result {
  const l = state.market.used.find((u) => u.id === listingId);
  if (!l) return fail('This aircraft has already been sold.');
  const t = AIRCRAFT_BY_ID[l.typeId];
  const e = checkHub(state, hub);
  if (e) return e;
  const training = requireTraining(state, t);
  if (state.cash < l.price + training) return fail('Not enough cash.');
  payTraining(state, t);
  const ac = baseAircraft(state, t, hub, structuredClone(l.cabin));
  ac.builtDay = l.builtDay;
  ac.condition = l.condition;
  ac.purchasePrice = l.price;
  ac.bookValue = Math.min(l.price, marketValue(t, ageYears(state, l), l.condition));
  ac.statusUntil = state.day + R.int(state, 7, 14);
  capex(state, l.price);
  state.fleet.push(ac);
  state.market.used = state.market.used.filter((u) => u.id !== listingId);
  message(state, 'good', 'fleet', `Purchased ${t.name}`, `${ac.reg} will be ferried to ${hub} and enter service on delivery.`);
  return ok(`Bought ${t.name} ${ac.reg}`);
}

export function leaseQuote(state: GameState, offerId: string) {
  const o = state.market.leases.find((x) => x.id === offerId);
  if (!o) return null;
  const t = AIRCRAFT_BY_ID[o.typeId];
  return { deposit: o.monthly * 2, training: requireTraining(state, t), offer: o, type: t };
}

export function leaseAircraft(state: GameState, offerId: string, hub: string, cabin?: CabinConfig): Result {
  const q = leaseQuote(state, offerId);
  if (!q) return fail('This lease offer has expired.');
  const { offer, type: t } = q;
  if (offer.qty <= 0) return fail('No aircraft left in this offer.');
  if (state.level < t.minLevel) return fail(`Requires airline level ${t.minLevel}.`);
  const config = cabin ?? defaultCabin(t);
  const e = checkHub(state, hub) ?? checkCabin(t, config);
  if (e) return e;
  if (leaseCommitments(state) + offer.monthly > leaseCapacity(state)) {
    return fail(`Lessors won’t extend more credit — lease limit $${(leaseCapacity(state) / 1e6).toFixed(1)}M/month. Grow revenue or equity first.`);
  }
  const install = offer.isNew ? cabinInstallCost(t, config) * 0.25 : 0;
  if (state.cash < q.deposit + q.training + install) return fail('Not enough cash for the deposit.');
  payTraining(state, t);
  const ac = baseAircraft(state, t, hub, structuredClone(config));
  ac.ownership = 'leased';
  ac.leaseMonthly = offer.monthly;
  ac.leaseDeposit = q.deposit;
  ac.builtDay = offer.isNew ? state.day + offer.deliveryDays : offer.builtDay;
  ac.condition = offer.condition;
  ac.statusUntil = state.day + offer.deliveryDays;
  ac.leaseEndDay = ac.statusUntil + offer.termMonths * 30;
  state.cash -= q.deposit;
  if (install > 0) spend(state, 'other', install);
  state.fleet.push(ac);
  offer.qty -= 1;
  if (offer.qty <= 0) state.market.leases = state.market.leases.filter((x) => x.id !== offerId);
  message(state, 'good', 'fleet', `Lease signed: ${t.name}`, `${ac.reg} from ${offer.lessor} arrives in ${offer.deliveryDays} days. Lease: $${Math.round(offer.monthly / 1000)}K/month for ${offer.termMonths} months.`);
  return ok(`Leased ${t.name} ${ac.reg}`);
}

export function saleValue(state: GameState, ac: Aircraft): number {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  return marketValue(t, ageYears(state, ac), ac.condition) * 0.95;
}

export function earlyReturnFee(state: GameState, ac: Aircraft): number {
  const monthsLeft = Math.max(0, (ac.leaseEndDay - state.day) / 30);
  return Math.round(Math.min(monthsLeft, 6) * ac.leaseMonthly * 0.5);
}

export function sellAircraft(state: GameState, acId: string): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  if (!ac) return fail('Aircraft not found.');
  const t = AIRCRAFT_BY_ID[ac.typeId];
  if (ac.ownership === 'leased') {
    const fee = earlyReturnFee(state, ac);
    state.cash += ac.leaseDeposit;
    if (fee > 0) spend(state, 'leases', fee);
    message(state, 'info', 'fleet', `Lease returned: ${ac.reg}`, `${t.name} returned to the lessor.${fee > 0 ? ` Early return fee: $${Math.round(fee / 1000)}K.` : ''}`);
  } else if (ac.status === 'delivering') {
    const refund = ac.purchasePrice * 0.9;
    state.cash += refund;
    state.finance.current.assetSales += refund;
    state.finance.current.exp.other += ac.purchasePrice - refund;
    message(state, 'info', 'fleet', `Order cancelled: ${ac.reg}`, `Cancellation penalty: $${((ac.purchasePrice - refund) / 1e6).toFixed(1)}M.`);
  } else {
    const price = saleValue(state, ac);
    state.cash += price;
    state.finance.current.assetSales += price;
    const gain = price - ac.bookValue;
    if (gain >= 0) state.finance.current.rev.other += gain;
    else state.finance.current.exp.depreciation += -gain;
    message(state, 'info', 'fleet', `Sold ${ac.reg}`, `${t.name} sold for $${(price / 1e6).toFixed(1)}M.`);
  }
  state.fleet = state.fleet.filter((a) => a.id !== acId);
  return ok();
}

export function startHeavyCheck(state: GameState, acId: string): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  if (!ac || ac.status !== 'active') return fail('Aircraft is not available.');
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const cost = heavyCheckCost(t, ageYears(state, ac));
  if (state.cash < cost) return fail('Not enough cash.');
  spend(state, 'maintenance', cost);
  ac.status = 'maintenance';
  ac.statusUntil = state.day + heavyCheckDays(t);
  return ok(`${ac.reg} is in the hangar for ${heavyCheckDays(t)} days.`);
}

export function refitCost(ac: Aircraft, cabin: CabinConfig): number {
  if (ac.status === 'delivering') return 0;
  return cabinInstallCost(AIRCRAFT_BY_ID[ac.typeId], cabin) * 0.6 + 150_000;
}

export function reconfigure(state: GameState, acId: string, cabin: CabinConfig): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  if (!ac) return fail('Aircraft not found.');
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const e = checkCabin(t, cabin);
  if (e) return e;
  if (ac.status === 'delivering') {
    ac.cabin = structuredClone(cabin);
    return ok('Cabin updated — it will be installed before delivery.');
  }
  if (ac.status !== 'active') return fail('Aircraft is busy.');
  const cost = refitCost(ac, cabin);
  if (state.cash < cost) return fail('Not enough cash for the refit.');
  spend(state, 'maintenance', cost);
  ac.pendingCabin = structuredClone(cabin);
  ac.status = 'refit';
  ac.statusUntil = state.day + refitDays(t);
  return ok(`Refit scheduled: ${refitDays(t)} days out of service.`);
}

export function renameAircraft(state: GameState, acId: string, name: string): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  if (!ac) return fail('Aircraft not found.');
  ac.name = name.slice(0, 32);
  return ok();
}

export function transferAircraft(state: GameState, acId: string, hub: string): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  if (!ac) return fail('Aircraft not found.');
  if (!isHub(state, hub)) return fail('Destination must be one of your hubs.');
  if (ac.hub === hub) return fail('Already based there.');
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const d = distance(ac.hub, hub);
  if (d > t.rangeKm * 1.1) return fail('Beyond ferry range.');
  const cost = t.fuelBurn * d * state.market.fuel + 25_000;
  spend(state, 'other', cost);
  ac.hub = hub;
  ac.assignments = [];
  if (ac.status === 'active') {
    ac.status = 'ferry';
    ac.statusUntil = state.day + 2;
  }
  return ok(`${ac.reg} transferred to ${hub}.`);
}

// ---------- routes ----------

export function canFly(t: AircraftType, from: string, to: string): string | null {
  const d = distance(from, to);
  if (d > t.rangeKm) return `Out of range (${t.rangeKm.toLocaleString()} km max).`;
  const need = minAirportSize(t);
  if (AIRPORT_BY_CODE[from].size < need || AIRPORT_BY_CODE[to].size < need) return 'Airport too small for this aircraft.';
  return null;
}

export function routeOpenCost(state: GameState, to: string): number {
  if (isHub(state, to) || state.routes.some((r) => r.to === to || r.from === to)) return 0;
  return STATION_OPEN[AIRPORT_BY_CODE[to].size];
}

export function routeCheck(state: GameState, from: string, to: string): string | null {
  if (!isHub(state, from)) return 'Routes must start at one of your hubs.';
  if (from === to) return 'Pick a different destination.';
  if (!isAirportUnlocked(state, to)) return 'Destination region is locked.';
  if (distance(from, to) < MIN_ROUTE_KM) return 'Too short — passengers would drive.';
  if (state.routes.some((r) => pairKey(r.from, r.to) === pairKey(from, to))) return 'You already fly this route.';
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  if (A.continent !== B.continent && !state.licenses.longHaul) return 'Requires a Long-Haul Operations Certificate.';
  return null;
}

export function openRoute(state: GameState, from: string, to: string): Result & { routeId?: string } {
  const err = routeCheck(state, from, to);
  if (err) return fail(err);
  const cost = routeOpenCost(state, to);
  if (state.cash < cost) return fail('Not enough cash to open a station there.');
  if (cost > 0) spend(state, 'stations', cost);
  const id = newId(state, 'r');
  const flightNo = 100 + state.routes.length * 4 + R.int(state, 0, 3);
  state.routes.push({
    id, from, to, dist: distance(from, to), prices: refFares(distance(from, to)), createdDay: state.day,
    promoUntil: -1, flightNo, acc: { pax: 0, seats: 0, rev: 0, cost: 0, connPax: 0, days: 0 }, history: [], last: null,
    lifetime: { pax: 0, rev: 0, cost: 0 },
  });
  if (!state.stats.destinationsEver.includes(to)) {
    state.stats.destinationsEver.push(to);
  }
  message(state, 'good', 'ops', `New route: ${from}–${to}`, `${AIRPORT_BY_CODE[from].city} to ${AIRPORT_BY_CODE[to].city} is open for bookings. Assign aircraft to start flying.`);
  return { ok: true, routeId: id };
}

export function closeRoute(state: GameState, routeId: string): Result {
  const r = state.routes.find((x) => x.id === routeId);
  if (!r) return fail('Route not found.');
  for (const ac of state.fleet) ac.assignments = ac.assignments.filter((a) => a.routeId !== routeId);
  state.routes = state.routes.filter((x) => x.id !== routeId);
  message(state, 'info', 'ops', `Route closed: ${r.from}–${r.to}`);
  return ok();
}

export function setPrices(state: GameState, routeId: string, prices: Partial<Record<CabinClass, number>>): Result {
  const r = state.routes.find((x) => x.id === routeId);
  if (!r) return fail('Route not found.');
  for (const [c, v] of Object.entries(prices)) {
    if (v !== undefined && Number.isFinite(v)) r.prices[c as CabinClass] = Math.max(5, Math.round(v));
  }
  return ok();
}

export function hoursUsed(ac: Aircraft, state: GameState, exceptRoute?: string): number {
  const t = AIRCRAFT_BY_ID[ac.typeId];
  let h = 0;
  for (const a of ac.assignments) {
    if (a.routeId === exceptRoute) continue;
    const r = state.routes.find((x) => x.id === a.routeId);
    if (r) h += a.freq * roundTripHours(t, r.dist);
  }
  return h;
}

export function maxFreqFor(state: GameState, ac: Aircraft, routeId: string): number {
  const r = state.routes.find((x) => x.id === routeId);
  if (!r) return 0;
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const free = MAX_WEEKLY_HOURS - hoursUsed(ac, state, routeId);
  return Math.max(0, Math.floor(free / roundTripHours(t, r.dist)));
}

/** A sensible weekly frequency for adding this aircraft to a route: enough seats for the expected demand. */
export function suggestFreq(state: GameState, ac: Aircraft, routeId: string): number {
  const max = maxFreqFor(state, ac, routeId);
  const r = state.routes.find((x) => x.id === routeId);
  if (!r || max <= 0) return 0;
  const t = AIRCRAFT_BY_ID[ac.typeId];
  const prev = ac.assignments;
  ac.assignments = [...prev.filter((a) => a.routeId !== routeId), { routeId, freq: max }];
  const supply = routeSupply(state, r, false);
  const fc = forecastRoute(state, r, supply);
  ac.assignments = prev;
  const perFlight = totalSeats(cabinSeats(t, ac.cabin));
  const otherSeats = totalOf(supply.seats) - (perFlight * max) / 7;
  const need = totalOf(fc.demand) * 1.05 - otherSeats;
  return Math.max(1, Math.min(max, Math.ceil((need * 7) / Math.max(1, perFlight))));
}

export function assignAircraft(state: GameState, acId: string, routeId: string, freq: number): Result {
  const ac = state.fleet.find((a) => a.id === acId);
  const r = state.routes.find((x) => x.id === routeId);
  if (!ac || !r) return fail('Not found.');
  const t = AIRCRAFT_BY_ID[ac.typeId];
  if (ac.hub !== r.from) return fail(`${ac.reg} is based at ${ac.hub}, not ${r.from}.`);
  const why = canFly(t, r.from, r.to);
  if (why) return fail(why);
  const f = Math.max(0, Math.round(freq));
  if (f > maxFreqFor(state, ac, routeId)) return fail('Not enough flying hours left on this aircraft.');
  ac.assignments = ac.assignments.filter((a) => a.routeId !== routeId);
  if (f > 0) ac.assignments.push({ routeId, freq: f });
  return ok();
}

// ---------- hubs & expansion ----------

export function hubOpenCost(code: string): number {
  return HUB_OPEN[AIRPORT_BY_CODE[code].size];
}

export function openHub(state: GameState, code: string): Result {
  if (isHub(state, code)) return fail('Already a hub.');
  if (!isAirportUnlocked(state, code)) return fail('Region is locked.');
  if (state.hubs.length >= maxHubs(state.level)) return fail(`Your level allows ${maxHubs(state.level)} hub(s).`);
  const home = REGIONS.find((r) => r.id === state.airline.homeRegion)!.continent;
  if (AIRPORT_BY_CODE[code].continent !== home && state.level < 6) return fail('Overseas hubs require level 6.');
  const cost = hubOpenCost(code);
  if (state.cash < cost) return fail('Not enough cash.');
  spend(state, 'stations', cost);
  state.hubs.push({ code, openedDay: state.day, upgrades: { lounge: false, maintenance: false, connections: false } });
  message(state, 'good', 'ops', `New hub: ${AIRPORT_BY_CODE[code].city}`, 'Base aircraft here to fly routes from this airport.');
  return ok();
}

export const HUB_UPGRADES: Record<keyof HubUpgrades, { name: string; cost: number; monthly: number; desc: string }> = {
  lounge: { name: 'Premium Lounge', cost: 3_000_000, monthly: 120_000, desc: 'Boosts business & first class satisfaction on routes from this hub.' },
  maintenance: { name: 'Maintenance Base', cost: 8_000_000, monthly: 200_000, desc: 'Cuts maintenance costs by 15% for aircraft based here.' },
  connections: { name: 'Connection Centre', cost: 6_000_000, monthly: 150_000, desc: 'Smoother transfers: +30% connecting passengers through this hub.' },
};

export function upgradeHub(state: GameState, code: string, up: keyof HubUpgrades): Result {
  const hub = state.hubs.find((h) => h.code === code);
  if (!hub) return fail('Not a hub.');
  if (hub.upgrades[up]) return fail('Already built.');
  const u = HUB_UPGRADES[up];
  if (state.cash < u.cost) return fail('Not enough cash.');
  spend(state, 'stations', u.cost);
  hub.upgrades[up] = true;
  return ok(`${u.name} opened at ${code}.`);
}

export function unlockRegion(state: GameState, regionId: string): Result {
  const o = regionUnlock(state, regionId);
  if (!o.available) return fail(o.reason ?? 'Unavailable');
  spend(state, 'licenses', o.fee);
  state.unlockedRegions.push(regionId);
  message(state, 'good', 'goal', `Traffic rights: ${o.name}`, 'New destinations are available in the Route Planner.');
  return ok(`${o.name} unlocked!`);
}

export function unlockContinent(state: GameState, c: ContinentId): Result {
  const o = continentUnlock(state, c);
  if (!o.available) return fail(o.reason ?? 'Unavailable');
  spend(state, 'licenses', o.fee);
  for (const r of REGIONS) if (r.continent === c && !state.unlockedRegions.includes(r.id)) state.unlockedRegions.push(r.id);
  message(state, 'good', 'goal', `Traffic rights: ${o.name}`, 'An entire continent is now open to your network.');
  return ok(`${o.name} unlocked!`);
}

export function buyLongHaulLicense(state: GameState): Result {
  if (state.licenses.longHaul) return fail('Already certified.');
  if (state.level < LONG_HAUL_LEVEL) return fail(`Requires level ${LONG_HAUL_LEVEL}.`);
  if (state.cash < LONG_HAUL_FEE) return fail('Not enough cash.');
  spend(state, 'licenses', LONG_HAUL_FEE);
  state.licenses.longHaul = true;
  message(state, 'good', 'goal', 'Long-Haul Operations Certificate granted', 'You can now unlock other continents and fly intercontinental routes.');
  return ok('Long-haul certified!');
}

export function buyRevenueManagement(state: GameState): Result {
  if (state.licenses.revenueMgmt) return fail('Already installed.');
  if (state.level < REVENUE_MGMT_LEVEL) return fail(`Requires level ${REVENUE_MGMT_LEVEL}.`);
  if (state.cash < REVENUE_MGMT_FEE) return fail('Not enough cash.');
  spend(state, 'other', REVENUE_MGMT_FEE);
  state.licenses.revenueMgmt = true;
  state.policies.autoPricing = true;
  return ok('Revenue management system online.');
}

// ---------- finance ----------

export function loanTerms(state: GameState, months: number) {
  const base = interestRate(creditRating(state));
  const premium = months >= 120 ? 0.01 : months >= 60 ? 0.005 : 0;
  return { rate: base + premium, max: availableCredit(state) };
}

export function takeLoan(state: GameState, amount: number, months: number): Result {
  const { rate, max } = loanTerms(state, months);
  if (amount < 1_000_000) return fail('Minimum loan is $1M.');
  if (amount > max + 1) return fail('Exceeds your available credit.');
  state.loans.push({
    id: newId(state, 'n'), principal: amount, balance: amount, rate, months, monthsLeft: months,
    payment: loanPayment(amount, rate, months), takenDay: state.day,
  });
  state.cash += amount;
  return ok(`Borrowed $${(amount / 1e6).toFixed(1)}M at ${(rate * 100).toFixed(1)}%.`);
}

export function repayLoan(state: GameState, loanId: string): Result {
  const l = state.loans.find((x) => x.id === loanId);
  if (!l) return fail('Loan not found.');
  const fee = l.balance * 0.01;
  if (state.cash < l.balance + fee) return fail('Not enough cash.');
  state.cash -= l.balance;
  spend(state, 'interest', fee);
  state.loans = state.loans.filter((x) => x.id !== loanId);
  return ok('Loan repaid early (1% fee).');
}

export function hedgeQuote(state: GameState, pct: number, months: number) {
  const monthlyFuel = state.finance.history.length
    ? state.finance.history.slice(-3).reduce((s, m) => s + m.exp.fuel, 0) / Math.min(3, state.finance.history.length)
    : state.finance.current.exp.fuel;
  return { cost: Math.round(monthlyFuel * pct * months * 0.03), price: state.market.fuel };
}

export function hedgeFuel(state: GameState, pct: number, months: number): Result {
  if (state.hedge && state.hedge.until > state.day) return fail('A hedge is already active.');
  const q = hedgeQuote(state, pct, months);
  if (state.cash < q.cost) return fail('Not enough cash.');
  spend(state, 'fuel', q.cost);
  state.hedge = { pct, price: q.price, until: state.day + months * 30 };
  return ok(`Hedged ${Math.round(pct * 100)}% of fuel at $${q.price.toFixed(2)}/kg for ${months} months.`);
}

// ---------- marketing & product ----------

export const CAMPAIGNS: Record<Exclude<CampaignType, 'route'>, { name: string; cost: number; days: number; boost: number; desc: string }> = {
  social: { name: 'Social Media Blitz', cost: 300_000, days: 30, boost: 0.05, desc: 'Targeted ads in one region. +5% demand for 30 days.' },
  regional: { name: 'TV & Billboard Campaign', cost: 1_800_000, days: 60, boost: 0.1, desc: 'Prime-time reach in one region. +10% demand for 60 days.' },
  global: { name: 'Global Brand Campaign', cost: 9_000_000, days: 90, boost: 0.07, desc: 'Worldwide brand building. +7% demand everywhere for 90 days.' },
};

export function launchCampaign(state: GameState, type: Exclude<CampaignType, 'route'>, target: string): Result {
  const c = CAMPAIGNS[type];
  if (state.cash < c.cost) return fail('Not enough cash.');
  spend(state, 'marketing', c.cost);
  state.campaigns.push({ id: newId(state, 'k'), type, target, startDay: state.day, endDay: state.day + c.days, boost: c.boost });
  return ok(`${c.name} launched.`);
}

export const ROUTE_PROMO_COST = (dist: number) => Math.round(80_000 + dist * 40);

export function promoteRoute(state: GameState, routeId: string): Result {
  const r = state.routes.find((x) => x.id === routeId);
  if (!r) return fail('Route not found.');
  if (r.promoUntil >= state.day) return fail('A promotion is already running.');
  const cost = ROUTE_PROMO_COST(r.dist);
  if (state.cash < cost) return fail('Not enough cash.');
  spend(state, 'marketing', cost);
  r.promoUntil = state.day + 28;
  return ok('Route promotion running for 4 weeks (+15% demand).');
}

export const LOYALTY_COST = 5_000_000;
export const LOYALTY_LEVEL = 3;

export function launchLoyalty(state: GameState): Result {
  if (state.loyalty.active) return fail('Already running.');
  if (state.level < LOYALTY_LEVEL) return fail(`Requires level ${LOYALTY_LEVEL}.`);
  if (state.cash < LOYALTY_COST) return fail('Not enough cash.');
  spend(state, 'marketing', LOYALTY_COST);
  state.loyalty = { active: true, members: 0, since: state.day };
  message(state, 'good', 'news', 'Frequent flyer programme launched', 'Members earn miles on every flight — and keep coming back.');
  return ok('Loyalty programme launched!');
}

export function setPolicies(state: GameState, p: Partial<Policies>): Result {
  Object.assign(state.policies, p);
  return ok();
}

export function resolveDecision(state: GameState, decisionId: string, optionId: string): Result {
  resolveEvent(state, decisionId, optionId);
  return ok();
}

export function markAllRead(state: GameState) {
  for (const m of state.messages) m.read = true;
}

export function leasePreviewMonthly(t: AircraftType) {
  return newLeaseRate(t);
}
