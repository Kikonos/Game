// v0.7 delivery: handover abroad, the delivery ferry home, delivery pilots deadheading out on airlines
// (UPDATE-0.7.md §F6.4). The ferry is planned at signing (split into ferry days with fuel stops and night stops)
// and crewed by the auto-roster like any pilots-only ferry; a delivery ferry is never cancelled: without rated
// pilots it waits at the site a day at a time, paying parking.

import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { BAL } from '../core/balance';
import { addFlight, liveFlightsOf, ownFlightNo, removeFlights, retimeFlight } from '../core/entities';
import { distanceNm, interpolateGC } from '../core/geo';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { blockMinutes, etopsCap, etopsMinutes, heldEtops, etopsNeeded, etopsRoute, isPilot, maxSectorNm, NO_STOP_COUNTRY, runwayFit, typeOf, withinEtops } from '../core/perf';
import { DAY, dayStart, fmtDate, fmtDay, fmtDuration, fmtTime, toLocal } from '../core/time';
import type { Aircraft, ApprovalId, Flight, GameState, Minute } from '../core/types';
import { LESSOR_SITES } from '../../data/market';
import { approvalThatWorks, capText } from './etops';
import { ferryDays, localToUTC, route, type DayLeg } from '../contracts/plan';
import { crewIx } from '../crew/timeline';
import { commercialItinerary, itinerary, ticketBlock, type CommercialLeg } from './commercial';
import { usd } from './util';

export type DeliveryLeg = DayLeg;
export interface DeliveryQuote {
  site: string; where: string; handover: Minute; homeBy: Minute; legs: DeliveryLeg[]; days: number;
  fuel: number; fees: number; crew: number; total: number;
  /** Planned airline itinerary for the delivery pilots from home base (display only). */
  deadhead: CommercialLeg[];
  /** 'SCL–REC–LIS · 2 legs · 1 night stop · ≈ $96K'. */
  text: string;
  /** v0.11 our ETOPS cap for this type (0: the 60-minute rule; Infinity: four engines). */
  cap?: number;
  /** v0.11 the usual way needs more than our cap: the ferry goes the long way round on fuel stops inside it. */
  longWay?: boolean;
  /** v0.11 no legal ferry home on our certificate: why, and what real operators do instead. */
  blocked?: FerryBlock | null;
}

/** v0.11 a delivery ferry we may not fly (ETOPS): the usual way, its worst leg, and the ways out. */
export interface FerryBlock {
  /** The usual way home ('SYD–NAN–HNL–SFO–…'). */
  usual: string;
  /** Its leg furthest from an airport (minutes at one-engine speed). */
  worst: { from: string; to: string; min: number };
  /** Our cap in words ('60 minutes'). */
  capText: string;
  /** The ETOPS approval that would open it for this type, if any. */
  approval: ApprovalId | null;
  /** The seller hands it over at a lessor site on this side instead (they ferry it under their own approval). */
  thisSide: { site: string; where: string; fee: number; days: number } | null;
  /** A specialist ferry company flies it to our base under its own approval. */
  ferryCo: { fee: number; days: number; homeBy: Minute };
}
export interface DeliveryStatus {
  phase: 'preparing' | 'handedOver' | 'ferrying' | 'waiting' | 'home';
  site: string; where: string; handover: Minute; homeBy: Minute | null;
  ferryIds: string[]; pilotIds: string[]; ticketIds: string[]; waitingSince: Minute | null; text: string;
}

const wideOf = (typeId: string) => (typeOf(typeId).body === 'wide' ? 1 : 0);
const cityOf = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

// ---------- routing ----------

export type Hop = { from: string; to: string; block: number };
const routes = new Map<string, Hop[] | null>();
/** A direct ferry around closed airspace flies this much further. */
const DETOUR = 1.2;

/** No fuel stop in sanctioned or war-zone states (lessors' and export rules). */
const NO_STOP = new Set(['IR', 'AF', 'LY', 'SD', 'YE', 'SY', 'KP', 'RU', 'BY', 'UA']);
/** Airspace closed to European operators: Russia, Belarus, Ukraine (lat/lon boxes, Baltic states and Finland left out). */
const CLOSED: [number, number, number, number][] = [
  [51.2, 53.9, 23.5, 32.8], [53.9, 55.0, 26.5, 32.8], [55.0, 56.2, 27.5, 32.8], [54.3, 55.3, 19.6, 22.9],
  [45.3, 52.4, 30.0, 40.2], [48.3, 52.4, 24.2, 30.0],
  [50.0, 70.0, 32.0, 60.0], [55.5, 61.0, 28.3, 32.0], [43.3, 50.0, 37.0, 48.0],
  [55.0, 78.0, 60.0, 180.0], [51.5, 55.0, 82.0, 120.0], [53.3, 55.0, 120.0, 130.0], [48.0, 55.0, 130.0, 180.0], [42.6, 48.0, 131.0, 139.0], [45.9, 48.0, 141.6, 145.0],
];
const closedAt = (lat: number, lon: number) => CLOSED.some(([a, b, c, d]) => lat >= a && lat <= b && lon >= c && lon <= d);

