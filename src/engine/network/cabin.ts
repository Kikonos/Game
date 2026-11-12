// v0.23.1 a route's cabin, changed while it runs (report bmwdnxjlp5jo6): business and economy, or economy only.
// The quote compares the two from the game's own demand and fare model (launch.project, the business case's numbers):
// seats, passengers and load a flight, yield, revenue, costs and the result, a flight / a week / a month. Selling the
// business seats on an aircraft that has none costs a downgrade on the day (refund, voucher), so that side carries it.
// The change takes effect at once on every departure on sale that has not left: business sales close (or open), and
// passengers already booked in business are moved to economy now, told in advance, with the EU261 Art. 10 refund
// (30 / 50 / 75 % of the fare by distance) but no voucher and no dent in business bookings (it was not on the day).
// A departure another operator flies for us keeps its cabin (the rival's aircraft is unchanged).

import type { CabinLayout } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { cashOnly } from '../core/ledger';
import { typeOf } from '../core/perf';
import type { GameState, Minute } from '../core/types';
import { businessCaseX, project, type Projection } from './launch';
import { cabinFor, marketOfRoute, usd } from './model';
import { pushRouteNote } from './notes';
import { downgradeShare } from './revenue';
import { dirSectors, fareFor } from './sales';
import type { Rotation, Route, RoutePlan } from './types';

/** The two cabins a route can sell. */
export type RouteCabin = 'two-class' | 'all-economy';

/** One side of the comparison: a year's flying at the study's demand (P50), the timetable and fares as they are. */
export interface CabinSide {
  cabin: RouteCabin;
  /** Seats a flight (one sector) and of them in business. */
  seats: number;
  seatsJ: number;
  /** Passengers a flight (one sector), of them in business. */
  pax: number;
  paxJ: number;
  lf: number;
  /** Ticket revenue a passenger. */
  yieldPax: number;
  /** A year (USD): revenue, costs (with the downgrades on the day where the aircraft has no business seats), result. */
  rev: number;
  cost: number;
  result: number;
  /** Of `cost`: business passengers moved to economy on the day (refunds and vouchers). */
  downgrades: number;
  /** Flights (sectors) and rotations a year. */
  flights: number;
  rotations: number;
}

export interface CabinQuote {
  from: CabinSide;
  to: CabinSide;
  /** Departures on sale the change reaches (not yet left), and the first of them. */
  departures: number;
  first?: Minute;
  /** Business passengers already booked on them, moved to economy now (economy only), and their refunds (USD). */
  bookedJ: number;
  refund: number;
  /** The aircraft flying it has no business seats (selling business means downgrades on the day). */
  noJSeats: boolean;
  /** The type the comparison flies. */
  typeId: string;
  /** Cash once the refunds are paid (USD). */
  cashAfter: number;
  /** Seats the departures on sale get in the new cabin (their own aircraft's), fewest and most; absent with none. */
  liveSeats?: { min: number; max: number };
}

/** The cabin a route sells now: business on any departure on sale (else the timetable's). Pure. */
export function routeCabin(g: GameState, r: Route): RouteCabin {
  const live = ownLive(g, r);
  if (live.length) return live.some((rot) => rot.sectors.some((s) => s.capJ > 0)) ? 'two-class' : 'all-economy';
  return (r.series[0]?.layout ?? r.plan?.layout) === 'all-economy' ? 'all-economy' : 'two-class';
}

/** Departures on sale that have not left (no sector flown or accrued, none in the air). */
function liveRotations(g: GameState, r: Route): Rotation[] {
  return r.rotations.filter((rot) => (rot.status === 'planned' || rot.status === 'flights') && rot.dep > g.now
    && !rot.sectors.some((s) => s.accrued || (s.flightId && g.flights[s.flightId] && g.flights[s.flightId].status !== 'scheduled')));
}

/**
 * Final debug round: the departures on sale we fly ourselves. One another operator flies for us (sub-charter) keeps
 * its own cabin: its business passengers fly business, so a change neither re-seats nor refunds them.
 */
function ownLive(g: GameState, r: Route): Rotation[] {
  return liveRotations(g, r).filter((rot) => !rot.operatedBy);
}

/** The aircraft that fly it: the series' pinned tail, else the fleet's aircraft of its type. */
function flyingAircraft(g: GameState, r: Route) {
  const s = r.series[0];
  if (!s) return [];
  const tail = s.tail ? g.fleet[s.tail] : undefined;
  if (tail) return [tail];
  return Object.values(g.fleet).filter((a) => a.typeId === s.typeId && a.status !== 'leasedOut');
}

/** No aircraft that flies it has a business cabin (and at least one exists). */
function noJOnBoard(g: GameState, r: Route): boolean {
  const acs = flyingAircraft(g, r);
  return acs.length > 0 && acs.every((a) => a.cabin.j + a.cabin.w === 0);
}

