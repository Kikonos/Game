// Turns an AircraftProfile (metres) into SVG path strings. Pure and cached per
// profile, so the React component only assembles elements and colours.

import type { TailStyle } from '../../../engine/core/types';
import { COCKPIT } from './cockpit';
import { Box, D, add, chainPts, cubic, lerp, lerpV, rad, relax, sampleChain, splitTail, yAt, type V } from './path';
import type { TracedProfile } from './traced/types';
import type { AircraftProfile, EngineSpec, EngineStyle, FairingSpec, FinSpec, TipDevice, WindowRow, WingSpec } from './types';

export interface EngineGeo {
  spec: EngineSpec;
  pylon: string;
  cowl: string;
  /** Livery band on the fan cowl. */
  accent: string;
  /** Intake lip (metallic). */
  lip: string;
  /** Dark slivers: fan face, fan nozzle, turboprop intakes. */
  dark: string;
  core: string;
  plug: string;
  /** Fan-cowl / thrust-reverser seam (fine line). */
  seam: string;
  /** `x`: fore and aft extent of the disc (m). */
  prop?: { disc: string; blades: string; spinner: string; x: readonly [number, number] };
}

export interface LiveryGeo {
  /** Primary-colour area on the fuselage (clip to the fuselage). */
  fus: string;
  /** Second-colour area on the fuselage. */
  fus2: string;
  /** Second-colour area on the fin (clip to the fin). */
  fin: string;
  /** Fin-code anchor (centre), maximum letter size and width. */
  code: { x: number; y: number; size: number; w: number };
}

export interface Geometry {
  p: AircraftProfile;
  /** Traced profile the fuselage (and whatever else it carries) came from; undefined = parametric spec. */
  traced?: TracedProfile;
  /** Outline mode (Concorde): `fus` is the whole silhouette; no separate wing, the fin only shades. */
  outline: boolean;
  /**
   * Outline mode: clip regions above (`tube`) and below (`wing`) the tube's belly, the delta's
   * edge-on root strip over the tube side (`strip`, from the traced wingRoot) and the seams.
   */
  zones?: { tube: string; wing: string; strip: string; seam: string };
  L: number;
  H: number;
  /** Nose tip (m) — the alignment reference of the traced frame. */
  tip: V;
  upperY: (x: number) => number;
  lowerY: (x: number) => number;
  /** Closed fuselage outline including belly fairing and sponsons (no landing gear is ever drawn). */
  fus: string;
  /** Highest crown point (m) — top of the shading gradient. */
  crown: number;
  /** Lowest belly point (m) — bottom of the shading gradient. */
  belly: number;
  /** Crown fairing under a high wing. */
  wingRoot: string;
  /** `poly`: the fill outline (world coords, y up) sampled from `fill` — sticker fitting and hit tests (v0.5.1). */
  fin: { fill: string; edge: string; lines: string; quad: readonly [V, V, V, V]; top: number; poly: V[] };
  stab: { near: string; far: string; lines: string; bullet: string; tTail: boolean; none: boolean };
  /** `shade`: darker underside of a sectioned (side-on aerofoil) wing; no `shadow` in outline mode. */
  /** `tipEdge`: stroke of a blended tip device (its fill `tip` is then drawn unstroked: the rest of its edge is the wing's outline). */
  wing: { fill: string; tip: string; tipEdge?: string; lines: string; shade?: string; shadow?: { c: V; rx: number; ry: number } };
  engines: EngineGeo[];
  windows: string;
  doors: string;
  /** Radome joint, fairing seam and similar fine lines on the fuselage. */
  lines: string;
  apu: string;
  /** list (traced): one path per pane, each drawn clear of its neighbours by `post` (the light frame between panes). */
  cockpit: { panes: string; mask: string; round: number; list?: string[]; post: number };
  titles: { x: number; y: number; w: number; size: number };
  livery: (style: TailStyle) => LiveryGeo;
  box: Box;
}

/** Map fin-normalised (s along chord, t root->tip) to world coordinates. */
export function finAt(q: readonly [V, V, V, V], s: number, t: number): V {
  return lerpV(lerpV(q[0], q[1], s), lerpV(q[2], q[3], s), t);
}

const cache = new Map<AircraftProfile, Geometry>();
const tcache = new Map<TracedProfile, Map<AircraftProfile, Geometry>>();

/** Geometry for a spec, drawn from the traced profile `t` when one exists for the type. */
export function geometry(p: AircraftProfile, t?: TracedProfile): Geometry {
  let m = cache;
  if (t) {
    let tm = tcache.get(t);
    if (!tm) tcache.set(t, (tm = new Map()));
    m = tm;
  }
  let g = m.get(p);
  if (!g) {
    g = build(p, t);
    m.set(p, g);
  }
  return g;
}

// ---------- traced profiles (fractions of L, nose left, y down -> metres, y up) ----------

interface Frame {
  t: TracedProfile;
  /** Fuselage height (m): crown to belly of the traced tube (spec height in outline mode). */
  H: number;
  top: V[];
  bottom: V[];
  outline?: V[];
  tip: V;
  X: (x: number) => number;
  Y: (y: number) => number;
  P: (q: readonly [number, number]) => V;
}

function tracedFrame(t: TracedProfile, p: AircraftProfile): Frame {
  const L = p.length;
  const ys = (pts: readonly (readonly [number, number])[], lo: number, hi: number) => {
    const inRange = pts.filter(([x]) => x >= lo && x <= hi).map(([, y]) => y);
    return inRange.length ? inRange : pts.map(([, y]) => y);
  };
  const outline = t.outline && t.outline.length >= 3 ? t.outline : undefined;
  const lines = t.top.length >= 2 && t.bottom.length >= 2;
  let crownF: number, bellyF: number;
  if (lines || !outline) {
    // centreline: midway between the crown aft of any 747 hump and the belly ahead of the wing fairing
    crownF = Math.min(...ys(t.top, 0.5, 0.7));
    bellyF = Math.max(...ys(t.bottom, 0.2, 0.32));
  } else {
    // silhouette only: the tube between the cockpit and the wing (median of a few vertical cuts)
    const cuts = [0.16, 0.19, 0.22, 0.25, 0.28].map((x) => cut(outline, x)).filter((c): c is [number, number] => !!c);
    const med = (a: number[]) => a.sort((u, v) => u - v)[a.length >> 1];
    crownF = cuts.length ? med(cuts.map((c) => c[0])) : -p.height / L / 2;
    bellyF = cuts.length ? med(cuts.map((c) => c[1])) : p.height / L / 2;
  }
  let Hf = bellyF - crownF;
  if (!(Hf > 0.02)) {
    Hf = p.height / L;
    bellyF = crownF + Hf;
  }
  const yc = (crownF + bellyF) / 2;
  const X = (x: number) => x * L;
  const Y = (y: number) => (yc - y) * L;
  const P = (q: readonly [number, number]): V => [X(q[0]), Y(q[1])];
  // x non-decreasing so the crown/belly lookups stay single-valued
  const mono = (pts: V[]): V[] => pts.map((v, i, a) => (i && v[0] < a[i - 1][0] ? [a[i - 1][0], v[1]] : v));
  const line = (pts: readonly (readonly [number, number])[]): V[] => (pts.length ? relax(mono(pts.map(P))) : []);
  const top = line(t.top), bottom = line(t.bottom);
  return { t, H: Hf * L, top, bottom, outline: outline && relax(outline.map(P)), tip: top[0] ?? P([0, 0]), X, Y, P };
}

/** Topmost and lowest crossing (frame y) of a closed polygon with the vertical line at x. */
function cut(poly: readonly (readonly [number, number])[], x: number): [number, number] | undefined {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[0] - x) * (b[0] - x) > 0 || a[0] === b[0]) continue;
    const y = lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? [lo, hi] : undefined;
}

/**
 * Upper (`hi`) or lower envelope of a closed outline, as a polyline over x for yAt: exact
 * vertical cuts at every vertex x plus a fine grid (long sparse edges never drop out).
 */
function envelope(pts: readonly V[], hi: boolean, steps = 400): V[] {
  const x0 = Math.min(...pts.map((v) => v[0])), x1 = Math.max(...pts.map((v) => v[0]));
  const xs = new Set(pts.map((v) => v[0]));
  for (let i = 0; i <= steps; i++) xs.add(lerp(x0, x1, i / steps));
  const n = pts.length;
  const out: V[] = [];
  for (const x of [...xs].sort((a, b) => a - b)) {
    let best = hi ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[0] - x) * (b[0] - x) > 0) continue;
      // vertical edges and touching vertices count with both ends
      const ys = a[0] === b[0] ? [a[1], b[1]] : [lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]))];
      for (const y of ys) best = hi ? Math.max(best, y) : Math.min(best, y);
    }
    if (Number.isFinite(best)) out.push([x, best]);
  }
  return out;
}

