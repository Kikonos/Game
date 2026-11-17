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

/**
 * A wind-down plan: the booked rotations up to a last date fly (`fly`), the later ones are cancelled and refunded
 * (`later`: far off, few booked, refunded with weeks of notice and no compensation).
 */
export interface WindQuote {
  fly: number;
  flyPax: number;
  /** Direct cost of flying them (fuel, charges, handling, catering, maintenance). */
  flyCost: number;
  /** What they earn besides the tickets already sold (bags, seats, onboard, cargo). */
  flyRev: number;
  /** The overheads until the last flight (station, distribution) while they fly. */
  flyOverhead: number;
  later: number;
  laterPax: number;
  /** Refunding the later ones (their tickets and passenger costs). */
  laterCost: number;
  /** Arrival of the last flight flown (or under way). */
  lastFlight?: Minute;
  /** Against close now (positive: this plan costs less). */
  saved: number;
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
  /** Cancel every booked rotation now: ticket money back, passenger costs (notice, re-protection), a sub-charter's price back. */
  refunds: number;
  comp: number;
  subBack: number;
  /** refunds + comp − subBack: what refunding everyone costs (Close now). */
  refundCost: number;
  /** Wind down, cheapest: the next 14 days always fly (short notice is dear), then up to the last date that costs least. */
  best: WindQuote;
  /** Wind down flying every booked rotation. */
  all: WindQuote;
  /** Monthly overheads: as now, suspended, while winding down. */
  monthNow: number;
  monthSuspended: number;
  monthClosing: number;
  /** On sale and flying again (resume). */
  monthLive: number;
  /** A suspension: the date the slots lapse when the booked flights fly (cheapest plan), and when they are refunded. */
  slotsKeep: Minute;
  slotsRefund: Minute;
  /** Resume: the first departure filed again. */
  resumeFirst?: Minute;
}

interface PlanRow { rot: Rotation; pax: number; refund: number; comp: number; subBack: number; fly: number; rev: number; end: Minute }

/** What flying a rotation earns besides its tickets: bags, seats and onboard sales, and the cargo it usually carries. */
function extraRev(route: Route, rot: Rotation, pax: number): number {
  if (rot.operatedBy || route.model === 'partner') return 0;
  const m = marketOfRoute(route);
  return Math.round(pax * (m?.ancillary ?? 20) + (m?.cargo.south ?? 0) * 2 + (m?.cargo.north ?? 0) * 1.4);
}

/** The booked rotations not yet started, in date order, with what refunding and flying each one means (pure). */
function planRows(g: GameState, r: Route): PlanRow[] {
  const rows: PlanRow[] = [];
  for (const rot of r.rotations) {
    if (!ahead(rot) || started(g, rot) || !hasPax(rot)) continue;
    const c = quoteCancelRotation(g, rot.id);
    const pax = rotationPax(r, rot);
    rows.push({ rot, pax, refund: c.ok ? c.refunds : 0, comp: c.ok ? c.cost : 0, subBack: c.ok ? c.subBack ?? 0 : 0, fly: rotationFlyCost(g, r, rot), rev: extraRev(r, rot, pax), end: lastArr(g, r, rot) });
  }
  return rows.sort((a, b) => a.rot.dep - b.rot.dep);
}

/**
 * How many of the rows fly (pure). `all`: every one. Else the next 14 days always fly (passengers told at short notice
 * are owed care and rebooking, and it is how airlines close a route), then up to the last date that saves the most
 * against refunding: each one flown keeps its tickets and earns its extras, but costs its flying and the overheads
 * until it lands.
 */
function planCut(g: GameState, rows: PlanRow[], underWayEnd: Minute, monthClosing: number, all: boolean): number {
  if (all) return rows.length;
  const notice = g.now + BAL.v019.pax.change.days[0] * DAY;
  const must = rows.filter((x) => x.rot.dep < notice).length;
  const perMin = monthClosing / (30 * DAY);
  let best = -Infinity;
  let bestN = must;
  let sum = 0;
  let prevEnd = underWayEnd;
  rows.forEach((x, i) => {
    sum += x.refund + x.comp - x.subBack + x.rev - x.fly - Math.max(0, x.end - prevEnd) * perMin;
    prevEnd = Math.max(prevEnd, x.end);
    if (i + 1 >= must && sum > best) { best = sum; bestN = i + 1; }
  });
  return rows.length ? bestN : 0;
}

