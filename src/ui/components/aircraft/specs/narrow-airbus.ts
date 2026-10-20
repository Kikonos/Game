// A220, A320 family (ceo/neo) and C919. Dimensions in metres (Airbus ACAPS /
// Wikipedia); x aft of the nose tip, y above the fuselage centreline.
// A320 family: the fuselage, cockpit, doors, windows and fin are drawn from the
// traced photos (traced/a320ceo, a319neo, a321ceo; a320neo / a321neo / a321xlr
// reuse the ceo traces); wing, engine and stabiliser stations below are measured
// on those photos so the parametric parts sit where the photos have them.

import type { AircraftProfile, EngineSpec, TipDevice } from '../types';
import { NOSE, TAIL, cargo, exit, pax, row } from './shared';

// ---------- A320 family ----------

interface A320Opts {
  id: string;
  /** Plug ahead of / behind the wing relative to the A320 (m). */
  fwd: number;
  aft: number;
  neo: boolean;
  /** ceo engine: CFM56-5B ('plain') or IAE V2500 ('longduct'). */
  ceoEngine?: 'plain' | 'longduct';
  doors: (o: { fwd: number; aft: number }) => AircraftProfile['doors'];
}

function a320(o: A320Opts): AircraftProfile {
  const H = 4.14;
  const L = 37.57 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  const tip: TipDevice = o.neo ? 'sharklet' : 'fence';
  const engine: EngineSpec = o.neo
    // LEAP-1A / PW1100G: ~0.5 m ahead of the CFM56 intake, bigger fan, bottom ~0.1 m lower
    ? { mount: 'underwing', style: 'gtf', x: 10.9 + f, y: -2.05, dia: 2.4, len: 5.2, station: 0.24 }
    // traced boxes: CFM56-5B (A320 photo), V2500 long duct (A321 photo)
    : o.ceoEngine === 'longduct'
      ? { mount: 'underwing', style: 'longduct', x: 10.95 + f, y: -1.95, dia: 2.14, len: 5.9, station: 0.25 }
      : { mount: 'underwing', style: 'plain', x: 11.4 + f, y: -2.1, dia: 2.09, len: 5.1, station: 0.25 };
  return {
    id: o.id,
    length: L,
    height: H,
    nose: NOSE.airbus,
    cockpit: { style: 'airbus', u: 0.31, v: 0.115 },
    tail: TAIL.airbusNarrow,
    // fin = the traced polygon; stabiliser root LE 5.1 m ahead of the tail end, tip TE at its end
    fin: { x: 30.07 + fa, rootChord: 5.18, tipChord: 1.79, height: 5.75, sweep: 40.5, fillet: { len: 0.9, h: 0.7 }, rudder: 0.32 },
    stab: { x: 32.47 + fa, y: 0.75, rootChord: 3.6, tipChord: 1.25, span: 5.4, sweep: 35, dihedral: 6, thickness: 0.36 },
    wing: { x: 12.0 + f, y: -1.07, rootChord: 7.74, tipChord: 1.5, span: 15.1, sweep: 27, dihedral: 5.1, thickness: 0.75, tip, tipH: o.neo ? 2.43 : 0.75 },
    engines: [engine],
    fairing: { x0: 11.2 + f, x1: 21.8 + f, depth: 0.3 },
    doors: o.doors({ fwd: f, aft: o.aft }),
    windows: [row(6.25, 30.4 + fa, 0.52, 0.533, 0.24, 0.34)],
    ref: { overallHeight: 11.76, span: o.neo ? 35.8 : 34.1 },
  };
}

const doors320 = ({ fwd, aft }: { fwd: number; aft: number }) => [
  pax(4.55), exit(15.05 + fwd), exit(15.95 + fwd), pax(31.15 + fwd + aft), cargo(7.9, 1.82, 1.24), cargo(24.6 + fwd, 1.82, 1.24),
];
const doors319 = ({ fwd, aft }: { fwd: number; aft: number }) => [
  pax(4.55), exit(15.4 + fwd), pax(31.15 + fwd + aft), cargo(7.9, 1.82, 1.24), cargo(24.6 + fwd, 1.82, 1.24),
];
const doors321 = ({ fwd, aft }: { fwd: number; aft: number }) => [
  pax(4.55), pax(13.6), exit(20.1 + fwd - 4.27), pax(24.4 + fwd), pax(31.15 + fwd + aft), cargo(7.9, 1.82, 1.24), cargo(27.6 + fwd, 1.82, 1.24),
];
const doors321acf = ({ fwd, aft }: { fwd: number; aft: number }) => [
  pax(4.55), pax(13.6), exit(15.05 + fwd), exit(15.95 + fwd), pax(31.15 + fwd + aft), cargo(7.9, 1.82, 1.24), cargo(27.6 + fwd, 1.82, 1.24),
];

