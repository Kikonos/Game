// A330-300 / A330-900, 787-8/9/10, A350-900/1000. Dimensions in metres
// (A330-300 and 787-8 checked against 3-views; the others scaled from them).
// Low wings: the root band sits on the lower third of the fuselage, just above
// the belly fairing, and rises aft with the real dihedral.

import type { AircraftProfile } from '../types';
import { NOSE, TAIL, cargo, exit, leg, pax, row } from './shared';

// ---------- A330 ----------

function a330(id: string, neo: boolean): AircraftProfile {
  return {
    id,
    length: 63.67,
    height: 5.64,
    nose: NOSE.airbus,
    cockpit: { style: 'airbus', u: 0.22, v: 0.075, scale: 0.88 },
    tail: TAIL.airbusWide,
    fin: { x: 51.3, rootChord: 9.1, tipChord: 2.64, height: 8.6, sweep: 47, fillet: { len: 3.6, h: 1.3 }, tip: 'round', rudder: 0.33 },
    stab: { x: 56.4, y: 1.6, rootChord: 4.8, tipChord: 2.0, span: 8.7, sweep: 31, dihedral: 5.6, thickness: 0.45 },
    wing: { x: 23.4, y: -1.45, rootChord: 10.6, tipChord: 2.0, span: neo ? 27.6 : 26.8, sweep: 32, dihedral: 6.5, thickness: 1.2, tip: neo ? 'sharklet' : 'winglet', tipH: neo ? 4.0 : 2.7 },
    engines: [
      neo
        ? { mount: 'underwing', style: 'plain', x: 19.9, y: -3.0, dia: 3.5, len: 8.0, station: 0.33 }
        : { mount: 'underwing', style: 'longduct', x: 20.6, y: -2.95, dia: 3.06, len: 8.1, station: 0.33 },
    ],
    fairing: { x0: 20.5, x1: 40.0, depth: 0.25 },
    gear: { stance: 5.4, nose: leg(6.75, 2, 1.1), main: [leg(32.2, 4, 1.37)] },
    doors: [pax(5.1), pax(17.2), exit(35.9, 0.76, 1.4), pax(50.9), cargo(7.9, 2.7, 1.7), cargo(43.5, 2.7, 1.7)],
    windows: [row(7.4, 49.6, 0.73, 0.533, 0.27, 0.38)],
    ref: { overallHeight: 16.79, span: neo ? 64.0 : 60.3 },
  };
}

const a333 = a330('a333', false);
const a339 = a330('a339', true);

// ---------- 787 ----------

function b787(id: string, fwd: number, aft: number, mainX: number, ref: AircraftProfile['ref']): AircraftProfile {
  const L = 56.72 + fwd + aft;
  const fa = fwd + aft;
  return {
    id,
    length: L,
    height: 5.94,
    nose: NOSE.b787,
    cockpit: { style: 'b787', u: 0.27, v: 0.04, scale: 0.72 },
    tail: TAIL.b787,
    fin: { x: 46.3 + fa, rootChord: 6.9, tipChord: 2.2, height: 9.0 + (ref.overallHeight - 16.92), sweep: 42, fillet: { len: 2.8, h: 1.2 }, tip: 'round', bow: 0.03, rudder: 0.35 },
    stab: { x: 48.3 + fa, y: 0.6, rootChord: 5.0, tipChord: 1.6, span: 8.8, sweep: 40, dihedral: 9, thickness: 0.45 },
    wing: { x: 21.0 + fwd, y: -1.6, rootChord: 10.5, tipChord: 2.8, span: 23.0, sweep: 34, dihedral: 8, thickness: 1.2, tip: 'raked', tipH: 4.5 },
    engines: [{ mount: 'underwing', style: 'chevron', x: 16.0 + fwd, y: -2.55, dia: 3.5, len: 8.6, station: 0.3 }],
    fairing: { x0: 17.5 + fwd, x1: 34.0 + fwd, depth: 0.35 },
    gear: { stance: 4.87 + (ref.overallHeight - 16.92), nose: leg(5.1, 2, 1.1), main: [leg(mainX, 4, 1.32)] },
    doors: [pax(5.2), pax(14.3), pax(32.0 + fwd), pax(43.4 + fa), cargo(9.6, 2.7, 1.7), cargo(37.6 + fa - aft * 0.3, 2.7, 1.7)],
    windows: [row(7.0, 42.5 + fa, 0.83, 0.61, 0.28, 0.46)],
    ref,
  };
}

const b788 = b787('b788', 0, 0, 27.9, { overallHeight: 16.92, span: 60.12 });
const b789 = b787('b789', 3.05, 3.04, 31.1, { overallHeight: 17.02, span: 60.12 });
const b78x = b787('b78x', 5.8, 5.76, 33.9, { overallHeight: 17.02, span: 60.12 });

// ---------- A350 ----------

function a350(id: string, fwd: number, aft: number, mainX: number, wheels: 4 | 6, ref: AircraftProfile['ref']): AircraftProfile {
  const L = 66.8 + fwd + aft;
  const fa = fwd + aft;
  return {
    id,
    length: L,
    height: 6.09,
    nose: NOSE.a350,
    cockpit: { style: 'a350', u: 0.27, v: 0.05, scale: 0.78 },
    tail: TAIL.a350,
    fin: { x: 53.6 + fa, rootChord: 8.8, tipChord: 2.8, height: 8.8, sweep: 45, fillet: { len: 4.0, h: 1.5 }, tip: 'round', bow: 0.04, rudder: 0.33 },
    stab: { x: 57.4 + fa, y: 0.8, rootChord: 5.6, tipChord: 1.8, span: 8.8, sweep: 36, dihedral: 7, thickness: 0.5 },
    wing: { x: 23.4 + fwd, y: -1.95, rootChord: 12.0 + (wheels === 6 ? 0.4 : 0), tipChord: 2.6, span: 26.5, sweep: 34, dihedral: 7, thickness: 1.3, tip: 'curved', tipH: 2.9 },
    engines: [{ mount: 'underwing', style: 'plain', x: 18.8 + fwd, y: -3.05, dia: wheels === 6 ? 3.75 : 3.6, len: 8.4, station: 0.32 }],
    fairing: { x0: 20.5 + fwd, x1: 40.5 + fwd, depth: 0.32 },
    gear: { stance: 5.2, nose: leg(6.2, 2, 1.15), main: [leg(mainX, wheels, 1.4)] },
    doors: [pax(5.4), pax(17.2), pax(37.8 + fwd), pax(56.4 + fa), cargo(8.6, 2.7, 1.7), cargo(46.0 + fa - aft * 0.3, 2.7, 1.7)],
    windows: [row(7.2, 55.8 + fa, 0.76, 0.533, 0.28, 0.4)],
    ref,
  };
}

const a359 = a350('a359', 0, 0, 34.9, 4, { overallHeight: 17.05, span: 64.75 });
const a35k = a350('a35k', 3.8, 3.19, 38.7, 6, { overallHeight: 17.08, span: 64.75 });

export const WIDE_TWIN: AircraftProfile[] = [a333, a339, b788, b789, b78x, a359, a35k];