/** The great circle a → b enters closed airspace (sampled every 50 nm). Pure. */
export function closedSector(a: string, b: string): boolean {
  const p = AIRPORT_BY_CODE[a];
  const q = AIRPORT_BY_CODE[b];
  if (!p || !q || Math.max(p.lon, q.lon) < 19.6) return false;
  const n = Math.max(2, Math.ceil(distanceNm(a, b) / 50));
  for (let i = 0; i <= n; i++) {
    const [lon, lat] = interpolateGC(p.lon, p.lat, q.lon, q.lat, i / n);
    if (closedAt(lat, lon)) return true;
  }
  return false;
}

/** A ferry sector we may plan: no stop in a sanctioned state; for a European operator, not through closed airspace. */
const sectorOk = (a: string, b: string, europe: boolean) => !NO_STOP.has(AIRPORT_BY_CODE[b]?.country ?? '') && (!europe || !closedSector(a, b));

/**
 * Ferry legs from → to: the fuel-stop router when every leg fits a ferry day (and avoids sanctioned stops and, for
 * a European operator flying home, Russian/Belarusian/Ukrainian airspace), else hops of at most a ferry day's block
 * (10:00) between proper airports, each making progress home (a narrowbody from Jakarta takes several).
 * v0.11 `cap` (etopsCap: our ETOPS approval and the type's capability, 0 = the 60-minute rule): a routing with a leg
 * beyond it goes the long way on stops that keep every leg inside it, as real operators ferry a twin without
 * ETOPS approval (Europe–Keflavík–Iqaluit–Halifax); null when there is none (no 60-minute Pacific crossing). Pure.
 */
export function ferryRoute(typeId: string, from: string, to: string, cap = Infinity): Hop[] | null {
  const key = `${typeId}:${cap}:${from}:${to}`;
  if (routes.has(key)) return routes.get(key)!;
  const max = BAL.delivery.dayBlockMax;
  const europe = AIRPORT_BY_CODE[to]?.continent === 'EU';
  const r0 = route(typeId, from, to);
  let r = r0 && r0.some((l) => l.block > max || !sectorOk(l.from, l.to, europe)) ? null : r0;
  // v0.7.2 a short sector refused only for closed airspace flies one direct hop around it (+20%), not fuel stops.
  if (!r && r0 && r0.every((l) => l.block <= max) && from !== to && !NO_STOP.has(AIRPORT_BY_CODE[to]?.country ?? '')) {
    const block = Math.round(blockMinutes(typeId, from, to) * DETOUR);
    if (distanceNm(from, to) * DETOUR <= maxSectorNm(typeId, from, to) && block <= max) r = [{ from, to, block }];
  }
  if (!r) r = hops(typeId, from, to, max, europe);
  if (cap !== Infinity && (!r || !r.every((l) => withinEtops(typeId, l.from, l.to, cap)))) {
    r = etopsRoute(typeId, from, to, cap, { maxBlock: max, noStop: FERRY_NO_STOP, ok: (a, b) => sectorOk(a, b, europe) }, europe ? 'eu' : '');
  }
  routes.set(key, r);
  return r;
}

/** Stops a ferry never makes: sanctioned states and the war zones insurers won't cover. */
const FERRY_NO_STOP: ReadonlySet<string> = new Set([...NO_STOP, ...NO_STOP_COUNTRY]);

/**
 * v0.11 why there is no ferry from → to: 'No legal ferry to Miami: every way crosses water more than 60 minutes from
 * an airport' when only our ETOPS limit stands in the way, else 'No ferry route to Miami'. Pure.
 */
export function noFerryText(g: GameState, typeId: string, from: string, to: string): string {
  const etops = !!ferryRoute(typeId, from, to) && !ferryRoute(typeId, from, to, ferryCap(g, typeId));
  return etops ? `No legal ferry to ${cityOf(to)}: every way crosses water more than ${capText(ferryCap(g, typeId))} from an airport` : `No ferry route to ${cityOf(to)}`;
}

/** v0.11 the ferry cap for one of our aircraft of this type (etopsCap with the company's approvals). */
export const ferryCap = (g: GameState, typeId: string): number => etopsCap(g.company.approvals, typeId);

