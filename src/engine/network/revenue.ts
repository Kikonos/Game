// v0.19 revenue at departure and the sector's result at arrival (UPDATE-0.19.md §F, §H.3, §H.5, §I, §J.1).
// Departure: the cabin flown is checked against what was sold (business lost: refunds and goodwill; seats short:
// volunteers and denied boarding), no-shows keep their fare, ticket revenue is accrued from the unearned cash, cargo
// (live animals, mail) and extras are booked. Arrival: the sector's costs, on-time, EU261 for a long delay of ours,
// reputation and the route's month. A sub-chartered sector (no aircraft of ours) does both at its arrival.

import { BAL } from '../core/balance';
import { accrue, invoice, post } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { Flight, GameState } from '../core/types';
import { costTotal, passThrough, routeDisruptionCost, routeLegCost, sectorPax } from './costs';
import { marketOfRoute, routeStation, type Dir } from './model';
import { pushRouteNote } from './notes';
import { bumpRoute } from './reputation';
import { dirSectors, fareFor, payloadMax } from './sales';
import { netRoll } from './side';
import type { Rotation, Route, RoutePnl, SectorLoad } from './types';

const EMPTY: RoutePnl = { rev: 0, tickets: 0, cargo: 0, ancillary: 0, direct: 0, acTime: 0, result: 0, pax: 0, seats: 0, bh: 0, sectors: 0, onTime: 0, cargoKg: 0, launch: 0, paxSec: 0 };
export const pnlOf = (route: Route, t: number): RoutePnl => (route.pnl[monthKey(t)] ??= { ...EMPTY });

/** The direction of a sector (out before the destination, back after). */
export function dirOf(route: Route, rot: Rotation, idx: number): Dir {
  return dirSectors(route, rot, 'out').includes(idx) ? 'out' : 'back';
}

/** EU261 Art. 10 downgrade refund share by the route's distance band. */
export const downgradeShare = (route: Route) => (marketOfRoute(route)?.eu261 === 'long' ? BAL.v019.pax.downgrade[2] : BAL.v019.pax.downgrade[1]);

/**
 * §F.1 the cargo a direction carries on a rotation (kg): general, mail, perishables, NGO supplies and live animals,
 * by the catalogue × season (Christmas +30 % south) × a weekly noise, within the payload left after passengers.
 * No cargo north from a station without EU cargo security. Live animals only in a heated hold (a cap).
 */
export function cargoFor(g: GameState, route: Route, rot: Rotation, dir: Dir, typeId: string, pax: number): { kg: number; avi: number; mail: number; rev: number } {
  const m = marketOfRoute(route);
  if (!m) return { kg: 0, avi: 0, mail: 0, rev: 0 };
  const C = BAL.v019.cargo;
  const idx = dirSectors(route, rot, dir);
  const first = rot.sectors[idx[0]];
  if (!first) return { kg: 0, avi: 0, mail: 0, rev: 0 };
  const noise = 1 + C.noise * (netRoll(g, `cargo:${rot.id}:${dir}`) * 2 - 1);
  const month = new Date(Date.UTC(2000, 0, 1) + rot.dep * 60_000).getUTCMonth();
  const xmas = dir === 'out' && month === 11 ? 1 + C.xmas : 1;
  const north = dir === 'back';
  const blockedNorth = north && !routeStation(first.from).euCargo;
  const general = blockedNorth ? 0 : (north ? m.cargo.north : m.cargo.south) * noise * xmas;
  const mail = (m.cargo.mail ?? 0) * (blockedNorth ? 0 : 1);
  const perish = north && !blockedNorth ? m.cargo.perish ?? 0 : 0;
  const ngo = north ? 0 : (m.cargo.ngo ?? 0) * noise;
  const wide = typeOf(typeId)?.body === 'wide';
  const avi = north ? 0 : Math.min(m.cargo.avi ?? 0, wide ? C.aviMax : C.aviMax / 2);
  // Payload left after passengers and bags on the tightest sector of the direction.
  let room = Infinity;
  for (const i of idx) room = Math.min(room, payloadMax(typeId, rot.sectors[i].from, rot.sectors[i].to) - pax * C.paxKg);
  room = Math.max(0, room);
  // Mail first, then live animals (they can't wait), then by rate.
  let left = room;
  const take = (want: number) => {
    const x = Math.max(0, Math.min(left, want));
    left -= x;
    return Math.round(x);
  };
  const mk = take(mail);
  const ak = take(avi);
  const pk = take(perish);
  const gk = take(general);
  const nk = take(ngo);
  const R = C.rate;
  const rev = mk * R.mail + ak * R.avi + pk * R.perishables + gk * (north ? R.generalNorth : R.general) + nk * R.ngo;
  return { kg: mk + ak + pk + gk + nk, avi: ak, mail: mk, rev: Math.round(rev) };
}

