// Tiny path/geometry helpers. World frame: metres, y up. Paths are emitted in
// SVG coordinates (y flipped) with centimetre precision.

export type V = readonly [number, number];

const f = (n: number): string => {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Path builder that also tracks the world-space extents of every point it emits. */
export class D {
  s = '';
  M(p: V): this { this.s += `M${f(p[0])} ${f(-p[1])}`; return this; }
  L(p: V): this { this.s += `L${f(p[0])} ${f(-p[1])}`; return this; }
  C(a: V, b: V, p: V): this {
    this.s += `C${f(a[0])} ${f(-a[1])} ${f(b[0])} ${f(-b[1])} ${f(p[0])} ${f(-p[1])}`;
    return this;
  }
  Q(a: V, p: V): this { this.s += `Q${f(a[0])} ${f(-a[1])} ${f(p[0])} ${f(-p[1])}`; return this; }
  Z(): this { this.s += 'Z'; return this; }
  /** Polyline through pts (optionally closed). */
  poly(pts: readonly V[], close = true): this {
    pts.forEach((p, i) => (i ? this.L(p) : this.M(p)));
    return close ? this.Z() : this;
  }
  /** Cubic chain as points [p0, c1, c2, p1, ...]; `move` starts a new subpath. */
  chain(pts: readonly V[], move = false): this {
    if (move) this.M(pts[0]);
    for (let i = 1; i + 2 < pts.length; i += 3) this.C(pts[i], pts[i + 1], pts[i + 2]);
    return this;
  }
  /** Smooth curve through pts (Catmull-Rom as cubics); `move` starts a new subpath. */
  smooth(pts: readonly V[], move = true, k = 1 / 6): this {
    if (move) this.M(pts[0]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[i + 1], d = pts[Math.min(pts.length - 1, i + 2)];
      this.C([b[0] + (c[0] - a[0]) * k, b[1] + (c[1] - a[1]) * k], [c[0] - (d[0] - b[0]) * k, c[1] - (d[1] - b[1]) * k], c);
    }
    return this;
  }
  /**
   * Smooth curve through dense traced points: cubic per segment with unit chord-bisector
   * tangents scaled by the segment length (no overshoot on uneven spacing). A turn sharper
   * than `corner` degrees keeps its corner; the ends keep the direction of their segment.
   */
  spline(pts: readonly V[], move = true, corner = 50): this {
    const n = pts.length;
    if (!n) return this;
    if (move) this.M(pts[0]);
    const tan = tangents(pts, false, corner);
    for (let i = 0; i + 1 < n; i++) {
      const b = pts[i], c = pts[i + 1], d = dist(b, c) / 3;
      this.C([b[0] + tan[i][0] * d, b[1] + tan[i][1] * d], [c[0] - tan[i + 1][0] * d, c[1] - tan[i + 1][1] * d], c);
    }
    return this;
  }
  /** Closed `spline` (last point joins back to the first). */
  splineClosed(pts: readonly V[], corner = 50): this {
    const n = pts.length;
    if (n < 3) return this.poly(pts);
    this.M(pts[0]);
    const tan = tangents(pts, true, corner);
    for (let i = 0; i < n; i++) {
      const b = pts[i], c = pts[(i + 1) % n], d = dist(b, c) / 3;
      this.C([b[0] + tan[i][0] * d, b[1] + tan[i][1] * d], [c[0] - tan[(i + 1) % n][0] * d, c[1] - tan[(i + 1) % n][1] * d], c);
    }
    return this.Z();
  }
  /**
   * Axis-aligned ellipse (centre in world coords). The x radius is written as half the rounded
   * chord so both arcs meet on the diameter: with a separately rounded radius, centimetre rounding
   * of a slim ellipse leaves the chord short of 2 rx and each large arc bulges far past ry.
   */
  ellipse(c: V, rx: number, ry: number): this {
    const x = c[0], y = -c[1];
    const x0 = f(x - rx), x1 = f(x + rx);
    const r = String(Math.round((Number(x1) - Number(x0)) * 500) / 1000);
    this.s += `M${x0} ${f(y)}A${r} ${f(ry)} 0 1 0 ${x1} ${f(y)}A${r} ${f(ry)} 0 1 0 ${x0} ${f(y)}Z`;
    return this;
  }
  /** Rounded rect from world bottom-left corner. */
  rrect(x: number, y: number, w: number, h: number, r: number): this {
    r = Math.min(r, w / 2, h / 2);
    const t = -(y + h), b = -y;
    this.s += `M${f(x + r)} ${f(t)}H${f(x + w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(t + r)}V${f(b - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(b)}H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(b - r)}V${f(t + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(t)}Z`;
    return this;
  }
  toString(): string { return this.s; }
}

export const dist = (a: V, b: V): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const unit = (a: V, b: V): V => {
  const d = dist(a, b) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};

/** Unit tangent per point for `spline`: zero at corners (turn > `corner` deg), so the curve stays sharp there. */
function tangents(pts: readonly V[], closed: boolean, corner: number): V[] {
  const n = pts.length;
  const cosC = Math.cos((corner * Math.PI) / 180);
  return pts.map((b, i) => {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const c = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    if (a === b || c === b) return unit(a, c);
    const u = unit(a, b), v = unit(b, c);
    if (u[0] * v[0] + u[1] * v[1] < cosC) return [0, 0];
    return unit([0, 0], [u[0] + v[0], u[1] + v[1]]);
  });
}

/** One light Laplacian pass over the interior points (corners and ends stay put): takes the wobble out of a trace. */
export function relax(pts: readonly V[], k = 0.3, corner = 50): V[] {
  const n = pts.length;
  const cosC = Math.cos((corner * Math.PI) / 180);
  return pts.map((b, i) => {
    if (i === 0 || i === n - 1) return b;
    const a = pts[i - 1], c = pts[i + 1];
    const u = unit(a, b), v = unit(b, c);
    if (u[0] * v[0] + u[1] * v[1] < cosC) return b;
    return [b[0] + ((a[0] + c[0]) / 2 - b[0]) * k, b[1] + ((a[1] + c[1]) / 2 - b[1]) * k];
  });
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: V, b: V, t: number): V => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
export const rad = (deg: number): number => (deg * Math.PI) / 180;

export function cubic(p0: V, c1: V, c2: V, p1: V, t: number): V {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
}

/** Split a cubic at t; returns the second half [p, c1, c2, p1]. */
export function splitTail(p0: V, c1: V, c2: V, p1: V, t: number): [V, V, V, V] {
  const ab = lerpV(p0, c1, t), bc = lerpV(c1, c2, t), cd = lerpV(c2, p1, t);
  const abc = lerpV(ab, bc, t), bcd = lerpV(bc, cd, t);
  return [lerpV(abc, bcd, t), bcd, cd, p1];
}

/** Flat chain numbers -> points via a mapping. */
export function chainPts(chain: readonly number[], map: (u: number, v: number) => V): V[] {
  const out: V[] = [];
  for (let i = 0; i + 1 < chain.length; i += 2) out.push(map(chain[i], chain[i + 1]));
  return out;
}

/** Sample a cubic chain [p0, c1, c2, p1, ...] into a polyline. */
export function sampleChain(pts: readonly V[], n = 14): V[] {
  const out: V[] = [pts[0]];
  for (let i = 1; i + 2 < pts.length; i += 3) {
    for (let k = 1; k <= n; k++) out.push(cubic(pts[i - 1], pts[i], pts[i + 1], pts[i + 2], k / n));
  }
  return out;
}

/** Linear interpolation of y over a polyline sorted by x (clamped at the ends). */
export function yAt(samples: readonly V[], x: number): number {
  if (x <= samples[0][0]) return samples[0][1];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    if (x <= b[0]) return b[0] === a[0] ? b[1] : lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }
  return samples[samples.length - 1][1];
}

/** Running world-space bounding box. */
export class Box {
  x0 = Infinity; y0 = Infinity; x1 = -Infinity; y1 = -Infinity;
  add(...pts: readonly V[]): this {
    for (const [x, y] of pts) {
      if (x < this.x0) this.x0 = x;
      if (x > this.x1) this.x1 = x;
      if (y < this.y0) this.y0 = y;
      if (y > this.y1) this.y1 = y;
    }
    return this;
  }
  merge(b: Box): this { return this.add([b.x0, b.y0], [b.x1, b.y1]); }
  clone(): Box { return new Box().merge(this); }
}
