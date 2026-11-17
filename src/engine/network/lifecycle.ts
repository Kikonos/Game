// v0.24.1 a live route's lifecycle: suspend, resume, wind down (stop selling, fly what is booked, then close) and
// close now. Each has a pure quote with the money up front; the actions move money only through cancelRotation (the
// ledger) and the monthly overheads (costs.ts). Deterministic: no randomness here.

import { BAL } from '../core/balance';
import { removeFlights } from '../core/entities';
import { DAY, fmtDay } from '../core/time';
import type { GameState, Minute } from '../core/types';
import { relinkPositioning } from '../contracts/schedule';
import { autoRoster } from '../crew/roster';
import { costTotal, routeMonthCosts, sectorCost } from './costs';
import { marketOfRoute, usd } from './model';
import { pushRouteNote } from './notes';
import { dirSectors } from './sales';
import { cancelRotation, fileRotations, quoteCancelRotation, rotationSchedule, seriesDates } from './timetable';
import type { Rotation, Route } from './types';

const LIFE = () => BAL.v019.life;
const touch = (g: GameState) => { if (g.network) g.network.rev = (g.network.rev ?? 0) + 1; };

export type RouteAction = 'suspend' | 'resume' | 'windDown' | 'close';

/** Where a route stands for these actions: live (on sale or flying), suspended, winding down, or none of them. */
export function routeLife(r: Route): 'live' | 'suspended' | 'closing' | 'other' {
  if (r.status === 'closed') return 'other';
  if (r.closing) return 'closing';
  if (r.status === 'suspended') return 'suspended';
  if (r.status === 'onSale' || r.status === 'operating') return 'live';
  return 'other';
}

/** The actions a route offers now (in the order the page shows them). */
export function routeActions(r: Route): RouteAction[] {
  switch (routeLife(r)) {
    case 'live': return ['suspend', 'windDown', 'close'];
    case 'suspended': return ['resume', 'windDown', 'close'];
    case 'closing': return ['resume', 'close'];
    default: return [];
  }
}

/** A rotation not yet over (planned or with its flights). */
const ahead = (rot: Rotation) => rot.status === 'planned' || rot.status === 'flights';
/** Its first sector has left: the rest flies home whatever happens. */
const started = (g: GameState, rot: Rotation) => rot.sectors.some((s) => s.accrued || s.voided || (s.flightId && (g.flights[s.flightId]?.status === 'enroute' || g.flights[s.flightId]?.status === 'done')));
/** Anyone booked on it. */
const hasPax = (rot: Rotation) => rot.sectors.some((s) => s.bookedJ + s.bookedY > 0 || (s.sold ?? 0) > 0);

/** Passengers booked on a rotation (each direction's first sector: a through passenger counts once). */
export function rotationPax(route: Route, rot: Rotation): number {
  let n = 0;
  for (const dir of ['out', 'back'] as const) {
    const idx = dirSectors(route, rot, dir);
    const s = idx.length ? rot.sectors[idx[0]] : undefined;
    if (s) n += s.bookedJ + s.bookedY;
  }
  return n;
}

/** The direct cost of flying a rotation's sectors still to fly, at its bookings (USD). Pure. */
export function rotationFlyCost(g: GameState, route: Route, rot: Rotation): number {
  // Another operator flies it: its price is paid already, nothing more to fly it.
  if (rot.operatedBy) return 0;
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  const ac = rot.aircraftId ? g.fleet[rot.aircraftId] ?? null : s?.tail ? g.fleet[s.tail] ?? null : null;
  const typeId = ac?.typeId ?? s?.typeId;
  if (!typeId) return 0;
  let c = 0;
  for (const sec of rot.sectors) {
    if (sec.accrued || sec.voided) continue;
    c += costTotal(sectorCost(g, route, sec.from, sec.to, typeId, ac, { j: Math.min(sec.bookedJ, sec.capJ), y: Math.min(sec.bookedY, sec.capY), cargoKg: sec.cargoKg, sold: sec.sold ?? 0 }));
  }
  return Math.round(c);
}

/** The last arrival of a rotation (UTC). */
function lastArr(g: GameState, route: Route, rot: Rotation): Minute {
  const t = rotationSchedule(g, route, rot);
  return t.length ? t[t.length - 1].sta : rot.dep;
}

