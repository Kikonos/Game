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
import { baseFare, chainOf, departureDemand, freqPerWeek, localMinute, localWeekday, marketOfRoute, monthOf, serviceHours, slotX, type Dir } from './model';
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

/**
 * Expected final passengers of a rotation's direction (J who want business, Y), before seats cap them: the market,
 * our share and the route's state (fares, awareness, reputation, ramp, truth, the departure's weekday and time).
 */
export function expectedPax(g: GameState, route: Route, rot: Rotation, dir: Dir): { j: number; y: number } {
  const m = marketOfRoute(route);
  const s = seriesOf(route, rot);
  if (!m || !s) return { j: 0, y: 0 };
  const idx = dirSectors(route, rot, dir);
  const first = rot.sectors[idx[0]];
  const f = first?.flightId ? g.flights[first.flightId] : undefined;
  const dep = f?.std ?? rot.dep;
  const ap = first?.from ?? m.from;
  const freq = route.series.filter((x) => x.from <= dep && x.to >= dep).reduce((a, x) => a + freqPerWeek(x), 0) || freqPerWeek(s);
  const dents = dentsAt(route, dep);
  const sale = route.fares.saleUntil && route.fares.saleUntil > g.now ? BAL.v019.sales.sale.burst : 1;
  const d = departureDemand(g, m, dep, dir, {
    freqPerWeek: freq, fares: route.fares.level, awareness: route.awareness, reputation: route.reputation, hours: serviceHours(m, s.typeId, dir),
    rivalCut: route.rivalCut && route.rivalCut.until > dep ? route.rivalCut.x : 0,
    truth: route.study?.truth ?? 1, slotX: slotX(localWeekday(ap, dep), localMinute(ap, dep)), rampX: rampOf(route, dep) * dents.all * sale, jDent: dents.j,
  });
  // An all-economy cabin: most who want business go to a rival; some fly economy with us.
  if (!first?.capJ) return { j: 0, y: d.y + d.j * BAL.v019.demand.jToY };
  return d;
}

/** A booking's fare (one way, net) in a class and bucket. */
export function fareOf(route: Route, rot: Rotation, dir: Dir, cls: 'J' | 'Y', bucket: Bucket, sale = false): number {
  const m = marketOfRoute(route);
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
