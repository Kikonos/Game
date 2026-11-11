// v0.19 route costs per sector and per month (UPDATE-0.19.md §G, §H.5). Pure: ops/flights.ts posts a route sector's
// lines at arrival from routeLegCost (the same sums the cash forecast and the sector P&L read); network/index.ts posts
// the monthly overheads at month end.

import { routeStation } from '../../data/routes';
import { BAL } from '../core/balance';
import { blockMinutes, typeOf } from '../core/perf';
import { yearOf } from '../core/time';
import type { Aircraft, Flight, GameState, LedgerCat } from '../core/types';
import { marketOfRoute } from './model';
import type { Rotation, Route, SectorLoad } from './types';

/** §G the cost lines of one route sector (USD, positive), same shape as legCostEstimate plus the route lines. */
export interface RouteLegCost {
  maint: number;
  reserves: number;
  fuel: number;
  fees: number;
  handling: number;
  catering: number;
  paxServices: number;
  navCharges: number;
  distribution: number;
}

export const ZERO_COST: RouteLegCost = { maint: 0, reserves: 0, fuel: 0, fees: 0, handling: 0, catering: 0, paxServices: 0, navCharges: 0, distribution: 0 };

/** The route, rotation and sector of a route flight. */
export function sectorOf(g: GameState, f: Flight): { route: Route; rot: Rotation; s: SectorLoad; idx: number } | undefined {
  const x = f.sched;
  if (!x) return undefined;
  const route = g.network?.routes[x.routeId];
  const rot = route?.rotations.find((r) => r.id === x.rotId);
  const s = rot?.sectors[x.idx];
  return route && rot && s ? { route, rot, s, idx: x.idx } : undefined;
}

/** Passengers on a sector: flown once it left, else booked (capped at the seats). */
export function sectorPax(s: SectorLoad): { j: number; y: number } {
  if (s.flownJ !== undefined || s.flownY !== undefined) return { j: s.flownJ ?? 0, y: s.flownY ?? 0 };
  return { j: Math.min(s.bookedJ, s.capJ), y: Math.min(s.bookedY, s.capY) };
}

/** A type's size against the 767-300ER reference (airport and navigation charges scale with the square root). */
function sizeX(typeId: string): number {
  const t = typeOf(typeId);
  return Math.sqrt(Math.max(80, t?.maxSeats ?? 290) / 290);
}

/** Catering band by block: ≤ 5 h, 5–9 h, more. */
const band = (blk: number) => (blk <= 300 ? 0 : blk <= 540 ? 1 : 2);

/**
 * §G one sector's costs (pure). Fuel at the uplift station's price (or Lisbon's when tankering), charges by station,
 * catering by class and length (double when the station has no caterer), passenger services, navigation, distribution.
 */
