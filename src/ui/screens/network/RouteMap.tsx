// v0.19.2 the route's flat map (player: "include flat-map visuals when building a route"): the game's flat map look
// (Mercator, its land and colours: mapData.ts, the --map-* tokens), the great-circle line with its fuel stops, the
// full-payload range ring of the chosen aircraft from the origin, and the rivals' one-stop routes faintly. A static
// SVG built once per input (memo); the land comes with the main map's geometry (loaded once if the map was not opened).

import { geoCircle, geoGraticule10, geoMercator, geoPath } from 'd3-geo';
import type { Feature, MultiPoint } from 'geojson';
import { useEffect, useMemo, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import type { RouteCompetitor } from '../../../data/routes';
import { maxSectorNm, typeOf } from '../../../engine/core/perf';
import { landPathFor, loadMapData, mapReady } from '../../map/mapData';

const EARTH_NM = 3440.065;
const W = 560;
const H = 300;
const PAD = 22;

export interface RouteMapProps {
  from: string;
  to?: string;
  via?: string[];
  viaBack?: string[];
  /** The aircraft whose full-payload range ring is drawn from the origin. */
  typeId?: string;
  rivals?: RouteCompetitor[];
  /** Accessible label. */
  label?: string;
  className?: string;
}

interface BuiltMap {
  land: string;
  grat: string;
  ring: string;
  route: string;
  back: string;
  rivals: string[];
  aps: { code: string; x: number; y: number; kind: 'end' | 'stop' | 'hub' }[];
}

const ll = (c: string): [number, number] | null => {
  const a = AIRPORT_BY_CODE[c];
  return a ? [a.lon, a.lat] : null;
};

/** Everything the SVG draws (px), or null when the origin is unknown. Pure apart from the loaded land. */
export function buildRouteMap(p: RouteMapProps, landOn: boolean): BuiltMap | null {
  const A = ll(p.from);
  if (!A) return null;
  const B = p.to ? ll(p.to) : null;
  const via = (p.via ?? []).filter((c) => ll(c));
  const back = (p.viaBack ?? [...via].reverse()).filter((c) => ll(c));
  const hubs = [...new Set((p.rivals ?? []).map((r) => r.via).filter((c): c is string => !!c && !!ll(c)))];
  const rangeNm = p.typeId && typeOf(p.typeId) ? maxSectorNm(p.typeId, p.from) : 0;
  const ringGeo = rangeNm > 0 ? geoCircle().center(A).radius((rangeNm / EARTH_NM) * (180 / Math.PI)).precision(2)() : null;
  // Fit: the route and its stops (and the hubs), or the range ring when no destination is chosen yet.
  const pts: [number, number][] = [A];
  if (B) {
    pts.push(B, ...via.map((c) => ll(c)!), ...back.map((c) => ll(c)!), ...hubs.map((c) => ll(c)!));
  } else if (ringGeo) {
    for (const q of ringGeo.coordinates[0]) pts.push([q[0], Math.max(-72, Math.min(76, q[1]))]);
  }
  // Centre on the route's middle longitude (an antimeridian route stays in one piece).
  const lons = pts.map((q) => q[0]);
  const ref = A[0];
  const unwrap = lons.map((x) => ref + (((x - ref + 540) % 360) - 180));
  const c0 = (Math.min(...unwrap) + Math.max(...unwrap)) / 2;
  const span = Math.max(Math.max(...unwrap) - Math.min(...unwrap), Math.max(...pts.map((q) => q[1])) - Math.min(...pts.map((q) => q[1])));
  const pad = Math.max(6, Math.min(14, span * 0.18));
  const lats = pts.map((q) => q[1]);
  const box: [number, number][] = [
    [c0 - Math.max(12, (Math.max(...unwrap) - Math.min(...unwrap)) / 2 + pad), Math.max(-75, Math.min(...lats) - pad)],
    [c0 + Math.max(12, (Math.max(...unwrap) - Math.min(...unwrap)) / 2 + pad), Math.min(78, Math.max(...lats) + pad)],
  ];
  const fit: Feature<MultiPoint> = { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [...pts, box[0], box[1], [box[0][0], box[1][1]], [box[1][0], box[0][1]]] } };
  const proj = geoMercator().rotate([-c0, 0]).fitExtent([[PAD, PAD], [W - PAD, H - PAD]], fit).clipExtent([[0, 0], [W, H]]).precision(0.4);
  const path = geoPath(proj);
  const line = (chain: string[]) => (chain.length > 1 ? path({ type: 'LineString', coordinates: chain.map((c) => ll(c)!) }) ?? '' : '');
  const out = B ? line([p.from, ...via, p.to!]) : '';
  const backD = B && back.join() !== [...via].reverse().join() ? line([p.to!, ...back, p.from]) : '';
  const rivals = B ? hubs.map((h) => line([p.from, h, p.to!])) : [];
  const aps: BuiltMap['aps'] = [];
  const put = (code: string, kind: BuiltMap['aps'][number]['kind']) => {
    const q = ll(code);
    const xy = q ? proj(q) : null;
    if (xy && !aps.some((x) => x.code === code)) aps.push({ code, x: xy[0], y: xy[1], kind });
  };
  put(p.from, 'end');
  if (B) put(p.to!, 'end');
  for (const c of [...via, ...back]) put(c, 'stop');
  if (B) for (const h of hubs) put(h, 'hub');
  return { land: landOn ? landPathFor(proj) : '', grat: path(geoGraticule10()) ?? '', ring: ringGeo ? path(ringGeo) ?? '' : '', route: out, back: backD, rivals, aps };
}

