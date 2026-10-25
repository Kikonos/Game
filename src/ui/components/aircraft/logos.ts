// 24 original livery logos (v0.5.1, LIVERY.md §2.6; v0.11 nine more): simple bold marks, at most two tones, drawn
// in a 0–100 box, motion facing right (the nose). Built here from a few shape helpers (rounded to 0.1) so every
// mark stays a plain fill. None is traced from a real airline mark: the v0.11 ones (trefoil, ring, crown, star,
// leaf, lotus, palm, smile, sun) are generic shapes that client liveries use to evoke a carrier by colour and layout.

import { createElement, type ReactElement } from 'react';
import { LOGO_IDS, LOGO_NAMES, type LogoId } from '../../../data/livery';
import type { LiveryLogo } from '../../../engine/core/types';
import { FONT_STACK, textInkEm, textWidthEm } from './fontMetrics';

export interface LogoDef { id: LogoId; name: string; paths: { d: string; tone: 1 | 2 }[] }

type P = readonly [number, number];
const r1 = (n: number) => String(Math.round(n * 10) / 10);
const pt = (p: P) => `${r1(p[0])} ${r1(p[1])}`;
const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;

/** Closed polygon. */
const poly = (pts: readonly P[]) => `M${pts.map(pt).join('L')}Z`;
/** Full circle (two arcs); `ccw` reverses the winding (cut-outs under nonzero fill). */
const circle = (cx: number, cy: number, r: number, ccw = false) => {
  const s = ccw ? 0 : 1;
  return `M${r1(cx - r)} ${r1(cy)}A${r1(r)} ${r1(r)} 0 1 ${s} ${r1(cx + r)} ${r1(cy)}A${r1(r)} ${r1(r)} 0 1 ${s} ${r1(cx - r)} ${r1(cy)}Z`;
};
/** Points of an ellipse (rotated `rot` degrees) from angle a0 to a1. */
const ell = (cx: number, cy: number, rx: number, ry: number, rot: number, a0 = 0, a1 = TAU, n = 40): P[] => {
  const c = Math.cos(deg(rot)), s = Math.sin(deg(rot));
  const out: P[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n, x = rx * Math.cos(a), y = ry * Math.sin(a);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
};
/** Elliptic band of width w between angles a0..a1 (closed ring when the full turn). */
const ellBand = (cx: number, cy: number, rx: number, ry: number, w: number, rot: number, a0 = 0, a1 = TAU) => {
  const o = ell(cx, cy, rx + w / 2, ry + w / 2, rot, a0, a1), i = ell(cx, cy, rx - w / 2, ry - w / 2, rot, a0, a1).reverse();
  return a1 - a0 >= TAU - 1e-9 ? `${poly(o)}${poly(i)}` : poly([...o, ...i]);
};
/** Sample a curve. */
const curve = (f: (t: number) => P, n = 32): P[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
const quad = (a: P, c: P, b: P) => (t: number): P => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
};
/** Stroke outline of a polyline with width w(t) (t = 0..1 along the points). */
const band = (pts: readonly P[], w: (t: number) => number) => {
  const n = pts.length, L: P[] = [], R: P[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
    const h = w(i / (n - 1)) / 2, nx = -dy / d, ny = dx / d;
    L.push([p[0] + nx * h, p[1] + ny * h]);
    R.push([p[0] - nx * h, p[1] - ny * h]);
  });
  return poly([...L, ...R.reverse()]);
};
/** Kite from centre c pointing at angle a (deg, screen: 0 = right, 90 = down): length l, half-width w. */
const kite = (c: P, a: number, l: number, w: number) => {
  const dx = Math.cos(deg(a)), dy = Math.sin(deg(a));
  return poly([[c[0] + dx * l, c[1] + dy * l], [c[0] - dy * w, c[1] + dx * w], [c[0] - dx * w * 0.6, c[1] - dy * w * 0.6], [c[0] + dy * w, c[1] - dx * w]]);
};
/** Ray (trapezoid) at angle a from radius r0 to r1, base width w0 tapering to w1. */
const ray = (c: P, a: number, r0: number, r1v: number, w0: number, w1: number) => {
  const dx = Math.cos(deg(a)), dy = Math.sin(deg(a)), nx = -dy, ny = dx;
  const at = (r: number, w: number, k: number): P => [c[0] + dx * r + nx * w * k / 2, c[1] + dy * r + ny * w * k / 2];
  return poly([at(r0, w0, 1), at(r1v, w1, 1), at(r1v, w1, -1), at(r0, w0, -1)]);
};
const taper = (lo: number, hi: number) => (t: number) => lo + (hi - lo) * Math.sin(Math.PI * t);

