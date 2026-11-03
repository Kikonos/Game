// v0.15 Depth: the map tilt's projection and its inverse (taps land where the finger is), the aircraft shadows and the
// hangar's row depth.
import { describe, expect, it } from 'vitest';
import { altByProgress, hangarDepth, SHADE_DIR, SHADE_LEVELS, shadeLevel, shadeLift, shadeOf, TILT_K0, TILT_K1, TILT_MAX_DEG, tiltBleed, tiltCss, tiltDeg, tiltProject, untilt } from './depth';

describe('v0.15 map tilt', () => {
  it('is flat until the closest zoom levels, then eases in smoothly to its fullest', () => {
    expect(tiltDeg(1)).toBe(0);
    expect(tiltDeg(TILT_K0)).toBe(0);
    expect(tiltDeg(TILT_K1)).toBeCloseTo(TILT_MAX_DEG, 9);
    expect(tiltDeg(16)).toBeCloseTo(TILT_MAX_DEG, 9);
    expect(tiltDeg(8, 0)).toBe(0);
    let prev = 0;
    for (let k = TILT_K0; k <= TILT_K1 + 1; k += 0.05) {
      const d = tiltDeg(k);
      expect(d).toBeGreaterThanOrEqual(prev);
      // No jumps: a small zoom step never moves the tilt by much.
      expect(d - prev).toBeLessThan(0.2);
      prev = d;
    }
    expect(TILT_MAX_DEG).toBeLessThanOrEqual(12);
  });

  it('writes no transform when flat', () => {
    expect(tiltCss(0, 800)).toBe('');
    expect(tiltCss(5, 800)).toMatch(/^perspective\(1920px\) rotateX\(5\.000deg\)$/);
  });

  it('keeps the bottom edge in place and draws the far edge smaller (never magnified: labels stay crisp)', () => {
    const w = 1180;
    const h = 820;
    const deg = TILT_MAX_DEG;
    for (const x of [0, 300, 590, 1180]) {
      const [px, py] = tiltProject(x, h, w, h, deg);
      expect(px).toBeCloseTo(x, 9);
      expect(py).toBeCloseTo(h, 9);
    }
    const [l] = tiltProject(0, 0, w, h, deg);
    const [r] = tiltProject(w, 0, w, h, deg);
    expect(r - l).toBeLessThan(w);
    expect(r - l).toBeGreaterThan(w * 0.88);
    // Everywhere on the layer the local scale is at most 1.
    for (const y of [0, 200, 410, 700, 819]) {
      const a = tiltProject(100, y, w, h, deg);
      const b = tiltProject(101, y + 1, w, h, deg);
      expect(b[0] - a[0]).toBeLessThanOrEqual(1 + 1e-9);
      expect(b[1] - a[1]).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('inverts exactly: a tap on the tilted map hits the untilted point under it', () => {
    for (const [w, h] of [[1180, 820], [852, 393], [1440, 900]]) {
      for (const deg of [0, 0.5, 4, TILT_MAX_DEG]) {
        for (const x of [0, w * 0.25, w / 2, w * 0.9, w]) {
          for (const y of [-40, 0, h * 0.3, h * 0.7, h]) {
            const [sx, sy] = tiltProject(x, y, w, h, deg);
            const [ux, uy] = untilt(sx, sy, w, h, deg);
            expect(ux).toBeCloseTo(x, 6);
            expect(uy).toBeCloseTo(y, 6);
          }
        }
      }
    }
  });

  it('reaches a little past the box once tilted, so the corners stay filled', () => {
    expect(tiltBleed(1180, 820, 0)).toEqual({ ex: 0, ey: 0 });
    const b = tiltBleed(1180, 820, TILT_MAX_DEG);
    expect(b.ey).toBeGreaterThan(20);
    expect(b.ey).toBeLessThan(140);
    expect(b.ex).toBeGreaterThan(10);
    expect(b.ex).toBeLessThan(90);
    // The layer's corner (-ex, -ey) lands at or beyond the screen's top-left corner.
    const [x, y] = tiltProject(-b.ex, -b.ey, 1180, 820, TILT_MAX_DEG);
    expect(x).toBeLessThanOrEqual(0.5);
    expect(y).toBeLessThanOrEqual(0.5);
  });
});

describe('v0.15 aircraft shadows', () => {
  it('sit right under an aircraft on the ground, crisp', () => {
    const s = shadeOf(0);
    expect(Math.hypot(s.dx, s.dy)).toBeCloseTo(1.5, 6);
    expect(s.level).toBe(0);
    expect(shadeLevel(0).blur).toBeLessThanOrEqual(0.5);
  });

  it('move away and soften as it climbs, and come back on descent', () => {
    const alts = [0, 2000, 8000, 15000, 25000, 38000];
    const ds = alts.map((a) => Math.hypot(shadeOf(a).dx, shadeOf(a).dy));
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThan(ds[i - 1]);
    expect(ds[ds.length - 1]).toBeCloseTo(10, 6);
    expect(shadeOf(38000).level).toBe(SHADE_LEVELS - 1);
    expect(shadeOf(45000).level).toBe(SHADE_LEVELS - 1);
    expect(shadeLift(-100)).toBe(0);
    for (let i = 1; i < SHADE_LEVELS; i++) {
      expect(shadeLevel(i).blur).toBeGreaterThan(shadeLevel(i - 1).blur);
      expect(shadeLevel(i).alpha).toBeLessThan(shadeLevel(i - 1).alpha);
    }
  });

  it('all fall one way (one fixed light), and grow with the icon', () => {
    for (const a of [500, 12000, 37000]) {
      const s = shadeOf(a);
      expect(s.dx / Math.hypot(s.dx, s.dy)).toBeCloseTo(SHADE_DIR[0], 6);
      expect(s.dy).toBeGreaterThan(0);
    }
    expect(shadeOf(37000, 1.3).dy).toBeCloseTo(shadeOf(37000, 1).dy * 1.3, 6);
    expect(Math.hypot(...SHADE_DIR)).toBeCloseTo(1, 6);
  });

  it('a leg known only by its progress climbs, cruises and descends', () => {
    expect(altByProgress(0)).toBe(0);
    expect(altByProgress(1)).toBe(0);
    expect(altByProgress(0.05)).toBeGreaterThan(0);
    expect(altByProgress(0.05)).toBeLessThan(altByProgress(0.12));
    expect(altByProgress(0.5)).toBe(36000);
    expect(altByProgress(0.95)).toBeLessThan(altByProgress(0.86));
  });
});

describe('v0.15 hangar depth', () => {
  it('the front row is true scale; rows behind a touch smaller and fainter, never more than 4 % smaller', () => {
    expect(hangarDepth(0)).toEqual({ scale: 1, fade: 1 });
    expect(hangarDepth(1).scale).toBeLessThan(1);
    expect(hangarDepth(1).fade).toBeLessThan(1);
    expect(hangarDepth(2).scale).toBeLessThan(hangarDepth(1).scale);
    expect(hangarDepth(7)).toEqual(hangarDepth(2));
    expect(hangarDepth(7).scale).toBeGreaterThanOrEqual(0.96);
    expect(hangarDepth(-1)).toEqual(hangarDepth(0));
  });
});
