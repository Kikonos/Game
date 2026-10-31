// Ops Map (B4): pure helpers (no React, no DOM) so they can be unit-tested. Sun and terminator,
// parked fan-out, selected-aircraft legs, offer pins, fit area, hit picking and chip text.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from '../../engine/core/entities';
import { haversine } from '../../engine/core/geo';
import { isPilot } from '../../engine/core/perf';
import { flightTimes } from '../../engine/core/query';
import { DAY, fmtDay, fmtTime, fmtWeekdayTime } from '../../engine/core/time';
import type { AcRest, Aircraft, Archetype, ContractOffer, CrewMember, Flight, GameState, Minute, OohLimit, Ref, RestFacility, RestKind, WorldEventKind } from '../../engine/core/types';
import { type CrewAlertKind, crewAway, LIMIT_NAME, shortFlights, type SlipView } from '../../engine/crew';
import { clientCode, clientLivery, clientTitles, commercialFlightsBetween, type CommercialFlight, commercialItinerary, dryLeaseOf, type FlightType, flightType, liveryOf, type ResolvedLivery } from '../../engine/ops';
import { contractColor } from '../screens/palette';
import type { MapRoute } from './WorldMap';

/**
 * v0.12.1 the route line of each world tour under way, or starting within three days: its passenger legs in order,
 * flown ones solid, the rest dashed, in the contract's colour (the Ops Map draws them under the aircraft). Pure.
 */
export function tourRoutes(g: GameState): MapRoute[] {
  const out: MapRoute[] = [];
  for (const k of Object.values(g.contracts)) {
    if (k.archetype !== 'worldTour' || (k.status !== 'active' && k.status !== 'signed') || k.start > g.now + 3 * DAY || k.pattern.kind !== 'legs') continue;
    const done = new Set<string>();
    for (const f of Object.values(g.flights)) if (f.contractId === k.id && f.kind === 'revenue' && (f.status === 'done' || f.status === 'enroute')) done.add(`${f.from}-${f.to}`);
    [...k.pattern.legs].sort((a, b) => a.dep - b.dep).forEach((l, i) => {
      // Flown legs older than a week are pruned with their flights: anything before now counts as flown.
      const flown = done.has(`${l.from}-${l.to}`) || l.dep < g.now - 6 * 60;
      out.push({ id: `tour:${k.id}:${i}`, from: l.from, to: l.to, weight: 0.45, color: contractColor(k.color), dashed: !flown });
    });
  }
  return out;
}

/** v0.7.1 business-jet glyph (24 × 24, nose up, same frame as PLANE_PATH): slim body, swept wings, T-tail. */
export const JET_PATH = 'M12 1.2c.65 0 1.15.95 1.15 2.1v6.4l7.6 6.2v1.6l-7.6-2.9v5.4h2.9v1.5h-3.1l-.95 1.3-.95-1.3h-3.1v-1.5h2.9v-5.4l-7.6 2.9v-1.6l7.6-6.2V3.3C10.85 2.15 11.35 1.2 12 1.2z';

const RAD = Math.PI / 180;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

// ---------- sun & terminator ----------

/** Subsolar point [lon, lat] in degrees at game minute t (low-precision almanac, ~0.01°). */
export function sunPoint(t: number): [number, number] {
  // Game minutes count from 1 Jan 2000 00:00 UTC; J2000.0 is 12:00 that day.
  const n = t / 1440 - 0.5;
  const L = 280.46 + 0.9856474 * n;
  const gA = (357.528 + 0.9856003 * n) * RAD;
  const lam = (L + 1.915 * Math.sin(gA) + 0.02 * Math.sin(2 * gA)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lam)) / RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)) / RAD;
  const gmst = 280.46061837 + 360.98564736629 * n;
  return [wrap180(ra - gmst), dec];
}

