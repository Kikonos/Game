// v0.19 timetable and route flights (UPDATE-0.19.md §D, §H.5). A series makes dated rotations (out and back, every
// sector); rotations become real flights on a picked aircraft BAL.v019.ops.materialiseDays before departure, under the
// route's contract (archetype 'scheduled', a charter at price 0: trip moves, sub-charters, crew, positioning and the
// flight sheet work unchanged). The player moves or cancels single rotations or whole series at a small cost.

import { BAL } from '../core/balance';
import { inCurfew } from '../core/curfew';
import { addFlight, liveFlightsOf, nextId, removeFlights, retimeFlight, touchFlights } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { maxSectorNm, typeOf } from '../core/perf';
import { distanceNm } from '../core/geo';
import { schedule } from '../core/queue';
import { DAY, fmtDay, fmtTime } from '../core/time';
import type { Contract, Flight, GameState, Minute } from '../core/types';
import { relinkPositioning } from '../contracts/schedule';
import { anchorsOf } from '../contracts/plan';
import { autoRoster } from '../crew/roster';
import { noteRouteSub } from './costs';
import { cabinFor, localToUtc, localWeekday, marketOfRoute, rotationTimes, seasonCode, usd } from './model';
import { bumpRoute } from './reputation';
import { pushRouteNote } from './notes';
import type { Rotation, Route, RouteSeries, SectorLoad } from './types';

const HORIZON = () => BAL.v019.ops.horizonDays * DAY;

/** Dates (UTC of the first departure) a series makes between its dates, at its local departure time at the origin. */
export function seriesDates(g: GameState, route: Route, s: RouteSeries): Minute[] {
  const m = marketOfRoute(route);
  if (!m) return [];
  const out: Minute[] = [];
  const from = Math.max(s.from, g.started);
  const to = s.to;
  // Walk local days at the origin.
  for (let day = Math.floor(from / DAY) * DAY - DAY; day <= to + DAY; day += DAY) {
    const dep = localToUtc(m.from, day + 12 * 60, s.out);
    if (dep < from || dep > to) continue;
    const wd = localWeekday(m.from, dep);
    if (s.monthly) {
      if (wd !== s.monthly.weekday) continue;
      const d = new Date(Date.UTC(2000, 0, 1) + (dep + 0) * 60_000);
      const dom = d.getUTCDate();
      const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      const nth = Math.ceil(dom / 7);
      if (s.monthly.nth === -1 ? dom + 7 <= dim : nth !== s.monthly.nth) continue;
    } else {
      if (!(s.days & (1 << wd))) continue;
      if (s.every > 1) {
        const weeks = Math.floor((Math.floor(dep / DAY) - Math.floor(s.from / DAY)) / 7);
        if (weeks % s.every) continue;
      }
    }
    if (!out.includes(dep)) out.push(dep);
  }
  return out;
}

/** A fresh rotation of a series at a departure (sectors with the series' seats, nothing booked). */
export function newRotation(g: GameState, route: Route, s: RouteSeries, dep: Minute): Rotation | null {
  const m = marketOfRoute(route);
  if (!m) return null;
  const times = rotationTimes(m, s, dep);
  const ac = s.tail ? g.fleet[s.tail] : undefined;
  const cab = ac && ac.typeId === s.typeId ? { j: ac.cabin.j + ac.cabin.w, y: ac.cabin.y } : cabinFor(s.typeId, s.layout);
  const sectors: SectorLoad[] = times.map((x) => ({ from: x.from, to: x.to, capJ: cab.j, capY: cab.y, bookedJ: 0, bookedY: 0, cargoKg: 0 }));
  return { id: nextId(g, 'ro'), routeId: route.id, seriesId: s.id, dep, status: 'planned', sectors };
}

/** §D.2 the dated rotations a series makes (pure: new objects, not stored). */
export function seriesRotations(g: GameState, route: Route, s: RouteSeries): Rotation[] {
  const out: Rotation[] = [];
  for (const dep of seriesDates(g, route, s)) {
    const r = newRotation(g, route, s, dep);
    if (r) out.push(r);
  }
  return out;
}

