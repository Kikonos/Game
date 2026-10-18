// World geometry, bundled with the app (Natural Earth 1:50m via world-atlas) so
// the map works offline.

import { geoGraticule10, geoMercator, geoPath, type GeoProjection } from 'd3-geo';
import type { MultiLineString, MultiPolygon } from 'geojson';
import { merge, mesh } from 'topojson-client';

let land: MultiPolygon | null = null;
let borders: MultiLineString | null = null;

export const MAP_W = 2000;
export const MAP_H = 1193;

export async function loadMapData(): Promise<void> {
  if (land) return;
  const mod = await import('world-atlas/countries-50m.json');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topo = (mod.default ?? mod) as any;
  land = merge(topo, topo.objects.countries.geometries);
  borders = mesh(topo, topo.objects.countries, (a: unknown, b: unknown) => a !== b) as MultiLineString;
}

export function mapReady(): boolean {
  return land !== null;
}

const projections = new Map<number, GeoProjection>();

export function projection(rotate = 0): GeoProjection {
  let p = projections.get(rotate);
  if (!p) {
    p = geoMercator()
      .scale(MAP_W / (2 * Math.PI))
      .translate([MAP_W / 2, 774])
      .rotate([rotate, 0])
      .precision(0.3);
    projections.set(rotate, p);
  }
  return p;
}

const pathCache = new Map<number, { land: string; borders: string; graticule: string }>();

export function basePaths(rotate = 0) {
  let c = pathCache.get(rotate);
  if (!c && land && borders) {
    const path = geoPath(projection(rotate));
    c = {
      land: path(land) ?? '',
      borders: path(borders) ?? '',
      graticule: path(geoGraticule10()) ?? '',
    };
    pathCache.set(rotate, c);
  }
  return c ?? { land: '', borders: '', graticule: '' };
}