/**
 * The partner's fee for a sector: its block hours × the fee a BH, plus the share of tickets above 70 % full (pure; the
 * passengers flown, or `pax` for an estimate before departure).
 */
export function partnerFee(g: GameState, route: Route, s: SectorLoad, f: Flight, pax0?: number): number {
  const P = BAL.v019.fares.partner;
  const typeId = f.aircraftId ? g.fleet[f.aircraftId]?.typeId ?? '' : route.series[0]?.typeId ?? '';
  const t = typeOf(typeId);
  const feeBH = route.partnerFeeBH ?? Math.round((t?.rateBH ?? 5_000) * P.feeOfRate);
  // The fee a block hour, plus the flying costs we pay and the partner reimburses at cost (a charter's terms).
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const pass = ac ? passThrough(routeLegCost(g, f, ac)) : 0;
  const base = feeBH * (f.block / 60) + pass;
  const cap = s.capJ + s.capY;
  const pax = pax0 ?? (s.flownJ ?? 0) + (s.flownY ?? 0);
  const above = Math.max(0, pax - Math.ceil(cap * P.shareAbove));
  const share = above * fareFor(g, route, 'Y', f.std) * P.share;
  return Math.round(base + share);
}

/**
 * 'flight.dep' of a route sector (ops departed it): product check, flown passengers, revenue accrued. Once per
 * sector (a sub-chartered one comes here from its arrival).
 */
