// Livery stickers (v0.5.1; v0.10 on the raster sprites): tail code, titles and logos as decals placed in the
// frame of the fin or the fuselage, so one livery fits every type. Pure layout maths only — AircraftArt draws
// the boxes, the livery editor drags them.
//
// Coordinates: the sprite's viewBox (pixels of the 2048-wide asset, x right, y down, nose RIGHT; sprites.ts).
// Frames: fin `x` = chord fraction leading edge (0) → trailing edge (1), `y` = root (0) → tip (1), bilinear on
// the fin quad measured from the mask's red area; fuselage `x` = share of the length nose (0) → tail (1),
// `y` = share of the fuselage height crown (0) → belly (1).

import type { Livery, StickerKind, StickerPlacement, StickerSide, TailStyle } from '../../../engine/core/types';
import { textInkEm, textWidthEm, type FontWeight } from './fontMetrics';
import { layoutOf, spriteOf, type Pt, type SpriteLayout } from './sprites';
import { countryOfReg } from '../../../data/countries';
import { flagRatio, flagUrl } from './flags';
import { bodyColourAt, finPoint, tubeAt } from './bodyPaint';
import type { Decal } from './compose';
import { contrast, INK, lum } from './ink';

export type V = Pt;

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
/** v0.5 code size per scheme: share of the fin height (capped at 62 % of the chord). */
const CODE_SIZE: Record<TailStyle, number> = { solid: 0.5, split: 0.4, stripe: 0.45, sweep: 0.4 };
/** Fuselage logos smaller than this share of L are dropped at detail 'simple'. */
const MINI_LOGO = 0.06;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V, b: V, t: number): V => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

/** Map fin-normalised (s along chord, t root → tip) to viewBox coords. */
export function finAt(q: readonly [V, V, V, V], s: number, t: number): V {
  return lerpV(lerpV(q[0], q[1], s), lerpV(q[2], q[3], s), t);
}

// ---------- per-sprite frame data (cached) ----------

interface Frames {
  d: SpriteLayout;
  fin: V[];
  zone: V[];
  q: [V, V, V, V];
  /** Length nose → tail and fuselage height crown → belly. */
  L: number;
  H: number;
  finH: number;
}

const frames = new Map<string, Frames>();
function framesOf(typeId: string): Frames {
  const id = spriteOf(typeId);
  let f = frames.get(id);
  if (!f) {
    const d = layoutOf(id);
    const ys = d.fin.map((p) => p[1]);
    f = { d, fin: d.fin, zone: d.zone, q: d.finQuad, L: d.nose - d.tail, H: d.belly - d.crown, finH: Math.max(...ys) - Math.min(...ys) };
    frames.set(id, f);
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

/** SVG path of a polygon. */
export const polyPath = (poly: readonly V[]): string => (poly.length ? `M${poly.map((p) => `${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`).join('L')}Z` : '');

// ---------- the tail schemes on the fin ----------

/** Cubic Bézier sampled (excluding its start). */
function cubic(a: V, b: V, c: V, d: V, n = 12): V[] {
  const out: V[] = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]);
  }
  return out;
}

const schemeCache = new Map<string, V[][]>();
/** The scheme's second-colour areas on the fin (polygons, viewBox; drawn clipped to the fin). Solid has none. */
export function finSecondAreas(typeId: string, style: TailStyle): V[][] {
  const key = `${spriteOf(typeId)}|${style}`;
  let out = schemeCache.get(key);
  if (out) return out;
  const { q } = framesOf(typeId);
  const F = (s: number, t: number) => finAt(q, s, t);
  out = [];
  if (style === 'split') {
    // upper-rear part of the fin, gently S-curved divide
    const a = F(1.3, 0.02);
    out.push([a, ...cubic(a, F(0.85, 0.3), F(0.35, 0.5), F(-0.3, 0.8)), F(-0.4, 2), F(2, 2), F(2, 0.02)]);
  } else if (style === 'stripe') {
    // two diagonal bands rising aft across the upper fin
    const band = (t0: number, wd: number): V[] => [F(-0.4, t0 - 0.22), F(1.4, t0 + 0.2), F(1.4, t0 + 0.2 + wd), F(-0.4, t0 - 0.22 + wd)];
    out.push(band(0.62, 0.12), band(0.8, 0.055));
  } else if (style === 'sweep') {
    // swoosh hugging the leading edge from the root and rising to the tip of the trailing edge
    const s0 = F(-0.45, -0.2), s1 = F(-0.06, 0.48), tip = F(1.3, 1.05), r0 = F(0.08, 0.32);
    out.push([
      s0, ...cubic(s0, F(-0.3, 0.15), F(-0.15, 0.35), s1), ...cubic(s1, F(0.2, 0.76), F(0.6, 1.0), F(1.0, 1.25)), tip,
      ...cubic(tip, F(0.8, 0.9), F(0.35, 0.62), r0), ...cubic(r0, F(0.02, 0.18), F(-0.02, 0.05), F(-0.05, -0.2)),
    ]);
  }
  schemeCache.set(key, out);
  return out;
}