interface FinGeo {
  fill: string;
  edge: string;
  lines: string;
  quad: readonly [V, V, V, V];
  top: number;
  finStart: V;
  tipLE: V;
  tc: number;
  /** Fin stations the livery uses (root LE x, chords, height above the crown). */
  fn: Pick<FinSpec, 'x' | 'rootChord' | 'tipChord' | 'height'>;
}

/**
 * Fin from a traced polygon (world coords): the vertices above the crown are the exposed edge,
 * the rest the root. `stroke` = false in outline mode, where the silhouette stroke already covers it.
 */
function tracedFin(poly: readonly V[], p: AircraftProfile, H: number, upperY: (x: number) => number, box: Box, stroke: boolean): FinGeo | undefined {
  const n = poly.length;
  const tol = Math.max(0.15, H * 0.04);
  const above = poly.map(([x, y]) => y > upperY(x) + tol);
  let start = -1;
  for (let i = 0; i < n; i++) if (above[i] && !above[(i - 1 + n) % n]) start = i;
  if (start < 0) return undefined;
  const run: V[] = [];
  for (let i = start; above[i % n] && run.length < n; i++) run.push(poly[i % n]);
  const pts = [poly[(start - 1 + n) % n], ...run, poly[(start + run.length) % n]];
  if (pts[0][0] > pts[pts.length - 1][0]) pts.reverse();
  const rootLE = pts[0], rootTE = pts[pts.length - 1];
  const top = Math.max(...pts.map((v) => v[1]));
  const crownY = upperY(rootLE[0]);
  const tipPts = pts.filter((v) => v[1] > top - (top - crownY) * 0.06);
  const tipLE = tipPts[0], tipTE = tipPts[tipPts.length - 1];
  const edge = new D().spline(pts, true, 25);
  const dip = Math.max(0.1, H * 0.05);
  const fill = new D();
  fill.s = edge.s;
  for (let i = 0; i <= 12; i++) {
    const x = lerp(rootTE[0], rootLE[0], i / 12);
    fill.L([x, upperY(x) - dip * Math.min(1, (12 - i) / 2)]);
  }
  fill.Z();
  box.add(...pts);
  const fn = { x: rootLE[0], rootChord: rootTE[0] - rootLE[0], tipChord: tipTE[0] - tipLE[0], height: top - H / 2 };
  const lines = new D();
  if (p.fin.rudder) {
    const rr = p.fin.rudder, hx0 = rootTE[0] - fn.rootChord * rr;
    lines.M([hx0, upperY(hx0) + H * 0.06]).L([tipTE[0] - fn.tipChord * rr, top - fn.tipChord * 0.08]);
  }
  return {
    fill: fill.toString(), edge: stroke ? edge.toString() : '', lines: lines.toString(),
    quad: [[rootLE[0], H / 2], [rootTE[0], H / 2], tipLE, tipTE], top, finStart: rootLE, tipLE, tc: fn.tipChord, fn,
  };
}

/** Spec engines moved onto traced nacelle boxes (both sorted by x; far-side engines follow their near twin). */
function placeEngines(p: AircraftProfile, fr: Frame): EngineSpec[] {
  const boxes = fr.t.engines;
  if (!boxes?.length) return p.engines;
  const sorted = [...boxes].sort((a, b) => a.x - b.x);
  const near = p.engines.filter((e) => !e.far).sort((a, b) => a.x - b.x);
  const moved = new Map<EngineSpec, EngineSpec>();
  near.forEach((e, i) => {
    const b = sorted[Math.min(i, sorted.length - 1)];
    moved.set(e, { ...e, x: fr.X(b.x), y: fr.Y(b.y + b.h / 2), dia: b.h * p.length, len: b.w * p.length });
  });
  return p.engines.map((e) => {
    if (!e.far) return moved.get(e) ?? e;
    const twin = near.reduce((a, b) => (Math.abs(b.x - e.x) < Math.abs(a.x - e.x) ? b : a), near[0]);
    const m = twin && moved.get(twin);
    if (!twin || !m) return e;
    return { ...e, x: m.x + (e.x - twin.x), y: m.y + (e.y - twin.y), dia: m.dia, len: m.len };
  });
}

