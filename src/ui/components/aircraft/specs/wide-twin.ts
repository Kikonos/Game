// A330-300 / A330-900, 787-8/9/10, A350-900/1000. Dimensions in metres
// (A330-300 and 787-8 checked against 3-views; the others scaled from them).
// Low wings: the root band sits on the lower third of the fuselage, just above
// the belly fairing, and rises aft with the real dihedral.

import type { TracedProfile } from '../traced/types';
import type { AircraftProfile, EngineSpec } from '../types';
import { NOSE, TAIL, cargo, exit, pax, row } from './shared';

// ---------- traced-family stretch ----------

/** Fuselage plug (m) at station `at` (fraction of the source trace): m > 0 inserts, m < 0 cuts [at, at + |m|]. */
export interface Plug { at: number; m: number }

/**
 * Same-family variant of a traced profile: plugs go into the constant section, so the traced nose,
 * cockpit and tail cone keep their exact shape and real size (y rescales with the new length).
 * Lines are cut/split at the plugs; doors, panes, fin and gaps move rigidly with their fore edge;
 * the wing root and nacelles move together with the wing root's leading edge.
 */
export function stretchTrace(src: TracedProfile, srcM: number, typeId: string, dstM: number, plugs: readonly Plug[], source: string): TracedProfile {
  const sum = plugs.reduce((a, p) => a + p.m, 0);
  if (Math.abs(srcM + sum - dstM) > 0.01) throw new Error(`stretchTrace ${typeId}: plugs ${sum} m do not make ${srcM} m into ${dstM} m`);
  const ps = [...plugs].sort((a, b) => a.at - b.at);
  // source fraction -> destination fraction (points inside a cut collapse onto its fore end)
  const X = (x: number): number => {
    let m = x * srcM;
    for (const p of ps) {
      const a = p.at * srcM;
      if (x * srcM <= a) break;
      m += p.m > 0 ? p.m : -Math.min(-p.m, x * srcM - a);
    }
    return m / dstM;
  };
  const k = srcM / dstM;
  const pt = ([x, y]: readonly [number, number]): [number, number] => [X(x), y * k];
  const rigid = (ref: number) => { const d = X(ref) - ref * k; return ([x, y]: readonly [number, number]): [number, number] => [x * k + d, y * k]; };
  const line = (pts: readonly [number, number][]): [number, number][] => {
    // a sample at both ends of every plug keeps the constant section exact, then drop what a cut removes
    const yAt = (x: number) => {
      const i = pts.findIndex((q) => q[0] >= x);
      if (i <= 0) return pts[Math.max(0, i)][1];
      const [a, b] = [pts[i - 1], pts[i]];
      return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
    };
    const ends = ps.flatMap((p) => (p.m < 0 ? [p.at, p.at - p.m / srcM] : [p.at]));
    const xs = [...pts.map((q) => q[0]), ...ends.filter((x) => x > 0 && x < 1)];
    const inCut = (x: number) => ps.some((p) => p.m < 0 && x > p.at + 1e-9 && x < p.at - p.m / srcM - 1e-9);
    const out = [...new Set(xs)].filter((x) => !inCut(x)).sort((a, b) => a - b)
      .map((x) => pts.find((q) => q[0] === x) ?? ([x, yAt(x)] as [number, number]));
    // a cut maps its aft end onto its fore end: keep one of the two
    return out.map(pt).filter((q, i, a) => !i || q[0] > a[i - 1][0] + 1e-9);
  };
  const wr = src.wingRoot;
  const wingShift = wr ? X(wr.from) - wr.from * k : 0;
  const w = src.windows;
  return {
    ...src,
    typeId,
    source,
    lengthPx: (src.lengthPx * dstM) / srcM,
    cabin: src.cabin && [X(src.cabin[0]), X(src.cabin[1])],
    lengthM: dstM,
    top: line(src.top),
    bottom: line(src.bottom),
    cockpit: src.cockpit.map((q) => q.map(rigid(q[0][0]))),
    windows: { ...w, y: w.y * k, h: w.h * k, pitch: w.pitch * k, from: X(w.from), to: X(w.to), gaps: w.gaps.map(([a, b]) => [X(a), X(a) + (b - a) * k]) },
    doors: src.doors.map((d) => ({ x: X(d.x), w: d.w * k, h: d.h * k, y: d.y * k })),
    fin: src.fin?.map(rigid(src.fin[0][0])),
    wingRoot: wr && { from: X(wr.from), to: X(wr.from) + (wr.to - wr.from) * k, y: wr.y * k },
    engines: src.engines?.map((e) => ({ x: wr ? e.x * k + wingShift : X(e.x), y: e.y * k, w: e.w * k, h: e.h * k })),
    outline: undefined,
    notes: `Derived (${srcM} m -> ${dstM} m, plugs ${ps.map((p) => `${p.m > 0 ? '+' : ''}${p.m} m @${p.at}`).join(', ')}) from ${src.typeId}. ${src.notes ?? ''}`,
  };
}

