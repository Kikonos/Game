// Livery stickers (v0.5.1): tail code, titles and logos as decals placed in the
// frame of the fin or the fuselage, so one livery fits every type. Pure layout
// maths only — AircraftArt draws the boxes, the livery editor drags them.
//
// Frames: geometry is nose-left, y up; the art mirrors it once, so a geometry
// point (x, y) sits at viewBox (-x, -y). Everything exported here speaks viewBox
// coords (the nose-right screen frame); the flip lives only in toView/toWorld.

import type { Livery, StickerKind, StickerPlacement, StickerSide, TailStyle } from '../../../engine/core/types';
import { artGeometry } from './AircraftArt';
import { textInkEm, textWidthEm, type FontWeight } from './fontMetrics';
import { finAt, pathPoly, type Geometry } from './geometry';
import { lerp, type V } from './path';

export type { V };

export interface StickerBox {
  id: string;
  kind: StickerKind;
  side: StickerSide;
  /** Centre, size and clockwise rotation (deg) in viewBox units; text boxes are the ink box. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
  fontSize?: number;
  text?: string;
  /** Text: baseline below the box centre (viewBox units, before rotation). */
  baseline?: number;
  weight?: FontWeight;
  /** Text letter-spacing in em. */
  spacing?: number;
}

/** Letter-spacing (em) of the fin code and the titles (as v0.5). */
export const CODE_SPACING = 0.02;
export const TITLE_SPACING = 0.04;
/** Auto fin-code anchors (s along the chord, t root → tip) per scheme, as v0.5. */
const CODE_ANCHOR: Record<TailStyle, V> = { solid: [0.5, 0.42], split: [0.36, 0.26], stripe: [0.48, 0.3], sweep: [0.62, 0.3] };
/** Fuselage logos smaller than this share of L are dropped at detail 'simple'. */
const MINI_LOGO = 0.06;

const toView = (p: V): V => [-p[0], -p[1]];
const toWorld = (X: number, Y: number): V => [-X, -Y];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ---------- per-type frame data (cached) ----------

interface Frames {
  g: Geometry;
  fin: V[];
  fus: V[];
  /** Outline mode: the tube zone (fuselage stickers stay off the delta). */
  tube?: V[];
  /** Window line centre (world y), if any windows. */
  winY?: number;
}

const frames = new Map<string, Frames>();
function framesOf(typeId: string): Frames {
  let f = frames.get(typeId);
  if (!f) {
    const g = artGeometry(typeId);
    const win = g.windows ? pathPoly(g.windows, 2) : [];
    f = {
      g, fin: g.fin.poly, fus: pathPoly(g.fus), tube: g.zones ? pathPoly(g.zones.tube, 1) : undefined,
      winY: win.length ? win.reduce((a, v) => a + v[1], 0) / win.length : undefined,
    };
    frames.set(typeId, f);
  }
  return f;
}

/** Even-odd point-in-polygon. */
export function inPoly(poly: readonly V[], p: V): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------- frame <-> viewBox ----------

/** Frame point of `side` (fractions, see StickerPlacement) to viewBox coords. */
export function frameToView(typeId: string, side: StickerSide, x: number, y: number): V {
  const { g } = framesOf(typeId);
  return toView(side === 'fin' ? finAt(g.fin.quad, x, y) : [x * g.L, g.H / 2 - y * g.H]);
}

