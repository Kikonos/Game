// v0.10 livery tint on the raster sprites: the sprite stays as drawn; the fin (the mask's red channel) and the
// engines (its blue channel) are multiplied by the livery colours, so the panel lines and shading still show.
// One bitmap per sprite + asset width + colours, composed on a canvas once and kept as an object URL (LRU).
// Browser only (the layout maths in stickers.ts stay pure).

import type { Livery } from '../../../engine/core/types';
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
  return lv.plain ? null : `${lv.primary}|${lv.secondary}|${lv.tail}`;
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
  for (let i = 0; i < p.length; i += 4) {
    const c = Math.max(m[i], m[i + 2]);
    if (!c || !p[i + 3]) continue;
    const a = c / 255;
    p[i] = p[i] * (1 - a + (a * t[i]) / 255);
    p[i + 1] = p[i + 1] * (1 - a + (a * t[i + 1]) / 255);
    p[i + 2] = p[i + 2] * (1 - a + (a * t[i + 2]) / 255);
  }
}

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

async function draw(sprite: string, w: AssetWidth, lv: Livery): Promise<string> {
  const id = spriteOf(sprite);
  const d = layoutOf(id);
  const h = Math.round((d.h * w) / d.w);
  const [img, mask] = await Promise.all([load(spriteUrl(id, w)), load(maskUrl(id))]);
  const base = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  base.drawImage(img, 0, 0, w, h);
  const px = base.getImageData(0, 0, w, h);
  const mk = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  mk.imageSmoothingQuality = 'high';
  mk.drawImage(mask, 0, 0, w, h);
  const m = mk.getImageData(0, 0, w, h).data;
  // tint layer: the livery colour everywhere, the scheme's second colour over its fin areas
  const tc = canvas(w, h).getContext('2d', { willReadFrequently: true })!;
  tc.fillStyle = lv.primary;
  tc.fillRect(0, 0, w, h);
  const k = w / d.w;
  tc.fillStyle = lv.secondary;
  for (const poly of finSecondAreas(id, lv.tail)) {
    tc.beginPath();
    poly.forEach(([x, y], i) => (i ? tc.lineTo(x * k, y * k) : tc.moveTo(x * k, y * k)));
    tc.closePath();
    tc.fill();
  }
  applyTint(px.data, m, tc.getImageData(0, 0, w, h).data);
  base.putImageData(px, 0, 0);
  const blob = await new Promise<Blob | null>((res) => base.canvas.toBlob(res, 'image/webp', 0.92));
  if (!blob) throw new Error('compose');
  return URL.createObjectURL(blob);
}