export function sectorCost(g: GameState, route: Pick<Route, 'marketId' | 'model' | 'tanker' | 'noCaterer'>, from: string, to: string, typeId: string, ac: Aircraft | null, opt: { j: number; y: number; cargoKg: number; sold: number; blockMin?: number }): RouteLegCost {
  const C = BAL.v019.cost;
  const t = typeOf(typeId);
  const m = marketOfRoute(route);
  const blk = opt.blockMin ?? blockMinutes(typeId, from, to);
  const bh = blk / 60;
  const narrow = t?.body !== 'wide';
  const sx = sizeX(typeId);
  const A = routeStation(from);
  const B = routeStation(to);
  const pax = opt.j + opt.y;
  // Maintenance (after reserves) as legCostEstimate.
  const age = ac ? Math.max(0, yearOf(g.now) - ac.builtYear) : 10;
  const all = (t?.maintBH ?? 1_500) * (1 + BAL.maintAgeFactor * Math.max(0, age - 12)) * bh;
  const fh = Math.max(0, blk - 20) / 60;
  const reserves = ac && ac.ownership.kind === 'dryLeaseIn' ? Math.min(all, ac.ownership.reservesPerFH * fh) : 0;
  // Fuel: tankering from home carries the return fuel at Lisbon's price, at a burn penalty.
  const burn = (t?.fuelTBH ?? 5) * bh * g.market.fuelPrice;
  const home = routeStation(m?.from ?? 'LIS');
  const tanker = !!route.tanker && A.fuelX > home.fuelX;
  const fuel = tanker ? burn * home.fuelX * (1 + C.tankerBurn * bh) : burn * A.fuelX;
  // Airport charges at landing, airline-borne passenger charges at departure.
  const fees = B.airport * sx * (narrow ? C.narrowX * 1.4 : 1) + A.paxCharge * pax;
  const handling = A.handling * (narrow ? C.narrowX : 1) + C.cargoHandling * opt.cargoKg * 2;
  const k = band(blk);
  const crew = (t?.cockpitMin ?? 2) + Math.ceil(Math.max(50, pax) / 40);
  const noCat = !A.caterer || !!route.noCaterer?.includes(from);
  const catering = (opt.j * C.cateringJ[k] + opt.y * C.cateringY[k] + crew * C.crewMeal) * (noCat ? 1 + C.doubleCatering : 1);
  const paxServices = (C.pss + C.services + C.insurance) * pax + (from === 'LIS' ? C.lounge * opt.j : 0);
  const direct = m ? blockMinutes(typeId, m.from, m.to) : blk;
  const navCharges = (m?.navPerSector ?? 3_000) * sx * Math.min(1.6, blk / Math.max(60, direct));
  const distribution = route.model === 'partner' ? 0
    : route.model === 'tour' ? opt.sold * (BAL.v019.fares.tourMargin + C.cardFee)
      : C.gds * C.agencyShare * pax + opt.sold * (C.cardFee * (1 - C.agencyShare) + C.commission);
  return { maint: all - reserves, reserves, fuel, fees, handling, catering, paxServices, navCharges, distribution };
}

/** §G a route sector's cost (pure): the flight's own aircraft, passengers and cargo. */
export function routeLegCost(g: GameState, f: Flight, ac: Aircraft, blockMin = f.block): RouteLegCost {
  const at = sectorOf(g, f);
  if (!at) return { ...ZERO_COST };
  const p = sectorPax(at.s);
  return sectorCost(g, at.route, f.from, f.to, ac.typeId, ac, { j: p.j, y: p.y, cargoKg: at.s.cargoKg, sold: at.s.sold ?? 0, blockMin });
}

/** The route lines of a sector cost (what ops posts beside fuel, maintenance and airport fees). */
export const ROUTE_COST_CATS: [keyof RouteLegCost, LedgerCat][] = [
  ['handling', 'handling'], ['catering', 'catering'], ['paxServices', 'paxServices'], ['navCharges', 'navCharges'], ['distribution', 'distribution'],
];

export const costTotal = (c: RouteLegCost): number => c.maint + c.reserves + c.fuel + c.fees + c.handling + c.catering + c.paxServices + c.navCharges + c.distribution;

export type DisruptionKind = 'delay' | 'cancel' | 'diversion';

/** EU261 band of a route: 1 mid (1,500–3,500 km), 2 long (more). */
function eu261Band(route: Pick<Route, 'marketId'>): number {
  return marketOfRoute(route)?.eu261 === 'long' ? 2 : 1;
}

/**
 * §H.5 on-the-day passenger cost of a disruption we caused (EU261, care). A delay of 3 h+ pays the band's compensation
 * to everyone on board (halved under 4 h on long routes) plus meals; an overnight delay a hotel; a cancellation on the
 * day: compensation, care and re-protection. A world event (force majeure) pays care only. Pure.
 */
