// "Range from" discs on the spec sheet. v0.18: the world around a city on an azimuthal equidistant projection (the
// distance from the centre true in every direction, so the full-payload range is an exact circle). v0.19.2 tried a
// flat (equirectangular) map in the circle; v0.19.5 (player's report bmwalwl3kkqo9: "Why did the range circles look so
// weird? ... turn them back into a globe") back to the globe, zoomed to the range: on a flat map a 737's 5,000 km from
// London, New York or Beijing reaches past the North Pole, so the boundary ran off the top of the disc, the map ended in
// a blank band above the pole and the shape was stretched. Every type flies at least 4,600 km and three of the five
// cities sit 40–52° north, so no flat projection keeps the whole range inside the disc; the globe does for every range.
// The land from Natural Earth 1:110m (world-atlas, loaded with the spec sheet's chunk), in the flat map's colours with
// a coastline; the range drawn geodesically (d3 geoCircle). Static SVG strings, cached; colours from the map tokens.

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

/** v0.19.5 the share of the disc's radius the range fills at most (the rest is the margin around it). */
export const DISC_FILL = 0.8;

/**
 * How far the disc shows around the city (degrees of arc to its rim): v0.19.5 zoomed to the range, the range at
 * DISC_FILL of the radius, at least 40° (short ranges keep some world around them), at most the whole world. Pure.
 */
export const discExtentDeg = (nm: number) => Math.min(180, Math.max(40, nmToDeg(nm) / DISC_FILL));

const cache = new Map<string, string>();

/** One disc (`size` px square) centred on the city: the world within discExtentDeg, the range region and circle. */
export function discSvg(lat: number, lon: number, nm: number, size = 128): string {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(nm)},${size},${land ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = size / 2;
  const r = c - 1.5;
  const ext = discExtentDeg(nm);
  // The projection's clip circle is the disc's rim: the map fills the disc to its edge (no band, no empty corner).
  const proj = geoAzimuthalEquidistant().rotate([-lon, -lat]).clipAngle(ext - 0.01).scale(r / ((ext * Math.PI) / 180)).translate([c, c]).precision(0.3);
  const path = geoPath(proj);
  const f = (v: number) => Math.round(v * 10) / 10;
  const landD = land ? path(land) ?? '' : '';
  const grat = path(geoGraticule10()) ?? '';
  const ring = rangeRing(lat, lon, nm, 1.5);
  // The region filled under the circle, the circle stroked on top: one closed shape, centred on the city.
  const fillD = path({ type: 'Polygon', coordinates: [ring] }) ?? '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="rd-svg globe" aria-hidden="true">`
    + `<circle class="rd-sea" cx="${c}" cy="${c}" r="${f(r)}"/>`
    + `<path class="rd-grat" d="${grat}"/>`
    + `<path class="rd-land" d="${landD}"/>`
    + `<path class="rd-range" d="${fillD}"/>`
    + `<circle class="rd-rim" cx="${c}" cy="${c}" r="${f(r)}"/>`
    + `<circle class="rd-city" cx="${c}" cy="${c}" r="2.6"/></svg>`;
  if (cache.size > 80) cache.clear();
  cache.set(key, svg);
  return svg;
}
