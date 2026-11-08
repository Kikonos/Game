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

/** Tiles kept (on screen or not) before the least recently used go. */
export const TILE_CAP = 96;
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

type Job = { key: string; spec: TileSpec; prio: number; done: (img: ImageBitmap | HTMLCanvasElement | null) => void };

/** The tile painter (one per page): a queue served by the worker (a few at a time), nearest the middle first. */
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
    if (k === this.inkKey) return false;
    this.inkKey = k;
    this.ink = ink;
    this.gen++;
    for (const j of this.queue) j.done(null);
    this.queue = [];
    if (this.worker) this.worker.postMessage({ ink });
    return true;
  }

  /** Asks for a raster; a newer ask with the same key replaces a queued one. */
  ask(key: string, spec: TileSpec, prio: number, done: Job['done']) {
    const q = this.queue.findIndex((j) => j.key === key);
    if (q >= 0) this.queue.splice(q, 1);
    if ([...this.busy.values()].some((j) => j.key === key)) return;
    this.queue.push({ key, spec, prio, done });
    this.pump();
  }

  /** Drops queued asks the caller no longer wants. */
  prune(keep: (key: string) => boolean) {
    this.queue = this.queue.filter((j) => {
      if (keep(j.key)) return true;
      j.done(null);
      return false;
    });
  }

  reprioritise(prio: (key: string) => number) {
    for (const j of this.queue) j.prio = prio(j.key);
  }

  private start(): boolean {
    if (this.worker || this.failed) return !!this.worker;
    const geo = landGeo();
    if (!geo) return false;
    try {
      if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') throw new Error('no OffscreenCanvas');
      const w = new Worker(new URL('./landTileWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap; error?: string }>) => {
        const job = this.busy.get(e.data.id);
        this.busy.delete(e.data.id);
        if (e.data.error) {
          // The worker cannot draw here: this thread draws from now on.
          console.info('[Block Hours] map tiles drawn on the main thread:', e.data.error);
          this.failed = true;
          w.terminate();
          this.worker = null;
          if (job) this.queue.unshift(job);
          for (const j of this.busy.values()) this.queue.unshift(j);
          this.busy.clear();
        } else if (job) {
          if ((e.data as { gen?: number }).gen === this.gen) job.done(e.data.bmp ?? null);
          else { e.data.bmp?.close(); job.done(null); }
        }
        this.pump();
      };
      w.onerror = () => { this.failed = true; w.terminate(); this.worker = null; for (const j of this.busy.values()) this.queue.unshift(j); this.busy.clear(); this.pump(); };
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
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      const job = this.queue.shift();
      const geo = landGeo();
      if (job && geo && this.ink) {
        const s = job.spec;
        const cv = document.createElement('canvas');
        cv.width = Math.ceil(s.w * s.dpr);
        cv.height = Math.ceil(s.h * s.dpr);
        const c = cv.getContext('2d');
        if (c) paintLand(c, geo, this.ink, s.sc, s.px, s.py, s.w, s.h, s.dpr);
        job.done(c ? cv : null);
      }
      this.pump();
    }, 0);
  }
}

const copySet = (s: LandSet): LandSet => ({ xy: s.xy.slice(), starts: s.starts.slice(), box: s.box.slice() });

let painter: Painter | null = null;
const thePainter = () => (painter ??= new Painter());