const a319neo = a320({ id: 'a319neo', fwd: -1.6, aft: -2.13, neo: true, doors: doors319 });
const a320neo = a320({ id: 'a320neo', fwd: 0, aft: 0, neo: true, doors: doors320 });
const a321neo = a320({ id: 'a321neo', fwd: 4.27, aft: 2.67, neo: true, doors: doors321acf });
const a321xlr: AircraftProfile = { ...a320({ id: 'a321xlr', fwd: 4.27, aft: 2.67, neo: true, doors: doors321acf }) };
const a320ceo = a320({ id: 'a320ceo', fwd: 0, aft: 0, neo: false, ceoEngine: 'plain', doors: doors320 });
const a321ceo = a320({ id: 'a321ceo', fwd: 4.27, aft: 2.67, neo: false, ceoEngine: 'longduct', doors: doors321 });

// ---------- A220 ----------

function a220(id: string, L: number, stretch: number, exits: number[]): AircraftProfile {
  const H = 3.7;
  return {
    id,
    length: L,
    height: H,
    nose: NOSE.a220,
    cockpit: { style: 'a220', u: 0.31, v: 0.12, scale: 0.95 },
    tail: TAIL.regional,
    fin: { x: 26.0 + stretch, rootChord: 6.2, tipChord: 2.3, height: 5.6, sweep: 40, fillet: { len: 2.6, h: 0.8 }, rudder: 0.3 },
    stab: { x: 29.4 + stretch, y: 0.45, rootChord: 3.2, tipChord: 1.2, span: 5.2, sweep: 32, dihedral: 6, thickness: 0.32 },
    wing: { x: 12.1 + stretch * 0.55, y: -1.15, rootChord: 6.2, tipChord: 1.4, span: 15.7, sweep: 27, dihedral: 4.5, thickness: 0.7, tip: 'raked', tipH: 1.2 },
    engines: [{ mount: 'underwing', style: 'gtf', x: 10.3 + stretch * 0.55, y: -1.95, dia: 2.2, len: 4.7, station: 0.26 }],
    fairing: { x0: 10.6 + stretch * 0.55, x1: 20.6 + stretch * 0.55, depth: 0.26 },
    doors: [pax(3.9), ...exits.map((x) => exit(x)), pax(L - 6.2), cargo(6.8, 1.6, 1.1), cargo(L - 12.5, 1.6, 1.1)],
    windows: [row(5.6, L - 7.1, 0.45, 0.66, 0.26, 0.38)],
    ref: { overallHeight: 11.5, span: 35.1 },
  };
}

const a220_100 = a220('a220_100', 35.0, 0, [15.6]);
const a220_300 = a220('a220_300', 38.7, 3.7, [16.6, 18.6]);

// ---------- C919 ----------

const c919: AircraftProfile = {
  id: 'c919',
  length: 38.9,
  height: 4.17,
  nose: NOSE.c919,
  cockpit: { style: 'c919', u: 0.33, v: 0.12, scale: 0.95 },
  tail: TAIL.regional,
  fin: { x: 29.8, rootChord: 6.6, tipChord: 2.1, height: 5.95, sweep: 38, fillet: { len: 2.4, h: 0.9 }, rudder: 0.32 },
  stab: { x: 32.6, y: 0.45, rootChord: 3.7, tipChord: 1.3, span: 5.6, sweep: 32, dihedral: 6, thickness: 0.37 },
  wing: { x: 13.6, y: -1.3, rootChord: 6.6, tipChord: 1.5, span: 15.2, sweep: 27, dihedral: 5, thickness: 0.75, tip: 'sharklet', tipH: 2.1 },
  engines: [{ mount: 'underwing', style: 'plain', x: 11.8, y: -2.15, dia: 2.35, len: 5.1, station: 0.25 }],
  fairing: { x0: 11.9, x1: 22.4, depth: 0.3 },
  doors: [pax(4.7), exit(15.9), exit(16.8), pax(32.4), cargo(8.2, 1.8, 1.25), cargo(25.6, 1.8, 1.25)],
  windows: [row(6.4, 31.7, 0.52, 0.533, 0.24, 0.34)],
  ref: { overallHeight: 11.95, span: 35.8 },
};

export const NARROW_AIRBUS: AircraftProfile[] = [a220_100, a220_300, a319neo, a320neo, a321neo, a321xlr, a320ceo, a321ceo, c919];