/** viewBox point to the frame of `side`; the fin is the inverse bilinear map of its quad (Newton). */
export function viewToFrame(typeId: string, side: StickerSide, X: number, Y: number): V {
  const { g } = framesOf(typeId);
  const [wx, wy] = toWorld(X, Y);
  if (side === 'fuselage') return [wx / g.L, (g.H / 2 - wy) / g.H];
  const q = g.fin.quad;
  // start from the root/tip heights, then refine (s, t) on the bilinear map
  let t = (wy - q[0][1]) / ((q[2][1] + q[3][1]) / 2 - q[0][1] || 1);
  const r0 = lerp(q[0][0], q[2][0], t), r1 = lerp(q[1][0], q[3][0], t);
  let s = (wx - r0) / (r1 - r0 || 1);
  for (let k = 0; k < 6; k++) {
    const p = finAt(q, s, t);
    const ds: V = [lerp(q[1][0] - q[0][0], q[3][0] - q[2][0], t), lerp(q[1][1] - q[0][1], q[3][1] - q[2][1], t)];
    const dt: V = [lerp(q[2][0] - q[0][0], q[3][0] - q[1][0], s), lerp(q[2][1] - q[0][1], q[3][1] - q[1][1], s)];
    const ex = wx - p[0], ey = wy - p[1];
    const det = ds[0] * dt[1] - ds[1] * dt[0];
    if (!det) break;
    s += (ex * dt[1] - ey * dt[0]) / det;
    t += (ds[0] * ey - ds[1] * ex) / det;
  }
  return [s, t];
}

/** Airframe part under a viewBox point: the fin first (its root overlaps the crown), then the fuselage tube. */
export function sideAt(typeId: string, X: number, Y: number): StickerSide | null {
  const f = framesOf(typeId);
  const p = toWorld(X, Y);
  if (inPoly(f.fin, p)) return 'fin';
  if (inPoly(f.fus, p) && (!f.tube || inPoly(f.tube, p))) return 'fuselage';
  return null;
}

/** Clip outlines of the airframe [fuselage, fin], in the art's inner (mirrored) frame: draw under `scale(-1,1)`. */
export function airframeClipPaths(typeId: string): string[] {
  const g = artGeometry(typeId);
  return [g.fus, g.fin.fill];
}

// ---------- fitting inside the fin ----------