/** The planned times of a rotation's sectors (its flights' when they exist, else from the series). */
export function rotationSchedule(g: GameState, route: Route, rot: Rotation): { std: Minute; sta: Minute }[] {
  const m = marketOfRoute(route);
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  const base = m && s ? rotationTimes(m, s, rot.dep) : [];
  return rot.sectors.map((sec, i) => {
    const f = sec.flightId ? g.flights[sec.flightId] : undefined;
    if (f && f.status !== 'cancelled') return { std: f.std, sta: f.sta };
    return base[i] ? { std: base[i].std, sta: base[i].sta } : { std: rot.dep, sta: rot.dep };
  });
}

/**
 * Files the timetable: rotations of every series inside the sales horizon (331 days), keeping the ones already on
 * sale (their bookings) and adding the new dates. Called when sales open and daily as the horizon rolls on.
 */
export function fileRotations(g: GameState, route: Route): number {
  if (route.status !== 'onSale' && route.status !== 'operating') return 0;
  const until = g.now + HORIZON();
  let n = 0;
  const have = new Set(route.rotations.map((r) => `${r.seriesId}@${r.dep}`));
  for (const s of route.series) {
    if (s.from > until) continue;
    for (const dep of seriesDates(g, route, { ...s, to: Math.min(s.to, until) })) {
      if (dep <= g.now + 60 || have.has(`${s.id}@${dep}`)) continue;
      // A rotation moved by the player keeps its own date: no second one on its old slot.
      if (route.rotations.some((r) => r.seriesId === s.id && r.moved && Math.abs(r.dep - r.moved - dep) < 1)) continue;
      const r = newRotation(g, route, s, dep);
      if (!r) continue;
      route.rotations.push(r);
      n++;
    }
  }
  if (n) route.rotations.sort((a, b) => a.dep - b.dep);
  // Old flown and cancelled rotations: keep a year for the route page and trends.
  const keep = g.now - 400 * DAY;
  if (route.rotations.length > 60) route.rotations = route.rotations.filter((r) => r.dep >= keep || (r.status !== 'flown' && r.status !== 'cancelled'));
  return n;
}

/** The route's contract (one per route): created at the first flights. */
export function routeContract(g: GameState, route: Route): Contract {
  const id = route.contractIds[route.contractIds.length - 1];
  const have = id ? g.contracts[id] : undefined;
  if (have) return have;
  const m = marketOfRoute(route);
  const used = new Set(Object.values(g.contracts).filter((c) => c.status === 'signed' || c.status === 'active').map((c) => c.color));
  let color = 0;
  while (used.has(color) && color < 7) color++;
  const season = seasonCode(g.now).code;
  const c: Contract = {
    id: nextId(g, 'k'), offerId: '', archetype: 'scheduled', clientId: route.model === 'partner' && route.partnerId ? route.partnerId : g.network!.ownClientId ?? 'own',
    title: `Scheduled: ${m ? `${m.from}–${m.to}` : route.marketId}`,
    product: { kind: 'charter', price: 0, depositPct: 0, balanceDaysBefore: 0, fuelEscalation: false },
    pattern: { kind: 'legs', legs: [] },
    requirements: { minSeats: 0, longestSectorNm: 0, minRunwayM: 0, etops: 0, approvals: [], extraCabin: 0 },
    penalties: { cancelScale: [], perDelay: 0, perCancelledLeg: 0 },
    payment: { basis: 'advance', dueDays: 0, depositPct: 0 },
    effects: {},
    aircraftIds: [], start: g.now, end: g.now + 400 * DAY, signed: g.now, status: 'active', generatedUntil: g.now,
    use: {}, billedMonths: [], color, balanceAt: null, invoiced: 0, accrued: 0, legsFlown: 0, legsOnTime: 0,
    sched: { routeId: route.id, season },
  };
  g.contracts[c.id] = c;
  route.contractIds.push(c.id);
  return c;
}

/** Flight number of a route sector: out sectors odd (the route's number), back sectors even. */
function flightNoOf(g: GameState, route: Route, out: boolean): string {
  const m = marketOfRoute(route);
  const pre = route.model === 'partner' && m?.partner ? m.partner.code : g.company.icao;
  return `${pre}${route.flightNo + (out ? 0 : 1)}`;
}

/**
 * Is the aircraft free from `a` to `b`: no flight, check or base programme (its days not generated yet included),
 * dry lease or held job in the way (contracts/plan anchorsOf)?
 */
