// Aircraft performance and fit: block times, range and tech stops, runway and ETOPS fit,
// crew complements. Pure functions shared by contracts, crew and ops (DESIGN.md §5.2–5.5).

import { ACMI_TYPES, type AcmiType } from '../../data/acmiTypes';
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

function viaStops(typeId: string, from: string, to: string): SectorPlan {
  const fits = (a: string, b: string) => runwayFit(typeId, b) !== 'no' && distanceNm(a, b) <= maxSectorNm(typeId, a, b);
  const cands = AIRPORTS.filter((x) => x.code !== from && x.code !== to && runwayFit(typeId, x.code) === 'ok');
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
  if (!best) return { ok: false, legs: [], techStops: [], reason: 'range' };
  const pts = [from, ...best.stops, to];
  const legs = pts.slice(1).map((b, i) => ({ from: pts[i], to: b, block: blockMinutes(typeId, pts[i], b) }));
  return { ok: true, legs, techStops: best.stops };
}

const etopsCache = new Map<string, number>();

/**
 * ETOPS minutes needed for a direct sector by a twin: the largest distance from the track to an adequate
 * airport, flown at single-engine speed (≈ 0.85 × cruise), bucketed to 0/120/180/240/330.
 */
export function etopsNeeded(typeId: string, from: string, to: string): number {
  const t = typeOf(typeId);
  if (t.engines === 4) return 0;
  const key = `${t.cruiseKt}:${from}:${to}`;
  const hit = etopsCache.get(key);
  if (hit !== undefined) return hit;
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  const adequate = AIRPORTS.filter((x) => x.runwayM >= ADEQUATE_RUNWAY_M);
  const n = Math.max(2, Math.ceil(distanceNm(from, to) / 150));
  let worstNm = 0;
  for (let i = 1; i < n; i++) {
    const [lon, lat] = interpolateGC(A.lon, A.lat, B.lon, B.lat, i / n);
    let near = Infinity;
    for (const x of adequate) near = Math.min(near, haversine(lat, lon, x.lat, x.lon) / 1.852);
    worstNm = Math.max(worstNm, near);
  }
  const minutes = (worstNm / (t.cruiseKt * 0.85)) * 60;
  const need = minutes <= 60 ? 0 : minutes <= 120 ? 120 : minutes <= 180 ? 180 : minutes <= 240 ? 240 : 330;
  etopsCache.set(key, need);
  return need;
}

// ---------- crew complements ----------

/** EASA ORO.CC.100: one cabin crew per 50 installed seats (at least one above 19 seats). */
export function cabinMinimum(seats: number): number {
  return seats <= 19 ? 0 : Math.max(1, Math.ceil(seats / 50));
}

/** Report before the first departure and post-flight duty, minutes (RESEARCH §5.6). */
export function reportMinutes(typeId: string): { report: number; post: number } {
  return typeOf(typeId).body === 'wide' ? { report: 90, post: 45 } : { report: 60, post: 30 };
}

/**
 * Crew positions for one duty. augment: extra pilots (1 → CRP relief, 2 → a second CPT + FO).
 * Cabin: SCCM (CSD on widebodies, else SCC) + a widebody No. 2 (SCC) from 8 cabin crew, rest CC.
 */
export function complement(typeId: string, seats: number, opts: { augment?: 0 | 1 | 2; extraCabin?: number } = {}): Role[] {
  const t = typeOf(typeId);
  const augment = Math.max(opts.augment ?? 0, t.cockpitMin === 4 ? 2 : 0);
  const cockpit: Role[] = augment === 2 ? ['CPT', 'CPT', 'FO', 'FO'] : augment === 1 ? ['CPT', 'FO', 'CRP'] : ['CPT', 'FO'];
  const cabinN = Math.max(cabinMinimum(seats), 1) + (opts.extraCabin ?? 0);
  const cabin: Role[] = [t.body === 'wide' ? 'CSD' : 'SCC'];
  if (t.body === 'wide' && cabinN >= 8) cabin.push('SCC');
  while (cabin.length < cabinN) cabin.push('CC');
  return [...cockpit, ...cabin];
}

/** Roles that may fill a slot (seniors can fly junior positions). */
export function canFill(slot: Role, role: Role): boolean {
  if (slot === role) return true;
  if (slot === 'CRP') return role === 'FO';
  if (slot === 'SCC') return role === 'CSD';
  if (slot === 'CC') return role === 'SCC' || role === 'CSD';
  return false;
}

export const isPilot = (r: Role) => r === 'CPT' || r === 'FO' || r === 'CRP';
