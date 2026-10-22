// v0.7.2 C-checks at real MRO hubs (UPDATE-0.7.2.md §7): a ferry out, the check, a ferry home; the pilots fly home
// and back on airline tickets in between (rostered by the auto-roster like any ferry). Cabin work stays at home base.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { C_HUBS, cHubAt, type CHub } from '../../data/mro';
import { BAL } from '../core/balance';
import { addFlight, flightsOf, ownFlightNo, touchFlights } from '../core/entities';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { ActionResult, Aircraft, Flight, GameState, Minute } from '../core/types';
import { rerosterFrom } from '../crew';
import { ferryCost, ferryCrewCost, ferryDays, ferryRoute, type DeliveryLeg } from './delivery';
import { checkCostOf, disposalWhy, durationOf, groundGaps, scheduleCheck } from './maintenance';
import { usd } from './util';

export interface CCheckOption {
  hub: CHub;
  ok: boolean;
  why: string | null;
  /** The check in the hangar. */
  start: Minute;
  end: Minute;
  ferryOut: DeliveryLeg[];
  ferryHome: DeliveryLeg[];
  checkCost: number;
  /** Fuel and fees both ways. */
  ferryCost: number;
  /** Two pilots: airline tickets home and back out, hotels. */
  crewCost: number;
  total: number;
  /** Ferry out → ferry home landed. */
  awayDays: number;
}

export interface CheckTicket { crewIds: string[]; no: string; from: string; to: string; dep: Minute; cost: number }

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const up = (t: Minute) => Math.ceil(t / 30) * 30;

/** Ferry legs from → to departing `dep` (night stops on long chains); [] when already there; null: no route. */
function ferryLegs(ac: Aircraft, from: string, to: string, dep: Minute): DeliveryLeg[] | null {
  if (from === to) return [];
  const r = ferryRoute(ac.typeId, from, to);
  return r ? ferryDays(r, dep, ac.typeId) : null;
}
/** Minutes from the first departure to the last arrival of a ferry chain. */
const span = (legs: DeliveryLeg[]) => (legs.length ? legs[legs.length - 1].sta - legs[0].std : 0);

/** The whole window a hub check needs from `at`: ferry out (landing a turn before), check, ferry home. */
function windowAt(g: GameState, ac: Aircraft, hub: string, at: string, start: Minute) {
  const turn = typeOf(ac.typeId).turnMin;
  const out0 = ferryLegs(ac, at, hub, 0);
  const home0 = ferryLegs(ac, hub, g.company.homeBase, 0);
  if (!out0 || !home0) return null;
  const outDep = start - turn - span(out0);
  const ferryOut = ferryLegs(ac, at, hub, outDep)!;
  const end = start + durationOf(ac, 'C');
  const ferryHome = ferryLegs(ac, hub, g.company.homeBase, end + BAL.v072.cHub.homeAfterMin)!;
  const from = ferryOut.length ? ferryOut[0].std - turn : start;
  const to = ferryHome.length ? ferryHome[ferryHome.length - 1].sta + turn : end;
  return { ferryOut, ferryHome, end, from, to };
}

/** Earliest check starts at a hub whose window holds ferry out + check + ferry home (one a week in a long gap). Pure. */
export function cCheckSlots(g: GameState, aircraftId: string, hub: string, n = 6, _restFit?: 'fcrc' | 'overhead'): Minute[] {
  const ac = g.fleet[aircraftId];
  if (!ac || !cHubAt(typeOf(ac.typeId).family, hub)) return [];
  const out: Minute[] = [];
  const turn = typeOf(ac.typeId).turnMin;
  for (const gp of groundGaps(g, ac, g.now + BAL.ferryLeadMin, g.now + 365 * DAY)) {
    const o = ferryLegs(ac, gp.at, hub, 0);
    if (!o) continue;
    let start = up(Math.max(gp.from, g.now + BAL.ferryLeadMin) + turn + span(o) + turn + 30);
    for (; out.length < n; start += 7 * DAY) {
      const w = windowAt(g, ac, hub, gp.at, start);
      if (!w || w.to > gp.to) break;
      out.push(start);
    }
    if (out.length >= n) break;
  }
  return out;
}