export function freeBetween(g: GameState, aircraftId: string, a: Minute, b: Minute, ignore?: Set<string>): boolean {
  for (const x of anchorsOf(g, aircraftId)) {
    if (x.kind === 'start' || (x.kind === 'flight' && ignore?.has(x.id))) continue;
    if (x.std < b && x.sta > a) return false;
  }
  return true;
}

/** Aircraft that can fly the rotation (type, cabin, free), best first: the pinned tail, then the least used. */
export function candidates(g: GameState, route: Route, rot: Rotation, sameTypeOnly = false): string[] {
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  if (!s) return [];
  const times = rotationSchedule(g, route, rot);
  const turn = typeOf(s.typeId)?.turnMin ?? 60;
  const a = times[0].std - turn - 6 * 60;
  const b = times[times.length - 1].sta + turn;
  const use = (id: string) => (g.fleet[id].bhDays ?? []).reduce((x, d) => x + d[1], 0);
  const ok = Object.values(g.fleet).filter((ac) => {
    if (ac.status === 'leasedOut' || ac.status === 'stored' || ac.sale || ac.deliveredAt > a) return false;
    if (ac.typeId !== s.typeId && (sameTypeOnly || typeOf(ac.typeId)?.body !== typeOf(s.typeId)?.body)) return false;
    return freeBetween(g, ac.id, a, b);
  });
  const rank = (id: string) => (id === s.tail ? 0 : g.fleet[id].typeId === s.typeId ? (g.fleet[id].cabin.layout === s.layout ? 1 : 2) : 3);
  return ok.sort((x, y) => rank(x.id) - rank(y.id) || use(x.id) - use(y.id) || (x.id < y.id ? -1 : 1)).map((x) => x.id);
}

/** Creates a rotation's flights on an aircraft (and the positioning to and from it). */
export function flyRotation(g: GameState, route: Route, rot: Rotation, aircraftId: string): Flight[] {
  const m = marketOfRoute(route);
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  if (!m || !s) return [];
  const c = routeContract(g, route);
  if (!c.aircraftIds.includes(aircraftId)) c.aircraftIds.push(aircraftId);
  const times = rotationTimes(m, { ...s, typeId: g.fleet[aircraftId].typeId }, rot.dep);
  const out: Flight[] = [];
  const outN = times.filter((x) => x.dir === 'out').length;
  times.forEach((x, i) => {
    const sec = rot.sectors[i];
    if (!sec) return;
    const f = addFlight(g, {
      no: flightNoOf(g, route, x.dir === 'out'), aircraftId, contractId: c.id, kind: x.tech ? 'techstop' : 'revenue',
      from: x.from, to: x.to, std: x.std, sta: x.sta, pax: Math.min(sec.capJ, sec.bookedJ) + Math.min(sec.capY, sec.bookedY),
    });
    f.sched = { routeId: route.id, rotId: rot.id, idx: i };
    sec.flightId = f.id;
    out.push(f);
  });
  void outN;
  rot.aircraftId = aircraftId;
  rot.status = 'flights';
  c.end = Math.max(c.end, times[times.length - 1].sta + DAY);
  relinkPositioning(g, aircraftId);
  return out;
}

/**
 * §D.2 daily: rotations within materialiseDays get their flights on the best free aircraft; one with none at 10 days
 * out gets a red card (the conflict choices), and at 3 days out it is sub-chartered (no penalty, only the price).
 */
export function materialise(g: GameState, route: Route): void {
  if (route.status !== 'onSale' && route.status !== 'operating') return;
  fileRotations(g, route);
  const O = BAL.v019.ops;
  const touched = new Set<string>();
  for (const rot of route.rotations) {
    if (rot.status !== 'planned' || rot.dep > g.now + O.materialiseDays * DAY || rot.dep <= g.now + 60) continue;
    const ac = candidates(g, route, rot)[0];
    if (ac) {
      flyRotation(g, route, rot, ac);
      touched.add(ac);
      continue;
    }
    const days = (rot.dep - g.now) / DAY;
    if (days <= O.noAircraftDays && !rot.carded) {
      rot.carded = true;
      pushRouteNote(g, route, 'bad', `No aircraft for ${route.marketId.replace('-', '–')} on ${fmtDay(rot.dep)}`, `No free aircraft can fly it. Free one (swap or move other work), or it is sub-chartered 3 days before departure (no penalty, only the price).`, 'noAircraft');
    }
    if (days <= 3) subcharterRotation(g, route, rot);
  }
  if (touched.size) autoRoster(g, { aircraftIds: [...touched] });
}

