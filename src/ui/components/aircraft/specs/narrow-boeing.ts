// 737-800, 737 MAX 8/10, 757-200, 767-300ER. Dimensions in metres (Boeing
// airport-planning docs / Wikipedia, 737-800 checked against a 3-view).

import type { AircraftProfile } from '../types';
import { NOSE, TAIL, cargo, exit, leg, pax, row } from './shared';

// ---------- 737 ----------

interface B737Opts {
  id: string;
  /** Plug ahead of / behind the wing relative to the 737-800 (m). */
  fwd: number;
  aft: number;
  max: boolean;
  ref: AircraftProfile['ref'];
  midExit?: boolean;
}

function b737(o: B737Opts): AircraftProfile {
  const L = 39.47 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  return {
    id: o.id,
    length: L,
    height: 4.01,
    nose: NOSE.b737,
    cockpit: { style: 'b737', u: 0.36, v: 0.09, scale: 0.82 },
    tail: o.max ? TAIL.b737max : TAIL.b737,
    fin: { x: 32.5 + fa, rootChord: 4.9, tipChord: 1.75, height: 7.1, sweep: 43, fillet: { len: 3.6, h: 1.45, knee: true }, rudder: 0.33 },
    stab: { x: 35.4 + fa, y: 1.25, rootChord: 3.5, tipChord: 1.15, span: 6.0, sweep: 35, dihedral: 7, thickness: 0.34 },
    wing: { x: 15.5 + f, y: -1.25, rootChord: 6.2, tipChord: 1.3, span: 15.3, sweep: 28, dihedral: 6, thickness: 0.75, tip: o.max ? 'scimitar' : 'blended', tipH: o.max ? 2.4 : 2.44 },
    engines: [
      o.max
        ? { mount: 'underwing', style: 'chevron', x: 12.5 + f, y: -1.5, dia: 2.15, len: 5.0, station: 0.3 }
        : { mount: 'underwing', style: 'flatbottom', x: 13.2 + f, y: -1.62, dia: 2.0, len: 4.7, station: 0.3 },
    ],
    fairing: { x0: 14.0 + f, x1: 23.4 + f, depth: 0.2 },
    gear: { stance: o.max ? 3.42 : 3.3, nose: leg(3.9, 2, 0.69), main: [leg(19.4 + f, 2, 1.12)] },
    doors: [
      pax(4.4, 0.86, 1.83), exit(16.9 + f), exit(17.7 + f), ...(o.midExit ? [exit(24.0 + f, 0.6, 1.2)] : []), pax(32.0 + fa, 0.76, 1.68),
      cargo(7.9, 1.22, 0.89), cargo(26.6 + f, 1.22, 0.89),
    ],
    windows: [row(6.2, 30.9 + fa, 0.52, 0.508, 0.24, 0.33)],
    ref: o.ref,
  };
}

const b738 = b737({ id: 'b738', fwd: 0, aft: 0, max: false, ref: { overallHeight: 12.55, span: 35.79 } });
const b38m = b737({ id: 'b38m', fwd: 0, aft: 0, max: true, ref: { overallHeight: 12.3, span: 35.9 } });
const b3jm = b737({ id: 'b3jm', fwd: 2.4, aft: 1.93, max: true, midExit: true, ref: { overallHeight: 12.3, span: 35.9 } });
b3jm.gear.stance = 3.55; // levered main gear

// ---------- 757-200 ----------

const b752: AircraftProfile = {
  id: 'b752',
  length: 47.32,
  height: 4.01,
  nose: NOSE.b757,
  cockpit: { style: 'b757', u: 0.42, v: 0.09, scale: 0.82 },
  tail: TAIL.b757,
  fin: { x: 38.2, rootChord: 6.4, tipChord: 2.2, height: 7.6, sweep: 40, fillet: { len: 3.4, h: 1.3, knee: true }, rudder: 0.33 },
  stab: { x: 41.0, y: 0.95, rootChord: 4.4, tipChord: 1.4, span: 7.2, sweep: 34, dihedral: 7, thickness: 0.4 },
  wing: { x: 17.6, y: -1.2, rootChord: 8.0, tipChord: 1.7, span: 17.1, sweep: 28, dihedral: 5, thickness: 0.95, tip: 'none' },
  engines: [{ mount: 'underwing', style: 'longduct', x: 13.9, y: -2.0, dia: 2.6, len: 6.4, station: 0.3 }],
  fairing: { x0: 16.0, x1: 28.5, depth: 0.22 },
  gear: { stance: 3.95, nose: leg(4.8, 2, 0.8), main: [leg(23.1, 4, 1.15)] },
  doors: [pax(4.6, 0.84, 1.83), pax(11.6, 0.84, 1.83), exit(19.7), exit(20.6), pax(40.4, 0.84, 1.83), cargo(8.3, 1.4, 1.1), cargo(30.6, 1.4, 1.1)],
  windows: [row(6.3, 39.6, 0.52, 0.508, 0.24, 0.33)],
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
  fin: { x: 44.4, rootChord: 8.2, tipChord: 2.6, height: 8.7, sweep: 42, fillet: { len: 3.4, h: 1.3 }, rudder: 0.33 },
  stab: { x: 47.8, y: 0.95, rootChord: 5.4, tipChord: 1.8, span: 8.4, sweep: 34, dihedral: 7, thickness: 0.48 },
  wing: { x: 21.0, y: -1.65, rootChord: 9.2, tipChord: 2.4, span: 21.3, sweep: 34, dihedral: 6, thickness: 1.15, tip: 'none' },
  engines: [{ mount: 'underwing', style: 'plain', x: 17.6, y: -2.55, dia: 2.95, len: 6.4, station: 0.3 }],
  fairing: { x0: 19.4, x1: 33.0, depth: 0.3 },
  gear: { stance: 4.45, nose: leg(5.4, 2, 0.95), main: [leg(28.2, 4, 1.17)] },
  doors: [pax(5.0, 1.07, 1.88), pax(15.4, 1.07, 1.88), exit(28.0, 0.6, 1.2), pax(46.6, 1.07, 1.88), cargo(9.4, 1.78, 1.75), cargo(36.6, 1.78, 1.75)],
  windows: [row(7.2, 46.0, 0.66, 0.508, 0.26, 0.38)],
  ref: { overallHeight: 15.85, span: 47.57 },
};

export const NARROW_BOEING: AircraftProfile[] = [b738, b38m, b3jm, b752, b763];