/** Is a viewBox point on the scheme's second colour of the fin? */
export const onFinSecond = (typeId: string, scheme: TailStyle, X: number, Y: number): boolean => finSecondAreas(typeId, scheme).some((p) => inPoly(p, [X, Y]));

// ---------- frame <-> viewBox ----------

/** Frame point of `side` (fractions, see StickerPlacement) to viewBox coords. */
export function frameToView(typeId: string, side: StickerSide, x: number, y: number): V {
  const { d, q, L, H } = framesOf(typeId);
  return side === 'fin' ? finAt(q, x, y) : [d.nose - x * L, d.crown + y * H];
}

/** viewBox point to the frame of `side`; the fin is the inverse bilinear map of its quad (Newton). */
export function viewToFrame(typeId: string, side: StickerSide, X: number, Y: number): V {
  const { d, q, L, H } = framesOf(typeId);
  if (side === 'fuselage') return [(d.nose - X) / L, (Y - d.crown) / H];
  let t = (Y - q[0][1]) / ((q[2][1] + q[3][1]) / 2 - q[0][1] || 1);
  const r0 = lerp(q[0][0], q[2][0], t), r1 = lerp(q[1][0], q[3][0], t);
  let s = (X - r0) / (r1 - r0 || 1);
  for (let k = 0; k < 8; k++) {
    const p = finAt(q, s, t);
    const ds: V = [lerp(q[1][0] - q[0][0], q[3][0] - q[2][0], t), lerp(q[1][1] - q[0][1], q[3][1] - q[2][1], t)];
    const dt: V = [lerp(q[2][0] - q[0][0], q[3][0] - q[1][0], s), lerp(q[2][1] - q[0][1], q[3][1] - q[1][1], s)];
    const ex = X - p[0], ey = Y - p[1];
    const det = ds[0] * dt[1] - ds[1] * dt[0];
    if (!det) break;
    s += (ex * dt[1] - ey * dt[0]) / det;
    t += (ds[0] * ey - ds[1] * ex) / det;
  }
  return [s, t];
}

/** Airframe part under a viewBox point: the fin first, then the fuselage sticker zone (clear of wing and engines). */
export function sideAt(typeId: string, X: number, Y: number): StickerSide | null {
  const f = framesOf(typeId);
  if (inPoly(f.fin, [X, Y])) return 'fin';
  if (inPoly(f.zone, [X, Y])) return 'fuselage';
  return null;
}

