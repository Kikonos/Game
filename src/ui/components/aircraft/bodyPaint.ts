// v0.10 body paint geometry: where the livery's fuselage colours go, in the sprite's 2048-px frame (x right, y down,
// nose right). The tube comes from the generated body lines (crown and belly every 8 px, sprites.py geometry); the
// mask's body channel decides what is fuselage, so these shapes may run past the airframe. Pure (no DOM).

import type { Livery, LiveryBody, LiveryStripe } from '../../../engine/core/types';
import { layoutOf, type Pt, type SpriteLayout } from './sprites';

/** The tube lines with aerials and steps smoothed out (running median of 9 samples, then a mean of 5): paint lines run clean. */
const smoothCache = new WeakMap<SpriteLayout, SpriteLayout['body']>();
function smoothBody(d: SpriteLayout): SpriteLayout['body'] {
  let s = smoothCache.get(d);
  if (s) return s;
  const b = d.body;
  const sm = (arr: number[]): number[] => {
    const med = arr.map((v, i) => {
      if (v < 0) return v;
      const win = arr.slice(Math.max(0, i - 4), i + 5).filter((x) => x >= 0).sort((p, q) => p - q);
      return win[win.length >> 1];
    });
    return med.map((v, i) => {
      if (v < 0) return v;
      const win = med.slice(Math.max(0, i - 2), i + 3).filter((x) => x >= 0);
      return win.reduce((a, x) => a + x, 0) / win.length;
    });
  };
  s = { ...b, crown: sm(b.crown), belly: sm(b.belly) };
  smoothCache.set(d, s);
  return s;
}

/** Crown and belly of the fuselage tube at x (linear between samples); null where there is no fuselage. `raw`: the
 *  measured lines (the mask's own tube), else smoothed for the paint geometry. */
export function tubeAt(d: SpriteLayout, x: number, raw = false): [number, number] | null {
  if (!d.body) return null;
  const b = raw ? d.body : smoothBody(d);
  const f = (x - b.x0) / b.step;
  const i = Math.floor(f);
  if (i < 0 || i >= b.crown.length) return null;
  const j = Math.min(b.crown.length - 1, i + 1);
  const c0 = b.crown[i], c1 = b.crown[j], b0 = b.belly[i], b1 = b.belly[j];
  if (c0 < 0 || b0 < 0) return null;
  const t = f - i;
  const c = c1 >= 0 ? c0 + (c1 - c0) * t : c0, bb = b1 >= 0 ? b0 + (b1 - b0) * t : b0;
  return bb > c ? [c, bb] : null;
}

/** Fuselage height at the middle of the cabin (stripe thickness is a share of it, the same along the aircraft). */
export function tubeHeight(d: SpriteLayout): number {
  return Math.max(1, d.belly - d.crown);
}

/** The window line as a share of the tube (crown 0 → belly 1) at the middle of the cabin; 0.4 when none was found. */
export function windowShare(d: SpriteLayout): number {
  if (!d.win) return 0.4;
  const mid = (d.win[0] + d.win[1]) / 2;
  return Math.min(0.9, Math.max(0.1, (mid - d.crown) / tubeHeight(d)));
}

/** Sample xs along the tube from the tail end to the nose. */
function xsOf(d: SpriteLayout): number[] {
  const b = d.body;
  if (!b) return [];
  const out: number[] = [];
  for (let i = 0; i < b.crown.length; i++) if (b.crown[i] >= 0) out.push(b.x0 + i * b.step);
  return out;
}

/** Share of the length from the tail end (0) to the nose (1). */
const along = (d: SpriteLayout, x: number) => (x - d.tail) / Math.max(1, d.nose - d.tail);

/**
 * The y of a paint line at a share s of the tube: level through the main cabin (the share of the mid-cabin crown →
 * belly, so it stays parallel to the windows under a 747's hump and along its long nose), blending into the same share
 * of the local tube where the tube narrows (nose tip, tail cone) so the line runs smoothly into them.
 */