/** Sub-charters a rotation that has no flights yet (a rival flies it under our number): flights with no aircraft. */
export function subcharterRotation(g: GameState, route: Route, rot: Rotation, rivalId?: string): number {
  const m = marketOfRoute(route);
  const s = route.series.find((x) => x.id === rot.seriesId) ?? route.series[0];
  if (!m || !s || rot.status !== 'planned') return 0;
  const rv = rivalId ?? subRival(g, s.typeId);
  if (!rv) return 0;
  const c = routeContract(g, route);
  const times = rotationTimes(m, s, rot.dep);
  const cost = subCost(g, s.typeId, times.reduce((a, x) => a + (x.sta - x.std), 0), rot.dep);
  times.forEach((x, i) => {
    const sec = rot.sectors[i];
    const f = addFlight(g, { no: flightNoOf(g, route, x.dir === 'out'), aircraftId: null, contractId: c.id, kind: x.tech ? 'techstop' : 'revenue', from: x.from, to: x.to, std: x.std, sta: x.sta, pax: sec.bookedJ + sec.bookedY });
    f.operatedBy = rv;
    f.sched = { routeId: route.id, rotId: rot.id, idx: i };
    sec.flightId = f.id;
  });
  // Sub-chartered legs complete on 'flight.arr' (no aircraft of ours).
  for (const sec of rot.sectors) {
    const f = sec.flightId ? g.flights[sec.flightId] : undefined;
    if (f) {
      f.ev++;
      reqArr(g, f);
    }
  }
  rot.operatedBy = rv;
  rot.status = 'flights';
  post(g, 'subcharter', -cost);
  noteRouteSub(g, rot.sectors.map((x) => (x.flightId ? g.flights[x.flightId] : undefined)).filter((x): x is Flight => !!x), cost);
  g.network!.stats.subs++;
  const name = g.rivals.find((r) => r.id === rv)?.name ?? 'another operator';
  pushRouteNote(g, route, 'info', `${name} flies ${fmtDay(rot.dep)} for us`, `Sub-chartered for ${usd(cost)}: the passengers keep their tickets, no penalty.`, null);
  touchFlights(g);
  return cost;
}

function reqArr(g: GameState, f: Flight): void {
  schedule(g, f.sta, 'flight.arr', f.id, f.ev);
}

/** The rival that sub-charters a type (cheapest with that body), or undefined. */
export function subRival(g: GameState, typeId: string): string | undefined {
  const body = typeOf(typeId)?.body;
  const list = g.rivals.filter((r) => r.fleet.some((x) => typeOf(x.typeId)?.body === body));
  return list.sort((a, b) => a.priceFactor - b.priceFactor || (a.id < b.id ? -1 : 1))[0]?.id;
}

/** §H.4 a rival's price for a rotation: its wet rate × block hours, +20 % inside 14 days, +40 % inside 3 (USD). */
export function subCost(g: GameState, typeId: string, blockMin: number, dep: Minute): number {
  const t = typeOf(typeId);
  const days = (dep - g.now) / DAY;
  const prem = days < 3 ? 1.4 : days < 14 ? 1.2 : 1;
  // The rival's ACMI rate plus the fuel and fees it now pays (we no longer do).
  const fuel = (t?.fuelTBH ?? 5) * g.market.fuelPrice;
  return Math.round(((t?.rateBH ?? 5_000) * 1.15 + fuel) * (blockMin / 60) * prem);
}

// ---------- moving and cancelling (§D.4, §H.5) ----------

export interface MoveQuote {
  ok: boolean;
  why?: string;
  /** New first departure (UTC). */
  dep: Minute;
  /** §H.5 passenger cost of the move. */
  cost: number;
  repDelta: number;
  pax: number;
  notes: string[];
}

/** The notice band of a departure: 0 (≥ 14 days), 1 (7–13), 2 (2–6), 3 (< 48 h). */
export function noticeBand(g: GameState, dep: Minute): number {
  const d = (dep - g.now) / DAY;
  const D = BAL.v019.pax.change.days;
  return d >= D[0] ? 0 : d >= D[1] ? 1 : d >= D[2] ? 2 : 3;
}

const bookedOf = (rot: Rotation) => Math.max(0, ...rot.sectors.map((s) => s.bookedJ + s.bookedY));

