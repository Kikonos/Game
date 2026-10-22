// v0.7.1 mini-map for "who is where" (UPDATE-0.7.1.md §5, §3.8): a static inline SVG (400 × 180 by default) with the
// land under a Mercator fitted to the spec's airports (±8°), the crew's grey dots, a ring at the airport they are
// needed at, and a dashed line per leg they would take with an airline-plane or business-jet glyph at its middle and
// the flight's label and times. With no leg at all (nothing lands in time) a red dashed line runs straight from each
// crew airport to the departure, the first one noting 'no flight lands in time'. Built once per spec (memo); nothing animates.

import { geoInterpolate, geoMercator, geoPath } from 'd3-geo';
import type { Polygon } from 'geojson';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtTime } from '../../engine/core/time';
import type { MiniMapSpec } from '../../engine/ops';
import { PLANE_PATH } from '../components/Logo';
import { landPathFor } from './mapData';
import { downSide, headingDeg, JET_PATH, trackLabelAt } from './mapLogic';

const H_OF_W = 180 / 400;
/** Degrees around the airports: half their spread, between 2° (a close pair still reads) and 8°. */
const PAD_DEG = 8;
const INSET = 10;
const FS = 10.5;
const NONE_NOTE = 'no flight lands in time';

interface Built {
  land: string;
  aps: { code: string; x: number; y: number; crew: number; dep: boolean }[];
  /** Leg path, the glyph's point and heading, and where its label sits (beside the track). */
  legs: { d: string; x: number; y: number; ang: number; jet: boolean; label: string; times: string; lx: number; ly: number }[];
  /** The gap lines when there is no flight: crew airport → departure; the note sits beside the first one's middle. */
  none: { d: string; x: number; y: number; note: boolean }[];
}

/** Everything the SVG draws, in px; null when no airport of the spec is known. */
export function buildMiniMap(spec: MiniMapSpec, w: number, h: number): Built | null {
  const codes = [...new Set([spec.to, ...spec.crew.map((c) => c.at), ...spec.path.flatMap((l) => [l.from, l.to])])].filter((c) => AIRPORT_BY_CODE[c]);
  if (!codes.length) return null;
  const lons = codes.map((c) => AIRPORT_BY_CODE[c].lon);
  const lats = codes.map((c) => AIRPORT_BY_CODE[c].lat);
  const lo = (v: number) => Math.max(-80, Math.min(80, v));
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
  const pad = Math.max(2, Math.min(PAD_DEG, span * 0.5));
  const [x0, x1, y0, y1] = [Math.min(...lons) - pad, Math.max(...lons) + pad, lo(Math.min(...lats) - pad), lo(Math.max(...lats) + pad)];
  // Clockwise ring (d3-geo's spherical polygons): anticlockwise would mean "the whole sphere but this box".
  const box: Polygon = { type: 'Polygon', coordinates: [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]] };
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
    const ang = headingDeg(a, b);
    const label = l.no ?? (l.jet ? 'Private jet' : 'Airline');
    const times = `${fmtTime(l.dep)}–${fmtTime(l.arr)} UTC`;
    // The label rides beside the track (two lines), on the side that points down or right, clear of the glyph.
    const [lx, ly] = trackLabelAt(ang, downSide(ang), Math.max(label.length, times.length) * FS * 0.62, FS * 2.4, 11);
    return [{ d, x: m[0], y: m[1], ang, jet: !!l.jet, label, times, lx, ly }];
  });
  const none = spec.path.length ? [] : [...crewAt.keys()].filter((c) => c !== spec.to && AIRPORT_BY_CODE[c] && AIRPORT_BY_CODE[spec.to]).flatMap((c, i) => {
    const A = AIRPORT_BY_CODE[c];
    const B = AIRPORT_BY_CODE[spec.to];
    const d = path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] });
    const gi = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
    const m = proj(gi(0.5));
    const a = proj(gi(0.49));
    const b = proj(gi(0.51));
    if (!d || !m || !a || !b) return [];
    // The note rides beside the line like a leg label, on the side farther from every dot and code.
    const ang = headingDeg(a, b);
    const side = ([1, -1] as const).map((sd) => {
      const [lx, ly] = trackLabelAt(ang, sd, NONE_NOTE.length * FS * 0.58, FS * 1.2, 6);
      const clear = Math.min(...aps.map((p) => Math.hypot(p.x - m[0] - lx, p.y - m[1] - ly)));
      return { lx, ly, clear: clear + (sd === downSide(ang) ? 4 : 0) };
    }).sort((u, v) => v.clear - u.clear)[0];
    return [{ d, x: m[0] + side.lx, y: m[1] + side.ly + FS * 0.35, note: i === 0 }];
  });
  return { land: landPathFor(proj), aps, legs, none };
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
      {b.none.map((l, i) => <path key={`n${i}`} className="mm-leg none" d={l.d} />)}
      {b.aps.map((a) => (
        <g key={a.code} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})`} className={`mm-ap${a.dep ? ' dep' : ''}${a.crew ? ' crew' : ''}`}>
          {a.dep && <circle className="mm-ring" r={8} />}
          <circle className="mm-dot" r={a.dep ? 3.5 : 4} />
          <text className="mm-code" x={a.dep ? 12 : 8} y={4}>{a.code}{a.crew > 1 ? ` ×${a.crew}` : ''}</text>
          {a.dep && <text className="mm-sub" x={12} y={16}>departs {fmtTime(spec.departure)} UTC</text>}
        </g>
      ))}
      {b.none.filter((l) => l.note).map((l, i) => (
        <text key={`t${i}`} className="mm-none" x={l.x.toFixed(1)} y={l.y.toFixed(1)}>{NONE_NOTE}</text>
      ))}
      {b.legs.map((l, i) => (
        <g key={`g${i}`} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)})`} className="mm-glyph">
          <path d={l.jet ? JET_PATH : PLANE_PATH} transform={`rotate(${l.ang.toFixed(1)}) scale(${(l.jet ? 16 : 18) / 24}) translate(-12 -12)`} />
          <text className="mm-label" x={l.lx.toFixed(1)} y={(l.ly - 2).toFixed(1)}>{l.label}</text>
          <text className="mm-times" x={l.lx.toFixed(1)} y={(l.ly + 10).toFixed(1)}>{l.times}</text>
        </g>
      ))}
    </svg>
  );
}