/** One option per hub of the aircraft's family (at `start`, else its first slot), cheapest total first. Pure. */
export function cCheckOptions(g: GameState, aircraftId: string, start?: Minute, _restFit?: 'fcrc' | 'overhead'): CCheckOption[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  const home = g.company.homeBase;
  const base = checkCostOf(ac, 'C');
  const out: CCheckOption[] = [];
  const leaving = disposalWhy(g, ac);
  for (const hub of C_HUBS[typeOf(ac.typeId).family]) {
    if (leaving) {
      const t = start ?? g.now;
      const checkCost = Math.round(base * hub.price);
      out.push({ hub, ok: false, why: leaving, start: t, end: t + durationOf(ac, 'C'), ferryOut: [], ferryHome: [], checkCost, ferryCost: 0, crewCost: 0, total: checkCost, awayDays: 0 });
      continue;
    }
    const s = start ?? cCheckSlots(g, ac.id, hub.code, 1)[0];
    const checkCost = Math.round(base * hub.price);
    const none: CCheckOption = { hub, ok: false, why: null, start: s ?? g.now, end: (s ?? g.now) + durationOf(ac, 'C'), ferryOut: [], ferryHome: [], checkCost, ferryCost: 0, crewCost: 0, total: checkCost, awayDays: 0 };
    if (s === undefined) {
      out.push({ ...none, why: 'No free window long enough in the next year' });
      continue;
    }
    const gp = groundGaps(g, ac, g.now, s + 365 * DAY).find((x) => x.from <= s && x.to > s);
    const at = gp?.at ?? ac.at;
    const w = windowAt(g, ac, hub.code, at, s);
    if (!w) {
      out.push({ ...none, why: `No ferry route to ${hub.city}` });
      continue;
    }
    const fo = ferryCost(ac.typeId, w.ferryOut, g.market.fuelPrice);
    const fh = ferryCost(ac.typeId, w.ferryHome, g.market.fuelPrice);
    const ferry = fo.fuel + fo.fees + fh.fuel + fh.fees;
    const crewCost = ferryCrewCost(g, home, hub.code, w.ferryOut) + ferryCrewCost(g, home, hub.code, w.ferryHome);
    const first = w.ferryOut[0]?.std ?? s;
    const last = w.ferryHome[w.ferryHome.length - 1]?.sta ?? w.end;
    const why = !gp ? `${ac.reg} is busy then` : w.from < Math.max(gp.from, g.now) || w.to > gp.to ? `The ferries and the ${typeOf(ac.typeId).cCheckDays}-day check don't fit around ${ac.reg}'s work then` : null;
    out.push({
      hub, ok: !why, why, start: s, end: w.end, ferryOut: w.ferryOut, ferryHome: w.ferryHome, checkCost, ferryCost: ferry, crewCost,
      total: checkCost + ferry + crewCost, awayDays: Math.round(((last - first) / DAY) * 10) / 10,
    });
  }
  return out.sort((a, b) => Number(b.ok) - Number(a.ok) || a.total - b.total || (a.hub.code < b.hub.code ? -1 : 1));
}

/**
 * Books the C-check at a hub: ferry out, check, ferry home (crewed by the auto-roster, pilots on airline tickets).
 * `forced` (or opts.forced): the overdue path (grounded), allowed on a sold or returning aircraft. v0.7.3
 * opts.restFit: a crew rest compartment fitted with the check (longer check, its cost added).
 */