/** §D.4 what moving a rotation by `deltaMin` costs and whether it is legal (pure). */
export function quoteMoveRotation(g: GameState, rotId: string, deltaMin: number): MoveQuote {
  const at = findRotation(g, rotId);
  const none: MoveQuote = { ok: false, dep: 0, cost: 0, repDelta: 0, pax: 0, notes: [] };
  if (!at) return { ...none, why: 'This rotation is no longer planned.' };
  const { route, rot } = at;
  const dep = rot.dep + deltaMin;
  const pax = bookedOf(rot);
  if (rot.status !== 'planned' && rot.status !== 'flights') return { ...none, dep, pax, why: 'It has flown or been cancelled.' };
  if (rot.operatedBy) return { ...none, dep, pax, why: 'Another operator flies it: it keeps its times.' };
  const times = rotationSchedule(g, route, rot);
  if (times[0].std <= g.now + 60 || g.flights[rot.sectors[0].flightId ?? '']?.status === 'enroute') return { ...none, dep, pax, why: 'It is about to leave or has left.' };
  if (dep <= g.now + 120) return { ...none, dep, pax, why: 'Too soon: at least 2 hours from now.' };
  const notes: string[] = [];
  // Curfews at each end of each sector.
  for (let i = 0; i < times.length; i++) {
    const s = rot.sectors[i];
    if (inCurfew(s.from, times[i].std + deltaMin, false)) return { ...none, dep, pax, why: `${s.from} is closed at night then (curfew).` };
    if (inCurfew(s.to, times[i].sta + deltaMin, false)) return { ...none, dep, pax, why: `It would land at ${s.to} in its night closure (curfew).` };
  }
  // The aircraft's other flights and checks.
  const acId = rot.aircraftId;
  if (acId && g.fleet[acId]) {
    const own = new Set(rot.sectors.map((s) => s.flightId).filter((x): x is string => !!x));
    const turn = typeOf(g.fleet[acId].typeId)?.turnMin ?? 60;
    const a = times[0].std + deltaMin - turn;
    const b = times[times.length - 1].sta + deltaMin + turn;
    for (const f of liveFlightsOf(g, acId)) {
      if (own.has(f.id) || f.status === 'cancelled' || f.kind === 'positioning' || f.kind === 'ferry') continue;
      if (f.std < b && f.sta > a) return { ...none, dep, pax, why: `${g.fleet[acId].reg} flies ${f.no} ${f.from}–${f.to} then (${fmtDay(f.std)} ${fmtTime(f.std)} UTC).` };
    }
    for (const mx of Object.values(g.maintenance)) {
      if (mx.aircraftId !== acId || (mx.status !== 'planned' && mx.status !== 'inWork')) continue;
      if (mx.start < b && mx.end > a) return { ...none, dep, pax, why: `${g.fleet[acId].reg} is in the hangar then (${mx.kind === 'refit' ? 'cabin refit' : `${mx.kind}-check`}).` };
    }
  }
  const band = noticeBand(g, Math.min(rot.dep, dep));
  const P = BAL.v019.pax.change;
  const cost = Math.round(pax * P.move[band]);
  const repDelta = P.rep[band];
  if (Math.abs(deltaMin) > BAL.v019.ops.slotFreeMin && route.model === 'own') notes.push('More than an hour from the held slot: Lisbon gives a new slot for it.');
  if (pax) notes.push(`${pax} booked passenger${pax === 1 ? '' : 's'} told and rebooked${band ? ' at short notice' : ''}.`);
  if (acId) notes.push('The crew are re-planned for the new times.');
  return { ok: true, dep, cost, repDelta, pax, notes };
}

/** §D.4 moves a whole rotation (all its sectors). False when refused. */
export function moveRotation(g: GameState, rotId: string, deltaMin: number): boolean {
  const q = quoteMoveRotation(g, rotId, deltaMin);
  if (!q.ok || !deltaMin) return false;
  const { route, rot } = findRotation(g, rotId)!;
  for (const s of rot.sectors) {
    const f = s.flightId ? g.flights[s.flightId] : undefined;
    if (f && f.status === 'scheduled') retimeFlight(g, f, f.std + deltaMin, f.sta + deltaMin);
  }
  rot.dep += deltaMin;
  rot.moved = (rot.moved ?? 0) + deltaMin;
  rot.notice = g.now;
  if (q.cost) post(g, 'paxComp', -q.cost);
  if (q.repDelta) bumpRoute(g, route.id, q.repDelta, 'A flight moved at short notice');
  g.network!.stats.moves++;
  route.rotations.sort((a, b) => a.dep - b.dep);
  if (rot.aircraftId) {
    relinkPositioning(g, rot.aircraftId);
    autoRoster(g, { aircraftIds: [rot.aircraftId] });
  }
  return true;
}

