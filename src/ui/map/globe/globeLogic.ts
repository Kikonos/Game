// v0.15 the 3D globe: pure maths and data for the globe view (no three.js, no DOM), so it can be tested. Positions
// come from the same engine queries as the flat Ops Map (aircraftLive, the dry-lease show legs, the airline legs our
// crew and travellers ride), placed on a unit sphere: x towards 0°E on the equator, y to the north pole, z towards
// 90°W (the orientation three.js uses to wrap an equirectangular texture round a sphere).

import { AIRPORT_BY_CODE } from '../../../data/airports';
import { aircraftLive, divPos, flightTimes } from '../../../engine/core/query';
import { interpolateGC } from '../../../engine/core/geo';
import type { Flight, GameState } from '../../../engine/core/types';
import { leaseShowOf, showAt, type ShowLeg } from '../dryShow';
import { leasedOut, onMap, sunPoint } from '../mapLogic';
import { mapPxPerM } from '../silhouettes';
import { NIGHT_FROM, NIGHT_FULL } from '../sky';

export type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

/** v0.15 a point on the unit sphere for [lon, lat] (degrees). */
export function vecOf(lon: number, lat: number, r = 1): Vec3 {
  const cl = Math.cos(lat * RAD);
  return [r * cl * Math.cos(lon * RAD), r * Math.sin(lat * RAD), -r * cl * Math.sin(lon * RAD)];
}

/** v0.15 [lon, lat] (degrees) of a direction. */
export function lonLatOf(v: Vec3): [number, number] {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [Math.atan2(-v[2], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[1] / n))) / RAD];
}

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function norm(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** v0.15 the sun's direction at game minute t (the subsolar point the flat map's night uses). */
export const sunVec = (t: number): Vec3 => vecOf(...sunPoint(t));

/**
 * v0.15 the night shade's band on sin(sun elevation), the same as the flat map's (sky.ts): no shade above +0.8°, full
 * night below −14°. The shader eases between them with the same smoothstep.
 */
export const NIGHT_S: [number, number] = [Math.sin(NIGHT_FROM * RAD), Math.sin(NIGHT_FULL * RAD)];

/**
 * v0.15 is a point on the sphere on the camera's side (not hidden behind the Earth)? `margin`: the cosine of the angle
 * between the ground's normal and the line of sight must exceed it (0: anywhere in front; 0.3: away from the limb).
 */
export const facing = (p: Vec3, cam: Vec3, margin = 0) => dot(norm(p), norm(sub(cam, p))) > margin;

// ---------- the camera ----------

/** Camera distance from the Earth's centre (Earth radii): close (about 1,500 km across an iPad) to the whole globe. */
export const DIST_MIN = 1.22;
export const DIST_MAX = 5.6;
export const DIST_START = 4.1;
/** Vertical field of view (deg). */
export const FOV = 32;
/** Latitude the camera stops at (no flipping over the poles). */
export const LAT_MAX = 82;

export interface Orbit { lon: number; lat: number; dist: number }

/** Camera position for an orbit (looking at the Earth's centre). */
export const camOf = (o: Orbit): Vec3 => vecOf(o.lon, o.lat, o.dist);

/** v0.18 the camera's tilt at the closest zoom (deg from straight down) and the distance it starts at (Earth radii). */
export const GLOBE_TILT_MAX = 40;
export const GLOBE_TILT_FROM = 1.9;

/**
 * v0.18 the camera's tilt (deg) at a distance: none from GLOBE_TILT_FROM out, easing in (smoothstep) to `max` at the
 * closest zoom, so close up the ground leans away towards a horizon and the aircraft and their arcs show in 3D. Pure.
 */
export function globeTilt(dist: number, max = GLOBE_TILT_MAX): number {
  if (!(dist < GLOBE_TILT_FROM) || max <= 0) return 0;
  const x = Math.min(1, (GLOBE_TILT_FROM - dist) / (GLOBE_TILT_FROM - DIST_MIN));
  return max * x * x * (3 - 2 * x);
}

/** v0.18 where the camera is and its screen axes in the world (right, up; fwd into the screen). */
export interface CamView { pos: Vec3; fwd: Vec3; right: Vec3; up: Vec3; target: Vec3 }

/**
 * v0.18 the camera for an orbit and a tilt: it looks at the ground point under the orbit (lon, lat), from (dist − 1)
 * away, leaning back to the south by `tilt` degrees (north stays up on screen). With no tilt it is camOf looking at the
 * Earth's centre. Pure.
 */
