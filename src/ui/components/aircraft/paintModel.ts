// v0.11 painting model: livery paint laid over the sprite as an illustrator paints a side-view template (multiply
// over the white art, then gloss), so it reads as painted, not pasted. Pure (typed arrays in, typed arrays out);
// compose.ts does the canvas work.
//
// Per paint region (fin, body, cowl) the white art is split into
//   - a smooth light S (scripts/sprites.py shading_field: the fuselage a fitted cylinder, fin and cowls a blur inside
//     the region), over the region's lit white;
//   - the drawn detail (detailOf): panel lines, door and window outlines, aerials -- the art's grain left out.
// A painted pixel = paint × S (a plain multiply: the template's own soft light) × the detail (soft-thresholded), dark
// lines pressed in a little on dark paint so they still read, then the gloss screened on (glossOf: a reflection band
// along the upper fuselage with a soft top and a hard lower edge, a diagonal reflection on the fin with one hard edge,
// a soft highlight on the cowls) -- white paint barely changes, dark paint gets a clear sheen. Windows stay black
// (the detail keeps them). White paint gives back the art exactly. Text and logos are drawn into the paint before
// this, so they get the same light, lines, gloss and edges.

/** Paint regions in the mask: R fin, G fuselage (body), B engine cowls. */
export const REGIONS = 3;

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const s = i / 255;
  SRGB_TO_LIN[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
const LIN_N = 4096;
const LIN_TO_SRGB = new Float32Array(LIN_N + 1);
for (let i = 0; i <= LIN_N; i++) {
  const l = i / LIN_N;
  LIN_TO_SRGB[i] = 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
}
export const toLin = (v: number): number => SRGB_TO_LIN[v & 255];
export const toSrgb = (l: number): number => LIN_TO_SRGB[Math.round(Math.min(1, Math.max(0, l)) * LIN_N)];

/** Lighting constants (tuned against professional side-view livery art). */
export const LIGHT = {
  /** Dark detail pressed into dark paint (sRGB levels at full darkness of the line). */
  detail: 30,
  /** Detail amplitude (share of the light) below which the art's texture is noise, not a drawn line. */
  grain: 0.05,
  /** Strongest glint screened onto dark paint (linear). */
  glintMax: 0.025,
  /** How much of the drawn detail a decal hides (0 none … 1 all). */
  decalFade: 0.6,
  /** Grey closing and blur radii at the 2048 asset (scaled with the width). */
  close: 6,
  blur: 4,
} as const;

/** Gloss (screened white, 0..1): the fuselage band, the fin reflection, the cowl highlight. */
export const GLOSS = {
  /** Fuselage band: hard lower edge this far above the window tops (share of the tube), soft top over `soft`. */
  bodyGap: 0.05,
  bodySoft: 0.24,
  body: 0.22,
  /** Fin: a hard diagonal edge at chord s = cut0 (root) … cut1 (tip), fading aft over `fade` of the chord. */
  finCut0: 0.42,
  finCut1: 0.28,
  finFade: 0.42,
  fin: 0.1,
  /** Cowl: a soft band at 28 % of the nacelle height, sigma 9 %. */
  cowlAt: 0.28,
  cowlSigma: 0.09,
  cowl: 0.3,
} as const;

/** Per-sprite, per-width lighting: the art's luminance and its smooth shading, per region (fin, body, cowl) over
 *  that region's own lit white (the fin is drawn a little greyer than the fuselage; one paint must look one colour).
 *  Made once at build time (scripts/sprites.py: <id>-shade.webp + `white` in the data) or here (shadingOf). */
export interface Shading {
  w: number;
  h: number;
  /** Luminance of the art, linear. */
  y: Float32Array;
  /** Smooth shading over the region's white (1 = lit white), the regions joined by coverage. */
  n: Float32Array;
  /** The drawn detail, clean (detailOf): + darker than the light (lines, doors, windows), − brighter (glints). */
  d: Float32Array;
  /** Each region's lit white (97th percentile of its shading), linear. */
  white: [number, number, number];
  /** Gloss to screen on, per pixel (glossOf); absent = none. */
  g?: Float32Array;
}

/** Encoded range of the shipped shading field (scripts/sprites.py SHADE_MAX). */
export const SHADE_MAX = 1.25;

/** The art's linear luminance. */
export function lumaOf(px: Uint8ClampedArray, n: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    y[i] = 0.2126 * SRGB_TO_LIN[px[j]] + 0.7152 * SRGB_TO_LIN[px[j + 1]] + 0.0722 * SRGB_TO_LIN[px[j + 2]];
  }
  return y;
}

