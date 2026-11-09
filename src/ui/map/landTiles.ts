// v0.19 (perf) the flat map's land as cached raster tiles. It was one SVG of 59k points (land, coasts, borders,
// graticule) in an oversized layer: every few hundred px of a pan, and at the end of every gesture, the whole layer
// was painted again from the vectors on the main thread (on an iPad: a dropped frame or several each time).
// Now the land is drawn once per zoom into 256 px tiles, off the main thread (a worker with an OffscreenCanvas, else
// here, a tile at a time), and the tiles sit in a layer that a gesture only moves (a CSS transform: compositor work).
// A low-resolution copy of the whole world lies under the tiles, so a tile not drawn yet shows soft land, not sea.
//
// Pure parts (geometry, painting, tile maths) are exported for the worker and the tests; LandLayer is the DOM side.

import { geoGraticule10, geoPath } from 'd3-geo';
import { baseSpec, BASE_W, type LandGeo, type LandInk, type LandSet, paintLand, TILE, tileRange, tileSpec, type TileSpec } from './landPaint';
import { MAP_H, loadMapData, projection, worldGeo } from './mapData';

export { BASE_W, TILE, paintLand, tileRange, tileSpec, baseSpec, type LandGeo, type LandInk, type LandSet, type TileSpec };

/** Tiles kept (on screen or not) before the least recently used go (at most ~1 MB each on a 2× screen). */
export const TILE_CAP = 64;

/** A d3 path context that records rings into flat arrays. */
class Rec {
  xy: number[] = [];
  starts: number[] = [];
  moveTo(x: number, y: number) { this.starts.push(this.xy.length / 2); this.xy.push(x, y); }
  lineTo(x: number, y: number) { this.xy.push(x, y); }
  closePath() { /* rings are closed when drawn */ }
  arc() { /* points: none in these layers */ }
  set(): LandSet {
    const n = this.starts.length;
    const xy = Float32Array.from(this.xy);
    const starts = Uint32Array.from([...this.starts, this.xy.length / 2]);
    const box = new Float32Array(n * 4);
    for (let r = 0; r < n; r++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = starts[r]; i < starts[r + 1]; i++) {
        const x = xy[i * 2], y = xy[i * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      box.set([x0, y0, x1, y1], r * 4);
    }
    return { xy, starts, box };
  }
}

let geoCache: LandGeo | null = null;

/** The land geometry in map units (null until the world map has loaded): the same stream as the old SVG paths. */
export function landGeo(): LandGeo | null {
  if (geoCache) return geoCache;
  const w = worldGeo();
  if (!w) return null;
  const proj = projection(0);
  const rec = (obj: Parameters<ReturnType<typeof geoPath>>[0]) => {
    const r = new Rec();
    geoPath(proj, r as unknown as CanvasRenderingContext2D)(obj);
    return r.set();
  };
  const land = rec(w.land);
  let y0 = Infinity, y1 = -Infinity;
  for (let r = 0; r < land.starts.length - 1; r++) { y0 = Math.min(y0, land.box[r * 4 + 1]); y1 = Math.max(y1, land.box[r * 4 + 3]); }
  geoCache = { land, borders: rec(w.borders), grid: rec(geoGraticule10()), y0, y1 };
  return geoCache;
}

// ---------- drawing service: a worker when it can, else this thread ----------

type Job = { key: string; spec: TileSpec; prio: number; done: (png: Blob | null) => void };

/**
 * The tile painter (one per page): a queue served by the worker (a few at a time), nearest the middle first. Each tile
 * comes back as a PNG, shown by an <img>: a browser composites images without painting them (a canvas per tile cost
 * Chromium a stall at the next commit), and a decoded image is shared by every copy of it.
 */
class Painter {
  private worker: Worker | null = null;
  private failed = false;
  private sent = false;
  private inkKey = '';
  private ink: LandInk | null = null;
  private queue: Job[] = [];
  private busy = new Map<number, Job>();
  private seq = 0;
  private timer = 0;
  /** Bumped when the colours change: answers drawn with old colours are dropped. */
  gen = 0;

