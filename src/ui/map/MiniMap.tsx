// v0.7.1 mini-map for "who is where" (UPDATE-0.7.1.md §5, §3.8): a static inline SVG (400 × 180 by default) with the
// land under a Mercator fitted to the spec's airports (±8°), the crew's grey dots, a ring at the airport they are
// needed at, and a dashed line per leg they would take with an airline-plane or business-jet glyph at its middle and
// the flight's label and times. Built once per spec (memo); nothing animates.

import { geoInterpolate, geoMercator, geoPath } from 'd3-geo';
import type { Polygon } from 'geojson';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtTime } from '../../engine/core/time';
import type { MiniMapSpec } from '../../engine/ops';
import { PLANE_PATH } from '../components/Logo';
import { landPathFor } from './mapData';
import { headingDeg, JET_PATH } from './mapLogic';

const H_OF_W = 180 / 400;
const PAD_DEG = 8;
const INSET = 10;

interface Built {
  land: string;
  aps: { code: string; x: number; y: number; crew: number; dep: boolean }[];
  legs: { d: string; x: number; y: number; ang: number; jet: boolean; label: string; times: string }[];
}

/** Everything the SVG draws, in px; null when no airport of the spec is known. */
export function buildMiniMap(spec: MiniMapSpec, w: number, h: number): Built | null {
  const codes = [...new Set([spec.to, ...spec.crew.map((c) => c.at), ...spec.path.flatMap((l) => [l.from, l.to])])].filter((c) => AIRPORT_BY_CODE[c]);
  if (!codes.length) return null;
  const lons = codes.map((c) => AIRPORT_BY_CODE[c].lon);
  const lats = codes.map((c) => AIRPORT_BY_CODE[c].lat);
  const lo = (v: number) => Math.max(-80, Math.min(80, v));
  const box: Polygon = {
    type: 'Polygon',
    coordinates: [[
      [Math.min(...lons) - PAD_DEG, lo(Math.min(...lats) - PAD_DEG)], [Math.max(...lons) + PAD_DEG, lo(Math.min(...lats) - PAD_DEG)],
      [Math.max(...lons) + PAD_DEG, lo(Math.max(...lats) + PAD_DEG)], [Math.min(...lons) - PAD_DEG, lo(Math.max(...lats) + PAD_DEG)],
      [Math.min(...lons) - PAD_DEG, lo(Math.min(...lats) - PAD_DEG)],
    ]],
  };
  const proj = geoMercator().fitExtent([[INSET, INSET], [w - INSET, h - INSET]], box).clipExtent([[0, 0], [w, h]]).precision(0.5);
  const path = geoPath(proj);
  const crewAt = new Map<string, number>();
  for (const c of spec.crew) crewAt.set(c.at, (crewAt.get(c.at) ?? 0) + 1);
  const aps = codes.flatMap((code) => {
    const a = AIRPORT_BY_CODE[code];
    const p = proj([a.lon, a.lat]);
    return p ? [{ code, x: p[0], y: p[1], crew: crewAt.get(code) ?? 0, dep: code === spec.to }] : [];
  });
  const legs = spec.path.flatMap((l) => {
    const A = AIRPORT_BY_CODE[l.from];
    const B = AIRPORT_BY_CODE[l.to];
    if (!A || !B) return [];
    const d = path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] });
    const gi = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
    const m = proj(gi(0.5));
    const a = proj(gi(0.49));
    const b = proj(gi(0.51));
    if (!d || !m || !a || !b) return [];
    return [{ d, x: m[0], y: m[1], ang: headingDeg(a, b), jet: !!l.jet, label: l.no ?? (l.jet ? 'Private jet' : 'Airline'), times: `${fmtTime(l.dep)}–${fmtTime(l.arr)} UTC` }];
  });
  return { land: landPathFor(proj), aps, legs };
}

export function MiniMap({ spec, width = 400 }: { spec: MiniMapSpec; width?: number }) {
  const height = Math.round(width * H_OF_W);
  const key = JSON.stringify([spec.to, spec.crew.map((c) => c.at), spec.path.map((l) => [l.from, l.to, l.no, l.dep, l.arr, !!l.jet]), width]);
  const b = useMemo(() => buildMiniMap(spec, width, height), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  const to = AIRPORT_BY_CODE[spec.to];
  return (
    <svg className="minimap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Where the crew are and the way to ${to?.city ?? spec.to}`}>
      <rect className="mm-sea" width={width} height={height} rx={10} />
      <path className="mm-land" d={b.land} />
      {b.legs.map((l, i) => <path key={`l${i}`} className={`mm-leg${l.jet ? ' jet' : ''}`} d={l.d} />)}
      {b.aps.map((a) => (
        <g key={a.code} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})`} className={`mm-ap${a.dep ? ' dep' : ''}${a.crew ? ' crew' : ''}`}>
          {a.dep && <circle className="mm-ring" r={8} />}
          <circle className="mm-dot" r={a.dep ? 3.5 : 4} />
          {a.crew > 1 && <text className="mm-n" x={7} y={-5}>×{a.crew}</text>}
          <text className="mm-code" y={a.dep ? 21 : 17}>{a.code}</text>
          {a.dep && <text className="mm-sub" y={33}>departs {fmtTime(spec.departure)} UTC</text>}
        </g>
      ))}
      {b.legs.map((l, i) => (
        <g key={`g${i}`} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)})`} className="mm-glyph">
          <path d={l.jet ? JET_PATH : PLANE_PATH} transform={`rotate(${l.ang.toFixed(1)}) scale(${(l.jet ? 16 : 18) / 24}) translate(-12 -12)`} />
          <text className="mm-label" y={-13}>{l.label}</text>
          <text className="mm-times" y={23}>{l.times}</text>
        </g>
      ))}
    </svg>
  );
}
