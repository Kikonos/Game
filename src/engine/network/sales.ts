// v0.19 daily sales and simple revenue management (UPDATE-0.19.md §E, §F.2, §N.2). Every rotation on sale books along
// the booking curve towards the passengers its departure can expect (model.departureDemand × the route's own truth,
// ramp and dents). The cheapest open economy bucket sells; Saver closes when the flight runs ahead of the curve and
// reopens near the day when it lags. Ticket cash arrives at sale (cashOnly) and is held as unearned until the sector
// flies. A partner sells its own seats: we only track the loads.

import { BAL } from '../core/balance';
import { cashOnly, post } from '../core/ledger';
import { blockMinutes, maxSectorNm, runwayFit, takeoffRunwayM, typeOf } from '../core/perf';
import { distanceNm } from '../core/geo';
import { DAY, fmtDay } from '../core/time';
import type { GameState, Minute } from '../core/types';
import type { RouteMarket } from '../../data/routes';
import { baseFare, chainOf, departureDemand, freqPerWeek, localMinute, localWeekday, marketOfRoute, monthOf, serviceHours, slotX, type DemandInput, type Dir } from './model';
import { bcCapOf, fifthOf, gateBC, legMarkets, NO_PAX, shareSeats, type Pax } from './stopover';
import { pushRouteNote } from './notes';
import { netRoll } from './side';
import type { Rotation, Route, RouteSeries, SectorLoad } from './types';

export type Bucket = 'saver' | 'classic' | 'flex';

/** §E.4 the cheapest open economy bucket of a rotation. */
export function openBucket(_route: Route, rot: Rotation): Bucket {
  return rot.buckets?.saver === false ? (rot.buckets.classic === false ? 'flex' : 'classic') : 'saver';
}

/** §E.4 cumulative share of final bookings made by `d` days before departure (holiday peaks earlier). Pure. */
export function curveAt(d: number, peak = false, front = 1): number {
  const S = BAL.v019.sales;
  const e = S.edges;
  if (d >= e[0]) return 0;
  if (d <= 0) return 1;
  let cum = 0;
  for (let i = 0; i < S.curve.length; i++) {
    const hi = e[i];
    const lo = e[i + 1];
    if (d <= lo) {
      cum += S.curve[i];
      continue;
    }
    cum += (S.curve[i] * (hi - d)) / (hi - lo);
    break;
  }
  const f = Math.max(0, Math.min(1, cum));
  const shifted = peak ? Math.min(1, f + S.peakShift * (1 - f) * f * 4) : f;
  return front === 1 ? shifted : Math.pow(shifted, front);
}

/** Holiday months book earlier (Dec, Jul, Aug). */
const isPeak = (month: number) => month === 11 || month === 6 || month === 7;

/** §F.2 the payload (kg) a type can lift on a sector, after range and runway. Pure. */
export function payloadMax(typeId: string, from: string, to: string): number {
  const C = BAL.v019.cargo;
  const t = typeOf(typeId);
  if (!t) return 0;
  const structural = C.payloadType[typeId] ?? (t.body === 'wide' ? C.payload.wide : C.payload.narrow);
  const nm = distanceNm(from, to);
  const max = Math.max(1, maxSectorNm(typeId, from, to));
  // Near the range limit payload is traded for fuel: full payload to 80 % of the range, `rangeKeep` at the limit.
  const r = nm / max;
  const rangeX = r <= 0.8 ? 1 : Math.max(C.rangeKeep, 1 - ((r - 0.8) / 0.2) * (1 - C.rangeKeep));
  const runX = runwayFit(typeId, from) === 'limited' ? Math.pow(Math.min(1, takeoffRunwayM(from) / t.minRunwayM), C.runwayExp) : 1;
  return Math.round(structural * rangeX * runX);
}

/** The sectors of a rotation in a direction (indices). */
export function dirSectors(route: Route, rot: Rotation, dir: Dir): number[] {
  const m = marketOfRoute(route);
  if (!m) return [];
  const n = chainOf(m, 'out').length - 1;
  return rot.sectors.map((_, i) => i).filter((i) => (dir === 'out' ? i < n : i >= n));
}

