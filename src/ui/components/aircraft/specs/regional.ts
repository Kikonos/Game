// Turboprops (ATR 42/72, Dash 8-400) and regional jets (CRJ900, E175, E190-E2,
// E195-E2). Dimensions in metres; x aft of the nose tip, y above the centreline.

import type { AircraftProfile } from '../types';
import { NOSE, TAIL, cargo, exit, leg, pax, row } from './shared';

// ---------- ATR 42 / 72 ----------

function atr(id: string, L: number, stretch: number, ref: AircraftProfile['ref']): AircraftProfile {
  const H = 2.6;
  return {
    id,
    length: L,
    height: H,
    nose: NOSE.atr,
    cockpit: { style: 'atr', u: 0.24, v: 0.05, scale: 0.85 },
    tail: TAIL.turboprop,
    fin: { x: L - 7.3, rootChord: 4.4, tipChord: 1.7, height: 4.2, sweep: 36, fillet: { len: 3.4, h: 0.7 }, rudder: 0.3 },
    stab: { x: L - 3.4, y: 0, rootChord: 1.9, tipChord: 1.05, span: 3.6, sweep: 9, dihedral: 0, thickness: 0.2, tTail: true },
    wing: { x: 9.2 + stretch * 0.4, y: H / 2 + 0.08, rootChord: 2.57, tipChord: 1.41, span: 11.0 + stretch * 0.12, sweep: 3, dihedral: 2.5, thickness: 0.42, tip: 'none', high: true },
    engines: [{ mount: 'turboprop', style: 'turboprop', x: 7.5 + stretch * 0.4, y: 0.62, dia: 1.12, len: 5.0, prop: { dia: 3.93, blades: 6 } }],
    sponson: { x0: 9.6 + stretch * 0.45, x1: 13.6 + stretch * 0.45, depth: 0.32 },
    gear: { stance: 2.15, nose: leg(2.3, 2, 0.45), main: [leg(11.4 + stretch * 0.45, 4, 0.8)], from: 'sponson' },
    doors: [cargo(2.6, 1.27, 1.53), pax(L - 5.4, 0.72, 1.75)],
    windows: [row(4.8, L - 5.8, 0.28, 0.762, 0.25, 0.33)],
    ref,
  };
}

const atr42 = atr('atr42', 22.67, 0, { overallHeight: 7.59, span: 24.57 });
const atr72 = atr('atr72', 27.17, 4.5, { overallHeight: 7.65, span: 27.05 });

// ---------- Dash 8-400 ----------

const q400: AircraftProfile = {
  id: 'q400',
  length: 32.84,
  height: 2.69,
  nose: NOSE.q400,
  cockpit: { style: 'q400', u: 0.36, v: 0.06, scale: 0.85 },
  tail: TAIL.turboprop,
  fin: { x: 25.0, rootChord: 4.9, tipChord: 2.0, height: 4.55, sweep: 32, fillet: { len: 3.6, h: 0.75 }, rudder: 0.32 },
  stab: { x: 29.3, y: 0, rootChord: 2.1, tipChord: 1.1, span: 3.9, sweep: 12, dihedral: 0, thickness: 0.22, tTail: true },
  wing: { x: 13.1, y: 1.43, rootChord: 2.9, tipChord: 1.35, span: 12.9, sweep: 3, dihedral: 2.5, thickness: 0.46, tip: 'none', high: true },
  engines: [{ mount: 'turboprop', style: 'turboprop', x: 10.7, y: 0.6, dia: 1.3, len: 5.2, tailLen: 8.6, prop: { dia: 4.11, blades: 6 } }],
  gear: { stance: 2.45, nose: leg(2.6, 2, 0.56), main: [leg(16.55, 2, 0.86)], from: 'nacelle' },
  doors: [pax(3.4, 0.79, 1.65), pax(27.0, 0.79, 1.65), cargo(25.4, 1.3, 1.5)],
  windows: [row(5.4, 25.6, 0.28, 0.79, 0.27, 0.36)],
  ref: { overallHeight: 8.34, span: 28.42 },
};

// ---------- CRJ900 ----------