export function onSectorDep(g: GameState, f: Flight, rot: Rotation, idx: number): void {
  const route = g.network?.routes[rot.routeId];
  const s = rot.sectors[idx];
  if (!route || !s || s.accrued) return;
  const m = marketOfRoute(route);
  const dir = dirOf(route, rot, idx);
  const ids = dirSectors(route, rot, dir);
  const head = ids[0] === idx;
  // v0.21 a stopover direction: the first sector's locals get off at the stop, the second sector's get on there.
  const tag = !!m?.stopover && ids.length === 2;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const P = BAL.v019.pax;
  let comp = 0;
  if (head) {
    // §H.3 the cabin flown against what was sold.
    const capJ = ac ? ac.cabin.j + ac.cabin.w : s.capJ;
    const capY = ac ? ac.cabin.y : s.capY;
    const noShowJ = Math.round(s.bookedJ * BAL.v019.sales.noShow * (0.6 + 0.8 * netRoll(g, `show:${rot.id}:${dir}:J`)));
    const noShowY = Math.round(s.bookedY * BAL.v019.sales.noShow * (0.6 + 0.8 * netRoll(g, `show:${rot.id}:${dir}:Y`)));
    let j = s.bookedJ - noShowJ;
    let y = s.bookedY - noShowY;
    let down = 0;
    if (j > capJ) {
      down = j - capJ;
      j = capJ;
      y += down;
      const fare = fareFor(g, route, 'J', f.std);
      const late = !rot.notice || f.std - rot.notice < P.earlyNoticeDays * DAY;
      comp += down * (fare * downgradeShare(route) + P.voucher * P.voucherCost);
      bumpRoute(g, route.id, P.downgradeRep + (late ? P.downgradeLateRep : 0) * 1, 'Business class lost');
      (route.dents ??= []).push({ cls: 'J', x: 1 - P.jDent, until: g.now + P.jDentDays * DAY });
      g.network!.stats.downgrades++;
      route.consistent = 0;
      pushRouteNote(g, route, 'warn', `${f.no}: ${down} business passenger${down === 1 ? '' : 's'} downgraded`, `${ac?.reg ?? 'The aircraft'} has ${capJ ? `only ${capJ}` : 'no'} business seats. Each was refunded part of the fare and given a voucher; business bookings on this route dip for two months.`, `down:${rot.id}`);
    }
    let denied = 0;
    if (y > capY) {
      const over = y - capY;
      y = capY;
      const vol = Math.round(over * P.volunteers);
      denied = over - vol;
      const band = marketOfRoute(route)?.eu261 === 'long' ? 2 : 1;
      comp += vol * P.volunteerVoucher + denied * (P.eu261[band] + BAL.v019.pax.change.reprotectFare[3]);
      if (denied) bumpRoute(g, route.id, -denied / 10, 'Passengers denied boarding');
    }
    if (tag) {
      // Through passengers: the same show-up as the sector's, out of those booked to fly on.
      const tj = Math.max(0, s.bookedJ - (s.localJ ?? 0));
      const ty = Math.max(0, s.bookedY - (s.localY ?? 0));
      s.flownJ = j;
      s.flownY = y;
      s.thruJ = Math.min(j, Math.round(tj * (s.bookedJ ? j / s.bookedJ : 0)));
      s.thruY = Math.min(y, Math.round(ty * (s.bookedY ? y / s.bookedY : 0)));
      if (denied) s.denied = denied;
    } else {
      for (const i of ids) {
        const x = rot.sectors[i];
        x.flownJ = j;
        x.flownY = y;
        if (denied) x.denied = denied;
      }
    }
    g.network!.stats.pax += j + y;
    // Cargo of the direction (carried on every sector of it; earned once).
    const typeId = ac?.typeId ?? route.series[0]?.typeId ?? 'b763';
    const cg = cargoFor(g, route, rot, dir, typeId, j + y);
    for (const i of ids) {
      const x = rot.sectors[i];
      x.cargoKg = cg.kg;
      x.aviKg = cg.avi;
      x.mailKg = cg.mail;
    }
    let cargoRev = cg.rev;
    if (route.model === 'partner') cargoRev = Math.round(cargoRev * BAL.v019.fares.partner.cargoShare);
    if (cargoRev) post(g, 'cargoRevenue', cargoRev);
    const anc = route.model === 'partner' ? 0 : Math.round((j + y) * (m?.ancillary ?? 20));
    if (anc) post(g, 'ancillaryRevenue', anc);
    s.rev = cargoRev + anc;
    if (comp) post(g, 'paxComp', -Math.round(comp));
    const p = pnlOf(route, g.now);
    p.cargo += cargoRev;
    p.ancillary += anc;
    p.rev += cargoRev + anc;
    p.direct += Math.round(comp);
    p.pax += j + y;
    p.cargoKg += cg.kg;
  } else if (tag && s.flownJ === undefined) {
    // v0.21 the second sector of a stopover: those who stayed on, and the locals who board here.
    const h = rot.sectors[ids[0]];
    const ns = (n: number, k: string) => Math.round(n * BAL.v019.sales.noShow * (0.6 + 0.8 * netRoll(g, `show:${rot.id}:${dir}:${k}2`)));
    const lj = Math.max(0, (s.localJ ?? 0) - ns(s.localJ ?? 0, 'J'));
    const ly = Math.max(0, (s.localY ?? 0) - ns(s.localY ?? 0, 'Y'));
    const capJ = ac ? ac.cabin.j + ac.cabin.w : s.capJ;
    const capY = ac ? ac.cabin.y : s.capY;
    const thJ = h.thruJ ?? Math.max(0, (h.flownJ ?? 0) - (h.localJ ?? 0));
    const thY = h.thruY ?? Math.max(0, (h.flownY ?? 0) - (h.localY ?? 0));
    s.flownJ = Math.min(capJ, thJ + lj);
    s.flownY = Math.min(capY, thY + ly);
    const boarded = Math.max(0, s.flownJ - thJ) + Math.max(0, s.flownY - thY);
    g.network!.stats.pax += boarded;
    const anc = route.model === 'partner' ? 0 : Math.round(boarded * (m?.ancillary ?? 20));
    if (anc) post(g, 'ancillaryRevenue', anc);
    s.rev = (s.rev ?? 0) + anc;
    const p = pnlOf(route, g.now);
    p.ancillary += anc;
    p.rev += anc;
    p.pax += boarded;
  } else if (s.flownJ === undefined) {
    // A through sector whose first sector was missed (should not happen): take the booked numbers.
    s.flownJ = Math.min(s.bookedJ, s.capJ);
    s.flownY = Math.min(s.bookedY, s.capY);
  }
  // Tickets: the money taken for this sector is earned now (a partner pays its fee per block hour instead).
  let tickets = 0;
  if (route.model === 'partner') {
    tickets = partnerFee(g, route, s, f);
    const pid = route.partnerId;
    if (pid && tickets) invoice(g, { clientId: pid, contractId: f.contractId, desc: `${f.no} ${f.from}–${f.to}`, amount: tickets, cat: 'ticketRevenue', dueDays: 30 });
  } else {
    tickets = Math.round(s.sold ?? 0);
    if (tickets) accrue(g, 'ticketRevenue', tickets);
    route.unearned = Math.max(0, Math.round(route.unearned - tickets));
  }
  s.accrued = true;
  s.rev = (s.rev ?? 0) + tickets;
  f.pax = (s.flownJ ?? 0) + (s.flownY ?? 0);
  const p = pnlOf(route, g.now);
  p.tickets += tickets;
  p.rev += tickets;
  // v0.21 the load factor's top: passengers on this sector (a month whose flying began before v0.21 keeps `pax`).
  if (p.paxSec === undefined && !p.seats) p.paxSec = 0;
  p.seats += s.capJ + s.capY;
  if (p.paxSec !== undefined) p.paxSec += (s.flownJ ?? 0) + (s.flownY ?? 0);
  if (route.status === 'onSale') {
    route.status = 'operating';
    route.firstFlight ??= f.std;
  }
}

