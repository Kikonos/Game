// Paint masks (scripts/sprites.py segment): body on the fuselage tube with no holes at the fairings, fin above the
// crown, cowls off the exhaust; the painting model keeps the light and paints only the regions; geometry and data sane.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BODY_PRESETS, bodyPreset } from '../../../data/livery';
import type { Livery } from '../../../engine/core/types';
import { normaliseLivery } from '../../../engine/ops/paint';
import { bellyPoly, bodyColourAt, bodyLayers, inPoly, stripeLine, tubeAt, windowShare } from './bodyPaint';
import { tintKey } from './compose';
import { paintRegions, shadingOf } from './paintModel';
import { fileOf, layoutOf, SPRITE_IDS } from './sprites';

const PUB = resolve(__dirname, '../../../../public/aircraft');

/** A minimal PNG decoder for the masks (8-bit RGB or RGBA, not interlaced). */
function readPng(f: string): { w: number; h: number; px: Uint8Array; ch: number } {
  const b = readFileSync(f);
  let off = 8;
  let w = 0, h = 0, ch = 3;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off), type = b.toString('ascii', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(ch, 'RGB or RGBA').toBeGreaterThan(0);
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const ul = y && x >= ch ? px[(y - 1) * stride + x - ch] : 0;
      let p = v;
      if (ft === 1) p = v + a;
      else if (ft === 2) p = v + up;
      else if (ft === 3) p = v + ((a + up) >> 1);
      else if (ft === 4) {
        const pa = Math.abs(up - ul), pb = Math.abs(a - ul), pc = Math.abs(a + up - 2 * ul);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      }
      px[y * stride + x] = p & 255;
    }
  }
  return { w, h, px, ch };
}

const FILES = [...new Set(SPRITE_IDS.map(fileOf))];

/** The tube (raw crown / belly lines) as a per-pixel test, inset by `inset` px. */
function inTubeAt(d: ReturnType<typeof layoutOf>, x: number, y: number, inset = 0): boolean {
  const t = tubeAt(d, x, true);
  return !!t && y >= t[0] + inset && y <= t[1] - inset;
}