function hops(typeId: string, from: string, to: string, max: number, europe: boolean): Hop[] | null {
  if (runwayFit(typeId, from) === 'no' || runwayFit(typeId, to) === 'no') return null;
  const fits = (a: string, b: string) => runwayFit(typeId, b) !== 'no' && distanceNm(a, b) <= maxSectorNm(typeId, a, b) && blockMinutes(typeId, a, b) <= max && sectorOk(a, b, europe);
  const stops = AIRPORTS.filter((x) => x.size >= 3 && runwayFit(typeId, x.code) === 'ok' && !NO_STOP.has(x.country));
  const out: Hop[] = [];
  const seen = new Set([from]);
  let cur = from;
  for (let k = 0; k < 12; k++) {
    if (fits(cur, to)) {
      out.push({ from: cur, to, block: blockMinutes(typeId, cur, to) });
      return out;
    }
    const left = distanceNm(cur, to);
    let best: { code: string; score: number } | null = null;
    // The most progress home; round closed airspace a sideways hop is allowed (never back to a stop already used).
    for (const pass of [200, -600]) {
      for (const x of stops) {
        if (seen.has(x.code) || !fits(cur, x.code)) continue;
        const d = distanceNm(x.code, to);
        if (d >= left - pass) continue;
        // A bigger airport breaks near-ties (hotels, handling).
        const score = d - x.size * 40;
        if (!best || score < best.score || (score === best.score && x.code < best.code)) best = { code: x.code, score };
      }
      if (best || !europe) break;
    }
    if (!best) return null;
    out.push({ from: cur, to: best.code, block: blockMinutes(typeId, cur, best.code) });
    seen.add(best.code);
    cur = best.code;
  }
  return null;
}

/** First ferry departure: acceptance (inspection, records, test flight) after the handover, then 08:00 local at the site. */
export function firstFerryDep(site: string, handover: Minute): Minute {
  const t0 = handover + BAL.delivery.acceptH * 60;
  const local = toLocal(site, t0);
  let d = dayStart(local) + 8 * 60;
  if (d < local) d += DAY;
  return localToUTC(site, d);
}

/** v0.11 ferry days moved to contracts/plan.ts (positioning re-routed round an ETOPS limit uses them too). */
export { ferryDays } from '../contracts/plan';

export const pathText = (legs: { from: string; to: string }[]) => (legs.length ? [legs[0].from, ...legs.map((l) => l.to)].join('–') : '');

// ---------- quote ----------

/** Fuel and fees of ferry legs at today's fuel price. */
export function ferryCost(typeId: string, legs: { block: number }[], fuelPrice: number): { fuel: number; fees: number } {
  const t = typeOf(typeId);
  const fuel = legs.reduce((s, l) => s + (l.block / 60) * t.fuelTBH * fuelPrice, 0);
  return { fuel: Math.round(fuel), fees: legs.length * BAL.airportFees[wideOf(typeId)] };
}

const kmBand = (a: string, b: string) => {
  const km = distanceNm(a, b) * 1.852;
  return km < 1_500 ? 0 : km < 4_000 ? 1 : 2;
};

/** Two pilots: tickets out, hotel nights (the night before and the night stops) and per diem days. */
export function ferryCrewCost(g: GameState, home: string, site: string, legs: DeliveryLeg[]): number {
  if (site === home || !legs.length) return 0;
  const nights = 1 + legs.filter((l) => l.nightStopAfter).length;
  const pct = g.company.policies.perDiemPct / 100;
  const hotel = BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4];
  const ticket = BAL.deadheadTicket[kmBand(home, site)];
  return Math.round(2 * ticket + 2 * nights * hotel + (nights + 1) * (BAL.perDiem.CPT + BAL.perDiem.FO) * pct);
}

/** v0.11 what a crossing needs beyond our cap, in a few words ('the 60-minute way', 'within ETOPS 120'). */
const capWay = (cap: number) => (cap ? `within ETOPS ${cap}` : 'the 60-minute way');