export interface CancelQuote {
  ok: boolean;
  why?: string;
  /** Passenger costs beyond the refunds (rebooking, re-protection on a rival). */
  cost: number;
  /** Ticket money paid back. */
  refunds: number;
  pax: number;
}

/** §H.5 what cancelling a rotation costs (pure). */
export function quoteCancelRotation(g: GameState, rotId: string): CancelQuote {
  const at = findRotation(g, rotId);
  if (!at) return { ok: false, why: 'This rotation is no longer planned.', cost: 0, refunds: 0, pax: 0 };
  const { rot } = at;
  if (rot.status !== 'planned' && rot.status !== 'flights') return { ok: false, why: 'It has flown or been cancelled.', cost: 0, refunds: 0, pax: 0 };
  if (rot.sectors.some((s) => s.flightId && g.flights[s.flightId]?.status === 'enroute')) return { ok: false, why: 'It is in the air.', cost: 0, refunds: 0, pax: 0 };
  const pax = bookedOf(rot);
  const band = noticeBand(g, rot.dep);
  const P = BAL.v019.pax.change;
  const refunds = Math.round(rot.sectors.reduce((a, s) => a + (s.accrued ? 0 : s.sold ?? 0), 0));
  const cost = Math.round(pax * P.cancel[band] + pax * P.reprotect[band] * P.reprotectFare[band]);
  return { ok: true, cost, refunds, pax };
}

/** §H.5 cancels one rotation: refunds, re-protection, flights removed. False when refused. */
export function cancelRotation(g: GameState, rotId: string, why = 'Cancelled by us'): boolean {
  const q = quoteCancelRotation(g, rotId);
  if (!q.ok) return false;
  const { route, rot } = findRotation(g, rotId)!;
  const band = noticeBand(g, rot.dep);
  // Refunds: the ticket cash held for the sectors not flown goes back.
  for (const s of rot.sectors) {
    if (s.accrued || !s.sold) continue;
    cashOnly(g, -s.sold);
    route.unearned = Math.max(0, Math.round(route.unearned - s.sold));
    s.sold = 0;
  }
  if (q.cost) post(g, 'paxComp', -q.cost);
  const P = BAL.v019.pax.change;
  rot.reprotect = { ours: 0, rival: Math.round(q.pax * P.reprotect[band]), refunded: q.pax - Math.round(q.pax * P.reprotect[band]) };
  const ids = rot.sectors.map((s) => s.flightId).filter((x): x is string => !!x && g.flights[x]?.status === 'scheduled');
  const acId = rot.aircraftId;
  if (ids.length) removeFlights(g, ids);
  for (const s of rot.sectors) s.flightId = undefined;
  rot.status = 'cancelled';
  rot.notice = g.now;
  if (P.rep[band]) bumpRoute(g, route.id, P.rep[band], why);
  g.network!.stats.cancels++;
  if (acId && g.fleet[acId]) {
    relinkPositioning(g, acId);
    autoRoster(g, { aircraftIds: [acId] });
  }
  return true;
}

/** A rotation by id. */
export function findRotation(g: GameState, rotId: string): { route: Route; rot: Rotation } | undefined {
  for (const route of Object.values(g.network?.routes ?? {})) {
    const rot = route.rotations.find((r) => r.id === rotId);
    if (rot) return { route, rot };
  }
  return undefined;
}

/**
 * §D.1 adds or replaces a series (checked first). Rotations already on sale keep their passengers: a changed time
 * moves them (the small move cost), a day no longer flown cancels them (refunds); new dates are added. Null when done.
 */