export function paintY(d: SpriteLayout, x: number, s: number): number | null {
  const t = tubeAt(d, x);
  if (!t) return null;
  const h = t[1] - t[0];
  const level = d.crown + s * tubeHeight(d);
  const local = t[0] + s * h;
  const w = Math.min(1, Math.max(0, (h / tubeHeight(d) - 0.45) / 0.35));
  const k = w * w * (3 - 2 * w);
  return local + (level - local) * k;
}

/** The share of the tube just below the main deck's windows (a small gap under them): where real liveries split. */
export function underWindows(d: SpriteLayout): number {
  const w = d.winMain ?? d.win;
  if (!w) return 0.55;
  return Math.min(0.85, Math.max(0.3, (w[1] - d.crown) / tubeHeight(d) + 0.035));
}

/** Belly split as a share of the tube at x: below the windows (`windows`) or at `split`; tilt + raises it toward the
 *  nose. A share of the tube, so the line follows the fuselage: up the tail cone, round under the cockpit. */
export function splitAt(d: SpriteLayout, belly: NonNullable<LiveryBody['belly']>, x: number): number {
  const base = belly.windows ? underWindows(d) : belly.split;
  return Math.min(1.05, Math.max(0.02, base - 0.3 * belly.tilt * (along(d, x) - 0.5)));
}

/** A band between two tube shares (functions of x) along the whole fuselage, or from x0 forward. */
function shareBand(d: SpriteLayout, top: (x: number) => number, bot: (x: number) => number, x0 = -Infinity): Pt[] {
  const up: Pt[] = [], dn: Pt[] = [];
  for (const x of [...xsOf(d), d.nose]) {
    if (x < x0) continue;
    const a = paintY(d, x, top(x)), b = paintY(d, x, bot(x));
    if (a === null || b === null) continue;
    up.push([x, a]);
    dn.push([x, b]);
  }
  if (!up.length) return [];
  // past the nose tip, and (x0 = -∞) past the tail cone, so the mask (not this polygon) ends the paint
  const head: Pt[] = x0 === -Infinity ? [[-10, up[0][1]]] : [];
  const tail: Pt[] = x0 === -Infinity ? [[-10, dn[0][1]]] : [];
  return [...head, ...up, [d.w + 10, up[up.length - 1][1]], [d.w + 10, dn[dn.length - 1][1]], ...dn.reverse(), ...tail];
}

/** The accent line along the belly split (thickness `h` of the tube, centred on the split). */
export function splitLinePoly(d: SpriteLayout, belly: NonNullable<LiveryBody['belly']>): Pt[] {
  const h = belly.line?.h ?? 0.02;
  return shareBand(d, (x) => splitAt(d, belly, x) - h / 2, (x) => splitAt(d, belly, x) + h / 2);
}

/** Nose band: from the split line (or just below the windows) down 17 % of the tube, the nose tip aft to just ahead
 *  of the first door (0.95 of the cabin's height: door 1 sits a fixed way behind the cockpit, whatever the length);
 *  its accent a thin line under it. */
export const NOSE_BAND = { len: 0.95, h: 0.17, accent: 0.022 };
export function noseBandPolys(d: SpriteLayout, b: LiveryBody): { band: Pt[]; accent: Pt[] } {
  const top = (x: number) => (b.belly ? splitAt(d, b.belly, x) : underWindows(d));
  const x0 = d.nose - NOSE_BAND.len * tubeHeight(d);
  return {
    band: shareBand(d, top, (x) => top(x) + NOSE_BAND.h, x0),
    accent: shareBand(d, (x) => top(x) + NOSE_BAND.h, (x) => top(x) + NOSE_BAND.h + NOSE_BAND.accent, x0),
  };
}

/** A point of the fin frame: s chord LE (0) → TE (1), t root (0) → tip (1) (bilinear on the measured quad). */
export function finPoint(d: SpriteLayout, s: number, t: number): Pt {
  const [rle, rte, tle, tte] = d.finQuad;
  const r: Pt = [rle[0] + (rte[0] - rle[0]) * s, rle[1] + (rte[1] - rle[1]) * s];
  const u: Pt = [tle[0] + (tte[0] - tle[0]) * s, tle[1] + (tte[1] - tle[1]) * s];
  return [r[0] + (u[0] - r[0]) * t, r[1] + (u[1] - r[1]) * t];
}

