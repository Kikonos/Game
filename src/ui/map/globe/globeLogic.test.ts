// v0.15 the 3D globe's pure maths: the sphere's orientation (the one three.js wraps an equirectangular texture with),
// the sun and night band shared with the flat map, the camera, projection and picking, colours, tracks and the fleet.
import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { flightsOf } from '../../../engine/core/entities';
import { aircraftLive } from '../../../engine/core/query';
import { fromUTC } from '../../../engine/core/time';
import { demoFlights } from '../../../engine/dev';
import { createGame } from '../../../engine/newGame';
import { advanceTo } from '../../../engine/sim';
import { sunElevation, sunPoint } from '../mapLogic';
import { mapPxPerM, SIL_MAX_PX, SIL_MAX_M, SIL_MIN_M, SIL_MIN_PX } from '../silhouettes';
import { nightAlpha } from '../sky';
import {
  aimAt, angleBetween, arcSamples, camOf, clampDist, clampLat, dashOf, degPerPx, DIST_MAX, DIST_MIN, DIST_START, dot, equivZoom, facing, gcTrack, globeFleet, globePxPerM, headingVec, LAT_MAX,
  legTrack, lerpOrbit, lonLatOf, NIGHT_S, norm, parseColour, project, stepInertia, sunVec, tangentsAt, vecOf, worldPerPx, wrap180,
} from './globeLogic';

const close = (a: number[], b: number[], d = 6) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], d));
const game = (seed = 7) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('v0.15 globe: the sphere', () => {
  it('lies the way three.js wraps an equirectangular map round a sphere (u = 0 at 180°W, north up)', () => {
    // SphereGeometry: x = −cos(2πu)·sinθ, y = cosθ, z = sin(2πu)·sinθ; u runs west to east from −180°.
    for (const u of [0, 0.1, 0.25, 0.5, 0.63, 0.75, 0.99]) {
      const lon = u * 360 - 180;
      close(vecOf(lon, 0), [-Math.cos(2 * Math.PI * u), 0, Math.sin(2 * Math.PI * u)]);
    }
    close(vecOf(0, 0), [1, 0, 0]);
    close(vecOf(-90, 0), [0, 0, 1]);
    close(vecOf(123, 90), [0, 1, 0]);
    close(vecOf(10, 20, 2).map((x) => x / 2), vecOf(10, 20));
  });

  it('turns a point back into its longitude and latitude', () => {
    for (const [lon, lat] of [[-9.1, 38.7], [151.2, -33.9], [-179.5, 64], [0, 0], [100, -80]]) close(lonLatOf(vecOf(lon, lat)), [lon, lat], 9);
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(angleBetween([0, 0], [90, 0])).toBeCloseTo(90, 9);
  });

  it('lights the Earth from the flat map\'s sun: dot(ground, sun) is the sine of the sun\'s elevation there', () => {
    const t = fromUTC(2027, 6, 21, 12, 0);
    const sun = sunPoint(t);
    for (const [lon, lat] of [[-9, 38], [139, 35], [-74, 40], [0, -60]]) {
      expect(Math.asin(dot(vecOf(lon, lat), sunVec(t))) * (180 / Math.PI)).toBeCloseTo(sunElevation(sun, lon, lat), 6);
    }
  });

  it('shades the night across the flat map\'s twilight band (the shader eases between the same two sines)', () => {
    const shade = (s: number) => { const x = Math.min(1, Math.max(0, (NIGHT_S[0] - s) / (NIGHT_S[0] - NIGHT_S[1]))); return x * x * (3 - 2 * x); };
    for (const elev of [10, 0.8, 0, -3, -7, -14, -30]) expect(Math.abs(shade(Math.sin((elev * Math.PI) / 180)) - nightAlpha(elev))).toBeLessThan(0.01);
  });

  it('knows which side faces the camera, and keeps labels off the foreshortened limb', () => {
    const cam = camOf({ lon: -9, lat: 38, dist: 3 });
    expect(facing(vecOf(-9, 38), cam)).toBe(true);
    expect(facing(vecOf(171, -38), cam)).toBe(false);
    // 80° from the middle of the disc: still in front, but too close to the edge for a label.
    expect(facing(vecOf(71, 38), cam, 0)).toBe(true);
    expect(facing(vecOf(71, 38), cam, 0.28)).toBe(false);
  });

  it('gives east and north tangents and headings on the ground', () => {
    for (const p of [[-9, 38], [120, -20], [0, 0]] as [number, number][]) {
      const n = vecOf(...p);
      const { east, north } = tangentsAt(p);
      expect(dot(east, n)).toBeCloseTo(0, 9);
      expect(dot(north, n)).toBeCloseTo(0, 9);
      expect(dot(east, north)).toBeCloseTo(0, 9);
      // Moving east is along `east`; with nowhere to go the nose points north.
      expect(dot(headingVec(p, [p[0] + 0.5, p[1]]), east)).toBeGreaterThan(0.99);
      expect(dot(headingVec(p, undefined), north)).toBeCloseTo(1, 9);
    }
  });
});

