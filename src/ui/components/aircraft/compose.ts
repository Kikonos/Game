// v0.10 livery tint on the raster sprites: the sprite stays as drawn; the fin (the mask's red channel), the fuselage
// (green, v0.10 body paint) and the engines (blue) are multiplied by the livery colours, so the panel lines, windows,
// doors and shading still show.
// One bitmap per sprite + asset width + colours, composed on a canvas once and kept as an object URL (LRU).
// Browser only (the layout maths in stickers.ts stay pure).

import type { Livery } from '../../../engine/core/types';
import { bodyLayers, engineColour } from './bodyPaint';
import { finSecondAreas } from './stickers';
import { fileOf, layoutOf, maskUrl, spriteOf, spriteUrl, type AssetWidth } from './sprites';

const images = new Map<string, Promise<HTMLImageElement>>();
function load(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`image ${url}`));
      img.src = url;
    });
    p.catch(() => images.delete(url));
    images.set(url, p);
  }
  return p;
}

/** Colours the tint depends on; null = the sprite untouched (plain white livery). */
export function tintKey(lv: Livery): string | null {
  return lv.plain ? null : `${lv.primary}|${lv.secondary}|${lv.tail}${lv.body ? `|${JSON.stringify(lv.body)}` : ''}`;
}

const MAX = 120;
const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const keyOf = (sprite: string, w: AssetWidth, tint: string) => `${fileOf(spriteOf(sprite))}|${spriteOf(sprite)}|${w}|${tint}`;

/** The composed bitmap's URL when it is ready (or the untouched sprite for a plain livery). */
export function composedNow(sprite: string, w: AssetWidth, lv: Livery): string | undefined {
  const tint = tintKey(lv);
  if (!tint) return spriteUrl(sprite, w);
  const k = keyOf(sprite, w, tint);
  const u = done.get(k);
  if (u) {
    // LRU: most recent last
    done.delete(k);
    done.set(k, u);
  }
  return u;
}

/** Composes (once) the tinted bitmap and resolves its URL. */
export function compose(sprite: string, w: AssetWidth, lv: Livery): Promise<string> {
  const now = composedNow(sprite, w, lv);
  if (now) return Promise.resolve(now);
  const k = keyOf(sprite, w, tintKey(lv)!);
  let p = pending.get(k);
  if (!p) {
    p = draw(sprite, w, lv).then((url) => {
      done.set(k, url);
      pending.delete(k);
      while (done.size > MAX) {
        const [old, u] = done.entries().next().value as [string, string];
        done.delete(old);
        URL.revokeObjectURL(u);
      }
      return url;
    }, (e) => {
      pending.delete(k);
      throw e;
    });
    pending.set(k, p);
  }
  return p;
}

/**
 * Multiplies the tint over the art where the mask says (R = fin, B = engines; they never overlap), weighted by the
 * mask's coverage, so the panel lines and shading of the white art still show. Alpha and every pixel outside the
 * mask are left exactly as drawn. In place; pure.
 */
export function applyTint(p: Uint8ClampedArray, m: Uint8ClampedArray, t: Uint8ClampedArray): void {
  applyTints(p, m, t, null, t);
}

/**
 * v0.10 three tints: the fin's (mask R), the fuselage's (G) and the engines' (B), each weighted by its coverage
 * (they never overlap; their sum is capped at 1). A null tint leaves its area as drawn. Pixels outside the mask and
 * every alpha value stay exactly as drawn. In place; pure.
 */
export function applyTints(p: Uint8ClampedArray, m: Uint8ClampedArray, fin: Uint8ClampedArray | null, body: Uint8ClampedArray | null, eng: Uint8ClampedArray | null): void {
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    let wr = fin ? m[i] / 255 : 0, wg = body ? m[i + 1] / 255 : 0, wb = eng ? m[i + 2] / 255 : 0;
    const sum = wr + wg + wb;
    if (!sum) continue;
    if (sum > 1) { wr /= sum; wg /= sum; wb /= sum; }
    const keep = 1 - wr - wg - wb;
    for (let c = 0; c < 3; c++) {
      const k = keep + (wr ? (wr * fin![i + c]) / 255 : 0) + (wg ? (wg * body![i + c]) / 255 : 0) + (wb ? (wb * eng![i + c]) / 255 : 0);
      p[i + c] = p[i + c] * k;
    }
  }
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

