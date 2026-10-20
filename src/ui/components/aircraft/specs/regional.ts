// Turboprops (ATR 42/72, Dash 8-400) and regional jets (CRJ900, E175, E190-E2,
// E195-E2). Dimensions in metres; x aft of the nose tip, y above the centreline.

import type { AircraftProfile, NoseSpec, TailConeSpec } from '../types';
import { NOSE, TAIL, cargo, exit, pax, row } from './shared';

// ---------- ATR 42 / 72 ----------
// Fitted to the ATR family 3-view: the -72 is the -42 with ~2.27 m ahead of the wing
// and ~2.23 m behind it. High wing drawn as its root aerofoil with the nacelle slung
// beneath, propeller in front, gear-sponson pod on the lower fuselage (no wheels drawn).

const NOSE_ATR: NoseSpec = {
  upper: [0, -0.22, 0, -0.12, 0.17, 0.04, 0.36, 0.1, 0.49, 0.142, 0.72, 0.38, 0.87, 0.44, 1.0, 0.492, 1.15, 0.5, 1.3, 0.5],
  lower: [0, -0.22, 0, -0.3, 0.1, -0.41, 0.27, -0.45, 0.37, -0.474, 0.5, -0.5, 0.7, -0.5],
  radome: 0.2,
};

/** Long straight belly upsweep to a rounded tip at ~0.27 H, no APU. */
const TAIL_ATR: TailConeSpec = {
  upper: [-1.2, 0.5, -0.7, 0.5, -0.25, 0.44, 0, 0.3],
  lower: [-3.0, -0.5, -2.6, -0.5, -2.35, -0.38, -2.0, -0.29, -1.4, -0.145, -0.7, 0.02, -0.12, 0.16, -0.04, 0.18, 0, 0.22, 0, 0.27],
};

function atr(id: string, f: number, aft: number, span: number, ref: AircraftProfile['ref']): AircraftProfile {
  const H = 2.6;
  const L = 22.67 + f + aft;
  return {
    id,
    length: L,
    height: H,
    nose: NOSE_ATR,
    cockpit: { style: 'atr', u: 0.62, v: 0.18, scale: 0.85 },
    tail: TAIL_ATR,
    fin: { x: L - 5.17, rootChord: 4.0, tipChord: 1.85, height: 4.2, sweep: 38, fillet: { len: 4.4, h: 1.5 }, rudder: 0.32 },
    stab: { x: L - 2.2, y: 0, rootChord: 2.05, tipChord: 1.2, span: 3.45, sweep: 10, dihedral: 0, thickness: 0.2, tTail: true },
    wing: { x: 8.55 + f, y: H / 2 + 0.14, rootChord: 2.9, tipChord: 1.41, span, sweep: 3, dihedral: 2.5, thickness: 0.46, tip: 'none', high: true, section: true },
    engines: [{ mount: 'turboprop', style: 'turboprop', x: 6.47 + f, y: 0.86, dia: 1.26, len: 6.5, prop: { dia: 3.93, blades: 6 } }],
    sponson: { x0: 7.56 + f, x1: 13.01 + f, depth: 0.3, rise: 0.95 },
    doors: [cargo(3.67, 1.31, 1.76), pax(L - 7.57, 0.75, 1.75)],
    windows: [row(5.72, L - 8.2, 0.2, 0.54, 0.22, 0.34)],
    // titles above the big forward cargo door, ending short of the propeller
    titles: { x: 3.25, y: 0.93, w: 3.2 + f, size: 0.44 },
    ref,
  };
}

const atr42 = atr('atr42', 0, 0, 10.9, { overallHeight: 7.59, span: 24.57 });
const atr72 = atr('atr72', 2.27, 2.23, 12.1, { overallHeight: 7.65, span: 27.05 });

// ---------- Dash 8-400 ----------
// Long slender fuselage, pointed nose, very long nacelles (they house the main gear),
// big T-tail whose stabiliser overhangs the tail cone (length = tail-cone tip).