/** Shading from the shipped field (grey RGBA scaled to the art's size), the mask and the data's whites. */
export function shadingFromField(px: Uint8ClampedArray, m: Uint8ClampedArray, field: Uint8ClampedArray, w: number, h: number, white: [number, number, number]): Shading {
  const n = w * h, f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = (field[i * 4] / 255) * SHADE_MAX;
  const y = lumaOf(px, n);
  return { w, h, y, n: f, d: detailOf(y, f, m, w, h, white), white };
}

/**
 * The drawn detail, clean: the art against its light (1 − Y / light, per pixel over its region's white), then split
 * into what is sharp (minus a ~2-px blur: panel lines, door and window outlines, aerials) and what is soft (the
 * sprite's airbrush streaks and compression blotches). Strong features (windows, doors' dark gaps; |dev| ≥ 0.35)
 * keep everything; weaker ones keep only the sharp part. The soft threshold (LIGHT.grain) is applied when painting.
 */
export function detailOf(y: Float32Array, f: Float32Array, m: Uint8ClampedArray, w: number, h: number, white: [number, number, number]): Float32Array {
  const n = w * h, dev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4, r0 = m[j], r1 = m[j + 1], r2 = m[j + 2];
    if (!(r0 | r1 | r2) || !(f[i] > 0)) continue;
    const wt = r1 >= r0 && r1 >= r2 ? white[1] : r0 >= r2 ? white[0] : white[2];
    const base = f[i] * wt;
    dev[i] = 1 - y[i] / Math.max(1e-4, base);
  }
  const soft = Float32Array.from(dev), tmp = new Float32Array(n);
  const r = Math.max(1, Math.round((2 * w) / 2048));
  for (let k = 0; k < 2; k++) { box(soft, w, h, r, true, tmp); box(soft, w, h, r, false, tmp); }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.abs(dev[i]);
    const keepAll = Math.min(1, Math.max(0, (a - 0.12) / (0.35 - 0.12)));
    out[i] = keepAll * dev[i] + (1 - keepAll) * (dev[i] - soft[i]);
  }
  return out;
}

/** 1-D running max (or min) over ±r along rows (dx = 1) or columns (dx = w), in place via a scratch buffer. */
function extreme(a: Float32Array, w: number, h: number, r: number, rows: boolean, max: boolean, tmp: Float32Array): void {
  const n = rows ? w : h, m = rows ? h : w, step = rows ? 1 : w, lineStep = rows ? w : 1;
  for (let j = 0; j < m; j++) {
    const o = j * lineStep;
    for (let i = 0; i < n; i++) {
      let v = a[o + i * step];
      const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
      for (let q = lo; q <= hi; q++) {
        const u = a[o + q * step];
        if (max ? u > v : u < v) v = u;
      }
      tmp[o + i * step] = v;
    }
  }
  a.set(tmp);
}

/** Box blur ±r along rows or columns (running sum, edges clamped), in place via a scratch buffer. */
function box(a: Float32Array, w: number, h: number, r: number, rows: boolean, tmp: Float32Array): void {
  const n = rows ? w : h, m = rows ? h : w, step = rows ? 1 : w, lineStep = rows ? w : 1;
  const inv = 1 / (2 * r + 1);
  for (let j = 0; j < m; j++) {
    const o = j * lineStep;
    let s = 0;
    for (let q = -r; q <= r; q++) s += a[o + Math.min(n - 1, Math.max(0, q)) * step];
    for (let i = 0; i < n; i++) {
      tmp[o + i * step] = s * inv;
      s += a[o + Math.min(n - 1, i + r + 1) * step] - a[o + Math.max(0, i - r) * step];
    }
  }
  a.set(tmp);
}

/** Smooth shading of a region group: closing of the luminance, blurred inside the group's coverage only. */
function groupShade(y: Float32Array, cov: Float32Array, w: number, h: number, rc: number, rb: number): { s: Float32Array; white: number } {
  const n = w * h, tmp = new Float32Array(n);
  const c = Float32Array.from(y);
  extreme(c, w, h, rc, true, true, tmp);
  extreme(c, w, h, rc, false, true, tmp);
  extreme(c, w, h, rc, true, false, tmp);
  extreme(c, w, h, rc, false, false, tmp);
  const num = new Float32Array(n), den = Float32Array.from(cov);
  for (let i = 0; i < n; i++) num[i] = c[i] * cov[i];
  for (let k = 0; k < 2; k++) {
    box(num, w, h, rb, true, tmp); box(num, w, h, rb, false, tmp);
    box(den, w, h, rb, true, tmp); box(den, w, h, rb, false, tmp);
  }
  const s = new Float32Array(n);
  const hist = new Uint32Array(1025);
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    if (!(cov[i] > 0)) continue;
    const v = den[i] > 1e-4 ? num[i] / den[i] : y[i];
    s[i] = v;
    if (cov[i] > 0.5) { hist[Math.min(1024, Math.round(v * 1024))]++; cnt++; }
  }
  let white = 1;
  if (cnt) {
    let acc = 0;
    for (let b = 0; b <= 1024; b++) { acc += hist[b]; if (acc >= 0.97 * cnt) { white = Math.max(0.05, b / 1024); break; } }
  }
  return { s, white };
}