function build(p: AircraftProfile, t?: TracedProfile): Geometry {
  const L = p.length;
  const fr = t ? tracedFrame(t, p) : undefined;
  const H = fr ? fr.H : p.height;
  const box = new Box();

  // ---------- fuselage outline ----------
  const lines = new D();
  let fus: D, up: V[], low: V[], crown: number, belly: number, tip: V;
  /** Tail-cone end, top and bottom (APU exhaust / 777 blade). */
  let tailEnd: readonly [V, V] | undefined;
  if (fr?.outline) {
    // one closed silhouette; the crown/belly lookups see its upper and lower envelopes
    const o = fr.outline;
    fus = new D().splineClosed(o);
    up = envelope(o, true);
    low = envelope(o, false);
    tip = o.reduce((a, b) => (b[0] < a[0] ? b : a), o[0]);
    // shading gradient over the tube; the wing below it gets its own fill
    crown = H / 2;
    belly = -H / 2;
    box.add(...o);
  } else if (fr) {
    up = fr.top;
    low = fr.bottom;
    tip = fr.tip;
    const back = [...low].reverse();
    fus = new D().spline(up).L(back[0]).spline(back, false).Z();
    tailEnd = [up[up.length - 1], low[low.length - 1]];
    crown = Math.max(...up.map((v) => v[1]));
    belly = Math.min(...low.map((v) => v[1]));
    box.add(...up, ...low);
  } else {
    const nm = (u: number, v: number): V => [u * H, v * H];
    const tm = (u: number, v: number): V => [L + u * H, v * H];
    const nu = chainPts(p.nose.upper, nm);
    const nl = chainPts(p.nose.lower, nm);
    const tu = chainPts(p.tail.upper, tm);
    const tl = chainPts(p.tail.lower, tm);
    tip = nu[0];
    fus = new D().chain(nu, true);
    up = sampleChain(nu);
    const crownTop = nu[nu.length - 1][1];
    if (p.hump) {
      const a: V = [p.hump.x1, crownTop];
      const b: V = [p.hump.x1 + p.hump.fair, H / 2];
      const c1: V = [a[0] + p.hump.fair * 0.55, crownTop];
      const c2: V = [b[0] - p.hump.fair * 0.45, H / 2];
      fus.L(a).C(c1, c2, b);
      up.push(...sampleChain([a, c1, c2, b]));
    }
    fus.L(tu[0]).chain(tu).L(tl[tl.length - 1]).chain([...tl].reverse());
    up.push(...sampleChain(tu));
    low = [...sampleChain(nl), ...sampleChain(tl)];
    tailEnd = [tu[tu.length - 1], tl[tl.length - 1]];

    // belly from the tail-cone start forward to the nose, with fairing bulges
    const xBellyAft = tl[0][0], xBellyFwd = nl[nl.length - 1][0];
    const bulges = [p.fairing, p.sponson].filter((f): f is FairingSpec => !!f).sort((a, b) => b.x0 - a.x0);
    const hb = -H / 2;
    let bellyMin = hb;
    for (const f of bulges) {
      const x0 = Math.max(f.x0, xBellyFwd + 0.1), x1 = Math.min(f.x1, xBellyAft - 0.1);
      const w = x1 - x0, yb = hb - f.depth;
      fus.L([x1, hb])
        .C([x1 - w * 0.1, hb], [x1 - w * 0.14, yb], [x0 + w * 0.7, yb])
        .C([x0 + w * 0.55, yb], [x0 + w * 0.5, yb], [x0 + w * 0.34, yb])
        .C([x0 + w * 0.16, yb], [x0 + w * 0.12, hb], [x0, hb]);
      bellyMin = Math.min(bellyMin, yb);
      // seam where the fairing meets the fuselage side (a pod outline when `rise` is given)
      if (f.rise) lines.M([x0 + w * 0.015, hb - f.depth * 0.35]).C([x0 + w * 0.06, hb + f.rise], [x1 - w * 0.4, hb + f.rise * 1.04], [x1 - w * 0.02, hb - f.depth * 0.3]);
      else lines.M([x0 + w * 0.08, hb - f.depth * 0.08]).C([x0 + w * 0.3, hb + H * 0.035], [x1 - w * 0.3, hb + H * 0.035], [x1 - w * 0.05, hb - f.depth * 0.08]);
    }
    fus.L(nl[nl.length - 1]).chain([...nl].reverse()).Z();
    crown = Math.max(...up.map((v) => v[1]));
    belly = Math.min(bellyMin, ...low.map((v) => v[1]));
    box.add(...up, ...low, [0, belly]);
  }
  const upperY = (x: number) => yAt(up, x);
  const lowerY = (x: number) => yAt(low, x);

  // ---------- outline mode: tube / wing split ----------
  // the tube's belly (traced bottom line, else level with the tube belly) divides the silhouette
  // into the fuselage (livery) and the wing below it (wing fill, seam line where they meet)
  let zones: Geometry['zones'];
  let wingFrom = Infinity;
  if (fr?.outline) {
    const cutY = fr.bottom.length >= 2 ? (x: number) => yAt(fr.bottom, x) : () => -H / 2 - H * 0.03;
    const xs: number[] = [];
    for (let i = 0; i <= 160; i++) xs.push(lerp(box.x0 - 1, box.x1 + 1, i / 160));
    const edge = xs.map((x): V => [x, cutY(x)]);
    const deep = box.y0 - H, high = box.y1 + H;
    const tube = new D().poly([...edge, [box.x1 + 1, high], [box.x0 - 1, high]]).toString();
    const wing = new D().poly([...edge, [box.x1 + 1, deep], [box.x0 - 1, deep]]).toString();
    // seam: the stretches of the cut line with wing under them
    const seam = new D();
    const tol = H * 0.06;
    let run: V[] = [];
    const flush = () => { if (run.length > 1) seam.poly(run, false); run = []; };
    for (const v of edge) {
      if (lowerY(v[0]) < v[1] - tol && upperY(v[0]) > v[1]) {
        run.push(v);
        wingFrom = Math.min(wingFrom, v[0]);
      } else flush();
    }
    flush();
    // delta seen edge-on: a sliver over the lower tube from the root LE to the TE, its lower edge
    // the belly. Depth over the chord (fraction of the peak) as drawn on the Concorde reference;
    // wingRoot.y is the strip's mean centre line, which sets the peak depth.
    const strip = new D();
    const wr = fr.t.wingRoot;
    if (wr && wr.to > wr.from && fr.bottom.length >= 2) {
      const DEPTH: readonly V[] = [[0, 0.72], [0.1, 0.9], [0.17, 1], [0.35, 1], [0.5, 0.91], [0.7, 0.89], [0.85, 0.79], [1, 0.71]];
      const mean = DEPTH.reduce((a, [u, d], i) => (i ? a + ((d + DEPTH[i - 1][1]) / 2) * (u - DEPTH[i - 1][0]) : a), 0);
      const xa = fr.X(wr.from), xb = fr.X(wr.to);
      // reference belly: the lowest tube line along the root (the aft upsweep does not lift the wing)
      let ref = Infinity;
      for (let i = 0; i <= 40; i++) ref = Math.min(ref, cutY(lerp(xa, xb, i / 40)));
      const peak = (2 * (fr.Y(wr.y) - ref)) / mean;
      if (peak > 0) {
        const upper: V[] = [];
        for (let i = 0; i <= 60; i++) {
          const u = i / 60, x = lerp(xa, xb, u);
          upper.push([x, Math.min(upperY(x), ref + peak * yAt(DEPTH, u))]);
        }
        // pointed LE: the lower surface meets the belly 6% of the chord aft of the tip
        const lower: V[] = [];
        for (let i = 0; i <= 12; i++) {
          const x = lerp(xa, xb, 0.06 * (1 - i / 12)), k = 1 - (1 - i / 12) ** 2;
          lower.push([x, lerp(cutY(x), upper[0][1], k)]);
        }
        const belly: V[] = [];
        for (let i = 0; i <= 40; i++) {
          const x = lerp(xb, lerp(xa, xb, 0.06), i / 40);
          belly.push([x, cutY(x)]);
        }
        strip.spline(upper);
        for (const v of [...belly, ...lower]) strip.L(v);
        strip.Z();
        seam.spline(upper).L([xb, cutY(xb)]);
      }
    }
    zones = { tube, wing, strip: strip.toString(), seam: seam.toString() };
  }

  // ---------- vertical fin ----------
  // in outline mode the upper envelope already includes the fin, so "above the crown" is judged
  // against the traced top line when there is one, else the mid-fuselage crown
  const finRef = fr?.outline ? (fr.top.length >= 2 ? (x: number) => yAt(fr.top, x) : () => crown) : upperY;
  const tracedPoly = fr && t?.fin && t.fin.length >= 3 ? t.fin.map(fr.P) : undefined;
  const finG = (tracedPoly && tracedFin(tracedPoly, p, H, finRef, box, !fr?.outline))
    ?? (fr?.outline && tracedFin(fr.outline, p, H, finRef, box, false))
    ?? paramFin(p, H, L, upperY, box);
  const { quad, top, finStart, tipLE, tc } = finG;

  // ---------- horizontal stabiliser ----------
  const sb = p.stab;
  const stabNear = new D(), stabFar = new D(), stabLines = new D(), bullet = new D();
  if (!sb.none) {
    const th = sb.thickness ?? sb.rootChord * 0.11;
    const sy = sb.tTail ? top - th * 0.2 : sb.y;
    const rise = sb.span * Math.sin(rad(sb.dihedral));
    const r0: V = [sb.x, sy];
    const t0: V = [sb.x + sb.span * Math.tan(rad(sb.sweep)), sy + rise];
    const t1: V = [t0[0] + sb.tipChord, t0[1]];
    const r1: V = [sb.x + sb.rootChord, sy];
    const shape = (d: D, o: V) => {
      const P = (v: V): V => [v[0] + o[0], v[1] + o[1]];
      d.M(P([r0[0] + th * 0.9, sy + th * 0.5]))
        .L(P([t0[0] + sb.tipChord * 0.12, t0[1] + th * 0.22]))
        .C(P([t1[0] - sb.tipChord * 0.3, t1[1] + th * 0.24]), P([t1[0], t1[1] + th * 0.1]), P(t1))
        .L(P([r1[0], sy - th * 0.08]))
        .L(P([r0[0] + th * 0.9, sy - th * 0.5]))
        .C(P([r0[0] + th * 0.1, sy - th * 0.48]), P([r0[0] - th * 0.12, sy + th * 0.1]), P([r0[0] + th * 0.9, sy + th * 0.5]))
        .Z();
    };
    shape(stabNear, [0, 0]);
    shape(stabFar, [-th * 0.5, Math.max(th * 0.7, rise * 0.28)]);
    stabLines.M([r1[0] - sb.rootChord * 0.28, sy - th * 0.08]).L([t1[0] - sb.tipChord * 0.32, t1[1] + th * 0.12]);
    box.add([r0[0] - th * 0.6, sy], t0, t1, [t1[0], t1[1] + th]);
    if (sb.tTail) {
      // bullet fairing where the T-tail meets the fin
      const bx = Math.min(sb.x, tipLE[0]) - tc * 0.12, bl = Math.max(tc, sb.rootChord) * 1.15 + Math.abs(sb.x - tipLE[0]), br = th * 0.85;
      bullet.M([bx, sy]).C([bx, sy + br], [bx + bl * 0.2, sy + br], [bx + bl * 0.42, sy + br]).L([bx + bl, sy + br * 0.55]).L([bx + bl, sy - br * 0.55]).L([bx + bl * 0.42, sy - br]).C([bx + bl * 0.2, sy - br], [bx, sy - br], [bx, sy]).Z();
      box.add([bx, sy + br], [bx + bl, sy]);
    }
  }

  // ---------- wing ----------
  const wr0 = fr?.t.wingRoot;
  const w: WingSpec = wr0 && wr0.to > wr0.from ? { ...p.wing, x: fr.X(wr0.from), rootChord: (wr0.to - wr0.from) * L, y: fr.Y(wr0.y) } : p.wing;
  const wingG = fr?.outline ? { fill: '', tip: '', lines: '' } : wingGeometry(w, box);
  const wrc = w.rootChord;
  const wth = w.thickness ?? wrc * 0.11;
  const shadow = fr?.outline
    ? undefined
    : w.high
      ? { c: [w.x + wrc * 0.5, H / 2 - H * 0.08] as V, rx: wrc * 0.9, ry: H * 0.2 }
      : { c: [w.x + wrc * 0.5, w.y - wth * 0.2] as V, rx: wrc * 0.85, ry: H * 0.24 };

  // ---------- high-wing crown fairing ----------
  const wr = new D();
  if (fr?.outline) {
    // nothing: the silhouette carries the wing
  } else if (w.high && w.section) {
    // long low fairing on the crown that ramps up into the aerofoil's lower surface
    const x0 = w.x - wrc * 0.55, x1 = w.x + wrc * 1.75;
    const yl = w.y - wth * 0.12;
    wr.M([x0, upperY(x0) - 0.06]).C([x0 + wrc * 0.3, upperY(x0) + 0.03], [w.x - wrc * 0.12, yl], [w.x + wrc * 0.2, yl]).L([w.x + wrc * 0.9, yl]).C([w.x + wrc * 1.15, yl], [x1 - wrc * 0.35, upperY(x1) + 0.03], [x1, upperY(x1) - 0.06]).Z();
    box.add([w.x, yl]);
  } else if (w.high) {
    const x0 = w.x - wrc * 0.45, x1 = w.x + wrc * 1.5;
    const yb = w.y + wth * 0.15;
    wr.M([x0, upperY(x0) - 0.06]).C([x0 + wrc * 0.3, upperY(x0) + 0.02], [w.x - wrc * 0.1, yb], [w.x + wrc * 0.25, yb]).L([w.x + wrc * 0.85, yb]).C([x1 - wrc * 0.25, yb], [x1 - wrc * 0.15, upperY(x1) + 0.02], [x1, upperY(x1) - 0.06]).Z();
    box.add([w.x, yb]);
  }

  // ---------- engines ----------
  let engineSpecs: EngineSpec[];
  if (fr?.outline) {
    // nacelles straight from the traced boxes, no pylon (they sit on the silhouette)
    engineSpecs = (fr.t.engines ?? []).map((b) => ({ mount: 'underwing', style: 'supersonic', x: fr.X(b.x), y: fr.Y(b.y + b.h / 2), dia: b.h * L, len: b.w * L }));
  } else {
    engineSpecs = fr ? placeEngines(p, fr) : p.engines;
  }
  const engines = engineSpecs.map((e) => engineGeometry(e, w, box, upperY));

  // ---------- doors & windows ----------
  let rows: WindowRow[] = p.windows;
  /** Spec rows kept beside a traced row (other decks: A380 / 747 upper deck). */
  let deckRows = 0;
  if (fr) {
    const tw = fr.t.windows;
    // `to` is the last window's centre: the averaged pitch may overshoot it by a hair
    const row: WindowRow | undefined = tw && tw.pitch > 0 && tw.h > 0
      ? { x0: fr.X(tw.from), x1: fr.X(tw.to + tw.pitch * 0.25), y: fr.Y(tw.y), pitch: tw.pitch * L, w: tw.h * L * 0.7, h: tw.h * L, gaps: (tw.gaps ?? []).map(([a, b]) => [fr.X(a), fr.X(b)] as const) }
      : undefined;
    const decks = row && !fr.outline ? p.windows.filter((r) => Math.abs(r.y - row.y) > H * 0.25) : [];
    deckRows = decks.length;
    rows = row ? [row, ...decks] : [];
  }
  const doorBox = fr
    // traced doors are boxes with y at the top edge (frame is y-down)
    ? (fr.t.doors ?? []).map((d) => ({ x: fr.X(d.x), y: fr.Y(d.y + d.h), w: d.w * L, h: d.h * L, kind: 'pax' as const }))
    : p.doors.map((d) => {
      const kind = d.kind ?? 'pax';
      const big = H > 5;
      const dw = d.w ?? (kind === 'exit' ? 0.55 : kind === 'cargo' ? 1.8 : big ? 1.07 : 0.82);
      const dh = d.h ?? (kind === 'exit' ? 0.95 : kind === 'cargo' ? 1.25 : big ? 1.93 : 1.85);
      const row = nearestRow(p, d.y);
      const dy = d.y ?? (kind === 'cargo' ? -H / 2 + H * 0.1 : kind === 'exit' ? row.y - 0.5 : row.y - dh * 0.55);
      return { x: d.x, y: dy, w: dw, h: dh, kind };
    });
  const doors = new D();
  for (const d of doorBox) doors.rrect(d.x, d.y, d.w, d.h, Math.min(d.w, d.h) * 0.2);
  const win = new D();
  for (const row of rows) {
    for (let x = row.x0; x <= row.x1 + 1e-6; x += row.pitch) {
      const hit = doorBox.some((d) => d.kind !== 'cargo' && x + row.w / 2 > d.x - 0.12 && x - row.w / 2 < d.x + d.w + 0.12 && row.y > d.y && row.y < d.y + d.h + 0.3);
      if (hit || row.gaps?.some(([a, b]) => x >= a && x <= b)) continue;
      // traced airframe: spec deck rows only where they sit inside it
      if (fr && (row.y + row.h / 2 > upperY(x) - H * 0.04 || row.y - row.h / 2 < lowerY(x) + H * 0.04)) continue;
      win.rrect(x - row.w / 2, row.y - row.h / 2, row.w, row.h, row.w * 0.45);
    }
  }
  if (p.nose.radome && !fr?.outline) {
    const rx = p.nose.radome * H;
    const yt = upperY(rx), yb = lowerY(rx);
    lines.M([rx - H * 0.02, yt - H * 0.01]).C([rx + H * 0.05, lerp(yt, yb, 0.3)], [rx + H * 0.05, lerp(yt, yb, 0.7)], [rx - H * 0.01, yb + H * 0.01]);
  }
  if (p.tail.blade && tailEnd) {
    const [a, b] = tailEnd;
    lines.M([a[0] - H * 0.035, a[1] - H * 0.01]).L([b[0] - H * 0.035, b[1] + H * 0.01]);
  }
  const apu = new D();
  if (p.tail.apu && tailEnd) {
    const [a, b] = tailEnd;
    const cy = (a[1] + b[1]) / 2, ry = Math.min((p.tail.apu * H) / 2, Math.abs(a[1] - b[1]) / 2 + H * 0.01);
    apu.M([L + 0.02, cy + ry]).C([L - ry * 0.7, cy + ry], [L - ry * 0.7, cy - ry], [L + 0.02, cy - ry]).Z();
  }

  // ---------- cockpit ----------
  const panes = new D();
  let mask = '';
  let paneList: string[] | undefined;
  let cockpitEnd: number;
  if (fr && fr.t.cockpit?.some((q) => q.length >= 3)) {
    const polys = fr.t.cockpit.filter((q) => q.length >= 3).map((q) => q.map(fr.P));
    for (const pane of polys) panes.poly(pane);
    paneList = polys.map((q) => new D().poly(q).toString());
    cockpitEnd = Math.max(...polys.flat().map((v) => v[0]));
  } else {
    const ck = COCKPIT[p.cockpit.style];
    const cs = (p.cockpit.scale ?? 1) * H;
    const cx0 = p.cockpit.u * H, cy0 = p.cockpit.v * H;
    const cp = (q: readonly (readonly [number, number])[]) => q.map(([u, v]): V => [cx0 + u * cs, cy0 + v * cs]);
    for (const pane of ck.panes) panes.poly(cp(pane));
    mask = ck.mask ? new D().smooth([...cp(ck.mask), cp(ck.mask)[0]]).Z().toString() : '';
    cockpitEnd = cx0 + Math.max(...ck.panes.flat().map((v) => v[0])) * cs;
  }

  // ---------- titles ----------
  const inTube = rows.filter((r) => r.y + r.h / 2 < H * 0.4);
  const topRow = (inTube.length ? inTube : rows).reduce<WindowRow | undefined>((a, b) => (!a || b.y > a.y ? b : a), undefined);
  const winTop = topRow ? topRow.y + topRow.h / 2 : 0;
  const crownAt = (x: number) => Math.min(upperY(x), H / 2);
  let tx = Math.max(cockpitEnd + H * 0.25, ...doorBox.filter((d) => d.kind === 'pax' && d.x < L * 0.3).map((d) => d.x + d.w + H * 0.08));
  while (tx < L * 0.5 && crownAt(tx) < H * 0.49) tx += H * 0.05;
  if (fr?.t.titlesFrom !== undefined) tx = fr.X(fr.t.titlesFrom);
  const avail = H / 2 - winTop;
  const wingStop = fr?.outline ? (Number.isFinite(wingFrom) ? wingFrom : L * 0.4) : w.high ? w.x - wrc * 0.5 : w.x + wrc * 0.3;
  // letters fill 62% of the band above the windows; single-aisle bands are narrow, so their titles
  // take 74% (still >= 0.13 m clear of the windows and the crown) and end short of the next door
  // (a long airline name shrinks to fit rather than run over it)
  const single = H < 4.5;
  const nextDoor = Math.min(Infinity, ...doorBox.filter((d) => d.kind === 'pax' && d.x > tx).map((d) => d.x));
  const tw = Math.min(Math.max(H * 1.6, Math.min(wingStop, L * 0.6) - tx), single ? nextDoor - H * 0.08 - tx : Infinity);
  let titles = (fr && !deckRows ? undefined : p.titles) ?? { x: tx, y: winTop + avail * 0.46, w: tw, size: Math.min(avail * (single ? 0.74 : 0.62), H * 0.24) };
  // never under a propeller: titles ahead of a disc end short of it, titles starting inside one move aft of it
  for (const e of engines) {
    if (!e.prop) continue;
    const [d0, d1] = e.prop.x, gap = H * 0.1;
    if (titles.x < d0) titles = { ...titles, w: Math.min(titles.w, d0 - gap - titles.x) };
    else if (titles.x < d1 + gap) titles = { ...titles, x: d1 + gap };
  }

  // ---------- livery ----------
  const liv = new Map<TailStyle, LiveryGeo>();
  const livery = (style: TailStyle): LiveryGeo => {
    let lg = liv.get(style);
    if (!lg) {
      lg = liveryGeometry(style, { L, H, fin: finG.fn, wing: w, quad, finStart, top });
      liv.set(style, lg);
    }
    return lg;
  };

  return {
    p, traced: t, outline: !!fr?.outline, zones, L, H, tip, upperY, lowerY,
    fus: fus.toString(),
    crown, belly,
    wingRoot: wr.toString(),
    fin: { fill: finG.fill, edge: finG.edge, lines: finG.lines, quad, top, poly: pathPoly(finG.fill) },
    stab: { near: stabNear.toString(), far: stabFar.toString(), lines: stabLines.toString(), bullet: bullet.toString(), tTail: !!sb.tTail, none: !!sb.none },
    wing: { ...wingG, shadow },
    engines,
    windows: win.toString(),
    doors: doors.toString(),
    lines: lines.toString(),
    apu: apu.toString(),
    // traced panes: exact polygons (no rounding growth), posts opened to >= H * 0.01 where the trace closes them
    cockpit: { panes: panes.toString(), mask, round: paneList ? 0 : H * 0.006, list: paneList, post: H * 0.01 },
    titles,
    livery,
    box,
  };
}