/** The route's timetable and fares as a plan, with a cabin. */
function planOf(r: Route, cabin: RouteCabin): RoutePlan | null {
  const s = r.series[0];
  const p = r.plan;
  if (!s && !p) return null;
  return {
    model: r.model, days: s?.days ?? p!.days, every: s?.every ?? p!.every, monthly: s?.monthly ?? p?.monthly, out: s?.out ?? p!.out, back: s?.back ?? p!.back,
    nights: s?.nights ?? p!.nights, typeId: s?.typeId ?? p!.typeId, layout: cabin, fares: r.fares.level, marketing: r.marketing,
  };
}

function sideOf(g: GameState, r: Route, cabin: RouteCabin, pr: Projection, noJ: boolean): CabinSide {
  const typeId = planOf(r, cabin)!.typeId;
  const cab = cabinFor(typeId, cabin);
  const flights = Math.max(1, pr.sectors);
  const P = BAL.v019.pax;
  // Business sold on an aircraft without it: every business passenger is moved down on the day (refund and voucher).
  const downgrades = cabin === 'two-class' && noJ ? Math.round(pr.paxJ * (fareFor(g, r, 'J', g.now) * downgradeShare(r) + P.voucher * P.voucherCost)) : 0;
  const perSec = pr.paxSec / flights;
  const jShare = pr.pax > 0 ? pr.paxJ / pr.pax : 0;
  return {
    cabin, seats: cab.total, seatsJ: cab.j, pax: perSec, paxJ: perSec * jShare, lf: pr.seatSec > 0 ? pr.paxSec / pr.seatSec : 0,
    yieldPax: pr.pax > 0 ? pr.parts.tickets / pr.pax : 0, rev: pr.rev, cost: pr.cost + downgrades, result: pr.result - downgrades, downgrades,
    flights: pr.sectors, rotations: pr.rotations,
  };
}

/** The refund (USD) for the business passengers of a departure moved to economy now: Art. 10 once a direction. */
function refundOf(g: GameState, r: Route, rot: Rotation): { n: number; usd: number } {
  let n = 0;
  let usd = 0;
  const share = downgradeShare(r);
  const fare = fareFor(g, r, 'J', rot.dep);
  for (const dir of ['out', 'back'] as const) {
    const ids = dirSectors(r, rot, dir);
    if (!ids.length) continue;
    // The most business passengers on a sector of the direction (a through passenger is on each of them once).
    const j = Math.max(0, ...ids.map((i) => rot.sectors[i]?.bookedJ ?? 0));
    n += j;
    usd += j * fare * share;
  }
  return { n, usd: Math.round(usd) };
}

/**
 * The comparison for switching a route to `to` (pure): null when the route cannot be quoted (no timetable, a
 * partner's route: the partner sells the seats).
 */
export function cabinQuote(g: GameState, routeId: string, to: RouteCabin): CabinQuote | null {
  const r = g.network?.routes[routeId];
  if (!r || r.model === 'partner' || !marketOfRoute(r)) return null;
  const fromCabin = routeCabin(g, r);
  const pf = planOf(r, fromCabin);
  const pt = planOf(r, to);
  if (!pf || !pt || !typeOf(pf.typeId)) return null;
  const x = businessCaseX(g, r);
  const start = Math.max(g.now, r.firstFlight ?? g.now);
  const noJ = noJOnBoard(g, r);
  const from = sideOf(g, r, fromCabin, project(g, r, pf, start, x), noJ);
  const toSide = sideOf(g, r, to, project(g, r, pt, start, x), noJ);
  const live = ownLive(g, r);
  let bookedJ = 0;
  let refund = 0;
  if (to === 'all-economy') for (const rot of live) {
    const q = refundOf(g, r, rot);
    bookedJ += q.n;
    // (As setRouteCabin pays it: never more than the ticket cash the departure holds.)
    refund += Math.min(q.usd, Math.round(rot.sectors.reduce((a, x) => a + (x.sold ?? 0), 0)));
  }
  const seats = live.map((rot) => { const x = seatsFor(g, r, rot, to); return x.j + x.y; });
  return {
    from, to: toSide, departures: live.length, ...(live.length ? { first: Math.min(...live.map((x) => x.dep)) } : {}), bookedJ, refund, noJSeats: noJ, typeId: pf.typeId,
    cashAfter: Math.round(g.company.cash - refund), ...(seats.length ? { liveSeats: { min: Math.min(...seats), max: Math.max(...seats) } } : {}),
  };
}

