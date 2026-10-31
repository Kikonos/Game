// v0.12.1 a world tour's route on a small world map (the offer and contract panels): the land, the legs as great
// circles, the gateway ringed, every stop a dot with its code and nights. The map is cut where the route is farthest
// from any stop, so no stop sits on the edge. Built once per route (memo); nothing animates.

import { geoEquirectangular, geoPath } from 'd3-geo';
import { useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { landPathFor } from './mapData';

const H_OF_W = 0.46;
const FS = 10;

interface TourStopMark { code: string; nights: number }

/** The central meridian that keeps every stop farthest from the map's cut (5° steps). Pure. */
export function tourCentre(codes: string[]): number {
  const lons = codes.map((c) => AIRPORT_BY_CODE[c]?.lon).filter((x): x is number => x !== undefined);
  if (!lons.length) return 0;
  let best = 0;
  let bestGap = -1;
  for (let c = -180; c < 180; c += 5) {
    const cut = c + 180;
    const gap = Math.min(...lons.map((l) => Math.abs((((l - cut) % 360) + 540) % 360 - 180)));
    if (gap > bestGap) [best, bestGap] = [c, gap];
  }
  return best;
}

export function TourMap({ gateway, stops, width = 420, flown = 0 }: { gateway: string; stops: TourStopMark[]; width?: number; flown?: number }) {
  const height = Math.round(width * H_OF_W);
  const key = JSON.stringify([gateway, stops, width, flown]);
  const b = useMemo(() => {
    const pts = [gateway, ...stops.map((s) => s.code), gateway].filter((c) => AIRPORT_BY_CODE[c]);
    const proj = geoEquirectangular().rotate([-tourCentre(pts), 0]).scale(width / (2 * Math.PI)).translate([width / 2, height * 0.56]).precision(0.5);
    const path = geoPath(proj);
    const legs = pts.slice(1).map((to, i) => {
      const A = AIRPORT_BY_CODE[pts[i]];
      const B = AIRPORT_BY_CODE[to];
      return { d: path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] }) ?? '', done: i < flown };
    });
    const aps = [gateway, ...stops.map((s) => s.code)].flatMap((code, i) => {
      const a = AIRPORT_BY_CODE[code];
      const p = a && proj([a.lon, a.lat]);
      return p ? [{ code, x: p[0], y: p[1], nights: i === 0 ? 0 : stops[i - 1].nights, gate: i === 0 }] : [];
    });
    return { land: landPathFor(proj), legs, aps };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const city = AIRPORT_BY_CODE[gateway]?.city ?? gateway;
  return (
    <svg className="minimap tourmap" width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Round the world from ${city}: ${stops.map((s) => AIRPORT_BY_CODE[s.code]?.city ?? s.code).join(', ')}`}>
      <rect className="mm-sea" width={width} height={height} rx={10} />
      <path className="mm-land" d={b.land} />
      {b.legs.map((l, i) => <path key={i} className={`mm-leg tm-leg${l.done ? ' done' : ''}`} d={l.d} />)}
      {b.aps.map((a) => (
        <g key={a.code} transform={`translate(${a.x.toFixed(1)} ${a.y.toFixed(1)})`} className={`mm-ap${a.gate ? ' dep' : ''}`}>
          {a.gate && <circle className="mm-ring" r={7} />}
          <circle className="mm-dot" r={a.gate ? 3 : 3.5} />
          <text className="mm-code tm-code" x={6} y={a.y > height - 18 ? -6 : FS + 2} fontSize={FS}>{a.code}{a.nights ? ` ${a.nights}n` : ''}</text>
        </g>
      ))}
    </svg>
  );
}