export function RouteMap(p: RouteMapProps) {
  const [landOn, setLandOn] = useState(mapReady());
  useEffect(() => {
    if (landOn) return;
    let live = true;
    void loadMapData().then(() => { if (live) setLandOn(true); });
    return () => { live = false; };
  }, [landOn]);
  const key = JSON.stringify([p.from, p.to, p.via, p.viaBack, p.typeId, (p.rivals ?? []).map((r) => r.via ?? ''), landOn]);
  const b = useMemo(() => buildRouteMap(p, landOn), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  const t = p.typeId && typeOf(p.typeId) ? typeOf(p.typeId) : null;
  return (
    <figure className={`rm ${p.className ?? ''}`}>
      <svg className="rm-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={p.label ?? `Map of ${[p.from, ...(p.via ?? []), p.to ?? ''].filter(Boolean).join('–')}`}>
        <rect className="rm-sea" width={W} height={H} rx={12} />
        <path className="rm-grat" d={b.grat} />
        <path className="rm-land" d={b.land} />
        {b.ring && <path className="rm-ring" d={b.ring} />}
        {b.rivals.map((d, i) => <path key={`r${i}`} className="rm-rival" d={d} />)}
        {b.back && <path className="rm-route back" d={b.back} />}
        {b.route && <path className="rm-route" d={b.route} />}
        {b.aps.map((a) => (
          <g key={a.code} className={`rm-ap ${a.kind}`} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})`}>
            <circle r={a.kind === 'end' ? 4 : a.kind === 'stop' ? 3.2 : 2.4} />
            {a.kind !== 'hub' && <text x={7} y={-6}>{a.code}</text>}
          </g>
        ))}
      </svg>
      {(t || b.rivals.length > 0) && (
        <figcaption className="rm-key tiny muted">
          {t && <span><i className="rm-k ring" />{t.short} range, full load</span>}
          {b.route && (p.via?.length ?? 0) > 0 && <span><i className="rm-k stop" />fuel stop</span>}
          {b.rivals.length > 0 && <span><i className="rm-k rival" />rivals' one-stop routes</span>}
        </figcaption>
      )}
    </figure>
  );
}
