// 777-200ER / 777-300ER / 777-9, 747-400 / 747-8I, A380 and Boom Overture.
// Dimensions in metres (777-300ER checked against a 3-view).

import type { AircraftProfile } from '../types';
import { NOSE, TAIL, cargo, leg, pax, row } from './shared';

// ---------- 777 ----------

interface B777Opts {
  id: string;
  /** Plug ahead of / behind the wing relative to the 777-300ER (m, negative = shorter). */
  fwd: number;
  aft: number;
  x: boolean;
  mainX: number;
  ref: AircraftProfile['ref'];
}

function b777(o: B777Opts): AircraftProfile {
  const L = 73.86 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  const short = o.fwd < 0;
  return {
    id: o.id,
    length: L,
    height: 6.2,
    nose: NOSE.b777,
    cockpit: { style: 'b777', u: 0.2, v: 0.075, scale: 0.85 },
    tail: TAIL.b777,
    fin: { x: 61.4 + fa, rootChord: 7.6, tipChord: 2.4, height: o.x ? 10.9 : 10.0, sweep: 44, fillet: { len: 3.0, h: 1.2 }, rudder: 0.34 },
    stab: { x: 65.3 + fa, y: 1.6, rootChord: 5.6, tipChord: 1.9, span: 9.4, sweep: 36, dihedral: 6, thickness: 0.5 },
    wing: {
      x: 29.6 + f, y: -1.9, rootChord: 13.0, tipChord: 3.0, span: o.x ? 29.0 : short ? 27.4 : 27.4, sweep: 33, dihedral: 6, thickness: 1.4,
      tip: o.x ? 'folding' : short ? 'none' : 'raked', tipH: o.x ? 5.0 : short ? 0 : 3.6,
    },
    engines: [{ mount: 'underwing', style: 'ge90', x: 24.6 + f, y: -2.5, dia: o.x ? 4.1 : 3.85, len: o.x ? 9.2 : 8.6, station: 0.3 }],
    fairing: { x0: 27.5 + f, x1: 45.5 + f, depth: 0.38 },
    gear: { stance: o.x ? 5.7 : 5.5, nose: leg(5.85, 2, 1.27), main: [leg(o.mainX, 6, 1.32)] },
    doors: [
      pax(6.4), pax(16.6), pax(32.9 + f), pax(46.5 + f), pax(60.4 + fa),
      cargo(9.8, 2.7, 1.7), cargo(51.0 + f, 1.8, 1.7),
    ],
    windows: [row(8.2, 59.8 + fa, 0.5, 0.508, 0.26, 0.38)],
    ref: o.ref,
  };
}

const b772 = b777({ id: 'b772', fwd: -5.3, aft: -4.83, x: false, mainX: 31.7, ref: { overallHeight: 18.5, span: 60.93 } });
const b77w = b777({ id: 'b77w', fwd: 0, aft: 0, x: false, mainX: 37.3, ref: { overallHeight: 18.5, span: 64.8 } });
const b779 = b777({ id: 'b779', fwd: 1.6, aft: 1.26, x: true, mainX: 38.9, ref: { overallHeight: 19.68, span: 71.75 } });

// ---------- 747 ----------

function b747(id: string, stretch: number, eight: boolean): AircraftProfile {
  const L = 70.66 + stretch;
  const s = stretch * 0.73; // most of the -8 stretch is ahead of the wing
  return {
    id,
    length: L,
    height: 6.5,
    nose: NOSE.b747,
    hump: { x1: (eight ? 32.5 : 28.5), fair: 11 },
    cockpit: { style: 'b747', u: 0.62, v: 0.55, scale: 0.85 },
    tail: TAIL.b747,
    fin: { x: 57.0 + stretch, rootChord: 10.4, tipChord: 3.2, height: 10.85, sweep: 47, fillet: { len: 3.6, h: 1.5 }, rudder: 0.32 },
    stab: { x: 60.4 + stretch, y: 1.3, rootChord: 7.2, tipChord: 2.2, span: 10.4, sweep: 38, dihedral: 7, thickness: 0.6 },
    wing: { x: 25.6 + s, y: -1.95, rootChord: 14.5, tipChord: 4.0, span: eight ? 27.0 : 27.2, sweep: 40, dihedral: 7, thickness: 1.6, tip: eight ? 'raked' : 'winglet', tipH: eight ? 4.5 : 1.9 },
    engines: [
      { mount: 'underwing', style: eight ? 'chevron' : 'plain', x: 22.6 + s, y: -2.75, dia: eight ? 3.2 : 2.95, len: 6.6, station: 0.3, inboard: true },
      { mount: 'underwing', style: eight ? 'chevron' : 'plain', x: 30.2 + s, y: -1.7, dia: eight ? 3.2 : 2.95, len: 6.6, station: 0.62 },
    ],
    fairing: { x0: 23.0 + s, x1: 44.0 + s, depth: 0.42 },
    gear: { stance: 5.3, nose: leg(6.4, 2, 1.25), main: [leg(31.6 + s, 4, 1.25), leg(34.6 + s, 4, 1.25)] },
    doors: [
      pax(6.4), pax(17.4), pax(30.4 + s), pax(43.6 + s), pax(56.0 + stretch),
      { x: (eight ? 26.0 : 22.4), w: 0.9, h: 1.5, y: 3.05, kind: 'exit' },
      cargo(10.2, 2.6, 1.7), cargo(48.6 + s, 2.6, 1.7),
    ],
    windows: [
      row(8.4, 56.6 + stretch, 0.62, 0.508, 0.26, 0.38),
      row(10.2, (eight ? 32.4 : 28.4), 3.75, 0.508, 0.24, 0.34),
    ],
    ref: { overallHeight: eight ? 19.35 : 19.41, span: eight ? 68.4 : 64.44 },
  };
}

