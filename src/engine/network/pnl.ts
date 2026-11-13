// v0.19 route P&L, live sector numbers and the ACMI comparison (UPDATE-0.19.md §J; additions 3 b). The month closes
// with the monthly overheads and the aircraft and crew time at cost (rent and insurance spread over the hours an
// aircraft flies a month, crew salaries over the hours a crew member flies): not ledger lines, only the route's view.

import { BAL } from '../core/balance';
import { complement, typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { insuranceOf, rentOf } from '../ops/finance';
import { rateMultiplier } from '../contracts/pricing';
import { costTotal, routeMonthCosts, routeResting, sectorCost, sectorOf, sectorPax } from './costs';
import type { RouteMarket } from '../../data/routes';
import { blockMinutes } from '../core/perf';
import { chainOf, marketOfRoute, stopMin, type Dir } from './model';
import { partnerFee, pnlOf } from './revenue';
import { dirSectors, expectedPax, curveAt } from './sales';
import type { Route } from './types';

/** Crew cost a block hour of a type (its legal complement's pay with on-costs over the hours a crew flies a month). */
export function crewCostBH(typeId: string, seats: number): number {
  const t = typeOf(typeId);
  if (!t) return 0;
  const wide = t.body === 'wide' ? 1 : 0;
  const roles = complement(typeId, seats);
  let pay = 0;
  for (const r of roles) pay += (BAL.salary[r]?.[wide] ?? BAL.salary.CC[0]);
  return (pay * (1 + BAL.onCosts)) / BAL.v019.pnl.crewBH;
}

/** Aircraft time a block hour (rent + insurance over the hours an aircraft flies a month). */
export function aircraftCostBH(g: GameState, aircraftId: string | null | undefined, typeId: string): number {
  const ac = aircraftId ? g.fleet[aircraftId] : undefined;
  const k = monthKey(g.now);
  const rent = ac ? rentOf(g, ac, k) : (typeOf(typeId)?.rentMonth ?? 300_000);
  const ins = ac ? insuranceOf(g, ac) : 20_000;
  return (rent + ins) / BAL.v019.pnl.utilBH;
}

/**
 * v0.21 the crew's cost away from base on one rotation of a plan (pure): nights at the destination (hotel and per diem
 * for the whole crew, who wait there and fly it back) and a long day flown with a third pilot (augmented: a day turn
 * or a chain whose duty, report to release, runs past `crewAway.dutyMax`).
 */
export function crewAwayCost(g: GameState, m: RouteMarket, typeId: string, seats: number, nights: number): { hotel: number; extraPilot: number; longDay: boolean; dutyH: number } {
  const t = typeOf(typeId);
  if (!t) return { hotel: 0, extraPilot: 0, longDay: false, dutyH: 0 };
  const A = BAL.v019.crewAway;
  const roles = complement(typeId, seats);
  const pol = g.company.policies;
  const hotelN = BAL.hotelPerNight[pol.hotelTier] ?? 140;
  const perDay = roles.reduce((a, r) => a + (BAL.perDiem[r] ?? 54), 0) * ((pol.perDiemPct ?? 100) / 100);
  const hotel = nights > 0 ? Math.round(nights * (roles.length * hotelN + perDay)) : 0;
  // Duties: each direction its own day after a night there; a day turn is one long day out and back.
  const blk = (dir: Dir) => {
    const c = chainOf(m, dir);
    let x = 0;
    for (let i = 1; i < c.length; i++) x += blockMinutes(typeId, c[i - 1], c[i]);
    return { block: x, ground: (c.length - 2) * stopMin(m, typeId) };
  };
  const o = blk('out');
  const b = blk('back');
  const days = nights > 0 ? [o.block + o.ground, b.block + b.ground] : [o.block + o.ground + (t.turnMin ?? 60) + b.block + b.ground];
  const blocks = nights > 0 ? [o.block, b.block] : [o.block + b.block];
  let extraPilot = 0;
  let longDay = false;
  const wide = t.body === 'wide' ? 1 : 0;
  const foBH = ((BAL.salary.FO?.[wide] ?? 6_000) * (1 + BAL.onCosts)) / BAL.v019.pnl.crewBH;
  days.forEach((d, i) => {
    if (d + A.reportMin + A.releaseMin > A.dutyMax) {
      longDay = true;
      extraPilot += Math.round((blocks[i] / 60) * foBH + (BAL.perDiem.FO ?? 76));
    }
  });
  const dutyH = Math.max(...days.map((d) => d + A.reportMin + A.releaseMin)) / 60;
  return { hotel, extraPilot, longDay, dutyH: Math.round(dutyH * 10) / 10 };
}

/** Month end (before ops closes the statement): the month's overheads and aircraft and crew time, the result. */
export function closePnlMonth(g: GameState, route: Route): void {
  const p = pnlOf(route, g.now - 1);
  const over = routeMonthCosts(route, routeResting(route, g.now - 1));
  const sum = Object.values(over).reduce((a, x) => a + (x ?? 0), 0);
  p.direct += Math.round(sum);
  const s = route.series[0];
  const recent = route.rotations.filter((r) => r.aircraftId && r.status === 'flown').slice(-1)[0];
  const typeId = recent?.aircraftId ? g.fleet[recent.aircraftId]?.typeId ?? s?.typeId ?? 'b763' : s?.typeId ?? 'b763';
  const seats = recent?.sectors[0] ? recent.sectors[0].capJ + recent.sectors[0].capY : 260;
  p.acTime = Math.round(p.bh * (aircraftCostBH(g, recent?.aircraftId, typeId) + crewCostBH(typeId, seats)));
  // v0.21 the crew away from base: nights there and long days with a third pilot (the business case counts the same).
  const m = marketOfRoute(route);
  const mk = monthKey(g.now - 1);
  if (m) {
    for (const rot of route.rotations) {
      if (rot.status !== 'flown' || rot.operatedBy || monthKey(rot.dep) !== mk) continue;
      const sr = route.series.find((x) => x.id === rot.seriesId) ?? s;
      const ac = rot.aircraftId ? g.fleet[rot.aircraftId] : undefined;
      const w = crewAwayCost(g, m, ac?.typeId ?? sr?.typeId ?? typeId, ac?.cabin.total ?? seats, sr?.nights ?? 0);
      p.acTime += w.hotel + w.extraPilot;
    }
  }
  p.result = Math.round(p.rev - p.direct - p.acTime);
}

/** The ACMI net a block hour of a type now (rate × the market's multiplier, less maintenance). */
export function acmiNetBH(g: GameState, typeId: string): number {
  const t = typeOf(typeId);
  if (!t) return 0;
  const m = rateMultiplier(g, typeId, g.now, 30 * DAY).m;
  return Math.round(t.rateBH * m - t.maintBH);
}

/** §J.3 the one-line comparison with ACMI over the last three closed months, or null before a month has flown. */
export function acmiCompare(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return null;
  const k = monthKey(g.now);
  let bh = 0;
  let contrib = 0;
  for (const m of [k - 3, k - 2, k - 1]) {
    const p = r.pnl[m];
    if (!p) continue;
    bh += p.bh;
    contrib += p.rev - p.direct;
  }
  if (bh < 1) return null;
  const typeId = r.series[0]?.typeId ?? 'b763';
  const per = Math.round(contrib / bh);
  const acmi = acmiNetBH(g, typeId);
  const name = typeOf(typeId)?.short ?? typeId;
  const usd = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US')}`;
  return `Last 3 months: ${usd(per)} a block hour after direct costs. A ${name} on ACMI earns about ${usd(acmi)} (rate less maintenance).`;
}

/** UPDATE-0.19 additions 3 (b): the live numbers of a route flight and the next sector's bookings. */
export interface SectorLive {
  paxJ: number;
  paxY: number;
  seatsJ: number;
  seatsY: number;
  lf: number;
  cargoKg: number;
  aviKg: number;
  mailKg?: number;
  revenue: number;
  cost: number;
  profit: number;
  flown: boolean;
  next?: { flightNo: string; std: number; bookedJ: number; bookedY: number; seatsJ: number; seatsY: number; lfForecast: number; vsCurve: number };
}

/** Live passengers, load, cargo and money of a route flight (booked before it leaves, flown after). Pure. */
export function sectorLive(g: GameState, flightId: string): SectorLive | null {
  const f = g.flights[flightId];
  const at = f ? sectorOf(g, f) : undefined;
  if (!f || !at) return null;
  const { route, rot, s, idx } = at;
  const p = sectorPax(s);
  const flown = !!s.accrued;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : null;
  const seatsJ = ac ? ac.cabin.j + ac.cabin.w : s.capJ;
  const seatsY = ac ? ac.cabin.y : s.capY;
  let revenue = s.rev ?? 0;
  let cost = s.cost ?? 0;
  if (!flown || s.cost === undefined) {
    // Estimate: tickets taken, cargo and extras at the catalogue's rates, the sector's costs.
    const m = marketOfRoute(route);
    // A partner pays its fee a block hour and the flying costs at cost (it sells the seats itself).
    const est = flown ? revenue : route.model === 'partner' ? partnerFee(g, route, s, f, p.j + p.y) : Math.round((s.sold ?? 0) + (p.j + p.y) * (m?.ancillary ?? 20));
    revenue = est;
    cost = Math.round(costTotal(sectorCost(g, route, f.from, f.to, ac?.typeId ?? route.series[0]?.typeId ?? 'b763', ac, { j: p.j, y: p.y, cargoKg: s.cargoKg, sold: s.sold ?? 0, blockMin: f.block })));
  }
  const out: SectorLive = {
    paxJ: p.j, paxY: p.y, seatsJ, seatsY, lf: (p.j + p.y) / Math.max(1, seatsJ + seatsY),
    cargoKg: s.cargoKg, aviKg: s.aviKg ?? 0, mailKg: s.mailKg, revenue, cost, profit: revenue - cost, flown,
  };
  // The next sector of this aircraft on the route (the return, the next leg after a stop, or the next rotation).
  const nextIdx = idx + 1 < rot.sectors.length ? idx + 1 : -1;
  const nx = nextIdx >= 0 ? { rot, i: nextIdx } : (() => {
    const r2 = route.rotations.find((r) => r.dep > rot.dep && (r.status === 'planned' || r.status === 'flights'));
    return r2 ? { rot: r2, i: 0 } : null;
  })();
  if (nx) {
    const ns = nx.rot.sectors[nx.i];
    const nf = ns.flightId ? g.flights[ns.flightId] : undefined;
    const dir = dirSectors(route, nx.rot, 'out').includes(nx.i) ? 'out' : 'back';
    const e = expectedPax(g, route, nx.rot, dir);
    const cap = Math.max(1, ns.capJ + ns.capY);
    const fc = Math.min(1, (Math.min(ns.capJ, e.j) + Math.min(ns.capY, e.y)) / cap);
    const dep = nf?.std ?? nx.rot.dep;
    const days = Math.max(0, (dep - g.now) / DAY);
    const usual = fc * curveAt(days);
    const now = (ns.bookedJ + ns.bookedY) / cap;
    out.next = {
      flightNo: nf?.no ?? '', std: dep, bookedJ: ns.bookedJ, bookedY: ns.bookedY, seatsJ: ns.capJ, seatsY: ns.capY,
      lfForecast: Math.round(fc * 100) / 100, vsCurve: Math.round((now - usual) * 100) / 100,
    };
  }
  return out;
}
