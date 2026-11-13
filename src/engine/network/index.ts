// v0.19 "Scheduled routes" (docs/UPDATE-0.19.md; engine/network). The module, load/init and the event hooks.
// Every hook returns at once when no route exists, so a game without routes plays exactly as v0.18.3.

import { BAL } from '../core/balance';
import { accrue, post } from '../core/ledger';
import type { SimModule } from '../core/module';
import { DAY, fmtDay } from '../core/time';
import type { Flight, GameState, LedgerCat, SimEvent } from '../core/types';
import { routeDisruptionCost, routeMonthCosts, routeResting } from './costs';
import { cashOnly } from '../core/ledger';
import { notOursCancel } from '../ops/latePolicy';
import { bumpRoute } from './reputation';
import { inaugural, stepAwareness, stepLaunch } from './launch';
import { closePnlMonth } from './pnl';
import { fadeReputation } from './reputation';
import { onSectorArr, onSectorDep, pnlOf } from './revenue';
import { dailySales } from './sales';
import { materialise } from './timetable';
import { repairRouteCabins } from './cabin';
import type { NetworkState, Route, Rotation, SectorLoad } from './types';
import { netHooks } from '../core/netHooks';
import { marketOfRoute, usd } from './model';
import { pushRouteNote } from './notes';
import { clearForJob, routeConflicts } from './conflicts';

netHooks.conflicts = routeConflicts;
netHooks.clearForJob = clearForJob;

export { netSide, netRoll } from './side';
export * from './model';
export * from './launch';
export * from './sales';
export * from './revenue';
export * from './reputation';
export * from './pnl';
export * from './timetable';
export * from './costs';
export * from './conflicts';
export * from './notes';
export * from './custom';
export * from './stopover';
export * from './advice';
export * from './cabin';

const emptyStats = (): NetworkState['stats'] => ({ launched: 0, rotations: 0, pax: 0, swaps: 0, subs: 0, moves: 0, cancels: 0, downgrades: 0 });

/** Load and new game: `g.network` with empty routes and zero stats (the same shape either way). */
export function loadNetwork(g: GameState): void {
  const N = (g.network ??= { routes: {}, stats: emptyStats() });
  N.routes ??= {};
  N.stats ??= emptyStats();
  for (const r of Object.values(N.routes)) {
    r.stages ??= [];
    r.series ??= [];
    r.rotations ??= [];
    r.pnl ??= {};
    r.contractIds ??= [];
  }
  repairRouteCabins(g);
}

/** Bumps the network revision (the cards' and the UI's cache key). */
export function touchNetwork(g: GameState): void {
  if (g.network) g.network.rev = (g.network.rev ?? 0) + 1;
}

/** Routes that exist (any status but closed). */
export function routesOn(g: GameState): Route[] {
  if (!g.network) return [];
  return Object.values(g.network.routes).filter((r) => r.status !== 'closed');
}

/** The rotation and sector index of a route flight (undefined for any other flight). */
export function rotationOf(g: GameState, f: Flight): { route: Route; rot: Rotation; idx: number } | undefined {
  const s = f.sched;
  if (!s || !g.network) return undefined;
  const route = g.network.routes[s.routeId];
  const rot = route?.rotations.find((x) => x.id === s.rotId);
  if (!route || !rot || !rot.sectors[s.idx]) return undefined;
  return { route, rot, idx: s.idx };
}

/** The BSP bank guarantee comes back after its year; BSP pays the agents' ticket money on the 15th and the last day. */
function releaseBsp(g: GameState): void {
  const N = g.network!;
  const h = N.bspHold;
  if (h && g.now >= h.until) {
    cashOnly(g, h.amount);
    delete N.bspHold;
  }
  if (N.bspDue) {
    const d = new Date(Date.UTC(2000, 0, 1) + g.now * 60_000);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    if (d.getUTCDate() === 15 || d.getUTCDate() === last) {
      cashOnly(g, N.bspDue);
      N.bspDue = 0;
    }
  }
}

/** Daily: launch stages, sales, flights inside the materialise window, reputation and awareness. */
export function dailyNetwork(g: GameState): void {
  if (!g.network || !BAL.v019.on) return;
  const routes = routesOn(g);
  releaseBsp(g);
  if (!routes.length) return;
  for (const r of routes) {
    stepLaunch(g, r);
    dailySales(g, r);
    materialise(g, r);
    strandedRotations(g, r);
    fadeReputation(g, r);
    if (r.status === 'operating') stepAwareness(r);
    if (r.dents?.length) r.dents = r.dents.filter((d) => d.until > g.now);
  }
  touchNetwork(g);
}

/** Month end (before ops closes the statement): each route's overheads, then its month closes in its P&L. */
export function monthlyNetwork(g: GameState): void {
  if (!g.network || !BAL.v019.on) return;
  const routes = routesOn(g);
  if (!routes.length) return;
  for (const r of routes) {
    for (const [cat, v] of Object.entries(routeMonthCosts(r, routeResting(r, g.now - 1))) as [LedgerCat, number][]) if (v) post(g, cat, -Math.round(v));
    closePnlMonth(g, r);
  }
  touchNetwork(g);
}

function onDep(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f?.sched || f.status !== 'enroute' || f.ev !== ev.v) return;
  const at = rotationOf(g, f);
  if (!at) return;
  if (at.route.status === 'onSale' || (at.route.firstFlight !== undefined && Math.abs(f.std - at.route.firstFlight) < DAY)) inaugural(g, at.route);
  onSectorDep(g, f, at.rot, at.idx);
}

