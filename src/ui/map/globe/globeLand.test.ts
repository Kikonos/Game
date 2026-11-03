// v0.15 the globe's smooth land and borders: Chaikin corner cutting, the border lines (split at the antimeridian), the
// ribbon geometry the anti-aliased lines are drawn from, the land field's size per device, and the field itself drawn
// on a stand-in canvas (orientation: rows from the South Pole up, columns from 180°W).
import type { MultiPolygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { borderLines, chaikin, fieldWidth, landField, ribbons } from './globeLand';
import { vecOf } from './globeLogic';

type Pt = [number, number];

describe('chaikin', () => {
  it('rounds a corner off without moving the ends of an open line', () => {
    const l: Pt[] = [[0, 0], [10, 0], [10, 10]];
    const s = chaikin(l, false, 2);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([10, 10]);
    expect(s.length).toBeGreaterThan(l.length);
    // The corner itself is cut: nothing reaches (10, 0) any more, and nothing leaves the original's hull.
    for (const p of s) {
      expect(Math.hypot(p[0] - 10, p[1])).toBeGreaterThan(1);
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(10);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(10);
    }
  });

  it('doubles a ring each round and keeps it closed (no repeated end point)', () => {
    const sq: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(chaikin(sq, true, 1)).toHaveLength(8);
    expect(chaikin(sq, true, 2)).toHaveLength(16);
  });

  it('leaves a two-point line as it is', () => {
    expect(chaikin([[0, 0], [5, 5]], false, 2)).toEqual([[0, 0], [5, 5]]);
  });
});

describe('borderLines', () => {
  it('splits a line where it runs along or jumps across the antimeridian', () => {
    const out = borderLines([[[170, 60], [179.995, 61], [-179.995, 62], [-170, 63]], [[10, 10], [11, 11], [12, 10]]]);
    // The first line breaks at its antimeridian segment into two; the second stays whole (and gets smoothed).
    expect(out).toHaveLength(3);
    expect(out[0][0]).toEqual([170, 60]);
    expect(out[1][out[1].length - 1]).toEqual([-170, 63]);
    expect(out[2].length).toBeGreaterThan(3);
  });
});

describe('ribbons', () => {
  it('lays two vertices per point, with the points either side, and two triangles per segment', () => {
    const r = ribbons([[[0, 0], [10, 0], [20, 5]], [[30, 30]]], 1.5);
    expect(r.side.length).toBe(6);
    expect(Array.from(r.side)).toEqual([-1, 1, -1, 1, -1, 1]);
    expect(r.idx.length).toBe(12);
    const at = (a: Float32Array, v: number) => [a[v * 3], a[v * 3 + 1], a[v * 3 + 2]];
    const near = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5));
    near(at(r.pos, 2), vecOf(10, 0, 1.5));
    near(at(r.prev, 2), vecOf(0, 0, 1.5));
    near(at(r.next, 2), vecOf(20, 5, 1.5));
    // The ends point to themselves on their open side.
    near(at(r.prev, 0), vecOf(0, 0, 1.5));
    near(at(r.next, 5), vecOf(20, 5, 1.5));
    expect(Math.max(...r.idx)).toBe(5);
  });
});

describe('fieldWidth', () => {
  it('is 8192 texels on a tablet whose GPU takes it, 4096 on a phone or a smaller GPU', () => {
    expect(fieldWidth(16384, false)).toBe(8192);
    expect(fieldWidth(8192, false)).toBe(8192);
    expect(fieldWidth(16384, true)).toBe(4096);
    expect(fieldWidth(4096, false)).toBe(4096);
  });
});

describe('landField', () => {
  /** A stand-in 2D canvas: fills only the rectangles of a path (enough for a box of land), honouring the transform. */
  function fakeCanvas(w: number, h: number) {
    const px = new Uint8ClampedArray(w * h * 4);
    let tx = 0;
    let ty = 0;
    let style = '#000';
    const ctx = {
      setTransform(_a: number, _b: number, _c: number, _d: number, e: number, f: number) { tx = e; ty = f; },
      set fillStyle(s: string) { style = s; },
      fillRect(x: number, y: number, rw: number, rh: number) {
        for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) px[(j * w + i) * 4] = style === '#fff' ? 255 : 0;
      },
      fill(p: { pts: number[][] }) {
        const xs = p.pts.map((q) => q[0] + tx);
        const ys = p.pts.map((q) => q[1] + ty);
        const x0 = Math.max(0, Math.round(Math.min(...xs)));
        const x1 = Math.min(w, Math.round(Math.max(...xs)));
        const y0 = Math.max(0, Math.round(Math.min(...ys)));
        const y1 = Math.min(h, Math.round(Math.max(...ys)));
        for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) px[(j * w + i) * 4] = 255;
      },
      getImageData: () => ({ data: px }),
    };
    return { getContext: () => ctx } as unknown as HTMLCanvasElement;
  }
  class FakePath {
    pts: number[][] = [];
    moveTo(x: number, y: number) { this.pts.push([x, y]); }
    lineTo(x: number, y: number) { this.pts.push([x, y]); }
    closePath() {}
    arc() {}
  }

  it('puts the land the right way up: north in the last rows, 180°W in the first column', () => {
    const g = globalThis as unknown as { Path2D?: unknown };
    const had = g.Path2D;
    g.Path2D = FakePath;
    try {
      // A box of land from 0° to 90°E and 0° to 45°N, on a 64 × 32 field.
      const box: MultiPolygon = { type: 'MultiPolygon', coordinates: [[[[0, 0], [0, 45], [90, 45], [90, 0], [0, 0]]]] };
      const f = landField(box, 64, fakeCanvas);
      expect(f).toHaveLength(64 * 32);
      const at = (lon: number, lat: number) => f[Math.floor(((lat + 90) / 180) * 32) * 64 + Math.floor(((lon + 180) / 360) * 64)];
      expect(at(45, 22)).toBe(255);
      expect(at(45, -22)).toBe(0);
      expect(at(-45, 22)).toBe(0);
      expect(at(135, 22)).toBe(0);
    } finally {
      g.Path2D = had;
    }
  });
});