/** Clip outlines [fuselage sticker zone, fin] as SVG paths in viewBox coords. */
export function airframeClipPaths(typeId: string): string[] {
  const f = framesOf(typeId);
  return [polyPath(f.zone), polyPath(f.fin)];
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

/** x-interval where every horizontal line of the band [y0, y1] is inside the polygon, following the span nearest x. */
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

/** Largest rectangle of aspect ~`aspect` (w/h) inside the polygon, vertically centred on the anchor; margin `m`. */
function fitRect(poly: readonly V[], a: V, aspect: number, m: number, maxH: number): Rect | null {
  const tryAt = (p: V): Rect | null => {
    let best: Rect | null = null, score = 0;
    for (let k = 1; k <= 48; k++) {
      const h = (maxH * k) / 48;
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
  const c: V = [poly.reduce((s, v) => s + v[0], 0) / poly.length, poly.reduce((s, v) => s + v[1], 0) / poly.length];
  for (let k = 1; k <= 10 && !r; k++) r = tryAt([lerp(a[0], c[0], k / 10), lerp(a[1], c[1], k / 10)]);
  return r;
}

const chordAt = (q: readonly [V, V, V, V], t: number) => Math.hypot(finAt(q, 1, t)[0] - finAt(q, 0, t)[0], finAt(q, 1, t)[1] - finAt(q, 0, t)[1]);

/** v0.5 letter size of the fin code for a scheme (cap on the auto size). */
function codeCap(typeId: string, scheme: TailStyle): number {
  const { q, finH } = framesOf(typeId);
  const [, t] = CODE_ANCHOR[scheme] ?? CODE_ANCHOR.sweep;
  return Math.min(finH * (CODE_SIZE[scheme] ?? 0.4), chordAt(q, t) * 0.62);
}

/** Share of a rect on the scheme's second-colour fin area (9 × 5 samples). */
function secondShare(typeId: string, scheme: TailStyle, r: Rect): number {
  const polys = finSecondAreas(typeId, scheme);
  if (!polys.length) return 0;
  let k = 0;
  for (let i = 0; i < 9; i++) for (let j = 0; j < 5; j++) {
    const p: V = [r.cx + (i / 8 - 0.5) * r.w, r.cy + (j / 4 - 0.5) * r.h];
    if (polys.some((x) => inPoly(x, p))) k++;
  }
  return k / 45;
}

const insets = new Map<string, Rect | null>();
function finRect(typeId: string, scheme: TailStyle, aspect: number, capH = Infinity): Rect | null {
  const key = `${spriteOf(typeId)}|${scheme}|${aspect.toFixed(3)}|${capH.toFixed(3)}`;
  if (insets.has(key)) return insets.get(key)!;
  const { fin, q, finH } = framesOf(typeId);
  const [s, t] = CODE_ANCHOR[scheme] ?? CODE_ANCHOR.sweep;
  const a = finAt(q, s, t);
  const chord = chordAt(q, t);
  // + dy moves toward the tip (up the screen)
  const at = (dy: number) => fitRect(fin, [a[0], a[1] - dy * finH], aspect, chord * 0.04, finH * 0.9);
  let r = at(0);
  const size = (x: Rect | null) => (x ? Math.min(x.w / aspect, x.h) : 0);
  for (const dy of [0.06, -0.06, 0.12, -0.12]) {
    const o = at(dy);
    if (size(o) > size(r) * (1.12 + Math.abs(dy))) r = o;
  }
  // letters straddling the scheme's colour divide read on neither side: move off it when that keeps most of the size
  const straddles = (x: Rect | null) => {
    if (!x) return false;
    const h = Math.min(x.h, x.w / aspect, capH), v = secondShare(typeId, scheme, { cx: x.cx, cy: x.cy, w: h * aspect, h });
    return v > 0.04 && v < 0.96;
  };
  if (straddles(r)) {
    let best: Rect | null = null;
    for (const dy of [-0.06, 0.06, -0.12, 0.12, -0.18, 0.18, -0.24]) {
      const o = at(dy);
      if (!straddles(o) && size(o) >= size(r) * 0.6 && size(o) > size(best)) best = o;
    }
    if (best) r = best;
  }
  insets.set(key, r);
  return r;
}

/** Biggest square inside the fin (any height between 20 % and 65 % of it): the auto tail logo, whatever the scheme. */
function logoRect(typeId: string): Rect | null {
  const key = `${spriteOf(typeId)}|logo`;
  if (insets.has(key)) return insets.get(key)!;
  const { fin, q, finH } = framesOf(typeId);
  let r: Rect | null = null;
  for (let t = 0.2; t <= 0.651; t += 0.05) {
    const o = fitRect(fin, finAt(q, 0.5, t), 1, chordAt(q, t) * 0.04, finH * 0.9);
    if (o && (!r || Math.min(o.w, o.h) > Math.min(r.w, r.h) * 1.02)) r = o;
  }
  insets.set(key, r);
  return r;
}

/** viewBox rectangle wholly inside the fin outline around the scheme's code anchor (4 % chord margin). */
export function finInset(typeId: string, scheme: TailStyle, aspect = 2): Rect {
  const r = finRect(typeId, scheme, aspect);
  if (r) return r;
  const c = finAt(framesOf(typeId).q, 0.5, 0.4);
  return { cx: c[0], cy: c[1], w: 0, h: 0 };
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

/** The title band (viewBox): nose-side start x of the ink, centre line, longest run, letter size. */
export function titleBand(typeId: string): { x: number; y: number; w: number; size: number } {
  const { d } = framesOf(typeId);
  return { x: d.nose - d.titles.x, y: d.titles.y, w: d.titles.w, size: d.titles.size };
}

/**
 * Boxes for every sticker the livery draws on this type, in draw order (viewBox coords).
 * Scale 1 at the auto position fits its zone: the code and a fin logo inside the fin inset,
 * titles inside the title band. Anything bigger or moved is clipped by the renderer.
 */
export function stickerLayout(typeId: string, lv: Livery, defaults: StickerTexts, detail: 'full' | 'simple' = 'full'): StickerBox[] {
  const { q, L, H } = framesOf(typeId);
  const scheme = lv.tail;
  const cap = codeCap(typeId, scheme);
  const fallback = cap * 0.5;
  const band = titleBand(typeId);
  const bandCap = band.size * textInkEm('H').asc;
  const out: StickerBox[] = [];
  /** Tail-side end of the auto titles' ink (viewBox x), for an auto fuselage logo aft of them. */
  let titlesEnd = band.x;
  const list = stickersOf(lv).slice(0, 6);
  const order = [...list].sort((a, b) => (a.kind === 'titles' ? 0 : 1) - (b.kind === 'titles' ? 0 : 1));
  const boxes = new Map<string, StickerBox>();
  const anchor = finAt(q, 0.5, 0.42);
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
        c = r ? [r.cx, r.cy] : anchor;
      } else {
        side = Math.min(H * 0.42, bandCap * 2.2);
        c = [Math.max(titlesEnd - side * 0.9, band.x - L * 0.7 + side), band.y];
      }
      side *= scale;
      if (detail === 'simple' && st.side === 'fuselage' && side < L * MINI_LOGO) continue;
      const p = at ? pullOn(typeId, st, { cx: at[0], cy: at[1], w: side, h: side, rot }) : c;
      boxes.set(st.id, { id: st.id, kind: 'logo', side: st.side, cx: p[0], cy: p[1], w: side, h: side, rot });
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
      const r = finRect(typeId, scheme, wEm / hEm, st.kind === 'code' ? cap * hEm : Infinity);
      fs = r ? Math.min(r.h / hEm, r.w / wEm, st.kind === 'code' ? cap : Infinity) : fallback;
      c = r ? [r.cx, r.cy] : anchor;
    } else {
      // titles (and a code moved to the fuselage): title-band letters, starting behind the forward door
      fs = Math.min(band.size, band.w / wEm);
      c = [band.x - (fs * wEm) / 2, band.y];
    }
    if (st.kind === 'titles' && st.side === 'fuselage' && !custom) titlesEnd = band.x - fs * wEm;
    fs *= scale;
    const p = at ? pullOn(typeId, st, { cx: at[0], cy: at[1], w: fs * wEm, h: fs * hEm, rot }) : c;
    boxes.set(st.id, {
      id: st.id, kind: st.kind, side: st.side, cx: p[0], cy: p[1], w: fs * wEm, h: fs * hEm, rot,
      fontSize: fs, text, baseline: ((ink.asc - ink.desc) / 2) * fs, weight, spacing,
    });
  }
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

/** nu × nv sample points spread over a (rotated) box, corners included; viewBox coords. */
export function boxSamples(b: Pick<StickerBox, 'cx' | 'cy' | 'w' | 'h' | 'rot'>, nu: number, nv: number): V[] {
  const r = (b.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const out: V[] = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const x = (i / (nu - 1) - 0.5) * b.w, y = (j / (nv - 1) - 0.5) * b.h;
    out.push([b.cx + x * c - y * s, b.cy + x * s + y * c]);
  }
  return out;
}

/** Share of a box on the airframe (fin or fuselage zone): what survives the renderer's clip. */
export function visibleShare(typeId: string, b: Pick<StickerBox, 'cx' | 'cy' | 'w' | 'h' | 'rot'>): number {
  const pts = boxSamples(b, 9, 5);
  return pts.filter(([X, Y]) => sideAt(typeId, X, Y)).length / pts.length;
}

/** A placed sticker keeps at least this share on the airframe; less and the layout pulls it back on. */
export const MIN_VISIBLE = 0.5;

/** Centre for a placed box that is mostly off the airframe: walked toward the middle of its side until enough shows. */
function pullOn(typeId: string, st: StickerPlacement, b: Pick<StickerBox, 'cx' | 'cy' | 'w' | 'h' | 'rot'>): V {
  if (visibleShare(typeId, b) >= MIN_VISIBLE) return [b.cx, b.cy];
  const x = clamp(st.x ?? 0.5, 0.1, 0.9), y = clamp(st.y ?? 0.5, 0.15, 0.85);
  const fi = st.side === 'fin' ? finInset(typeId, 'solid') : undefined;
  const band = titleBand(typeId);
  const mid: V = fi ? [fi.cx, fi.cy] : [band.x - band.w / 2, band.y];
  let from: V = [b.cx, b.cy];
  for (const goal of [st.side === 'fin' ? frameToView(typeId, 'fin', 0.5, y) : frameToView(typeId, 'fuselage', x, 0.3), mid]) {
    const at = (k: number): V => [lerp(from[0], goal[0], k), lerp(from[1], goal[1], k)];
    const ok = (k: number) => { const p = at(k); return visibleShare(typeId, { ...b, cx: p[0], cy: p[1] }) >= MIN_VISIBLE; };
    if (ok(1)) {
      let lo = 0, hi = 1;
      for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
      return at(hi);
    }
    from = goal;
  }
  return mid;
}

/** Placement for a sticker whose centre is dragged to viewBox (X, Y): the side under it (else its old side), frame coords clamped 0–1. */
export function placeAt(typeId: string, st: StickerPlacement, X: number, Y: number): StickerPlacement {
  const side = sideAt(typeId, X, Y) ?? st.side;
  const [x, y] = viewToFrame(typeId, side, X, Y);
  const r = (v: number) => Math.round(clamp(v, 0, 1) * 1e4) / 1e4;
  return { ...st, side, x: r(x), y: r(y) };
}

/** Snap lines (viewBox): fin inset centre and fin mid-point; fuselage title band line, window line and mid-length. */
export function snapTargets(typeId: string, side: StickerSide): { x: number[]; y: number[] } {
  const { d, q, L } = framesOf(typeId);
  if (side === 'fin') {
    const r = finInset(typeId, 'solid');
    const mid = finAt(q, 0.5, 0.5);
    return { x: [r.cx, mid[0]], y: [r.cy, mid[1]] };
  }
  const y = [d.titles.y];
  if (d.win) y.push((d.win[0] + d.win[1]) / 2);
  return { x: [d.nose - L / 2], y };
}

// ---------- v0.11 painted markings beyond the stickers ----------

/** A small text decal: its box from the right (nose-side) end or the centre, ink by the paint under it. */
function smallText(typeId: string, lv: Livery, id: 'reg' | 'model', text: string, cap: number, weight: FontWeight, at: { x: number; base: number; anchor: 'centre' | 'nose' }, color?: string): Decal {
  const em = textInkEm(text);
  const fs = cap / Math.max(0.5, em.asc);
  const sp = 0.04;
  const wd = textWidthEm(text, weight, sp) * fs;
  const cx = at.anchor === 'centre' ? at.x : at.x - wd / 2;
  const ground = bodyColourAt(typeId, lv, cx, at.base - cap / 2);
  const auto = lum(ground) > 0.45 ? INK : '#ffffff';
  // the asked colour where it reads on the paint under it, else ink or white
  const ink = color && contrast(color, ground) >= 2.2 ? color : auto;
  return { id, kind: 'reg', side: 'fuselage', cx, cy: at.base - cap / 2, w: wd, h: cap, rot: 0, text, fontSize: fs, baseline: cap / 2, weight, spacing: sp, ink };
}

/** Is the paint under a text box (plus a margin) one colour? (No split line, stripe or band edge through it.) */
function clearBand(typeId: string, lv: Livery, cx: number, cy: number, w: number, h: number, margin = 1): boolean {
  const mx = 0.2 * h * margin, my = 0.25 * h * margin;
  let first: string | null = null;
  // rows at most 2 px apart: a thin split line must not slip between them
  const rows = Math.max(4, Math.ceil((h + 2 * my) / 2));
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= rows; j++) {
      const c = bodyColourAt(typeId, lv, cx - w / 2 - mx + ((w + 2 * mx) * i) / 10, cy - h / 2 - my + ((h + 2 * my) * j) / rows);
      if (first === null) first = c;
      else if (c !== first) return false;
    }
  }
  return true;
}