/** The fin-root stripe: across the whole chord, 13–18 % of the fin's height above its root. */
export function finRootPoly(d: SpriteLayout): Pt[] {
  return [finPoint(d, -0.6, 0.13), finPoint(d, 1.6, 0.13), finPoint(d, 1.6, 0.18), finPoint(d, -0.6, 0.18)];
}

/** Below the fin's root line (the dorsal fillet and the fuselage under the fin): it takes the body paint. */
export function finFilletPoly(d: SpriteLayout): Pt[] {
  const a = finPoint(d, -2, 0), b = finPoint(d, 3, 0);
  return [a, b, [b[0], d.h + 10], [a[0], d.h + 10]];
}

/** A stripe's centre share and its thickness in px. */
export function stripeShape(d: SpriteLayout, s: LiveryStripe): { c: number; px: number } {
  return { c: s.windows ? windowShare(d) : s.y, px: s.h * tubeHeight(d) };
}

/** Where a swept stripe leaves the fuselage for the fin: a little ahead of the fin's leading edge. */
const sweepStart = (d: SpriteLayout) => d.finQuad[0][0] + 0.06 * (d.nose - d.tail);

/** Centre line of a stripe: along the tube, and (sweep) up into the fin over a curve. */
export function stripeLine(d: SpriteLayout, s: LiveryStripe): Pt[] {
  const { c } = stripeShape(d, s);
  const pts: Pt[] = [];
  const xs = xsOf(d);
  const x0 = s.sweep ? sweepStart(d) : -Infinity;
  for (const x of xs) {
    if (x < x0) continue;
    const y = paintY(d, x, c);
    if (y !== null) pts.push([x, y]);
  }
  pts.push([d.w, pts.length ? pts[pts.length - 1][1] : d.crown]);
  if (!s.sweep || !pts.length) return [[-10, pts[0]?.[1] ?? d.crown], ...pts];
  // the sweep: a cubic from the start point, level at first, rising along the fin to beyond its tip
  const [rle, rte, tle, tte] = d.finQuad;
  const P0 = pts[0];
  const root: Pt = [rte[0] + (rle[0] - rte[0]) * 0.55, rle[1]];
  const tip: Pt = [tte[0] + (tle[0] - tte[0]) * 0.5 - (tle[0] - tte[0]) * 0.2, tle[1] - 0.08 * (rle[1] - tle[1])];
  const P1: Pt = [P0[0] - 0.45 * (P0[0] - root[0]), P0[1]];
  const P2: Pt = [root[0] + 0.25 * (P0[0] - root[0]), root[1] + 0.15 * (P0[1] - root[1])];
  // root → start: a cubic (steep at the fin, level where it joins the straight stripe)
  const curve: Pt[] = [];
  for (let k = 1; k < 24; k++) curve.push(bez(root, P2, P1, P0, k / 24));
  // tip → root: straight along the fin
  const up: Pt[] = [];
  for (let k = 8; k >= 1; k--) up.push([root[0] + (tip[0] - root[0]) * (k / 8), root[1] + (tip[1] - root[1]) * (k / 8)]);
  return [...up, root, ...curve, ...pts];
}

function bez(a: Pt, b: Pt, c: Pt, e: Pt, t: number): Pt {
  const v = 1 - t;
  return [v * v * v * a[0] + 3 * v * v * t * b[0] + 3 * v * t * t * c[0] + t * t * t * e[0], v * v * v * a[1] + 3 * v * v * t * b[1] + 3 * v * t * t * c[1] + t * t * t * e[1]];
}

/** A band of `px` thickness around a centre line (offset along the line's normals). */
export function bandAround(line: Pt[], px: number): Pt[] {
  if (line.length < 2) return [];
  const top: Pt[] = [], bot: Pt[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let nx = b[1] - a[1], ny = -(b[0] - a[0]);
    const n = Math.hypot(nx, ny) || 1;
    // one orientation all along the line, so the two sides never swap
    nx /= n;
    ny /= n;
    top.push([line[i][0] + nx * px / 2, line[i][1] + ny * px / 2]);
    bot.push([line[i][0] - nx * px / 2, line[i][1] - ny * px / 2]);
  }
  return [...top, ...bot.reverse()];
}

