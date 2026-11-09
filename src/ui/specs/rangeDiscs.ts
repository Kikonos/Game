// v0.18 "Range from" discs on the spec sheet; v0.19.2 a flat map inside the circle (player: "the range circles should
// be a flat map, not a globe — still inside a circle, just a flat map"): an equirectangular map centred on the city's
// longitude (and on its latitude as far as the map allows: no empty polar caps), the land from Natural Earth 1:110m
// (world-atlas, loaded with the spec sheet's chunk), and the full-payload range as the true geodesic boundary (d3
// geoCircle: every point the range away along a great circle), which a flat map shows stretched towards the poles.
// Static SVG strings, cached; colours from the map tokens (light and dark).

import { geoCircle, geoEquirectangular, geoGraticule10, geoPath } from 'd3-geo';
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

/** How far the disc shows around the city (degrees of arc, kept for the old tests): 60 % more than the range, 55–180°. */
export const discExtentDeg = (nm: number) => Math.min(180, Math.max(55, nmToDeg(nm) * 1.6));

/** v0.19.2 degrees of longitude across the disc: the range ring's width and some room, 70° to 240°. Pure. */
export const discWidthDeg = (nm: number) => Math.min(240, Math.max(70, nmToDeg(nm) * 2.6));

/** The latitude at the disc's centre: the city's, moved towards the equator only as far as needed to keep more than
 *  20° of empty space off either pole. Pure. */
export function discCentreLat(lat: number, widthDeg: number): number {
  const lim = Math.max(0, 90 - widthDeg / 2 + 20);
  return Math.max(-lim, Math.min(lim, lat));
}

const cache = new Map<string, string>();
let uid = 0;

/** One disc (`size` px square): the flat map around the city, the range region and boundary, the city dot. */
export function discSvg(lat: number, lon: number, nm: number, size = 128): string {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)},${Math.round(nm)},${size},${land ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = size / 2;
  const r = c - 1.5;
  const wDeg = discWidthDeg(nm);
  const k = (2 * r) / wDeg;
  const cLat = discCentreLat(lat, wDeg);
  // Equirectangular: one degree is k px both ways; rotated to the city's longitude, shifted to its (clamped) latitude.
  const proj = geoEquirectangular().rotate([-lon, 0]).scale((k * 180) / Math.PI).translate([c, c + k * cLat])
    .clipExtent([[c - r - 2, c - r - 2], [c + r + 2, c + r + 2]]).precision(0.4);
  const path = geoPath(proj);
  const f = (v: number) => Math.round(v * 10) / 10;
  const landD = land ? path(land) ?? '' : '';
  const grat = path(geoGraticule10()) ?? '';
  const ring = rangeRing(lat, lon, nm, 1.5);
  // The region filled, its boundary stroked as a line (a ring over a pole would otherwise stroke the map's edge too).
  const fillD = path({ type: 'Polygon', coordinates: [ring] }) ?? '';
  const ringD = path({ type: 'LineString', coordinates: ring }) ?? '';
  const city = proj([lon, lat]) ?? [c, c];
  // The map's top and bottom (the poles) inside the disc, when the window reaches past them.
  const yN = c + k * (cLat - 90);
  const yS = c + k * (cLat + 90);
  const id = `rdc${(uid = (uid + 1) % 1e6)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="rd-svg flat" aria-hidden="true">`
    + `<defs><clipPath id="${id}"><circle cx="${c}" cy="${c}" r="${f(r)}"/></clipPath></defs>`
    + `<circle class="rd-void" cx="${c}" cy="${c}" r="${f(r)}"/>`
    + `<g clip-path="url(#${id})">`
    + `<rect class="rd-sea" x="0" y="${f(Math.max(0, yN))}" width="${size}" height="${f(Math.min(size, yS) - Math.max(0, yN))}"/>`
    + `<path class="rd-grat" d="${grat}"/>`
    + `<path class="rd-land" d="${landD}"/>`
    + `<path class="rd-range-fill" d="${fillD}"/>`
    + `<path class="rd-range" d="${ringD}"/>`
    + `</g>`
    + `<circle class="rd-rim" cx="${c}" cy="${c}" r="${f(r)}"/>`
    + `<circle class="rd-city" cx="${f(city[0])}" cy="${f(city[1])}" r="2.6"/></svg>`;
  if (cache.size > 80) cache.clear();
  cache.set(key, svg);
  return svg;
}