/** Narrowbodies carry the registration above the windows aft of the last door; the 787 below the windows (its
 *  usual marking), other widebodies above them, just forward of the last door (RESEARCH.md, livery markings). */
const NARROW = new Set(['a320ceo', 'a321ceo', 'a321neo', 'a321neo-classic-doors', 'b738', 'b739', 'b752', 'b753']);
const BELOW_WINDOWS = new Set(['b788', 'b789', 'b78x']);

/** Is a box inside the fuselage sticker zone (clear of the wing where it crosses the fuselage, and of the engines)? */
function inZone(typeId: string, b: { cx: number; cy: number; w: number; h: number }): boolean {
  const z = layoutOf(typeId).zone as V[];
  // with a margin: the wing's drawn edge must not touch the text
  const w = b.w + 0.6 * b.h, h = 2.2 * b.h;
  return [[-1, -1], [0, -1], [1, -1], [1, 1], [0, 1], [-1, 1], [0, 0]].every(([u, v]) => inPoly(z, [b.cx + (u * w) / 2, b.cy + (v * h) / 2]));
}

/** The first candidate (baselines, then sideways shifts of up to 2.5 text widths) where the text sits on one colour
 *  and inside the fuselage zone (never over the wing); else the first. */
/** The ink of a small text where it finally sits: the asked colour when it reads on the paint there, else ink/white. */
function reink(typeId: string, lv: Livery, t: Decal, color?: string): Decal {
  const ground = bodyColourAt(typeId, lv, t.cx, t.cy);
  const auto = lum(ground) > 0.45 ? INK : '#ffffff';
  return { ...t, ink: color && contrast(color, ground) >= 2.2 ? color : auto };
}