/** Parametric fin from the spec: swept leading edge with optional dorsal fillet, square / round / raked tip. */
function paramFin(p: AircraftProfile, H: number, L: number, upperY: (x: number) => number, box: Box): FinGeo {
  const fn = p.fin;
  const top = H / 2 + fn.height;
  const rootLE: V = [fn.x, upperY(fn.x)];
  const tipLE: V = [fn.x + fn.height * Math.tan(rad(fn.sweep)), top];
  const tipTE: V = [tipLE[0] + fn.tipChord, top];
  const teX = Math.min(fn.x + fn.rootChord, L - 0.05);
  const rootTE: V = [teX, upperY(teX)];
  const dir: V = [tipLE[0] - rootLE[0], tipLE[1] - rootLE[1]];
  const dl = Math.hypot(dir[0], dir[1]);
  const nrm: V = [-dir[1] / dl, dir[0] / dl];
  const bow = (fn.bow ?? 0) * fn.rootChord;
  const lc1 = add(lerpV(rootLE, tipLE, 0.3), [nrm[0] * bow, nrm[1] * bow]);
  const lc2 = add(lerpV(rootLE, tipLE, 0.72), [nrm[0] * bow * 0.5, nrm[1] * bow * 0.5]);
  const edge = new D();
  let finStart: V = rootLE;
  if (fn.fillet) {
    const t = Math.min(0.6, fn.fillet.h / (top - rootLE[1]));
    const [pf, d1, d2] = splitTail(rootLE, lc1, lc2, tipLE, t);
    const f0: V = [fn.x - fn.fillet.len, upperY(fn.x - fn.fillet.len)];
    const tan: V = [d1[0] - pf[0], d1[1] - pf[1]];
    const tl2 = Math.hypot(tan[0], tan[1]) || 1;
    if (fn.fillet.knee) {
      // straight ramp, then a tight round into the leading edge
      const [pk, e1, e2] = splitTail(rootLE, lc1, lc2, tipLE, Math.min(0.75, t + 0.06));
      edge.M(f0).L(lerpV(f0, pf, 0.88)).Q(pf, pk).C(e1, e2, tipLE);
    } else {
      const k = Math.min(fn.fillet.h, fn.fillet.len) * 0.6;
      edge.M(f0).C([f0[0] + fn.fillet.len * 0.6, f0[1]], [pf[0] - (tan[0] / tl2) * k, pf[1] - (tan[1] / tl2) * k], pf).C(d1, d2, tipLE);
    }
    finStart = f0;
  } else {
    edge.M(rootLE).C(lc1, lc2, tipLE);
  }
  const tipKind = fn.tip ?? 'square';
  const tc = fn.tipChord;
  let teTop: V = tipTE;
  if (tipKind === 'round') {
    teTop = [tipTE[0] - tc * 0.08, top];
    edge.C([tipLE[0] + tc * 0.1, top + tc * 0.1], [tipTE[0] - tc * 0.35, top + tc * 0.08], teTop);
  } else if (tipKind === 'raked') {
    teTop = [tipTE[0], top - tc * 0.16];
    edge.L(teTop);
  } else {
    edge.L(tipTE);
  }
  edge.L(rootTE);
  // fill follows the crown back to the start, dipping inside it so the fuselage outline is covered
  const dip = Math.max(0.1, H * 0.05);
  const finFill = new D();
  finFill.s = edge.s;
  for (let i = 0; i <= 12; i++) {
    const x = lerp(rootTE[0], finStart[0], i / 12);
    const k = x > rootLE[0] ? 1 : Math.max(0, (x - finStart[0]) / Math.max(0.01, rootLE[0] - finStart[0]));
    finFill.L([x, upperY(x) - dip * k]);
  }
  finFill.L(finStart).Z();
  box.add(tipLE, tipTE, [tipTE[0], top + tc * 0.1]);
  const quad = [[fn.x, H / 2], [fn.x + fn.rootChord, H / 2], tipLE, tipTE] as const;
  const finLines = new D();
  if (fn.rudder) {
    const rr = fn.rudder;
    const hx0 = rootTE[0] - fn.rootChord * rr;
    finLines.M([hx0, upperY(hx0) + H * 0.06]).L([teTop[0] - tc * rr, top - tc * 0.08]);
  }

  return {
    fill: finFill.toString(), edge: edge.toString(), lines: finLines.toString(), quad, top, finStart, tipLE, tc,
    fn: { x: fn.x, rootChord: fn.rootChord, tipChord: fn.tipChord, height: fn.height },
  };
}