/** Seats a departure sells in a cabin: its aircraft's own when it has one (business seats sold as economy), else the type's. */
function seatsFor(g: GameState, r: Route, rot: Rotation, to: RouteCabin): { j: number; y: number } {
  const s = r.series.find((x) => x.id === rot.seriesId) ?? r.series[0];
  const ac = rot.aircraftId ? g.fleet[rot.aircraftId] : s?.tail ? g.fleet[s.tail] : undefined;
  const typeId = ac?.typeId ?? s?.typeId ?? r.plan?.typeId ?? '';
  if (to === 'all-economy') return { j: 0, y: ac ? ac.cabin.total : cabinFor(typeId, 'all-economy').total };
  if (ac && ac.cabin.j + ac.cabin.w > 0) return { j: ac.cabin.j + ac.cabin.w, y: ac.cabin.y };
  const c = cabinFor(typeId, 'two-class');
  return { j: c.j, y: c.y };
}

/**
 * Switches a route's cabin (changes the game): the timetable's cabin, then every departure on sale that has not left
 * (seats re-filed; economy only moves the business passengers down now, with their refund). Null when done.
 */
export function setRouteCabin(g: GameState, routeId: string, to: RouteCabin): string | null {
  const r = g.network?.routes[routeId];
  if (!r) return 'This route no longer exists.';
  if (r.model === 'partner') return 'The partner sells the seats on this route.';
  // Already so (seats, bookings and the timetable): nothing to do.
  const pending = ownLive(g, r).some((rot) => rot.sectors.some((s) => (to === 'all-economy' ? s.capJ > 0 || s.bookedJ > 0 : s.capJ === 0)));
  if (!pending && r.series.every((s) => s.layout === to)) return null;
  const layout: CabinLayout = to;
  for (const s of r.series) s.layout = layout;
  if (r.plan) r.plan.layout = layout;
  let moved = 0;
  let refunded = 0;
  let deps = 0;
  for (const rot of ownLive(g, r)) {
    deps++;
    if (to === 'all-economy') {
      const q = refundOf(g, r, rot);
      if (q.n) {
        // The refund comes out of the ticket cash held for the departure (unearned), never more than it holds.
        const held = rot.sectors.reduce((a, s) => a + (s.sold ?? 0), 0);
        const back = Math.min(q.usd, Math.round(held));
        if (back > 0) {
          let left = back;
          for (const s of rot.sectors) {
            const take = Math.min(left, s.sold ?? 0);
            if (take > 0) { s.sold = (s.sold ?? 0) - take; left -= take; }
          }
          cashOnly(g, -back);
          r.unearned = Math.max(0, Math.round(r.unearned - back));
          refunded += back;
        }
        moved += q.n;
        rot.notice = g.now;
      }
      for (const s of rot.sectors) {
        s.bookedY += s.bookedJ;
        s.bookedJ = 0;
        if (s.localJ) { s.localY = (s.localY ?? 0) + s.localJ; s.localJ = 0; }
        if (s.thruJ) { s.thruY = (s.thruY ?? 0) + s.thruJ; s.thruJ = 0; }
      }
    }
    const seats = seatsFor(g, r, rot, to);
    for (const s of rot.sectors) {
      s.capJ = seats.j;
      s.capY = seats.y;
    }
  }
  if (g.network) g.network.rev = (g.network.rev ?? 0) + 1;
  const name = marketOfRoute(r)?.city ?? r.marketId;
  if (to === 'all-economy') {
    pushRouteNote(g, r, 'info', `${name}: economy only`, `${deps ? `${deps} departure${deps === 1 ? '' : 's'} on sale now sell economy seats only.` : 'New departures sell economy seats only.'}${moved ? ` ${moved} business passenger${moved === 1 ? '' : 's'} moved to economy, told in advance: ${usd(refunded)} refunded.` : ''}`, null, 'silent');
  } else {
    pushRouteNote(g, r, 'info', `${name}: business class on sale`, `${deps ? `${deps} departure${deps === 1 ? '' : 's'} on sale now sell business seats too.` : 'New departures sell business seats too.'}${noJOnBoard(g, r) ? ' The aircraft flying it has no business seats: business passengers are moved to economy on the day.' : ''}`, null, 'silent');
  }
  return null;
}

/**
 * Final debug round, at load: a route whose timetable sells economy only but whose departures on sale still sell
 * business (the timetable changed before v0.23.1 re-filed them; the player's Lisbon–Bissau) is switched for real now,
 * so the Cabin row, the route's header and the departures agree and no business passenger is downgraded on the day.
 */
export function repairRouteCabins(g: GameState): void {
  for (const r of Object.values(g.network?.routes ?? {})) {
    if (r.status === 'closed' || r.model === 'partner' || !r.series.length || !r.series.every((s) => s.layout === 'all-economy')) continue;
    if (ownLive(g, r).some((rot) => rot.sectors.some((s) => s.capJ > 0))) setRouteCabin(g, r.id, 'all-economy');
  }
}