/** Shading of a sprite at a width: `px` the art (RGBA), `m` the mask (RGBA, R fin, G body, B cowl) at the same size. */
export function shadingOf(px: Uint8ClampedArray, m: Uint8ClampedArray, w: number, h: number): Shading {
  const n = w * h;
  const y = lumaOf(px, n), cov = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) if (px[i * 4 + 3]) for (let r = 0; r < 3; r++) cov[r][i] = m[i * 4 + r] / 255;
  const sc = w / 2048;
  const rc = Math.max(1, Math.round(LIGHT.close * sc)), rb = Math.max(1, Math.round(LIGHT.blur * sc));
  const g = cov.map((c) => groupShade(y, c, w, h, rc, rb));
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let num = 0, den = 0;
    for (let r = 0; r < 3; r++) { num += cov[r][i] * (g[r].s[i] / g[r].white); den += cov[r][i]; }
    f[i] = den > 0.01 ? Math.min(SHADE_MAX, num / den) : 0;
  }
  const white: [number, number, number] = [g[0].white, g[1].white, g[2].white];
  return { w, h, y, n: f, d: detailOf(y, f, m, w, h, white), white };
}

/**
 * One paint at one pixel → sRGB channel values: paint × S × the clean detail (`dev`, soft-thresholded at
 * LIGHT.grain; `fade` 0..1 keeps less under decals), dark lines pressed in a little on dark paint, glints and the
 * gloss `gl` screened on. `tint` the art's own colour cast per channel (red beacons and handles stay red).
 */
function litPixel(tint: [number, number, number], pr: number, pg: number, pb: number, S0: number, base: number, dev: number, fade: number, gl: number, out: Float32Array): void {
  const p0 = SRGB_TO_LIN[pr], p1 = SRGB_TO_LIN[pg], p2 = SRGB_TO_LIN[pb];
  const pl = 0.2126 * p0 + 0.7152 * p1 + 0.0722 * p2;
  const S = Math.min(1.25, Math.max(0.02, S0));
  const dark = 1 - pl;
  const thr = LIGHT.grain + (1 - fade) * 0.1;
  const dc = (dev > thr ? dev - thr : dev < -thr ? dev + thr : 0) * fade;
  const keep = Math.min(1.1, Math.max(0, 1 - dc));
  const glint = Math.min(LIGHT.glintMax, Math.max(0, -dc) * base) * dark;
  // the gloss is a reflection on the paint: not on the window glass (dark detail) it would wash out
  const g = gl * Math.max(0, 1 - 2.5 * Math.max(0, dc));
  const push = LIGHT.detail * Math.min(1, Math.max(0, dc)) * dark;
  const p = [p0, p1, p2];
  for (let c = 0; c < 3; c++) {
    const r = 1 - (1 - p[c] * S * keep * tint[c]) * (1 - glint) * (1 - g);
    out[c] = toSrgb(r) - push;
  }
}

/**
 * The gloss field (Norebbo's template technique, on each type's measured lines): a white reflection band along the
 * upper fuselage, its hard lower edge a little above the window tops and a soft top toward the crown; a diagonal
 * reflection on the fin with one hard edge, fading aft; a soft horizontal highlight on each cowl. Weighted by the
 * region's coverage in the mask (RGBA at w × h). `tube(x)` gives [crown, belly] at a 2048-frame x (null off the tube).
 */