/** Horizontal crossings of a polygon with the line at y, as sorted x pairs (inside intervals). */
function spansAt(poly: readonly V[], y: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  xs.sort((u, v) => u - v);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

/** Spans at every vertex height of a polygon, sorted by y (cached: fitting scans many bands). */
const vspans = new WeakMap<readonly V[], { ys: number[]; spans: [number, number][][] }>();
function vertexSpans(poly: readonly V[]) {
  let v = vspans.get(poly);
  if (!v) {
    const ys = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
    v = { ys, spans: ys.map((y) => spansAt(poly, y)) };
    vspans.set(poly, v);
  }
  return v;
}
function lowerBound(a: readonly number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
  return lo;
}

/**
 * x-interval (world) where every horizontal line of the band [y0, y1] is inside the polygon,
 * following the span nearest `x` on the band's centre line. Exact for a polygon: the span ends
 * move linearly between vertex heights.
 */
function bandSpan(poly: readonly V[], y0: number, y1: number, x: number): [number, number] | null {
  const mid = spansAt(poly, (y0 + y1) / 2);
  if (!mid.length) return null;
  const gap = ([a, b]: [number, number]) => (x < a ? a - x : x > b ? x - b : 0);
  let [lo, hi] = mid.reduce((m, sp) => (gap(sp) < gap(m) ? sp : m));
  const vx = vertexSpans(poly);
  const rows: [number, number][][] = [spansAt(poly, y0), spansAt(poly, y1)];
  for (let i = lowerBound(vx.ys, y0); i < vx.ys.length && vx.ys[i] < y1; i++) if (vx.ys[i] > y0) rows.push(vx.spans[i]);
  for (const row of rows) {
    const sp = row.find(([a, b]) => b > lo && a < hi);
    if (!sp) return null;
    lo = Math.max(lo, sp[0]);
    hi = Math.min(hi, sp[1]);
    if (hi <= lo) return null;
  }
  return [lo, hi];
}

interface Rect { cx: number; cy: number; w: number; h: number }

/**
 * Largest rectangle of aspect ~`aspect` (w/h) inside the polygon, vertically centred on the anchor
 * (or the nearest height that is inside), free to slide along the chord; margin `m` on all sides.
 * World coords.
 */
function fitRect(poly: readonly V[], a: V, aspect: number, m: number, maxH: number): Rect | null {
  const tryAt = (p: V): Rect | null => {
    let best: Rect | null = null, score = 0;
    for (let k = 1; k <= 48; k++) {
      const h = (maxH * k) / 48;
      // centre the search on the middle of the anchor line's span so a skewed anchor still finds room
      const sp = bandSpan(poly, p[1] - h / 2 - m, p[1] + h / 2 + m, p[0]);
      if (!sp) break;
      const w = sp[1] - sp[0] - 2 * m;
      if (w <= 0) break;
      const sc = Math.min(w / aspect, h);
      if (sc > score) {
        score = sc;
        const ww = Math.min(w, h * aspect * 1.6);
        const cx = clamp(p[0], sp[0] + m + ww / 2, sp[1] - m - ww / 2);
        best = { cx, cy: p[1], w: ww, h };
      }
    }
    return best;
  };
  let r = tryAt(a);
  if (r) return r;
  // anchor outside the outline: walk it toward the polygon's centroid
  const c: V = [poly.reduce((s, v) => s + v[0], 0) / poly.length, poly.reduce((s, v) => s + v[1], 0) / poly.length];
  for (let k = 1; k <= 10 && !r; k++) r = tryAt([lerp(a[0], c[0], k / 10), lerp(a[1], c[1], k / 10)]);
  return r;
}

const insets = new Map<string, Rect | null>();
function finRect(typeId: string, scheme: TailStyle, aspect: number): Rect | null {
  const key = `${typeId}|${scheme}|${aspect.toFixed(3)}`;
  if (insets.has(key)) return insets.get(key)!;
  const { g, fin } = framesOf(typeId);
  const q = g.fin.quad;
  const [s, t] = CODE_ANCHOR[scheme] ?? CODE_ANCHOR.sweep;
  const a = finAt(q, s, t);
  const chord = Math.hypot(...([0, 1].map((i) => finAt(q, 1, t)[i] - finAt(q, 0, t)[i]) as [number, number]));
  const height = Math.max(...fin.map((v) => v[1])) - Math.min(...fin.map((v) => v[1]));
  // the anchor height, or up to 12 % of the fin away when that gives clearly bigger letters
  let r = fitRect(fin, a, aspect, chord * 0.04, height * 0.9);
  const size = (x: Rect | null) => (x ? Math.min(x.w / aspect, x.h) : 0);
  for (const dy of [0.06, -0.06, 0.12, -0.12]) {
    const o = fitRect(fin, [a[0], a[1] + dy * height], aspect, chord * 0.04, height * 0.9);
    if (size(o) > size(r) * (1.12 + Math.abs(dy))) r = o;
  }
  insets.set(key, r);
  return r;
}

/** Biggest square inside the fin (any height between 20 % and 65 % of it): the auto tail logo, whatever the scheme. */
function logoRect(typeId: string): Rect | null {
  const key = `${typeId}|logo`;
  if (insets.has(key)) return insets.get(key)!;
  const { g, fin } = framesOf(typeId);
  const q = g.fin.quad;
  const height = Math.max(...fin.map((v) => v[1])) - Math.min(...fin.map((v) => v[1]));
  let r: Rect | null = null;
  for (let t = 0.2; t <= 0.651; t += 0.05) {
    const chord = Math.hypot(finAt(q, 1, t)[0] - finAt(q, 0, t)[0], finAt(q, 1, t)[1] - finAt(q, 0, t)[1]);
    const o = fitRect(fin, finAt(q, 0.5, t), 1, chord * 0.04, height * 0.9);
    if (o && (!r || Math.min(o.w, o.h) > Math.min(r.w, r.h) * 1.02)) r = o;
  }
  insets.set(key, r);
  return r;
}

/** viewBox rectangle wholly inside the fin outline around the scheme's code anchor (4 % chord margin). */
export function finInset(typeId: string, scheme: TailStyle, aspect = 2): { cx: number; cy: number; w: number; h: number } {
  const r = finRect(typeId, scheme, aspect);
  if (!r) {
    const c = artGeometry(typeId).livery(scheme).code;
    return { cx: -c.x, cy: -c.y, w: 0, h: 0 };
  }
  return { cx: -r.cx, cy: -r.cy, w: r.w, h: r.h };
}

// ---------- layout ----------

/** The legacy look (code on the fin, titles on the fuselage; a logo takes the fin instead of the code). */
export function defaultStickers(lv: Livery): StickerPlacement[] {
  return lv.logo
    ? [{ id: 'logo', kind: 'logo', side: 'fin', scale: 1 }, { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 }]
    : [{ id: 'code', kind: 'code', side: 'fin', scale: 1 }, { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 }];
}

/** Stickers a livery draws: its own list, else the legacy defaults. */
export function stickersOf(lv: Livery): StickerPlacement[] {
  return lv.stickers ?? defaultStickers(lv);
}

export interface StickerTexts { code?: string; name?: string }

/** Text a sticker kind prints (upper case; '' = nothing). */
export function stickerText(lv: Livery, kind: StickerKind, d: StickerTexts): string {
  if (kind === 'code') return (lv.code?.text ?? d.code ?? '').trim().toUpperCase();
  if (kind === 'titles') return (lv.titles?.text ?? d.name ?? '').trim().toUpperCase();
  return '';
}

/**
 * Boxes for every sticker the livery draws on this type, in draw order (viewBox coords).
 * Scale 1 at the auto position fits its zone: the code and a fin logo inside the fin inset,
 * titles inside the title band. Anything bigger or moved is clipped by the renderer.
 */
export function stickerLayout(typeId: string, lv: Livery, defaults: StickerTexts, detail: 'full' | 'simple' = 'full'): StickerBox[] {
  const { g } = framesOf(typeId);
  const scheme = lv.tail;
  const legacy = g.livery(scheme).code;
  // v0.5 letter size caps the code (a few traces give no usable value: no cap then)
  const cap = legacy.size > 0 ? legacy.size : Infinity;
  const fallback = legacy.size > 0 ? legacy.size * 0.5 : g.H * 0.2;
  const band = g.titles;
  const bandCap = band.size * textInkEm('H').asc;
  const out: StickerBox[] = [];
  /** Nose-side end of the auto titles' ink (world x), for an auto fuselage logo aft of them. */
  let titlesEnd = band.x;
  const list = stickersOf(lv).slice(0, 6);
  // titles first: an auto fuselage logo sits aft of them
  const order = [...list].sort((a, b) => (a.kind === 'titles' ? 0 : 1) - (b.kind === 'titles' ? 0 : 1));
  const boxes = new Map<string, StickerBox>();
  for (const st of order) {
    const scale = clamp(Number.isFinite(st.scale) ? st.scale : 1, 0.3, 3);
    const rot = clamp(st.rotation ?? 0, -45, 45);
    const custom = st.x !== undefined && st.y !== undefined;
    const at = custom ? frameToView(typeId, st.side, st.x!, st.y!) : undefined;
    if (st.kind === 'logo') {
      if (!lv.logo) continue;
      let side: number, c: V;
      if (st.side === 'fin') {
        const r = logoRect(typeId);
        side = r ? Math.min(r.w, r.h) : fallback;
        c = r ? toView([r.cx, r.cy]) : toView([legacy.x, legacy.y]);
      } else {
        side = Math.min(g.H * 0.42, bandCap * 2.2);
        c = toView([Math.min(titlesEnd + side * 0.9, g.L * 0.7), band.y]);
      }
      side *= scale;
      if (detail === 'simple' && st.side === 'fuselage' && side < g.L * MINI_LOGO) continue;
      boxes.set(st.id, { id: st.id, kind: 'logo', side: st.side, cx: (at ?? c)[0], cy: (at ?? c)[1], w: side, h: side, rot });
      continue;
    }
    const text = stickerText(lv, st.kind, defaults);
    if (!text) continue;
    if (detail === 'simple' && st.side === 'fuselage') continue;
    const weight: FontWeight = (st.kind === 'code' ? lv.code?.weight : lv.titles?.weight) ?? 700;
    const spacing = st.kind === 'code' ? CODE_SPACING : TITLE_SPACING;
    const wEm = textWidthEm(text, weight, spacing);
    const ink = textInkEm(text);
    const hEm = ink.asc + ink.desc;
    let fs: number, c: V;
    if (st.side === 'fin') {
      const r = finRect(typeId, scheme, wEm / hEm);
      // never bigger than v0.5's letters; never outside the inset
      fs = r ? Math.min(r.h / hEm, r.w / wEm, st.kind === 'code' ? cap : Infinity) : fallback;
      c = r ? toView([r.cx, r.cy]) : toView([legacy.x, legacy.y]);
    } else if (st.kind === 'titles') {
      fs = Math.min(band.size, band.w / wEm);
      c = toView([band.x + (fs * wEm) / 2, band.y]);
    } else {
      // code on the fuselage: title-band letters
      fs = Math.min(band.size, band.w / wEm);
      c = toView([band.x + (fs * wEm) / 2, band.y]);
    }
    if (st.kind === 'titles' && st.side === 'fuselage' && !custom) titlesEnd = band.x + fs * wEm;
    fs *= scale;
    const p = at ?? c;
    boxes.set(st.id, {
      id: st.id, kind: st.kind, side: st.side, cx: p[0], cy: p[1], w: fs * wEm, h: fs * hEm, rot,
      fontSize: fs, text, baseline: ((ink.asc - ink.desc) / 2) * fs, weight, spacing,
    });
  }
  // draw order = the livery's list order
  for (const st of list) {
    const b = boxes.get(st.id);
    if (b) out.push(b);
  }
  return out;
}

/** Corners of a (rotated) box, viewBox coords. */
export function boxCorners(b: Pick<StickerBox, 'cx' | 'cy' | 'w' | 'h' | 'rot'>): V[] {
  const r = (b.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([u, v]): V => {
    const x = (u * b.w) / 2, y = (v * b.h) / 2;
    return [b.cx + x * c - y * s, b.cy + x * s + y * c];
  });
}

/** Is viewBox point (X, Y) on the box, with `pad` extra on every side? */
export function hitBox(b: Pick<StickerBox, 'cx' | 'cy' | 'w' | 'h' | 'rot'>, X: number, Y: number, pad = 0): boolean {
  const r = (-b.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = X - b.cx, dy = Y - b.cy;
  const u = dx * c - dy * s, v = dx * s + dy * c;
  return Math.abs(u) <= b.w / 2 + pad && Math.abs(v) <= b.h / 2 + pad;
}

/** Placement for a sticker whose centre is dragged to viewBox (X, Y): the side under it (else its old side), frame coords clamped 0–1. */
export function placeAt(typeId: string, st: StickerPlacement, X: number, Y: number): StickerPlacement {
  const side = sideAt(typeId, X, Y) ?? st.side;
  const [x, y] = viewToFrame(typeId, side, X, Y);
  const r = (v: number) => Math.round(clamp(v, 0, 1) * 1e4) / 1e4;
  return { ...st, side, x: r(x), y: r(y) };
}

/** Snap lines (viewBox): fin inset centre and mid-height; title band centre line and window line; airframe centre. */
export function snapTargets(typeId: string, side: StickerSide): { x: number[]; y: number[] } {
  const f = framesOf(typeId);
  const { g } = f;
  if (side === 'fin') {
    const r = finInset(typeId, 'solid');
    const mid = finAt(g.fin.quad, 0.5, 0.5);
    return { x: [r.cx, -mid[0]], y: [r.cy, -mid[1]] };
  }
  const y = [-g.titles.y];
  if (f.winY !== undefined) y.push(-f.winY);
  return { x: [-(g.titles.x), -g.L / 2], y };
}