export function camView(o: Orbit, tilt = 0): CamView {
  const n = vecOf(o.lon, o.lat);
  const { north } = tangentsAt([o.lon, o.lat]);
  const a = o.dist - 1;
  const t = tilt * RAD;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const pos: Vec3 = [n[0] + a * (c * n[0] - s * north[0]), n[1] + a * (c * n[1] - s * north[1]), n[2] + a * (c * n[2] - s * north[2])];
  const fwd = norm(sub(n, pos));
  const right = norm(cross(fwd, north));
  return { pos, fwd, right, up: cross(right, fwd), target: n };
}

/** v0.18 project for a CamView (any tilt): css px from the top left, null behind the camera. */
export function projectView(p: Vec3, v: CamView, w: number, h: number, fov = FOV): ScreenPt | null {
  const d = sub(p, v.pos);
  const z = dot(d, v.fwd);
  if (z <= 1e-6) return null;
  const f = h / 2 / Math.tan((fov / 2) * RAD);
  return { x: w / 2 + (dot(d, v.right) / z) * f, y: h / 2 - (dot(d, v.up) / z) * f };
}

/** −180..180. */
export const wrap180 = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
export const clampLat = (lat: number) => Math.max(-LAT_MAX, Math.min(LAT_MAX, lat));
export const clampDist = (d: number) => Math.max(DIST_MIN, Math.min(DIST_MAX, d));

/** World units per screen px at the point of the Earth nearest the camera (perspective camera, `viewH` css px tall). */
export const worldPerPx = (dist: number, viewH: number, fov = FOV) => (2 * (dist - 1) * Math.tan((fov / 2) * RAD)) / Math.max(1, viewH);

/**
 * Degrees the globe turns per screen px dragged: the point under the finger stays under it (near the middle of the
 * disc), whatever the zoom.
 */
export const degPerPx = (dist: number, viewH: number, fov = FOV) => worldPerPx(dist, viewH, fov) / RAD;

/**
 * The flat map's zoom with the same screen px per km at the middle of the globe: the aircraft use the flat map's
 * px-per-metre rule (mapPxPerM) at this zoom, so they are drawn the same size on both views.
 */
export const equivZoom = (wpp: number, viewW: number) => (2 * Math.PI) / (Math.max(1e-9, wpp) * Math.max(1, viewW));

/** Px per metre for the aircraft at a camera distance (the flat map's rule, at the same scale). */
export const globePxPerM = (dist: number, viewW: number, viewH: number) => mapPxPerM(equivZoom(worldPerPx(dist, viewH), viewW));

/** Inertia: the drag's speed (deg per ms) decays to a stop in about a second. */
export const SPIN_DECAY_MS = 325;
export function stepInertia(v: [number, number], dt: number): [number, number] {
  const f = Math.exp(-dt / SPIN_DECAY_MS);
  const out: [number, number] = [v[0] * f, v[1] * f];
  return Math.hypot(out[0], out[1]) < 0.0004 ? [0, 0] : out;
}

/** Idle spin (deg of longitude per second; the Earth turns west to east as seen from space) and the wait before it. */
export const IDLE_SPIN_DEG_S = 2.4;
export const IDLE_AFTER_MS = 8000;

/** A smooth flight of the camera from one orbit to another: f in 0..1 (eased), longitude the short way round. */
export function lerpOrbit(a: Orbit, b: Orbit, f: number): Orbit {
  const e = f <= 0 ? 0 : f >= 1 ? 1 : f * f * (3 - 2 * f);
  return { lon: wrap180(a.lon + wrap180(b.lon - a.lon) * e), lat: a.lat + (b.lat - a.lat) * e, dist: a.dist + (b.dist - a.dist) * e };
}

/** Angle (deg) between two [lon, lat] points (great-circle). */
export function angleBetween(a: [number, number], b: [number, number]): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(vecOf(...a), vecOf(...b))))) / RAD;
}

/**
 * Where to aim the camera so the point `at` shows in the middle of the area clear of the side panel: `shiftPx` screen
 * px left of the centre (the camera turns a little east of it).
 */
