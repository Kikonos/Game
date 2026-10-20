// Aérospatiale/BAC Concorde. Drawn from its traced silhouette (traced/concorde.ts,
// outline mode: the BA profile drawing's fuselage, ogival delta, fin and nacelle
// pair as one path). Dimensions in metres (61.66 m long, 25.6 m span, 12.2 m tall,
// fuselage 2.88 m wide x 3.32 m tall); wing, engine, fin, door and window
// stations below are the trace's, so the untraced fallback draws the same airframe.

import type { AircraftProfile, Chain } from '../types';
import { pax, row } from './shared';

/** Polyline (u, v) to a straight-segment cubic chain. */
function poly(pts: readonly (readonly [number, number])[]): Chain {
  const out: number[] = [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    out.push(ax + (bx - ax) / 3, ay + (by - ay) / 3, ax + (2 * (bx - ax)) / 3, ay + (2 * (by - ay)) / 3, bx, by);
  }
  return out;
}

// nose / tail cone sampled off the trace (H = 3.50 m traced tube): needle with the tip
// 0.28 H below the centreline, crown reached ~5.6 H aft; pointed cone rising to +0.33 H
const NOSE_CONCORDE = {
  upper: poly([[0, -0.28], [0.94, -0.039], [1.65, 0.133], [2.23, 0.3], [3.18, 0.418], [4.23, 0.47], [5.64, 0.5]]),
  lower: poly([[0, -0.28], [0.94, -0.396], [2.0, -0.456], [3.0, -0.491], [3.93, -0.5]]),
};
const TAIL_CONCORDE = {
  upper: poly([[-3.53, 0.5], [-1.06, 0.44], [-0.35, 0.39], [0, 0.327]]),
  lower: poly([[-5.29, -0.5], [-3.53, -0.343], [-1.76, -0.089], [-0.53, 0.17], [0, 0.327]]),
};

export const concorde: AircraftProfile = {
  id: 'concorde',
  length: 61.66,
  height: 3.32,
  nose: NOSE_CONCORDE,
  // the traced panes (visor up) replace the preset
  cockpit: { style: 'airbus', u: 3.0, v: 0.25, scale: 0.6 },
  tail: TAIL_CONCORDE,
  // traced fin: fillet from 41.6 m, ogival LE to a 2.7 m flat tip 5.35 m above the crown, straight raked TE
  fin: { x: 41.56, rootChord: 15.34, tipChord: 2.71, height: 5.35, sweep: 66, fillet: { len: 4.0, h: 0.6 }, tip: 'square' },
  // tailless delta
  stab: { x: 55, y: 0, rootChord: 1, tipChord: 1, span: 1, sweep: 0, dihedral: 0, none: true },
  // traced wing root 19.15-49.43 m; ogival delta, drooped, seen almost edge-on
  wing: { x: 19.15, y: -1.09, rootChord: 30.28, tipChord: 1.2, span: 11.36, sweep: 60, dihedral: -2, thickness: 0.6, tip: 'none', delta: true },
  // Olympus 593 pairs (port/starboard coincide in profile): traced box 36.08-48.43 m
  engines: [
    { mount: 'underwing', style: 'supersonic', x: 36.08, y: -2.14, dia: 0.8, len: 12.34, station: 0.15, inboard: true },
    { mount: 'underwing', style: 'supersonic', x: 36.08, y: -2.14, dia: 0.8, len: 12.34, station: 0.3 },
  ],
  // L1 behind the flight deck, L2 mid-cabin, aft service door
  doors: [{ ...pax(12.97, 0.83, 1.65), y: -0.66 }, { ...pax(27.0, 0.78, 1.55), y: -0.19 }, { ...pax(44.52, 0.63, 1.17), y: -0.42 }],
  windows: [row(15.19, 43.9, 0.47, 0.563, 0.15, 0.18, [[26.17, 27.86]])],
  ref: { overallHeight: 12.2, span: 25.6 },
};