describe('paint masks (scripts/sprites.py segment)', () => {
  it('every mask is 2048 wide; body on the fuselage tube, fin above the crown, cowl between its trailing edge and lip; no overlaps', () => {
    for (const id of FILES) {
      const d = layoutOf(id);
      const { w, h, px, ch } = readPng(resolve(PUB, `${id}-mask.png`));
      expect([w, h], id).toEqual([d.w, d.h]);
      expect(d.eng?.length, `${id}: engines`).toBeGreaterThan(0);
      let body = 0, outside = 0, overlap = 0, tube = 0, fin = 0, finLow = 0, cowl = 0, cowlOff = 0, cover = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * ch;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          cover += (r + g + b) / 255;
          const inTube = inTubeAt(d, x, y, -3);
          if (inTube) tube++;
          if (r >= 128) {
            fin++;
            // the fin (rudder and dorsal fillet included) stands above the fuselage crown
            const tc = tubeAt(d, x, true);
            if (tc && y > tc[0] + 3) finLow++;
          }
          if (b >= 128) {
            cowl++;
            // the cowl lies between an engine's trailing edge and its lip: never on the exhaust behind it
            if (!d.eng!.some(([aft, front]) => x >= aft - 2 && x <= front + 4)) cowlOff++;
          }
          if (g < 128) continue;
          body++;
          // the belly fairing bulges below the tube's straight belly line under the wing: fuselage too
          const t = tubeAt(d, x, true);
          const fairing = !!d.wing && !!t && x >= d.wing[0] - 0.12 * (d.nose - d.tail) && x <= d.wing[1] && y > t[1];
          if (!inTube && !fairing) outside++;
          // regions never overlap (anti-aliased edges share a pixel)
          if (r + b > 128) overlap++;
        }
      }
      expect(body / tube, `${id}: the body covers most of the tube`).toBeGreaterThan(0.6);
      // only the thin aerials on the crown (the tube lines are sampled every 8 px, so they fall outside)
      expect(outside / body, `${id}: body pixels outside the tube`).toBeLessThan(0.004);
      expect(overlap / body, `${id}: body over the fin or the cowls`).toBeLessThan(0.002);
      expect(finLow / fin, `${id}: fin below the crown`).toBeLessThan(0.01);
      expect(cowlOff, `${id}: cowl paint behind the cowl (exhaust) or off the engines`).toBe(0);
      expect(cowl, id).toBeGreaterThan(0);
      // paint only on the airframe: the regions together never cover more than the silhouette
      expect(cover / d.silArea, `${id}: paint coverage vs the silhouette`).toBeLessThan(1.01);
    }
  }, 120_000);

  it('the wing over the fuselage is left out: below the wing root, behind the engines, a band of the tube is not body', () => {
    for (const id of FILES) {
      const d = layoutOf(id);
      if (!d.wing) continue;
      const { w, px, ch } = readPng(resolve(PUB, `${id}-mask.png`));
      let off = 0, n = 0;
      for (let x = d.wing[0]; x <= d.wing[1]; x += 4) {
        const t = tubeAt(d, x);
        if (!t) continue;
        for (let y = Math.round(t[0] + 0.55 * (t[1] - t[0])); y < t[1] - 2; y += 3) {
          n++;
          if (px[(y * w + x) * ch + 1] < 128) off++;
        }
      }
      expect(off / Math.max(1, n), `${id}: lower fuselage under the wing left out`).toBeGreaterThan(0.1);
    }
  }, 120_000);

  it('no unpainted hole in the fuselage: wing-body and belly fairings are body (only the pylons between body and cowl stay out)', () => {
    for (const id of FILES) {
      const d = layoutOf(id);
      const { w, h, px, ch } = readPng(resolve(PUB, `${id}-mask.png`));
      // unpainted pixels inside the tube (inset 2 px), labelled; a hole is a piece that never reaches the tube's edge
      const un = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch;
        if (inTubeAt(d, x, y, 2) && Math.max(px[i], px[i + 1], px[i + 2]) < 128) un[y * w + x] = 1;
      }
      const seen = new Uint8Array(w * h);
      const holes: { n: number; x0: number; x1: number }[] = [];
      for (let s = 0; s < w * h; s++) {
        if (!un[s] || seen[s]) continue;
        const stack = [s];
        seen[s] = 1;
        let n = 0, edge = false, x0 = w, x1 = 0;
        while (stack.length) {
          const q = stack.pop()!, x = q % w, y = (q - x) / w;
          n++;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h || !inTubeAt(d, X, Y, 2)) { edge = true; continue; }
            const k = Y * w + X;
            if (un[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
          }
        }
        if (!edge && n > 60) holes.push({ n, x0, x1 });
      }
      // pylons: inside an engine's columns
      const bad = holes.filter((o) => !d.eng!.some(([aft, front]) => o.x1 >= aft - 0.5 * (front - aft) && o.x0 <= front));
      expect(bad, `${id}: unpainted holes in the fuselage`).toEqual([]);
    }
  }, 120_000);
});