/** Does a small text cross unpainted airframe drawn over the tube (a wing, a winglet, the stabiliser)? */
function onBare(typeId: string, b: { cx: number; cy: number; w: number; h: number }): boolean {
  const d = layoutOf(typeId);
  if (!d.bare || !d.win) return false;
  const spans = b.cy < d.win[0] ? d.bare.above : b.cy > d.win[1] ? d.bare.below : [...d.bare.above, ...d.bare.below];
  const x0 = b.cx - b.w / 2 - 0.3 * b.h, x1 = b.cx + b.w / 2 + 0.3 * b.h;
  const y0 = b.cy - b.h / 2 - 0.25 * b.h, y1 = b.cy + b.h / 2 + 0.25 * b.h;
  return spans.some(([a, c, top, bottom]) => c >= x0 && a <= x1 && bottom >= y0 && top <= y1);
}

/** Does a small text cover the last passenger door (its frame and a little air either side)? */
function onDoor(typeId: string, b: { cx: number; w: number }): boolean {
  const d = layoutOf(typeId);
  if (!d.door) return false;
  const pad = 0.15 * (d.win ? d.win[1] - d.win[0] + 1 : 12);
  return b.cx + b.w / 2 > d.door[0] - pad && b.cx - b.w / 2 < d.door[1] + pad;
}

/** Where a small text can go: on one colour, inside the fuselage zone, off the wing, the stabiliser and the last door. */
function fits(typeId: string, lv: Livery, u: Decal, zone: boolean, margin: number, avoid: Decal[] = []): boolean {
  const pad = 0.5 * u.h;
  const hits = avoid.some((a) => Math.abs(a.cx - u.cx) < (a.w + u.w) / 2 + pad && Math.abs(a.cy - u.cy) < (a.h + u.h) / 2 + 0.2 * u.h);
  return !hits && (!zone || inZone(typeId, u)) && !onBare(typeId, u) && !onDoor(typeId, u) && clearBand(typeId, lv, u.cx, u.cy, u.w, u.h, margin);
}