function nearestRow(p: AircraftProfile, y: number | undefined) {
  if (y === undefined) return p.windows[0];
  return p.windows.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a), p.windows[0]);
}

// ---------- livery shapes ----------

interface LivCtx {
  L: number;
  H: number;
  fin: FinGeo['fn'];
  wing: Pick<WingSpec, 'x' | 'rootChord'>;
  quad: readonly [V, V, V, V];
  finStart: V;
  top: number;
}

function liveryGeometry(style: TailStyle, c: LivCtx): LiveryGeo {
  const { L, H, quad, finStart, top } = c;
  const F = (s: number, t: number) => finAt(quad, s, t);
  const fn = c.fin;
  const fus = new D(), fus2 = new D(), fin = new D();
  const far = top + H * 2;
  const x0 = finStart[0] - H * 0.15, span = L - x0;
  // tail wrap: the fin colour runs down over the tail cone along a gentle curve
  const wrapEdge = (dy: number): V[] => [[x0 - dy * 2, H / 2 + 0.5], [x0 + span * 0.3, H / 2 + 0.05 + dy], [x0 + span * 0.55, H * 0.0 + dy], [L + 0.5, -H * 0.35 + dy]];
  const wrap = (d: D) => {
    const [a, b, cc, e] = wrapEdge(0);
    d.M(a).C(b, cc, e).L([L + 0.5, far]).L([x0, far]).Z();
  };
  let code: V;
  let cs = 0.5;
  switch (style) {
    case 'solid': {
      wrap(fus);
      code = [0.5, 0.42];
      break;
    }
    case 'split': {
      wrap(fus);
      // upper-rear half of the fin in the second colour, gently S-curved divide
      const a = F(1.3, 0.02), b = F(-0.3, 0.8);
      fin.M(a).C(F(0.85, 0.3), F(0.35, 0.5), b).L(F(-0.4, 2)).L(F(2, 2)).L(F(2, 0.02)).Z();
      code = [0.36, 0.26];
      cs = 0.4;
      break;
    }
    case 'stripe': {
      wrap(fus);
      // two diagonal bands rising aft across the upper fin
      const band = (t0: number, wd: number) => fin.poly([F(-0.4, t0 - 0.22), F(1.4, t0 + 0.2), F(1.4, t0 + 0.2 + wd), F(-0.4, t0 - 0.22 + wd)]);
      band(0.62, 0.12);
      band(0.8, 0.055);
      // matching pinstripe just below the wrap edge
      const lo = wrapEdge(-H * 0.09), hi = wrapEdge(-H * 0.035);
      fus2.M(lo[0]).C(lo[1], lo[2], lo[3]).L(hi[3]).C(hi[2], hi[1], hi[0]).Z();
      code = [0.48, 0.3];
      cs = 0.45;
      break;
    }
    case 'sweep':
    default: {
      // swoosh rising from the lower rear fuselage into the fin, second colour along its leading edge
      const xs = Math.max(c.wing.x + c.wing.rootChord * 1.15, finStart[0] - (L - finStart[0]) * 0.85);
      const yl = -H * 0.5;
      const tip = F(1.3, 1.05);
      fus.M([xs, yl - 0.3])
        .C([xs + (fn.x - xs) * 0.55, yl], [fn.x - fn.rootChord * 0.05, H * 0.1], F(0.08, 0.32))
        .C(F(0.35, 0.62), F(0.8, 0.9), tip)
        .L([tip[0] + 5, far]).L([L + 5, -H]).L([xs, -H]).Z();
      fus2.M([xs - H * 0.4, yl - 0.4])
        .C([xs + (fn.x - xs) * 0.45, yl + H * 0.06], [fn.x - fn.rootChord * 0.25, H * 0.28], F(-0.06, 0.48))
        .C(F(0.2, 0.76), F(0.6, 1.0), F(1.0, 1.25))
        .L(tip)
        .C(F(0.8, 0.9), F(0.35, 0.62), F(0.08, 0.32))
        .C([fn.x - fn.rootChord * 0.05, H * 0.1], [xs + (fn.x - xs) * 0.55, yl], [xs, yl - 0.3]).Z();
      fin.s = fus2.s;
      code = [0.62, 0.3];
      cs = 0.4;
      break;
    }
  }
  const pos = F(code[0], code[1]);
  const chord = lerp(fn.rootChord, fn.tipChord, code[1]);
  return {
    fus: fus.toString(),
    fus2: fus2.toString(),
    fin: fin.toString(),
    code: { x: pos[0], y: pos[1], size: Math.min(fn.height * cs, chord * 0.62), w: chord * (style === 'split' ? 0.62 : 0.8) },
  };
}

