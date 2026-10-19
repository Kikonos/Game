// 737-800, 737 MAX 8/10, 757-200, 767-300ER. Dimensions in metres (Boeing
// airport-planning docs / Wikipedia); door, gear, engine and fin stations
// measured off the Scavini 3-views (737-800, 757 family, 767 family).

import type { AircraftProfile, TailConeSpec } from '../types';
import { NOSE, TAIL, cargo, exit, leg, pax, row } from './shared';

// ---------- 737 ----------

interface B737Opts {
  id: string;
  /** Plug ahead of / behind the wing relative to the 737-800 (m). */
  fwd: number;
  aft: number;
  max: boolean;
  ref: AircraftProfile['ref'];
  /** 737-900ER / MAX 9 / MAX 10 mid-cabin exit aft of the wing. */
  midExit?: boolean;
  /** Centreline height override (MAX 10 levered main gear). */
  stance?: number;
}

/** 737 MAX: fuller, longer cone without the NG's tail-cone vortex generators. */
const TAIL_MAX: TailConeSpec = {
  upper: [-1.8, 0.5, -1.15, 0.5, -0.45, 0.42, 0, 0.3],
  lower: [-4.2, -0.5, -3.0, -0.5, -1.2, -0.24, 0, 0.17],
  apu: 0.09,
};

function b737(o: B737Opts): AircraftProfile {
  const L = 39.47 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  return {
    id: o.id,
    length: L,
    height: 4.01,
    nose: NOSE.b737,
    cockpit: { style: 'b737', u: 0.36, v: 0.09, scale: 0.82 },
    tail: o.max ? TAIL_MAX : TAIL.b737,
    // knee-shaped dorsal fillet; LE extended to the crown at 31.7 m (3-view)
    fin: { x: 31.7 + fa, rootChord: 4.75, tipChord: 1.75, height: 7.25, sweep: 43, fillet: { len: 3.0, h: 1.4, knee: true }, rudder: 0.33 },
    stab: { x: 34.9 + fa, y: 1.2, rootChord: 3.5, tipChord: 1.15, span: 5.4, sweep: 33, dihedral: 7, thickness: 0.34 },
    wing: { x: 14.6 + f, y: -1.25, rootChord: 6.6, tipChord: 1.3, span: 15.3, sweep: 27, dihedral: 6, thickness: 0.75, tip: o.max ? 'scimitar' : 'blended', tipH: o.max ? 2.55 : 2.7 },
    engines: [
      o.max
        // LEAP-1B: bigger, round-lipped, slung further forward and higher, chevron nozzle
        ? { mount: 'underwing', style: 'chevron', x: 12.55 + f, y: -1.62, dia: 2.24, len: 5.05, station: 0.3 }
        // CFM56-7: flattened "hamster pouch" lower lip, tucked close to the wing
        : { mount: 'underwing', style: 'flatbottom', x: 13.3 + f, y: -1.76, dia: 2.08, len: 4.55, station: 0.3 },
    ],
    fairing: { x0: 13.6 + f, x1: 23.0 + f, depth: 0.2 },
    gear: { stance: o.stance ?? (o.max ? 3.27 : 3.15), nose: leg(3.95, 2, 0.69), main: [leg(19.2 + f, 2, 1.12)] },
    doors: [
      pax(4.4, 0.83, 1.83), exit(16.9 + f, 0.52, 0.97), exit(17.65 + f, 0.52, 0.97), ...(o.midExit ? [exit(22.4 + f, 0.62, 1.25)] : []), pax(31.8 + fa, 0.76, 1.68),
      cargo(8.07, 1.22, 0.89), cargo(27.3 + f + o.aft * 0.5, 1.22, 0.89),
    ],
    windows: [row(6.15, 30.9 + fa, 0.4, 0.508, 0.24, 0.33)],
    ref: o.ref,
  };
}