const crj900: AircraftProfile = {
  id: 'crj900',
  length: 36.2,
  height: 2.69,
  nose: NOSE.crj,
  cockpit: { style: 'crj', u: 0.48, v: 0.06, scale: 0.85 },
  tail: TAIL.crj,
  fin: { x: 30.0, rootChord: 4.6, tipChord: 2.5, height: 3.8, sweep: 42, fillet: { len: 2.4, h: 0.5 }, rudder: 0.3 },
  stab: { x: 33.2, y: 0, rootChord: 2.3, tipChord: 1.2, span: 4.0, sweep: 30, dihedral: 0, thickness: 0.22, tTail: true },
  wing: { x: 15.4, y: -0.85, rootChord: 4.6, tipChord: 1.1, span: 10.8, sweep: 30, dihedral: 3, thickness: 0.55, tip: 'winglet', tipH: 1.2 },
  engines: [{ mount: 'rear', style: 'rear', x: 25.2, y: 0.62, dia: 1.45, len: 4.0 }],
  fairing: { x0: 14.5, x1: 22.0, depth: 0.16 },
  gear: { stance: 2.4, nose: leg(3.0, 2, 0.6), main: [leg(20.3, 2, 0.95)] },
  doors: [pax(2.85, 0.78, 1.65), exit(15.6), exit(16.9), cargo(24.2, 1.2, 0.85)],
  windows: [row(4.6, 24.4, 0.3, 0.508, 0.22, 0.3)],
  ref: { overallHeight: 7.51, span: 24.85 },
};

// ---------- E-Jets ----------

const e175: AircraftProfile = {
  id: 'e175',
  length: 31.68,
  height: 3.35,
  nose: NOSE.embraer,
  cockpit: { style: 'embraer', u: 0.27, v: 0.06, scale: 0.85 },
  tail: TAIL.regional,
  fin: { x: 25.0, rootChord: 5.2, tipChord: 2.0, height: 5.1, sweep: 40, fillet: { len: 2.6, h: 0.8 }, rudder: 0.32 },
  stab: { x: 27.5, y: 0.45, rootChord: 2.8, tipChord: 1.0, span: 4.6, sweep: 32, dihedral: 7, thickness: 0.26 },
  wing: { x: 12.2, y: -1.0, rootChord: 5.0, tipChord: 1.1, span: 10.9, sweep: 27, dihedral: 5, thickness: 0.6, tip: 'winglet', tipH: 1.4 },
  engines: [{ mount: 'underwing', style: 'plain', x: 10.4, y: -1.6, dia: 1.55, len: 4.0, station: 0.3 }],
  fairing: { x0: 10.8, x1: 19.4, depth: 0.2 },
  gear: { stance: 2.95, nose: leg(3.1, 2, 0.6), main: [leg(17.8, 2, 0.95)] },
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
    cockpit: { style: 'embraer', u: 0.27, v: 0.06, scale: 0.85 },
    tail: TAIL.regional,
    fin: { x: 28.7 + stretch, rootChord: 5.6, tipChord: 2.1, height: 5.95, sweep: 40, fillet: { len: 2.8, h: 0.85 }, rudder: 0.32 },
    stab: { x: 31.6 + stretch, y: 0.45, rootChord: 3.0, tipChord: 1.05, span: 5.0, sweep: 32, dihedral: 7, thickness: 0.28 },
    wing: { x: 13.6 + stretch * 0.55, y: -1.0, rootChord: 5.4, tipChord: 1.2, span: 15.0 + stretch * 0.12, sweep: 27, dihedral: 5, thickness: 0.65, tip: 'raked', tipH: 1.0 },
    engines: [{ mount: 'underwing', style: 'gtf', x: 11.2 + stretch * 0.55, y: -1.85, dia: 2.1, len: 4.6, station: 0.27 }],
    fairing: { x0: 12.0 + stretch * 0.55, x1: 21.2 + stretch * 0.55, depth: 0.22 },
    gear: { stance: 3.3, nose: leg(3.1, 2, 0.66), main: [leg(19.4 + stretch * 0.55, 2, 1.05)] },
    doors: [pax(2.75, 0.82, 1.83), ...exits.map((x) => exit(x)), pax(L - 5.4, 0.72, 1.6), cargo(5.4, 1.1, 0.9), cargo(L - 10.6, 1.1, 0.9)],
    windows: [row(4.6, L - 5.9, 0.5, 0.79, 0.26, 0.38)],
    ref,
  };
}

const e190e2 = e2('e190e2', 36.25, 0, [16.0], { overallHeight: 10.95, span: 33.72 });
const e195e2 = e2('e195e2', 41.5, 5.25, [18.2, 19.0], { overallHeight: 10.9, span: 35.12 });

export const REGIONAL: AircraftProfile[] = [atr42, atr72, q400, crj900, e175, e190e2, e195e2];