// ---------- wing (projected side view) ----------

/** Wing station 0..1: leading edge point, chord and thickness. */
export function wingStation(w: WingSpec, f: number): { le: V; chord: number; th: number } {
  const rise = w.span * Math.sin(rad(w.dihedral));
  const run = w.span * Math.tan(rad(w.sweep));
  const th = w.thickness ?? w.rootChord * 0.11;
  return { le: [w.x + run * f, w.y + rise * f], chord: lerp(w.rootChord, w.tipChord, f), th: lerp(th, Math.max(0.1, th * (w.tipChord / w.rootChord)), f) };
}

/**
 * Tip devices in a local frame: x in tip chords from the tip LE, y in device heights.
 * `blend`: the device grows out of the wing's leading edge (its start and first control point
 * ride the LE line) and closes along the wing's own tip outline, so no base line is drawn ahead
 * of the tip over the fuselage.
 */
const TIP: Partial<Record<TipDevice, { up: number[]; down?: number[]; blend?: boolean }>> = {
  sharklet: { up: [-0.1, 0, 0.55, 0.02, 0.9, 0.28, 1.12, 0.68, 1.42, 1, 1.72, 1, 1, 0] },
  winglet: { up: [0.2, 0, 0.36, 0.01, 0.48, 0.07, 0.56, 0.16, 1.22, 1, 1.56, 1, 1, 0] },
  blended: { up: [-0.4, 0, 0.55, 0.0, 0.92, 0.22, 1.14, 0.62, 1.42, 1, 1.64, 1, 1, 0] },
  scimitar: { up: [-0.35, 0, 0.55, 0.0, 0.95, 0.22, 1.16, 0.62, 1.5, 1, 1.68, 0.98, 1, 0], down: [0.45, 0, 0.62, -0.08, 0.86, -0.2, 1.08, -0.3, 1.22, -0.28, 1, 0] },
  curved: { up: [-0.8, 0, 0.6, 0.0, 1.05, 0.18, 1.45, 0.7, 1.7, 1.04, 1.82, 1.0, 1, 0], blend: true },
  fence: { up: [0.05, 0, 0.55, 1, 0.82, 0.96, 0.95, 0], down: [0.15, 0, 0.5, -0.75, 0.75, -0.7, 0.88, 0] },
};

function wingGeometry(w: WingSpec, box: Box): { fill: string; tip: string; tipEdge?: string; lines: string; shade?: string } {
  if (w.section) return wingSection(w, box);
  const root = wingStation(w, 0);
  const tip = wingStation(w, 1);
  const rc = w.rootChord, tc = w.tipChord;
  const th = root.th, tth = tip.th;
  const [rx, ry] = root.le;
  const [tx, ty] = tip.le;
  const fill = new D();
  const lead = w.delta ? 0.5 : 0.25;
  const plain = w.tip === 'none' || w.tip === 'fence' || !(w.tipH ?? 0);
  fill.M([rx, ry])
    .C([rx, ry + th * 0.3], [rx + rc * lead * 0.3, ry + th * 0.5], [rx + rc * lead, ry + th * 0.5])
    .L([tx + tc * 0.12, ty + tth * 0.5]);
  if (plain) fill.C([tx + tc * 0.6, ty + tth * 0.6], [tx + tc, ty + tth * 0.3], [tx + tc, ty]);
  else fill.L([tx + tc * 0.9, ty + tth * 0.45]).L([tx + tc, ty]);
  fill.L([rx + rc, ry - th * 0.12]).L([rx + rc * 0.42, ry - th * 0.5]).C([rx + rc * 0.1, ry - th * 0.5], [rx, ry - th * 0.3], [rx, ry]).Z();
  box.add([rx, ry - th / 2], [tx + tc, ty + tth]);

  const tipD = new D();
  let tipEdge: D | undefined;
  const h = w.tipH ?? 0;
  const preset = TIP[w.tip];
  if (preset && h > 0) {
    const m = (a: number, b: number): V => [tx + a * tc, ty + tth * 0.3 + b * h];
    const draw = (pts: number[], blend = false) => {
      if (blend) {
        // wing's upper outline: the LE line from the root (as drawn above) to the tip corner
        const a: V = [rx + rc * lead, ry + th * 0.5], b: V = [tx + tc * 0.12, ty + tth * 0.5];
        const on = (u: number): V => { const x = tx + u * tc; return [x, lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]))]; };
        const c: [V, V, V, V] = [on(pts[0]), on(pts[2]), m(pts[4], pts[5]), m(pts[6], pts[7])];
        // tip edge down to the wing's aft tip corner
        const rest: V[] = [];
        for (let i = 8; i + 3 < pts.length; i += 2) rest.push(m(pts[i], pts[i + 1]));
        rest.push([tx + tc, ty]);
        tipD.M(c[0]).C(c[1], c[2], c[3]);
        for (const v of [...rest, [tx + tc * 0.9, ty + tth * 0.45] as V, b]) tipD.L(v);
        tipD.Z();
        // the edge stroke starts where the curve has left the wing's outline (no doubled line along the LE)
        const wingTop: V[] = [a, b, [tx + tc * 0.9, ty + tth * 0.45], [tx + tc, ty]];
        const lift = (t: number) => { const q = splitTail(...c, t)[0]; return q[1] - yAt(wingTop, q[0]); };
        let t0 = 0;
        while (t0 < 0.9 && lift(t0) < tc * 0.01) t0 += 0.005;
        const [p0, d1, d2] = splitTail(...c, t0);
        tipEdge = new D().M(p0).C(d1, d2, c[3]);
        for (const v of rest) tipEdge.L(v);
        for (let i = 0; i + 1 < pts.length; i += 2) box.add(m(pts[i], pts[i + 1]));
        return;
      }
      tipD.M(m(pts[0], pts[1]));
      if (w.tip === 'fence') {
        for (let i = 2; i + 1 < pts.length; i += 2) tipD.L(m(pts[i], pts[i + 1]));
      } else {
        tipD.C(m(pts[2], pts[3]), m(pts[4], pts[5]), m(pts[6], pts[7]));
        for (let i = 8; i + 1 < pts.length; i += 2) tipD.L(m(pts[i], pts[i + 1]));
      }
      tipD.Z();
      for (let i = 0; i + 1 < pts.length; i += 2) box.add(m(pts[i], pts[i + 1]));
    };
    draw(preset.up, preset.blend);
    if (preset.down) draw(preset.down);
  } else if ((w.tip === 'raked' || w.tip === 'folding') && h > 0) {
    // raked tip: the leading edge sweeps on aft to a point; h = extra length (m)
    const base: V = [tx + tc * 0.05, ty + tth * 0.45];
    const rise = h * 0.12;
    const point: V = [tx + tc + h, ty + tth * 0.25 + rise];
    tipD.M(base).C([tx + tc * 0.55, ty + tth * 0.55 + rise * 0.3], [point[0] - h * 0.45, point[1] + tth * 0.12], point).C([tx + tc + h * 0.5, point[1] - tth * 0.1], [tx + tc * 1.05, ty - tth * 0.1], [tx + tc * 0.8, ty - tth * 0.12]).Z();
    box.add(point);
  }
  const lines = new D();
  lines.M([rx + rc * 0.72, ry - th * 0.2]).L([tx + tc * 0.7, ty + tth * 0.05]);
  if (w.tip === 'folding' && h > 0) lines.M([tx + tc * 0.7, ty + tth * 0.6]).L([tx + tc * 1.02, ty - tth * 0.1]);
  return { fill: fill.toString(), tip: tipD.toString(), tipEdge: tipEdge?.toString(), lines: lines.toString() };
}