/** The month's overheads of a route in a state (USD). Pure. */
function overheadIn(r: Route, status: Route['status'], closing = false): number {
  const x = { ...r, status, closing: closing ? { at: 0, last: 0 } : undefined } as Route;
  return Object.values(routeMonthCosts(x)).reduce((a, v) => a + (v ?? 0), 0);
}

export interface RouteLifeQuote {
  ok: boolean;
  why?: string;
  /** Rotations still to fly (not started). */
  ahead: number;
  /** Of them, with passengers booked. */
  booked: number;
  /** Of them, with no one booked (withdrawn at no cost: a filed flight with no sales). */
  empty: number;
  /** Rotations already under way (they fly home whatever). */
  underWay: number;
  /** Passengers booked on the booked rotations (each way counted). */
  pax: number;
  /** Cancel the booked rotations now: ticket money back, passenger costs (notice, re-protection), a sub-charter's price back. */
  refunds: number;
  comp: number;
  subBack: number;
  /** refunds + comp − subBack: what refunding everyone costs. */
  refundCost: number;
  /** Fly the booked rotations: their direct costs (fuel, charges, handling, catering, maintenance). */
  flyCost: number;
  /** The overheads until the last booked flight (the station, distribution) while they fly. */
  flyOverhead: number;
  /** Departure of the first and arrival of the last booked rotation. */
  firstFlight?: Minute;
  lastFlight?: Minute;
  /** Wind down against close now (positive: winding down costs less). */
  saved: number;
  /** Monthly overheads: as now, suspended, while winding down. */
  monthNow: number;
  monthSuspended: number;
  monthClosing: number;
  /** A suspension: the date the slots lapse when the booked flights fly, and when they are refunded. */
  slotsKeep: Minute;
  slotsRefund: Minute;
  /** Resume: the first departure filed again. */
  resumeFirst?: Minute;
}

/** Every number the four actions need (pure). */
export function quoteRouteLife(g: GameState, routeId: string): RouteLifeQuote {
  const r = g.network?.routes[routeId];
  const z: RouteLifeQuote = { ok: false, ahead: 0, booked: 0, empty: 0, underWay: 0, pax: 0, refunds: 0, comp: 0, subBack: 0, refundCost: 0, flyCost: 0, flyOverhead: 0, saved: 0, monthNow: 0, monthSuspended: 0, monthClosing: 0, slotsKeep: g.now, slotsRefund: g.now };
  if (!r) return { ...z, why: 'This route no longer exists.' };
  if (routeLife(r) === 'other') return { ...z, why: r.status === 'closed' ? 'This route is closed.' : 'Not on sale yet.' };
  const q = { ...z, ok: true };
  for (const rot of r.rotations) {
    if (!ahead(rot)) continue;
    if (started(g, rot)) { q.underWay++; continue; }
    q.ahead++;
    if (!hasPax(rot)) { q.empty++; continue; }
    q.booked++;
    q.pax += rotationPax(r, rot);
    const c = quoteCancelRotation(g, rot.id);
    if (c.ok) {
      q.refunds += c.refunds;
      q.comp += c.cost;
      q.subBack += c.subBack ?? 0;
    }
    q.flyCost += rotationFlyCost(g, r, rot);
    q.firstFlight = Math.min(q.firstFlight ?? rot.dep, rot.dep);
    q.lastFlight = Math.max(q.lastFlight ?? 0, lastArr(g, r, rot));
  }
  for (const rot of r.rotations) if (ahead(rot) && started(g, rot)) q.lastFlight = Math.max(q.lastFlight ?? 0, lastArr(g, r, rot));
  q.refundCost = q.refunds + q.comp - q.subBack;
  q.monthNow = overheadIn(r, r.status, !!r.closing);
  q.monthSuspended = overheadIn(r, 'suspended');
  q.monthClosing = overheadIn(r, r.status === 'suspended' ? 'suspended' : r.status, true);
  const months = q.lastFlight ? Math.max(0, q.lastFlight - g.now) / (30 * DAY) : 0;
  q.flyOverhead = Math.round(months * q.monthClosing);
  q.saved = Math.round(q.refundCost - q.flyCost - q.flyOverhead);
  const hold = LIFE().slotHoldDays * DAY;
  q.slotsKeep = Math.max(g.now, q.lastFlight ?? g.now) + hold;
  const underWayEnd = r.rotations.filter((x) => ahead(x) && started(g, x)).reduce((a, x) => Math.max(a, lastArr(g, r, x)), g.now);
  q.slotsRefund = underWayEnd + hold;
  if (r.status === 'suspended' || r.closing) q.resumeFirst = resumeFirst(g, r);
  return q;
}