/** Sun elevation (degrees) at [lon, lat] for a subsolar point. */
export function sunElevation(sun: [number, number], lon: number, lat: number): number {
  const [ls, d] = sun;
  const s = Math.sin(lat * RAD) * Math.sin(d * RAD) + Math.cos(lat * RAD) * Math.cos(d * RAD) * Math.cos((lon - ls) * RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

/**
 * The terminator as one latitude per longitude from −180 to 180 (inclusive, `step` degrees), clamped
 * to ±maxLat, plus which pole lies in the night. On a cylindrical map the night polygon is this
 * line closed along the night-side edge.
 */
export function terminator(sun: [number, number], step = 3, maxLat = 85): { pts: [number, number][]; northNight: boolean } {
  let d = sun[1];
  if (Math.abs(d) < 0.05) d = d < 0 ? -0.05 : 0.05; // equinox: near-vertical edges, never a division by zero
  const tanD = Math.tan(d * RAD);
  const pts: [number, number][] = [];
  for (let lon = -180; lon <= 180 + 1e-9; lon += step) {
    const lat = Math.atan(-Math.cos((lon - sun[0]) * RAD) / tanD) / RAD;
    pts.push([lon, Math.max(-maxLat, Math.min(maxLat, lat))]);
  }
  return { pts, northNight: d < 0 };
}

// ---------- geometry ----------

/** Glyph rotation (degrees, 0 = nose up) for travel from screen point p to q. */
export function headingDeg(p: [number, number], q: [number, number], wrapW = Infinity): number {
  let dx = q[0] - p[0];
  if (Math.abs(dx) > wrapW / 2) dx -= Math.sign(dx) * wrapW; // antimeridian
  return (Math.atan2(q[1] - p[1], dx) * 180) / Math.PI + 90;
}

/** Shortest-way angle interpolation. */
export function lerpAngle(a: number, b: number, f: number): number {
  const d = wrap180(b - a);
  return a + d * f;
}

export const PARK_PER_ROW = 5;
export const PARK_GAP = 26;

/** Screen-px offset of the i-th of n aircraft parked at one airport: stands in rows of 5 right of the dot. */
export function parkOffset(i: number, n: number): [number, number] {
  const rows = Math.ceil(Math.max(1, n) / PARK_PER_ROW);
  const row = Math.floor(i / PARK_PER_ROW);
  const col = i % PARK_PER_ROW;
  return [24 + col * PARK_GAP, (row - (rows - 1) / 2) * PARK_GAP];
}

/** v0.14 an aircraft's footprint on its stand (screen px): span `w` (at least its label's width), length `h`, and the
 *  depth of the labels under it (`lh`, default the layout's `labelH`). */
export interface StandSize { w: number; h: number; lh?: number }

/**
 * v0.14 stands to scale at one airport: in rows of PARK_PER_ROW right of the dot, each stand as wide as its aircraft
 * (a 747 takes the room of two A320s), rows as deep as their longest aircraft plus `labelH` for the reg under it, the
 * block centred on the dot's height. Offsets of each aircraft's centre (screen px). Pure.
 */
export function standOffsets(sizes: StandSize[], labelH: number, gap = 4, x0 = 13): [number, number][] {
  const rows: StandSize[][] = [];
  for (let i = 0; i < sizes.length; i += PARK_PER_ROW) rows.push(sizes.slice(i, i + PARK_PER_ROW));
  const lab = rows.map((r) => Math.max(...r.map((z) => z.lh ?? labelH)));
  const depth = rows.map((r, i) => Math.max(...r.map((z) => z.h)) + lab[i]);
  const total = depth.reduce((a, b) => a + b, 0) + gap * Math.max(0, rows.length - 1);
  const out: [number, number][] = [];
  let top = -total / 2;
  rows.forEach((r, ri) => {
    const cy = top + (depth[ri] - lab[ri]) / 2;
    let x = x0;
    for (const z of r) {
      out.push([x + z.w / 2, cy]);
      x += z.w + gap;
    }
    top += depth[ri] + gap;
  });
  return out;
}

/**
 * v0.14 the mark shown beside our aircraft on the map: the registration without the company's registry prefix
 * ('CS-TTL' → 'TTL', 'N801BH' → '801BH'), the way crews and ops name a tail; every aircraft of ours shares the prefix,
 * so it adds width, not information. A reg from another registry keeps its prefix. Pure.
 */
export function regMark(reg: string, prefix: string): string {
  if (prefix && reg.startsWith(prefix) && reg.length > prefix.length) return reg.slice(prefix.length);
  return reg;
}

/** Nearest item within radius r (same units as x/y), or undefined. */
export function pickNearest<T>(items: Iterable<{ x: number; y: number; item: T }>, x: number, y: number, r: number): T | undefined {
  let best: T | undefined;
  let bd = r * r;
  for (const it of items) {
    const d = (it.x - x) ** 2 + (it.y - y) ** 2;
    if (d <= bd) { bd = d; best = it.item; }
  }
  return best;
}

// ---------- selection data ----------

export interface LegArc {
  id: string;
  from: string;
  to: string;
  current: boolean;
  /** Empty legs (positioning, ferry) are dashed. */
  dashed: boolean;
  /** Contract colour, or null for non-contract legs. */
  color: string | null;
}

/** Arcs for the selected aircraft: the leg it is flying (if any) and its next `n` scheduled legs; a v0.7 ferry chain
 * (delivery, lease return, refit) is drawn whole, night stops included. */
export function selectedLegs(g: GameState, aircraftId: string, n = 3): LegArc[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  const arc = (f: Flight, current: boolean): LegArc => {
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    return { id: f.id, from: f.from, to: f.to, current, dashed: f.kind === 'positioning' || f.kind === 'ferry', color: c ? contractColor(c.color) : null };
  };
  const out: LegArc[] = [];
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (cur) out.push(arc(cur, true));
  let last: Flight | undefined = cur;
  for (const f of flightsOf(g, aircraftId)) {
    if (f.status !== 'scheduled' || f.id === cur?.id || !AIRPORT_BY_CODE[f.from] || !AIRPORT_BY_CODE[f.to]) continue;
    // Past n legs only while the last one's ferry chain goes on.
    if (out.length >= n + (cur ? 1 : 0) && !(last?.purpose && f.purpose === last.purpose)) break;
    out.push(arc(f, false));
    last = f;
  }
  return out;
}

// ---------- v0.7 deliveries, refits, lease returns ----------

/** Drawn on the map: an aircraft still being built or prepared for handover (status 'delivering') is not. */
export const onMap = (ac: Aircraft) => ac.status !== 'delivering' || !!ac.flightId;

/** Static DELIVERY tag: handed over abroad, until it is home (deliveryStatus phase handedOver | waiting | ferrying). */
export const deliveryTag = (ac: Aircraft) => !!ac.delivery && ac.delivery.arrived === undefined && ac.status !== 'delivering';

export const PURPOSE_LABEL: Record<NonNullable<Flight['purpose']>, string> = { delivery: 'Delivery ferry', return: 'Lease return ferry', refit: 'Refit ferry', check: 'C-check ferry', sale: 'Sale ferry', lease: 'Dry-lease ferry' };

/** The ferry chain a purpose leg belongs to (delivery, lease return, refit, C-check or sale ferry legs, in order); [f] when unknown. */
export function purposeChain(g: GameState, f: Flight): Flight[] {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  let ids: string[] | undefined;
  if (f.purpose === 'delivery') ids = ac?.delivery?.ferryIds;
  else if (f.purpose === 'return') ids = ac?.returning?.ferryIds;
  else if (f.purpose === 'refit') ids = Object.values(g.maintenance).find((m) => m.aircraftId === f.aircraftId && m.ferryIds?.includes(f.id))?.ferryIds;
  else if (f.purpose === 'check') {
    // v0.7.2 C-check at an MRO hub: the ferry out and the ferry home are separate chains.
    const m = Object.values(g.maintenance).find((x) => x.aircraftId === f.aircraftId && (x.ferryIds?.includes(f.id) || x.homeIds?.includes(f.id)));
    ids = m?.homeIds?.includes(f.id) ? m.homeIds : m?.ferryIds;
  } else if (f.purpose === 'sale') ids = ac?.sale?.ferryIds;
  const legs = (ids ?? []).map((id) => g.flights[id]).filter((x): x is Flight => !!x).sort((a, b) => a.std - b.std);
  return legs.some((x) => x.id === f.id) ? legs : [f];
}

/** Our aircraft waiting at their handover site (not yet ferried out), for the airport panel. */
export function awaitingDelivery(g: GameState, code: string): Aircraft[] {
  return Object.values(g.fleet).filter((ac) => {
    const dl = ac.delivery;
    if (!dl || dl.arrived !== undefined || dl.site !== code || ac.at !== code || ac.flightId) return false;
    return !dl.ferryIds.some((id) => g.flights[id]?.status === 'done');
  });
}

/** Scheduled legs of an aircraft from now on (std order). */
export function upcomingLegs(g: GameState, aircraftId: string, n: number): Flight[] {
  const out: Flight[] = [];
  for (const f of flightsOf(g, aircraftId)) {
    if (f.status === 'scheduled') out.push(f);
    if (out.length >= n) break;
  }
  return out;
}

/** Next n departures fleet-wide, after game minute `after` (legs already due between emits drop out). */
export function upNext(g: GameState, n = 3, after = -Infinity): Flight[] {
  const all: Flight[] = [];
  for (const id of Object.keys(g.fleet)) for (const f of upcomingLegs(g, id, n + 1)) if (f.std + f.delay > after) all.push(f);
  return all.sort((a, b) => a.std + a.delay - (b.std + b.delay)).slice(0, n);
}

// ---------- flight types (v0.5.2) ----------

/** Map stroke per flight type: colour (a theme token: set it as a style, not an SVG attribute), dash (screen px; '' = solid) and width (screen px). */
export const TYPE_STROKE: Record<FlightType, { color: string; dash: string; width: number }> = {
  operating: { color: 'var(--path-operating)', dash: '', width: 1.8 },
  positioning: { color: 'var(--path-positioning)', dash: '2 5', width: 1.8 },
  ferry: { color: 'var(--path-positioning)', dash: '2 5', width: 1.8 },
  deadhead: { color: 'var(--path-deadhead)', dash: '1.5 4', width: 1.1 },
};

/** Selection id of an airline leg on the map (a Ref of kind 'flight'): `${ticketId}:${legIndex}`. */
export const isCommercialId = (id: string) => /:\d+$/.test(id);
export function parseCommercialId(id: string): { ticketId: string; legIndex: number } | null {
  const m = /^(.*):(\d+)$/.exec(id);
  return m ? { ticketId: m[1], legIndex: Number(m[2]) } : null;
}

/**
 * One entry per airline flight: crew on separate tickets for the same flight (same number, route and
 * departure) share one icon, row and panel. Keeps the first id (input order); crew merged in order.
 */
export function groupCommercial(list: CommercialFlight[]): CommercialFlight[] {
  const by = new Map<string, CommercialFlight>();
  for (const cf of list) {
    const k = `${cf.leg.no}|${cf.leg.from}|${cf.leg.dep}`;
    const hit = by.get(k);
    if (!hit) by.set(k, { ...cf, crewIds: [...cf.crewIds] });
    else for (const id of cf.crewIds) if (!hit.crewIds.includes(id)) hit.crewIds.push(id);
  }
  return [...by.values()];
}

/** The airline flight a map selection id points at, with every ticket's crew on it (null once the ticket is gone). */
export function commercialById(g: GameState, id: string): CommercialFlight | null {
  const ref = parseCommercialId(id);
  const ticket = ref ? g.flights[ref.ticketId] : undefined;
  const leg = ticket && ref ? commercialItinerary(g, ticket)[ref.legIndex] : undefined;
  if (!ticket || !leg || !ref) return null;
  const same = commercialFlightsBetween(g, leg.dep, leg.arr).filter((c) => c.leg.no === leg.no && c.leg.from === leg.from && c.leg.dep === leg.dep);
  const crewIds = [...ticket.crewIds];
  for (const c of same) for (const x of c.crewIds) if (!crewIds.includes(x)) crewIds.push(x);
  return { id, ticketId: ticket.id, leg, legIndex: ref.legIndex, legCount: commercialItinerary(g, ticket).length, crewIds };
}

export interface NextRow {
  id: string;
  /** Departure (game minutes, delay included). */
  t: Minute;
  /** Registration (our aircraft), airline flight number (deadhead) or jet type (private jet). */
  who: string;
  from: string;
  to: string;
  type: FlightType;
  /** Crew travelling (deadhead rows). */
  crew: number;
  sel: Ref | null;
  /** v0.7.1: a chartered private jet (who = its type). */
  jet?: boolean;
  /** v0.7.1: the flight is crew-short (the warning ladder's stage). */
  alert?: 'amber' | 'red';
  /** v0.9: which crew alert (a seat with nobody, or a named crew member out of hours). */
  alertKind?: CrewAlertKind;
}

// ---------- v0.7.1 crew shortages ----------

/** v0.9 `kind` comes from the engine (crewAlertKind via shortFlights): 'hours' names a crew member at a legal limit. */
export interface ShortRow { flightId: string; aircraftId: string; stage: 'amber' | 'red'; hoursLeft: number; std: Minute; kind: CrewAlertKind }

/** v0.9 §T alert words: the static banner, and the short chip (Up Next, leg rows). */
export const ALERT_BANNER: Record<CrewAlertKind, string> = { short: 'CREW SHORTAGE', hours: 'CREW OUT OF HOURS' };
export const ALERT_CHIP: Record<CrewAlertKind, string> = { short: 'CREW SHORT', hours: 'OUT OF HOURS' };

/** v0.9 §T the limit in two or three words, for the aircraft panel line: the one name per limit (§V, round 4). */
export const OOH_SHORT: Record<OohLimit, string> = LIMIT_NAME;

/** 'Crew out of hours · Ana Silva (28-day hours)' (+ ' and 1 other'); the bare title when the engine names nobody. Pure. */
export function oohLine(list: { name: string; limit: OohLimit }[]): string {
  if (!list.length) return 'Crew out of hours';
  const x = list[0];
  const more = list.length - 1;
  return `Crew out of hours · ${x.name} (${OOH_SHORT[x.limit]})${more ? ` and ${more} other${more > 1 ? 's' : ''}` : ''}`;
}

/** Crew-short flights (the ladder's list) by flight id and, soonest per aircraft, by aircraft id. */
export function shortIndex(g: GameState): { byFlight: Map<string, ShortRow>; byAircraft: Map<string, ShortRow> } {
  const byFlight = new Map<string, ShortRow>();
  const byAircraft = new Map<string, ShortRow>();
  for (const s of shortFlights(g)) {
    const f = g.flights[s.flightId];
    if (!f?.aircraftId) continue;
    const row: ShortRow = { flightId: s.flightId, aircraftId: f.aircraftId, stage: s.stage, hoursLeft: s.hoursLeft, std: f.std, kind: s.kind ?? 'short' };
    byFlight.set(s.flightId, row);
    if (!byAircraft.has(f.aircraftId)) byAircraft.set(f.aircraftId, row);
  }
  return { byFlight, byAircraft };
}

/** Up Next rows: our next departures and the airline legs our crew ride, typed, after `after`; at most n. */
export function upNextRows(g: GameState, n = 4, after = -Infinity): NextRow[] {
  const short = shortIndex(g).byFlight;
  const rows: NextRow[] = upNext(g, n, after).map((f) => ({
    id: f.id, t: f.std + f.delay, who: f.aircraftId ? g.fleet[f.aircraftId]?.reg ?? f.no : f.no, from: f.from, to: f.to,
    type: flightType(g, f), crew: 0, sel: f.aircraftId ? { kind: 'aircraft', id: f.aircraftId } : null,
    ...(short.has(f.id) ? { alert: short.get(f.id)!.stage, alertKind: short.get(f.id)!.kind } : {}),
  }));
  const t0 = Number.isFinite(after) ? after : g.now;
  for (const cf of groupCommercial(commercialFlightsBetween(g, t0, t0 + 3 * DAY))) {
    if (cf.leg.dep <= after) continue;
    rows.push(commercialRow(cf));
  }
  return rows.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1)).slice(0, n);
}

