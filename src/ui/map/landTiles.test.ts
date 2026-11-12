// v0.19 (perf) the flat map's land as raster tiles: the geometry is the old SVG paths' own stream, a tile covers its
// square with a device px of overlap, the visible range, and painting (on a recording stand-in context) draws only the
// rings near the tile, in every world copy it meets, with strokes of the old SVG's screen widths.
import { beforeAll, describe, expect, it } from 'vitest';
import { basePaths, loadMapData, MAP_H, MAP_W, projection } from './mapData';
import { baseSpec, BASE_W, brokenTile, landGeo, type LandInk, paintLand, TILE, tileRange, tileSpec } from './landTiles';

const INK: LandInk = { land0: '#111', land1: '#222', coast: '#333', border: '#444', grid: '#555' };

/** A stand-in 2D context that records what is drawn. */
function recorder() {
  const log: { op: string; n?: number; w?: number; style?: string; tf?: number[] }[] = [];
  let pts = 0;
  let tf = [1, 0, 0, 1, 0, 0];
  const c = {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '' as unknown,
    lineJoin: 'miter',
    lineCap: 'butt',
    setTransform: (...m: number[]) => { tf = m; },
    clearRect: () => log.push({ op: 'clear' }),
    beginPath: () => { pts = 0; },
    moveTo: () => { pts++; },
    lineTo: () => { pts++; },
    closePath: () => {},
    stroke: () => log.push({ op: 'stroke', n: pts, w: c.lineWidth, style: c.strokeStyle, tf }),
    fill: () => log.push({ op: 'fill', n: pts, tf }),
    createLinearGradient: (...a: number[]) => ({ a, addColorStop: () => {} }),
  };
  return { c: c as unknown as CanvasRenderingContext2D, log };
}

beforeAll(async () => { await loadMapData(); });

