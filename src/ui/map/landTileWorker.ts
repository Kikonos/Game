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

ctx.onmessage = async (e) => {
  const d = e.data;
  if (d.geo) geo = d.geo;
  if (d.ink) ink = d.ink;
  if (d.id === undefined || !d.spec) return;
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('no OffscreenCanvas here');
    if (!geo || !ink) throw new Error('no land yet');
    const s = d.spec;
    const cv = new OffscreenCanvas(Math.ceil(s.w * s.dpr), Math.ceil(s.h * s.dpr));
    const c = cv.getContext('2d');
    if (!c) throw new Error('no 2D context on an OffscreenCanvas here');
    paintLand(c, geo, ink, s.sc, s.px, s.py, s.w, s.h, s.dpr);
    const png = await cv.convertToBlob({ type: 'image/png' });
    ctx.postMessage({ id: d.id, png, gen: d.gen });
  } catch (err) {
    ctx.postMessage({ id: d.id, error: err instanceof Error ? err.message : String(err) });
  }
};