/** Delivery ferry quote from a handover site to home base (legs, days, fuel, fees, crew, the pilots' airline trip out). Pure. */
export function deliveryQuote(g: GameState, typeId: string, site: string, handover: Minute, where?: string): DeliveryQuote {
  const home = g.company.homeBase;
  const w = where ?? `${cityOf(site)} (${site})`;
  if (site === home) {
    return { site, where: w, handover, homeBy: handover, legs: [], days: 0, fuel: 0, fees: 0, crew: 0, total: 0, deadhead: [], text: `Handed over at ${cityOf(home)}: no ferry` };
  }
  // v0.11 inside our ETOPS approval and the type's capability (the 60-minute rule without one).
  const cap = ferryCap(g, typeId);
  const r = ferryRoute(typeId, site, home, cap);
  const usual = cap === Infinity ? r : ferryRoute(typeId, site, home);
  const longWay = !!r && !!usual && pathText(r) !== pathText(usual);
  const legs = r ? ferryDays(r, firstFerryDep(site, handover), typeId) : [];
  const { fuel, fees } = ferryCost(typeId, legs, g.market.fuelPrice);
  const crew = ferryCrewCost(g, home, site, legs);
  const total = fuel + fees + crew;
  // The pilots fly out the evening before (minimum rest before the ferry report).
  let deadhead: CommercialLeg[] = [];
  if (legs.length) {
    const blk = ticketBlock(home, site);
    const sta = Math.floor((legs[0].std - 14 * 60) / 5) * 5;
    deadhead = itinerary(home, site, sta - blk, sta);
  }
  const blocked = !r && usual ? ferryBlock(g, typeId, site, handover, usual, cap) : null;
  const stopsN = legs.filter((l) => l.nightStopAfter).length;
  const text = legs.length
    ? `${pathText(legs)} · ${legs.length} leg${legs.length > 1 ? 's' : ''}${stopsN ? ` · ${stopsN} night stop${stopsN > 1 ? 's' : ''}` : ''}${longWay ? ` · ${capWay(cap)}` : ''} · ≈ ${usd(total)}`
    : blocked ? `No legal ferry home from ${cityOf(site)}: every way crosses water more than ${blocked.capText} from an airport`
    : `No ferry route from ${site} for the ${typeOf(typeId).short}`;
  return {
    site, where: w, handover, homeBy: legs.length ? legs[legs.length - 1].sta : handover, legs,
    days: legs.length ? 1 + stopsN : 0, fuel, fees, crew, total, deadhead, text, cap, longWay, blocked,
  };
}

/** Days a ferry of these legs takes from its first departure to its last landing (whole days, at least one). */
const daysOf = (legs: DayLeg[]) => (legs.length ? Math.max(1, Math.ceil((legs[legs.length - 1].sta - legs[0].std) / DAY)) : 0);

/** What a ferry company (or the seller) charges to fly these legs under its own approval. */
function companyFee(typeId: string, legs: DayLeg[], fuelPrice: number): number {
  const F = BAL.delivery.ferryCo;
  const { fuel, fees } = ferryCost(typeId, legs, fuelPrice);
  return Math.round(((fuel + fees) * F.margin + daysOf(legs) * F.dayRate[wideOf(typeId)] + F.permits) / 1000) * 1000;
}

/**
 * v0.11 a delivery we may not ferry home on our certificate: the usual way and its worst leg, the approval that
 * would open it, a handover at a lessor site on this side (the nearest one with a legal ferry home), or a ferry
 * company to our base. Pure.
 */
function ferryBlock(g: GameState, typeId: string, site: string, handover: Minute, usual: Hop[], cap: number): FerryBlock {
  const home = g.company.homeBase;
  const worstLeg = usual.map((l) => ({ from: l.from, to: l.to, min: Math.round(etopsMinutes(typeId, l.from, l.to)) })).sort((a, b) => b.min - a.min)[0];
  const F = BAL.delivery.ferryCo;
  const first = firstFerryDep(site, handover);
  const coLegs = ferryDays(usual, first, typeId);
  const coDays = daysOf(coLegs) + F.extraDays;
  const sites = LESSOR_SITES.filter((x) => AIRPORT_BY_CODE[x.code] && x.code !== site && ferryRoute(typeId, x.code, home, cap))
    .map((x) => ({ x, r: ferryRoute(typeId, site, x.code) }))
    .filter((y): y is { x: (typeof LESSOR_SITES)[number]; r: Hop[] } => !!y.r)
    .sort((a, b) => a.r.reduce((n, l) => n + l.block, 0) - b.r.reduce((n, l) => n + l.block, 0) || (a.x.code < b.x.code ? -1 : 1));
  let thisSide: FerryBlock['thisSide'] = null;
  if (sites.length) {
    const { x, r } = sites[0];
    const sl = ferryDays(r, first, typeId);
    thisSide = { site: x.code, where: `${x.name}, ${x.city} (${x.code})`, fee: companyFee(typeId, sl, g.market.fuelPrice), days: daysOf(sl) + F.extraDays };
  }
  return {
    usual: pathText(usual), worst: worstLeg, capText: capText(cap),
    approval: approvalThatWorks(g, typeId, (c) => !!ferryRoute(typeId, site, home, c)),
    thisSide, ferryCo: { fee: companyFee(typeId, coLegs, g.market.fuelPrice), days: coDays, homeBy: handover + coDays * DAY },
  };
}

// ---------- planning and execution ----------

