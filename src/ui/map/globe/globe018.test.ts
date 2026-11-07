// v0.18 the globe's new maths: lifted arcs (height by sector length, the arch along it), the Earth hiding what is behind
// it, the close-up tilt and its camera and projection, and the small 3D aircraft built from the silhouette specs.
import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../../../data/aircraft';
import { arcLift, camOf, camView, DIST_MIN, dot, GLOBE_TILT_FROM, GLOBE_TILT_MAX, globeTilt, liftAt, norm, occluded, project, projectView, sub, vecOf } from './globeLogic';
import { modelOf, triangulate } from './globeModel';

describe('v0.18 globe: lifted arcs', () => {
  it('rise higher for longer sectors, within bounds', () => {
    const ds = [0, 2, 9, 30, 60, 100, 160];
    const lifts = ds.map(arcLift);
    for (let i = 1; i < lifts.length; i++) expect(lifts[i]).toBeGreaterThanOrEqual(lifts[i - 1]);
    expect(arcLift(0)).toBeGreaterThan(0);
    expect(arcLift(9)).toBeLessThan(0.02);
    expect(arcLift(180)).toBeLessThanOrEqual(0.06 + 1e-9);
  });
  it('arch: on the ground at both ends, highest in the middle, symmetric', () => {
    const L = 0.05;
    expect(liftAt(L, 0)).toBe(0);
    expect(liftAt(L, 1)).toBe(0);
    expect(liftAt(L, 0.5)).toBeCloseTo(L, 9);
    expect(liftAt(L, 0.2)).toBeCloseTo(liftAt(L, 0.8), 9);
    expect(liftAt(L, 0.2)).toBeLessThan(liftAt(L, 0.4));
    expect(liftAt(0, 0.5)).toBe(0);
  });
});

describe('v0.18 globe: occlusion', () => {
  const cam = camOf({ lon: 0, lat: 0, dist: 3 });
  it('the near side shows, the far side is hidden', () => {
    expect(occluded(vecOf(0, 0, 1.001), cam)).toBe(false);
    expect(occluded(vecOf(180, 0, 1.001), cam)).toBe(true);
    expect(occluded(vecOf(100, 0, 1.001), cam)).toBe(true);
  });
  it('a point lifted clear above the limb shows against space', () => {
    expect(occluded(vecOf(95, 0, 1.001), cam)).toBe(true);
    expect(occluded(vecOf(95, 0, 1.3), cam)).toBe(false);
  });
});

describe('v0.18 globe: close-up tilt', () => {
  it('none from GLOBE_TILT_FROM out, full at the closest zoom, eased between', () => {
    expect(globeTilt(GLOBE_TILT_FROM)).toBe(0);
    expect(globeTilt(4)).toBe(0);
    expect(globeTilt(DIST_MIN)).toBeCloseTo(GLOBE_TILT_MAX, 9);
    const mid = globeTilt((GLOBE_TILT_FROM + DIST_MIN) / 2);
    expect(mid).toBeCloseTo(GLOBE_TILT_MAX / 2, 6);
    expect(globeTilt(DIST_MIN, 0)).toBe(0);
  });
  it('untilted: the same camera and projection as v0.15', () => {
    for (const o of [{ lon: 0, lat: 0, dist: 3 }, { lon: -9, lat: 38.7, dist: 1.6 }, { lon: 151, lat: -34, dist: 2.2 }]) {
      const v = camView(o, 0);
      const c = camOf(o);
      v.pos.forEach((x, i) => expect(x).toBeCloseTo(c[i], 9));
      for (const p of [vecOf(o.lon + 3, o.lat - 2, 1.001), vecOf(o.lon - 5, o.lat + 4)]) {
        const a = project(p, c, 1180, 820)!;
        const b = projectView(p, v, 1180, 820)!;
        expect(b.x).toBeCloseTo(a.x, 6);
        expect(b.y).toBeCloseTo(a.y, 6);
      }
    }
  });
  it('tilted: the orbit point stays in the middle, north up, the camera as far from it, leaning back south', () => {
    const o = { lon: 20, lat: 45, dist: DIST_MIN };
    const v = camView(o, 40);
    const mid = projectView(vecOf(o.lon, o.lat), v, 1000, 800)!;
    expect(mid.x).toBeCloseTo(500, 6);
    expect(mid.y).toBeCloseTo(400, 6);
    expect(Math.hypot(...sub(v.pos, vecOf(o.lon, o.lat)))).toBeCloseTo(o.dist - 1, 9);
    // A point to the north shows above the middle and one to the east to the right.
    expect(projectView(vecOf(o.lon, o.lat + 1), v, 1000, 800)!.y).toBeLessThan(400);
    expect(projectView(vecOf(o.lon + 1, o.lat), v, 1000, 800)!.x).toBeGreaterThan(500);
    // Looking down at 40° from the vertical.
    const down = norm(vecOf(o.lon, o.lat));
    expect(Math.acos(-dot(v.fwd, down)) * (180 / Math.PI)).toBeCloseTo(40, 6);
  });
});

describe('v0.18 globe: 3D aircraft', () => {
  it('triangulates a concave outline into n − 2 triangles', () => {
    const pts: [number, number][] = [[0, 0], [4, 0], [4, 3], [2, 1], [0, 3]];
    const tris = triangulate(pts);
    expect(tris.length).toBe(3);
    let area = 0;
    for (const [a, b, c] of tris) area += Math.abs((pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0])) / 2;
    expect(area).toBeCloseTo(8, 6); // the outline's own (shoelace) area
  });
  it('every type builds a model of sensible size, finite, a few hundred to a few thousand triangles', () => {
    for (const id of AIRCRAFT.map((t) => t.id)) {
      const m = modelOf(id);
      const tris = m.pos.length / 9;
      expect(tris, id).toBeGreaterThan(50);
      expect(tris, id).toBeLessThan(6000);
      expect(m.pos.every(Number.isFinite), id).toBe(true);
      expect(m.nrm.every(Number.isFinite), id).toBe(true);
      expect(m.L, id).toBeGreaterThan(20);
      expect(m.L, id).toBeLessThan(90);
      expect(m.S, id).toBeGreaterThan(15);
      expect(m.S, id).toBeLessThan(90);
      // Inside its length and span (x across, y along).
      let maxX = 0;
      let maxY = 0;
      for (let i = 0; i < m.pos.length; i += 3) {
        maxX = Math.max(maxX, Math.abs(m.pos[i]));
        maxY = Math.max(maxY, Math.abs(m.pos[i + 1]));
      }
      expect(maxX, id).toBeLessThanOrEqual(m.S / 2 + 1);
      expect(maxY, id).toBeLessThanOrEqual(m.L / 2 + 1);
    }
  });
});
