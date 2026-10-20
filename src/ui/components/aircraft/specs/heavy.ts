// 777-200ER / 777-300ER / 777-9, 747-400 / 747-8I and A380.
// Dimensions in metres (Boeing / Airbus airport-planning data, Wikipedia);
// door, engine and fin stations measured off the Scavini 3-views of the
// 777, 747 and A380 families.

import type { TracedProfile } from '../traced/types';
import type { AircraftProfile, NoseSpec } from '../types';
import { NOSE, TAIL, cargo, pax, row } from './shared';
import { resizeNacelle, stretchTrace } from './wide-twin';

// ---------- 777 ----------

interface B777Opts {
  id: string;
  /** Plug ahead of / behind the wing relative to the 777-300ER (m, negative = shorter). */
  fwd: number;
  aft: number;
  x: boolean;
  /** -200LR: the short fuselage with the -300ER's raked wing and GE90-110/115 nacelles. */
  lr?: boolean;
  ref: AircraftProfile['ref'];
}

function b777(o: B777Opts): AircraftProfile {
  const L = 73.86 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  const short = o.fwd < 0;
  // -200ER: the original wing tip and the smaller GE90-94
  const er = short && !o.lr;
  return {
    id: o.id,
    length: L,
    height: 6.2,
    nose: NOSE.b777,
    cockpit: { style: 'b777', u: 0.31, v: 0.12, scale: 0.72 },
    tail: TAIL.b777,
    fin: { x: 60.6 + fa, rootChord: 8.5, tipChord: 2.5, height: o.x ? 10.9 : 10.0, sweep: 44, fillet: { len: 3.0, h: 1.2 }, rudder: 0.34 },
    stab: { x: 65.3 + fa, y: 1.6, rootChord: 5.6, tipChord: 1.9, span: o.x ? 9.8 : 9.4, sweep: 36, dihedral: 6, thickness: 0.5 },
    wing: {
      x: 29.6 + f, y: -1.9, rootChord: 13.0, tipChord: 3.0, span: o.x ? 29.4 : 27.4, sweep: 33, dihedral: 6, thickness: 1.4,
      // -200ER plain tip, -200LR / -300ER raked tip, -9 composite wing with a folding raked tip
      tip: o.x ? 'folding' : er ? 'none' : 'raked', tipH: o.x ? 5.0 : er ? 0 : 3.6,
    },
    // GE90-94B / GE90-115B / GE9X: each one bigger, all hung low with ~0.7 m ground clearance
    engines: [{ mount: 'underwing', style: 'ge90', x: 25.0 + f, y: -2.75, dia: o.x ? 4.4 : er ? 3.9 : 4.05, len: o.x ? 9.4 : er ? 8.6 : 8.8, station: 0.3 }],
    fairing: { x0: 27.5 + f, x1: 45.5 + f, depth: 0.38 },
    doors: short
      // -200ER: four pairs, L3 over the wing trailing edge
      ? [pax(5.9), pax(16.4), pax(35.6), pax(49.1), cargo(10.2, 2.9, 1.7), cargo(50.2 + fa, 2.0, 1.7)]
      // -300ER / -9: five pairs
      : [pax(5.9), pax(16.0 + f), pax(32.0 + f), pax(45.5 + f), pax(59.1 + fa), cargo(10.2, 2.9, 1.7), cargo(50.2 + fa, 2.0, 1.7)],
    // 777X: larger 787-style windows
    windows: [o.x ? row(8.2, 58.6 + fa, 0.56, 0.508, 0.3, 0.46) : row(8.2, 58.6 + fa, 0.56, 0.508, 0.26, 0.38)],
    ref: o.ref,
  };
}