describe('v0.19 land tiles', () => {
  it('records the same rings as the old SVG land path (rotation 0)', () => {
    const geo = landGeo()!;
    expect(geo).toBeTruthy();
    const svg = basePaths(0).land;
    const moves = (svg.match(/M/g) ?? []).length;
    expect(geo.land.starts.length - 1).toBe(moves);
    // The first point is the path's first point.
    const m = /M([-\d.e]+),([-\d.e]+)/.exec(svg)!;
    expect(geo.land.xy[0]).toBeCloseTo(Number(m[1]), 3);
    expect(geo.land.xy[1]).toBeCloseTo(Number(m[2]), 3);
    expect(geo.borders.starts.length).toBeGreaterThan(100);
    expect(geo.grid.starts.length).toBeGreaterThan(30);
    // The gradient runs over the land's own height (as objectBoundingBox did), inside the projection's clip.
    expect(geo.y0).toBeLessThan(0);
    expect(geo.y1).toBeGreaterThan(MAP_H);
  });

  it('a tile covers its square with one device px of overlap all round (no seams), the fallback a whole world', () => {
    const s = tileSpec(1.37, 3, -1, 2);
    expect(s.px).toBeCloseTo(3 * TILE - 0.5);
    expect(s.py).toBeCloseTo(-TILE - 0.5);
    expect(s.w).toBeCloseTo(TILE + 1);
    expect(s.w * s.dpr).toBeCloseTo(TILE * 2 + 2);
    const b = baseSpec();
    expect(b.w).toBe(BASE_W);
    expect(b.sc * MAP_W).toBeCloseTo(BASE_W);
    expect(b.py).toBeLessThan(0);
    expect(b.py + b.h).toBeGreaterThan(MAP_H * b.sc);
  });

  it('the tiles in view: columns and rows of the screen box, at any scale and origin', () => {
    expect(tileRange(0, 0, 1180, 820, 0, 0, 1)).toEqual([0, 0, 4, 3]);
    expect(tileRange(0, 0, 1180, 820, -300, 40, 1)).toEqual([1, -1, 5, 3]);
    // Scaled up twice: half the tiles.
    expect(tileRange(0, 0, 1180, 820, 0, 0, 2)).toEqual([0, 0, 2, 1]);
    // West of the world origin (the map wraps): negative columns.
    expect(tileRange(-600, 0, 0, 100, 0, 0, 1)[0]).toBe(-3);
  });

  it('paints only the rings near the tile, strokes at the old screen widths, in each world copy it meets', () => {
    const geo = landGeo()!;
    const total = geo.land.xy.length / 2;
    const sc = 0.687 * 4;
    // A tile over Portugal and Spain.
    const p = projection(0)([-5, 40])!;
    const tx = Math.floor((p[0] * sc) / TILE);
    const ty = Math.floor((p[1] * sc) / TILE);
    const s = tileSpec(sc, tx, ty, 2);
    const { c, log } = recorder();
    paintLand(c, geo, INK, s.sc, s.px, s.py, s.w, s.h, s.dpr);
    const fills = log.filter((l) => l.op === 'fill');
    expect(fills).toHaveLength(1);
    expect(fills[0].n!).toBeGreaterThan(10);
    expect(fills[0].n!).toBeLessThan(total);
    const strokes = log.filter((l) => l.op === 'stroke');
    expect(strokes.map((l) => l.style)).toEqual([INK.grid, INK.coast, INK.border]);
    // Widths in map units: 0.6 / 0.7 / 0.6 CSS px at this scale.
    expect(strokes[1].w! * sc).toBeCloseTo(0.7);
    expect(strokes[0].w! * sc).toBeCloseTo(0.6);
    // The transform maps map units to the tile's device px.
    expect(fills[0].tf![0]).toBeCloseTo(sc * 2);
    // The mid-Atlantic, between the Americas' and Afro-Eurasia's boxes: next to nothing (an island or two at most).
    const q = projection(0)([-27, -20])!;
    const sc2 = sc * 2;
    const s2 = tileSpec(sc2, Math.floor((q[0] * sc2) / TILE), Math.floor((q[1] * sc2) / TILE), 2);
    const r2 = recorder();
    paintLand(r2.c, geo, INK, s2.sc, s2.px, s2.py, s2.w, s2.h, s2.dpr);
    expect(r2.log.filter((l) => l.op === 'fill')[0].n!).toBeLessThan(total / 100);
    // A tile across the world's east edge (the antimeridian) draws two copies; one a world east draws one, shifted.
    const n = Math.floor((MAP_W * sc) / TILE);
    const r3 = recorder();
    const s3 = tileSpec(sc, n, 2, 1);
    paintLand(r3.c, geo, INK, s3.sc, s3.px, s3.py, s3.w, s3.h, s3.dpr);
    const f3 = r3.log.filter((l) => l.op === 'fill');
    expect(f3.length).toBe(Math.floor((s3.px + s3.w + 3) / sc / MAP_W) - Math.floor((s3.px - 3) / sc / MAP_W) + 1);
    const r4 = recorder();
    paintLand(r4.c, geo, INK, s.sc, s.px + MAP_W * sc, s.py, s.w, s.h, s.dpr);
    expect(r4.log.filter((l) => l.op === 'fill')[0].n).toBe(fills[0].n);
  });
});

// v0.23.1 the player's map after zooming out (report bmwdorhy4a9hd): every tile showed Safari's broken-picture mark, and
// stayed so, as the layer kept a tile it had shown. A tile with no picture, or one that came to nothing, is drawn again.
describe('v0.23.1 a tile that shows nothing is drawn again', () => {
  const img = (src: string | null, complete: boolean, naturalWidth: number) => ({ complete, naturalWidth, getAttribute: (n: string) => (n === 'src' ? src : null) });
  it('broken: no picture, or loaded to nothing; still loading or drawn: kept', () => {
    expect(brokenTile(img(null, true, 0))).toBe(true);
    expect(brokenTile(img('blob:x', true, 0))).toBe(true);
    expect(brokenTile(img('blob:x', false, 0))).toBe(false);
    expect(brokenTile(img('blob:x', true, 512))).toBe(false);
  });
});