const C: P = [50, 50];

const DEFS: Record<LogoId, LogoDef['paths']> = {
  // thick rising arc with tapered ends, a slimmer echo under it
  arc: [
    { d: band(curve(quad([6, 88], [22, 20], [94, 14])), taper(2, 18)), tone: 1 },
    { d: band(curve(quad([34, 94], [46, 48], [94, 36])), taper(2, 10)), tone: 2 },
  ],
  // three swept strokes, heavy at the root, sharp toward the nose
  swift: [
    { d: band(curve(quad([6, 34], [52, 40], [95, 14])), (t) => 16 * (1 - t) + 1), tone: 1 },
    { d: band(curve(quad([16, 58], [56, 60], [88, 34])), (t) => 14 * (1 - t) + 1), tone: 2 },
    { d: band(curve(quad([28, 82], [60, 80], [80, 54])), (t) => 12 * (1 - t) + 1), tone: 1 },
  ],
  // circle with two meridians (one ellipse) and the equator
  globe: [
    { d: ellBand(50, 50, 42, 42, 10, 0), tone: 1 },
    { d: ellBand(50, 50, 18, 42, 9, 0), tone: 2 },
    { d: poly([[9, 45.5], [91, 45.5], [91, 54.5], [9, 54.5]]), tone: 2 },
  ],
  // four-point star with long horizontal arms, small sparkle
  polaris: [
    { d: 'M97 52Q57 58 50 90Q43 58 3 52Q43 46 50 14Q57 46 97 52Z', tone: 1 },
    { d: 'M96 18Q86 20 84 31Q82 20 72 18Q82 16 84 5Q86 16 96 18Z', tone: 2 },
  ],
  // eight-point rose: short diagonal points in tone 2 under the long cardinal points
  compass: [
    ...[45, 135, 225, 315].map((a) => ({ d: kite(C, a, 34, 10), tone: 2 as const })),
    ...[0, 90, 180, 270].map((a) => ({ d: kite(C, a, 47, 12), tone: 1 as const })),
  ],
  // half disc on a bar with five short rays
  sunrise: [
    { d: 'M22 72A28 28 0 0 1 78 72Z', tone: 1 },
    ...[-162, -126, -90, -54, -18].map((a) => ({ d: ray([50, 72], a, 35, 49, 10, 9), tone: 1 as const })),
    { d: poly([[4, 76], [96, 76], [96, 87], [4, 87]]), tone: 2 },
  ],
  // two stacked sine strokes
  wave: [
    { d: band(curve((t) => [5 + 90 * t, 36 - 10 * Math.sin(t * TAU * 1.25)], 48), () => 12), tone: 1 },
    { d: band(curve((t) => [5 + 90 * t, 66 - 10 * Math.sin(t * TAU * 1.25)], 48), () => 10), tone: 2 },
  ],
  // two overlapping mountain triangles
  peaks: [
    { d: poly([[4, 86], [42, 14], [80, 86]]), tone: 1 },
    { d: poly([[40, 86], [69, 36], [97, 86]]), tone: 2 },
  ],
  // three nested forward chevrons
  chevrons: [0, 24, 48].map((x, i) => ({
    d: poly([[x + 3, 14], [x + 16, 14], [x + 47, 50], [x + 16, 86], [x + 3, 86], [x + 34, 50]]),
    tone: (i === 1 ? 2 : 1) as 1 | 2,
  })),
  // band folded twice: the back of the band shows in tone 2
  ribbon: [
    { d: poly([[4, 64], [38, 22], [38, 46], [4, 88]]), tone: 1 },
    { d: poly([[38, 22], [62, 54], [62, 78], [38, 46]]), tone: 2 },
    { d: poly([[62, 54], [96, 12], [96, 36], [62, 78]]), tone: 1 },
  ],
  // planet with a tilted ring: back half behind it, front half over it
  orbit: [
    { d: ellBand(50, 52, 44, 14, 9, -22, Math.PI, TAU), tone: 2 },
    { d: circle(50, 52, 21), tone: 1 },
    { d: ellBand(50, 52, 44, 14, 9, -22, 0, Math.PI), tone: 2 },
  ],
  // diamond split on its long diagonal
  kite: [
    { d: poly([[64, 4], [16, 54], [36, 96]]), tone: 1 },
    { d: poly([[64, 4], [36, 96], [86, 44]]), tone: 2 },
  ],
  // one quill with three cuts in the trailing vane, the quill end in tone 2
  feather: [
    { d: feather(), tone: 1 },
    { d: band([[8, 95], [27, 74]], () => 9), tone: 2 },
  ],
  // eight-ray burst, alternate rays long, around a dot
  spark: [
    ...[22.5, 112.5, 202.5, 292.5].map((a) => ({ d: ray(C, a, 22, 48, 15, 3), tone: 1 as const })),
    ...[67.5, 157.5, 247.5, 337.5].map((a) => ({ d: ray(C, a, 22, 37, 12, 3), tone: 1 as const })),
    { d: circle(50, 50, 10), tone: 2 },
  ],
  // three round leaves on a short curved stem
  trefoil: [
    { d: circle(50, 26, 19), tone: 1 },
    { d: circle(29, 56, 19), tone: 1 },
    { d: circle(71, 56, 19), tone: 1 },
    { d: band(curve(quad([50, 60], [54, 80], [66, 95])), () => 7), tone: 2 },
  ],
  // a ring with a short bar across its lower half
  ring: [
    { d: ellBand(50, 50, 40, 40, 9, 0), tone: 1 },
    { d: poly([[30, 58], [70, 58], [70, 66], [30, 66]]), tone: 2 },
  ],
  // five-point crown on a band, a dot on each point
  crown: [
    { d: poly([[12, 74], [8, 30], [30, 52], [50, 22], [70, 52], [92, 30], [88, 74]]), tone: 1 },
    { d: poly([[12, 80], [88, 80], [88, 91], [12, 91]]), tone: 1 },
    ...[[8, 26], [50, 17], [92, 26]].map(([x, y]) => ({ d: circle(x + (x < 50 ? 4 : x > 50 ? -4 : 0), y + 4, 5.5), tone: 2 as const })),
  ],
  // five-point star
  star: [
    { d: poly(Array.from({ length: 10 }, (_, i) => { const a = deg(-90 + i * 36), r = i % 2 ? 19 : 46; return [50 + r * Math.cos(a), 54 + r * Math.sin(a)] as P; })), tone: 1 },
  ],
  // pointed leaf with a mid-rib
  leaf: [
    { d: poly([...curve(quad([50, 6], [94, 46], [50, 94]), 24), ...curve(quad([50, 94], [6, 46], [50, 6]), 24).slice(1)]), tone: 1 },
    { d: band([[50, 22], [50, 96]], () => 4), tone: 2 },
  ],
  // lotus: three petals over a bowl
  lotus: [
    { d: poly([...curve(quad([50, 8], [76, 40], [50, 70]), 20), ...curve(quad([50, 70], [24, 40], [50, 8]), 20).slice(1)]), tone: 1 },
    { d: poly([...curve(quad([12, 30], [44, 44], [44, 72]), 20), ...curve(quad([44, 72], [16, 66], [12, 30]), 20).slice(1)]), tone: 1 },
    { d: poly([...curve(quad([88, 30], [56, 44], [56, 72]), 20), ...curve(quad([56, 72], [84, 66], [88, 30]), 20).slice(1)]), tone: 1 },
    { d: 'M10 76Q50 98 90 76L84 86Q50 100 16 86Z', tone: 2 },
  ],
  // palm: a trunk under five fronds
  palm: [
    ...[-160, -125, -90, -55, -20].map((a) => ({ d: band(curve(quad([50, 34], [50 + 26 * Math.cos(deg(a)), 34 + 26 * Math.sin(deg(a)) - 6], [50 + 44 * Math.cos(deg(a)), 30 + 40 * Math.sin(deg(a)) + 18]), 16), taper(2, 12)), tone: 1 as const })),
    { d: band(curve(quad([50, 36], [44, 66], [52, 96]), 16), () => 7), tone: 2 },
  ],
  // a smile under two dots
  smile: [
    { d: band(curve(quad([12, 52], [50, 104], [88, 52]), 32), taper(5, 13)), tone: 1 },
    { d: circle(32, 28, 8), tone: 2 },
    { d: circle(68, 28, 8), tone: 2 },
  ],
  // disc with eight short rays
  sun: [
    { d: circle(50, 50, 22), tone: 1 },
    ...[0, 45, 90, 135, 180, 225, 270, 315].map((a) => ({ d: ray(C, a, 29, 46, 9, 4), tone: 2 as const })),
  ],
  // triangle split in two tones
  prism: [
    { d: poly([[50, 6], [4, 90], [60, 90]]), tone: 1 },
    { d: poly([[50, 6], [60, 90], [96, 90]]), tone: 2 },
  ],
};

