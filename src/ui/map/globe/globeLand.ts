// v0.15 the globe's land, coasts and borders, built smooth. The land is a coverage mask (an anti-aliased raster of the
// world atlas's 1:50m land, one byte a texel, 8192 × 4096 on a tablet: about 5 km a texel) that the Earth's shader
// reads with a smooth cubic filter, so the coastline comes out as a soft curve at any zoom rather than the polygon
// corners of the data or the staircase of a magnified texture; the coast line is drawn from the same field, so it
// always sits exactly on the edge of the land. The borders are vector lines, rounded off (Chaikin corner cutting) and
// drawn as screen-space ribbons, anti-aliased, a constant width in px at any zoom.

import { geoEquirectangular, geoPath } from 'd3-geo';
import type { MultiPolygon } from 'geojson';

type Pt = [number, number];

const RAD = Math.PI / 180;

/** Canvas tiles the mask is drawn in (each well inside every browser's canvas limits). */
const TILE_W = 4096;
const TILE_H = 2048;

/**
 * v0.15 the land as a coverage mask, `w` × w/2 texels, one byte each (255: land), rows from the South Pole up (as a
 * texture's first row is v = 0) and columns from 180°W. Drawn in tiles so no canvas grows past 4096 × 2048.
 */
export function landField(land: MultiPolygon, w: number, makeCanvas: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas): Uint8Array {
  const h = w / 2;
  const out = new Uint8Array(w * h);
  const tw = Math.min(TILE_W, w);
  const th = Math.min(TILE_H, h);
  const cv = makeCanvas(tw, th);
  const c = cv.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
  if (!c) throw new Error('no 2D canvas for the globe');
  const proj = geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]).precision(0.05);
  const shape = new Path2D();
  geoPath(proj, shape as unknown as CanvasRenderingContext2D)(land);
  for (let y0 = 0; y0 < h; y0 += th) {
    for (let x0 = 0; x0 < w; x0 += tw) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = '#000';
      c.fillRect(0, 0, tw, th);
      c.setTransform(1, 0, 0, 1, -x0, -y0);
      c.fillStyle = '#fff';
      c.fill(shape);
      const px = c.getImageData(0, 0, tw, th).data;
      for (let y = 0; y < th; y++) {
        const row = (h - 1 - (y0 + y)) * w + x0;
        const src = y * tw * 4;
        for (let x = 0; x < tw; x++) out[row + x] = px[src + x * 4];
      }
    }
  }
  return out;
}

/**
 * Chaikin corner cutting, `iters` rounds: each segment gives way to points at ¼ and ¾ along it, so corners round off
 * (never overshooting the original line). `closed`: a ring (no repeated end point); an open line keeps its ends, so
 * borders still meet each other and the coast where they did.
 */
export function chaikin(pts: Pt[], closed: boolean, iters: number): Pt[] {
  let cur = pts;
  for (let it = 0; it < iters; it++) {
    const n = cur.length;
    if (n < 3) return cur;
    const out: Pt[] = [];
    if (!closed) out.push(cur[0]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = cur[i];
      const b = cur[(i + 1) % n];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(cur[n - 1]);
    cur = out;
  }
  return cur;
}

/** A screen-space ribbon: two vertices per point (side −1 and +1), each with the points before and after it. */
export interface Ribbon {
  pos: Float32Array;
  prev: Float32Array;
  next: Float32Array;
  side: Float32Array;
  idx: Uint32Array;
}

/** Ribbon geometry for open polylines of [lon, lat] at radius r. */
export function ribbons(lines: Pt[][], r: number): Ribbon {
  let nPts = 0;
  let nSeg = 0;
  for (const l of lines) {
    if (l.length < 2) continue;
    nPts += l.length;
    nSeg += l.length - 1;
  }
  const pos = new Float32Array(nPts * 6);
  const prev = new Float32Array(nPts * 6);
  const next = new Float32Array(nPts * 6);
  const side = new Float32Array(nPts * 2);
  const idx = new Uint32Array(nSeg * 6);
  const put = (arr: Float32Array, at: number, p: Pt) => {
    const cl = Math.cos(p[1] * RAD);
    const x = r * cl * Math.cos(p[0] * RAD);
    const y = r * Math.sin(p[1] * RAD);
    const z = -r * cl * Math.sin(p[0] * RAD);
    arr[at] = x;
    arr[at + 1] = y;
    arr[at + 2] = z;
    arr[at + 3] = x;
    arr[at + 4] = y;
    arr[at + 5] = z;
  };
  let v = 0;
  let ii = 0;
  for (const p of lines) {
    const n = p.length;
    if (n < 2) continue;
    const base = v;
    for (let i = 0; i < n; i++) {
      put(pos, v * 3, p[i]);
      put(prev, v * 3, p[Math.max(0, i - 1)]);
      put(next, v * 3, p[Math.min(n - 1, i + 1)]);
      side[v] = -1;
      side[v + 1] = 1;
      v += 2;
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2;
      idx[ii++] = a;
      idx[ii++] = a + 1;
      idx[ii++] = a + 2;
      idx[ii++] = a + 1;
      idx[ii++] = a + 3;
      idx[ii++] = a + 2;
    }
  }
  return { pos, prev, next, side, idx };
}

/** Where a line runs along the antimeridian cut or jumps across it (not a border there). */
const cut = (a: Pt, b: Pt) => (Math.abs(a[0]) > 179.99 && Math.abs(b[0]) > 179.99) || Math.abs(a[0] - b[0]) > 180;

/** v0.15 the borders between countries as smoothed polylines (two rounds of Chaikin), split at the antimeridian. */
export function borderLines(borders: number[][][]): Pt[][] {
  const out: Pt[][] = [];
  for (const l of borders) {
    let run: Pt[] = [];
    const flush = () => {
      if (run.length > 1) out.push(chaikin(run, false, 2));
      run = [];
    };
    for (let i = 0; i < l.length; i++) {
      const p = l[i] as Pt;
      if (i > 0 && cut(l[i - 1] as Pt, p)) flush();
      run.push(p);
    }
    flush();
  }
  return out;
}

/** v0.15 the land field drawn here, on the main thread (a small one to show while the full one is drawn). */
export function landFieldHere(land: MultiPolygon, w: number): Uint8Array {
  return landField(land, w, (cw, ch) => {
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    return cv;
  });
}

/**
 * v0.15 the land field drawn in a worker (landWorker.ts) when it can be, else here; resolves with the mask (see
 * landField). The worker goes as soon as it has answered.
 */
export function drawLandField(land: MultiPolygon, w: number): Promise<Uint8Array> {
  const here = () => landFieldHere(land, w);
  return new Promise((resolve, reject) => {
    const local = () => {
      try {
        resolve(here());
      } catch (e) {
        reject(e);
      }
    };
    let worker: Worker | null = null;
    try {
      worker = typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ? null : new Worker(new URL('./landWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker = null;
    }
    if (!worker) return local();
    const done = () => worker?.terminate();
    worker.onmessage = (e: MessageEvent<{ data?: Uint8Array; error?: string }>) => {
      done();
      if (e.data.data) resolve(e.data.data);
      else local();
    };
    worker.onerror = (e) => {
      e.preventDefault();
      done();
      local();
    };
    worker.postMessage({ land, w });
  });
}

/** v0.15 the mask's width for this device: 8192 texels (about 5 km each) where the GPU takes it, 4096 on a phone. */
export function fieldWidth(maxTextureSize: number, phone: boolean): number {
  return maxTextureSize >= 8192 && !phone ? 8192 : 4096;
}
