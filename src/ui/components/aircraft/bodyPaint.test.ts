// v0.10 body paint: the fuselage masks made by scripts/sprites.py (G channel) stay on the fuselage tube and off the
// fin and the engines; the body tint changes only masked pixels; the paint geometry and the livery data are sane.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BODY_PRESETS, bodyPreset } from '../../../data/livery';
import type { Livery } from '../../../engine/core/types';
import { normaliseLivery } from '../../../engine/ops/paint';
import { bellyPoly, bodyColourAt, bodyLayers, inPoly, stripeLine, tubeAt, windowShare } from './bodyPaint';
import { applyTints, tintKey } from './compose';
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

describe('body masks (scripts/sprites.py body_mask)', () => {
  it('every mask is 2048 wide with a body channel that stays on the fuselage tube, off the fin and the engines', () => {
    for (const id of FILES) {
      const d = layoutOf(id);
      const { w, h, px, ch } = readPng(resolve(PUB, `${id}-mask.png`));
      expect([w, h], id).toEqual([d.w, d.h]);
      let body = 0, outside = 0, overlap = 0, tube = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * ch;
          const r = px[i], g = px[i + 1], b = px[i + 2];
          const t = tubeAt(d, x, true);
          const inTube = !!t && y >= t[0] - 3 && y <= t[1] + 3;
          if (inTube) tube++;
          if (g < 128) continue;
          body++;
          if (!inTube) outside++;
          // the fin's and the engines' areas are theirs (anti-aliased edges share a pixel)
          if (r + b > 128) overlap++;
        }
      }
      expect(body / tube, `${id}: the body covers most of the tube`).toBeGreaterThan(0.6);
      // only the thin aerials on the crown (the tube lines are sampled every 8 px, so they fall outside)
      expect(outside / body, `${id}: body pixels outside the tube`).toBeLessThan(0.003);
      expect(overlap / body, `${id}: body over the fin or the engines`).toBeLessThan(0.002);
    }
  }, 120_000);

  it('the wing over the fuselage is left out: below the wing root, behind the engines, a band of the tube is not body', () => {
    // under the wing (the engines' columns) at the window line the mask has a gap where the wing crosses the fuselage
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
      expect(off / Math.max(1, n), `${id}: lower fuselage under the wing left out`).toBeGreaterThan(0.25);
    }
  }, 120_000);
});

describe('body tint', () => {
  it('changes only the pixels the mask covers, never brightens, keeps alpha; body and tail tints are independent', () => {
    const n = 64;
    const p = new Uint8ClampedArray(n * 4), m = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      p.set([200 + (i % 50), 180, 190 + (i % 60), i % 3 ? 255 : 0], i * 4);
      // quarter fin, quarter body, quarter engines, quarter none (and a few soft edges)
      const k = i % 4;
      m.set([k === 0 ? 255 : i === 5 ? 90 : 0, k === 1 ? 255 : i === 9 ? 120 : 0, k === 2 ? 255 : 0, 255], i * 4);
    }
    const before = p.slice();
    const fin = new Uint8ClampedArray(n * 4).fill(40), body = new Uint8ClampedArray(n * 4).fill(120), eng = new Uint8ClampedArray(n * 4).fill(220);
    applyTints(p, m, fin, body, eng);
    for (let i = 0; i < n; i++) {
      expect(p[i * 4 + 3]).toBe(before[i * 4 + 3]);
      const masked = m[i * 4] || m[i * 4 + 1] || m[i * 4 + 2];
      for (let c = 0; c < 3; c++) {
        if (!masked || !before[i * 4 + 3]) expect(p[i * 4 + c]).toBe(before[i * 4 + c]);
        expect(p[i * 4 + c]).toBeLessThanOrEqual(before[i * 4 + c]);
      }
    }
    // no body paint (null): the fuselage stays exactly as drawn
    const q = before.slice();
    applyTints(q, m, fin, null, eng);
    for (let i = 0; i < n; i++) if (i % 4 === 1 && i !== 5) for (let c = 0; c < 3; c++) expect(q[i * 4 + c]).toBe(before[i * 4 + c]);
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