const b744 = b747('b744', 0, false);
const b748 = b747('b748', 5.64, true);

// ---------- A380 ----------

const a388: AircraftProfile = {
  id: 'a388',
  length: 72.72,
  height: 8.41,
  nose: NOSE.a380,
  cockpit: { style: 'a380', u: 0.17, v: 0.02, scale: 0.8 },
  tail: TAIL.a380,
  fin: { x: 56.0, rootChord: 12.6, tipChord: 4.0, height: 13.8, sweep: 44, fillet: { len: 4.0, h: 1.6 }, tip: 'round', rudder: 0.34 },
  stab: { x: 60.0, y: 0.5, rootChord: 8.0, tipChord: 2.6, span: 13.8, sweep: 36, dihedral: 5, thickness: 0.7 },
  wing: { x: 24.0, y: -2.95, rootChord: 17.5, tipChord: 4.2, span: 34.2, sweep: 35, dihedral: 5.6, thickness: 2.0, tip: 'fence', tipH: 1.3 },
  engines: [
    { mount: 'underwing', style: 'plain', x: 19.6, y: -4.35, dia: 3.45, len: 7.6, station: 0.28, inboard: true },
    { mount: 'underwing', style: 'plain', x: 27.6, y: -3.0, dia: 3.45, len: 7.6, station: 0.56 },
  ],
  fairing: { x0: 22.5, x1: 46.0, depth: 0.5 },
  gear: { stance: 6.1, nose: leg(6.6, 2, 1.27), main: [leg(36.6, 4, 1.4), leg(40.0, 6, 1.4)] },
  doors: [
    pax(6.0), pax(16.2), pax(31.0), pax(47.4), pax(59.6),
    { x: 13.0, y: 1.55, kind: 'pax' }, { x: 36.4, y: 1.55, kind: 'pax' }, { x: 55.0, y: 1.55, kind: 'pax' },
    cargo(9.6, 2.7, 1.7), cargo(49.8, 2.7, 1.7),
  ],
  windows: [
    row(8.0, 61.4, -0.95, 0.533, 0.28, 0.4),
    row(9.4, 58.6, 2.4, 0.533, 0.26, 0.38),
  ],
  ref: { overallHeight: 24.09, span: 79.75 },
};

// ---------- Boom Overture ----------

const overture: AircraftProfile = {
  id: 'overture',
  length: 61.0,
  height: 3.3,
  nose: NOSE.overture,
  cockpit: { style: 'overture', u: 3.75, v: 0.27, scale: 0.9 },
  tail: TAIL.overture,
  fin: { x: 47.0, rootChord: 10.5, tipChord: 2.4, height: 6.2, sweep: 52, fillet: { len: 4.0, h: 0.9 }, rudder: 0.3 },
  stab: { x: 0, y: 0, rootChord: 0, tipChord: 0, span: 0, sweep: 0, dihedral: 0, none: true },
  wing: { x: 20.5, y: -1.05, rootChord: 29.0, tipChord: 3.0, span: 14.5, sweep: 58, dihedral: 3, thickness: 0.9, tip: 'none', delta: true },
  engines: [
    { mount: 'underwing', style: 'supersonic', x: 34.0, y: -2.45, dia: 1.75, len: 9.0, station: 0.2, inboard: true },
    { mount: 'underwing', style: 'supersonic', x: 37.0, y: -1.95, dia: 1.75, len: 9.0, station: 0.42 },
  ],
  gear: { stance: 3.9, nose: leg(14.5, 2, 0.9), main: [leg(40.0, 4, 1.15)] },
  doors: [pax(12.8, 0.82, 1.8), pax(46.0, 0.82, 1.8)],
  windows: [row(14.4, 45.0, 0.45, 0.762, 0.2, 0.28)],
  ref: { overallHeight: 11.0, span: 32.3 },
};

export const HEAVY: AircraftProfile[] = [b772, b77w, b779, b744, b748, a388, overture];
