// v0.19 (perf) painting the flat map's land into a raster (landTiles.ts): pure, shared by the page and its worker.

import { MAP_H, MAP_W } from './mapData';

/** Tile size in CSS px. */
export const TILE = 256;
/** The world fallback layer: this many device px across one world. */
export const BASE_W = 1536;
/** Rings of one kind in map units: points (x, y pairs), where each ring starts (+ the end), and each ring's box. */
export interface LandSet { xy: Float32Array; starts: Uint32Array; box: Float32Array }
/** The land, the country borders and the graticule, projected once (rotation 0), and the land's vertical extent. */
export interface LandGeo { land: LandSet; borders: LandSet; grid: LandSet; y0: number; y1: number }
/** Colours (CSS colour strings) as the theme has them. */
export interface LandInk { land0: string; land1: string; coast: string; border: string; grid: string }

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Adds the rings of `s` whose box (moved by dx) meets the area to the context's path. */
function addRings(c: Ctx2D, s: LandSet, dx: number, a: [number, number, number, number], close: boolean) {
  const { xy, starts, box } = s;
  for (let r = 0; r < starts.length - 1; r++) {
    const b = r * 4;
    if (box[b] + dx > a[2] || box[b + 2] + dx < a[0] || box[b + 1] > a[3] || box[b + 3] < a[1]) continue;
    const i0 = starts[r];
    const i1 = starts[r + 1];
    c.moveTo(xy[i0 * 2], xy[i0 * 2 + 1]);
    for (let i = i0 + 1; i < i1; i++) c.lineTo(xy[i * 2], xy[i * 2 + 1]);
    if (close) c.closePath();
  }
}

/**
 * Paints the land as the old SVG did (graticule, land filled with its top-to-bottom gradient and stroked with the
 * coast, then the borders; strokes in CSS px at any zoom) onto a canvas of (w × h) CSS px at `dpr` that shows the
 * world px [px, px + w) × [py, py + h) at `sc` CSS px per map unit. The world repeats east–west (MAP_W).
 */
export function paintLand(c: Ctx2D, geo: LandGeo, ink: LandInk, sc: number, px: number, py: number, w: number, h: number, dpr: number) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, Math.ceil(w * dpr), Math.ceil(h * dpr));
  const f = sc * dpr;
  const pad = 3 / sc;
  const mx0 = px / sc;
  const my0 = py / sc;
  const area: [number, number, number, number] = [mx0 - pad, my0 - pad, (px + w) / sc + pad, (py + h) / sc + pad];
  c.lineJoin = 'miter';
  c.lineCap = 'butt';
  for (let cx = Math.floor(area[0] / MAP_W); cx <= Math.floor(area[2] / MAP_W); cx++) {
    const dx = cx * MAP_W;
    c.setTransform(f, 0, 0, f, (dx - mx0) * f, -my0 * f);
    const local: [number, number, number, number] = [area[0] - dx, area[1], area[2] - dx, area[3]];
    c.beginPath();
    addRings(c, geo.grid, 0, local, false);
    c.strokeStyle = ink.grid;
    c.lineWidth = 0.6 / sc;
    c.stroke();
    c.beginPath();
    addRings(c, geo.land, 0, local, true);
    const grad = c.createLinearGradient(0, geo.y0, 0, geo.y1);
    grad.addColorStop(0, ink.land0);
    grad.addColorStop(1, ink.land1);
    c.fillStyle = grad;
    c.fill();
    c.strokeStyle = ink.coast;
    c.lineWidth = 0.7 / sc;
    c.stroke();
    c.beginPath();
    addRings(c, geo.borders, 0, local, false);
    c.strokeStyle = ink.border;
    c.lineWidth = 0.6 / sc;
    c.stroke();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** What one raster shows: world px [px, px + w) × [py, py + h) at sc CSS px per map unit, `dpr` device px per CSS px. */
export interface TileSpec { sc: number; px: number; py: number; w: number; h: number; dpr: number }

/** The spec of tile (tx, ty) at scale sc: one device px of overlap all round, so neighbours never leave a seam. */
export function tileSpec(sc: number, tx: number, ty: number, dpr: number): TileSpec {
  const e = 1 / dpr;
  return { sc, px: tx * TILE - e, py: ty * TILE - e, w: TILE + 2 * e, h: TILE + 2 * e, dpr };
}

/** The world fallback raster's spec (one world, a little beyond the map's top and bottom). */
export function baseSpec(): TileSpec {
  const sc = BASE_W / MAP_W;
  return { sc, px: 0, py: -0.12 * MAP_H * sc, w: BASE_W, h: 1.24 * MAP_H * sc, dpr: 1 };
}

/** Tile columns and rows that meet the screen-px box [x0, x1) × [y0, y1), the world origin at screen (ox, oy), `r` screen px per tile px. */
export function tileRange(x0: number, y0: number, x1: number, y1: number, ox: number, oy: number, r: number): [number, number, number, number] {
  return [Math.floor((x0 - ox) / r / TILE), Math.floor((y0 - oy) / r / TILE), Math.floor((x1 - ox) / r / TILE), Math.floor((y1 - oy) / r / TILE)];
}