/** Plans the delivery ferry chain (ferry legs, purpose 'delivery') from the handover site home; [] when none. */
export function planDeliveryFerry(g: GameState, aircraftId: string): Flight[] {
  const ac = g.fleet[aircraftId];
  const dl = ac?.delivery;
  if (!ac || !dl || dl.site === g.company.homeBase) return [];
  const r = ferryRoute(ac.typeId, dl.site, g.company.homeBase, ferryCap(g, ac.typeId));
  if (!r) return [];
  const legs = ferryDays(r, firstFerryDep(dl.site, dl.handover), ac.typeId);
  const out = legs.map((l) => {
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId, contractId: null, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
    f.purpose = 'delivery';
    return f;
  });
  dl.ferryIds = out.map((f) => f.id);
  return out;
}

const ferries = (g: GameState, ac: Aircraft): Flight[] =>
  (ac.delivery?.ferryIds ?? []).map((id) => g.flights[id]).filter((f): f is Flight => !!f);

/** The pilots on the ferry legs' trips, and their airline tickets before the first of the legs. */
export function ferryCrew(g: GameState, legs: Flight[]): { pilotIds: string[]; ticketIds: string[] } {
  const pilots = new Set<string>();
  const tickets = new Set<string>();
  const pairings = new Set<string>();
  for (const f of legs) {
    const d = f.dutyId ? g.duties[f.dutyId] : undefined;
    if (d) pairings.add(d.pairingId);
  }
  const first = legs[0]?.std ?? Infinity;
  for (const pid of pairings) {
    const p = g.pairings[pid];
    if (!p) continue;
    for (const s of p.slots) if (s.crewId && isPilot(s.role)) pilots.add(s.crewId);
    for (const did of p.dutyIds) {
      for (const tid of g.duties[did]?.deadheadIds ?? []) {
        const t = g.flights[tid];
        if (t && t.kind === 'deadhead' && t.std < first) tickets.add(tid);
      }
    }
  }
  return { pilotIds: [...pilots], ticketIds: [...tickets] };
}

/** Delivery progress for the Fleet card and the map. Pure. */
export function deliveryStatus(g: GameState, aircraftId: string): DeliveryStatus | null {
  const ac = g.fleet[aircraftId];
  const dl = ac?.delivery;
  if (!ac || !dl) return null;
  const fs = ferries(g, ac);
  const homeBy = fs.length ? Math.max(...fs.map((f) => f.ata ?? f.eta ?? f.sta)) : dl.arrived ?? null;
  const { pilotIds, ticketIds } = ferryCrew(g, fs);
  const phase: DeliveryStatus['phase'] = dl.arrived !== undefined ? 'home'
    : ac.status === 'delivering' ? 'preparing'
    : fs.some((f) => f.status === 'enroute' || f.status === 'done') ? 'ferrying'
    : dl.waitingSince !== undefined ? 'waiting' : 'handedOver';
  const city = cityOf(dl.site);
  const names = pilotIds.map((id) => g.crew[id]?.last).filter(Boolean).join(', ');
  const last = fs[fs.length - 1];
  const text = phase === 'home' ? `Delivered ${fmtDay(dl.arrived!)}`
    : phase === 'preparing' ? `Handover at ${city} ${fmtDay(dl.handover)}${fs.length ? ` → ferry ${fmtDay(fs[0].std)}${fmtDay(last.sta) !== fmtDay(fs[0].std) ? `–${fmtDay(last.sta)}` : ''} → ${cityOf(g.company.homeBase)}` : ''}`
    : phase === 'waiting' ? `Waiting at ${city} since ${fmtDay(dl.waitingSince!)}: no rated pilots (parking ${usd(BAL.delivery.parkPerDay[wideOf(ac.typeId)])}/day)`
    : phase === 'ferrying' ? `Delivery ferry ${pathText(fs)} · leg ${Math.min(fs.length, fs.filter((f) => f.status === 'done').length + 1)} of ${fs.length}`
    : `Handed over at ${city} · ferry home ${fs.length ? `${fmtDay(fs[0].std)} ${fmtTime(fs[0].std, dl.site)} local` : 'not planned'}`;
  return {
    phase, site: dl.site, where: dl.where, handover: dl.handover, homeBy, ferryIds: fs.map((f) => f.id), pilotIds, ticketIds,
    waitingSince: dl.waitingSince ?? null, text: names && phase !== 'home' ? `${text} · pilots ${names}` : text,
  };
}

const PURPOSE_CREW: Record<NonNullable<Flight['purpose']>, string> = {
  delivery: 'Delivery crew', return: 'Lease return crew', refit: 'Refit ferry crew', check: 'C-check ferry crew', sale: 'Sale ferry crew', lease: 'Dry-lease ferry crew',
};