/** Whether this page can draw land rasters at all (a 2D canvas: not in a test DOM). */
let canDraw: boolean | null = null;
export function rasterLandOk(): boolean {
  if (canDraw === null) {
    try { canDraw = typeof document !== 'undefined' && !!document.createElement('canvas').getContext('2d'); } catch { canDraw = false; }
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

interface TileSet { sc: number; el: HTMLDivElement; tiles: Map<string, HTMLCanvasElement>; want: Set<string> }

/**
 * Every tile canvas drawn (key: colours generation|scale|tx|ty), least recently used first; kept across remounts (a
 * tab switch back to the Map finds its tiles). Tiles on screen are never dropped.
 */
const cache = new Map<string, HTMLCanvasElement>();
/** The world fallback raster per colours generation. */
let baseImg: { gen: number; cv: HTMLCanvasElement } | null = null;

function remember(key: string, cv: HTMLCanvasElement) {
  cache.set(key, cv);
  if (cache.size <= TILE_CAP) return;
  for (const [k, old] of cache) {
    if (cache.size <= TILE_CAP) break;
    if (old.isConnected) continue;
    old.width = 0;
    cache.delete(k);
  }
}

/** Drops the tiles of older colours not on screen. */
function forgetGen(gen: number) {
  for (const [k, cv] of cache) {
    if (k.startsWith(`${gen}|`) || cv.isConnected) continue;
    cv.width = 0;
    cache.delete(k);
  }
}

const mkCanvas = (cls: string) => {
  const cv = document.createElement('canvas');
  cv.className = cls;
  return cv;
};

/** Copies a raster (worker bitmap or canvas) into a canvas element. */
function show(img: ImageBitmap | HTMLCanvasElement, cv: HTMLCanvasElement) {
  if (img instanceof HTMLCanvasElement) {
    cv.width = img.width;
    cv.height = img.height;
    cv.getContext('2d')?.drawImage(img, 0, 0);
    return;
  }
  cv.width = img.width;
  cv.height = img.height;
  cv.getContext('2d')?.drawImage(img, 0, 0);
  img.close();
}

const tfOf = (x: number, y: number, r: number) => `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${r.toPrecision(6)})`;

/**
 * The land layer of one map: a world fallback raster (one copy per world in view) under the tiles of the zoom it was
 * last settled at; while a new zoom's tiles come in, the old ones stay under them. Moved per frame with transforms only.
 */
export class LandLayer {
  private root: HTMLDivElement;
  private baseEl: HTMLDivElement;
  private baseCopies = new Map<number, HTMLCanvasElement>();
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
   * Places the land for the live view. `settle`: the view is at rest: tiles for its exact zoom are asked for (also
   * mid-gesture once the zoom has drifted far); otherwise the tiles there are just move and scale with the view.
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
    this.placeBase(v);
    if (!this.front || (settle && Math.abs(this.front.sc / sc - 1) > 1e-4) || Math.abs(Math.log(this.front.sc / sc)) > Math.log(1.6)) this.newSet(sc);
    if (this.back) this.placeSet(this.back, v);
    this.placeSet(this.front!, v);
    this.fill(this.front!, v);
  }

  /** The tiles in view (and half a tile round them) of the front set: shown when drawn, asked for when not. */
  private fill(set: TileSet, v: LandView) {
    const r = (v.s * v.k) / set.sc;
    const ox = v.x * v.s + v.ox;
    const oy = v.y * v.s + v.oy;
    const m = TILE * 0.5 * r;
    const [c0, r0, c1, r1] = tileRange(-v.ex - m, -v.ey - m, v.w + v.ex + m, v.h + m, ox, oy, r);
    const want = new Set<string>();
    const cxs = (c0 + c1) / 2;
    const cys = (r0 + r1) / 2;
    const p = thePainter();
    const gen = p.gen;
    // Rows past the map's own top and bottom are never seen (beyond the tilt's lean at the top).
    const maxRow = Math.ceil((MAP_H * set.sc) / TILE);
    for (let ty = Math.max(r0, -2); ty <= Math.min(r1, maxRow); ty++) {
      for (let tx = c0; tx <= c1; tx++) {
        const k = `${tx}|${ty}`;
        want.add(k);
        if (set.tiles.has(k)) continue;
        const key = `${gen}|${set.sc}|${k}`;
        const hit = cache.get(key);
        if (hit) {
          cache.delete(key);
          cache.set(key, hit);
          this.attach(set, k, tx, ty, hit);
          continue;
        }
        p.ask(key, tileSpec(set.sc, tx, ty, v.dpr), Math.hypot(tx - cxs, (ty - cys) * 1.3), (img) => {
          if (!img || gen !== p.gen) return;
          const cv = mkCanvas('land-tile');
          show(img, cv);
          remember(key, cv);
          const cur = this.front;
          if (!this.disposed && cur && cur.sc === set.sc && cur.want.has(k) && !cur.tiles.has(k)) this.attach(cur, k, tx, ty, cv);
        });
      }
    }
    set.want = want;
    // Tiles out of view leave the layer (they stay in the cache).
    for (const [k, cv] of set.tiles) if (!want.has(k)) { cv.remove(); set.tiles.delete(k); }
    const pre = `${gen}|${set.sc}|`;
    p.prune((key) => key === 'base' || (key.startsWith(pre) && want.has(key.slice(pre.length))));
    this.checkBack();
  }

  private attach(set: TileSet, k: string, tx: number, ty: number, cv: HTMLCanvasElement) {
    const e = 1 / (this.last?.dpr ?? 1);
    cv.style.left = `${tx * TILE - e}px`;
    cv.style.top = `${ty * TILE - e}px`;
    cv.style.width = `${TILE + 2 * e}px`;
    cv.style.height = `${TILE + 2 * e}px`;
    set.el.appendChild(cv);
    set.tiles.set(k, cv);
    this.checkBack();
  }

  private complete(set: TileSet) {
    for (const k of set.want) if (!set.tiles.has(k)) return false;
    return set.want.size > 0;
  }

  /** Once every tile in view of the new zoom is in, the old zoom's layer goes. */
  private checkBack() {
    if (this.back && this.front && this.complete(this.front)) {
      this.dropSet(this.back);
      this.back = null;
    }
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
    for (const cv of set.tiles.values()) cv.remove();
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

  /** The world fallback: one copy per world in view. */
  private placeBase(v: LandView) {
    const p = thePainter();
    const gen = p.gen;
    if (this.baseAsked !== gen && baseImg?.gen !== gen) {
      this.baseAsked = gen;
      p.ask('base', baseSpec(), -1, (img) => {
        if (!img || gen !== p.gen) { if (this.baseAsked === gen) this.baseAsked = -1; return; }
        const cv = mkCanvas('land-base-img');
        show(img, cv);
        if (baseImg && !baseImg.cv.isConnected) baseImg.cv.width = 0;
        baseImg = { gen, cv };
        if (!this.disposed && this.last) this.placeBase(this.last);
      });
    }
    const b = baseSpec();
    const r = (v.s * v.k) / b.sc;
    const ox = v.x * v.s + v.ox;
    const oy = v.y * v.s + v.oy;
    const tf = tfOf(ox, oy, r);
    if (this.baseEl.style.transform !== tf) this.baseEl.style.transform = tf;
    const img = baseImg?.cv;
    if (!img) return;
    // A raster of older colours: the copies go and come back in the new ones.
    for (const [c, cv] of this.baseCopies) if (cv !== img && cv.dataset.gen !== String(baseImg!.gen)) { cv.remove(); if (cv !== img) cv.width = 0; this.baseCopies.delete(c); }
    // World copies that meet the screen (with the tilt's lean).
    const wpx = BASE_W * r;
    const c0 = Math.floor((-v.ex - ox) / wpx);
    const c1 = Math.floor((v.w + v.ex - ox) / wpx);
    for (const [c, cv] of this.baseCopies) if (c < c0 || c > c1) { cv.remove(); if (cv !== img) cv.width = 0; this.baseCopies.delete(c); }
    for (let c = c0; c <= c1; c++) {
      if (this.baseCopies.has(c)) continue;
      // The first copy is the raster itself; another (zoomed right out, two worlds can show) draws it again.
      let cv: HTMLCanvasElement;
      if (!img.isConnected) cv = img;
      else {
        cv = mkCanvas('land-base-img');
        cv.width = img.width;
        cv.height = img.height;
        cv.getContext('2d')?.drawImage(img, 0, 0);
      }
      cv.dataset.gen = String(baseImg!.gen);
      cv.style.left = `${c * BASE_W}px`;
      cv.style.top = `${b.py}px`;
      cv.style.width = `${b.w}px`;
      cv.style.height = `${b.h}px`;
      this.baseEl.appendChild(cv);
      this.baseCopies.set(c, cv);
    }
  }

  destroy() {
    this.disposed = true;
    this.dropSet(this.front);
    this.dropSet(this.back);
    this.front = this.back = null;
    for (const cv of this.baseCopies.values()) { cv.remove(); if (cv !== baseImg?.cv) cv.width = 0; }
    this.baseCopies.clear();
    this.baseEl.remove();
  }
}
