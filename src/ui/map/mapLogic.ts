// Ops Map (B4): pure helpers (no React, no DOM) so they can be unit-tested. Sun and terminator,
// parked fan-out, selected-aircraft legs, offer pins, fit area, hit picking and chip text.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from '../../engine/core/entities';
import { haversine } from '../../engine/core/geo';
import { flightTimes } from '../../engine/core/query';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { Aircraft, Archetype, ContractOffer, Flight, GameState, Minute, Ref } from '../../engine/core/types';
import { commercialFlightsBetween, type CommercialFlight, commercialItinerary, type FlightType, flightType } from '../../engine/ops';
import { contractColor } from '../screens/palette';

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

/** Arcs for the selected aircraft: the leg it is flying (if any) and its next `n` scheduled legs. */
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
  for (const f of flightsOf(g, aircraftId)) {
    if (out.length >= n + (cur ? 1 : 0)) break;
    if (f.status === 'scheduled' && f.id !== cur?.id && AIRPORT_BY_CODE[f.from] && AIRPORT_BY_CODE[f.to]) out.push(arc(f, false));
  }
  return out;
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

/** Map stroke per flight type: colour, dash (screen px; '' = solid) and width (screen px). */
export const TYPE_STROKE: Record<FlightType, { color: string; dash: string; width: number }> = {
  operating: { color: '#34d399', dash: '', width: 1.8 },
  positioning: { color: '#fbbf24', dash: '2 5', width: 1.8 },
  ferry: { color: '#fbbf24', dash: '2 5', width: 1.8 },
  deadhead: { color: '#9aa5bb', dash: '1.5 4', width: 1.1 },
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
  /** Registration (our aircraft) or airline flight number (deadhead). */
  who: string;
  from: string;
  to: string;
  type: FlightType;
  /** Crew travelling (deadhead rows). */
  crew: number;
  sel: Ref | null;
}

/** Up Next rows: our next departures and the airline legs our crew ride, typed, after `after`; at most n. */
export function upNextRows(g: GameState, n = 4, after = -Infinity): NextRow[] {
  const rows: NextRow[] = upNext(g, n, after).map((f) => ({
    id: f.id, t: f.std + f.delay, who: f.aircraftId ? g.fleet[f.aircraftId]?.reg ?? f.no : f.no, from: f.from, to: f.to,
    type: flightType(g, f), crew: 0, sel: f.aircraftId ? { kind: 'aircraft', id: f.aircraftId } : null,
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
    s.add(ac.at);
    const f = ac.flightId ? g.flights[ac.flightId] : undefined;
    if (f) s.add(f.to);
  }
  for (const p of offerPins(g)) if (near(p.code)) s.add(p.code);
  return [...s].filter((c) => AIRPORT_BY_CODE[c]);
}

/** Airports drawn on the map: base (hub), our aircraft and their next 48 h of legs, active contract bases. */
export function mapAirports(g: GameState): { code: string; hub: boolean; label: boolean }[] {
  const base = g.company.homeBase;
  const out = new Map<string, boolean>([[base, true]]);
  const horizon = g.now + 48 * 60;
  for (const ac of Object.values(g.fleet)) {
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
  /** Compact chip line, ≤ 10 chars: "LIS→OPO", "OPO 14:05", "AOG FAO", "Idle LIS". */
  short: string;
}

/** Fleet-strip chip text (changes at most hourly when rendered from React). */
export function chipInfo(g: GameState, ac: Aircraft, t: Minute): ChipInfo {
  const cur = ac.flightId ? g.flights[ac.flightId] : undefined;
  if (cur) return { tone: 'air', line: `${cur.from}→${cur.to} ETA ${fmtTime(flightTimes(cur).on)}`, short: `${cur.from}→${cur.to}` };
  if (ac.status === 'aog') return { tone: 'bad', line: `AOG at ${ac.at}`, short: `AOG ${ac.at}` };
  if (ac.status === 'maintenance') {
    const m = ac.maintId ? g.maintenance[ac.maintId] : undefined;
    if (m?.kind === 'paint') return { tone: 'warn', line: `Paint shop → ${fmtDay(m.end)}`, short: `Paint ${ac.at}` };
    return { tone: 'warn', line: m ? `${m.kind === 'AOG' ? 'Repair' : `${m.kind}-check`} → ${fmtDay(m.end)}` : `Hangar ${ac.at}`, short: `Hangar ${ac.at}` };
  }
  if (ac.status === 'delivering') return { tone: 'idle', line: `Delivery ${fmtDay(ac.deliveredAt)}`, short: 'Delivery' };
  const next = upcomingLegs(g, ac.id, 1)[0];
  if (!next) return { tone: 'idle', line: `Idle at ${ac.at}`, short: `Idle ${ac.at}` };
  const dep = next.std + next.delay;
  const soon = dep - t < 20 * 60;
  const when = soon ? fmtTime(dep) : `· ${fmtDay(dep)}`;
  return { tone: dep - t < 24 * 60 ? 'good' : 'idle', line: `${next.from}→${next.to} ${when}`, short: soon ? `${next.to} ${fmtTime(dep)}` : `${next.to} ${fmtDay(dep)}` };
}
