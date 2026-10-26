// v0.11 Operations: the diversion picker. A small map in the decision card: where the aircraft is now (its glyph on the
// flown track), the planned destination ringed (closed, curfew), and each alternate on offer as a dot to tap (the same
// choice as its option button below). Also used after a diversion (the alternate and the road to the destination)
// and for a curfew (the open airport nearby). Static SVG, built once per decision; nothing animates.

import { geoInterpolate, geoMercator, geoPath } from 'd3-geo';
import type { Polygon } from 'geojson';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { Decision, GameState } from '../../engine/core/types';
import { legPos } from '../../engine/ops/disrupt';
import { PLANE_PATH } from '../components/Logo';
import { landPathFor } from './mapData';
import { headingDeg } from './mapLogic';

export interface DivSpec {
  from: string;
  dest: string;
  /** Why the destination is ringed. */
  destNote: string;
  pos: [number, number] | null;
  alts: { code: string; optionId: string; def: boolean }[];
  /** After a diversion: the aircraft sits at this alternate (road line to the destination). */
  at?: string;
}

const MAP_KINDS = new Set(['diversion', 'medical', 'divertOnward', 'curfew']);

/** What the picker draws for a decision (null when it has no map). Pure. */
export function divSpec(g: GameState, d: Decision): DivSpec | null {
  if (!MAP_KINDS.has(d.kind)) return null;
  const f = g.flights[String(d.data?.flightId ?? '')];
  if (!f) return null;
  const altOf = (id: string) => (id.startsWith('alt:') ? id.slice(4) : null);
  const alts = d.options.flatMap((o) => {
    const c = altOf(o.id) ?? (o.id === 'divert' && d.data?.alt ? String(d.data.alt) : null);
    return c && AIRPORT_BY_CODE[c] ? [{ code: c, optionId: o.id, def: o.id === d.defaultOption }] : [];
  });
  if (d.kind === 'divertOnward') {
    const to0 = String(d.data?.to0 ?? f.div?.to0 ?? f.to);
    return { from: f.from, dest: to0, destNote: 'planned', pos: null, alts: [], at: String(d.data?.alt ?? f.to) };
  }
  const dest = f.div?.to0 ?? f.to;
  const note = d.kind === 'curfew' ? 'curfew' : d.kind === 'medical' ? 'destination' : d.data?.cause === 'technical' ? 'destination' : 'closed';
  return { from: f.from, dest, destNote: note, pos: f.status === 'enroute' ? legPos(f, g.now) : null, alts };
}

const PAD = 1.2;

