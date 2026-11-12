// v0.19 (perf) draws the flat map's land tiles (landPaint.paintLand) off the main thread, on an OffscreenCanvas, and
// hands each back as a PNG (the page shows it in an <img>). Where it cannot draw (no OffscreenCanvas 2D here), it says
// so once and the page draws the tiles itself.

import { type LandGeo, type LandInk, paintLand, type TileSpec } from './landPaint';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ geo?: LandGeo; ink?: LandInk | null; id?: number; spec?: TileSpec; gen?: number }>) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
};

let geo: LandGeo | null = null;
let ink: LandInk | null = null;
// v0.23.1 one canvas for every tile (player report bmwdorhy4a9hd: the map broke after zooming out on an iPad). A new
// canvas per tile left its memory to the collector; zooming out draws dozens of tiles at once, Safari's canvas memory
// ran out and the tiles came back as pictures that could not be shown.
let cv: OffscreenCanvas | null = null;

ctx.onmessage = async (e) => {
  const d = e.data;
  if (d.geo) geo = d.geo;
  if (d.ink) ink = d.ink;
  if (d.id === undefined || !d.spec) return;
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas here');
    if (!geo || !ink) throw new Error('no land yet');
    const s = d.spec;
    const w = Math.ceil(s.w * s.dpr);
    const h = Math.ceil(s.h * s.dpr);
    if (!cv) cv = new OffscreenCanvas(w, h);
    else if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const c = cv.getContext('2d');
    if (!c) throw new Error('no 2D context on an OffscreenCanvas here');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    paintLand(c, geo, ink, s.sc, s.px, s.py, s.w, s.h, s.dpr);
    const png = await cv.convertToBlob({ type: 'image/png' });
    // The bytes themselves, handed over: the page keeps its own copy of the picture, whatever becomes of this worker.
    const buf = await png.arrayBuffer();
    ctx.postMessage({ id: d.id, buf, gen: d.gen }, [buf]);
  } catch (err) {
    ctx.postMessage({ id: d.id, error: err instanceof Error ? err.message : String(err) });
  }
};