/** The series of a rotation. */
export const seriesOf = (route: Route, rot: Rotation): RouteSeries | undefined => route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];

/** Passenger seats a direction can really sell: the cabin, capped by the tightest sector's payload (bags in). */
export function dirCap(route: Route, rot: Rotation, dir: Dir, typeId: string): { j: number; y: number } {
  const idx = dirSectors(route, rot, dir);
  if (!idx.length) return { j: 0, y: 0 };
  const s0 = rot.sectors[idx[0]];
  let paxMax = Infinity;
  for (const i of idx) {
    const s = rot.sectors[i];
    paxMax = Math.min(paxMax, Math.floor(payloadMax(typeId, s.from, s.to) * 0.92 / BAL.v019.cargo.paxKg));
  }
  const j = Math.min(s0.capJ, paxMax);
  return { j, y: Math.max(0, Math.min(s0.capY, paxMax - j)) };
}

/** The launch ramp (§E.5): 0.7 → 1 over the first 8 weeks of flying, × 0.85 more when sales opened late. */
export function rampOf(route: Route, dep: Minute): number {
  const R = BAL.v019.demand.ramp;
  const first = route.firstFlight ?? dep;
  const weeks = (dep - first) / (7 * DAY);
  let x = weeks >= R.weeks ? 1 : R.from + (1 - R.from) * Math.max(0, weeks) / R.weeks;
  const opened = route.stages.find((s) => s.id === 'filing')?.due;
  if (opened !== undefined && first - opened < BAL.v019.launch.filing.shortDays * DAY && weeks < R.weeks) x *= R.late;
  return x;
}

/** The demand dents in force at a time (J only, all). */
function dentsAt(route: Route, t: Minute): { j: number; all: number } {
  let j = 1;
  let all = 1;
  for (const d of route.dents ?? []) {
    if (d.until <= t) continue;
    if (d.cls === 'J') j *= d.x;
    else all *= d.x;
  }
  return { j, all };
}

/** The demand inputs of a rotation's direction (the route's state at the departure), or null. */
function demandCtx(g: GameState, route: Route, rot: Rotation, dir: Dir): { m: RouteMarket; s: RouteSeries; dep: Minute; first: SectorLoad | undefined; x: DemandInput } | null {
  const m = marketOfRoute(route);
  const s = seriesOf(route, rot);
  if (!m || !s) return null;
  const idx = dirSectors(route, rot, dir);
  const first = rot.sectors[idx[0]];
  const f = first?.flightId ? g.flights[first.flightId] : undefined;
  const dep = f?.std ?? rot.dep;
  const ap = first?.from ?? m.from;
  const freq = route.series.filter((x) => x.from <= dep && x.to >= dep).reduce((a, x) => a + freqPerWeek(x), 0) || freqPerWeek(s);
  const dents = dentsAt(route, dep);
  const sale = route.fares.saleUntil && route.fares.saleUntil > g.now ? BAL.v019.sales.sale.burst : 1;
  const x: DemandInput = {
    freqPerWeek: freq, fares: route.fares.level, awareness: route.awareness, reputation: route.reputation, hours: serviceHours(m, s.typeId, dir),
    rivalCut: route.rivalCut && route.rivalCut.until > dep ? route.rivalCut.x : 0, ...(m.stopover ? { stop: true } : {}),
    truth: route.study?.truth ?? 1, slotX: slotX(localWeekday(ap, dep), localMinute(ap, dep)), rampX: rampOf(route, dep) * dents.all * sale, jDent: dents.j,
  };
  return { m, s, dep, first, x };
}

/**
 * Expected final passengers of a rotation's direction (J who want business, Y), before seats cap them: the market,
 * our share and the route's state (fares, awareness, reputation, ramp, truth, the departure's weekday and time).
 * On a stopover route: the through (A–C) travellers.
 */
