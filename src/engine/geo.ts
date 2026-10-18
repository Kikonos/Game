import { AIRPORT_BY_CODE } from '../data/airports';
import { pairKey } from './util';

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

const distCache = new Map<string, number>();

/** Great-circle distance between two airports in km. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const key = pairKey(a, b);
  let d = distCache.get(key);
  if (d === undefined) {
    const A = AIRPORT_BY_CODE[a];
    const B = AIRPORT_BY_CODE[b];
    d = Math.round(haversine(A.lat, A.lon, B.lat, B.lon));
    distCache.set(key, d);
  }
  return d;
}

/** Point at fraction t along the great circle, as [lon, lat]. */
export function interpolateGC(lon1: number, lat1: number, lon2: number, lat2: number, t: number): [number, number] {
  const φ1 = toRad(lat1), λ1 = toRad(lon1), φ2 = toRad(lat2), λ2 = toRad(lon2);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [lon1, lat1];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [(Math.atan2(y, x) * 180) / Math.PI, (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI];
}