/** Leaf-shaped vane along base → tip with three V cuts in its lower edge. */
function feather(): string {
  const b: P = [22, 80], t: P = [92, 8];
  const dx = t[0] - b[0], dy = t[1] - b[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, nx = uy, ny = -ux;
  const at = (u: number, off: number): P => [b[0] + dx * u + nx * off, b[1] + dy * u + ny * off];
  const w = (u: number) => 24 * Math.sin(Math.PI * Math.min(1, u)) ** 0.75 * (1 - 0.35 * u);
  const upper = Array.from({ length: 25 }, (_, i) => at(i / 24, -w(i / 24)));
  const cuts = [0.32, 0.52, 0.72];
  const lower: P[] = [];
  for (let i = 50; i >= 0; i--) {
    const u = i / 50;
    if (cuts.some((c) => u < c && u > c - 0.07)) continue;
    lower.push(at(u, w(u) * 0.8));
    // V cut: in toward the shaft and back toward the base
    const c = cuts.find((k) => u >= k && u - 1 / 50 < k);
    if (c !== undefined) lower.push(at(c - 0.035, w(c) * 0.12), at(c - 0.07, w(c - 0.07) * 0.8));
  }
  return poly([...upper, ...lower]);
}

export const LOGOS = Object.fromEntries(LOGO_IDS.map((id) => [id, { id, name: LOGO_NAMES[id], paths: DEFS[id] }])) as Record<LogoId, LogoDef> satisfies Record<LogoId, LogoDef>;

// ---------- colour ----------

function lumOf(c: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return 0.5;
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  const n = parseInt(h, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ink or white, whichever reads on `bg`. */
export const onColor = (bg: string) => (lumOf(bg) > 0.42 ? '#16213a' : '#ffffff');

// ---------- elements ----------

/** Roundel with 1–3 letters fitted inside (0–100 box). */
export function Monogram({ text, color, color2 }: { text: string; color: string; color2?: string }): ReactElement {
  const t = (text || '?').trim().toUpperCase().slice(0, 3) || '?';
  const wEm = textWidthEm(t, 700, 0), ink = textInkEm(t), hEm = ink.asc + ink.desc;
  const fs = Math.min(52 / hEm, 70 / wEm);
  const fill = color2 && color2.toLowerCase() !== color.toLowerCase() ? color2 : onColor(color);
  return createElement('g', null,
    createElement('circle', { cx: 50, cy: 50, r: 48, fill: color }),
    createElement('text', {
      x: 50, y: 50 + ((ink.asc - ink.desc) / 2) * fs, fontSize: Math.round(fs * 10) / 10, fill, textAnchor: 'middle',
      style: { fontFamily: FONT_STACK, fontWeight: 700 },
    }, t),
  );
}

/** A livery logo's marks in its 0–100 box (no transform). */
export function LogoGlyph({ logo }: { logo: LiveryLogo }): ReactElement {
  if (logo.id === 'mono') return createElement(Monogram, { text: logo.text ?? '', color: logo.color, color2: logo.color2 });
  const def = LOGOS[logo.id] ?? LOGOS.arc;
  return createElement('g', null, def.paths.map((p, i) => createElement('path', { key: i, d: p.d, fill: p.tone === 2 ? logo.color2 ?? logo.color : logo.color })));
}