const b772 = b777({ id: 'b772', fwd: -5.3, aft: -4.83, x: false, ref: { overallHeight: 18.5, span: 60.93 } });
const b77l = b777({ id: 'b77l', fwd: -5.3, aft: -4.83, x: false, lr: true, ref: { overallHeight: 18.6, span: 64.8 } });
const b77w = b777({ id: 'b77w', fwd: 0, aft: 0, x: false, ref: { overallHeight: 18.5, span: 64.8 } });
const b779 = b777({ id: 'b779', fwd: 1.6, aft: 1.26, x: true, ref: { overallHeight: 19.68, span: 71.75 } });

// ---------- 747 ----------

/** 747 (sampled off the 747-400 3-view, H = main-deck height): bluff nose with the tip on the centreline, ending on the hump top. */
const NOSE_747: NoseSpec = {
  upper: [0, 0, 0, 0.1, 0.22, 0.27, 0.44, 0.321, 0.56, 0.36, 0.75, 0.53, 0.88, 0.595, 0.96, 0.635, 1.08, 0.654, 1.25, 0.654],
  lower: [0, 0, 0, -0.12, 0.18, -0.26, 0.44, -0.298, 0.66, -0.36, 0.85, -0.43, 1.03, -0.453, 1.3, -0.48, 1.5, -0.5, 1.76, -0.5],
  radome: 0.14,
};

function b747(id: string, stretch: number, eight: boolean): AircraftProfile {
  const L = 70.66 + stretch;
  const s = eight ? 4.1 : 0; // the -8 plug ahead of the wing (also lengthens the upper deck)
  return {
    id,
    length: L,
    height: 6.8,
    nose: NOSE_747,
    hump: { x1: 23.5 + s, fair: 7.5 },
    cockpit: { style: 'b747', u: 0.79, v: 0.45, scale: 0.85 },
    tail: TAIL.b747,
    // big 50-degree fin whose tip overhangs the tail cone
    fin: { x: 56.7 + stretch, rootChord: 12.0, tipChord: 3.5, height: 10.55, sweep: 50, fillet: { len: 3.6, h: 1.5 }, rudder: 0.32 },
    stab: { x: 60.4 + stretch, y: 1.3, rootChord: 7.2, tipChord: 2.2, span: 10.4, sweep: 38, dihedral: 7, thickness: 0.6 },
    wing: { x: 25.6 + s, y: -1.95, rootChord: 14.5, tipChord: 4.0, span: eight ? 28.0 : 27.2, sweep: 40, dihedral: 7, thickness: 1.6, tip: eight ? 'raked' : 'winglet', tipH: eight ? 4.5 : 1.9 },
    // inboard pair further forward and lower (sweep + dihedral); -8 GEnx-2B with chevrons
    engines: [
      { mount: 'underwing', style: eight ? 'chevron' : 'plain', x: 24.6 + s, y: -3.16, dia: eight ? 3.05 : 2.75, len: eight ? 6.9 : 6.6, station: 0.3, inboard: true },
      { mount: 'underwing', style: eight ? 'chevron' : 'plain', x: 32.6 + s, y: -2.64, dia: eight ? 3.05 : 2.75, len: eight ? 6.9 : 6.6, station: 0.62 },
    ],
    fairing: { x0: 18.0 + s, x1: 41.8 + s, depth: 0.3 },
    doors: [
      pax(9.1), pax(18.9 + s), pax(31.7 + s), pax(42.4 + s), pax(57.4 + stretch),
      { x: 15.2, w: 0.95, h: 1.75, y: 2.1, kind: 'pax' }, // upper-deck door
      cargo(12.4, 2.75, 1.7), cargo(45.7 + s, 2.6, 1.7),
    ],
    windows: [
      row(2.4, 57.0 + stretch, 0.44, 0.508, 0.26, 0.38),
      // upper deck (measured on the 747-400 photo; the traced fuselage draws the main-deck row):
      // 10 + 9 windows either side of the exit, which sits ahead of the -8 plug
      row(10.3, 21.6 + s, 2.93, 0.537, 0.24, 0.34, [[15.4, 17.0]]),
    ],
    // titles on the hump side, centred between the main-deck door tops (1.24 m) and the upper-deck
    // window row (2.76 m), starting 0.08 H aft of the upper-deck door (15.65-16.75 m)
    titles: { x: 17.3, y: 2.0, w: 10.5 + s, size: 1.2 },
    ref: { overallHeight: eight ? 19.35 : 19.41, span: eight ? 68.4 : 64.44 },
  };
}

