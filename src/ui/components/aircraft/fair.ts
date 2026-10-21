// Fairing of traced fuselage lines (v0.5.2): the traces follow every pixel of the reference photo,
// which shows as a bumpy crown and belly. `fairLine` keeps the nose (radome, windscreen, cockpit)
// and the tail-cone tip exactly as approved and replaces the line between them by a smooth curve
// through the trace: a penalised least-squares fit (Whittaker smoother: second differences keep the
// cabin straight, third differences make curvature change slowly) on a uniform x grid, re-weighted
// until every grid point lies within a tolerance of the trace — tight at both junctions, looser along
// the cabin. The stiffness eases off towards both junctions so the curve can take the nose's and the
// tail cone's curvature without ringing. Along the constant-section cabin span of the crown the
// bending stiffness is raised ×CABIN_STIFF so the fit there is a straight line (no low waves). Pure; frame = traced fractions of L (x aft, y down).

type P2 = [number, number];

export interface FairOpts {
  /** Points with x below this stay exactly as traced (nose and cockpit). */
  lock: number;
  /** Points with x above this stay exactly as traced (tail-cone tip / APU exhaust). */
  tailLock: number;
  /** Grid step of the fit and step of the points handed to the renderer (fractions of L). */
  step: number;
  out: number;
  /** Smoothing weights: second differences (bending) and third (change of curvature). */
  bend: number;
  lambda: number;
  /** Max |fit − trace| along the cabin and at the two junctions. */
  tol: number;
  tolEnd: number;
  /** Length over which tolerance and stiffness ease in from each junction. */
  blend: number;
}

export const FAIR: FairOpts = {
  lock: 0.09, tailLock: 0.975, step: 0.0025, out: 0.005, bend: 2e4, lambda: 2e6, tol: 0.0032, tolEnd: 0.0012, blend: 0.06,
};

/** Constant-section crown span (fractions of L) when a profile gives none (TracedProfile.cabin). */
export const CABIN: readonly [number, number] = [0.2, 0.65];
const CABIN_STIFF = 1e5;
/** Stiffness rises over this length outside the cabin span (log-eased). */
const CABIN_RAMP = 0.03;

const ease = (u: number) => {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
};

/** 0 at either junction → 1 at `blend` inside them. */
function inside(x: number, o: FairOpts): number {
  return Math.min(ease((x - o.lock) / o.blend), ease((o.tailLock - x) / o.blend));
}

/** Tolerance at x (fraction of L): 0 where the trace is kept. */
export function fairTol(x: number, o: FairOpts = FAIR): number {
  if (x <= o.lock || x >= o.tailLock) return 0;
  return o.tolEnd + (o.tol - o.tolEnd) * inside(x, o);
}

/** Linear interpolation over points sorted by x (clamped). */
function interp(pts: readonly P2[], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) return b[0] === a[0] ? b[1] : a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
  }
  return pts[pts.length - 1][1];
}

/**
 * Whittaker smoother: minimises Σ w (z − y)² + Σ s_r (μ (Δ² z)_r² + λ (Δ³ z)_r²), with a stiffness
 * s per difference row (default 1). Banded Cholesky, O(n).
 */
export function whittaker(y: readonly number[], w: readonly number[], lambda: number, mu = 0, s?: readonly number[]): number[] {
  const n = y.length, k = 3, c3 = [-1, 3, -3, 1], c2 = [1, -2, 1];
  if (n <= k) return [...y];
  // a[i][d] = A[i][i + d]
  const a = Array.from({ length: n }, (_, i) => {
    const r = new Float64Array(k + 1);
    r[0] = w[i];
    return r;
  });
  const rows = (c: number[], m: number) => {
    if (!m) return;
    const b = c.length - 1;
    for (let r = 0; r + b < n; r++) {
      const v = m * (s ? s[r + (b >> 1)] : 1);
      for (let p = 0; p <= b; p++) for (let q = p; q <= b; q++) a[r + p][q - p] += v * c[p] * c[q];
    }
  };
  rows(c3, lambda);
  rows(c2, mu);
  // L[i][i − d] in l[i][d]
  const l = Array.from({ length: n }, () => new Float64Array(k + 1));
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - k); j <= i; j++) {
      let t = a[j][i - j];
      for (let m = Math.max(0, i - k); m < j; m++) t -= l[i][i - m] * l[j][j - m];
      if (i === j) l[i][0] = Math.sqrt(Math.max(t, 1e-300));
      else l[i][i - j] = t / l[j][0];
    }
  }
  const z = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let t = w[i] * y[i];
    for (let m = Math.max(0, i - k); m < i; m++) t -= l[i][i - m] * z[m];
    z[i] = t / l[i][0];
  }
  for (let i = n - 1; i >= 0; i--) {
    let t = z[i];
    for (let m = i + 1; m <= Math.min(n - 1, i + k); m++) t -= l[m][m - i] * z[m];
    z[i] = t / l[i][0];
  }
  return z;
}