export function expectedPax(g: GameState, route: Route, rot: Rotation, dir: Dir): { j: number; y: number } {
  const c = demandCtx(g, route, rot, dir);
  if (!c) return { j: 0, y: 0 };
  const d = departureDemand(g, c.m, c.dep, dir, c.x);
  // An all-economy cabin: most who want business go to a rival; some fly economy with us.
  if (!c.first?.capJ) return { j: 0, y: d.y + d.j * BAL.v019.demand.jToY };
  return d;
}

/**
 * v0.21 a stopover route: the local travellers a direction's two sectors can expect (the first leg's and the second's,
 * each its own market, nonstop on its leg). B–C locals only with fifth-freedom rights (none before the rights stage).
 */
export function expectedLocal(g: GameState, route: Route, rot: Rotation, dir: Dir): { s1: Pax; s2: Pax } {
  const c = demandCtx(g, route, rot, dir);
  const legs = c ? legMarkets(c.m, dir) : null;
  if (!c || !legs) return { s1: NO_PAX, s2: NO_PAX };
  const ch = chainOf(c.m, dir);
  const h = (a: string, b: string) => blockMinutes(c.s.typeId, a, b) / 60;
  const fifth = fifthOf(route);
  const one = (leg: RouteMarket, a: string, b: string, bc: boolean): Pax => {
    const d = departureDemand(g, leg, c.dep, dir, { ...c.x, stop: false, rivalCut: 0, hours: h(a, b) });
    return bc ? gateBC(fifth, d) : d;
  };
  return { s1: one(legs.first, ch[0], ch[1], !legs.bcSecond), s2: one(legs.second, ch[1], ch[2], legs.bcSecond) };
}

/** A booking's fare (one way, net) in a class and bucket (v0.21 `leg`: a stopover's local market instead of the route's). */
export function fareOf(route: Route, rot: Rotation, dir: Dir, cls: 'J' | 'Y', bucket: Bucket, sale = false, leg?: RouteMarket): number {
  const m = leg ?? marketOfRoute(route);
  if (!m) return 0;
  const base = baseFare(m, cls, monthOf(rot.dep), dir, route.fares.level);
  if (cls === 'J') return base;
  const B = BAL.v019.sales.buckets;
  let x = bucket === 'saver' ? B.saver * (sale ? 1 - BAL.v019.sales.sale.cut : 1) : bucket === 'classic' ? B.classic : B.flex;
  if (route.model === 'tour') x *= 1 - BAL.v019.sales.anchors.share * BAL.v019.sales.anchors.fareCut;
  return Math.round(base * x);
}

/** One-way base fare now for a class (EU261 refunds, re-protection). Pure. */
export function fareFor(_g: GameState, route: Route, cls: 'J' | 'Y', t: Minute): number {
  const m = marketOfRoute(route);
  return m ? baseFare(m, cls, monthOf(t), 'out', route.fares.level) : 0;
}

/** A rotation's own booking pace noise (fixed per rotation and direction: some sell better than others). */
const noiseOf = (g: GameState, rot: Rotation, dir: Dir) => 0.82 + 0.36 * netRoll(g, `sale:${rot.id}:${dir}`);

/**
 * Daily: bookings for every rotation on sale; ticket cash in, held as unearned. Buckets close when a flight runs
 * ahead of the curve and Saver reopens inside 21 days when it lags; a weak pace 21 days out is told once.
 */