export function glossOf(m: Uint8ClampedArray, w: number, h: number, frameW: number, geo: {
  tube: (x: number) => [number, number] | null;
  winTop: number | null; crown: number; belly: number;
  finQuad: [[number, number], [number, number], [number, number], [number, number]];
  eng: [number, number, number, number, number][];
}): Float32Array {
  const g = new Float32Array(w * h);
  const k = w / frameW;
  const D = Math.max(1, geo.belly - geo.crown);
  const hardT = geo.winTop !== null ? (geo.winTop - geo.crown) / D - GLOSS.bodyGap : 0.3;
  const [rle, rte, tle, tte] = geo.finQuad;
  const rootY = (rle[1] + rte[1]) / 2, tipY = (tle[1] + tte[1]) / 2;
  const aa = 1 / k; // one output pixel in frame units: the hard edges are anti-aliased over it
  for (let X = 0; X < w; X++) {
    const x = (X + 0.5) / k;
    const t = geo.tube(x);
    for (let Y = 0; Y < h; Y++) {
      const i = Y * w + X, j = i * 4;
      const y = (Y + 0.5) / k;
      let v = 0;
      const body = m[j + 1] / 255, fin = m[j] / 255, cowl = m[j + 2] / 255;
      if (body > 0 && t) {
        const tt = (y - t[0]) / Math.max(1, t[1] - t[0]);
        const edge = Math.min(1, Math.max(0, (hardT - tt) * (t[1] - t[0]) / aa + 0.5)); // hard lower edge
        const up = Math.min(1, Math.max(0, (tt - (hardT - GLOSS.bodySoft)) / GLOSS.bodySoft)); // soft top
        v += body * GLOSS.body * edge * up * up * (3 - 2 * up);
      }
      if (fin > 0 && rootY > tipY) {
        const ft = (rootY - y) / (rootY - tipY);
        const le = rle[0] + (tle[0] - rle[0]) * ft, te = rte[0] + (tte[0] - rte[0]) * ft;
        const fs = (x - le) / (te - le || 1);
        const cut = GLOSS.finCut0 + (GLOSS.finCut1 - GLOSS.finCut0) * Math.min(1, Math.max(0, ft));
        const px = Math.abs(te - le) || 1;
        const edge = Math.min(1, Math.max(0, (fs - cut) * px / aa + 0.5));
        const fade = Math.max(0, 1 - (fs - cut) / GLOSS.finFade);
        v += fin * GLOSS.fin * edge * fade;
      }
      if (cowl > 0) {
        for (const [aft, front, , top, Dn] of geo.eng) {
          if (x < aft - 2 || x > front + 4) continue;
          const z = (y - (top + GLOSS.cowlAt * Dn)) / (GLOSS.cowlSigma * Dn);
          v += cowl * GLOSS.cowl * Math.exp(-0.5 * z * z);
        }
      }
      g[i] = Math.min(0.6, v);
    }
  }
  return g;
}

/**
 * Paints the regions of a sprite in place. `paints[r]` holds the paint colour of region r per pixel (RGBA, sRGB; the
 * fin's, the body's and the cowl's), null leaves that region as drawn. Weighted by the mask's coverage (the regions
 * never overlap; their sum is capped at 1). Pixels outside the regions and every alpha value stay exactly as drawn,
 * and white paint (#ffffff) gives back the art exactly.
 */
export function paintRegions(px: Uint8ClampedArray, m: Uint8ClampedArray, sh: Shading, paints: (Uint8ClampedArray | null)[], decals?: Uint8ClampedArray | null): void {
  const n = sh.w * sh.h;
  const tint: [number, number, number] = [1, 1, 1];
  const res = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (!px[j + 3]) continue;
    let w0 = paints[0] ? m[j] / 255 : 0, w1 = paints[1] ? m[j + 1] / 255 : 0, w2 = paints[2] ? m[j + 2] / 255 : 0;
    const sum = w0 + w1 + w2;
    if (!sum) continue;
    if (sum > 1) { w0 /= sum; w1 /= sum; w2 /= sum; }
    const keep = 1 - w0 - w1 - w2;
    const yv = sh.y[i];
    // the art's own colour cast where it is clearly coloured (beacons, handles); neutral grey otherwise
    for (let c = 0; c < 3; c++) {
      const v = yv > 1e-3 ? SRGB_TO_LIN[px[j + c]] / yv : 1;
      tint[c] = Math.abs(v - 1) < 0.12 ? 1 : v;
    }
    let r0 = px[j] * keep, r1 = px[j + 1] * keep, r2 = px[j + 2] * keep;
    const ws = [w0, w1, w2];
    for (let r = 0; r < 3; r++) {
      const wr = ws[r];
      if (!wr) continue;
      const pt = paints[r]!;
      if (pt[j] === 255 && pt[j + 1] === 255 && pt[j + 2] === 255) {
        // white paint: the art as drawn
        r0 += px[j] * wr; r1 += px[j + 1] * wr; r2 += px[j + 2] * wr;
        continue;
      }
      const S = sh.n[i] > 0 ? sh.n[i] : yv / sh.white[r];
      // under a decal (titles, code, logos) the drawn lines are kept faint: a panel line, not a crack
      const fade = decals ? 1 - LIGHT.decalFade * (decals[j + 3] / 255) : 1;
      litPixel(tint, pt[j], pt[j + 1], pt[j + 2], S, S * sh.white[r], sh.d[i], fade, sh.g ? sh.g[i] * (0.4 + 0.6 * fade) : 0, res);
      r0 += res[0] * wr; r1 += res[1] * wr; r2 += res[2] * wr;
    }
    px[j] = r0; px[j + 1] = r1; px[j + 2] = r2;
  }
}
