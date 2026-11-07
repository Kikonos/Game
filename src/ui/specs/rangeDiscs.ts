// v0.18.1 "Range from" discs on the spec sheet: the world around a city on an azimuthal equidistant projection (the
// distance from the centre true in every direction, so the full-payload range is an exact circle), the land from
// Natural Earth 1:110m (world-atlas, loaded with the spec sheet's chunk), the range circle drawn geodesically
// (d3 geoCircle: every point the range away along a great circle). Static SVG strings, cached.

import { geoAzimuthalEquidistant, geoCircle, geoGraticule10, geoPath } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';

const EARTH_NM = 3440.065;
let land: MultiPolygon | Polygon | null = null;
let loading: Promise<void> | null = null;

/** Loads the 1:110m land once (about 55 KB). */
export function loadDiscLand(): Promise<void> {
  if (land) return Promise.resolve();
  loading ??= import('world-atlas/land-110m.json').then((mod) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const topo = ((mod as any).default ?? mod) as any;
    const f = feature(topo, topo.objects.land) as unknown as { features?: { geometry: MultiPolygon }[]; geometry?: MultiPolygon };
    land = f.features ? { type: 'MultiPolygon', coordinates: f.features.flatMap((x) => (x.geometry.type === 'MultiPolygon' ? x.geometry.coordinates : [(x.geometry as unknown as Polygon).coordinates])) } : (f.geometry ?? null);
  });
  return loading;
}
export const discLandReady = () => land !== null;

/** The great-circle radius in degrees of a distance in nautical miles. Pure. */
export const nmToDeg = (nm: number) => (nm / EARTH_NM) * (180 / Math.PI);

/** The range circle as a ring of [lon, lat] points (geodesic). Pure. */
export function rangeRing(lat: number, lon: number, nm: number, step = 4): [number, number][] {
  const c = geoCircle().center([lon, lat]).radius(nmToDeg(nm)).precision(step)();
  return c.coordinates[0] as [number, number][];
}

/** How far the disc shows around the city: a third more than the range, at least 40°, at most the whole world. */
export const discExtentDeg = (nm: number) => Math.min(180, Math.max(40, nmToDeg(nm) * 1.35));

const cache = new Map<string, string>();

/** One disc (`size` px square) centred on the city, the range circle and the city dot. */
export function discSvg(lat: number, lon: number, nm: number, size = 128): string {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(nm)},${size},${land ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = size / 2 - 1.5;
  const ext = discExtentDeg(nm);
  const proj = geoAzimuthalEquidistant().rotate([-lon, -lat]).clipAngle(ext - 0.01).scale(r / ((ext * Math.PI) / 180)).translate([size / 2, size / 2]).precision(0.6);
  const path = geoPath(proj);
  const f = (v: number) => Math.round(v * 10) / 10;
  const landD = land ? path(land) ?? '' : '';
  const grat = path(geoGraticule10()) ?? '';
  const ringD = path({ type: 'Polygon', coordinates: [rangeRing(lat, lon, nm, 2)] }) ?? '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="rd-svg" aria-hidden="true">`
    + `<circle class="rd-sea" cx="${size / 2}" cy="${size / 2}" r="${f(r)}"/>`
    + `<path class="rd-grat" d="${grat}"/>`
    + `<path class="rd-land" d="${landD}"/>`
    + `<path class="rd-range" d="${ringD}"/>`
    + `<circle class="rd-rim" cx="${size / 2}" cy="${size / 2}" r="${f(r)}"/>`
    + `<circle class="rd-city" cx="${size / 2}" cy="${size / 2}" r="2.6"/></svg>`;
  if (cache.size > 80) cache.clear();
  cache.set(key, svg);
  return svg;
}