  setInk(ink: LandInk) {
    const k = JSON.stringify(ink);
    if (k === this.inkKey) return;
    this.inkKey = k;
    this.ink = ink;
    this.gen++;
    const old = this.queue;
    this.queue = [];
    for (const j of old) j.done(null);
    if (this.worker) this.worker.postMessage({ ink });
  }

  /** Asks for a raster; a newer ask with the same key replaces a queued one. */
  ask(key: string, spec: TileSpec, prio: number, done: Job['done']) {
    const q = this.queue.findIndex((j) => j.key === key);
    if (q >= 0) this.queue.splice(q, 1);
    for (const j of this.busy.values()) if (j.key === key) return;
    this.queue.push({ key, spec, prio, done });
    this.pump();
  }

  /** Whether a raster is queued or being drawn. */
  asked(key: string) {
    if (this.queue.some((j) => j.key === key)) return true;
    for (const j of this.busy.values()) if (j.key === key) return true;
    return false;
  }

  /** Drops queued asks the caller no longer wants. */
  prune(keep: (key: string) => boolean) {
    const drop: Job[] = [];
    this.queue = this.queue.filter((j) => keep(j.key) || (drop.push(j), false));
    for (const j of drop) j.done(null);
  }

  private start(): boolean {
    if (this.worker || this.failed) return !!this.worker;
    const geo = landGeo();
    if (!geo) return false;
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas');
      const w = new Worker(new URL('./landTileWorker.ts', import.meta.url), { type: 'module' });
      const fallBack = (why: string) => {
        // The worker cannot draw here: this thread draws from now on.
        console.info('[Block Hours] map tiles drawn on the main thread:', why);
        this.failed = true;
        w.terminate();
        this.worker = null;
        for (const j of this.busy.values()) this.queue.unshift(j);
        this.busy.clear();
        this.pump();
      };
      w.onmessage = (e: MessageEvent<{ id: number; png?: Blob; gen?: number; error?: string }>) => {
        if (e.data.error) { fallBack(e.data.error); return; }
        const job = this.busy.get(e.data.id);
        this.busy.delete(e.data.id);
        if (job) job.done(e.data.gen === this.gen ? e.data.png ?? null : null);
        this.pump();
      };
      w.onerror = (e) => { e.preventDefault?.(); fallBack('worker error'); };
      // A copy of the geometry (this thread keeps its own for the fallback).
      w.postMessage({ geo: { ...geo, land: copySet(geo.land), borders: copySet(geo.borders), grid: copySet(geo.grid) }, ink: this.ink });
      this.worker = w;
      return true;
    } catch {
      this.failed = true;
      return false;
    }
  }

  private pump() {
    if (!this.ink || !this.queue.length) return;
    if (!landGeo()) return;
    if (!this.sent) { this.sent = true; this.start(); }
    this.queue.sort((a, b) => a.prio - b.prio);
    if (this.worker) {
      // A few in flight keeps the worker busy without a long queue there that can no longer be pruned.
      while (this.busy.size < 3 && this.queue.length) {
        const job = this.queue.shift()!;
        const id = ++this.seq;
        this.busy.set(id, job);
        this.worker.postMessage({ id, spec: job.spec, gen: this.gen });
      }
      return;
    }
    // This thread: one raster per task, between frames.
    if (this.timer || this.busy.size) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const job = this.queue.shift();
      const geo = landGeo();
      if (!job || !geo || !this.ink) { this.pump(); return; }
      const s = job.spec;
      const cv = document.createElement('canvas');
      cv.width = Math.ceil(s.w * s.dpr);
      cv.height = Math.ceil(s.h * s.dpr);
      const c = cv.getContext('2d');
      if (!c) { job.done(null); return; }
      paintLand(c, geo, this.ink, s.sc, s.px, s.py, s.w, s.h, s.dpr);
      const id = ++this.seq;
      const gen = this.gen;
      this.busy.set(id, job);
      cv.toBlob((png) => {
        this.busy.delete(id);
        cv.width = 0;
        job.done(gen === this.gen ? png : null);
        this.pump();
      }, 'image/png');
    }, 0);
  }
}

const copySet = (s: LandSet): LandSet => ({ xy: s.xy.slice(), starts: s.starts.slice(), box: s.box.slice() });