export function aimAt(at: [number, number], dist: number, viewH: number, shiftPx = 0): { lon: number; lat: number } {
  const dLon = (shiftPx * degPerPx(dist, viewH)) / Math.max(0.2, Math.cos(at[1] * RAD));
  return { lon: wrap180(at[0] + dLon), lat: clampLat(at[1]) };
}

// ---------- colours ----------

/** '#rgb', '#rrggbb', 'rgb(r, g, b)', 'rgba(r, g, b, a)' or 'r, g, b' → [r, g, b, a] in 0..1 (sRGB); `dflt` otherwise. */
export function parseColour(s: string | null | undefined, dflt: [number, number, number, number] = [1, 1, 1, 1]): [number, number, number, number] {
  const t = (s ?? '').trim();
  let m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [...m[1].split('').map((c) => parseInt(c + c, 16) / 255), 1] as [number, number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(t);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  const inner = /^rgba?\(([^)]*)\)$/i.exec(t)?.[1] ?? t;
  const parts = inner.split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
    const a = parts.length >= 4 && Number.isFinite(parts[3]) ? parts[3] : 1;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, Math.max(0, Math.min(1, a))];
  }
  return dflt;
}

/** A dash pattern ('6 5', screen px) as [on, off]; '' (solid) → null. */
export function dashOf(s: string): [number, number] | null {
  const p = s.split(/[\s,]+/).filter(Boolean).map(Number);
  return p.length >= 2 && p.every((x) => Number.isFinite(x) && x >= 0) && p[0] + p[1] > 0 ? [p[0], p[1]] : null;
}

// ---------- tracks ----------

/** Samples along a leg for its arc: N + 1 [lon, lat] at even times from off- to on-blocks (diverted legs turn where they did). */
export function legTrack(f: Pick<Flight, 'from' | 'to' | 'div' | 'atd' | 'std' | 'delay' | 'ata' | 'eta' | 'block'>): [number, number][] {
  const A = AIRPORT_BY_CODE[f.from];
  const B = AIRPORT_BY_CODE[f.to];
  if (!A || !B) return [];
  const { off, on } = flightTimes(f as Flight);
  const n = arcSamples(angleBetween([A.lon, A.lat], [B.lon, B.lat]));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push(f.div ? divPos(f as Flight, off + ((on - off) * i) / n) : interpolateGC(A.lon, A.lat, B.lon, B.lat, i / n));
  return out;
}

/** Samples of the great circle between two airports (an arc with no times: next legs, tours, airline legs). */
export function gcTrack(from: string, to: string): [number, number][] {
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  if (!A || !B) return [];
  const n = arcSamples(angleBetween([A.lon, A.lat], [B.lon, B.lat]));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push(interpolateGC(A.lon, A.lat, B.lon, B.lat, i / n));
  return out;
}

/**
 * v0.18 how high a leg's arc rises at its middle (Earth radii) for a sector of `deg` degrees: a short hop barely
 * leaves the ground, an ocean crossing rises clear of it (about 0.012 for 1,000 km, 0.05 at 9,000 km, at most 0.06).
 */
export function arcLift(deg: number): number {
  const f = Math.max(0, Math.min(1, deg / 100));
  return 0.006 + 0.054 * f ** 0.85;
}

/** v0.18 the arc's height (Earth radii) at share s (0..1) along a leg lifting `lift` at its middle: a full arch. */
export const liftAt = (lift: number, s: number) => (lift > 0 && s > 0 && s < 1 ? lift * Math.sin(Math.PI * s) ** 0.75 : 0);

/**
 * v0.18 is world point p hidden behind the Earth from the camera at `cam` (the ray meets the sphere of radius r first)?
 * A point on the ground on the near side, or lifted clear above the limb, is not.
 */
export function occluded(p: Vec3, cam: Vec3, r = 0.998): boolean {
  const d = sub(p, cam);
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-9) return false;
  const u: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
  const b = dot(cam, u);
  const c = dot(cam, cam) - r * r;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const t0 = -b - Math.sqrt(disc);
  return t0 > 0 && t0 < L;
}

/** Segments for an arc of `deg` degrees: about one per 1.2° (smooth on the sphere), 8 to 128. */
export const arcSamples = (deg: number) => Math.max(8, Math.min(128, Math.ceil(deg / 1.2)));

// ---------- our aircraft ----------