/** The belly area: from the split line down past the belly, the whole length. */
export function bellyPoly(d: SpriteLayout, belly: NonNullable<LiveryBody['belly']>): Pt[] {
  const top: Pt[] = [];
  for (const x of xsOf(d)) {
    const y = paintY(d, x, splitAt(d, belly, x));
    if (y !== null) top.push([x, y]);
  }
  if (!top.length) return [];
  return [[-10, top[0][1]], ...top, [d.w + 10, top[top.length - 1][1]], [d.w + 10, d.h + 10], [-10, d.h + 10]];
}

/** The nose and cockpit area: about the front 7 % of the length, its aft edge slanting back toward the belly. */
export function nosePoly(d: SpriteLayout): Pt[] {
  const L = d.nose - d.tail;
  return [[d.nose - 0.06 * L, -10], [d.w + 10, -10], [d.w + 10, d.h + 10], [d.nose - 0.085 * L, d.h + 10]];
}

export interface PaintLayer {
  color: string;
  polys: Pt[][];
  /** Also painted on the fin (a stripe sweeping up into it). */
  fin?: boolean;
}

/** Body paint layers in drawing order (body, belly, stripes, nose); empty without body paint. */
export function bodyLayers(id: string, b: LiveryBody | undefined): PaintLayer[] {
  if (!b) return [];
  const d = layoutOf(id);
  if (!d.body) return [];
  const all: Pt[] = [[-10, -10], [d.w + 10, -10], [d.w + 10, d.h + 10], [-10, d.h + 10]];
  const out: PaintLayer[] = [];
  if (b.color) out.push({ color: b.color, polys: [all] });
  if (b.belly) out.push({ color: b.belly.color, polys: [bellyPoly(d, b.belly)] });
  if (b.belly?.line) out.push({ color: b.belly.line.color, polys: [splitLinePoly(d, b.belly)] });
  for (const s of b.stripes ?? []) out.push({ color: s.color, polys: [bandAround(stripeLine(d, s), stripeShape(d, s).px)], fin: !!s.sweep });
  if (b.noseBand) {
    const nb = noseBandPolys(d, b);
    out.push({ color: b.noseBand.color, polys: [nb.band] });
    if (b.noseBand.accent) out.push({ color: b.noseBand.accent, polys: [nb.accent] });
  }
  if (b.nose) out.push({ color: b.nose, polys: [nosePoly(d)] });
  return out;
}

/** Point in polygon (even-odd). */
export function inPoly(p: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Paint on the fuselage at a viewBox point (white where nothing is painted). */
export function bodyColourAt(id: string, lv: Livery, X: number, Y: number): string {
  if (lv.plain || !lv.body) return '#ffffff';
  const layers = bodyLayers(id, lv.body);
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].polys.some((p) => inPoly(p, X, Y))) return layers[i].color;
  return '#ffffff';
}

/** Swept stripes' colour on the fin at a point, if any (they are drawn over the tail scheme). */
export function finStripeAt(id: string, lv: Livery, X: number, Y: number): string | null {
  if (lv.plain || !lv.body?.stripes?.some((s) => s.sweep)) return null;
  const layers = bodyLayers(id, lv.body).filter((l) => l.fin);
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].polys.some((p) => inPoly(p, X, Y))) return layers[i].color;
  return null;
}

/** Engine colour: the livery's own, else the belly colour when there is a belly (cowls are painted with the belly on
 *  most liveries), else the tail colour (as before v0.10). */
export const engineColour = (lv: Livery): string => lv.body?.engines ?? lv.body?.belly?.color ?? lv.primary;

/** The fin's own paint at its root (fillet) is the fuselage's when the fuselage has its own colour. */
export const filletTakesBody = (lv: Livery): boolean => !lv.plain && !!lv.body?.color;