/** Root aerofoil seen side-on: rounded leading edge at (x, y), cambered, sharp trailing edge. */
function wingSection(w: WingSpec, box: Box): { fill: string; tip: string; lines: string; shade: string } {
  const c = w.rootChord, t = w.thickness ?? c * 0.16;
  const P = (u: number, v: number): V => [w.x + u * c, w.y + v * t];
  const fill = new D().M(P(0, 0))
    .C(P(0, 0.42), P(0.09, 0.74), P(0.3, 0.74))
    .C(P(0.6, 0.74), P(0.86, 0.3), P(1, 0.04))
    .L(P(1, -0.03))
    .C(P(0.78, -0.12), P(0.48, -0.27), P(0.2, -0.27))
    .C(P(0.07, -0.27), P(0, -0.15), P(0, 0))
    .Z();
  // flap / aileron hinge line
  const lines = new D().M(P(0.74, 0.47)).C(P(0.75, 0.3), P(0.76, 0.0), P(0.75, -0.14));
  // underside in shadow: lower surface up to the mean camber line
  const shade = new D().M(P(0.012, -0.08))
    .C(P(0.1, 0.1), P(0.4, 0.22), P(0.7, 0.18))
    .C(P(0.85, 0.14), P(0.95, 0.06), P(1, 0.0))
    .L(P(1, -0.03))
    .C(P(0.78, -0.12), P(0.48, -0.27), P(0.2, -0.27))
    .C(P(0.07, -0.27), P(0.012, -0.18), P(0.012, -0.08))
    .Z();
  box.add(P(0, -0.27), P(0.3, 0.74), P(1, 0));
  return { fill: fill.toString(), tip: '', lines: lines.toString(), shade: shade.toString() };
}

// ---------- engines ----------

interface Nac { cowl: number; lip: number; max: number; aft: number; core: number; coreEnd: number; flat?: number; chev?: number }

const NAC: Record<Exclude<EngineStyle, 'turboprop' | 'supersonic'>, Nac> = {
  plain: { cowl: 0.64, lip: 0.9, max: 0.24, aft: 0.8, core: 0.5, coreEnd: 0.86 },
  longduct: { cowl: 0.86, lip: 0.88, max: 0.3, aft: 0.6, core: 0.4, coreEnd: 0.93 },
  gtf: { cowl: 0.7, lip: 0.94, max: 0.26, aft: 0.8, core: 0.44, coreEnd: 0.88 },
  chevron: { cowl: 0.62, lip: 0.9, max: 0.24, aft: 0.8, core: 0.5, coreEnd: 0.87, chev: 6 },
  ge90: { cowl: 0.66, lip: 0.94, max: 0.25, aft: 0.84, core: 0.46, coreEnd: 0.88 },
  flatbottom: { cowl: 0.62, lip: 0.88, max: 0.26, aft: 0.78, core: 0.5, coreEnd: 0.86, flat: 0.2 },
  rear: { cowl: 0.8, lip: 0.9, max: 0.26, aft: 0.74, core: 0.42, coreEnd: 0.92 },
  // the A380 nacelle boxes end with the fan cowl: core and plug only peek out behind it
  trent900: { cowl: 0.86, lip: 0.9, max: 0.28, aft: 0.8, core: 0.44, coreEnd: 0.94 },
};

function cowlR(t: number, s: Nac): number {
  if (t < s.max) return s.lip + (1 - s.lip) * Math.sin(((t / s.max) * Math.PI) / 2);
  const k = (t - s.max) / (s.cowl - s.max);
  return 1 - (1 - s.aft) * k * k;
}

function engineGeometry(e: EngineSpec, w: WingSpec, box: Box, upperY: (x: number) => number): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  const pylon = new D();
  if (e.mount === 'underwing' && e.station !== undefined) {
    const st = wingStation(w, e.station);
    const wy = st.le[1] - st.th * 0.3;
    const ax = x + len * (e.style === 'supersonic' ? 0.25 : 0.14);
    const topY = Math.max(wy, cy + r * 0.8);
    const fx = Math.min(st.le[0] - st.chord * 0.05, ax + 0.6);
    pylon.M([ax, cy + r * 0.8])
      .C([ax, topY - (topY - cy - r * 0.8) * 0.3], [fx - 0.4, topY], [fx, topY])
      .L([st.le[0] + st.chord * 0.8, wy - st.th * 0.1])
      .C([x + len * 0.94, cy + r * 0.62], [x + len * 1.02, cy + r * 0.32], [x + len * 1.02, cy + r * 0.18])
      .L([x + len * 0.6, cy + r * 0.3])
      .Z();
    box.add([st.le[0] + st.chord * 0.8, wy]);
  } else if (e.mount === 'rear') {
    // short stub pylon back to the fuselage side, mostly hidden by the nacelle
    const px = x + len * 0.35;
    const py = Math.min(cy, upperY(px) - r) - r * 0.1;
    pylon.M([px, cy]).L([px + len * 0.4, cy]).L([px + len * 0.45, py]).L([px - len * 0.05, py]).Z();
  }
  if (e.style === 'turboprop') return turboprop(e, pylon, box);
  if (e.style === 'supersonic') return supersonic(e, pylon, box);

  const s = NAC[e.style];
  const ts = [0, 0.012, 0.04, 0.09, s.max * 0.75, s.max, (s.max + s.cowl) / 2, s.cowl * 0.86, s.cowl];
  const flatK = (t: number) => (s.flat && t < 0.4 ? 1 - s.flat * (1 - t / 0.4) ** 1.4 : 1);
  const upper = ts.map((t): V => [x + t * len, cy + r * cowlR(t, s)]);
  const lower = ts.map((t): V => [x + t * len, cy - r * cowlR(t, s) * flatK(t)]);
  const xc = x + s.cowl * len;
  const ra = r * s.aft;
  const cowl = new D().smooth(upper);
  if (s.chev) {
    const k = s.chev;
    for (let i = 1; i <= k * 2; i++) cowl.L([i % 2 ? xc + r * 0.14 : xc, cy + ra - (2 * ra * i) / (k * 2)]);
  }
  cowl.L(lower[lower.length - 1]).smooth([...lower].reverse(), false).Z();
  // accent band on the fan cowl, following the outline
  const ta = 0.1, tb = 0.2;
  const band: V[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = lerp(ta, tb, i / 4);
    band.push([x + t * len, cy + r * cowlR(t, s) + 0.02]);
  }
  for (let i = 4; i >= 0; i--) {
    const t = lerp(ta, tb, i / 4);
    band.push([x + t * len, cy - r * cowlR(t, s) * flatK(t) - 0.02]);
  }
  const accent = new D().poly(band).toString();
  const cr = r * s.core;
  const xe = x + s.coreEnd * len;
  const core = new D().M([xc - r * 0.12, cy + cr]).C([xc + (xe - xc) * 0.4, cy + cr], [xe - (xe - xc) * 0.2, cy + cr * 0.8], [xe, cy + cr * 0.72]).L([xe, cy - cr * 0.72]).C([xe - (xe - xc) * 0.2, cy - cr * 0.8], [xc + (xe - xc) * 0.4, cy - cr], [xc - r * 0.12, cy - cr]).Z();
  const pr = cr * 0.62;
  const xp = x + len;
  const plug = new D().M([xe - 0.02, cy + pr]).C([xe + (xp - xe) * 0.45, cy + pr], [xp - (xp - xe) * 0.12, cy + pr * 0.25], [xp, cy]).C([xp - (xp - xe) * 0.12, cy - pr * 0.25], [xe + (xp - xe) * 0.45, cy - pr], [xe - 0.02, cy - pr]).Z();
  const lipCy = s.flat ? cy + r * s.flat * 0.14 : cy;
  const lipRy = r * s.lip * (s.flat ? 0.9 : 1);
  const lip = new D().ellipse([x + r * 0.03, lipCy], r * 0.11, lipRy).toString();
  const dark = new D().ellipse([x + r * 0.07, lipCy], r * 0.06, lipRy * 0.82).ellipse([xc + r * 0.015, cy], r * 0.045, ra * 0.9).toString();
  const ts2 = s.max + 0.06;
  const seam = new D().M([x + len * ts2, cy + r * cowlR(ts2, s) - 0.01]).L([x + len * ts2, cy - r * cowlR(ts2, s) * flatK(ts2) + 0.01]).toString();
  box.add([x - r * 0.1, cy - r], [xp, cy + r]);
  return { spec: e, pylon: pylon.toString(), cowl: cowl.toString(), accent, lip, dark, core: core.toString(), plug: plug.toString(), seam };
}

