// v0.19 route P&L, live sector numbers and the ACMI comparison (UPDATE-0.19.md §J; additions 3 b). The month closes
// with the monthly overheads and the aircraft and crew time at cost (rent and insurance spread over the hours an
// aircraft flies a month, crew salaries over the hours a crew member flies): not ledger lines, only the route's view.

import { BAL } from '../core/balance';
import { complement, typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { GameState } from '../core/types';
import { insuranceOf, rentOf } from '../ops/finance';
import { rateMultiplier } from '../contracts/pricing';
import { costTotal, routeMonthCosts, sectorCost, sectorOf, sectorPax } from './costs';
import { marketOfRoute } from './model';
import { pnlOf } from './revenue';
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

/** Month end (before ops closes the statement): the month's overheads and aircraft and crew time, the result. */
export function closePnlMonth(g: GameState, route: Route): void {
  const p = pnlOf(route, g.now - 1);
  const over = routeMonthCosts(route);
  const sum = Object.values(over).reduce((a, x) => a + (x ?? 0), 0);
  p.direct += Math.round(sum);
  const s = route.series[0];
  const recent = route.rotations.filter((r) => r.aircraftId && r.status === 'flown').slice(-1)[0];
  const typeId = recent?.aircraftId ? g.fleet[recent.aircraftId]?.typeId ?? s?.typeId ?? 'b763' : s?.typeId ?? 'b763';
  const seats = recent?.sectors[0] ? recent.sectors[0].capJ + recent.sectors[0].capY : 260;
  p.acTime = Math.round(p.bh * (aircraftCostBH(g, recent?.aircraftId, typeId) + crewCostBH(typeId, seats)));
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
    const est = flown ? revenue : Math.round((s.sold ?? 0) + (p.j + p.y) * (m?.ancillary ?? 20));
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