type Ctx = CanvasRenderingContext2D;
const fillPoly = (c: Ctx, poly: [number, number][], k: number) => {
  if (poly.length < 3) return;
  c.beginPath();
  poly.forEach(([x, y], i) => (i ? c.lineTo(x * k, y * k) : c.moveTo(x * k, y * k)));
  c.closePath();
  c.fill();
};

/**
 * Engine intake lips: per engine (a run of columns with engine coverage in the mask) its front tenth, nose side.
 * Found from the mask once per composed bitmap (the result is cached with it).
 */
function lipColumns(m: Uint8ClampedArray, w: number, h: number): [number, number][] {
  const col = new Uint8Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[(y * w + x) * 4 + 2] > 128) col[x] = 1;
  const runs: [number, number][] = [];
  for (let x = 0; x < w; x++) {
    if (!col[x]) continue;
    let e = x;
    while (e + 1 < w && col[e + 1]) e++;
    if (e - x > w * 0.01) runs.push([Math.round(e - 0.11 * (e - x)), e + 1]);
    x = e;
  }
  return runs;
}

/** The mask's pixels at a width (and its intake lips, found once), kept for the last few sprites: one decode per type. */
const masks = new Map<string, { m: Uint8ClampedArray; lip?: [number, number][] }>();
function maskData(id: string, w: number, h: number, mask: HTMLImageElement): { m: Uint8ClampedArray; lips: () => [number, number][] } {
  const key = `${id}|${w}`;
  let e = masks.get(key);
  if (e) {
    masks.delete(key);
    masks.set(key, e);
  } else {
    const mk = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
    mk.imageSmoothingQuality = 'high';
    mk.drawImage(mask, 0, 0, w, h);
    e = { m: mk.getImageData(0, 0, w, h).data };
    masks.set(key, e);
    while (masks.size > 8) masks.delete(masks.keys().next().value as string);
  }
  const ent = e;
  return { m: ent.m, lips: () => (ent.lip ??= lipColumns(ent.m, w, h)) };
}

async function draw(sprite: string, w: AssetWidth, lv: Livery): Promise<string> {
  const id = spriteOf(sprite);
  const d = layoutOf(id);
  const h = Math.round((d.h * w) / d.w);
  const [img, mask] = await Promise.all([load(spriteUrl(id, w)), load(maskUrl(id))]);
  const base = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  base.drawImage(img, 0, 0, w, h);
  const px = base.getImageData(0, 0, w, h);
  const { m, lips } = maskData(id, w, h, mask);
  const k = w / d.w;
  const layers = bodyLayers(id, lv.body);
  // fin: the livery colour, the scheme's second colour over its areas, swept stripes on top
  const fc = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  fc.fillStyle = lv.primary;
  fc.fillRect(0, 0, w, h);
  fc.fillStyle = lv.secondary;
  for (const poly of finSecondAreas(id, lv.tail)) fillPoly(fc, poly, k);
  for (const l of layers.filter((x) => x.fin)) {
    fc.fillStyle = l.color;
    for (const poly of l.polys) fillPoly(fc, poly, k);
  }
  // fuselage: body, belly, stripes, nose (nothing = left as drawn)
  let bodyT: Uint8ClampedArray | null = null;
  if (layers.length) {
    const bc = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
    bc.fillStyle = '#ffffff';
    bc.fillRect(0, 0, w, h);
    for (const l of layers) {
      bc.fillStyle = l.color;
      for (const poly of l.polys) fillPoly(bc, poly, k);
    }
    bodyT = bc.getImageData(0, 0, w, h).data;
  }
  // engines: their own colour (the tail colour by default) and the intake lips
  const ec = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ec.fillStyle = engineColour(lv);
  ec.fillRect(0, 0, w, h);
  if (lv.body?.lip) {
    ec.fillStyle = lv.body.lip;
    for (const [a, b] of lips()) ec.fillRect(a, 0, b - a, h);
  }
  applyTints(px.data, m, fc.getImageData(0, 0, w, h).data, bodyT, ec.getImageData(0, 0, w, h).data);
  base.putImageData(px, 0, 0);
  const blob = await new Promise<Blob | null>((res) => base.canvas.toBlob(res, 'image/webp', 0.92));
  if (!blob) throw new Error('compose');
  return URL.createObjectURL(blob);
}