describe('painting model (paintModel.ts)', () => {
  /** A small synthetic sprite: a lit cylinder with panel lines and a window row, one region per third. */
  function scene() {
    const w = 60, h = 30, n = w * h;
    const px = new Uint8ClampedArray(n * 4), m = new Uint8ClampedArray(n * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = 250 - Math.round(((y - 8) / 22) ** 2 * 80);
      if (x % 15 === 0) v -= 60; // panel line
      if (y === 12 && x % 4 === 1) v = 30; // window
      px.set([v, v, v, x > 55 ? 0 : 255], i);
      // fin | body | cowl by column thirds, one soft column at each seam
      const r = x < 20 ? 255 : x === 20 ? 128 : 0, b = x > 40 ? 255 : x === 40 ? 127 : 0;
      m.set([r, Math.max(0, 255 - r - b), b, 255], i);
      if (y > 27) m.set([0, 0, 0, 255], i); // unpainted strip
    }
    return { w, h, px, m };
  }
  const solid = (n: number, rgb: [number, number, number]) => {
    const a = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) a.set([...rgb, 255], i * 4);
    return a;
  };

  it('paints only the regions, keeps every alpha; white paint gives the art back exactly', () => {
    const { w, h, px, m } = scene();
    const sh = shadingOf(px, m, w, h);
    const white = solid(w * h, [255, 255, 255]);
    const q = px.slice();
    paintRegions(q, m, sh, [white, white, white]);
    expect([...q]).toEqual([...px]);
    const navy = solid(w * h, [19, 41, 75]);
    const p = px.slice();
    paintRegions(p, m, sh, [navy, navy, null]);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      expect(p[j + 3]).toBe(px[j + 3]);
      const painted = (m[j] || m[j + 1]) && px[j + 3];
      if (!painted) for (let c = 0; c < 3; c++) expect(p[j + c], `pixel ${i}`).toBe(px[j + c]);
    }
  });

  it('keeps the lighting: dark paint still shows the cylinder shading, the panel lines and the windows', () => {
    const { w, h, px, m } = scene();
    const sh = shadingOf(px, m, w, h);
    const navy = solid(w * h, [19, 41, 75]);
    const p = px.slice();
    paintRegions(p, m, sh, [navy, navy, navy]);
    const at = (x: number, y: number) => p[(y * w + x) * 4 + 2];
    // lit top brighter than the shaded belly
    expect(at(27, 8)).toBeGreaterThan(at(27, 26) + 8);
    // a panel line and a window stay darker than the paint beside them
    expect(at(30, 20)).toBeLessThan(at(28, 20) - 4);
    expect(at(25, 12)).toBeLessThan(at(27, 12) - 15);
    // the paint reads as its colour where the art is lit white
    expect(Math.abs(at(27, 8) - 75)).toBeLessThan(40);
  });

  it('old liveries keep their look: no body paint, the same tint key; plain stays untouched', () => {
    const old: Livery = { primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' };
    expect(tintKey(old)).toBe('#1e4fd8|#3ee6ff|sweep');
    expect(normaliseLivery(old)).toEqual(old);
    expect(bodyLayers('a320ceo', undefined)).toEqual([]);
    expect(tintKey({ ...old, plain: true, body: { color: '#ff0000' } })).toBeNull();
    expect(bodyColourAt('b772', old, 1000, 300)).toBe('#ffffff');
  });
});

describe('body paint geometry and data', () => {
  it('belly, stripes (window line, sweep) and nose on every sprite; presets normalise to themselves', () => {
    const lv: Livery = { primary: '#7a1f2b', secondary: '#f5c451', tail: 'solid' };
    for (const id of FILES) {
      const d = layoutOf(id);
      const mid = Math.round((d.tail + d.nose) / 2);
      const t = tubeAt(d, mid)!;
      expect(t, id).not.toBeNull();
      expect(windowShare(d)).toBeGreaterThan(0.1);
      expect(windowShare(d)).toBeLessThan(0.75);
      // the belly polygon is below the split line at mid-fuselage
      const split = { color: '#000000', split: 0.6, tilt: 0 };
      const poly = bellyPoly(d, split);
      expect(inPoly(poly, mid, t[0] + 0.8 * (t[1] - t[0])), id).toBe(true);
      expect(inPoly(poly, mid, t[0] + 0.3 * (t[1] - t[0])), id).toBe(false);
      // a swept stripe ends up on the fin
      const line = stripeLine(d, { color: '#000000', y: 0.4, h: 0.06, sweep: true });
      expect(Math.min(...line.map((p) => p[1])), id).toBeLessThan(d.crown - 0.3 * (d.crown - d.finQuad[2][1]));
      for (const p of BODY_PRESETS) {
        const b = bodyPreset(p.id, lv);
        const full = normaliseLivery({ ...lv, body: b });
        expect(full.body, p.id).toEqual(b);
      }
    }
    const custom = normaliseLivery({ ...lv, body: { color: '#ABC', belly: { color: '#123456', split: 2, tilt: -3 }, stripes: [1, 2, 3, 4].map((i) => ({ color: '#00ff00', y: i / 5, h: 0.5 })), nose: 'red', engines: '#ffffff', lip: '#ff0000' } });
    expect(custom.body).toEqual({
      color: '#aabbcc', belly: { color: '#123456', split: 0.9, tilt: -1 }, stripes: [1, 2, 3].map((i) => ({ color: '#00ff00', y: i / 5, h: 0.3 })), engines: '#ffffff', lip: '#ff0000',
    });
    // the sticker ground follows the body paint
    const full = { ...lv, body: { color: '#123456' } };
    const d = layoutOf('a320ceo');
    const x = Math.round((d.tail + d.nose) / 2), t = tubeAt(d, x)!;
    expect(bodyColourAt('a320ceo', full, x, (t[0] + t[1]) / 2)).toBe('#123456');
  });
});