function turboprop(e: EngineSpec, pylon: D, box: Box): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  const sp = len * 0.12;
  const xb = x + sp;
  const end = x + (e.tailLen ?? len);
  const cowl = new D()
    .M([xb, cy + r * 0.52])
    .C([xb + len * 0.03, cy + r * 0.95], [xb + len * 0.1, cy + r * 1.04], [xb + len * 0.3, cy + r * 1.04])
    .L([end - (end - x) * 0.1, cy + r * 0.98])
    .C([end - (end - x) * 0.02, cy + r * 0.96], [end, cy + r * 0.8], [end, cy + r * 0.62])
    .C([end - (end - x) * 0.2, cy - r * 0.5], [x + len * 0.62, cy - r * 0.98], [x + len * 0.42, cy - r * 1.0])
    .L([xb + len * 0.16, cy - r * 1.0])
    .C([xb + len * 0.04, cy - r * 0.98], [xb, cy - r * 0.78], [xb, cy - r * 0.3])
    .Z();
  // chin intake under the spinner and exhaust on the nacelle side
  const dark = new D()
    .M([xb + len * 0.015, cy - r * 0.4]).L([xb + len * 0.09, cy - r * 0.44]).L([xb + len * 0.09, cy - r * 0.74]).L([xb + len * 0.03, cy - r * 0.72]).Z()
    .M([x + len * 0.58, cy - r * 0.05]).L([x + len * 0.7, cy - r * 0.02]).L([x + len * 0.68, cy - r * 0.32]).L([x + len * 0.58, cy - r * 0.3]).Z();
  const accent = new D().M([xb + len * 0.2, cy + r * 1.03]).L([xb + len * 0.28, cy + r * 1.03]).L([xb + len * 0.28, cy - r * 1.0]).L([xb + len * 0.2, cy - r * 1.0]).Z().toString();
  const spinner = new D().M([xb + 0.03, cy + r * 0.5]).C([xb - sp * 0.45, cy + r * 0.48], [x + sp * 0.05, cy + r * 0.16], [x, cy]).C([x + sp * 0.05, cy - r * 0.16], [xb - sp * 0.45, cy - r * 0.48], [xb + 0.03, cy - r * 0.5]).Z();
  const R = (e.prop?.dia ?? r * 4) / 2;
  const nb = e.prop?.blades ?? 6;
  const xd = xb - sp * 0.3;
  const rx = R * 0.1;
  const disc = new D().ellipse([xd, cy], rx, R).toString();
  const blades = new D();
  // blades seen from the side: thin tapered shapes radiating from the hub at different phase angles
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + 0.25;
    const sy = Math.sin(a), sx = Math.cos(a);
    const tip: V = [xd + sx * rx * 0.9, cy + sy * R * 0.98];
    const root: V = [xd, cy + sy * r * 0.35];
    const wd = R * 0.06 * (0.35 + 0.65 * Math.abs(sx));
    blades.M(root).C([root[0] + wd, lerp(root[1], tip[1], 0.35)], [tip[0] + wd * 0.6, lerp(root[1], tip[1], 0.8)], tip).C([tip[0] - wd * 0.6, lerp(root[1], tip[1], 0.8)], [root[0] - wd, lerp(root[1], tip[1], 0.35)], root).Z();
  }
  box.add([xd - rx, cy - R], [xd + rx, cy + R], [end, cy]);
  return {
    spec: e, pylon: pylon.toString(), cowl: cowl.toString(), accent, lip: '', dark: dark.toString(), core: '', plug: '', seam: '',
    prop: { disc, blades: blades.toString(), spinner: spinner.toString(), x: [xd - rx, xd + rx] },
  };
}

function supersonic(e: EngineSpec, pylon: D, box: Box): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  // as on the Concorde drawing (u along the box, v in r below the centre): intake raked with the
  // upper lip ahead, belly deepening to the box bottom by u 0.4, nozzle curving up to the centre
  const BELLY: readonly V[] = [[0.08, 0.55], [0.2, 0.7], [0.32, 0.82], [0.42, 0.97], [0.78, 0.98], [0.84, 0.82], [0.9, 0.55], [0.95, 0.27], [1, -0.05]];
  const at = (u: number, v: number): V => [x + len * u, cy - r * v];
  const under = (u: number) => yAt(BELLY, u);
  const belly: V[] = [];
  for (let i = 0; i <= 46; i++) belly.push(at(lerp(1, 0.08, i / 46), under(lerp(1, 0.08, i / 46))));
  const cowl = new D().M(at(-0.01, -1)).L(at(1, -1)).L(belly[0]).spline(belly, false).Z().toString();
  // dark intake lip along the rake, dark nozzle (lower three quarters aft of u 0.69)
  const lip = 0.024;
  const nozzle: V[] = [at(0.69, -0.74), at(1, -0.74)];
  for (let i = 0; i <= 20; i++) nozzle.push(at(lerp(1, 0.69, i / 20), under(lerp(1, 0.69, i / 20))));
  const dark = new D().poly([at(-0.01, -1), at(-0.01 + lip, -1), at(0.08 + lip, under(0.08 + lip)), at(0.08, 0.55)]).poly(nozzle).toString();
  const accent = new D().poly([at(0.18, -0.99), at(0.24, -0.99), at(0.24, under(0.24) - 0.02), at(0.18, under(0.18) - 0.02)]).toString();
  box.add(at(-0.01, -1), at(1, -1), ...belly);
  return { spec: e, pylon: pylon.toString(), cowl, accent, lip: '', dark, core: '', plug: '', seam: '' };
}

/**
 * Polygon (world coords, y up) of a path built by D: M/L/H/V/C/Q/Z, cubics and quadratics
 * sampled `n` steps each, first subpath only (v0.5.1 stickers: fin and fuselage outlines).
 */
export function pathPoly(d: string, n = 8): V[] {
  const tok = d.match(/[MLHVCQZmlhvcqz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: V[] = [];
  let i = 0, cmd = '', cur: V = [0, 0];
  const num = () => Number(tok[i++]);
  const pt = (): V => { const x = num(); return [x, num()]; };
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M') { if (out.length) break; cur = pt(); out.push(cur); cmd = 'L'; }
    else if (cmd === 'L') { cur = pt(); out.push(cur); }
    else if (cmd === 'H') { cur = [num(), cur[1]]; out.push(cur); }
    else if (cmd === 'V') { cur = [cur[0], num()]; out.push(cur); }
    else if (cmd === 'C') {
      const a = pt(), b = pt(), p = pt();
      for (let k = 1; k <= n; k++) out.push(cubic(cur, a, b, p, k / n));
      cur = p;
    } else if (cmd === 'Q') {
      const a = pt(), p = pt();
      for (let k = 1; k <= n; k++) { const t = k / n, u = 1 - t; out.push([u * u * cur[0] + 2 * u * t * a[0] + t * t * p[0], u * u * cur[1] + 2 * u * t * a[1] + t * t * p[1]]); }
      cur = p;
    } else break;
  }
  return out.map(([x, y]): V => [x, -y]);
}