/** Nacelle box resized about its centre height, intake kept (bigger engine on the same pylon), then moved `dx` (fraction of L). */
export function resizeNacelle(e: { x: number; y: number; w: number; h: number }, kw: number, kh: number, dx = 0): { x: number; y: number; w: number; h: number } {
  return { x: e.x + dx, y: e.y + (e.h * (1 - kh)) / 2, w: e.w * kw, h: e.h * kh };
}

// ---------- A330 ----------

/** A330-300 = A330-200 + 3.2 m between doors 1 and 2 + 1.65 m between doors 3 and 4 (stations on the a332 trace). */
export const A330_PLUGS = [{ at: 0.17, m: 3.2 }, { at: 0.66, m: 1.65 }] as const;

function a330(id: string, neo: boolean): AircraftProfile {
  return {
    id,
    length: 63.67,
    height: 5.64,
    nose: NOSE.airbus,
    cockpit: { style: 'airbus', u: 0.31, v: 0.12, scale: 0.75 },
    tail: TAIL.airbusWide,
    fin: { x: 51.3, rootChord: 9.1, tipChord: 2.64, height: 8.6, sweep: 47, fillet: { len: 3.6, h: 1.3 }, tip: 'round', rudder: 0.33 },
    // stab, wing tip and winglet measured on the A330-200 photo (traced root + the 3.2 m forward plug)
    stab: { x: 56.95, y: 1.7, rootChord: 4.8, tipChord: 1.6, span: 8.7, sweep: 37, dihedral: 7.3, thickness: 0.45 },
    wing: { x: 26.7, y: -1.15, rootChord: 12.9, tipChord: 2.5, span: neo ? 27.6 : 26.8, sweep: 30.5, dihedral: 7.3, thickness: 1.2, tip: neo ? 'sharklet' : 'winglet', tipH: neo ? 3.2 : 2.0 },
    engines: [
      neo
        ? { mount: 'underwing', style: 'plain', x: 19.9, y: -3.0, dia: 3.5, len: 8.0, station: 0.33 }
        : { mount: 'underwing', style: 'longduct', x: 20.6, y: -2.95, dia: 3.06, len: 8.1, station: 0.33 },
    ],
    fairing: { x0: 20.5, x1: 40.0, depth: 0.25 },
    doors: [pax(5.1), pax(17.2), exit(35.9, 0.76, 1.4), pax(50.9), cargo(7.9, 2.7, 1.7), cargo(43.5, 2.7, 1.7)],
    windows: [row(7.4, 49.6, 0.73, 0.533, 0.27, 0.38)],
    ref: { overallHeight: 16.79, span: neo ? 64.0 : 60.3 },
  };
}

const a333 = a330('a333', false);
const a339 = a330('a339', true);

// A330-200: the -300 fuselage shortened 3.2 m ahead of the wing and
// 1.65 m behind it, the A340's taller fin, four full-size door pairs and the same winglets.
function a332Spec(): AircraftProfile {
  const b = a330('a332', false);
  const fwd = -A330_PLUGS[0].m, aft = -A330_PLUGS[1].m, fa = fwd + aft;
  return {
    ...b,
    length: 63.67 + fa,
    fin: { ...b.fin, x: b.fin.x + fa, rootChord: 9.6, height: 9.2 },
    stab: { ...b.stab, x: b.stab.x + fa },
    wing: { ...b.wing, x: b.wing.x + fwd },
    engines: b.engines.map((e) => ({ ...e, x: e.x + fwd })),
    fairing: { x0: 20.5 + fwd, x1: 40.0 + fwd, depth: 0.25 },
    doors: [pax(5.1), pax(14.0), pax(36.2), pax(46.0), cargo(7.9, 2.7, 1.7), cargo(38.7, 2.7, 1.7)],
    windows: [row(7.4, 49.6 + fa, 0.73, 0.533, 0.27, 0.38)],
    ref: { overallHeight: 17.39, span: 60.3 },
  };
}
const a332 = a332Spec();

// A340-300: the A330-300 airframe with the taller fin, four short CFM56-5C pods (inboard pair
// lower and further forward with the sweep and dihedral; the far-side pair peeks out behind the
// near ones).
function a343Spec(): AircraftProfile {
  const b = a330('a343', false);
  const cfm = (x: number, y: number, extra: Partial<EngineSpec>): EngineSpec =>
    ({ mount: 'underwing', style: 'plain', x, y, dia: 2.35, len: 5.6, ...extra });
  return {
    ...b,
    fin: { ...b.fin, rootChord: 9.6, height: 8.7 },
    engines: [
      cfm(24.3, -2.85, { station: 0.29, far: true }),
      cfm(29.6, -1.95, { station: 0.6, far: true }),
      cfm(23.7, -3.15, { station: 0.29, inboard: true }),
      cfm(29.0, -2.25, { station: 0.6 }),
    ],
    doors: [pax(5.1), pax(17.2), pax(36.6), pax(50.9), cargo(7.9, 2.7, 1.7), cargo(43.5, 2.7, 1.7)],
    ref: { overallHeight: 16.85, span: 60.3 },
  };
}
const a343 = a343Spec();

