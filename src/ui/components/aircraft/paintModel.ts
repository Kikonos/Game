// v0.11 painting model: livery paint lit by the sprite's own lighting, so it reads as painted, not pasted. Pure (typed
// arrays in, typed arrays out); compose.ts does the canvas work.
//
// The white art is split, per paint region (fin, body, cowl), into
//   - a smooth shading term S: its luminance after a small grey closing (windows, door outlines, panel lines and
//     aerials are taken out) and a blur that stays inside the region (no halo from the wing or the sky), relative to
//     the region's lit white;
//   - a detail term: the pixel's luminance against that shading (panel lines, doors, windows < 1; glints > 1).
// A painted pixel is the paint colour lit by S through a curve that keeps the cylinder shading on dark colours
// (darker paints get a steeper curve and a little sky sheen on the lit top), times the detail soft-thresholded (the
// sprite's airbrush and compression grain below 5 % goes, drawn lines, doors and windows stay), with the dark detail
// pressed in a little (lines must show on navy too) and glints screened on. Under decals the lines are fainter.
// White paint gives back the art exactly. Text and logos are drawn into the paint before this, so they get the same
// light, lines and edges. The fuselage's S is a fitted cylinder (scripts/sprites.py cylinder_shade): no streaks.

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

/** Lighting constants (tuned on the 777 / A320 / 747 art against airline photos). */
export const LIGHT = {
  /** Extra steepness of the shading curve for a black paint (0 for white): S^(1 + CURVE (1 - √L)). */
  curve: 0.9,
  /** Sky sheen on the lit top of a black paint (screened, linear light). */
  sheen: 0.035,
  /** S from which the sheen starts (S = 1 is the region's lit white). */
  sheenFrom: 0.85,
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
 * One paint lit at one pixel → sRGB channel values. `S` the smooth light (1 = the region's lit white), `base` the
 * light in linear luminance, `dev` the clean drawn detail (detailOf), `fade` 0..1 how much of it to keep (decals keep
 * less), `tint` the art's own colour cast per channel (red beacons and handles stay red). Detail below LIGHT.grain is
 * dropped (soft threshold), the rest darkens (lines) or screens on (glints); dark paint gets a capped extra push so
 * lines still read on navy.
 */
function litPixel(tint: [number, number, number], pr: number, pg: number, pb: number, S0: number, base: number, dev: number, fade: number, out: Float32Array): void {
  const p0 = SRGB_TO_LIN[pr], p1 = SRGB_TO_LIN[pg], p2 = SRGB_TO_LIN[pb];
  const pl = 0.2126 * p0 + 0.7152 * p1 + 0.0722 * p2;
  const S = Math.min(1.25, Math.max(0.02, S0));
  const k = 1 + LIGHT.curve * (1 - Math.sqrt(pl));
  const sk = Math.exp(k * Math.log(S));
  const t = Math.min(1, Math.max(0, (S - LIGHT.sheenFrom) / (1 - LIGHT.sheenFrom)));
  const sheen = LIGHT.sheen * (1 - pl) * t * t;
  const dark = 1 - pl;
  const thr = LIGHT.grain + (1 - fade) * 0.1;
  const dc = (dev > thr ? dev - thr : dev < -thr ? dev + thr : 0) * fade;
  const keep = Math.min(1.1, Math.max(0, 1 - dc));
  // glints screened on, capped: the drawn highlights of a fairing bulge read as sheen, not as white blotches
  const glint = Math.min(LIGHT.glintMax, Math.max(0, -dc) * base) * dark;
  const push = LIGHT.detail * Math.min(1, Math.max(0, dc)) * dark;
  const p = [p0, p1, p2];
  for (let c = 0; c < 3; c++) {
    const lit = 1 - (1 - p[c] * sk) * (1 - sheen);
    const r = 1 - (1 - lit * keep * tint[c]) * (1 - glint);
    out[c] = toSrgb(r) - push;
  }
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
      litPixel(tint, pt[j], pt[j + 1], pt[j + 2], S, S * sh.white[r], sh.d[i], fade, res);
      r0 += res[0] * wr; r1 += res[1] * wr; r2 += res[2] * wr;
    }
    px[j] = r0; px[j + 1] = r1; px[j + 2] = r2;
  }
}