export function dailySales(g: GameState, route: Route): void {
  if (route.status !== 'onSale' && route.status !== 'operating') return;
  const S = BAL.v019.sales;
  const own = route.model !== 'partner';
  for (const rot of route.rotations) {
    if ((rot.status !== 'planned' && rot.status !== 'flights') || rot.operatedBy === 'x') continue;
    const d = (rot.dep - g.now) / DAY;
    if (d <= 0 || d > S.edges[0]) continue;
    const s = seriesOf(route, rot);
    if (!s) continue;
    const acType = rot.aircraftId ? g.fleet[rot.aircraftId]?.typeId ?? s.typeId : s.typeId;
    const month = monthOf(rot.dep);
    const front = route.model === 'tour' ? 0.65 : 1;
    const F = curveAt(d, isPeak(month), front);
    const sale = !!route.fares.saleUntil && route.fares.saleUntil > g.now;
    for (const dir of ['out', 'back'] as Dir[]) {
      const idx = dirSectors(route, rot, dir);
      if (!idx.length) continue;
      // v0.21 a stopover direction: three markets share the two sectors' seats.
      if (idx.length === 2 && marketOfRoute(route)?.stopover) {
        stopoverSales(g, route, rot, dir, idx, acType, F, sale, own);
        continue;
      }
      const e = expectedPax(g, route, rot, dir);
      const nf = noiseOf(g, rot, dir);
      const cap = dirCap(route, rot, dir, acType);
      const ob = route.fares.overbook ? 1 + S.overbook : 1;
      const head = rot.sectors[idx[0]];
      const wantJ = Math.round(e.j * nf * F);
      const spillJ = Math.max(0, wantJ - cap.j);
      const tj = Math.min(cap.j, wantJ);
      const ty = Math.min(Math.floor(cap.y * ob), Math.round((e.y * nf + spillJ * BAL.v019.demand.jToY) * F));
      const nj = Math.max(0, tj - head.bookedJ);
      const ny = Math.max(0, ty - head.bookedY);
      if (!nj && !ny) continue;
      // Buckets: ahead of the curve closes Saver (then Classic); behind inside 21 days reopens Saver.
      const lf = (head.bookedJ + head.bookedY) / Math.max(1, cap.j + cap.y);
      const exp = ((e.j + e.y) * F) / Math.max(1, cap.j + cap.y);
      const b = (rot.buckets ??= { saver: true, classic: true });
      if (lf > exp + S.classicAhead) { b.saver = false; b.classic = false; }
      else if (lf > exp + S.saverAhead) b.saver = false;
      if (d < S.reopenDays && lf < exp) { b.saver = true; b.classic = true; }
      if (sale) b.saver = true;
      const bucket = openBucket(route, rot);
      const cash = own ? nj * fareOf(route, rot, dir, 'J', bucket) + ny * fareOf(route, rot, dir, 'Y', bucket, sale) : 0;
      // Through passengers sit on every sector of the direction; the ticket money is shared by block time.
      const blocks = idx.map((i) => rot.sectors[i]).map((x) => Math.max(1, sectorBlock(acType, x)));
      const tot = blocks.reduce((a, x) => a + x, 0);
      idx.forEach((i, k) => {
        const x = rot.sectors[i];
        x.bookedJ += nj;
        x.bookedY += ny;
        if (cash) x.sold = Math.round((x.sold ?? 0) + (cash * blocks[k]) / tot);
      });
      if (cash) {
        // Direct sales (website, cards) pay at once; agents' sales come through BSP twice a month (UPDATE-0.19 add. 3 c).
        const bsp = Math.round(cash * BAL.v019.sales.bspShare);
        cashOnly(g, Math.round(cash) - bsp);
        g.network!.bspDue = (g.network!.bspDue ?? 0) + bsp;
        route.unearned = Math.round(route.unearned + cash);
      }
    }
    // §E.4 a weak pace three weeks out: run a sale?
    if (own && d <= S.weakDays && d > S.weakDays - 1) {
      const head = rot.sectors[0];
      const cap = head.capJ + head.capY;
      const e = expectedPax(g, route, rot, 'out');
      const usual = ((e.j + e.y) / Math.max(1, cap)) * curveAt(S.weakDays, isPeak(month), front);
      const now = (head.bookedJ + head.bookedY) / Math.max(1, cap);
      if (now < usual * S.weakPace && usual > 0.2) {
        pushRouteNote(g, route, 'warn', `${route.marketId.replace('-', '–')} ${fmtDay(rot.dep)}: slow bookings`, `${Math.round(now * 100)} % booked, usually ${Math.round(usual * 100)} % by now. A sale (Saver −25 % for 10 days) can fill it.`, `pace:${rot.id}`);
      }
    }
  }
}