/** Why our crew ride this airline ticket (map panel, roster detail). Pure. */
export function ticketPurpose(g: GameState, ticketId: string): { kind: 'delivery' | 'return' | 'refit' | 'check' | 'sale' | 'lease' | 'duty' | 'home'; aircraftId?: string; text: string } {
  const t = g.flights[ticketId];
  if (!t || t.kind !== 'deadhead') return { kind: 'duty', text: '' };
  const did = crewIx(g).ticketDuty.get(ticketId);
  const d = did ? g.duties[did] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) return { kind: 'home', text: `Going home to ${cityOf(t.to)}` };
  const flights = p.dutyIds.flatMap((id) => g.duties[id]?.flightIds ?? []).map((id) => g.flights[id]).filter((f): f is Flight => !!f);
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const pf = flights.find((f) => f.purpose);
  // v0.7.2 C-check ferries: the pilots fly home after the ferry out, and back out for the ferry home.
  if (pf?.purpose === 'check') {
    const legs = flights.filter((f) => f.purpose === 'check');
    const out = legs[0].from === g.company.homeBase || t.std >= Math.max(...legs.map((f) => f.sta));
    return out
      ? { kind: 'check', aircraftId: ac?.id, text: `Home after ferrying ${ac?.reg ?? 'our aircraft'} to ${cityOf(legs[legs.length - 1].to)} for its C-check` }
      : { kind: 'check', aircraftId: ac?.id, text: `Out to ${cityOf(legs[0].from)} to ferry ${ac?.reg ?? 'our aircraft'} home after its C-check` };
  }
  if (flights.length && t.std >= Math.max(...flights.map((f) => f.sta))) return { kind: 'home', aircraftId: ac?.id, text: `Going home to ${cityOf(t.to)} after the trip` };
  if (pf?.purpose) {
    const legs = flights.filter((f) => f.purpose === pf.purpose);
    const what = PURPOSE_CREW[pf.purpose];
    return { kind: pf.purpose, aircraftId: ac?.id, text: `${what} for ${ac?.reg ?? 'our aircraft'} · ferry ${legs[0].from}–${legs[legs.length - 1].to} ${fmtDay(legs[0].std)}` };
  }
  const first = g.flights[d.flightIds[0]];
  // v0.7.1: a chartered jet names itself.
  if (t.charter) return { kind: 'duty', aircraftId: ac?.id, text: first ? `Private jet for ${first.no} · ${t.charter.model} (${t.charter.operator})` : `Private jet · ${t.charter.model} (${t.charter.operator})` };
  return { kind: 'duty', aircraftId: ac?.id, text: first ? `Positioning for ${first.no} ${first.from}–${first.to} ${fmtDay(first.std)}` : 'Positioning for a duty' };
}

/** Handover message (aircraft.delivery at a site abroad). */
export function handoverMessage(g: GameState, ac: Aircraft): void {
  const dl = ac.delivery!;
  const fs = ferries(g, ac).filter((f) => f.status === 'scheduled');
  const { pilotIds, ticketIds } = ferryCrew(g, fs);
  const cpt = pilotIds.map((id) => g.crew[id]).find((c) => c?.role === 'CPT');
  const fo = pilotIds.map((id) => g.crew[id]).find((c) => c?.role === 'FO');
  const tk = ticketIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f).sort((a, b) => b.sta - a.sta)[0];
  const lastLeg = tk ? commercialItinerary(g, tk).at(-1) : undefined;
  const crew = cpt && fo
    ? ` Captain ${cpt.last} and FO ${fo.last}${lastLeg ? ` ${tk!.sta <= g.now ? 'arrived' : 'arrive'} on ${lastLeg.no}` : ' are rostered'}.`
    : ' No rated pilots are rostered yet.';
  const block = fs.reduce((s, f) => s + f.block, 0);
  const when = fs.length ? (dayStart(toLocal(dl.site, fs[0].std)) === dayStart(toLocal(dl.site, g.now)) + DAY ? 'tomorrow' : fmtDay(fs[0].std)) : '';
  pushMessage(g, {
    tone: 'info', cat: 'company', title: `${ac.reg} handed over at ${cityOf(dl.site)}`,
    body: fs.length
      ? `Ferry home ${when} ${fmtTime(fs[0].std, dl.site)} local: ${pathText(fs)}, ${fs.length} leg${fs.length > 1 ? 's' : ''}, ${fmtDuration(block)} block (${ferryRuleText(g, ac.typeId, fs)}).${crew}`
      : `The ${typeOf(ac.typeId).name} is on the AOC.`,
    // v0.9.1 a delivery is a big event: two LOs, the celebration card and 'Follow the delivery flight?' (UI).
    ref: { kind: 'aircraft', id: ac.id }, cue: 'delivered',
  });
}

