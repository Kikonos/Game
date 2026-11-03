// v0.15 draws the globe's land field (globeLand.landField) off the main thread, on an OffscreenCanvas: a few hundred
// ms of rasterising that would otherwise hold up the globe's first frames. Where a worker cannot draw (no
// OffscreenCanvas or Path2D here), it says so and the globe draws the field itself.

import type { MultiPolygon } from 'geojson';
import { landField } from './globeLand';

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ land: MultiPolygon; w: number }>) => void) | null;
  postMessage(m: unknown, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof Path2D === 'undefined') throw new Error('no OffscreenCanvas here');
    const data = landField(e.data.land, e.data.w, (w, h) => new OffscreenCanvas(w, h));
    ctx.postMessage({ data }, [data.buffer]);
  } catch (err) {
    ctx.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