const commercialRow = (cf: CommercialFlight): NextRow => ({
  id: cf.id, t: cf.leg.dep, who: cf.leg.no, from: cf.leg.from, to: cf.leg.to, type: 'deadhead', crew: cf.crewIds.length, sel: { kind: 'flight', id: cf.id },
  ...(cf.leg.jet ? { jet: true } : {}),
});

export interface PinGroup {
  code: string;
  offers: ContractOffer[];
  urgent: boolean;
}

/** Open offers grouped by pin airport (urgent groups first). */
export function offerPins(g: GameState): PinGroup[] {
  const by = new Map<string, PinGroup>();
  for (const o of Object.values(g.offers)) {
    if (o.status !== 'open' || !AIRPORT_BY_CODE[o.pin]) continue;
    let p = by.get(o.pin);
    if (!p) by.set(o.pin, (p = { code: o.pin, offers: [], urgent: false }));
    p.offers.push(o);
    if (o.urgency === 'urgent') p.urgent = true;
  }
  return [...by.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/** Default framing (Europe and North Africa) widened to the base, every aircraft and the nearby pins. */
export const FIT_ANCHORS = ['DUB', 'FCO', 'TFS', 'CMN'];
/** Offer pins further than this from the base don't widen the default view (one far offer framed the whole world). */
export const FIT_PIN_KM = 3000;

/** A new game (nothing flown or planned yet): the first view frames the base's own neighbourhood, base near the middle. */
export const fitFresh = (g: GameState) => Object.keys(g.flights).length === 0;

export function fitCodes(g: GameState): string[] {
  const home = AIRPORT_BY_CODE[g.company.homeBase];
  const near = (code: string) => {
    const a = AIRPORT_BY_CODE[code];
    return !!a && (!home || haversine(home.lat, home.lon, a.lat, a.lon) <= FIT_PIN_KM);
  };
  const fresh = fitFresh(g);
  const s = new Set([g.company.homeBase, ...FIT_ANCHORS.filter((c) => !fresh || near(c))]);
  for (const ac of Object.values(g.fleet)) {
    if (!onMap(ac)) continue;
    s.add(ac.at);
    const f = ac.flightId ? g.flights[ac.flightId] : undefined;
    if (f) s.add(f.to);
  }
  for (const p of offerPins(g)) if (near(p.code)) s.add(p.code);
  // v0.8: live world events near the base (their pins).
  for (const e of g.world?.events ?? []) if (!e.done && e.start <= g.now && g.now < e.end && near(e.at)) s.add(e.at);
  return [...s].filter((c) => AIRPORT_BY_CODE[c]);
}

/** Airports drawn on the map: base (hub), our aircraft and their next 48 h of legs, active contract bases, and (v0.7.2)
 * every station where any of our crew still is (hotel, waiting for a ticket, between duties of a tour). */
export function mapAirports(g: GameState): { code: string; hub: boolean; label: boolean }[] {
  const base = g.company.homeBase;
  const out = new Map<string, boolean>([[base, true]]);
  const horizon = g.now + 48 * 60;
  for (const ac of Object.values(g.fleet)) {
    if (!onMap(ac)) continue;
    out.set(ac.at, true);
    const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
    if (cur) out.set(cur.to, true);
    for (const f of flightsOf(g, ac.id)) {
      if (f.status !== 'scheduled' || f.std > horizon) continue;
      if (!out.has(f.from)) out.set(f.from, false);
      if (!out.has(f.to)) out.set(f.to, false);
    }
  }
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'active' || c.status === 'signed') && c.pattern.kind === 'base' && !out.has(c.pattern.base)) out.set(c.pattern.base, false);
  }
  for (const code of crewAway(g).at.keys()) if (!out.has(code)) out.set(code, false);
  return [...out].filter(([c]) => AIRPORT_BY_CODE[c]).map(([code, label]) => ({ code, hub: code === base, label }));
}