/** The first departure a resumed route would file (none when its timetable has ended). Pure. */
export function resumeFirst(g: GameState, r: Route): Minute | undefined {
  const from = g.now + LIFE().refileDays * DAY;
  let best: Minute | undefined;
  for (const s of r.series) {
    if (s.to < from) continue;
    const d = seriesDates(g, r, { ...s, from: Math.max(s.from, from - DAY), to: Math.min(s.to, from + 400 * DAY) }).find((x) => x >= from);
    if (d !== undefined && (best === undefined || d < best)) best = d;
  }
  return best;
}

/** Withdraws a rotation nobody booked: its flights come off, no one to refund (a sub-charter is cancelled for its price back). */
function dropEmpty(g: GameState, r: Route, rot: Rotation): void {
  if (rot.operatedBy) {
    cancelRotation(g, rot.id, 'Route suspended');
    return;
  }
  const ids = rot.sectors.map((s) => s.flightId).filter((x): x is string => !!x && g.flights[x]?.status === 'scheduled');
  const acId = rot.aircraftId;
  if (ids.length) removeFlights(g, ids);
  const i = r.rotations.indexOf(rot);
  if (i >= 0) r.rotations.splice(i, 1);
  if (acId && g.fleet[acId]) {
    relinkPositioning(g, acId);
    autoRoster(g, { aircraftIds: [acId] });
  }
}

/** Stops sales: the empty rotations go, the booked ones fly or are refunded (`refund`). */
function stopSelling(g: GameState, r: Route, refund: boolean, why: string): void {
  for (const rot of [...r.rotations]) {
    if (!ahead(rot) || started(g, rot)) continue;
    if (!hasPax(rot)) dropEmpty(g, r, rot);
    else if (refund) cancelRotation(g, rot.id, why);
  }
  delete r.fares.saleUntil;
}

/** The last arrival of the rotations still to fly (or under way); undefined when none. */
function lastLive(g: GameState, r: Route): Minute | undefined {
  let t: Minute | undefined;
  for (const rot of r.rotations) if (ahead(rot)) t = Math.max(t ?? 0, lastArr(g, r, rot));
  return t;
}

/** The route closes (its rotations are already flown or cancelled): its contracts end once no flight is left. */
function finishClose(g: GameState, r: Route): void {
  r.status = 'closed';
  r.closed = g.now;
  delete r.suspended;
  delete r.closing;
  delete r.refileFrom;
  endContracts(g, r);
  touch(g);
}

function endContracts(g: GameState, r: Route): void {
  for (const c of r.contractIds) {
    const k = g.contracts[c];
    if (!k || k.status !== 'active') continue;
    const live = Object.values(g.flights).some((f) => f.contractId === c && (f.status === 'scheduled' || f.status === 'enroute'));
    if (!live) k.status = 'completed';
  }
}

const city = (r: Route) => marketOfRoute(r)?.city ?? r.marketId;

/**
 * Suspends a live route: sales stop, empty rotations are withdrawn, the booked ones fly (`refund` false) or are
 * cancelled with refunds. The station runs at half cost; the slots are kept 6 weeks past the last flight. Null when done.
 */
export function suspendRoute(g: GameState, routeId: string, refund: boolean): string | null {
  const r = g.network?.routes[routeId];
  if (!r || routeLife(r) !== 'live') return 'Only a route on sale or flying can be suspended.';
  const prev = r.status === 'operating' ? 'operating' : 'onSale';
  stopSelling(g, r, refund, 'Route suspended');
  r.status = 'suspended';
  const last = lastLive(g, r);
  r.suspended = { at: g.now, prev, slotsUntil: Math.max(g.now, last ?? g.now) + LIFE().slotHoldDays * DAY };
  pushRouteNote(g, r, 'info', `${city(r)} suspended`, `No more sales.${last ? ` Booked flights fly until ${fmtDay(last)}.` : ''} Slots kept until ${fmtDay(r.suspended.slotsUntil)}: resume before then or the route closes.`, null, 'silent');
  touch(g);
  return null;
}

