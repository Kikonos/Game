// 737-800, 737 MAX 8/10, 757-200, 767-300ER. Dimensions in metres (Boeing
// airport-planning docs / Wikipedia); door, engine and fin stations
// measured off the Scavini 3-views (737-800, 757 family, 767 family). The
// 737-800 and 757-200 are drawn from their traced profiles (traced/b738.ts,
// traced/b752.ts): wing, engine and fin stations here agree with those traces.
// The MAX 8 / MAX 10 traces are derived from the 737-800 one (b737MaxTrace).

import { chainPts, sampleChain, yAt, type V } from '../path';
import type { TracedProfile } from '../traced/types';
import type { AircraftProfile, EngineSpec, TailConeSpec } from '../types';
import { NOSE, TAIL, cargo, exit, pax, row } from './shared';

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
}

/** 737 MAX: fuller, longer cone without the NG's tail-cone vortex generators. */
const TAIL_MAX: TailConeSpec = {
  upper: [-1.8, 0.5, -1.15, 0.5, -0.45, 0.42, 0, 0.3],
  lower: [-4.2, -0.5, -3.0, -0.5, -1.2, -0.24, 0, 0.17],
  apu: 0.09,
};

const L737 = 39.47, H737 = 4.01;
// CFM56-7 (traced nacelle box of the 737-800 photo): flattened "hamster pouch" lower lip, tucked close to the wing
const CFM56: EngineSpec = { mount: 'underwing', style: 'flatbottom', x: 13.55, y: -1.83, dia: 2.08, len: 4.35, station: 0.3 };
// LEAP-1B: bigger, round-lipped, slung further forward and higher, chevron nozzle
const LEAP1B: EngineSpec = { mount: 'underwing', style: 'chevron', x: 12.8, y: -1.69, dia: 2.24, len: 4.83, station: 0.3 };
/** Plug stations on the 737-800 (m): constant section ahead of the wing / between the wing fairing and the belly upsweep. */
const PLUG_FWD = 10.65, PLUG_AFT = 26.05;
const MID_EXIT = { x: 22.4, w: 0.62, h: 1.25 };

function b737(o: B737Opts): AircraftProfile {
  const L = L737 + o.fwd + o.aft;
  const f = o.fwd, fa = o.fwd + o.aft;
  const eng = o.max ? LEAP1B : CFM56;
  return {
    id: o.id,
    length: L,
    height: H737,
    nose: NOSE.b737,
    cockpit: { style: 'b737', u: 0.44, v: 0.1, scale: 0.9 },
    tail: o.max ? TAIL_MAX : TAIL.b737,
    // knee-shaped dorsal fillet; LE extended to the crown at 31.7 m (3-view)
    fin: { x: 31.7 + fa, rootChord: 4.75, tipChord: 1.75, height: 7.25, sweep: 43, fillet: { len: 3.0, h: 1.4, knee: true }, rudder: 0.33 },
    stab: { x: 34.9 + fa, y: 1.2, rootChord: 3.5, tipChord: 1.15, span: 5.4, sweep: 33, dihedral: 7, thickness: 0.34 },
    // root LE / height from the trace's wingRoot
    wing: { x: 13.85 + f, y: -1.5, rootChord: 6.6, tipChord: 1.3, span: 15.3, sweep: 27, dihedral: 6, thickness: 0.75, tip: o.max ? 'scimitar' : 'blended', tipH: o.max ? 2.55 : 2.7 },
    engines: [{ ...eng, x: eng.x + f }],
    fairing: { x0: 13.6 + f, x1: 23.0 + f, depth: 0.2 },
    doors: [
      pax(4.4, 0.83, 1.83), exit(16.9 + f, 0.52, 0.97), exit(17.65 + f, 0.52, 0.97), ...(o.midExit ? [exit(MID_EXIT.x + f, MID_EXIT.w, MID_EXIT.h)] : []), pax(31.8 + fa, 0.76, 1.68),
      cargo(8.07, 1.22, 0.89), cargo(27.3 + f + o.aft * 0.5, 1.22, 0.89),
    ],
    windows: [row(6.15, 30.9 + fa, 0.4, 0.508, 0.24, 0.33)],
    ref: o.ref,
  };
}

const MAX8: B737Opts = { id: 'b38m', fwd: 0.05, aft: 0, max: true, ref: { overallHeight: 12.3, span: 35.9 } };
// MAX 10: MAX 9 plugs (1.57 m fwd / 1.09 m aft) plus 0.76 / 0.91 m
const MAX10: B737Opts = { id: 'b3jm', fwd: 2.33, aft: 2.0, max: true, midExit: true, ref: { overallHeight: 12.4, span: 35.9 } };

const b738 = b737({ id: 'b738', fwd: 0, aft: 0, max: false, ref: { overallHeight: 12.4, span: 35.79 } });
const b38m = b737(MAX8);
const b3jm = b737(MAX10);