/** v0.11 the ETOPS rule the ferry flies under, in words: 'every leg within 60 minutes of an airport'. */
export function ferryRuleText(g: GameState, typeId: string, legs: { from: string; to: string }[]): string {
  const t = typeOf(typeId);
  if (t.engines !== 2) return 'four engines: no ETOPS limits';
  const need = Math.max(0, ...legs.map((f) => etopsNeeded(typeId, f.from, f.to)));
  if (need) return `within our ETOPS ${heldEtops(g.company.approvals)} approval`;
  const usual = legs.length ? ferryRoute(typeId, legs[0].from, legs[legs.length - 1].to) : null;
  const long = !!usual && pathText(usual) !== pathText(legs);
  return `every leg within 60 minutes of an airport${long ? ': the long way round, as the direct way needs more ETOPS than we may fly' : ''}`;
}

/** 'flight.arr' of a delivery ferry: the last leg home ends the delivery. */
export function onDeliveryArr(g: GameState, f: Flight): void {
  if (f.purpose !== 'delivery' || !f.aircraftId) return;
  const ac = g.fleet[f.aircraftId];
  const dl = ac?.delivery;
  if (!ac || !dl || dl.arrived !== undefined || f.to !== g.company.homeBase) return;
  const fs = ferries(g, ac);
  if (fs.some((x) => x.status === 'scheduled' || x.status === 'enroute')) return;
  dl.arrived = g.now;
  const flown = fs.filter((x) => x.status === 'done');
  const { fuel, fees } = ferryCost(ac.typeId, flown.map((x) => ({ block: (x.ata ?? x.sta) - (x.atd ?? x.std) })), g.market.fuelPrice);
  const tickets = ferryCrew(g, flown).ticketIds.reduce((s, id) => s + (g.flights[id]?.cost ?? 0), 0);
  const days = Math.max(1, Math.round((dayStart(g.now) - dayStart(flown[0]?.atd ?? g.now)) / DAY) + 1);
  const nights = 1 + flown.filter((x, i) => i > 0 && (x.atd ?? x.std) - (flown[i - 1].ata ?? flown[i - 1].sta) > 8 * 60).length;
  const crew = tickets + 2 * nights * (BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4]);
  pushMessage(g, {
    tone: 'good', cat: 'company', title: `${ac.reg} is home`,
    body: `Delivered to ${cityOf(g.company.homeBase)} after ${days} day${days > 1 ? 's' : ''} of ferry flying (${usd(fuel + fees)} fuel and fees, crew costs ${usd(crew)}).`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}

/** 'flight.dep' of a delivery ferry: the wait (if any) is over. */
export function onDeliveryDep(g: GameState, f: Flight): void {
  if (f.purpose !== 'delivery' || f.status !== 'enroute' || !f.aircraftId) return;
  const dl = g.fleet[f.aircraftId]?.delivery;
  if (!dl || dl.waitingSince === undefined) return;
  g.stats.deliveryWaitDays = (g.stats.deliveryWaitDays ?? 0) + Math.max(1, Math.round((g.now - dl.waitingSince) / DAY));
  delete dl.waitingSince;
}

/**
 * No legal crew at a delivery ferry's departure: never cancelled. The rest of the chain moves 24 h (or the days pilots
 * from base need to get there and rest); the aircraft
 * waits at the site (parking charged daily) and the roster tries again. Returns the moved legs.
 */
export function deliveryWaitDay(g: GameState, f: Flight, ac: Aircraft): Flight[] {
  const chain = ferries(g, ac).filter((x) => x.status === 'scheduled' && x.std >= f.std);
  if (!chain.includes(f)) chain.unshift(f);
  // Whole days, and at least long enough for pilots from base to fly out and rest (Santiago is a day away).
  const reach = g.now + ticketBlock(g.company.homeBase, f.from) + BAL.deadheadCheckIn + 16 * 60;
  const shift = Math.max(1, Math.ceil((reach - f.std) / DAY)) * DAY;
  // Re-spaced as ferry days from the new start (night stops long enough for the rest: a chain planned too tight,
  // e.g. in an older save, would otherwise wait for ever).
  chain.sort((a, b) => a.std - b.std);
  const legs = ferryDays(chain.map((x) => ({ from: x.from, to: x.to, block: x.sta - x.std })), chain[0].std + shift, ac.typeId);
  chain.forEach((x, i) => retimeFlight(g, x, legs[i].std, legs[i].sta));
  if (ac.delivery) ac.delivery.waitingSince ??= g.now;
  return chain;
}

/** Daily: the 48 h no-pilots warning and parking while a delivered aircraft waits for its pilots. */
export function dailyDelivery(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    const dl = ac.delivery;
    if (!dl || dl.arrived !== undefined) continue;
    const fs = ferries(g, ac).filter((f) => f.status === 'scheduled');
    if (!fs.length) {
      // Handed over, not home and no ferry left (its legs were lost): a new ferry from where the aircraft is.
      if (ac.status !== 'delivering' && !ac.flightId && !ferries(g, ac).some((f) => f.status === 'enroute')) replanFerry(g, ac);
      continue;
    }
    const first = fs[0];
    if (dl.waitingSince !== undefined && ac.status !== 'delivering') post(g, 'airportFees', -BAL.delivery.parkPerDay[wideOf(ac.typeId)]);
    if (!dl.warned && first.std - g.now <= BAL.delivery.warnH * 60 && first.std > g.now && !pilotsOn(g, first)) {
      dl.warned = true;
      // Contract work booked soon after the ferry is due home moves behind it while it waits (a leg more than 6 h
      // late is dropped): said now, before the first day's wait.
      const home = fs[fs.length - 1].sta;
      const work = liveFlightsOf(g, ac.id).find((f) => f.contractId && !f.purpose && f.std >= home && f.std < home + 3 * DAY);
      pushMessage(g, {
        tone: 'warn', cat: 'crew', title: `Delivery ferry ${ac.reg} has no rated pilots`,
        body: `No ${typeOf(ac.typeId).short}-rated captain and first officer are free on ${fmtDate(first.std)}. The aircraft waits at ${cityOf(dl.site)} until they are (parking ${usd(BAL.delivery.parkPerDay[wideOf(ac.typeId)])}/day). Hire rated pilots or book a conversion.` +
          (work ? ` Contract work from ${fmtDay(work.std)} (${work.no} ${work.from}–${work.to}) waits behind the ferry: legs that would leave more than 6 h late are dropped.` : ''),
        ref: { kind: 'aircraft', id: ac.id },
        problem: { kind: 'deliveryWait', ref: { kind: 'aircraft', id: ac.id } }, hurt: { money: BAL.delivery.parkPerDay[wideOf(ac.typeId)] * 7, pax: 0, delayMin: 0, level: 'low' },
      });
    }
  }
}