/** The first candidate (baselines, then sideways shifts of up to 2.5 text widths, the asked way first, then the
 *  other) where the text fits; undefined when none does. */
function placeClearOr(typeId: string, lv: Livery, make: (base: number) => Decal, bases: number[], shiftDir = -1, zone = true, color?: string, both = true, avoid: Decal[] = []): Decal | undefined {
  if (!bases.length) return undefined;
  const w0 = make(bases[0]).w;
  // with a margin first; a tight band between two lines without
  for (const dir of both ? [shiftDir, -shiftDir] : [shiftDir]) {
    for (const margin of [1, 0]) {
      for (let k = dir === shiftDir ? 0 : 0.25; k <= 2.5; k += 0.25) {
        for (const b of bases) {
          const t = make(b);
          const u = { ...t, cx: t.cx + dir * k * w0 };
          if (fits(typeId, lv, u, zone, margin, avoid)) return reink(typeId, lv, u, color);
        }
      }
    }
  }
  return undefined;
}

function placeClear(typeId: string, lv: Livery, make: (base: number) => Decal, bases: number[], shiftDir = -1, zone = true, color?: string, both = true, avoid: Decal[] = []): Decal {
  return placeClearOr(typeId, lv, make, bases, shiftDir, zone, color, both, avoid) ?? reink(typeId, lv, make(bases[0] ?? 0), color);
}

/**
 * Markings real aircraft carry beyond the livery's stickers, painted (decals): the registration (small, just above
 * the window line over the fin's root leading edge, aft of the rear door; the registry state's flag on its tail
 * side), the model ("BOEING 777-300ER", under the forward windows aft of door 1, or under the rear windows), and the
 * logo on each cowl (`body.engineLogo`) and under the cockpit (`body.noseLogo`). `fine` = the big asset: the small
 * texts are drawn only there (on the small one they would be mush). Viewbox boxes for compose.ts.
 */
const extraCache = new Map<string, Decal[]>();
export function extraDecals(typeId: string, lv: Livery, opt: { reg?: string; model?: string; name?: string; fine: boolean }): Decal[] {
  // placement samples the paint under many points: kept per type, markings and the paint they depend on (moving a
  // sticker in the editor does not change it)
  const key = JSON.stringify([typeId, opt, lv.plain, lv.primary, lv.secondary, lv.tail, lv.body, lv.reg, lv.model, lv.titles?.color, !!lv.logo]);
  let hit = extraCache.get(key);
  if (!hit) {
    hit = extraDecalsOf(typeId, lv, opt);
    extraCache.set(key, hit);
    while (extraCache.size > 64) extraCache.delete(extraCache.keys().next().value as string);
  }
  return hit;
}