// ---------- derived traces (737 MAX from the 737-800 trace) ----------

type P2 = [number, number];

/**
 * A trace lengthened by constant-section plugs: `plugs` = [station on the base (m), length (m)].
 * Nose, cockpit and tail cone keep their exact shape; everything aft of a plug moves back by it.
 * Units stay fractions of the (new) length, so y and sizes rescale by L0 / L.
 */
export function plugTrace(t: TracedProfile, L0: number, plugs: readonly (readonly [number, number])[]): TracedProfile {
  const cuts = [...plugs].sort((a, b) => a[0] - b[0]);
  const L = L0 + cuts.reduce((s, c) => s + c[1], 0);
  const k = L0 / L;
  const shift = (m: number) => cuts.reduce((s, [at, len]) => (m >= at ? s + len : s), 0);
  const X = (x: number) => (x * L0 + shift(x * L0)) / L;
  const P = ([x, y]: P2): P2 => [X(x), y * k];
  const line = (pts: readonly P2[]): P2[] => {
    const v = pts.map((q): V => q);
    const out: P2[] = [];
    let ci = 0;
    for (const q of pts) {
      // a cut: the line's value there, before and after the plug (a straight constant run between)
      while (ci < cuts.length && q[0] * L0 >= cuts[ci][0]) {
        const at = cuts[ci][0] / L0, y = yAt(v, at) * k, before = shift(cuts[ci][0] - 1e-6);
        out.push([(cuts[ci][0] + before) / L, y], [(cuts[ci][0] + before + cuts[ci][1]) / L, y]);
        ci++;
      }
      out.push(P(q));
    }
    return out;
  };
  const w = t.windows;
  return {
    ...t,
    lengthPx: t.lengthPx / k,
    top: line(t.top),
    bottom: line(t.bottom),
    cockpit: t.cockpit.map((q) => q.map(P)),
    windows: { y: w.y * k, h: w.h * k, from: X(w.from), to: X(w.to), pitch: w.pitch * k, gaps: w.gaps.map(([a, b]): P2 => [X(a), X(b)]) },
    doors: t.doors.map((d) => ({ x: X(d.x), w: d.w * k, h: d.h * k, y: d.y * k })),
    fin: t.fin?.map(P),
    wingRoot: t.wingRoot && { from: X(t.wingRoot.from), to: X(t.wingRoot.to), y: t.wingRoot.y * k },
    engines: t.engines?.map((e) => ({ x: X(e.x), y: e.y * k, w: e.w * k, h: e.h * k })),
    outline: t.outline?.map(P),
  };
}

/** Tail-cone line (y up, H units) of a spec chain at u (H units, <= 0 from the tip); `flat` ahead of it. */
function coneAt(chain: readonly number[], u: number, flat: number): number {
  const pts = sampleChain(chainPts(chain, (a, b): V => [a, b]), 24);
  return u < pts[0][0] ? flat : yAt(pts, u);
}

/**
 * 737 MAX trace from the 737-800 one: MAX plugs, the MAX tail cone (NG -> MAX difference of the spec
 * cones applied to the traced lines), the LEAP-1B nacelle (CFM56 -> LEAP-1B difference applied to the
 * traced box), no eyebrow windows, and the MAX 10 mid-cabin exit.
 */
