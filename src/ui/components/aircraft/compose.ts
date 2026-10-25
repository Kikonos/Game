// v0.11 livery painting on the raster sprites: the art stays as drawn; the fin (mask R), the fuselage (G) and the
// engine cowls (B) are painted through the sprite's own lighting (paintModel.ts), with the titles, the tail code and
// the logos painted in before the light (decals), so they carry the same shading, panel lines, doors and windows.
// One bitmap per sprite + asset width + paint (object URL, LRU); the shading of each sprite per width is worked out
// once and kept for the last few. Browser only (the maths in paintModel.ts / stickers.ts stay pure).

import type { Livery } from '../../../engine/core/types';
import { bodyLayers, engineColour } from './bodyPaint';
import { FONT_FAMILY, textInkEm, textWidthEm } from './fontMetrics';
import { LOGOS, onColor } from './logos';
import { paintRegions, shadingFromField, shadingOf, type Shading } from './paintModel';
import { finSecondAreas, type StickerBox } from './stickers';
import { fileOf, layoutOf, maskUrl, shadeUrl, spriteOf, spriteUrl, type AssetWidth } from './sprites';

export { paintRegions } from './paintModel';

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

/** A sticker painted into the livery: its box (stickers.ts) and its lettering colour. */
export type Decal = StickerBox & { ink?: string };

/** Colours the paint depends on; null = the sprite untouched (plain white livery). */
export function tintKey(lv: Livery): string | null {
  return lv.plain ? null : `${lv.primary}|${lv.secondary}|${lv.tail}${lv.body ? `|${JSON.stringify(lv.body)}` : ''}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Everything the composed bitmap depends on; null = the sprite untouched (plain, no decals). */
export function paintKey(lv: Livery, decals: readonly Decal[] = []): string | null {
  const t = tintKey(lv);
  const logo = decals.some((d) => d.kind === 'logo') && lv.logo ? JSON.stringify(lv.logo) : '';
  const ds = decals.map((d) => [d.kind, r2(d.cx), r2(d.cy), r2(d.w), r2(d.h), r2(d.rot), d.text ?? '', r2(d.fontSize ?? 0), r2(d.baseline ?? 0), d.weight ?? 0, d.spacing ?? 0, d.ink ?? ''].join(',')).join(';');
  if (!t && !ds) return null;
  return `${t ?? 'plain'}#${ds}#${logo}`;
}

const MAX = 120;
const done = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const keyOf = (sprite: string, w: AssetWidth, key: string) => `${fileOf(spriteOf(sprite))}|${spriteOf(sprite)}|${w}|${key}`;

/** The composed bitmap's URL when it is ready (or the untouched sprite when nothing is painted). */
export function composedNow(sprite: string, w: AssetWidth, lv: Livery, decals: readonly Decal[] = []): string | undefined {
  const key = paintKey(lv, decals);
  if (!key) return spriteUrl(sprite, w);
  const k = keyOf(sprite, w, key);
  const u = done.get(k);
  if (u) {
    // LRU: most recent last
    done.delete(k);
    done.set(k, u);
  }
  return u;
}

