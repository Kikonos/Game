import { describe, expect, it } from 'vitest';
import { CABIN, FAIR, fairLine, whittaker } from './fair';
import { TRACED } from './traced/load';

type P = readonly (readonly [number, number])[];
const yAt = (pts: P, x: number) => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return pts[pts.length - 1][1];
};
/** Sign changes of the second difference along [x0, x1], ignoring curvature below `eps` (noise floor). */
const wiggles = (pts: P, x0: number, x1: number, h = 0.01, eps = 2) => {
  let n = 0, last = 0;
  for (let x = x0; x <= x1; x += h) {
    const c = (yAt(pts, x - h) - 2 * yAt(pts, x) + yAt(pts, x + h)) / (h * h);
    if (Math.abs(c) < eps) continue;
    const s = Math.sign(c);
    if (last && s !== last) n++;
    last = s;
  }
  return n;
};
/** Sign changes of the slope along [x0, x1] (steps under `eps` L ignored). */
const reversals = (pts: P, x0: number, x1: number, h = 0.01, eps = 1e-5) => {
  let n = 0, last = 0;
  for (let x = x0; x + h <= x1 + 1e-9; x += h) {
    const d = yAt(pts, x + h) - yAt(pts, x);
    if (Math.abs(d) < eps) continue;
    const s = Math.sign(d);
    if (last && s !== last) n++;
    last = s;
  }
  return n;
};

describe('fairing of traced fuselage lines', () => {
  it('whittaker with huge weights returns the data, with none the straight-ish fit', () => {
    const y = [0, 1, 0, 1, 0, 1, 0, 1];
    expect(whittaker(y, y.map(() => 1e12), 10).every((v, i) => Math.abs(v - y[i]) < 1e-6)).toBe(true);
    const z = whittaker(y, y.map(() => 1), 1e6, 1e6);
    // stiff: a straight line (no second differences left)
    expect(Math.max(...z.slice(2).map((v, i) => Math.abs(v - 2 * z[i + 1] + z[i])))).toBeLessThan(1e-3);
  });

  for (const [id, t] of TRACED) {
    if (t.outline?.length) continue; // silhouette types draw the outline, not top / bottom
    for (const side of ['top', 'bottom'] as const) {
      it(`${id} ${side}: nose and tail-cone tip exact, within 0.0035 L elsewhere, no bumps`, () => {
        const src = t[side];
        const cabin = side === 'top' ? t.cabin ?? CABIN : undefined;
        const f = fairLine(src, FAIR, cabin);
        for (const [x, y] of src) {
          const d = Math.abs(yAt(f, x) - y);
          if (x < FAIR.lock) expect(d, `nose x=${x}`).toBeLessThan(1e-9);
          else expect(d, `x=${x}`).toBeLessThan(0.0035);
        }
        expect(f[f.length - 1]).toEqual([...src[src.length - 1]]);
        // the cabin stretch between nose blend and tail cone: no curvature reversals beyond noise
        expect(wiggles(f, 0.2, 0.7)).toBeLessThanOrEqual(2);
        // constant-section crown: no low waves (at most one slope reversal over the cabin span)
        if (cabin) expect(reversals(f, cabin[0], cabin[1]), `cabin ${cabin}`).toBeLessThanOrEqual(1);
      });
    }
  }
});