function onArr(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f?.sched || f.status !== 'done' || f.ev !== ev.v) return;
  const at = rotationOf(g, f);
  if (at) onSectorArr(g, f, at.rot, at.idx);
}

/** After any change: a rotation's aircraft follows its flights (a trip moved on the Schedule, a sub-charter). */
function settleNetwork(g: GameState): void {
  if (!g.network) return;
  for (const r of Object.values(g.network.routes)) {
    // A closed or suspended route can still have a rotation half flown (its return still to come).
    if (r.status === 'study' || r.status === 'case' || r.status === 'launching') continue;
    for (const rot of r.rotations) {
      if (rot.status !== 'flights') continue;
      const id = rot.sectors[0].flightId;
      const f = id ? g.flights[id] : undefined;
      if (!f) {
        // Its flights were removed by other means (a contract cancelled, pruning): planned again if still ahead.
        if (rot.dep > g.now && rot.sectors.every((s) => !s.flightId || !g.flights[s.flightId])) {
          rot.status = 'planned';
          rot.aircraftId = null;
          for (const s of rot.sectors) s.flightId = undefined;
        }
        continue;
      }
      if (f.aircraftId !== rot.aircraftId && f.status === 'scheduled') rot.aircraftId = f.aircraftId;
      if (f.operatedBy && !rot.operatedBy) rot.operatedBy = f.operatedBy;
      // Sectors operations cancelled on the day (no crew, AOG, a closure): refunds, EU261 and care, once.
      for (const s of rot.sectors) {
        const x = s.flightId ? g.flights[s.flightId] : undefined;
        if (!x || x.status !== 'cancelled' || s.accrued || s.voided) continue;
        voidSector(g, r, rot, s, x);
      }
      // Every sector either cancelled or landed: the rotation is over.
      if (rot.sectors.some((s) => s.voided) && rot.sectors.every((s) => s.voided || s.cost !== undefined)) rot.status = rot.sectors.every((s) => s.voided) ? 'cancelled' : 'flown';
    }
  }
}

/**
 * A rotation whose day passed without flights (no aircraft and no rival to fly it, or its flights removed): the
 * passengers are refunded and compensated as for a cancellation on the day.
 */
function strandedRotations(g: GameState, r: Route): void {
  for (const rot of r.rotations) {
    if ((rot.status !== 'planned' && rot.status !== 'flights') || rot.dep > g.now - 6 * 60) continue;
    if (rot.sectors.some((s) => s.flightId && g.flights[s.flightId] && g.flights[s.flightId].status !== 'cancelled')) continue;
    let comp = 0;
    let refund = 0;
    for (const s of rot.sectors) {
      if (s.accrued || s.voided) continue;
      s.voided = true;
      bookSubPre(g, s);
      const pax = Math.max(s.bookedJ + s.bookedY, 0);
      const band = marketOfRoute(r)?.eu261 === 'long' ? 2 : 1;
      const c = pax * (BAL.v019.pax.eu261[band] + BAL.v019.pax.meals);
      comp += c;
      s.cost = Math.round(c);
      if (s.sold) {
        refund += s.sold;
        s.sold = 0;
      }
    }
    if (refund) {
      cashOnly(g, -Math.round(refund));
      r.unearned = Math.max(0, Math.round(r.unearned - refund));
    }
    if (comp) post(g, 'paxComp', -Math.round(comp));
    pnlOf(r, g.now).direct += Math.round(comp);
    rot.status = 'cancelled';
    bumpRoute(g, r.id, BAL.v019.rep.cancelDay, 'Cancelled on the day');
    pushRouteNote(g, r, 'bad', `${r.marketId.replace('-', '–')} ${fmtDay(rot.dep)} did not fly`, `No aircraft and no operator could fly it. Passengers refunded and compensated (${usd(refund + comp)}).`, `stranded:${rot.id}`);
  }
}

/** Final debug round: a sector that will not fly books the sub-charter price paid for it (a rival's on-the-day cancel). */
function bookSubPre(g: GameState, s: SectorLoad): void {
  if (!s.subPre) return;
  accrue(g, 'subcharter', -s.subPre);
  delete s.subPre;
}

/** A route sector operations cancelled: its ticket money back, EU261 (or care only for force majeure), reputation. */
function voidSector(g: GameState, r: Route, rot: Rotation, s: SectorLoad, f: Flight): void {
  s.voided = true;
  bookSubPre(g, s);
  const comp = routeDisruptionCost(g, f, 'cancel', 0, notOursCancel(f.delayReason));
  if (comp) post(g, 'paxComp', -comp);
  if (s.sold) {
    cashOnly(g, -s.sold);
    r.unearned = Math.max(0, Math.round(r.unearned - s.sold));
    s.sold = 0;
  }
  s.cost = comp;
  bumpRoute(g, r.id, BAL.v019.rep.cancelDay, 'Cancelled on the day');
  const p = pnlOf(r, g.now);
  p.direct += comp;
  if (r.slots && rot.sectors.indexOf(s) === 0) r.slots.flown = Math.max(0, r.slots.flown);
}

export const networkModule: SimModule = {
  name: 'network',
  init: loadNetwork,
  load: loadNetwork,
  settle: (g) => settleNetwork(g),
  handlers: { day: dailyNetwork, month: monthlyNetwork, 'flight.dep': onDep, 'flight.arr': onArr },
};