function extraDecalsOf(typeId: string, lv: Livery, opt: { reg?: string; model?: string; name?: string; fine: boolean }): Decal[] {
  const d = layoutOf(typeId);
  const out: Decal[] = [];
  const D = Math.max(1, d.belly - d.crown);
  const L = d.nose - d.tail;
  const win = d.win ?? [d.crown + 0.35 * D, d.crown + 0.42 * D];
  const winH = win[1] - win[0] + 1;
  const finLE = d.finQuad[0][0];
  const narrow = NARROW.has(spriteOf(typeId));
  const below = BELOW_WINDOWS.has(spriteOf(typeId));
  // the last door (measured from the art; else about where it sits: just ahead of the fin's root leading edge)
  const door: [number, number] = d.door ?? [finLE - 0.5 * winH, finLE + 2.2 * winH];
  const regCap = (narrow ? 1.0 : 1.15) * winH;
  const modelCap = 0.55 * winH;
  const lineAbove = win[0] - 0.5 * winH;
  const lineBelow = win[1] + 0.75 * winH + regCap;
  const base0 = below ? lineBelow : lineAbove;
  /** A small text with one end at x ('tail' = its aft end at x, 'nose' = its forward end at x). */
  const textAt = (id: 'reg' | 'model', text: string, cap: number, end: 'tail' | 'nose', x: number, color?: string) => (base: number): Decal => {
    const t = smallText(typeId, lv, id, text, cap, 500, { x, base, anchor: 'centre' }, color);
    return { ...t, cx: end === 'tail' ? x + t.w / 2 : x - t.w / 2 };
  };
  const steps = (b: number, dir: number) => Array.from({ length: 16 }, (_, k) => k).map((k) => b + dir * k * 0.25 * regCap).filter((y) => y - regCap > d.crown + 0.05 * D && y < d.crown + 0.85 * D);
  const r = opt.reg?.trim().toUpperCase();
  // the registry state's flag: flat artwork at the registration's cap height, in its own proportion
  const cc = r && !lv.reg?.noFlag ? countryOfReg(r) : '';
  const fl = cc && flagUrl(cc) ? cc : '';
  const flagW = (fl ? flagRatio(fl) : 1.5) * regCap;
  // the stabiliser's forward edge (measured from the art; else about 0.4 of the fin's root chord), with a gap
  const stabX = (d.stab ?? d.finQuad[1][0] + 0.4 * (d.finQuad[0][0] - d.finQuad[1][0])) + 0.4 * winH;
  let reg: Decal | undefined;
  // how far the model moves forward for a flag forward of the door
  let flagFwd = 0;
  if (opt.fine && r && !lv.reg?.hide) {
    if (lv.reg?.at === 'fin') {
      // on the lower fin, over its root
      const [x, y] = finPoint(d, 0.5, 0.06);
      const cap = 1.3 * winH;
      const ink = lv.reg.color ?? (lum(lv.plain ? '#ffffff' : lv.primary) > 0.45 ? INK : '#ffffff');
      reg = { ...smallText(typeId, lv, 'reg', r, cap, 500, { x, base: y, anchor: 'centre' }, ink), ink };
    } else if (narrow) {
      // narrowbodies: above the windows, just aft of the last door
      reg = placeClear(typeId, lv, textAt('reg', r, regCap, 'nose', door[0] - 0.7 * winH, lv.reg?.color), steps(base0, -1), -1, true, lv.reg?.color, false);
      // clear of the stabiliser: a little closer to the door when the space between them is short
      const over = stabX - 0.2 * winH - (reg.cx - reg.w / 2);
      if (over > 0 && reg.cx + reg.w / 2 + over <= door[0] - 0.25 * winH && clearBand(typeId, lv, reg.cx + over, reg.cy, reg.w, reg.h, 0)) reg = reink(typeId, lv, { ...reg, cx: reg.cx + over }, lv.reg?.color);
    } else {
      // widebodies: just forward of the last door (with the flag between), above the windows (below on the 787);
      // aft of the door when no clean spot is forward (a tail wrap meeting the wing)
      // (the 787's sticker zone stops under its raked wingtip at the crown; below the windows it is clear)
      reg = placeClear(typeId, lv, textAt('reg', r, regCap, 'tail', door[1] + 0.9 * winH + (fl ? flagW + 0.5 * regCap : 0), lv.reg?.color), steps(base0, below ? 1 : -1), 1, !below, lv.reg?.color);
    }
    out.push(reg);
    if (fl) {
      // on its tail side; on its nose side when the stabiliser is there (or none, when the door is too)
      const f = { id: 'flag', kind: 'flag' as const, side: 'fuselage' as const, cx: reg.cx - reg.w / 2 - 0.45 * reg.h - flagW / 2, cy: reg.cy, w: flagW, h: reg.h, rot: 0, text: fl };
      const g = { ...f, cx: reg.cx + reg.w / 2 + 0.45 * reg.h + flagW / 2 };
      const regAft = reg.cx < door[0];
      const okFlag = (x: Decal) => !onBare(typeId, x) && !onDoor(typeId, x) && clearBand(typeId, lv, x.cx, x.cy, x.w, x.h, 0) && (!regAft || x.cx - flagW / 2 > stabX);
      const room = f.cx - flagW / 2 - stabX;
      if (lv.reg?.at === 'fin' || okFlag(f)) out.push(f);
      else if (okFlag(g)) out.push(g);
      else if (narrow && reg.cx + reg.w / 2 - room <= door[0] - 0.25 * winH && clearBand(typeId, lv, reg.cx - room, reg.cy, reg.w, reg.h, 0) && clearBand(typeId, lv, f.cx - room, f.cy, f.w, f.h, 0)) {
        // a little closer to the door, so the flag clears the stabiliser
        const moved = reink(typeId, lv, { ...reg, cx: reg.cx - room }, lv.reg?.color);
        out[out.indexOf(reg)] = moved;
        reg = moved;
        out.push({ ...f, cx: f.cx - room });
      } else if (narrow) {
        // no room beside it (short space between the stabiliser and the door): just above it over its forward end,
        // else just forward of the door at its height
        const up = { ...f, cx: reg.cx + reg.w / 2 - flagW / 2, cy: reg.cy - 1.4 * reg.h };
        const fwd = { ...f, cx: door[1] + 0.6 * winH + flagW / 2 };
        if (up.cy - up.h / 2 > d.crown + 0.05 * D && okFlag(up)) out.push(up);
        else if (okFlag(fwd)) {
          out.push(fwd);
          flagFwd = flagW + 0.6 * winH;
        }
      }
    }
  }
  // on light paint a hairline round the flag (painted only where the flag's own edge is light, e.g. Japan's)
  const fd = out.find((x) => x.id === 'flag');
  if (fd && lum(lv.reg?.at === 'fin' ? (lv.plain ? '#ffffff' : lv.primary) : bodyColourAt(typeId, lv, fd.cx, fd.cy)) > 0.6) fd.ink = '#7d8590';
  // the model: small, by the registration as the type is usually marked
  if (opt.fine && opt.model && lv.model !== 'off' && !lv.plain) {
    const titleInk = lv.titles?.color;
    if (lv.model === 'forward') {
      const fwd = Array.from({ length: 12 }, (_, k) => win[1] + 1.6 * winH + modelCap + k * 0.6 * modelCap).filter((y) => y < d.crown + 0.8 * D);
      out.push(placeClear(typeId, lv, (base) => smallText(typeId, lv, 'model', opt.model!, modelCap, 500, { x: d.nose - 0.17 * L, base, anchor: 'nose' }, titleInk), fwd, -1, true, titleInk));
    } else {
      const base = reg && lv.reg?.at !== 'fin' ? reg.cy + reg.h / 2 : base0;
      let make: (b: number) => Decal, dir: number;
      if (narrow || (reg && lv.reg?.at !== 'fin' && reg.cx < door[0])) { make = textAt('model', opt.model, modelCap, 'tail', door[1] + 0.7 * winH + flagFwd, titleInk); dir = 1; }
      else if (below && reg && lv.reg?.at !== 'fin') { make = textAt('model', opt.model, modelCap, 'tail', reg.cx + reg.w / 2 + 1.0 * regCap, titleInk); dir = 1; }
      else { make = textAt('model', opt.model, modelCap, 'nose', door[0] - 0.9 * winH, titleInk); dir = -1; }
      // on the registration's side of the window row, never on it
      const ok = (y: number) => (below ? y - modelCap >= win[1] + 0.3 * winH : y <= win[0] - 0.3 * winH) && y - modelCap > d.crown + 0.04 * D && y < d.crown + 0.85 * D;
      out.push(placeClear(typeId, lv, make, [0, -0.5, 0.5, -1, 1, -1.5, -2].map((k) => base + k * regCap).filter(ok), dir, !below, titleInk, true, out.filter((x) => x.id === 'reg' || x.id === 'flag')));
    }
  }
  // the fleet number at the top of the fin (the registration's last letters or digits)
  if (opt.fine && r && lv.reg?.fleet) {
    const num = r.replace(/[^A-Z0-9]/g, '').slice(-3);
    const [x, y] = finPoint(d, 0.62, 0.9);
    const cap = 0.9 * winH;
    const ground = !lv.plain && onFinSecond(typeId, lv.tail, x, y) ? lv.secondary : lv.plain ? '#ffffff' : lv.primary;
    const ink = lum(ground) > 0.45 ? INK : '#ffffff';
    out.push({ ...smallText(typeId, lv, 'reg', num, cap, 500, { x, base: y + cap / 2, anchor: 'centre' }, ink), id: 'fleet', ink });
  }
  if (lv.logo && !lv.plain) {
    if (lv.body?.engineLogo) {
      for (const [aft, front, , top, Dn] of d.eng ?? []) {
        if (!Dn) continue;
        const side = 0.34 * Dn;
        out.push({ id: `elogo${aft}`, kind: 'logo', side: 'fuselage', cx: aft + 0.52 * (front - aft), cy: top + 0.42 * Dn, w: side, h: side, rot: 0, on: 'cowl' });
      }
    }
    if (lv.body?.noseLogo) {
      const x = d.nose - 0.62 * D;
      const side = 0.15 * D;
      out.push({ id: 'nlogo', kind: 'logo', side: 'fuselage', cx: x, cy: win[1] + 0.6 * side, w: side, h: side, rot: 0 });
    }
  }
  // v0.10.2 the aircraft's name, as airlines paint it: small, under the cockpit windows, in the titles' ink, from just
  // aft of the radome; clear of the nose logo, the model and door 1 (moved aft, then lower, when it must)
  const acName = opt.name?.trim();
  if (opt.fine && acName && !lv.reg?.noName) {
    const cap = 0.62 * winH;
    const x0 = d.nose - Math.max(0.05 * L, 0.55 * D);
    const inTube = (u: Decal) => [u.cx - u.w / 2, u.cx + u.w / 2].every((x) => {
      const t = tubeAt(d, x);
      return !!t && u.cy - u.h / 2 > t[0] + 0.12 * (t[1] - t[0]) && u.cy + u.h / 2 < t[1] - 0.15 * (t[1] - t[0]);
    });
    const bases = [0.55, 0.85, 1.15, 1.5].map((k) => win[1] + k * winH + cap);
    const make = (base: number) => ({ ...smallText(typeId, lv, 'model', acName, cap, 500, { x: x0, base, anchor: 'nose' }, lv.titles?.color), id: 'acname' });
    const avoid = out.filter((x) => x.on !== 'cowl' && x.side === 'fuselage');
    let best: Decal | undefined;
    for (let k = 0; k <= 12 && !best; k++) {
      for (const b of bases) {
        const t = make(b);
        const u = { ...t, cx: t.cx - k * 0.25 * winH * 2 };
        if (inTube(u) && fits(typeId, lv, u, false, 0, avoid)) { best = reink(typeId, lv, u, lv.titles?.color); break; }
      }
    }
    if (best) out.push(best);
  }
  return out;
}