export function b737MaxTrace(ng: TracedProfile, id: 'b38m' | 'b3jm'): TracedProfile {
  const o = id === 'b38m' ? MAX8 : MAX10;
  const L0 = L737, h0 = H737 / L0;
  // tail cone first, in the 737-800 frame; the spec difference scales with the traced cone-end height
  const endH = ng.bottom[ng.bottom.length - 1][1] - ng.top[ng.top.length - 1][1];
  const specH = (TAIL.b737.upper[7] - TAIL.b737.lower[7]) * h0;
  const s = Math.min(1.5, Math.max(0.3, endH / specH));
  const d = (x: number, upper: boolean) => {
    const u = (x - 1) / h0;
    const [ng0, max0, flat] = upper ? [TAIL.b737.upper, TAIL_MAX.upper, 0.5] : [TAIL.b737.lower, TAIL_MAX.lower, -0.5];
    return (coneAt(max0, u, flat) - coneAt(ng0, u, flat)) * h0 * s;
  };
  const top = ng.top.map(([x, y]): P2 => [x, y - d(x, true)]);
  const bottom = ng.bottom.map(([x, y]): P2 => [x, y - d(x, false)]);
  // fin root vertices ride on the crown
  const topV = ng.top.map((q): V => q);
  const fin = ng.fin?.map(([x, y]): P2 => (Math.abs(y - yAt(topV, x)) < 0.012 ? [x, y - d(x, true)] : [x, y]));
  // eyebrow panes: wholly above the tallest pane
  const tall = ng.cockpit.reduce((a, b) => (span(b) > span(a) ? b : a), ng.cockpit[0] ?? []);
  const tallTop = Math.min(...tall.map((q) => q[1]));
  const cockpit = ng.cockpit.filter((q) => q === tall || Math.max(...q.map((v) => v[1])) > tallTop);
  // LEAP-1B: same nacelle box moved and scaled by the spec difference
  const engines = ng.engines?.map((e) => {
    const w = e.w * (LEAP1B.len / CFM56.len), h = e.h * (LEAP1B.dia / CFM56.dia);
    const cy = e.y + e.h / 2 - (LEAP1B.y - CFM56.y) / L0;
    return { x: e.x + (LEAP1B.x - CFM56.x) / L0, y: cy - h / 2, w, h };
  });
  const doors = [...ng.doors];
  if (o.midExit) {
    // mid-cabin exit: window-row height, top 0.75 m above the row centre (spec exit convention)
    const x = MID_EXIT.x / L0;
    doors.push({ x, w: MID_EXIT.w / L0, h: MID_EXIT.h / L0, y: ng.windows.y - 0.75 / L0 });
    doors.sort((a, b) => a.x - b.x);
  }
  const base: TracedProfile = { ...ng, top, bottom, fin, cockpit, engines, doors };
  const plugs: [number, number][] = [[PLUG_FWD, o.fwd], ...(o.aft ? [[PLUG_AFT, o.aft] as [number, number]] : [])];
  return {
    ...plugTrace(base, L0, plugs),
    typeId: id,
    source: `derived from b738 (${ng.source}): plugs ${o.fwd} m at ${PLUG_FWD} m / ${o.aft} m at ${PLUG_AFT} m, MAX tail cone, LEAP-1B box, no eyebrow panes`,
    notes: 'Generated by b737MaxTrace (specs/narrow-boeing.ts) from traced/b738.ts; fix the 737-800 trace, not this file.',
  };
}

function span(q: readonly (readonly [number, number])[]): number {
  return q.length ? Math.max(...q.map((v) => v[1])) - Math.min(...q.map((v) => v[1])) : 0;
}

// ---------- 757-200 ----------

const b752: AircraftProfile = {
  id: 'b752',
  length: 47.32,
  height: 4.01,
  nose: NOSE.b757,
  cockpit: { style: 'b757', u: 0.54, v: 0.1, scale: 0.9 },
  tail: TAIL.b757,
  // tall fin with a short curved dorsal fillet
  fin: { x: 37.3, rootChord: 6.6, tipChord: 2.6, height: 7.38, sweep: 42, fillet: { len: 2.8, h: 1.1 }, rudder: 0.36 },
  // root LE / height off the 757 photo (near stabiliser emerges at 40.7 m, just above the tail-cone line)
  stab: { x: 40.6, y: 0.55, rootChord: 4.4, tipChord: 1.4, span: 7.2, sweep: 34, dihedral: 7, thickness: 0.4 },
  // root chord from the trace's wingRoot: the nacelle exhaust ends just under the root LE
  wing: { x: 21.3, y: -1.65, rootChord: 7.9, tipChord: 1.7, span: 17.1, sweep: 28, dihedral: 5, thickness: 0.95, tip: 'none' },
  // RB211-535: long-duct nacelle hung well ahead of the wing
  engines: [{ mount: 'underwing', style: 'longduct', x: 16.05, y: -2.05, dia: 2.5, len: 5.9, station: 0.3 }],
  fairing: { x0: 19.5, x1: 31.5, depth: 0.22 },
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
  nose: NOSE.b767,
  cockpit: { style: 'b757', u: 0.42, v: 0.1, scale: 0.72 },
  tail: TAIL.b757,
  fin: { x: 44.0, rootChord: 8.3, tipChord: 2.4, height: 8.45, sweep: 47, fillet: { len: 2.2, h: 0.9 }, rudder: 0.33 },
  stab: { x: 47.3, y: 0.7, rootChord: 5.4, tipChord: 1.8, span: 8.4, sweep: 34, dihedral: 7, thickness: 0.48 },
  wing: { x: 19.5, y: -1.65, rootChord: 9.6, tipChord: 2.4, span: 21.3, sweep: 34, dihedral: 6, thickness: 1.15, tip: 'none' },
  engines: [{ mount: 'underwing', style: 'plain', x: 19.6, y: -2.38, dia: 2.7, len: 6.9, station: 0.3 }],
  fairing: { x0: 18.0, x1: 34.5, depth: 0.3 },
  doors: [pax(5.3, 1.07, 1.88), pax(16.7, 1.07, 1.88), exit(31.6, 0.62, 1.15), pax(42.6, 1.07, 1.88), cargo(10.6, 3.4, 1.75), cargo(38.1, 1.78, 1.75)],
  windows: [row(7.2, 41.9, 0.65, 0.508, 0.26, 0.38)],
  ref: { overallHeight: 15.85, span: 47.57 },
};

export const NARROW_BOEING: AircraftProfile[] = [b738, b38m, b3jm, b752, b763];