export function setSeries(g: GameState, routeId: string, series: RouteSeries): string | null {
  const route = g.network?.routes[routeId];
  if (!route) return 'This route no longer exists.';
  const m = marketOfRoute(route);
  if (!m) return 'Unknown market.';
  if (!typeOf(series.typeId)) return 'Unknown aircraft type.';
  if (!series.monthly && !(series.days & 127)) return 'Pick at least one day.';
  if (series.to <= series.from) return 'The end date is before the start.';
  if (series.from < g.now - DAY && !route.series.some((x) => x.id === series.id)) return 'A new series starts in the future.';
  // The sample rotation must turn legally and miss the curfews.
  const sample = rotationTimes(m, series, localToUtc(m.from, Math.max(g.now, series.from) + 2 * DAY, series.out));
  for (const x of sample) {
    if (inCurfew(x.from, x.std, false)) return `${x.from} is closed at night at ${fmtTime(x.std, x.from)} local (curfew).`;
    if (inCurfew(x.to, x.sta, false)) return `It would land at ${x.to} at ${fmtTime(x.sta, x.to)} local, in its night closure.`;
  }
  const rangeOk = sample.every((x) => blockOk(series.typeId, x.from, x.to));
  if (!rangeOk) return `A ${typeOf(series.typeId)!.short} can't fly one of these sectors.`;
  const s: RouteSeries = { ...series, id: series.id || nextId(g, 'se') };
  const i = route.series.findIndex((x) => x.id === s.id);
  const old = i >= 0 ? route.series[i] : undefined;
  if (i >= 0) route.series[i] = s;
  else route.series.push(s);
  if (old) reconcile(g, route, old, s);
  fileRotations(g, route);
  touchNet(g);
  return null;
}

function blockOk(typeId: string, from: string, to: string): boolean {
  return distanceNm(from, to) <= maxSectorNm(typeId, from, to) * 1.0;
}

/** After a series changed: rotations on sale move to the new time (or are cancelled when their day is gone). */
function reconcile(g: GameState, route: Route, old: RouteSeries, s: RouteSeries): void {
  const dates = new Set(seriesDates(g, route, s));
  for (const rot of [...route.rotations]) {
    if (rot.seriesId !== old.id || (rot.status !== 'planned' && rot.status !== 'flights') || rot.dep <= g.now + 120) continue;
    const m = marketOfRoute(route)!;
    const moved = localToUtc(m.from, rot.dep - (rot.moved ?? 0) + 12 * 60 - (old.out - s.out), s.out);
    const target = [...dates].find((d) => Math.abs(d - moved) < DAY / 2);
    if (target === undefined) {
      if (!rot.sectors.some((x) => x.bookedJ + x.bookedY)) {
        // Nothing booked: it just goes.
        const ids = rot.sectors.map((x) => x.flightId).filter((x): x is string => !!x && g.flights[x]?.status === 'scheduled');
        if (ids.length) removeFlights(g, ids);
        route.rotations.splice(route.rotations.indexOf(rot), 1);
      } else cancelRotation(g, rot.id, 'Timetable changed');
      continue;
    }
    const delta = target - rot.dep;
    if (delta && !moveRotation(g, rot.id, delta)) cancelRotation(g, rot.id, 'Timetable changed');
    // Its seats follow the new type and cabin when it has no flights yet.
    if (rot.status === 'planned') {
      const cab = cabinFor(s.typeId, s.layout);
      for (const x of rot.sectors) {
        x.capJ = cab.j;
        x.capY = cab.y;
      }
    }
  }
  // Dates already covered by a moved rotation are not filed twice.
  void dates;
}

/** Ends a series from a date (its rotations after it are cancelled, refunds paid). Null when done. */
export function removeSeries(g: GameState, routeId: string, seriesId: string, from: Minute = g.now): string | null {
  const route = g.network?.routes[routeId];
  const s = route?.series.find((x) => x.id === seriesId);
  if (!route || !s) return 'This series no longer exists.';
  for (const rot of [...route.rotations]) {
    if (rot.seriesId !== seriesId || rot.dep < from || (rot.status !== 'planned' && rot.status !== 'flights')) continue;
    if (!rot.sectors.some((x) => x.bookedJ + x.bookedY) && rot.status === 'planned') route.rotations.splice(route.rotations.indexOf(rot), 1);
    else cancelRotation(g, rot.id, 'Series ended');
  }
  s.to = Math.max(s.from, from);
  touchNet(g);
  return null;
}

function touchNet(g: GameState): void {
  if (g.network) g.network.rev = (g.network.rev ?? 0) + 1;
}