const NOSE_Q400: NoseSpec = {
  upper: [0, -0.2, 0, -0.11, 0.2, 0.0, 0.42, 0.07, 0.6, 0.12, 0.84, 0.36, 1.0, 0.43, 1.17, 0.49, 1.35, 0.5, 1.55, 0.5],
  lower: [0, -0.2, 0, -0.29, 0.14, -0.4, 0.36, -0.45, 0.5, -0.476, 0.7, -0.5, 0.9, -0.5],
  radome: 0.26,
};

const TAIL_Q400: TailConeSpec = {
  upper: [-1.3, 0.5, -0.8, 0.5, -0.3, 0.45, 0, 0.36],
  lower: [-2.7, -0.5, -2.0, -0.5, -1.1, -0.16, -0.2, 0.17, -0.05, 0.22, 0, 0.26, 0, 0.3],
};

const q400: AircraftProfile = {
  id: 'q400',
  length: 31.2,
  height: 2.69,
  nose: NOSE_Q400,
  cockpit: { style: 'q400', u: 0.64, v: 0.08, scale: 0.85 },
  tail: TAIL_Q400,
  fin: { x: 25.3, rootChord: 5.2, tipChord: 2.6, height: 4.55, sweep: 38, fillet: { len: 3.2, h: 1.3 }, rudder: 0.36 },
  stab: { x: 28.6, y: 0, rootChord: 2.6, tipChord: 1.3, span: 4.0, sweep: 25, dihedral: 0, thickness: 0.24, tTail: true },
  wing: { x: 10.3, y: 1.47, rootChord: 2.95, tipChord: 1.35, span: 12.9, sweep: 3, dihedral: 2.5, thickness: 0.56, tip: 'none', high: true, section: true },
  engines: [{ mount: 'turboprop', style: 'turboprop', x: 7.9, y: 0.64, dia: 1.74, len: 5.2, tailLen: 9.2, prop: { dia: 4.11, blades: 6 } }],
  doors: [pax(3.5, 0.85, 1.7), pax(20.2, 0.8, 1.65), cargo(21.7, 1.45, 1.55)],
  windows: [row(5.1, 19.6, 0.3, 0.6, 0.26, 0.36)],
  ref: { overallHeight: 8.34, span: 28.42 },
};

// ---------- CRJ900 ----------
// Fitted to a side-on photo: slender tube, rear CF34s high on the
// fuselage, swept fin and T-tail overhanging the tail cone (length = tail-cone tip;
// 36.2 m overall includes the stabiliser).

const NOSE_CRJ: NoseSpec = {
  upper: [0, -0.2, 0, -0.1, 0.15, 0.0, 0.35, 0.06, 0.55, 0.12, 0.75, 0.32, 0.95, 0.41, 1.15, 0.48, 1.35, 0.5, 1.6, 0.5],
  lower: [0, -0.2, 0, -0.3, 0.15, -0.41, 0.4, -0.46, 0.55, -0.49, 0.75, -0.5, 1.0, -0.5],
  radome: 0.24,
};

const TAIL_CRJ: TailConeSpec = {
  upper: [-1.8, 0.5, -1.1, 0.5, -0.45, 0.36, 0, 0.25],
  lower: [-3.4, -0.5, -2.4, -0.5, -1.0, -0.2, 0, -0.05],
  apu: 0.22,
};

const crj900: AircraftProfile = {
  id: 'crj900',
  length: 33.4,
  height: 2.69,
  nose: NOSE_CRJ,
  cockpit: { style: 'crj', u: 0.62, v: 0.12, scale: 1.0 },
  tail: TAIL_CRJ,
  fin: { x: 28.4, rootChord: 4.0, tipChord: 2.5, height: 2.92, sweep: 50, fillet: { len: 1.8, h: 0.45 }, rudder: 0.32 },
  stab: { x: 32.2, y: 0, rootChord: 2.4, tipChord: 1.15, span: 4.2, sweep: 33, dihedral: 0, thickness: 0.22, tTail: true },
  wing: { x: 15.0, y: -0.95, rootChord: 5.4, tipChord: 1.2, span: 11.0, sweep: 26.5, dihedral: 5.5, thickness: 0.55, tip: 'winglet', tipH: 1.7 },
  engines: [{ mount: 'rear', style: 'rear', x: 25.2, y: 0.85, dia: 1.5, len: 3.9 }],
  fairing: { x0: 14.0, x1: 22.4, depth: 0.16 },
  doors: [pax(4.0, 0.86, 1.8), exit(16.6, 0.5, 0.95), exit(17.7, 0.5, 0.95), cargo(25.0, 1.27, 0.9)],
  windows: [row(5.5, 24.3, 0.53, 0.79, 0.21, 0.3)],
  ref: { overallHeight: 7.51, span: 24.85 },
};