/**
 * 'flight.arr' of a route sector: costs, on-time, a long delay's EU261 and care, reputation, the route's month; the
 * rotation flown after its last sector. A sub-chartered sector (no aircraft) accrues its revenue here.
 */
export function onSectorArr(g: GameState, f: Flight, rot: Rotation, idx: number): void {
  const route = g.network?.routes[rot.routeId];
  const s = rot.sectors[idx];
  if (!route || !s || s.cost !== undefined) return;
  if (!s.accrued) onSectorDep(g, f, rot, idx);
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const block = Math.max(0, (f.ata ?? g.now) - (f.atd ?? f.std));
  let cost = 0;
  if (ac) cost = costTotal(routeLegCost(g, f, ac, block));
  else {
    // A rival flew it: only our distribution on the tickets (the sub-charter price was booked when it was handed over).
    const p = sectorPax(s);
    cost = route.model === 'partner' ? 0 : Math.round(BAL.v019.cost.gds * BAL.v019.cost.agencyShare * (p.j + p.y) + (s.sold ?? 0) * (BAL.v019.cost.cardFee + BAL.v019.cost.commission));
    if (cost) post(g, 'distribution', -cost);
    // The rival's price (booked as a sub-charter cost when it was handed over) belongs to the route's result.
    cost += s.subCost ?? 0;
  }
  // On time: within 15 minutes of the schedule (ops keeps schedStd).
  const sched = (f.schedStd ?? f.std) + f.block;
  const late = Math.max(0, (f.ata ?? g.now) - sched);
  const onTime = late <= 15;
  s.onTime = onTime;
  const R = BAL.v019.rep;
  let comp = 0;
  if (ac) {
    const excused = (f.excused ?? 0) >= late - 15;
    if (late >= 180) {
      comp = routeDisruptionCost(g, f, 'delay', late, excused);
      if (comp) post(g, 'paxComp', -comp);
    }
    const first = route.firstFlight !== undefined && Math.abs(f.std - route.firstFlight) < DAY;
    const d = onTime ? R.onTime : late < 180 ? R.late : R.late3h;
    bumpRoute(g, route.id, first ? d * 2 : d, onTime ? 'On time' : 'Late');
    // A lost bag now and then (more on full flights).
    const full = ((s.flownJ ?? 0) + (s.flownY ?? 0)) / Math.max(1, s.capJ + s.capY) > 0.9;
    if (full && netRoll(g, `bag:${f.id}`) < R.baggageP) bumpRoute(g, route.id, R.baggage, 'A lost bag');
  }
  s.cost = Math.round(cost + comp);
  const p = pnlOf(route, g.now);
  p.direct += Math.round(cost + comp);
  p.bh += ac ? Math.round((block / 60) * 100) / 100 : 0;
  p.sectors++;
  if (onTime) p.onTime++;
  // The rotation's last sector: flown; slot use; product consistency.
  if (idx === rot.sectors.length - 1) {
    rot.status = 'flown';
    g.network!.stats.rotations++;
    if (route.slots) route.slots.flown++;
    if (!rot.sectors.some((x) => x.denied) && (rot.sectors[0].flownJ ?? 0) <= rot.sectors[0].capJ) {
      route.consistent = (route.consistent ?? 0) + 1;
      if (route.consistent >= R.consistentRuns) {
        route.consistent = 0;
        bumpRoute(g, route.id, R.consistent, 'The same aircraft and cabin as sold');
      }
    }
  }
}
