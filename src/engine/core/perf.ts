// Aircraft performance and fit: block times, range and tech stops, runway and ETOPS fit,
// crew complements. Pure functions shared by contracts, crew and ops (DESIGN.md §5.2–5.5).

import { ACMI_TYPES, type AcmiType, type CrewFloor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { distanceNm, haversine, interpolateGC } from './geo';
import type { Role } from './types';

/** Taxi, climb and descent allowance added to cruise time (RESEARCH §5.6: +0:27). */
export const TAXI_CLIMB_MIN = 27;
/** Airway routing vs great circle. */
export const ROUTE_FACTOR = 1.04;
/** Fuel-only tech stop ground time. */
export const TECH_STOP_MIN = 60;
/** Usable share of the published full-payload range (reserves). */
export const RANGE_RESERVE = 0.95;
/** Runways shorter than this share of the type's minimum are prohibited; between it and 1, payload-limited. */
export const RUNWAY_LIMITED = 0.7;
/** Sector length allowed from/to a payload-limited runway, as a share of range. */
export const LIMITED_RANGE_SHARE = 0.45;
/** An airport counts as an ETOPS/en-route alternate with at least this runway. */
export const ADEQUATE_RUNWAY_M = 2400;

export function typeOf(typeId: string): AcmiType {
  return ACMI_TYPES[typeId];
}

const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;

/** Jet-stream wind factor on time: westbound mid-latitude legs are slower, eastbound faster. */
function windFactor(a: Airport, b: Airport): number {
  if (Math.abs(a.lat) < 25 && Math.abs(b.lat) < 25) return 1;
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  if (Math.abs(dLon) < 15) return 1;
  return dLon < 0 ? 1.07 : 0.95;
}

/** Scheduled block minutes for a sector (rounded up to 5). */
export function blockMinutes(typeId: string, from: string, to: string): number {
  const t = typeOf(typeId);
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  const nm = distanceNm(from, to) * ROUTE_FACTOR;
  return roundUp5((nm / t.cruiseKt) * 60 * windFactor(a, b) + TAXI_CLIMB_MIN);
}

export type RunwayFit = 'ok' | 'limited' | 'no';

export function runwayFit(typeId: string, airport: string): RunwayFit {
  const r = AIRPORT_BY_CODE[airport]?.runwayM ?? 0;
  const need = typeOf(typeId).minRunwayM;
  if (r >= need) return 'ok';
  return r >= need * RUNWAY_LIMITED ? 'limited' : 'no';
}

/** Longest sector (nm) the type may fly between two airports given runway limits. */
export function maxSectorNm(typeId: string, from: string, to: string): number {
  const t = typeOf(typeId);
  const limited = runwayFit(typeId, from) === 'limited' || runwayFit(typeId, to) === 'limited';
  return t.rangeNm * RANGE_RESERVE * (limited ? LIMITED_RANGE_SHARE : 1);
}

export interface SectorLeg {
  from: string;
  to: string;
  block: number;
}

export interface SectorPlan {
  ok: boolean;
  /** One leg, or two/three when fuel stops are needed. */
  legs: SectorLeg[];
  techStops: string[];
  reason?: 'runway' | 'range';
}

const planCache = new Map<string, SectorPlan>();

/** Plans a revenue sector for a type: direct if it fits, else up to two fuel stops (shortest detour). */
export function planSector(typeId: string, from: string, to: string): SectorPlan {
  const key = `${typeId}:${from}:${to}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  let plan: SectorPlan;
  if (runwayFit(typeId, from) === 'no' || runwayFit(typeId, to) === 'no') {
    plan = { ok: false, legs: [], techStops: [], reason: 'runway' };
  } else if (distanceNm(from, to) <= maxSectorNm(typeId, from, to)) {
    plan = { ok: true, legs: [{ from, to, block: blockMinutes(typeId, from, to) }], techStops: [] };
  } else {
    plan = viaStops(typeId, from, to);
  }
  planCache.set(key, plan);
  return plan;
}

/** Countries no operator picks for a fuel stop (war zones). */
export const NO_STOP_COUNTRY: ReadonlySet<string> = new Set(['YE', 'SY', 'LY', 'SD', 'SS', 'SO', 'AF']);

function viaStops(typeId: string, from: string, to: string): SectorPlan {
  // Fuel stops at proper airports first; small strips (size 1: diversion-only desert fields) only as a last resort.
  return viaStopsAt(typeId, from, to, 2) ?? viaStopsAt(typeId, from, to, 1) ?? { ok: false, legs: [], techStops: [], reason: 'range' };
}

function viaStopsAt(typeId: string, from: string, to: string, minSize: number): SectorPlan | null {
  const fits = (a: string, b: string) => runwayFit(typeId, b) !== 'no' && distanceNm(a, b) <= maxSectorNm(typeId, a, b);
  // v0.8 never a fuel stop on the ice (no fuel in Antarctica) or in a war zone insurers won't cover.
  const cands = AIRPORTS.filter((x) => x.code !== from && x.code !== to && x.size >= minSize && !x.ice && !NO_STOP_COUNTRY.has(x.country) && runwayFit(typeId, x.code) === 'ok');
  let best: { stops: string[]; d: number } | null = null;
  for (const x of cands) {
    if (!fits(from, x.code)) continue;
    if (fits(x.code, to)) {
      const d = distanceNm(from, x.code) + distanceNm(x.code, to);
      if (!best || d < best.d) best = { stops: [x.code], d };
    }
  }
  if (!best) {
    // Two stops: greedy on the first hop's progress towards the destination.
    const firsts = cands.filter((x) => fits(from, x.code)).sort((p, q) => distanceNm(p.code, to) - distanceNm(q.code, to)).slice(0, 12);
    for (const x of firsts) {
      for (const y of cands) {
        if (y.code === x.code || !fits(x.code, y.code) || !fits(y.code, to)) continue;
        const d = distanceNm(from, x.code) + distanceNm(x.code, y.code) + distanceNm(y.code, to);
        if (!best || d < best.d) best = { stops: [x.code, y.code], d };
      }
    }
  }
  if (!best) return null;
  const pts = [from, ...best.stops, to];
  const legs = pts.slice(1).map((b, i) => ({ from: pts[i], to: b, block: blockMinutes(typeId, pts[i], b) }));
  return { ok: true, legs, techStops: best.stops };
}

const etopsCache = new Map<string, number>();
let adequateList: Airport[] | null = null;
/** Adequate en-route alternates: any airport with a runway of at least ADEQUATE_RUNWAY_M. */
const adequate = () => (adequateList ??= AIRPORTS.filter((x) => x.runwayM >= ADEQUATE_RUNWAY_M));
/** Adequate airports in 5° cells (lat band × lon band) for the 'any within reach?' test. */
let grid: Map<number, Airport[]> | null = null;
const cellOf = (lat: number, lon: number) => Math.floor((lat + 90) / 5) * 100 + Math.floor((((lon + 180) % 360) + 360) % 360 / 5);
function adequateWithin(lat: number, lon: number, reachKm: number): boolean {
  if (!grid) {
    grid = new Map();
    for (const x of adequate()) {
      const k = cellOf(x.lat, x.lon);
      const l = grid.get(k);
      if (l) l.push(x);
      else grid.set(k, [x]);
    }
  }
  const dLat = reachKm / 111;
  const lat0 = Math.max(-90, lat - dLat);
  const lat1 = Math.min(89.999, lat + dLat);
  // Longitude span at the band's highest latitude (the whole circle near the poles).
  const cos = Math.cos((Math.min(89, Math.max(Math.abs(lat0), Math.abs(lat1))) * Math.PI) / 180);
  const dLon = Math.min(180, dLat / Math.max(0.01, cos));
  for (let b = Math.floor((lat0 + 90) / 5); b <= Math.floor((lat1 + 90) / 5); b++) {
    const n = dLon >= 180 ? 72 : Math.ceil((2 * dLon) / 5) + 1;
    const c0 = Math.floor((((lon - dLon + 180) % 360) + 360) % 360 / 5);
    for (let i = 0; i < Math.min(72, n); i++) {
      const l = grid.get(b * 100 + ((c0 + i) % 72));
      if (l && l.some((x) => haversine(lat, lon, x.lat, x.lon) <= reachKm)) return true;
    }
  }
  return false;
}
/** One-engine-inoperative speed as a share of cruise (still air). */
export const OEI_SPEED = 0.85;
/** ETOPS 'need' buckets: 0 is the 60-minute rule (no ETOPS). */
const bucket = (minutes: number) => (minutes <= 60 ? 0 : minutes <= 120 ? 120 : minutes <= 180 ? 180 : minutes <= 240 ? 240 : 330);
/** The track a → b sampled every ~150 nm (end points left out). */
function samples(from: string, to: string): [number, number][] {
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  const n = Math.max(2, Math.ceil(distanceNm(from, to) / 150));
  const out: [number, number][] = [];
  for (let i = 1; i < n; i++) out.push(interpolateGC(A.lon, A.lat, B.lon, B.lat, i / n));
  return out;
}

/**
 * v0.11 the furthest a twin is from an adequate airport on the direct track a → b, in minutes at the one-engine
 * speed in still air (≈ 0.85 × cruise): the figure the 60-minute rule and ETOPS approvals are measured against
 * (EASA AMC 20-6). 0 for three or four engines. Pure.
 */
export function etopsMinutes(typeId: string, from: string, to: string): number {
  const t = typeOf(typeId);
  if (t.engines !== 2) return 0;
  const key = `${t.cruiseKt}:${from}:${to}`;
  const hit = etopsCache.get(key);
  if (hit !== undefined) return hit;
  // v0.8 the blue-ice runways alternate for each other (Troll / Wolf's Fang), as on the real Antarctic flights.
  let worstNm = 0;
  for (const [lon, lat] of samples(from, to)) {
    let near = Infinity;
    for (const x of adequate()) near = Math.min(near, haversine(lat, lon, x.lat, x.lon) / 1.852);
    worstNm = Math.max(worstNm, near);
  }
  const minutes = (worstNm / (t.cruiseKt * OEI_SPEED)) * 60;
  etopsCache.set(key, minutes);
  return minutes;
}

/**
 * ETOPS minutes needed for a direct sector by a twin: the largest distance from the track to an adequate
 * airport, flown at single-engine speed (≈ 0.85 × cruise), bucketed to 0/120/180/240/330.
 */
export function etopsNeeded(typeId: string, from: string, to: string): number {
  return bucket(etopsMinutes(typeId, from, to));
}

/** The longest diversion time a cap allows (0: the 60-minute rule). */
const capMinutes = (cap: number) => (cap >= 330 ? Infinity : cap >= 240 ? 240 : cap >= 180 ? 180 : cap >= 120 ? 120 : 60);
const withinCache = new Map<string, boolean>();

/**
 * v0.11 a direct leg stays inside an ETOPS cap (0: within 60 minutes of an adequate airport everywhere): the
 * same answer as etopsNeeded(…) ≤ cap, found without measuring every point exactly (it stops at the first point
 * out of reach). Always true for three or four engines. Pure.
 */
export function withinEtops(typeId: string, from: string, to: string, cap: number): boolean {
  const t = typeOf(typeId);
  const lim = capMinutes(cap);
  if (t.engines !== 2 || lim === Infinity) return true;
  const exact = etopsCache.get(`${t.cruiseKt}:${from}:${to}`);
  if (exact !== undefined) return exact <= lim;
  const key = `${t.cruiseKt}:${lim}:${from}:${to}`;
  const hit = withinCache.get(key);
  if (hit !== undefined) return hit;
  const reach = (lim / 60) * t.cruiseKt * OEI_SPEED * 1.852;
  let ok = true;
  for (const [lon, lat] of samples(from, to)) {
    if (!adequateWithin(lat, lon, reach)) {
      ok = false;
      break;
    }
  }
  withinCache.set(key, ok);
  return ok;
}

/** v0.11 the highest ETOPS approval held (0: none) from the company's approvals. Pure. */
export function heldEtops(approvals: readonly string[]): number {
  return approvals.includes('etops240') ? 240 : approvals.includes('etops180') ? 180 : approvals.includes('etops120') ? 120 : 0;
}

/**
 * v0.11 how far from an adequate airport this type may fly on our AOC, as an ETOPS cap: the lower of the company's
 * approval and the type's own capability (0 = the 60-minute rule, with no approval or an incapable twin);
 * Infinity for three or four engines (no twin rules). Every ferry and positioning routing respects it. Pure.
 */
export function etopsCap(approvals: readonly string[], typeId: string): number {
  const t = typeOf(typeId);
  if (t.engines !== 2) return Infinity;
  return Math.min(heldEtops(approvals), t.etopsMax);
}

export interface EtopsRouteOpts {
  /** Longest block of one leg (a ferry day). */
  maxBlock: number;
  /** Countries never used for a stop. */
  noStop: ReadonlySet<string>;
  /** Extra test on each leg (closed airspace). */
  ok?: (a: string, b: string) => boolean;
}

const etopsRoutes = new Map<string, SectorLeg[] | null>();
/**
 * Isolated aerodromes (no destination alternate within reach): a leg into one carries fuel for two hours above it
 * instead of an alternate and 30 minutes' holding (Part-CAT isolated-aerodrome fuel): about an hour of range less.
 */
export const ISOLATED = new Set(['SFJ', 'UAK', 'YFB', 'BDA']);

/**
 * v0.11 the quickest chain of legs from → to in which every leg stays within the ETOPS cap (the 60-minute rule at
 * 0), each within the type's range and runways and at most `maxBlock` long, with fuel stops at proper airports or
 * the en-route fields (Keflavík, Kangerlussuaq, Iqaluit, Goose Bay…): the way real operators ferry a twin without
 * ETOPS approval. Shortest elapsed time (block plus an hour per stop), A* on the great circle; null when no such
 * chain exists (no 60-minute way across the Pacific or the South Atlantic). Pure, cached.
 */
export function etopsRoute(typeId: string, from: string, to: string, cap: number, opts: EtopsRouteOpts, tag = ''): SectorLeg[] | null {
  const key = `${typeId}:${capMinutes(cap)}:${opts.maxBlock}:${tag}:${from}:${to}`;
  if (etopsRoutes.has(key)) return etopsRoutes.get(key)!;
  const out = searchRoute(typeId, from, to, cap, opts);
  etopsRoutes.set(key, out);
  return out;
}

function searchRoute(typeId: string, from: string, to: string, cap: number, opts: EtopsRouteOpts): SectorLeg[] | null {
  if (from === to) return [];
  if (!AIRPORT_BY_CODE[from] || !AIRPORT_BY_CODE[to] || runwayFit(typeId, from) === 'no' || runwayFit(typeId, to) === 'no') return null;
  const t = typeOf(typeId);
  // Nodes: the start, the stops (proper airports and the en-route fields), the destination last.
  const stops = AIRPORTS.filter((x) => x.code !== from && x.code !== to && !x.ice && (x.size >= 2 || x.enroute) && !opts.noStop.has(x.country) && runwayFit(typeId, x.code) === 'ok');
  const N: Airport[] = [AIRPORT_BY_CODE[from], ...stops, AIRPORT_BY_CODE[to]];
  const n = N.length;
  const T = n - 1;
  const limited = N.map((x) => runwayFit(typeId, x.code) === 'limited');
  const full = t.rangeNm * RANGE_RESERVE;
  // Great-circle nm as distanceNm gives it (whole km), without its pair cache (a search touches every pair).
  const nm = (i: number, j: number) => Math.round(haversine(N[i].lat, N[i].lon, N[j].lat, N[j].lon)) / 1.852;
  const block = (i: number, j: number) => roundUp5(((nm(i, j) * ROUTE_FACTOR) / t.cruiseKt) * 60 * windFactor(N[i], N[j]) + TAXI_CLIMB_MIN);
  const hT = N.map((_, i) => ((nm(i, T) * ROUTE_FACTOR) / t.cruiseKt) * 60 * 0.95);
  const best = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const legs = new Int32Array(n);
  const done = new Uint8Array(n);
  const open = new Set<number>([0]);
  best[0] = 0;
  while (open.size) {
    let cur = -1;
    let f = Infinity;
    for (const i of open) {
      const v = best[i] + hT[i];
      if (v < f || (v === f && N[i].code < N[cur].code)) [cur, f] = [i, v];
    }
    open.delete(cur);
    if (cur === T) break;
    done[cur] = 1;
    if (legs[cur] >= 14) continue;
    for (let j = 1; j < n; j++) {
      if (done[j] || j === cur) continue;
      const d = nm(cur, j);
      if (d > full * (limited[cur] || limited[j] ? LIMITED_RANGE_SHARE : 1) - (ISOLATED.has(N[j].code) ? t.cruiseKt : 0)) continue;
      const blk = block(cur, j);
      if (blk > opts.maxBlock) continue;
      const g1 = best[cur] + blk + (j === T ? 0 : TECH_STOP_MIN);
      if (g1 >= best[j]) continue;
      if (opts.ok && !opts.ok(N[cur].code, N[j].code)) continue;
      if (!withinEtops(typeId, N[cur].code, N[j].code, cap)) continue;
      best[j] = g1;
      prev[j] = cur;
      legs[j] = legs[cur] + 1;
      open.add(j);
    }
  }
  if (prev[T] < 0) return null;
  const path = [T];
  while (path[0] !== 0) path.unshift(prev[path[0]]);
  return path.slice(1).map((j, k) => ({ from: N[path[k]].code, to: N[j].code, block: blockMinutes(typeId, N[path[k]].code, N[j].code) }));
}

// ---------- crew complements ----------

/** A certified table's crew for `n` seats: the first row whose seats cover n (beyond the last row: the last). 0 without a table. */
function floorFor(rows: CrewFloor, n: number): number {
  if (!rows.length || n <= 0) return 0;
  for (const [s, c] of rows) if (n <= s) return c;
  return rows[rows.length - 1][1];
}
const per50 = (n: number) => (n > 0 ? Math.ceil(n / 50) : 0);

/** v0.10 seats on the upper deck of a two-deck type (0 for single-deck types). */
export function upperDeckSeats(typeId: string, seats: number): number {
  const u = ACMI_TYPES[typeId]?.crew?.upper;
  return u ? Math.min(u.max, Math.round(seats * u.share)) : 0;
}

/**
 * v0.10 minimum cabin crew (EASA ORO.CC.100(b), FAA 121.391): the greater of the number established at certification
 * for the cabin (the type's TCDS table, by installed seats) and one per 50 or fraction of 50 installed seats on the
 * same deck; the upper deck of a 747 or A380 is counted on its own. 0 up to 19 seats. Pure.
 */
export function cabinMinimum(typeId: string, seats: number): number {
  if (seats <= 19) return 0;
  const c = ACMI_TYPES[typeId]?.crew;
  if (!c) return Math.max(1, per50(seats));
  const up = upperDeckSeats(typeId, seats);
  const main = seats - up;
  let n = Math.max(floorFor(c.floor, main), per50(main));
  if (c.upper && up > 0) n += Math.max(floorFor(c.upper.floor, up), per50(up));
  return Math.max(1, n);
}

/** v0.10 cabin crew seats (jump seats) of a type: crew beyond them sit in passenger seats. */
export const cabinCrewSeats = (typeId: string): number => ACMI_TYPES[typeId]?.crew?.seats ?? 99;

/** v0.10 cockpit seats: the two pilots' and the observer seats (relief and spare pilots beyond them sit in the cabin). */
export const cockpitSeats = (typeId: string): number => 2 + (ACMI_TYPES[typeId]?.crew?.observers ?? 2);

/** v0.10 optional extra cabin crew a cabin still has jump seats for, above the minimum and the crew the duty must carry. */
export const extraCabinRoom = (typeId: string, seats: number, required = 0): number => Math.max(0, cabinCrewSeats(typeId) - Math.max(cabinMinimum(typeId, seats), 1) - required);

/** v0.10 passenger seats taken by crew on board: cabin crew beyond the jump seats and pilots beyond the cockpit's seats. */
export function crewInPaxSeats(typeId: string, roles: readonly Role[]): number {
  let pilots = 0, cabin = 0;
  for (const r of roles) (r === 'CPT' || r === 'FO' || r === 'CRP' ? pilots++ : cabin++);
  return Math.max(0, cabin - cabinCrewSeats(typeId)) + Math.max(0, pilots - cockpitSeats(typeId));
}

/** Report before the first departure and post-flight duty, minutes (RESEARCH §5.6). */
export function reportMinutes(typeId: string): { report: number; post: number } {
  return typeOf(typeId).body === 'wide' ? { report: 90, post: 45 } : { report: 60, post: 30 };
}

/**
 * Crew for one duty. `augment` comes from the duty's plan (ULR types get 4 pilots only on sectors that need it).
 * v0.7.3 `restCabin`: extra cabin crew the in-flight rest plan needs (crew/restPlan.ts; on augmented duties only).
 */
export function complement(typeId: string, seats: number, opts: { augment?: 0 | 1 | 2; extraCabin?: number; restCabin?: number } = {}): Role[] {
  const t = typeOf(typeId);
  const augment = opts.augment ?? 0;
  const cockpit: Role[] = augment === 2 ? ['CPT', 'CPT', 'FO', 'FO'] : augment === 1 ? ['CPT', 'FO', 'CRP'] : ['CPT', 'FO'];
  const restCabin = augment > 0 ? Math.max(0, Math.round(opts.restCabin ?? 0)) : 0;
  const cabinN = Math.max(cabinMinimum(typeId, seats), 1) + (opts.extraCabin ?? 0) + restCabin;
  // v0.7.2: exactly one purser (the SCCM); a second (deputy, upper deck) only on two-deck types.
  const cabin: Role[] = ['PUR'];
  if (t.pursers === 2 && cabinN >= 2) cabin.push('PUR');
  while (cabin.length < cabinN) cabin.push('CC');
  return [...cockpit, ...cabin];
}

/**
 * Roles that may fill a slot (seniors can fly junior positions). v0.7.2: a captain may sit in an FO or CRP seat
 * (the auto-roster only when no FO is free); never an FO as captain; a purser may work a CC position.
 */
export function canFill(slot: Role, role: Role): boolean {
  if (slot === role) return true;
  if (slot === 'FO') return role === 'CPT';
  if (slot === 'CRP') return role === 'FO' || role === 'CPT';
  if (slot === 'CC') return role === 'PUR';
  return false;
}

/** v0.7.2 seat label: 'CPT (as FO)' when someone senior sits in a junior seat, else the seat's role. */
export function seatLabel(slot: Role, role: Role): string {
  return slot === role ? slot : `${role} (as ${slot})`;
}

export const isPilot = (r: Role) => r === 'CPT' || r === 'FO' || r === 'CRP';