export function routeDisruptionCost(g: GameState, f: Flight, kind: DisruptionKind, minutes: number, forceMajeure = false): number {
  const at = sectorOf(g, f);
  if (!at) return 0;
  const P = BAL.v019.pax;
  const p = sectorPax(at.s);
  const pax = p.j + p.y;
  if (!pax) return 0;
  const comp = P.eu261[eu261Band(at.route)];
  const meals = minutes >= 120 || kind === 'cancel' ? P.meals * pax : 0;
  const hotel = minutes >= 8 * 60 || kind === 'cancel' ? P.hotel * pax * 0.5 : 0;
  if (forceMajeure) return Math.round(meals + hotel);
  if (kind === 'cancel') return Math.round(comp * pax + meals + hotel);
  if (minutes < 180) return Math.round(meals);
  const half = eu261Band(at.route) === 2 && minutes < 240 ? 0.5 : 1;
  return Math.round(comp * half * pax + meals + hotel);
}

/** §G the month's overheads of every live route, by category (stations, distribution, marketing). Pure. */
export function monthlyRouteCosts(g: GameState): Partial<Record<LedgerCat, number>> {
  const out: Partial<Record<LedgerCat, number>> = {};
  for (const r of Object.values(g.network?.routes ?? {})) {
    for (const [k, v] of Object.entries(routeMonthCosts(r)) as [LedgerCat, number][]) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** One route's monthly overheads while it is on sale or flying (none while launching: the stages carry their costs). */
export function routeMonthCosts(r: Route): Partial<Record<LedgerCat, number>> {
  if (r.status !== 'onSale' && r.status !== 'operating' && r.status !== 'suspended') return {};
  const C = BAL.v019.cost;
  const m = marketOfRoute(r);
  if (!m) return {};
  const stops = new Set([...(m.via ?? []), ...(m.viaBack ?? [])]);
  let overhead = routeStation(m.to).overhead || C.overhead;
  // v0.21 a stopover's station is a real one (a station manager, a sales desk), shared with the flight's other end.
  const tag = m.stopover ? 1 : 0;
  overhead += (stops.size - tag) * C.techStopOverhead + tag * Math.round((routeStation(m.stopover?.at ?? m.to).overhead || C.overhead) * BAL.v019.stop.overheadX);
  if (m.rights === 'perFlight') overhead += C.perOperation;
  return {
    routeSetup: Math.round(r.status === 'suspended' ? overhead * 0.5 : overhead),
    distribution: r.model === 'partner' ? 0 : C.distributionMonth,
    marketing: r.model === 'partner' ? 0 : C.marketing[r.marketing] ?? 0,
  };
}

/** What cancelling a route sector on the day loses (pure): its ticket money (refunded) and the passengers' EU261 and care. */
export function routeCancelLoss(g: GameState, f: Flight): number {
  const at = sectorOf(g, f);
  if (!at || at.s.accrued) return 0;
  return Math.round((at.s.sold ?? 0) + routeDisruptionCost(g, f, 'cancel', 0));
}

/** A rival flies route sectors for us: its price is shared over them by block time (the sectors' cost at arrival). */
export function noteRouteSub(g: GameState, legs: Flight[], cost: number): void {
  const route = legs.filter((f) => f.sched);
  const blk = route.reduce((a, f) => a + Math.max(1, f.block), 0);
  if (!route.length || !cost) return;
  // The legs' share of the whole price (non-route legs in the same hand-over keep theirs).
  const all = legs.reduce((a, f) => a + Math.max(1, f.block), 0);
  const mine = (cost * blk) / Math.max(1, all);
  for (const f of route) {
    const at = sectorOf(g, f);
    if (at) at.s.subCost = Math.round((at.s.subCost ?? 0) + (mine * Math.max(1, f.block)) / blk);
  }
}

/** What a partner reimburses at cost on top of its block-hour fee: fuel, airport charges, handling, catering, navigation. */
export const passThrough = (c: RouteLegCost): number => c.fuel + c.fees + c.handling + c.catering + c.navCharges;