// ---------- E-Jets ----------

const e175: AircraftProfile = {
  id: 'e175',
  length: 31.68,
  height: 3.35,
  nose: NOSE.embraer,
  cockpit: { style: 'embraer', u: 0.35, v: 0.09, scale: 0.85 },
  tail: TAIL.regional,
  fin: { x: 25.0, rootChord: 5.2, tipChord: 2.0, height: 5.1, sweep: 40, fillet: { len: 2.6, h: 0.8 }, rudder: 0.32 },
  stab: { x: 27.5, y: 0.45, rootChord: 2.8, tipChord: 1.0, span: 4.6, sweep: 32, dihedral: 7, thickness: 0.26 },
  wing: { x: 12.2, y: -1.0, rootChord: 5.0, tipChord: 1.1, span: 10.9, sweep: 27, dihedral: 5, thickness: 0.6, tip: 'winglet', tipH: 1.4 },
  engines: [{ mount: 'underwing', style: 'plain', x: 10.4, y: -1.6, dia: 1.55, len: 4.0, station: 0.3 }],
  fairing: { x0: 10.8, x1: 19.4, depth: 0.2 },
  doors: [pax(2.75, 0.82, 1.83), exit(14.0), pax(26.3, 0.72, 1.6), cargo(5.4, 1.1, 0.9), cargo(21.4, 1.1, 0.9)],
  windows: [row(4.6, 25.8, 0.5, 0.79, 0.26, 0.38)],
  ref: { overallHeight: 9.73, span: 26.0 },
};

function e2(id: string, L: number, stretch: number, exits: number[], ref: AircraftProfile['ref']): AircraftProfile {
  return {
    id,
    length: L,
    height: 3.35,
    nose: NOSE.embraer,
    cockpit: { style: 'embraer', u: 0.35, v: 0.09, scale: 0.85 },
    tail: TAIL.regional,
    fin: { x: 28.7 + stretch, rootChord: 5.6, tipChord: 2.1, height: 5.95, sweep: 40, fillet: { len: 2.8, h: 0.85 }, rudder: 0.32 },
    stab: { x: 31.6 + stretch, y: 0.45, rootChord: 3.0, tipChord: 1.05, span: 5.0, sweep: 32, dihedral: 7, thickness: 0.28 },
    wing: { x: 13.6 + stretch * 0.55, y: -1.0, rootChord: 5.4, tipChord: 1.2, span: 15.0 + stretch * 0.12, sweep: 27, dihedral: 5, thickness: 0.65, tip: 'raked', tipH: 1.0 },
    engines: [{ mount: 'underwing', style: 'gtf', x: 11.2 + stretch * 0.55, y: -1.85, dia: 2.1, len: 4.6, station: 0.27 }],
    fairing: { x0: 12.0 + stretch * 0.55, x1: 21.2 + stretch * 0.55, depth: 0.22 },
    doors: [pax(2.75, 0.82, 1.83), ...exits.map((x) => exit(x)), pax(L - 5.4, 0.72, 1.6), cargo(5.4, 1.1, 0.9), cargo(L - 10.6, 1.1, 0.9)],
    windows: [row(4.6, L - 5.9, 0.5, 0.79, 0.26, 0.38)],
    ref,
  };
}

const e190e2 = e2('e190e2', 36.25, 0, [16.0], { overallHeight: 10.95, span: 33.72 });
const e195e2 = e2('e195e2', 41.5, 5.25, [18.2, 19.0], { overallHeight: 10.9, span: 35.12 });

export const REGIONAL: AircraftProfile[] = [atr42, atr72, q400, crj900, e175, e190e2, e195e2];