/**
 * v0.11 load: a delivery ferry planned before the ETOPS rule (the old one-off 'ferry permit' straight across an
 * ocean) is re-planned from its first leg not yet flown, the way the rule allows, keeping that leg's departure time.
 * Left as planned once a leg of it is in the air, or when there is no legal way (it flies as it was agreed). A fresh
 * game never plans such a ferry (approvals are never taken away), so this changes nothing there.
 */
export function loadEtopsFerries(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    const dl = ac.delivery;
    if (!dl || dl.arrived !== undefined) continue;
    const fs = ferries(g, ac);
    if (fs.some((f) => f.status === 'enroute')) continue;
    const left = fs.filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);
    const cap = ferryCap(g, ac.typeId);
    if (!left.length || left.every((f) => withinEtops(ac.typeId, f.from, f.to, cap))) continue;
    const r = ferryRoute(ac.typeId, left[0].from, g.company.homeBase, cap);
    if (!r) continue;
    const legs = ferryDays(r, left[0].std, ac.typeId);
    removeFlights(g, left.map((f) => f.id));
    const out = legs.map((l) => {
      const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
      f.purpose = 'delivery';
      return f;
    });
    dl.ferryIds = [...dl.ferryIds.filter((id) => g.flights[id]?.status === 'done'), ...out.map((f) => f.id)];
  }
}

/** A new delivery ferry from where the aircraft is (from 08:00 local tomorrow); at home base the delivery ends. */
function replanFerry(g: GameState, ac: Aircraft): void {
  const dl = ac.delivery!;
  const home = g.company.homeBase;
  if (ac.at === home) {
    dl.arrived = g.now;
    return;
  }
  const r = ferryRoute(ac.typeId, ac.at, home, ferryCap(g, ac.typeId));
  if (!r) return;
  const local = toLocal(ac.at, g.now + 12 * 60);
  const legs = ferryDays(r, localToUTC(ac.at, dayStart(local) + 8 * 60 + (local - dayStart(local) > 8 * 60 ? DAY : 0)), ac.typeId);
  const out = legs.map((l) => {
    const f = addFlight(g, { no: ownFlightNo(g), aircraftId: ac.id, contractId: null, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
    f.purpose = 'delivery';
    return f;
  });
  dl.ferryIds = [...dl.ferryIds.filter((id) => g.flights[id]?.status === 'done'), ...out.map((f) => f.id)];
  dl.waitingSince ??= g.now;
  pushMessage(g, {
    tone: 'warn', cat: 'ops', title: `Delivery ferry re-planned: ${ac.reg}`,
    body: `${ac.reg} is still at ${cityOf(ac.at)}. New ferry home ${fmtDay(out[0].std)}: ${pathText(legs)}.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}

/** A captain and a first officer (and any relief pilot) are on the leg's duty. */
function pilotsOn(g: GameState, f: Flight): boolean {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!p) return false;
  return p.slots.filter((s) => isPilot(s.role)).every((s) => !!s.crewId);
}