describe('v0.15 globe: the camera', () => {
  it('keeps its distance and latitude in range', () => {
    expect(DIST_MIN).toBeLessThan(DIST_START);
    expect(DIST_START).toBeLessThan(DIST_MAX);
    expect(clampDist(0.5)).toBe(DIST_MIN);
    expect(clampDist(99)).toBe(DIST_MAX);
    expect(clampLat(95)).toBe(LAT_MAX);
    expect(clampLat(-95)).toBe(-LAT_MAX);
  });

  it('projects the middle of the globe to the middle of the view, a px at the middle is worldPerPx across', () => {
    const o = { lon: 20, lat: 10, dist: 3 };
    const cam = camOf(o);
    const mid = project(vecOf(20, 10), cam, 1000, 800)!;
    expect(mid.x).toBeCloseTo(500, 6);
    expect(mid.y).toBeCloseTo(400, 6);
    // North of the middle is up the screen, east is right.
    expect(project(vecOf(20, 12), cam, 1000, 800)!.y).toBeLessThan(400);
    expect(project(vecOf(22, 10), cam, 1000, 800)!.x).toBeGreaterThan(500);
    // A small step on the ground near the middle moves it by step / worldPerPx px.
    const d = 0.002;
    const q = project(norm([...vecOf(20, 10)].map((x, i) => x + d * tangentsAt([20, 10]).east[i]) as [number, number, number]), cam, 1000, 800)!;
    expect(q.x - 500).toBeCloseTo(d / worldPerPx(3, 800), 0);
    // A drag of n px turns the globe by n × degPerPx.
    expect(degPerPx(3, 800)).toBeCloseTo((worldPerPx(3, 800) * 180) / Math.PI, 12);
    // Behind the camera: nothing.
    expect(project([0, 0, 10], [0, 0, 3], 100, 100)).toBeNull();
  });

  it('sizes the aircraft by the flat map\'s rule at the same scale, within its limits', () => {
    expect(equivZoom(worldPerPx(3, 800), 1000)).toBeGreaterThan(0);
    // Closer in: more px per km, the flat map's zoom grows, and the aircraft with it (never past the cap).
    const far = globePxPerM(DIST_MAX, 1180, 820);
    const near = globePxPerM(DIST_MIN, 1180, 820);
    expect(near).toBeGreaterThanOrEqual(far);
    expect(far).toBeCloseTo(mapPxPerM(equivZoom(worldPerPx(DIST_MAX, 820), 1180)), 12);
    expect(far * SIL_MIN_M).toBeGreaterThanOrEqual(SIL_MIN_PX - 1e-9);
    expect(near * SIL_MAX_M).toBeLessThanOrEqual(SIL_MAX_PX + 1e-9);
  });

  it('lets a flick coast to a stop', () => {
    let v: [number, number] = [0.05, -0.02];
    let turned = 0;
    for (let i = 0; i < 200 && (v[0] || v[1]); i++) { turned += v[0] * 16; v = stepInertia(v, 16); }
    expect(v).toEqual([0, 0]);
    expect(turned).toBeGreaterThan(5);
    expect(turned).toBeLessThan(25);
  });

  it('flies the short way round, eased', () => {
    const a = { lon: 170, lat: 0, dist: 3 };
    const b = { lon: -170, lat: 20, dist: 2 };
    expect(lerpOrbit(a, b, 0)).toEqual(a);
    close(Object.values(lerpOrbit(a, b, 1)), Object.values(b), 9);
    const m = lerpOrbit(a, b, 0.5);
    expect(Math.abs(m.lon)).toBeCloseTo(180, 6);
    expect(m.lat).toBeCloseTo(10, 9);
    expect(lerpOrbit(a, b, 0.1).lat).toBeLessThan(2);
  });

  it('aims at a selection left of the middle when a panel covers the right', () => {
    const at: [number, number] = [-9.1, 38.7];
    const o = { ...aimAt(at, 3, 800, 180), dist: 3 };
    expect(o.lon).toBeGreaterThan(at[0]);
    const q = project(vecOf(...at), camOf(o), 1000, 800)!;
    expect(500 - q.x).toBeGreaterThan(140);
    expect(500 - q.x).toBeLessThan(220);
    close(Object.values(aimAt(at, 3, 800)), [at[0], at[1]], 9);
  });
});