const sectorBlock = (typeId: string, s: SectorLoad) => blockMinutes(typeId, s.from, s.to);

/** v0.21 the seats one sector can really sell: its cabin, capped by its own payload (bags in). */
export function sectorCap(s: SectorLoad, typeId: string): Pax {
  const paxMax = Math.floor(payloadMax(typeId, s.from, s.to) * 0.92 / BAL.v019.cargo.paxKg);
  const j = Math.min(s.capJ, paxMax);
  return { j, y: Math.max(0, Math.min(s.capY, paxMax - j)) };
}

/**
 * v0.21 a stopover direction's daily bookings: through (A–C), first-leg and second-leg locals each book along the
 * curve towards what they can expect, sharing the seats (stopover.shareSeats). Through ticket money is shared by block
 * time over both sectors; a local's money belongs to its own sector.
 */
function stopoverSales(g: GameState, route: Route, rot: Rotation, dir: Dir, idx: number[], acType: string, F: number, sale: boolean, own: boolean): void {
  const S = BAL.v019.sales;
  const m = marketOfRoute(route)!;
  const legs = legMarkets(m, dir)!;
  const s1 = rot.sectors[idx[0]];
  const s2 = rot.sectors[idx[1]];
  const nf = noiseOf(g, rot, dir);
  const e = expectedPax(g, route, rot, dir);
  const loc = expectedLocal(g, route, rot, dir);
  const ob = route.fares.overbook ? 1 + S.overbook : 1;
  const k1 = sectorCap(s1, acType);
  const k2 = sectorCap(s2, acType);
  const c1 = { j: k1.j, y: Math.floor(k1.y * ob) };
  const c2 = { j: k2.j, y: Math.floor(k2.y * ob) };
  const at = (p: Pax): Pax => ({ j: p.j * nf * F, y: p.y * nf * F });
  const bcSeats = legs.bcSecond ? k2.j + k2.y : k1.j + k1.y;
  const a = shareSeats(at(e), at(loc.s1), at(loc.s2), c1, c2, legs.bcSecond, fifthOf(route) === 'limited' ? bcCapOf('limited', bcSeats) * F : Infinity);
  const l1 = { j: s1.localJ ?? 0, y: s1.localY ?? 0 };
  const l2 = { j: s2.localJ ?? 0, y: s2.localY ?? 0 };
  const th = { j: Math.max(0, s1.bookedJ - l1.j), y: Math.max(0, s1.bookedY - l1.y) };
  const more = (target: number, have: number) => Math.max(0, Math.round(target) - have);
  const nT = { j: more(a.thr.j, th.j), y: more(a.thr.y, th.y) };
  const n1 = { j: more(a.l1.j, l1.j), y: more(a.l1.y, l1.y) };
  const n2 = { j: more(a.l2.j, l2.j), y: more(a.l2.y, l2.y) };
  // Rounding never sells past a sector's seats.
  const trim = (n: Pax, s: SectorLoad, c: Pax, alsoT: Pax) => {
    n.j = Math.max(0, Math.min(n.j, c.j - s.bookedJ - alsoT.j));
    n.y = Math.max(0, Math.min(n.y, c.y - s.bookedY - alsoT.y));
  };
  nT.j = Math.max(0, Math.min(nT.j, c1.j - s1.bookedJ, c2.j - s2.bookedJ));
  nT.y = Math.max(0, Math.min(nT.y, c1.y - s1.bookedY, c2.y - s2.bookedY));
  trim(n1, s1, c1, nT);
  trim(n2, s2, c2, nT);
  const total = nT.j + nT.y + n1.j + n1.y + n2.j + n2.y;
  if (!total) return;
  // Buckets on the fuller sector against the curve.
  const lf = Math.max((s1.bookedJ + s1.bookedY) / Math.max(1, k1.j + k1.y), (s2.bookedJ + s2.bookedY) / Math.max(1, k2.j + k2.y));
  const expd = Math.max((a.thr.j + a.thr.y + a.l1.j + a.l1.y) / Math.max(1, k1.j + k1.y), (a.thr.j + a.thr.y + a.l2.j + a.l2.y) / Math.max(1, k2.j + k2.y));
  const d = (rot.dep - g.now) / DAY;
  const b = (rot.buckets ??= { saver: true, classic: true });
  if (lf > expd + S.classicAhead) { b.saver = false; b.classic = false; }
  else if (lf > expd + S.saverAhead) b.saver = false;
  if (d < S.reopenDays && lf < expd) { b.saver = true; b.classic = true; }
  if (sale) b.saver = true;
  const bucket = openBucket(route, rot);
  const cashOf = (n: Pax, leg?: RouteMarket) => (own ? n.j * fareOf(route, rot, dir, 'J', bucket, false, leg) + n.y * fareOf(route, rot, dir, 'Y', bucket, sale, leg) : 0);
  const cT = cashOf(nT);
  const c1$ = cashOf(n1, legs.first);
  const c2$ = cashOf(n2, legs.second);
  const b1 = Math.max(1, sectorBlock(acType, s1));
  const b2 = Math.max(1, sectorBlock(acType, s2));
  s1.bookedJ += nT.j + n1.j;
  s1.bookedY += nT.y + n1.y;
  s2.bookedJ += nT.j + n2.j;
  s2.bookedY += nT.y + n2.y;
  if (n1.j || n1.y) { s1.localJ = l1.j + n1.j; s1.localY = l1.y + n1.y; }
  if (n2.j || n2.y) { s2.localJ = l2.j + n2.j; s2.localY = l2.y + n2.y; }
  const cash = cT + c1$ + c2$;
  if (cash) {
    s1.sold = Math.round((s1.sold ?? 0) + (cT * b1) / (b1 + b2) + c1$);
    s2.sold = Math.round((s2.sold ?? 0) + (cT * b2) / (b1 + b2) + c2$);
    const bsp = Math.round(cash * BAL.v019.sales.bspShare);
    cashOnly(g, Math.round(cash) - bsp);
    g.network!.bspDue = (g.network!.bspDue ?? 0) + bsp;
    route.unearned = Math.round(route.unearned + cash);
  }
}