export interface GlobeAc {
  id: string;
  typeId: string;
  /** Where it is now [lon, lat]. */
  pos: [number, number];
  airborne: boolean;
  /** Its leg (our flight, or a dry-lease show leg) and how far along (0..1). */
  flight?: Flight;
  show?: ShowLeg;
  progress: number;
  /** A point a little further along the track (heading), airborne only. */
  ahead?: [number, number];
  /** The airport it stands at, on the ground. */
  at?: string;
}

/**
 * v0.15 every aircraft of ours on the globe at game minute t: the flat map's rules (aircraftLive; not yet handed over:
 * not drawn; dry-leased out: flying the lessee's cosmetic legs or parked where the last one landed).
 */
export function globeFleet(g: GameState, t: number): GlobeAc[] {
  const out: GlobeAc[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (!AIRPORT_BY_CODE[ac.at] || !onMap(ac)) continue;
    const live = aircraftLive(g, ac, t);
    if (live.phase === 'airborne' && live.flight) {
      out.push({ id: ac.id, typeId: ac.typeId, pos: live.pos, airborne: true, flight: live.flight, progress: live.progress, ahead: live.ahead });
      continue;
    }
    const ls = leasedOut(ac) ? leaseShowOf(g, ac) : null;
    if (ls) {
      const sa = showAt(ac.id, ac.typeId, ls.site, ls.prefix, t);
      if ('leg' in sa) {
        const A = AIRPORT_BY_CODE[sa.leg.from];
        const B = AIRPORT_BY_CODE[sa.leg.to];
        if (A && B) {
          out.push({
            id: ac.id, typeId: ac.typeId, airborne: true, show: sa.leg, progress: sa.progress,
            pos: interpolateGC(A.lon, A.lat, B.lon, B.lat, sa.progress), ahead: interpolateGC(A.lon, A.lat, B.lon, B.lat, Math.min(1, sa.progress + 0.01)),
          });
          continue;
        }
      } else if (AIRPORT_BY_CODE[sa.at]) {
        const A = AIRPORT_BY_CODE[sa.at];
        out.push({ id: ac.id, typeId: ac.typeId, pos: [A.lon, A.lat], airborne: false, progress: 0, at: sa.at });
        continue;
      }
    }
    out.push({ id: ac.id, typeId: ac.typeId, pos: live.pos, airborne: false, progress: 0, at: live.at });
  }
  return out;
}

/**
 * The heading of something at `p` moving towards `q` ([lon, lat]) as a unit tangent on the sphere (nose direction);
 * north when they coincide.
 */
export function headingVec(p: [number, number], q: [number, number] | undefined): Vec3 {
  const n = vecOf(...p);
  const north: Vec3 = norm(sub([0, 1, 0], [n[0] * n[1], n[1] * n[1], n[2] * n[1]]));
  if (!q) return north;
  const d = sub(vecOf(...q), n);
  const tan = sub(d, [n[0] * dot(d, n), n[1] * dot(d, n), n[2] * dot(d, n)]);
  return Math.hypot(...tan) < 1e-9 ? north : norm(tan);
}

/** East and north unit tangents at a point (a parked aircraft's stand offset is laid out in them). */
export function tangentsAt(p: [number, number]): { east: Vec3; north: Vec3 } {
  const lon = p[0] * RAD;
  const lat = p[1] * RAD;
  return {
    east: [-Math.sin(lon), 0, -Math.cos(lon)],
    north: [-Math.sin(lat) * Math.cos(lon), Math.cos(lat), Math.sin(lat) * Math.sin(lon)],
  };
}

// ---------- picking ----------

export interface ScreenPt { x: number; y: number }

/**
 * Screen position (css px, from the top left) of a world point for a camera at `cam` looking at the origin with
 * world-up y, field of view `fov` (deg), in a `w` × `h` view. null behind the camera.
 */
export function project(p: Vec3, cam: Vec3, w: number, h: number, fov = FOV): ScreenPt | null {
  const fwd = norm([-cam[0], -cam[1], -cam[2]]);
  let right = cross(fwd, [0, 1, 0]);
  if (Math.hypot(...right) < 1e-9) right = [1, 0, 0];
  right = norm(right);
  const up = cross(right, fwd);
  const d = sub(p, cam);
  const z = dot(d, fwd);
  if (z <= 1e-6) return null;
  const f = h / 2 / Math.tan((fov / 2) * RAD);
  return { x: w / 2 + (dot(d, right) / z) * f, y: h / 2 - (dot(d, up) / z) * f };
}