/** Dev gallery only (`?fair=0`): draw the raw traces, set before the first render. */
export const fairing = { on: true };

const fairCache = new WeakMap<readonly (readonly [number, number])[], { key: string; out: P2[] }>();

/**
 * Faired copy of a traced top / bottom line (nose tip → tail-cone end, x aft). Points ahead of
 * `lock` and aft of `tailLock` are returned untouched; between them the line is resampled every
 * `out` on the smooth fit. `cabin`: span held straight (crown only; omit for the belly).
 */
export function fairLine(pts: readonly (readonly [number, number])[], o: FairOpts = FAIR, cabin?: readonly [number, number]): P2[] {
  if (!fairing.on) return pts.map(([x, y]): P2 => [x, y]);
  const key = cabin ? `${cabin[0]},${cabin[1]}` : '';
  const hit = o === FAIR ? fairCache.get(pts) : undefined;
  if (hit && hit.key === key) return hit.out;
  // x non-decreasing (as the renderer reads it)
  const src: P2[] = [];
  for (const [x, y] of pts) src.push([src.length ? Math.max(x, src[src.length - 1][0]) : x, y]);
  const xEnd = src[src.length - 1][0];
  if (src.length < 8 || xEnd < o.tailLock || o.tailLock - o.lock < 0.2) return src;
  // fit over [lock − 0.03, tailLock], held to the trace ahead of `lock` so the curve leaves the nose
  // with its slope, and at `tailLock` (the tail-cone tip often starts with a corner: no slope held)
  const x0 = Math.max(src[0][0], o.lock - 0.03), x1 = o.tailLock;
  const n = Math.max(8, Math.round((x1 - x0) / o.step));
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + ((x1 - x0) * i) / n);
  const y = xs.map((x) => interp(src, x));
  const tol = xs.map((x) => fairTol(x, o));
  const stiff = xs.map((x) => {
    const s = 0.02 + 0.98 * inside(x, o);
    if (!cabin) return s;
    const d = Math.max(cabin[0] - x, x - cabin[1], 0);
    return s * CABIN_STIFF ** ease(1 - d / CABIN_RAMP);
  });
  const HOLD = 1e9;
  const w = tol.map((t) => (t === 0 ? HOLD : 1));
  const solve = () => whittaker(y, w, o.lambda, o.bend, stiff);
  let z = solve();
  for (let it = 0; it < 80; it++) {
    let over = false;
    for (let i = 0; i <= n; i++) {
      const e = Math.abs(z[i] - y[i]);
      if (w[i] < HOLD && e > tol[i] * 0.98) {
        // pull harder where the fit strays, in proportion to how far
        w[i] *= 1 + 2 * (e / tol[i]);
        over = true;
      }
    }
    if (!over) break;
    z = solve();
  }
  const grid = xs.map((v, i): P2 => [v, z[i]]);
  const out: P2[] = src.filter(([x]) => x < o.lock);
  const m = Math.max(1, Math.round((o.tailLock - o.lock) / o.out));
  for (let i = 0; i < m; i++) {
    const x = o.lock + ((o.tailLock - o.lock) * i) / m;
    out.push([x, interp(grid, x)]);
  }
  out.push(...src.filter(([x]) => x >= o.tailLock));
  if (o === FAIR) fairCache.set(pts, { key, out });
  return out;
}