const b744 = b747('b744', 0, false);
const b748 = b747('b748', 5.6, true);

/** 747-8I plugs on the 747-400 trace: 4.1 m under the hump between the upper-deck exit and door 2 (the upper deck grows with it), 1.5 m between doors 4 and 5. */
export const B748_PLUGS = [{ at: 0.255, m: 4.1 }, { at: 0.625, m: 1.5 }] as const;

/** 747-8I trace (traced/b748.ts): the 747-400 nose, hump, cockpit and tail cone, plugged, with the bigger GEnx-2B nacelles. */
export function b748Trace(b744t: TracedProfile): TracedProfile {
  const t = stretchTrace(b744t, b744.length, 'b748', b748.length, B748_PLUGS, `derived from b744 (${b744t.source}): plugs 4.1 m @0.255, 1.5 m @0.625; GEnx-2B nacelles`);
  return { ...t, engines: t.engines?.map((e) => resizeNacelle(e, 6.9 / 6.6, 3.05 / 2.75)) };
}

// ---------- A380 ----------

const a388: AircraftProfile = {
  id: 'a388',
  length: 72.72,
  height: 8.41,
  nose: NOSE.a380,
  cockpit: { style: 'a380', u: 0.18, v: -0.01, scale: 0.6 },
  tail: TAIL.a380,
  fin: { x: 56.0, rootChord: 12.2, tipChord: 3.4, height: 13.8, sweep: 44, fillet: { len: 4.0, h: 1.6 }, tip: 'round', rudder: 0.34 },
  stab: { x: 59.2, y: 1.0, rootChord: 8.0, tipChord: 2.6, span: 13.8, sweep: 36, dihedral: 5, thickness: 0.7 },
  wing: { x: 24.0, y: -2.95, rootChord: 17.5, tipChord: 4.2, span: 34.2, sweep: 40.8, dihedral: 4.9, thickness: 2.0, tip: 'fence', tipH: 1.3 },
  // Trent 900 / GP7200: inboard pair at the wing's leading edge, outboard ~7 m further aft and higher
  engines: [
    { mount: 'underwing', style: 'trent900', x: 24.7, y: -3.35, dia: 3.5, len: 7.6, station: 0.28, inboard: true },
    { mount: 'underwing', style: 'trent900', x: 31.8, y: -2.85, dia: 3.5, len: 7.6, station: 0.56 },
  ],
  fairing: { x0: 18.5, x1: 46.0, depth: 0.5 },
  doors: [
    pax(5.6), pax(15.9), pax(32.5), pax(43.6), pax(53.8),
    { x: 20.4, y: 1.55, kind: 'pax' }, { x: 40.1, y: 1.55, kind: 'pax' }, { x: 49.3, y: 1.55, kind: 'pax' },
    cargo(10.2, 2.9, 1.7), cargo(47.5, 2.7, 1.7),
  ],
  windows: [
    row(7.8, 56.2, -0.15, 0.533, 0.28, 0.4),
    // upper deck (measured on the A380 photo; the traced fuselage draws the main-deck row), gaps at U1-U3
    row(13.54, 54.56, 2.44, 0.662, 0.25, 0.36, [[20.6, 23.0], [40.4, 42.9], [49.7, 52.1]]),
  ],
  ref: { overallHeight: 24.09, span: 79.75 },
};

export const HEAVY: AircraftProfile[] = [b772, b77l, b77w, b779, b744, b748, a388];