export function DiversionMap({ spec, width = 520, onPick }: { spec: DivSpec; width?: number; onPick?: (optionId: string) => void }) {
  const height = Math.round(width * 0.42);
  const key = JSON.stringify([spec, width]);
  const b = useMemo(() => {
    const codes = [spec.from, spec.dest, ...spec.alts.map((a) => a.code), ...(spec.at ? [spec.at] : [])].filter((c) => AIRPORT_BY_CODE[c]);
    const pts: [number, number][] = codes.map((c) => [AIRPORT_BY_CODE[c].lon, AIRPORT_BY_CODE[c].lat]);
    if (spec.pos) pts.push(spec.pos);
    // Fit the alternates, the destination and the aircraft (the origin only when it is close: a long-haul origin
    // would shrink the picture to nothing).
    // A destination far from the aircraft (a medical event mid-ocean) is left out of the fit: the picture is the
    // aircraft and its alternates; the planned track still runs off the edge towards it.
    const D0 = AIRPORT_BY_CODE[spec.dest];
    const far = !!spec.pos && !!D0 && Math.hypot(D0.lon - spec.pos[0], D0.lat - spec.pos[1]) > 5 && spec.alts.length > 0;
    const near = pts.filter((_, i) => (i !== 0 || spec.alts.some((a) => a.code === spec.from)) && !(far && codes[i] === spec.dest));
    const fit = near.length >= 2 ? near : pts;
    const lons = fit.map((p) => p[0]);
    const lats = fit.map((p) => p[1]);
    const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats), 2);
    const pad = Math.max(PAD, span * 0.25);
    const box: Polygon = { type: 'Polygon', coordinates: [[[Math.min(...lons) - pad, Math.max(-80, Math.min(...lats) - pad)], [Math.min(...lons) - pad, Math.min(80, Math.max(...lats) + pad)], [Math.max(...lons) + pad, Math.min(80, Math.max(...lats) + pad)], [Math.max(...lons) + pad, Math.max(-80, Math.min(...lats) - pad)], [Math.min(...lons) - pad, Math.max(-80, Math.min(...lats) - pad)]]] };
    const proj = geoMercator().fitExtent([[14, 14], [width - 14, height - 14]], box).clipExtent([[0, 0], [width, height]]).precision(0.5);
    const path = geoPath(proj);
    const P = (c: string) => proj([AIRPORT_BY_CODE[c].lon, AIRPORT_BY_CODE[c].lat]) ?? [0, 0];
    const from = AIRPORT_BY_CODE[spec.from];
    const dest = AIRPORT_BY_CODE[spec.dest];
    const planned = path({ type: 'LineString', coordinates: [[from.lon, from.lat], [dest.lon, dest.lat]] }) ?? '';
    const flown = spec.pos ? path({ type: 'LineString', coordinates: [[from.lon, from.lat], spec.pos] }) ?? '' : '';
    let plane: { x: number; y: number; ang: number } | null = null;
    if (spec.pos) {
      const p = proj(spec.pos) ?? [0, 0];
      const gi = geoInterpolate([from.lon, from.lat], spec.pos);
      const a = proj(gi(0.98)) ?? p;
      plane = { x: p[0], y: p[1], ang: headingDeg(a, p) };
    }
    const lines = spec.alts.map((a) => {
      const A = AIRPORT_BY_CODE[a.code];
      const o: [number, number] = spec.pos ?? [dest.lon, dest.lat];
      return path({ type: 'LineString', coordinates: [o, [A.lon, A.lat]] }) ?? '';
    });
    const road = spec.at ? path({ type: 'LineString', coordinates: [[AIRPORT_BY_CODE[spec.at].lon, AIRPORT_BY_CODE[spec.at].lat], [dest.lon, dest.lat]] }) ?? '' : '';
    // Labels: right of the dot, or left / below when another alternate's label (or the destination's) would collide.
    const placed: [number, number][] = [P(spec.dest)];
    const alts = spec.alts.map((a) => {
      const p = P(a.code);
      const near = placed.some((q) => Math.abs(q[0] - p[0]) < 70 && Math.abs(q[1] - p[1]) < 16);
      const side: 'r' | 'l' = near ? 'l' : 'r';
      placed.push([p[0] + (side === 'l' ? -60 : 0), p[1]]);
      return { ...a, p, side };
    });
    return { land: landPathFor(proj), planned, flown, plane, lines, road, dest: P(spec.dest), from: P(spec.from), alts, at: spec.at ? P(spec.at) : null };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const destName = AIRPORT_BY_CODE[spec.dest]?.city ?? spec.dest;
  return (
    <svg className="minimap divmap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Alternates for ${destName}`}>
      <rect className="mm-sea" width={width} height={height} rx={10} />
      <path className="mm-land" d={b.land} />
      <path className="dm-planned" d={b.planned} />
      {b.flown && <path className="dm-flown" d={b.flown} />}
      {b.road && <path className="dm-road" d={b.road} />}
      {b.lines.map((d, i) => <path key={i} className={`dm-alt-line${spec.alts[i].def ? ' def' : ''}`} d={d} />)}
      <g transform={`translate(${b.dest[0].toFixed(1)} ${b.dest[1].toFixed(1)})`} className={`dm-dest ${spec.destNote}`}>
        <circle className="dm-dest-ring" r={11} />
        <circle className="mm-dot" r={3.5} />
        <text x={14} y={4}>{spec.dest}</text>
        <text className="mm-sub" x={14} y={16}>{spec.destNote === 'closed' ? 'closed: weather' : spec.destNote === 'curfew' ? 'night curfew' : spec.destNote === 'planned' ? `${destName}, planned` : destName}</text>
      </g>
      {b.at && (
        <g transform={`translate(${b.at[0].toFixed(1)} ${b.at[1].toFixed(1)})`} className="dm-at">
          <circle className="dm-at-dot" r={5} />
          <text x={9} y={4}>{spec.at}</text>
          <text className="mm-sub" x={9} y={16}>on the ground</text>
        </g>
      )}
      {b.alts.map((a) => (
        <g key={a.code} transform={`translate(${a.p[0].toFixed(1)} ${a.p[1].toFixed(1)})`} className={`dm-alt${a.def ? ' def' : ''}${onPick ? ' tap' : ''}`} onClick={onPick ? () => onPick(a.optionId) : undefined} role={onPick ? 'button' : undefined} aria-label={onPick ? `Divert to ${a.code}` : undefined}>
          <circle className="dm-hit" r={18} />
          <circle className="dm-alt-dot" r={5.5} />
          <text x={a.side === 'l' ? -9 : 9} y={4} style={a.side === 'l' ? { textAnchor: 'end' } : undefined}>{a.code}</text>
        </g>
      ))}
      {b.plane && (
        <g transform={`translate(${b.plane.x.toFixed(1)} ${b.plane.y.toFixed(1)})`} className="mm-glyph dm-plane">
          <path d={PLANE_PATH} transform={`rotate(${b.plane.ang.toFixed(1)}) scale(0.8) translate(-12 -12)`} />
        </g>
      )}
    </svg>
  );
}
