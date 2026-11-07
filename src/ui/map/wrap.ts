// v0.18 the flat map wraps east–west without end. Pure maths for it (no DOM).
//
// The view lives in "world" map units that never wrap: a pan of one world width east lands on the same place, one copy
// further on. What is drawn on top of the land (aircraft, paths, pins, airports, labels) is drawn once, with a
// projection turned so the view's middle sits near the middle of the projection: a "frame" [F, F + MAP_W) of world x,
// so every mark shows in the copy nearest the view. The frame steps by FRAME_STEP_DEG as the view moves (a re-render of
// the marks, a few times across an ocean); the land under it is the one world-atlas path drawn in three copies.

import { MAP_W } from './mapData';

/** The frame turns in steps of this many degrees of longitude. */
export const FRAME_STEP_DEG = 10;
/** One step in map units. */
export const FRAME_STEP_U = (MAP_W * FRAME_STEP_DEG) / 360;
/** The frame moves on once the view's middle is this many steps from the frame's middle (a little hysteresis). */
export const FRAME_SLACK = 0.75;

const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The frame's left edge in world map units for frame index i. */
export const frameX = (i: number) => i * FRAME_STEP_U;

/** The projection's rotation (degrees, d3 `rotate` λ) for frame index i: world x of a longitude stays put. */
export const frameRot = (i: number) => wrap180(-i * FRAME_STEP_DEG) || 0;

/** The frame index whose middle is nearest world x `cx`. */
export const frameFor = (cx: number) => Math.round((cx - MAP_W / 2) / FRAME_STEP_U);

/** v0.18 (perf) how close (map units, 25° of longitude) the view's edge may come to the frame's edge before it steps on. */
export const FRAME_EDGE_U = (MAP_W * 25) / 360;
/** The same while a pan or pinch runs (5°): the frame then moves only when it must, and is centred when the gesture ends. */
export const FRAME_EDGE_BUSY_U = (MAP_W * 5) / 360;

/**
 * Keeps frame `i` while the view (middle `cx`, `viewW` map units wide) stays clear of its edges by `edge`, or
 * at least while its middle is within FRAME_SLACK steps of the frame's middle; else the frame nearest the view's
 * middle. Zoomed in, the frame (and the marks' re-render) then moves only after a long pan, not every 10°.
 */
export function nextFrame(i: number, cx: number, viewW = MAP_W, edge = FRAME_EDGE_U): number {
  const room = Math.max(FRAME_STEP_U * FRAME_SLACK, (MAP_W - viewW) / 2 - edge);
  return Math.abs(cx - (frameX(i) + MAP_W / 2)) > room ? frameFor(cx) : i;
}

/** Offset (a whole number of world widths) of the land copy nearest the frame starting at world x `f`. */
export const landOffset = (f: number) => MAP_W * Math.round(f / MAP_W);

/** x moved by whole world widths to lie within half a world of `c`. */
export function nearX(x: number, c: number): number {
  return x - MAP_W * Math.round((x - c) / MAP_W);
}

/**
 * The longitude in the middle of the shortest arc that holds every one of `lons` (degrees, −180..180): the gap round
 * the world between neighbours that is widest is left out. 0 for none.
 */
export function lonCentre(lons: number[]): number {
  if (!lons.length) return 0;
  const s = [...new Set(lons.map((l) => wrap180(l)))].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  let gap = s[0] + 360 - s[s.length - 1];
  let start = s[0];
  for (let i = 1; i < s.length; i++) {
    const d = s[i] - s[i - 1];
    if (d > gap) { gap = d; start = s[i]; }
  }
  // The arc runs from `start` east round to the point before the widest gap.
  const span = 360 - gap;
  return wrap180(start + span / 2);
}
