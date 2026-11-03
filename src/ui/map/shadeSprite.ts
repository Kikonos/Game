// v0.15 Depth: the soft shadow under each of our aircraft on the map, pre-rendered once per type and softness step
// (canvas shadowBlur, which every browser draws) into a small PNG. The map then draws it as one <image> per aircraft,
// moved and rotated with the glyph: no SVG filter, no per-frame blur, nothing repainted but a small bitmap.

import { SHADE_LEVELS, shadeLevel } from './depth';
import { silhouette } from './silhouettes';

export interface ShadeSprite {
  href: string;
  /** Box in the glyph's frame (px as built, centred on the glyph). */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas px per built px: sharp at the closest zoom on a 3× screen. */
const RES = 3;
const cache = new Map<string, ShadeSprite | null>();

/** The shadow sprite of a type at softness step `level` (cached); null where there is no canvas (tests, old engines). */
export function shadeSprite(typeId: string, level: number): ShadeSprite | null {
  const lv = Math.max(0, Math.min(SHADE_LEVELS - 1, Math.round(level)));
  const key = `${typeId}|${lv}`;
  if (cache.has(key)) return cache.get(key)!;
  let out: ShadeSprite | null = null;
  try {
    out = draw(typeId, lv);
  } catch {
    out = null;
  }
  cache.set(key, out);
  return out;
}

function draw(typeId: string, lv: number): ShadeSprite | null {
  if (typeof document === 'undefined' || typeof Path2D === 'undefined') return null;
  const sil = silhouette(typeId);
  const { blur, alpha } = shadeLevel(lv);
  const pad = blur * 2.6 + 1;
  const w = 2 * (sil.hs + pad);
  const h = 2 * (sil.hl + pad);
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w * RES);
  cv.height = Math.ceil(h * RES);
  const c = cv.getContext('2d');
  if (!c) return null;
  // The solid shape first (body and engines as one opaque union), then only its shadow: the shape is drawn far off
  // the canvas and its shadow offset back on, so a blurred copy lands with no halo of the shape itself.
  const solid = document.createElement('canvas');
  solid.width = cv.width;
  solid.height = cv.height;
  const s = solid.getContext('2d');
  if (!s) return null;
  s.setTransform(RES, 0, 0, RES, cv.width / 2, cv.height / 2);
  s.fillStyle = '#000';
  s.fill(new Path2D(sil.body));
  if (sil.engines) s.fill(new Path2D(sil.engines));
  const off = cv.width * 4;
  c.shadowOffsetX = off;
  c.shadowOffsetY = 0;
  c.shadowBlur = blur * 2 * RES;
  c.shadowColor = `rgba(0, 0, 0, ${alpha.toFixed(3)})`;
  c.drawImage(solid, -off, 0);
  const href = cv.toDataURL('image/png');
  if (!href.startsWith('data:image/png')) return null;
  return { href, x: -w / 2, y: -h / 2, w, h };
}

/** Builds every softness step of these types ahead of need, a few at a time between frames; returns a cancel. */
export function warmShades(types: string[]): () => void {
  const todo: [string, number][] = [];
  for (const t of new Set(types)) for (let lv = 0; lv < SHADE_LEVELS; lv++) if (!cache.has(`${t}|${lv}`)) todo.push([t, lv]);
  let h: ReturnType<typeof setTimeout> | undefined;
  const step = () => {
    const t0 = performance.now();
    while (todo.length && performance.now() - t0 < 4) {
      const [t, lv] = todo.shift()!;
      shadeSprite(t, lv);
    }
    if (todo.length) h = setTimeout(step, 60);
  };
  if (todo.length) h = setTimeout(step, 400);
  return () => clearTimeout(h);
}