function windQuote(g: GameState, rows: PlanRow[], cut: number, underWayEnd: Minute, underWay: number, monthClosing: number, refundCost: number): WindQuote {
  const w: WindQuote = { fly: 0, flyPax: 0, flyCost: 0, flyRev: 0, flyOverhead: 0, later: 0, laterPax: 0, laterCost: 0, saved: 0 };
  rows.forEach((x, i) => {
    if (i < cut) {
      w.fly++;
      w.flyPax += x.pax;
      w.flyCost += x.fly;
      w.flyRev += x.rev;
      w.lastFlight = Math.max(w.lastFlight ?? 0, x.end);
    } else {
      w.later++;
      w.laterPax += x.pax;
      w.laterCost += x.refund + x.comp - x.subBack;
    }
  });
  if (underWay) w.lastFlight = Math.max(w.lastFlight ?? 0, underWayEnd);
  w.flyOverhead = Math.round((w.lastFlight ? Math.max(0, w.lastFlight - g.now) / (30 * DAY) : 0) * monthClosing);
  w.saved = Math.round(refundCost - (w.flyCost - w.flyRev) - w.flyOverhead - w.laterCost);
  return w;
}

const underWayEndOf = (g: GameState, r: Route) => r.rotations.filter((x) => ahead(x) && started(g, x)).reduce((a, x) => Math.max(a, lastArr(g, r, x)), g.now);
const closingMonth = (r: Route) => overheadIn(r, r.status === 'suspended' ? 'suspended' : r.status, true);

/** Every number the four actions need (pure). */
export function quoteRouteLife(g: GameState, routeId: string): RouteLifeQuote {
  const r = g.network?.routes[routeId];
  const w0: WindQuote = { fly: 0, flyPax: 0, flyCost: 0, flyRev: 0, flyOverhead: 0, later: 0, laterPax: 0, laterCost: 0, saved: 0 };
  const z: RouteLifeQuote = {
    ok: false, ahead: 0, booked: 0, empty: 0, underWay: 0, pax: 0, refunds: 0, comp: 0, subBack: 0, refundCost: 0, best: w0, all: w0,
    monthNow: 0, monthSuspended: 0, monthClosing: 0, monthLive: 0, slotsKeep: g.now, slotsRefund: g.now,
  };
  if (!r) return { ...z, why: 'This route no longer exists.' };
  if (routeLife(r) === 'other') return { ...z, why: r.status === 'closed' ? 'This route is closed.' : 'Not on sale yet.' };
  const q = { ...z, ok: true };
  for (const rot of r.rotations) {
    if (!ahead(rot)) continue;
    if (started(g, rot)) { q.underWay++; continue; }
    q.ahead++;
    if (!hasPax(rot)) q.empty++;
  }
  q.monthNow = overheadIn(r, r.status, !!r.closing);
  q.monthSuspended = overheadIn(r, 'suspended');
  q.monthLive = overheadIn(r, r.status === 'suspended' ? r.suspended?.prev ?? 'operating' : r.status);
  q.monthClosing = closingMonth(r);
  const rows = planRows(g, r);
  const end = underWayEndOf(g, r);
  for (const x of rows) {
    q.booked++;
    q.pax += x.pax;
    q.refunds += x.refund;
    q.comp += x.comp;
    q.subBack += x.subBack;
  }
  q.refundCost = q.refunds + q.comp - q.subBack;
  q.best = windQuote(g, rows, planCut(g, rows, end, q.monthClosing, false), end, q.underWay, q.monthClosing, q.refundCost);
  q.all = windQuote(g, rows, rows.length, end, q.underWay, q.monthClosing, q.refundCost);
  const hold = LIFE().slotHoldDays * DAY;
  q.slotsKeep = Math.max(g.now, q.best.lastFlight ?? g.now) + hold;
  q.slotsRefund = end + hold;
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

/**
 * Stops sales: the empty rotations go; the booked ones are all refunded ('refund'), or fly up to the cheapest last
 * date ('best', the later ones refunded), or all fly ('all').
 */
function stopSelling(g: GameState, r: Route, mode: 'refund' | 'best' | 'all', why: string): void {
  const rows = mode === 'refund' ? [] : planRows(g, r);
  const cut = mode === 'refund' ? 0 : planCut(g, rows, underWayEndOf(g, r), closingMonth(r), mode === 'all');
  const keep = new Set(rows.slice(0, cut).map((x) => x.rot.id));
  for (const rot of [...r.rotations]) {
    if (!ahead(rot) || started(g, rot)) continue;
    if (!hasPax(rot)) dropEmpty(g, r, rot);
    else if (!keep.has(rot.id)) cancelRotation(g, rot.id, why);
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
  stopSelling(g, r, refund ? 'refund' : 'best', 'Route suspended');
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
export function windDownRoute(g: GameState, routeId: string, all = false): string | null {
  const r = g.network?.routes[routeId];
  const life = r ? routeLife(r) : 'other';
  if (!r || (life !== 'live' && life !== 'suspended')) return 'Only a route on sale, flying or suspended can be wound down.';
  stopSelling(g, r, all ? 'all' : 'best', 'Route closing');
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
  stopSelling(g, r, 'refund', 'Route closed');
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