let painter: Painter | null = null;
const thePainter = () => (painter ??= new Painter());

/** Whether this page can draw land rasters at all (a 2D canvas and blob URLs: not in a test DOM). */
let canDraw: boolean | null = null;
export function rasterLandOk(): boolean {
  if (canDraw === null) {
    try { canDraw = typeof document !== 'undefined' && typeof URL.createObjectURL === 'function' && !!document.createElement('canvas').getContext('2d'); } catch { canDraw = false; }
  }
  return canDraw;
}

/** The theme's land colours, read from CSS custom properties on `el`. */
export function readLandInk(el: Element): LandInk {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { land0: v('--map-land-0', '#1a2640'), land1: v('--map-land-1', '#131d33'), coast: v('--map-coast', 'rgba(120,160,230,0.28)'), border: v('--map-border', 'rgba(150,175,230,0.13)'), grid: v('--map-grid', 'rgba(120,150,210,0.07)') };
}

// ---------- the DOM side ----------

/** The live view as WorldMap has it: world point p shows at screen ((p × k + x) × s + ox, (p × k + y) × s + oy). */
export interface LandView { k: number; x: number; y: number; s: number; ox: number; oy: number; w: number; h: number; dpr: number; ex: number; ey: number }

interface TileSet { sc: number; el: HTMLDivElement; tiles: Map<string, HTMLImageElement>; want: Set<string> }

/**
 * Every tile drawn and decoded (key: colours generation|scale|tx|ty), least recently used first; kept across remounts
 * (a tab switch back to the Map finds its tiles). Tiles on screen are never dropped.
 */
const cache = new Map<string, HTMLImageElement>();
/** The world fallback raster per colours generation (decoded). */
let baseImg: { gen: number; img: HTMLImageElement } | null = null;

/**
 * Draws the part [x0, x1) × [y0, y1) (source px; x unwrapped: the source repeats every `period` px east–west) of a
 * raster into `cv`, sized to that part. A composited bitmap scaled up a long way stays this small: a layer as wide as
 * the zoomed world (tens of thousands of px) is slow to composite under the map's tilt, and wastes memory anywhere.
 */
export function cropDraw(cv: HTMLCanvasElement, src: CanvasImageSource, period: number, srcY: number, x0: number, y0: number, x1: number, y1: number) {
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } else cv.getContext('2d')?.clearRect(0, 0, w, h);
  const c = cv.getContext('2d');
  if (!c) return;
  for (let k = Math.floor(x0 / period); k <= Math.floor((x1 - 1) / period); k++) c.drawImage(src, k * period - x0, srcY - y0);
}

/**
 * A crop [x0, y0, x1, y1] that holds the box [a0, b0, a1, b1] (source px) with `m` spare, within rows [r0, r1); null if
 * `cur` already holds the box and is not far bigger than it needs (after a zoom in, a crop of the whole world would be
 * scaled up to a huge layer again).
 */
export function cropFor(cur: number[] | null, a0: number, b0: number, a1: number, b1: number, m: number, r0: number, r1: number): [number, number, number, number] | null {
  const top = Math.max(r0, b0);
  const bot = Math.min(r1, b1);
  const next: [number, number, number, number] = [Math.floor(a0 - m), Math.max(r0, Math.floor(b0 - m)), Math.ceil(a1 + m), Math.min(r1, Math.ceil(b1 + m))];
  if (cur && cur[0] <= a0 && cur[2] >= a1 && cur[1] <= top && cur[3] >= bot) {
    const area = (c: number[]) => Math.max(1, c[2] - c[0]) * Math.max(1, c[3] - c[1]);
    if (area(cur) <= 3 * area(next)) return null;
  }
  return next;
}

const forget = (img: HTMLImageElement) => {
  const url = img.src;
  img.removeAttribute('src');
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
};

function remember(key: string, img: HTMLImageElement) {
  cache.set(key, img);
  if (cache.size <= TILE_CAP) return;
  for (const [k, old] of cache) {
    if (cache.size <= TILE_CAP) break;
    if (old.isConnected) continue;
    forget(old);
    cache.delete(k);
  }
}