// ---------- 787 ----------

function b787(id: string, fwd: number, aft: number, ref: AircraftProfile['ref']): AircraftProfile {
  const L = 56.72 + fwd + aft;
  const fa = fwd + aft;
  return {
    id,
    length: L,
    height: 5.94,
    nose: NOSE.b787,
    cockpit: { style: 'b787', u: 0.33, v: 0.08, scale: 0.78 },
    tail: TAIL.b787,
    fin: { x: 46.3 + fa, rootChord: 6.9, tipChord: 2.2, height: 9.0 + (ref.overallHeight - 16.92), sweep: 42, fillet: { len: 2.8, h: 1.2 }, tip: 'round', bow: 0.03, rudder: 0.35 },
    stab: { x: 48.3 + fa, y: 0.6, rootChord: 5.0, tipChord: 1.6, span: 8.8, sweep: 40, dihedral: 9, thickness: 0.45 },
    wing: { x: 21.0 + fwd, y: -1.6, rootChord: 10.5, tipChord: 2.8, span: 23.0, sweep: 34, dihedral: 8, thickness: 1.2, tip: 'raked', tipH: 4.5 },
    engines: [{ mount: 'underwing', style: 'chevron', x: 16.0 + fwd, y: -2.55, dia: 3.5, len: 8.6, station: 0.3 }],
    fairing: { x0: 17.5 + fwd, x1: 34.0 + fwd, depth: 0.35 },
    doors: [pax(5.2), pax(14.3), pax(32.0 + fwd), pax(43.4 + fa), cargo(9.6, 2.7, 1.7), cargo(37.6 + fa - aft * 0.3, 2.7, 1.7)],
    windows: [row(7.0, 42.5 + fa, 0.83, 0.61, 0.28, 0.46)],
    ref,
  };
}

const b788 = b787('b788', 0, 0, { overallHeight: 16.92, span: 60.12 });
const b789 = b787('b789', 3.05, 3.04, { overallHeight: 17.02, span: 60.12 });
const b78x = b787('b78x', 5.8, 5.76, { overallHeight: 17.02, span: 60.12 });

// ---------- A350 ----------

/** A350-900 = A350-1000 less 3.8 m between door 2 and the wing and 3.19 m between doors 3 and 4 (stations on the a35k trace). */
export const A350_CUTS = [{ at: 0.345, m: -3.8 }, { at: 0.62, m: -3.19 }] as const;

function a350(id: string, fwd: number, aft: number, big: boolean, ref: AircraftProfile['ref']): AircraftProfile {
  const L = 66.8 + fwd + aft;
  const fa = fwd + aft;
  return {
    id,
    length: L,
    height: 6.09,
    nose: NOSE.a350,
    cockpit: { style: 'a350', u: 0.31, v: 0.085, scale: 0.8 },
    tail: TAIL.a350,
    fin: { x: 53.6 + fa, rootChord: 8.8, tipChord: 2.8, height: 8.8, sweep: 45, fillet: { len: 4.0, h: 1.5 }, tip: 'round', bow: 0.04, rudder: 0.33 },
    // wing tip, curved winglet and stab measured on the A350-1000 render (traced root at 33.5 m)
    stab: { x: 57.7 + fa, y: 1.0, rootChord: 5.6, tipChord: 1.8, span: 8.8, sweep: 38, dihedral: 6.5, thickness: 0.5 },
    wing: { x: 29.7 + fwd, y: -1.5, rootChord: 12.1 + (big ? 0.4 : 0), tipChord: 2.2, span: 26.5, sweep: 29.5, dihedral: 6.3, thickness: 1.3, tip: 'curved', tipH: 2.5 },
    engines: [{ mount: 'underwing', style: 'plain', x: 18.8 + fwd, y: -3.05, dia: big ? 3.75 : 3.6, len: 8.4, station: 0.32 }],
    fairing: { x0: 20.5 + fwd, x1: 40.5 + fwd, depth: 0.32 },
    doors: [pax(5.4), pax(17.2), pax(37.8 + fwd), pax(56.4 + fa), cargo(8.6, 2.7, 1.7), cargo(46.0 + fa - aft * 0.3, 2.7, 1.7)],
    windows: [row(7.2, 55.8 + fa, 0.76, 0.533, 0.28, 0.4)],
    ref,
  };
}

const a359 = a350('a359', 0, 0, false, { overallHeight: 17.05, span: 64.75 });
const a35k = a350('a35k', -A350_CUTS[0].m, -A350_CUTS[1].m, true, { overallHeight: 17.08, span: 64.75 });
// A350-900ULR: externally identical to the -900 (own id so livery/titles key off the real type).
const a35u: AircraftProfile = { ...a359, id: 'a35u' };

export const WIDE_TWIN: AircraftProfile[] = [a333, a332, a343, a339, b788, b789, b78x, a359, a35u, a35k];