// ---------- labels ----------

export interface LabelBox {
  id: string;
  /** Centre and size in screen px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Greedy label placement: keeps each box (in priority order) that doesn't overlap one already kept. */
export function placeLabels(boxes: LabelBox[], gap = 2): Set<string> {
  const kept: LabelBox[] = [];
  const out = new Set<string>();
  for (const b of boxes) {
    const hit = kept.some((k) => Math.abs(k.x - b.x) * 2 < k.w + b.w + gap * 2 && Math.abs(k.y - b.y) * 2 < k.h + b.h + gap * 2);
    if (hit) continue;
    kept.push(b);
    out.add(b.id);
  }
  return out;
}

/** v0.12 an aircraft's label on the map: its registration or its FERRY / DELIVERY tag (screen px box). */
export interface AcLabel extends LabelBox {
  /** The aircraft it belongs to. */
  ac: string;
}

/**
 * v0.12 label thinning (many aircraft near one airport): which labels stay, by id. The selected aircraft's labels always
 * stay (even over another), then `fixed` ones (parked labels, already thinned per stand), then those shown last time
 * (so a label does not flicker as aircraft pass), then the rest in a stable order; a label overlapping one already kept
 * goes (`fixed` boxes may be aircraft icons: a label never covers another aircraft; its own may touch it). Pure.
 */
export function thinLabels(labels: AcLabel[], selected: string | undefined, prev: ReadonlySet<string>, fixed: ReadonlySet<string> = new Set(), gap = 1): Set<string> {
  const rank = (l: AcLabel) => (l.ac === selected ? 0 : fixed.has(l.id) ? 1 : prev.has(l.id) ? 2 : 3);
  const order = [...labels].sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept: AcLabel[] = [];
  const out = new Set<string>();
  for (const l of order) {
    if (l.ac !== selected && kept.some((k) => k.ac !== l.ac && boxOverlap(k, l, gap) > 0)) continue;
    kept.push(l);
    out.add(l.id);
  }
  return out;
}

/** Overlap area (px²) of two boxes, each grown by `gap` on every side; 0 when apart. */
export function boxOverlap(a: LabelBox, b: LabelBox, gap = 0): number {
  const ox = (a.w + b.w) / 2 + gap * 2 - Math.abs(a.x - b.x);
  const oy = (a.h + b.h) / 2 + gap * 2 - Math.abs(a.y - b.y);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

/**
 * Centre (screen px from the icon) of a label riding beside a moving icon: across the track, on the
 * travel-right (`side` 1) or travel-left (-1) of heading `ang` (headingDeg), clear of a `r` px icon.
 * The leg's own airports lie on the track, so they never sit under it; it turns smoothly with the track.
 */
export function trackLabelAt(ang: number, side: 1 | -1, w: number, h: number, r = 13): [number, number] {
  const a = ((ang - 90) * Math.PI) / 180;
  const nx = -Math.sin(a) * side;
  const ny = Math.cos(a) * side;
  const d = r + (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2;
  return [nx * d, ny * d];
}

/** Track side whose normal points down the screen (or right, on a north–south track): under the icon, away from codes drawn above dots. */
export function downSide(ang: number): 1 | -1 {
  const [nx, ny] = trackLabelAt(ang, 1, 0, 0, 1);
  return ny > 0.25 || (ny > -0.25 && nx > 0) ? 1 : -1;
}

/** Per track point: does the label on `side` cover any obstacle (by more than a sliver)? */
export function trackCovered(track: { x: number; y: number; ang: number }[], side: 1 | -1, w: number, h: number, obstacles: LabelBox[]): boolean[] {
  return track.map((t) => {
    const [cx, cy] = trackLabelAt(t.ang, side, w, h);
    const b = { id: '', x: t.x + cx, y: t.y + cy, w, h };
    return obstacles.some((o) => boxOverlap(b, o, 1) > 6);
  });
}

/** Our reg label's centre offset from the icon (screen px): under it (as parked), or above it while that covers an airport. */
export const REG_DY = 21;
/** 0 = under the icon, 1 = above it, 2 = under but faded (both cover an airport dot or code). */
export type RegSlot = 0 | 1 | 2;

/**
 * Where our airborne aircraft's reg label sits right now (icon at x/y, screen px; v0.14 `dy`: the label's centre
 * offset for this icon's size): under the icon unless
 * that covers an airport dot or code (just after take-off, on short final), then above it. Hysteresis
 * (a label leaves a slot on a clear overlap, returns only with a margin) keeps it from hopping back and forth.
 */
export function regSlot(x: number, y: number, w: number, h: number, obstacles: LabelBox[], prev: RegSlot, dy = REG_DY): RegSlot {
  const bad = (dy: number, held: boolean) => {
    // Held: covered once it is more than 1.5 px into a box; taken back only with 2 px to spare.
    const m = held ? -1.5 : 2;
    return obstacles.some((o) => Math.abs(x - o.x) < (w + o.w) / 2 + m && Math.abs(y + dy - o.y) < (h + o.h) / 2 + m);
  };
  if (!bad(dy, prev === 0)) return 0;
  return bad(-dy, prev === 1) ? 2 : 1;
}

/**
 * Side for a leg's label, chosen once per leg (and zoom) so it never hops mid-flight: `pref`, unless the
 * other side covers clearly less of the obstacles over the whole track (`track` = icon point and heading, screen px).
 */
export function legLabelSide(track: { x: number; y: number; ang: number }[], w: number, h: number, obstacles: LabelBox[], pref: 1 | -1): 1 | -1 {
  const cover = (side: 1 | -1) => {
    let c = 0;
    for (const t of track) {
      const [cx, cy] = trackLabelAt(t.ang, side, w, h);
      for (const o of obstacles) c += boxOverlap({ id: '', x: t.x + cx, y: t.y + cy, w, h }, o, 2);
    }
    return c;
  };
  const a = cover(pref);
  if (a === 0) return pref;
  const other = pref === 1 ? -1 : 1;
  return cover(other) < a * 0.5 ? other : pref;
}

export const ARCHETYPE_LABEL: Partial<Record<Archetype, string>> = {
  seasonBase: 'Season ACMI base', aogCover: 'AOG cover', adhoc: 'Ad hoc charter', sports: 'Sports charter', repatriation: 'Repatriation',
  tourSeries: 'Tour series', troopRotation: 'Troop rotation', capacityLease: 'Capacity lease', hajj: 'Hajj', unRotation: 'UN rotation', vip: 'VIP charter',
  deportation: 'Deportation', evacuation: 'Evacuation', humanitarian: 'Humanitarian', subcharterIn: 'Sub-charter', dryLeaseOut: 'Dry lease out',
};

export const KIND_LABEL: Record<Flight['kind'], string> = { revenue: 'Revenue', positioning: 'Positioning', ferry: 'Ferry', techstop: 'Fuel stop', deadhead: 'Deadhead' };

export type Tone = 'good' | 'warn' | 'bad' | 'air' | 'idle';

export interface ChipInfo {
  tone: Tone;
  /** State line, ≤ 18 chars to fit a fixed chip: "LIS→OPO ETA 15:20", "LIS→OPO 14:05", "LIS→OPO · 5 Apr", "C-check → 9 Mar", "AOG at FAO". */
  line: string;
  /** Compact chip line, ≤ 10 chars: "LIS→OPO", "→OPO 14:05", "AOG FAO", "Idle LIS". */
  short: string;
}

/** Fleet-strip chip text (changes at most hourly when rendered from React). v0.7.1: a crew-short flight (`short`, from
 * shortIndex) turns the chip amber/red with "CREW SHORT 08:34"; v0.9 crew out of hours reads "OUT OF HRS 08:34". */
export function chipInfo(g: GameState, ac: Aircraft, t: Minute, short?: ShortRow): ChipInfo {
  if (short) {
    const tone = short.stage === 'red' ? 'bad' : 'warn';
    // v0.12.1 a flight on another day says which ('CREW Fri 07:20'): shortages are flagged up to 48 h ahead.
    if (Math.floor(short.std / DAY) !== Math.floor(t / DAY)) {
      const at = fmtWeekdayTime(short.std);
      return short.kind === 'hours' ? { tone, line: `HRS ${at}`, short: at } : { tone, line: `CREW ${at}`, short: at };
    }
    const at = fmtTime(short.std);
    return short.kind === 'hours' ? { tone, line: `OUT OF HRS ${at}`, short: `HRS ${at}` } : { tone, line: `CREW SHORT ${at}`, short: `CREW ${at}` };
  }
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (cur) return { tone: 'air', line: `${cur.from}→${cur.to} ETA ${fmtTime(flightTimes(cur).on)}`, short: `${cur.from}→${cur.to}` };
  if (ac.status === 'aog') return { tone: 'bad', line: `AOG at ${ac.at}`, short: `AOG ${ac.at}` };
  if (ac.status === 'maintenance') {
    const m = ac.maintId ? g.maintenance[ac.maintId] : undefined;
    if (m?.kind === 'paint') return { tone: 'warn', line: `Paint shop → ${fmtDay(m.end)}`, short: `Paint ${ac.at}` };
    if (m?.kind === 'refit') return { tone: 'warn', line: `Refit ${m.at} ${fmtDay(m.end)}`, short: `Refit ${m.at}` };
    if (m?.kind === 'return') return { tone: 'warn', line: `Return → ${fmtDay(m.end)}`, short: `Return ${m.at}` };
    return { tone: 'warn', line: m ? `${m.kind === 'AOG' ? 'Repair' : `${m.kind}-check`} → ${fmtDay(m.end)}` : `Hangar ${ac.at}`, short: `Hangar ${ac.at}` };
  }
  // v0.8: with the lessee ('Leased LAD 14 Mar').
  if (ac.status === 'leasedOut') {
    const v = dryLeaseOf(g, ac.id);
    const full = v ? `Leased ${ac.at} ${fmtDay(v.lease[1])}` : `Leased ${ac.at}`;
    return { tone: 'idle', line: full.length <= 17 ? full : `Leased ${ac.at}`, short: `Leased ${ac.at}` };
  }
  const dl = ac.delivery;
  if (ac.status === 'delivering') {
    if (!dl) return { tone: 'idle', line: `Delivery ${fmtDay(ac.deliveredAt)}`, short: 'Delivery' };
    // Fits the fixed chip (≈ 17 chars): 'Handover SCL 2 May', else 'Handover 12 May' (the site is in the short line and title).
    const full = `Handover ${dl.site} ${fmtDay(dl.handover)}`;
    return { tone: 'idle', line: full.length <= 17 ? full : `Handover ${fmtDay(dl.handover)}`, short: `Dlvy ${dl.site}` };
  }
  const next = upcomingLegs(g, ac.id, 1)[0];
  if (dl && dl.arrived === undefined) {
    if (dl.waitingSince !== undefined) return { tone: 'warn', line: 'Waiting for crew', short: `Wait ${ac.at}` };
    if (next?.purpose === 'delivery') {
      const dep = next.std + next.delay;
      return { tone: dep - t < 24 * 60 ? 'good' : 'idle', line: `Ferry home ${fmtDay(dep)}`, short: `Dlv ${fmtDay(dep)}` };
    }
  }
  if (!next) return { tone: 'idle', line: `Idle at ${ac.at}`, short: `Idle ${ac.at}` };
  const dep = next.std + next.delay;
  const soon = dep - t < 20 * 60;
  const when = soon ? fmtTime(dep) : `· ${fmtDay(dep)}`;
  // v0.12.1 '→OPO 14:05': the arrow says it is the next departure there, not a time at OPO.
  return { tone: dep - t < 24 * 60 ? 'good' : 'idle', line: `${next.from}→${next.to} ${when}`, short: soon ? `→${next.to} ${fmtTime(dep)}` : `${next.to} ${fmtDay(dep)}` };
}

// ---------- v0.7.3 crew rest on the aircraft panel ----------

const REST_WORD: Record<RestKind, string> = { fcrc: 'bunks', ccrc: 'bunks', ldmcr: 'lower-deck module', jSeats: 'business seats', recliners: 'recliners', ySeats: 'economy seats' };
const restWord = (f: RestFacility | null) => (f ? REST_WORD[f.kind] : 'none');

/** Aircraft panel chip: 'Rest: pilots bunks · cabin crew business seats' ('Rest: pilots & cabin crew bunks' when alike); null when the aircraft has no crew rest at all. */
export function restChip(r: AcRest): string | null {
  if (!r.fc && !r.cc) return null;
  if (r.fc && r.cc && restWord(r.fc) === restWord(r.cc)) return `Rest: pilots & cabin crew ${restWord(r.fc)}`;
  return `Rest: pilots ${restWord(r.fc)} · cabin crew ${restWord(r.cc)}`;
}

const WHERE: Record<RestKind, string> = { fcrc: 'bunk', ccrc: 'bunk', ldmcr: 'lower deck', jSeats: 'business seat', recliners: 'recliner', ySeats: 'economy seat' };
const PILOT_NAME = /^(Capt\.|FO|CRP)\b/;

/**
 * The one calm airborne line from `restNow` rows: 'Resting: Capt. Silva (bunk) until 14:20 UTC'; several rows
 * joined with ' · ', a cabin crew group as '4 cabin crew'. null when nobody rests now.
 */
export function restingLine(rows: { names: string[]; where: RestKind; until: Minute }[]): string | null {
  if (!rows.length) return null;
  const parts = rows.map((r) => {
    const pilots = r.names.filter((n) => PILOT_NAME.test(n));
    const who = pilots.length === r.names.length ? r.names.join(', ') : r.names.length > 1 ? `${r.names.length} cabin crew` : r.names[0];
    return `${who} (${WHERE[r.where]}) until ${fmtTime(r.until)}`;
  });
  return `Resting: ${parts.join(' · ')} UTC`;
}

/** Seats line noun for the blocked rest seats: 'business seats' / 'seats'. */
export function restSeatNoun(r: AcRest): string {
  return r.cc?.kind === 'jSeats' || r.fc?.kind === 'jSeats' ? 'business seats' : r.cc?.kind === 'ySeats' || r.fc?.kind === 'ySeats' ? 'economy seats' : 'seats';
}

// ---------- v0.8 world events and dry leases ----------

type Proj = (p: [number, number]) => [number, number] | null;

/** Projected outline of a zone ring as straight segments between its points (map units); '' when nothing projects. Pure. */
export function ringPath(ring: [number, number][], proj: Proj): string {
  let d = '';
  for (const p of ring) {
    const q = proj(p);
    if (q) d += `${d ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  }
  return d ? `${d}Z` : '';
}

/** Area centroid and width (map units) of a projected ring, for its label; null for a degenerate ring. Pure. */
export function ringLabelAt(ring: [number, number][], proj: Proj): { x: number; y: number; w: number } | null {
  const q = ring.map((p) => proj(p)).filter(Boolean) as [number, number][];
  if (q.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i];
    const [x1, y1] = q[(i + 1) % q.length];
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  const xs = q.map((p) => p[0]);
  if (Math.abs(a) < 1e-9) return null;
  return { x: cx / (3 * a), y: cy / (3 * a), w: Math.max(...xs) - Math.min(...xs) };
}

/** An event pin as drawn: its airport and the screen-px offset from the airport dot. */
export interface EventPin { eventId: string; at: string; kind: WorldEventKind; title: string; off: [number, number] }

/** Event glyph gap (screen px) between pins at one airport. */
export const EVENT_PIN_GAP = 24;

/**
 * Screen-px offsets for event pins: on the spot at an airport with nothing else drawn; up-left of the dot where we
 * already mark the airport (code above, parked aircraft right) or an offer diamond sits (left); several at one airport
 * step further left. Pure.
 */
export function placeEventPins(pins: { eventId: string; at: string; kind: WorldEventKind; title: string }[], marked: Set<string>, offerAt: Set<string>): EventPin[] {
  const n = new Map<string, number>();
  return pins.map((p) => {
    const i = n.get(p.at) ?? 0;
    n.set(p.at, i + 1);
    const busy = marked.has(p.at) || offerAt.has(p.at);
    const off: [number, number] = busy ? [-22 - i * EVENT_PIN_GAP, -20] : [i ? -i * EVENT_PIN_GAP : 0, 0];
    return { ...p, off };
  });
}

/** Pin tone by kind: closures and fighting muted red, ash grey, the rest amber. */
export const EVENT_TONE: Record<WorldEventKind, 'bad' | 'warn' | 'ash'> = {
  coup: 'bad', war: 'bad', unrest: 'bad', airspace: 'bad', strike: 'warn', disaster: 'warn', airlineFailure: 'warn', engineCrisis: 'warn', recession: 'warn', ash: 'ash',
};

/** v0.8: an aircraft dry-leased out (with the lessee, at their base). */
export const leasedOut = (ac: Aircraft) => ac.status === 'leasedOut';

/** Event kind in the panel kicker. */
export const EVENT_KIND_LABEL: Record<WorldEventKind, string> = {
  coup: 'Coup', strike: 'Strike', ash: 'Volcanic ash', disaster: 'Disaster', airlineFailure: 'Airline failure', war: 'War', airspace: 'Airspace closure',
  unrest: 'Unrest', engineCrisis: 'Engine crisis', recession: 'Recession',
};

/**
 * The livery the map and its panel draw: liveryOf, plus (v0.8) a dry-leased-out aircraft in the lessee's paint
 * (Contract.dry.paint carries no PaintTerms, which liveryOf reads; a no-op once it does). Pure.
 */
export function mapLivery(g: GameState, ac: Aircraft): ResolvedLivery {
  const lv = liveryOf(g, ac);
  if (lv.source === 'client' || !ac.paintedFor) return lv;
  const c = g.contracts[ac.paintedFor];
  const cl = c ? g.clients[c.clientId] : undefined;
  if (!c?.dry?.paint || !cl) return lv;
  return { livery: clientLivery(cl, c.dry.paint), code: clientCode(cl), name: clientTitles(cl), source: 'client', contractId: c.id, clientName: cl.name };
}

// ---------- v0.9 hotel standby (§R.9) and crew changes at a fuel stop (§W.4) ----------

/** "2 pilots · 4 cabin crew" (v0.7.2 hotel count, moved here in v0.9). Pure. */
export function hotelCount(list: Pick<CrewMember, 'role'>[]): string {
  const p = list.filter((m) => isPilot(m.role)).length;
  const c = list.length - p;
  return [p ? `${p} pilot${p === 1 ? '' : 's'}` : '', c ? `${c} cabin crew` : ''].filter(Boolean).join(' · ');
}

/** Map selection id of a crew change (a Ref of kind 'flight'): `slip:${flightId}` (never an airline-leg id). */
export const slipSelId = (flightId: string) => `slip:${flightId}`;
export const parseSlipId = (id: string): string | null => (id.startsWith('slip:') ? id.slice(5) : null);

/** Crew changes shown for a selected aircraft: takeovers from a day ago (the first crew still going home) to 5 days out. */
export const slipWindow = (now: Minute): [Minute, Minute] => [now - DAY, now + 5 * DAY];

/** A crew-change mark as drawn: its airport and the screen-px offset from the airport dot. */
export interface SlipMark { id: string; flightId: string; at: string; off: [number, number] }

/** Gap (screen px) between crew-change marks at one airport. */
export const SLIP_MARK_GAP = 24;

/**
 * Screen-px offsets for crew-change marks: down-left of the airport dot, the one corner nothing else uses (code above,
 * parked aircraft right, offer diamond left, event pins up-left); several at one airport step further left. Pure.
 */
export function placeSlipMarks(views: { flightId: string; at: string }[]): SlipMark[] {
  const n = new Map<string, number>();
  return views.map((v) => {
    const i = n.get(v.at) ?? 0;
    n.set(v.at, i + 1);
    return { id: slipSelId(v.flightId), flightId: v.flightId, at: v.at, off: [-20 - i * SLIP_MARK_GAP, 20] };
  });
}

/** A slip crew's airline leg drawn while its aircraft (or the crew change) is selected: in = the fresh crew flying out. */
export interface SlipArc { id: string; from: string; to: string; dir: 'in' | 'out' }

/** The airline legs of the slip crews' tickets (our own positioning legs are already drawn as the aircraft's arcs). Pure. */
export function slipArcs(g: GameState, views: SlipView[]): SlipArc[] {
  const out: SlipArc[] = [];
  const seen = new Set<string>();
  for (const v of views) {
    for (const [dir, ids] of [['in', v.inCrew.ticketIds], ['out', v.outCrew.ticketIds]] as const) {
      for (const id of ids) {
        const t = g.flights[id];
        if (!t || t.kind !== 'deadhead' || seen.has(id)) continue;
        seen.add(id);
        const legs = commercialItinerary(g, t);
        if (!legs.length) out.push({ id, from: t.from, to: t.to, dir });
        legs.forEach((l, i) => out.push({ id: `${id}:${i}`, from: l.from, to: l.to, dir }));
      }
    }
  }
  return out.filter((a) => AIRPORT_BY_CODE[a.from] && AIRPORT_BY_CODE[a.to]);
}

/** 'EK 249 via DXB' (an airline ticket), 'our AWL102' (riding our own flight), or the ticket number. */
function ticketWords(g: GameState, id: string | undefined): string | null {
  const t = id ? g.flights[id] : undefined;
  if (!t) return null;
  if (t.kind !== 'deadhead') return `our ${t.no}`;
  const legs = commercialItinerary(g, t);
  if (!legs.length) return t.no;
  return `${legs[0].no}${legs.length > 1 ? ` via ${legs[0].to}` : ''}`;
}

const cityName = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/**
 * The crew-change panel line (§W.4): 'Crew change at Istanbul · fresh crew from Madrid on TK 1858 (lands 18:40 UTC,
 * rests 13 h) · the first crew flies home on TK 1859' (without the opening words under a title that says them). Rest
 * runs from the fresh crew's landing to their report. Pure.
 */
export function slipLine(g: GameState, v: SlipView, head = true): string {
  const tin = v.inCrew.ticketIds.map((id) => g.flights[id]).filter((t): t is Flight => !!t).sort((a, b) => b.sta - a.sta)[0];
  const f = g.flights[v.flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const parts = head ? [`Crew change at ${v.atName}`] : [];
  if (tin) {
    const lands = v.inCrew.arrives ?? tin.sta;
    const rest = d ? Math.floor((d.report - lands) / 60) : 0;
    parts.push(`fresh crew from ${cityName(tin.from)} on ${ticketWords(g, tin.id)} (lands ${fmtTime(lands)} UTC${rest > 0 ? `, rests ${rest} h` : ''})`);
  } else parts.push('fresh crew flies in');
  const out = ticketWords(g, v.outCrew.ticketIds[0]);
  parts.push(out ? `the first crew flies home on ${out}` : 'the first crew flies home');
  const line = parts.join(' · ');
  return head ? line : line.charAt(0).toUpperCase() + line.slice(1);
}