/** Drops the tiles of older colours not on screen. */
function forgetGen(gen: number) {
  for (const [k, img] of cache) {
    if (k.startsWith(`${gen}|`) || img.isConnected) continue;
    forget(img);
    cache.delete(k);
  }
}

/** An <img> of a PNG, resolved once it is decoded (so it never shows half drawn); null if it cannot be. */
function imgOf(png: Blob, cls: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.className = cls;
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.src = URL.createObjectURL(png);
  return (img.decode ? img.decode() : Promise.resolve()).then(() => img, () => { forget(img); return null; });
}

const tfOf = (x: number, y: number, r: number) => `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${r.toPrecision(6)})`;

/**
 * The land layer of one map: a world fallback raster (one copy per world in view) under the tiles of the zoom it was
 * last settled at; while a new zoom's tiles come in, the old ones stay under them. Moved per frame with transforms only.
 */
export class LandLayer {
  private root: HTMLDivElement;
  private baseEl: HTMLDivElement;
  /** The world fallback: zoomed out, one <img> of it per world in view; zoomed in, cut to the view (cropDraw): its canvas, the crop and the raster it was cut from. */
  private baseCopies = new Map<number, HTMLImageElement>();
  private baseCv: HTMLCanvasElement | null = null;
  private baseCrop: number[] | null = null;
  private baseFrom: HTMLImageElement | null = null;
  private baseAsked = -1;
  private front: TileSet | null = null;
  private back: TileSet | null = null;
  private gen = -1;
  private last: LandView | null = null;
  private disposed = false;
  private waiting = false;

  constructor(root: HTMLDivElement) {
    this.root = root;
    this.baseEl = document.createElement('div');
    this.baseEl.className = 'land-base';
    root.appendChild(this.baseEl);
  }

  /** The colours (theme): on a change everything is drawn again (the old rasters stay until the new ones are in). */
  setInk(ink: LandInk) {
    const p = thePainter();
    p.setInk(ink);
    if (this.gen === p.gen) return;
    const first = this.gen < 0;
    this.gen = p.gen;
    forgetGen(p.gen);
    if (!first && this.front) { this.dropSet(this.back); this.back = this.front; this.front = null; }
    if (this.last) this.place(this.last, true);
  }

  /**
   * Places the land for the live view. `settle`: the view is at rest: tiles for its exact zoom are asked for. Mid-gesture
   * the tiles there move and scale with the view; a pan at their zoom asks for the ones it brings into view, a pinch
   * asks for none (the world fallback fills the edges until the fingers lift).
   */
  place(v: LandView, settle: boolean) {
    if (this.disposed || this.gen < 0) return;
    this.last = v;
    if (!landGeo()) {
      if (!this.waiting) {
        this.waiting = true;
        void loadMapData().then(() => { this.waiting = false; if (this.last && !this.disposed) this.place(this.last, true); });
      }
      return;
    }
    const sc = v.s * v.k;
    if (!this.front || (settle && Math.abs(this.front.sc / sc - 1) > 1e-4)) this.newSet(sc);
    if (this.back) this.placeSet(this.back, v);
    this.placeSet(this.front!, v);
    this.fill(this.front!, v, settle || Math.abs(this.front!.sc / sc - 1) <= 1e-4);
    this.placeBase(v);
  }