const b738 = b737({ id: 'b738', fwd: 0, aft: 0, max: false, ref: { overallHeight: 12.4, span: 35.79 } });
const b38m = b737({ id: 'b38m', fwd: 0.05, aft: 0, max: true, ref: { overallHeight: 12.3, span: 35.9 } });
// MAX 10: MAX 9 plugs (1.57 m fwd / 1.09 m aft) plus 0.76 / 0.91 m, levered main gear
const b3jm = b737({ id: 'b3jm', fwd: 2.33, aft: 2.0, max: true, midExit: true, stance: 3.4, ref: { overallHeight: 12.4, span: 35.9 } });

// ---------- 757-200 ----------

const b752: AircraftProfile = {
  id: 'b752',
  length: 47.32,
  height: 4.01,
  nose: NOSE.b757,
  cockpit: { style: 'b757', u: 0.42, v: 0.09, scale: 0.82 },
  tail: TAIL.b757,
  // tall fin with a short curved dorsal fillet
  fin: { x: 37.3, rootChord: 6.6, tipChord: 2.6, height: 7.38, sweep: 42, fillet: { len: 2.8, h: 1.1 }, rudder: 0.36 },
  stab: { x: 40.0, y: 0.75, rootChord: 4.4, tipChord: 1.4, span: 7.2, sweep: 34, dihedral: 7, thickness: 0.4 },
  wing: { x: 17.2, y: -1.2, rootChord: 8.0, tipChord: 1.7, span: 17.1, sweep: 28, dihedral: 5, thickness: 0.95, tip: 'none' },
  // RB211-535: long-duct nacelle hung well ahead of the wing, tall gear
  engines: [{ mount: 'underwing', style: 'longduct', x: 16.3, y: -2.25, dia: 2.5, len: 6.8, station: 0.3 }],
  fairing: { x0: 15.0, x1: 30.0, depth: 0.22 },
  gear: { stance: 4.18, nose: leg(5.85, 2, 0.8), main: [leg(24.4, 4, 1.15)] },
  // four-door layout (L1, L2 ahead of the wing, L3 aft of it, L4 at the tail)
  doors: [pax(4.7, 0.84, 1.83), pax(13.6, 0.84, 1.83), pax(29.2, 0.84, 1.83), pax(37.5, 0.84, 1.83), cargo(9.8, 1.75, 1.1), cargo(30.8, 1.4, 1.1)],
  windows: [row(6.3, 36.9, 0.55, 0.508, 0.24, 0.33)],
  ref: { overallHeight: 13.56, span: 38.05 },
};

// ---------- 767-300ER ----------

const b763: AircraftProfile = {
  id: 'b763',
  length: 54.94,
  height: 5.41,
  nose: NOSE.b757,
  cockpit: { style: 'b757', u: 0.37, v: 0.09, scale: 0.72 },
  tail: TAIL.b757,
  fin: { x: 44.0, rootChord: 8.3, tipChord: 2.4, height: 8.45, sweep: 47, fillet: { len: 2.2, h: 0.9 }, rudder: 0.33 },
  stab: { x: 47.3, y: 0.7, rootChord: 5.4, tipChord: 1.8, span: 8.4, sweep: 34, dihedral: 7, thickness: 0.48 },
  wing: { x: 19.5, y: -1.65, rootChord: 9.6, tipChord: 2.4, span: 21.3, sweep: 34, dihedral: 6, thickness: 1.15, tip: 'none' },
  engines: [{ mount: 'underwing', style: 'plain', x: 19.6, y: -2.38, dia: 2.7, len: 6.9, station: 0.3 }],
  fairing: { x0: 18.0, x1: 34.5, depth: 0.3 },
  gear: { stance: 4.7, nose: leg(4.5, 2, 0.95), main: [leg(28.5, 4, 1.17)] },
  doors: [pax(5.3, 1.07, 1.88), pax(16.7, 1.07, 1.88), exit(31.6, 0.62, 1.15), pax(42.6, 1.07, 1.88), cargo(10.6, 3.4, 1.75), cargo(38.1, 1.78, 1.75)],
  windows: [row(7.2, 41.9, 0.65, 0.508, 0.26, 0.38)],
  ref: { overallHeight: 15.85, span: 47.57 },
};

export const NARROW_BOEING: AircraftProfile[] = [b738, b38m, b3jm, b752, b763];