/** §E.4 a sale: −25 % Saver for 10 days, $5k, at most once a month. Null when started, else why not. */
export function saleBlock(g: GameState, routeId: string): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (r.model === 'partner') return 'The partner sets the fares.';
  if (r.status !== 'onSale' && r.status !== 'operating') return 'Not on sale yet.';
  const S = BAL.v019.sales.sale;
  if (r.fares.saleUntil && g.now < r.fares.saleUntil - S.days * DAY + S.everyDays * DAY) return `Next sale from ${fmtDay(r.fares.saleUntil - S.days * DAY + S.everyDays * DAY)}.`;
  return null;
}

export function runSale(g: GameState, routeId: string): string | null {
  const why = saleBlock(g, routeId);
  if (why) return why;
  const r = g.network!.routes[routeId];
  const S = BAL.v019.sales.sale;
  r.fares.saleUntil = g.now + S.days * DAY;
  post(g, 'marketing', -S.cost);
  return null;
}

export function setFareLevel(g: GameState, routeId: string, level: Route['fares']['level']): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  r.fares.level = level;
  return null;
}
export function setOverbook(g: GameState, routeId: string, on: boolean): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (on) r.fares.overbook = true;
  else delete r.fares.overbook;
  return null;
}
export function setMarketing(g: GameState, routeId: string, level: Route['marketing']): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  r.marketing = level;
  return null;
}
export function setTanker(g: GameState, routeId: string, on: boolean): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (on) r.tanker = true;
  else delete r.tanker;
  return null;
}