describe('v0.15 globe: colours and dashes', () => {
  it('reads the theme\'s colour tokens', () => {
    close(parseColour('#0c1528'), [12 / 255, 21 / 255, 40 / 255, 1]);
    close(parseColour('#fff'), [1, 1, 1, 1]);
    close(parseColour('#ff000080'), [1, 0, 0, 128 / 255]);
    close(parseColour(' rgba(120, 160, 230, 0.28) '), [120 / 255, 160 / 255, 230 / 255, 0.28]);
    close(parseColour('rgb(1 4 14)'), [1 / 255, 4 / 255, 14 / 255, 1]);
    close(parseColour('1, 4, 14'), [1 / 255, 4 / 255, 14 / 255, 1]);
    expect(parseColour('nonsense', [0, 0, 0, 0])).toEqual([0, 0, 0, 0]);
    expect(parseColour(undefined)).toEqual([1, 1, 1, 1]);
  });

  it('reads the flat map\'s dash patterns', () => {
    expect(dashOf('6 5')).toEqual([6, 5]);
    expect(dashOf('1.5 4')).toEqual([1.5, 4]);
    expect(dashOf('')).toBeNull();
    expect(dashOf('0 0')).toBeNull();
  });
});

describe('v0.15 globe: tracks and the fleet', () => {
  it('samples a great circle smoothly from one airport to the other', () => {
    const pts = gcTrack('LIS', 'JFK');
    const A = AIRPORT_BY_CODE.LIS;
    const B = AIRPORT_BY_CODE.JFK;
    close(pts[0], [A.lon, A.lat], 6);
    close(pts[pts.length - 1], [B.lon, B.lat], 6);
    expect(pts.length - 1).toBe(arcSamples(angleBetween([A.lon, A.lat], [B.lon, B.lat])));
    for (let i = 1; i < pts.length; i++) expect(angleBetween(pts[i - 1], pts[i])).toBeLessThan(1.25);
    expect(gcTrack('LIS', 'XXXX')).toEqual([]);
    expect(arcSamples(0)).toBe(8);
    expect(arcSamples(1000)).toBe(128);
  });

  it('puts every aircraft where the flat map does: in the air on its leg, on the ground at its airport', () => {
    const g = game();
    demoFlights(g, ['PMI'], 1);
    const ac = Object.values(g.fleet)[0];
    const f = flightsOf(g, ac.id)[0];
    advanceTo(g, f.std + 1);
    const t = (f.atd! + f.eta!) / 2;
    const list = globeFleet(g, t);
    expect(list.length).toBe(Object.values(g.fleet).length);
    const a = list.find((x) => x.id === ac.id)!;
    const live = aircraftLive(g, ac, t);
    expect(a.airborne).toBe(true);
    expect(a.flight?.id).toBe(f.id);
    expect(a.pos).toEqual(live.pos);
    expect(a.progress).toBeCloseTo(live.progress, 9);
    // Its track runs off-blocks to on-blocks: the split at `progress` falls where the aircraft is.
    const tr = legTrack(f);
    const i = a.progress * (tr.length - 1);
    expect(angleBetween(tr[Math.floor(i)], a.pos)).toBeLessThan(1.3);
    for (const o of list) {
      const l = aircraftLive(g, g.fleet[o.id], t);
      expect(o.airborne).toBe(l.phase === 'airborne');
      expect(o.pos).toEqual(l.pos);
      if (!o.airborne) expect(o.pos).toEqual([AIRPORT_BY_CODE[o.at!].lon, AIRPORT_BY_CODE[o.at!].lat]);
    }
    // Once it has landed it stands at the arrival airport.
    advanceTo(g, f.eta! + 1);
    const after = globeFleet(g, g.now).find((x) => x.id === ac.id)!;
    expect(after.airborne).toBe(false);
    expect(after.at).toBe(f.to);
  });
});