  /**
   * The tiles in view (and half a tile round them) of the front set: shown when drawn, asked for when not. Tiles that
   * have left the view stay in the layer while they are within two tiles of it (no churn as a pan goes to and fro).
   */
  private fill(set: TileSet, v: LandView, ask: boolean) {
    const r = (v.s * v.k) / set.sc;
    const ox = v.x * v.s + v.ox;
    const oy = v.y * v.s + v.oy;
    const [c0, r0, c1, r1] = tileRange(-v.ex - TILE * 0.5 * r, -v.ey - TILE * 0.5 * r, v.w + v.ex + TILE * 0.5 * r, v.h + TILE * 0.5 * r, ox, oy, r);
    // Rows past the map's own top and bottom are never seen (beyond the tilt's lean at the top).
    const maxRow = Math.ceil((MAP_H * set.sc) / TILE);
    const y0 = Math.max(r0, -2);
    const y1 = Math.min(r1, maxRow);
    const key = `${c0}|${y0}|${c1}|${y1}|${ask ? 1 : 0}`;
    if ((set as TileSet & { range?: string }).range === key) return;
    (set as TileSet & { range?: string }).range = key;
    const want = new Set<string>();
    const cxs = (c0 + c1) / 2;
    const cys = (y0 + y1) / 2;
    const p = thePainter();
    const gen = p.gen;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const k = `${tx}|${ty}`;
        want.add(k);
        if (set.tiles.has(k)) continue;
        const ck = `${gen}|${set.sc}|${k}`;
        const hit = cache.get(ck);
        if (hit) {
          cache.delete(ck);
          cache.set(ck, hit);
          this.attach(set, k, tx, ty, hit);
          continue;
        }
        if (!ask || p.asked(ck)) continue;
        p.ask(ck, tileSpec(set.sc, tx, ty, v.dpr), Math.hypot(tx - cxs, (ty - cys) * 1.3), (png) => {
          if (!png || gen !== p.gen) return;
          void imgOf(png, 'land-tile').then((img) => {
            if (!img) return;
            if (gen !== p.gen) { forget(img); return; }
            remember(ck, img);
            const cur = this.front;
            if (!this.disposed && cur && cur.sc === set.sc && cur.want.has(k) && !cur.tiles.has(k)) this.attach(cur, k, tx, ty, img);
          });
        });
      }
    }
    set.want = want;
    // Tiles well out of view leave the layer (they stay in the cache).
    for (const [k, img] of set.tiles) {
      if (want.has(k)) continue;
      const [tx, ty] = k.split('|').map(Number);
      if (tx >= c0 - 2 && tx <= c1 + 2 && ty >= y0 - 2 && ty <= y1 + 2) continue;
      img.remove();
      set.tiles.delete(k);
    }
    const pre = `${gen}|${set.sc}|`;
    p.prune((ck) => ck === 'base' || (ck.startsWith(pre) && want.has(ck.slice(pre.length))));
    this.checkBack();
  }

  private attach(set: TileSet, k: string, tx: number, ty: number, img: HTMLImageElement) {
    const e = 1 / (this.last?.dpr ?? 1);
    img.style.left = `${tx * TILE - e}px`;
    img.style.top = `${ty * TILE - e}px`;
    img.style.width = `${TILE + 2 * e}px`;
    img.style.height = `${TILE + 2 * e}px`;
    set.el.appendChild(img);
    set.tiles.set(k, img);
    this.checkBack();
  }

  private complete(set: TileSet) {
    for (const k of set.want) if (!set.tiles.has(k)) return false;
    return set.want.size > 0;
  }

  /** Once every tile in view of the new zoom is in, the old zoom's layer goes (and the fallback is not drawn). */
  private checkBack() {
    const done = !!this.front && this.complete(this.front);
    if (this.back && done) {
      this.dropSet(this.back);
      this.back = null;
    }
    const vis = done && !this.back ? 'hidden' : '';
    if (this.baseEl.style.visibility !== vis) this.baseEl.style.visibility = vis;
  }

  private newSet(sc: number) {
    const el = document.createElement('div');
    el.className = 'land-set';
    this.root.appendChild(el);
    const set: TileSet = { sc, el, tiles: new Map(), want: new Set() };
    if (this.front) {
      // The old zoom stays under the new one until that has filled the view (the older one, if the old was not complete).
      if (this.complete(this.front) || !this.back) { this.dropSet(this.back); this.back = this.front; } else this.dropSet(this.front);
    }
    this.front = set;
  }

  private dropSet(set: TileSet | null) {
    if (!set) return;
    for (const img of set.tiles.values()) img.remove();
    set.el.remove();
  }

  private placeSet(set: TileSet, v: LandView) {
    const r = (v.s * v.k) / set.sc;
    let ox = v.x * v.s + v.ox;
    let oy = v.y * v.s + v.oy;
    // At its own zoom the tiles' pixels sit on the screen's (crisp).
    if (Math.abs(r - 1) < 1e-6) { ox = Math.round(ox * v.dpr) / v.dpr; oy = Math.round(oy * v.dpr) / v.dpr; }
    const tf = tfOf(ox, oy, r);
    if (set.el.style.transform !== tf) set.el.style.transform = tf;
  }

  /** The world fallback, under the tiles: the part of the world in view (and a margin), cut from one raster of it. */
  private placeBase(v: LandView) {
    const p = thePainter();
    const gen = p.gen;
    if (this.baseAsked !== gen && baseImg?.gen !== gen) {
      this.baseAsked = gen;
      p.ask('base', baseSpec(), -1, (png) => {
        if (!png || gen !== p.gen) { if (this.baseAsked === gen) this.baseAsked = -1; return; }
        void imgOf(png, 'land-base-src').then((img) => {
          if (!img) return;
          if (gen !== p.gen) { forget(img); return; }
          if (baseImg) forget(baseImg.img);
          baseImg = { gen, img };
          if (!this.disposed && this.last) this.placeBase(this.last);
        });
      });
    }
    const b = baseSpec();
    const r = (v.s * v.k) / b.sc;
    const ox = v.x * v.s + v.ox;
    const oy = v.y * v.s + v.oy;
    const tf = tfOf(ox, oy, r);
    if (this.baseEl.style.transform !== tf) this.baseEl.style.transform = tf;
    const src = baseImg?.img;
    if (!src) return;
    // Not needed while every tile in view is in (the layer stays, not drawn; its crop waits).
    const vis = this.front && this.complete(this.front) && !this.back ? 'hidden' : '';
    if (this.baseEl.style.visibility !== vis) this.baseEl.style.visibility = vis;
    const a0 = (-v.ex - ox) / r;
    const a1 = (v.w + v.ex - ox) / r;
    if (r <= 2) {
      // Zoomed out: the raster itself, one <img> per world in view (decoded once; shown and hidden for free).
      if (this.baseCv) this.baseCv.style.display = 'none';
      const c0 = Math.floor(a0 / BASE_W);
      const c1 = Math.floor(a1 / BASE_W);
      for (const [c, img] of this.baseCopies) if (c < c0 || c > c1 || img.src !== src.src) { img.remove(); this.baseCopies.delete(c); }
      for (let c = c0; c <= c1; c++) {
        if (this.baseCopies.has(c)) continue;
        const img = new Image();
        img.className = 'land-base-img';
        img.alt = '';
        img.draggable = false;
        img.src = src.src;
        const st = img.style;
        st.left = `${c * BASE_W}px`;
        st.top = `${b.py}px`;
        st.width = `${b.w}px`;
        st.height = `${b.h}px`;
        this.baseEl.appendChild(img);
        this.baseCopies.set(c, img);
      }
      return;
    }
    // Zoomed in: a world-sized image would be scaled up to a huge layer (slow to composite under the map's tilt), so a
    // canvas holds the part of it in view and half the view's width spare all round, cut again when the view leaves it.
    for (const img of this.baseCopies.values()) img.remove();
    this.baseCopies.clear();
    if (vis && this.baseCv) return;
    const crop = cropFor(this.baseFrom === src ? this.baseCrop : null, a0, (-v.ey - oy) / r, a1, (v.h - oy) / r, (a1 - a0) / 2 + 4, Math.floor(b.py), Math.ceil(b.py + b.h));
    if (!this.baseCv) {
      this.baseCv = document.createElement('canvas');
      this.baseCv.className = 'land-base-img';
      this.baseEl.appendChild(this.baseCv);
    }
    if (this.baseCv.style.display) this.baseCv.style.display = '';
    if (!crop) return;
    this.baseCrop = crop;
    this.baseFrom = src;
    cropDraw(this.baseCv, src, BASE_W, b.py, crop[0], crop[1], crop[2], crop[3]);
    const st = this.baseCv.style;
    st.left = `${crop[0]}px`;
    st.top = `${crop[1]}px`;
    st.width = `${crop[2] - crop[0]}px`;
    st.height = `${crop[3] - crop[1]}px`;
  }

  destroy() {
    this.disposed = true;
    this.dropSet(this.front);
    this.dropSet(this.back);
    this.front = this.back = null;
    if (this.baseCv) this.baseCv.width = 0;
    this.baseCv = null;
    for (const img of this.baseCopies.values()) img.remove();
    this.baseCopies.clear();
    this.baseEl.remove();
  }
}