/**
 * Resumes a suspended or winding-down route: on sale again, the timetable filed from 14 days out, bookings building
 * up again (rampOf). Null when done.
 */
export function resumeRoute(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  const life = routeLife(r);
  if (life !== 'suspended' && life !== 'closing') return 'This route is not suspended or closing.';
  if (r.status === 'suspended') {
    const flown = r.rotations.some((x) => x.status === 'flown' || x.sectors.some((s) => s.accrued));
    r.status = flown || r.suspended?.prev === 'operating' ? 'operating' : 'onSale';
  }
  delete r.suspended;
  delete r.closing;
  r.resumed = g.now;
  r.refileFrom = g.now + LIFE().refileDays * DAY;
  fileRotations(g, r);
  pushRouteNote(g, r, 'good', `${city(r)} back on sale`, `Flights filed again from ${fmtDay(r.refileFrom)}. Bookings take a few weeks to build up.`, null, 'silent');
  touch(g);
  return null;
}

/**
 * Winds a route down: sales stop now, the empty rotations go at no cost, every booked one flies and nobody is
 * refunded; the route closes by itself after its last flight. Nothing booked: it closes now. Null when done.
 */
export function windDownRoute(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  const life = r ? routeLife(r) : 'other';
  if (!r || (life !== 'live' && life !== 'suspended')) return 'Only a route on sale, flying or suspended can be wound down.';
  stopSelling(g, r, false, 'Route closing');
  const last = lastLive(g, r);
  if (last === undefined) {
    finishClose(g, r);
    pushRouteNote(g, r, 'info', `${city(r)} closed`, 'No one was booked, so it closed at once.', null, 'silent');
    return null;
  }
  r.closing = { at: g.now, last };
  pushRouteNote(g, r, 'info', `${city(r)} closing`, `No more sales. The booked flights fly, the last on ${fmtDay(last)}, then the route closes.`, null, 'silent');
  touch(g);
  return null;
}

/** Closes a route now: every rotation not yet flown is cancelled (refunds, passenger costs), the slots go. Null when done. */
export function closeRoute(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r || routeLife(r) === 'other') return r?.status === 'closed' ? 'This route is already closed.' : 'Not on sale yet.';
  const q = quoteRouteLife(g, routeId);
  stopSelling(g, r, true, 'Route closed');
  finishClose(g, r);
  pushRouteNote(g, r, 'info', `${city(r)} closed`, q.pax ? `${q.pax.toLocaleString('en-US')} booked passengers refunded or rebooked (${usd(q.refundCost)}).` : 'No one was booked.', null, 'silent');
  return null;
}

/** Daily: a winding-down route closes after its last flight; a suspended one closes when its slots lapse. */
export function stepRouteLife(g: GameState, r: Route): void {
  if (r.closing) {
    const last = lastLive(g, r);
    if (last === undefined) {
      finishClose(g, r);
      pushRouteNote(g, r, 'info', `${city(r)} closed`, 'Its last booked flight has flown. The route is closed.', null);
    } else r.closing.last = last;
    return;
  }
  if (r.status !== 'suspended' || !r.suspended) return;
  const L = LIFE();
  const last = lastLive(g, r);
  const until = Math.max(r.suspended.slotsUntil, (last ?? 0) + L.slotHoldDays * DAY);
  r.suspended.slotsUntil = until;
  if (g.now >= until && last === undefined) {
    finishClose(g, r);
    pushRouteNote(g, r, 'warn', `${city(r)} closed: slots lapsed`, `It was suspended since ${fmtDay(r.suspended?.at ?? g.now)}. The airport gave the slots to others, so the route is closed.`, null);
    return;
  }
  if (until - g.now <= L.slotWarnDays * DAY) {
    pushRouteNote(g, r, 'warn', `${city(r)}: slots lapse ${fmtDay(until)}`, 'Resume the route before then, or it closes and the slots go to others.', `slotWarn:${r.suspended.at}`);
  }
}

/** Closed routes whose last flights have since flown: their contracts end (daily, cheap). */
export function settleClosedContracts(g: GameState): void {
  for (const r of Object.values(g.network?.routes ?? {})) {
    if (r.status !== 'closed' || !r.closed || r.closed < g.now - 60 * DAY) continue;
    endContracts(g, r);
  }
}