export function bookCCheck(g: GameState, aircraftId: string, hub: string, start: Minute, opts: boolean | { forced?: boolean; restFit?: 'fcrc' | 'overhead' } = false): ActionResult<{ maintId: string }> {
  const forced = typeof opts === 'boolean' ? opts : !!opts.forced;
  const ac = g.fleet[aircraftId];
  if (!ac) return { ok: false, error: 'Aircraft not found' };
  const leaving = forced ? null : disposalWhy(g, ac);
  if (leaving) return { ok: false, error: leaving };
  const h = cHubAt(typeOf(ac.typeId).family, hub);
  if (!h) return { ok: false, error: `${city(hub)} does not do ${typeOf(ac.typeId).short} C-checks` };
  const home = g.company.homeBase;
  const homeR = ferryRoute(ac.typeId, hub, home);
  if (!homeR) return { ok: false, error: `No ferry route home from ${h.city}` };
  // The ferry home must be clear too.
  const end = Math.round(Math.max(start, g.now)) + durationOf(ac, 'C');
  const homeLegs = ferryDays(homeR, end + BAL.v072.cHub.homeAfterMin, ac.typeId);
  const homeBy = homeLegs.length ? homeLegs[homeLegs.length - 1].sta : end;
  const clash = flightsOf(g, ac.id).find((f) => (f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && f.std < homeBy + 30 && f.sta > end);
  if (clash) return { ok: false, error: `The ferry home clashes with ${clash.no} ${fmtDay(clash.std)}` };
  const r = scheduleCheck(g, ac.id, 'C', start, hub, { hub: h, forced });
  if (!r.ok) return r;
  const m = g.maintenance[r.data!.maintId];
  const legs = ferryDays(homeR, m.end + BAL.v072.cHub.homeAfterMin, ac.typeId).map((l) => {
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
    f.purpose = 'check';
    return f;
  });
  m.homeIds = legs.map((f) => f.id);
  touchFlights(g);
  rerosterFrom(g, ac.id, g.now);
  const out = (m.ferryIds ?? []).map((id) => g.flights[id]).filter((f): f is Flight => !!f);
  const opt = cCheckOptions(g, ac.id, m.start).find((o) => o.hub.code === hub);
  const all = m.cost + (opt ? opt.ferryCost + opt.crewCost : 0);
  pushMessage(g, {
    tone: 'info', cat: 'tech', title: `C-check booked: ${ac.reg} at ${h.name}`,
    body: `${h.name}, ${h.city}: ${fmtDay(m.start)}–${fmtDay(m.end)}.${out.length ? ` Ferry out ${fmtDay(out[0].std)} ${out[0].from}–${out[out.length - 1].to},` : ''} home ${legs.length ? fmtDay(legs[0].std) : fmtDay(m.end)}; the pilots fly home and back on airline flights. About ${usd(all)} all in.`,
    ref: { kind: 'maint', id: m.id },
  });
  return { ok: true, msg: `C-check at ${h.name} ${fmtDay(m.start)}–${fmtDay(m.end)}`, data: { maintId: m.id } };
}

/** A booked hub check's ferries and the pilots' airline tickets. Pure. */
export function checkLogistics(g: GameState, maintId: string): { ferryOut: Flight[]; ferryHome: Flight[]; tickets: CheckTicket[] } | null {
  const m = g.maintenance[maintId];
  if (!m || !m.hub) return null;
  const get = (ids: string[] | undefined) => (ids ?? []).map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
  const ferryOut = get(m.ferryIds);
  const ferryHome = get(m.homeIds);
  const tickets: CheckTicket[] = [];
  const seen = new Set<string>();
  for (const f of [...ferryOut, ...ferryHome]) {
    const d = f.dutyId ? g.duties[f.dutyId] : undefined;
    const p = d ? g.pairings[d.pairingId] : undefined;
    for (const did of p?.dutyIds ?? []) {
      for (const tid of g.duties[did]?.deadheadIds ?? []) {
        const t = g.flights[tid];
        if (!t || t.kind !== 'deadhead' || t.status === 'cancelled' || seen.has(tid)) continue;
        seen.add(tid);
        tickets.push({ crewIds: [...t.crewIds], no: t.no, from: t.from, to: t.to, dep: t.std, cost: t.cost ?? 0 });
      }
    }
  }
  tickets.sort((a, b) => a.dep - b.dep);
  return { ferryOut, ferryHome, tickets };
}