/** Composes (once) the painted bitmap and resolves its URL. */
export function compose(sprite: string, w: AssetWidth, lv: Livery, decals: readonly Decal[] = []): Promise<string> {
  const now = composedNow(sprite, w, lv, decals);
  if (now) return Promise.resolve(now);
  const k = keyOf(sprite, w, paintKey(lv, decals)!);
  let p = pending.get(k);
  if (!p) {
    p = draw(sprite, w, lv, decals).then((url) => {
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

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

type Ctx = CanvasRenderingContext2D;
const ctx2d = (w: number, h: number): Ctx => canvas(w, h).getContext('2d', { willReadFrequently: true })!;
const fillPoly = (c: Ctx, poly: [number, number][], k: number) => {
  if (poly.length < 3) return;
  c.beginPath();
  poly.forEach(([x, y], i) => (i ? c.lineTo(x * k, y * k) : c.moveTo(x * k, y * k)));
  c.closePath();
  c.fill();
};

/** The art, its mask and its shading at a width, kept for the last few sprites: one decode and one shading per type. */
interface Prep { px: Uint8ClampedArray; m: Uint8ClampedArray; sh: Shading }
const preps = new Map<string, Promise<Prep>>();
function prep(id: string, w: number, h: number): Promise<Prep> {
  const key = `${id}|${w}`;
  let p = preps.get(key);
  if (p) {
    preps.delete(key);
    preps.set(key, p);
    return p;
  }
  const white = layoutOf(id).white;
  // the light is worked out at build time (<id>-shade.webp); without it, here (slower)
  const shade = white ? load(shadeUrl(id)).catch(() => null) : Promise.resolve(null);
  p = Promise.all([load(spriteUrl(id, w as AssetWidth)), load(maskUrl(id)), shade]).then(([img, mask, sf]) => {
    const a = ctx2d(w, h);
    a.drawImage(img, 0, 0, w, h);
    const px = a.getImageData(0, 0, w, h).data;
    const b = ctx2d(w, h);
    b.imageSmoothingQuality = 'high';
    b.drawImage(mask, 0, 0, w, h);
    const m = b.getImageData(0, 0, w, h).data;
    if (sf && white) {
      const c = ctx2d(w, h);
      c.imageSmoothingQuality = 'high';
      c.drawImage(sf, 0, 0, w, h);
      return { px, m, sh: shadingFromField(px, m, c.getImageData(0, 0, w, h).data, w, h, white) };
    }
    return { px, m, sh: shadingOf(px, m, w, h) };
  });
  p.catch(() => preps.delete(key));
  preps.set(key, p);
  while (preps.size > 4) preps.delete(preps.keys().next().value as string);
  return p;
}

/** The lettering font, loaded before text is painted into a canvas. */
let fonts: Promise<unknown> | null = null;
const fontsReady = () => (fonts ??= typeof document !== 'undefined' && document.fonts
  ? Promise.all([500, 700].map((wt) => document.fonts.load(`${wt} 64px ${FONT_FAMILY}`))).catch(() => undefined)
  : Promise.resolve());

/** Text centred on (0, baseline) with letter-spacing (em), glyph by glyph (the same advances as the sticker fit). */
function fillSpaced(c: Ctx, text: string, fs: number, spacing: number, baseline: number): void {
  const sp = spacing * fs;
  const chars = [...text];
  const ws = chars.map((ch) => c.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0) + sp * Math.max(0, ws.length - 1);
  let x = -total / 2;
  chars.forEach((ch, i) => {
    c.fillText(ch, x, baseline);
    x += ws[i] + sp;
  });
}

/** Paints the decals (titles, code, logos) into a paint layer, in the 2048 frame scaled by k. */
function paintDecals(c: Ctx, decals: readonly Decal[], lv: Livery, k: number): void {
  for (const d of decals) {
    c.save();
    c.translate(d.cx * k, d.cy * k);
    if (d.rot) c.rotate((d.rot * Math.PI) / 180);
    if (d.kind === 'logo') {
      const logo = lv.logo;
      if (logo) {
        const s = (d.w / 100) * k;
        c.scale(s, s);
        c.translate(-50, -50);
        if (logo.id === 'mono') {
          const t = (logo.text || '?').trim().toUpperCase().slice(0, 3) || '?';
          const ink = textInkEm(t), fs = Math.min(52 / (ink.asc + ink.desc), 70 / textWidthEm(t, 700, 0));
          c.fillStyle = logo.color;
          c.beginPath();
          c.arc(50, 50, 48, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = logo.color2 && logo.color2.toLowerCase() !== logo.color.toLowerCase() ? logo.color2 : onColor(logo.color);
          c.font = `700 ${fs}px ${FONT_FAMILY}`;
          c.textAlign = 'center';
          c.fillText(t, 50, 50 + ((ink.asc - ink.desc) / 2) * fs);
        } else {
          const def = LOGOS[logo.id] ?? LOGOS.arc;
          for (const p of def.paths) {
            c.fillStyle = p.tone === 2 ? logo.color2 ?? logo.color : logo.color;
            c.fill(new Path2D(p.d));
          }
        }
      }
    } else if (d.text && d.fontSize) {
      const fs = d.fontSize * k;
      c.font = `${d.weight ?? 700} ${fs}px ${FONT_FAMILY}`;
      c.textAlign = 'left';
      c.fillStyle = d.ink ?? '#000000';
      fillSpaced(c, d.text, fs, d.spacing ?? 0, (d.baseline ?? 0) * k);
    }
    c.restore();
  }
}

/** Engine intake lips: per engine (layout `eng`: cowl trailing edge, lip front, lip width) and row, the cowl's front. */
function paintLips(e: Uint8ClampedArray, m: Uint8ClampedArray, w: number, h: number, k: number, engs: [number, number, number][], rgb: [number, number, number]): void {
  for (const [aft, front, lip] of engs) {
    const x0 = Math.max(0, Math.floor(aft * k)), x1 = Math.min(w - 1, Math.ceil((front + 3) * k));
    const lw = Math.max(1, lip * k);
    for (let y = 0; y < h; y++) {
      let xf = -1;
      for (let x = x1; x >= x0; x--) if (m[(y * w + x) * 4 + 2] > 127) { xf = x; break; }
      if (xf < 0) continue;
      for (let x = Math.max(x0, Math.floor(xf - lw)); x <= xf + 1 && x < w; x++) {
        const i = (y * w + x) * 4;
        // the inner edge of the ring anti-aliased over a pixel
        const a = Math.min(1, Math.max(0, x - (xf - lw)));
        for (let c = 0; c < 3; c++) e[i + c] = e[i + c] * (1 - a) + rgb[c] * a;
      }
    }
  }
}

const hexRgb = (c: string): [number, number, number] => {
  const x = ctx2d(1, 1);
  x.fillStyle = c;
  x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
};

async function draw(sprite: string, w: AssetWidth, lv: Livery, decals: readonly Decal[]): Promise<string> {
  const id = spriteOf(sprite);
  const file = fileOf(id);
  const d = layoutOf(id);
  const h = Math.round((d.h * w) / d.w);
  const [pr] = await Promise.all([prep(file, w, h), decals.some((x) => x.kind !== 'logo' || x.text) ? fontsReady() : null]);
  const k = w / d.w;
  const px = pr.px.slice();
  const layers = lv.plain ? [] : bodyLayers(id, lv.body);
  // fin: the livery colour, the scheme's second colour over its areas, swept stripes, the decals (plain: white + decals)
  let finP: Uint8ClampedArray | null = null;
  if (!lv.plain || decals.length) {
    const fc = ctx2d(w, h);
    fc.fillStyle = lv.plain ? '#ffffff' : lv.primary;
    fc.fillRect(0, 0, w, h);
    if (!lv.plain) {
      fc.fillStyle = lv.secondary;
      for (const poly of finSecondAreas(id, lv.tail)) fillPoly(fc, poly, k);
      for (const l of layers.filter((x) => x.fin)) {
        fc.fillStyle = l.color;
        for (const poly of l.polys) fillPoly(fc, poly, k);
      }
    }
    paintDecals(fc, decals, lv, k);
    finP = fc.getImageData(0, 0, w, h).data;
  }
  // fuselage: body, belly, stripes, nose, then the decals (nothing at all = left as drawn)
  let bodyP: Uint8ClampedArray | null = null;
  if (layers.length || decals.length) {
    const bc = ctx2d(w, h);
    bc.fillStyle = '#ffffff';
    bc.fillRect(0, 0, w, h);
    for (const l of layers) {
      bc.fillStyle = l.color;
      for (const poly of l.polys) fillPoly(bc, poly, k);
    }
    paintDecals(bc, decals, lv, k);
    bodyP = bc.getImageData(0, 0, w, h).data;
  }
  // cowls: their own colour (the tail colour by default) and the intake lips; plain liveries leave them as drawn
  let cowlP: Uint8ClampedArray | null = null;
  if (!lv.plain) {
    const ec = ctx2d(w, h);
    ec.fillStyle = engineColour(lv);
    ec.fillRect(0, 0, w, h);
    cowlP = ec.getImageData(0, 0, w, h).data;
    if (lv.body?.lip && d.eng?.length) paintLips(cowlP, pr.m, w, h, k, d.eng, hexRgb(lv.body.lip));
  }
  // where the decals are (their lines are kept faint)
  let decalA: Uint8ClampedArray | null = null;
  if (decals.length) {
    const dc = ctx2d(w, h);
    paintDecals(dc, decals, lv, k);
    decalA = dc.getImageData(0, 0, w, h).data;
  }
  paintRegions(px, pr.m, pr.sh, [finP, bodyP, cowlP], decalA);
  const out = ctx2d(w, h);
  out.putImageData(new ImageData(px, w, h), 0, 0);
  const blob = await new Promise<Blob | null>((res) => out.canvas.toBlob(res, 'image/webp', 0.92));
  if (!blob) throw new Error('compose');
  return URL.createObjectURL(blob);
}
