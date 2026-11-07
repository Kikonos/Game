// v0.18 small 3D aircraft for the globe, built from the same per-type specs as the flat map's silhouettes
// (silhouettes.ts: length, span, fuselage width, nose and tail cone, wing and tailplane planforms, engine stations,
// the 747's hump and the A380's upper deck): a round fuselage with a raised tail cone, low wings with dihedral, the
// tailplane, a swept fin and the nacelles under the wing. A few hundred triangles each, in metres (x to the right wing,
// y to the nose, z up), coloured per vertex (fuselage and wings 1, nacelles dark) so one material per livery colour
// tints every type. Pure geometry maths here (positions, normals, colours); globeGL wraps them in three.js buffers.

import { nacelles, silSpec, tailplaneOutline, wingOutline } from '../silhouettes';

export interface ModelData {
  /** Triangle soup: 9 numbers per triangle, metres. */
  pos: Float32Array;
  nrm: Float32Array;
  /** Per-vertex shade (0..1, rgb), multiplied by the material's colour. */
  col: Float32Array;
  /** Length and span (m), the nacelles' spread (m, the outermost pair), the fin's top (m above the centreline). */
  L: number;
  S: number;
  engX: number;
  top: number;
}

type V3 = [number, number, number];
const RAD = Math.PI / 180;
const subV = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crossV = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normV = (a: V3): V3 => {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
};

class Soup {
  pos: number[] = [];
  nrm: number[] = [];
  col: number[] = [];
  /** A triangle with its face normal (flat), or per-vertex normals. Winding: counter-clockwise seen from outside. */
  tri(a: V3, b: V3, c: V3, shade: number, n?: [V3, V3, V3]) {
    const f = normV(crossV(subV(b, a), subV(c, a)));
    const ns = n ?? [f, f, f];
    for (const [p, q] of [[a, ns[0]], [b, ns[1]], [c, ns[2]]] as [V3, V3][]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(q[0], q[1], q[2]);
      this.col.push(shade, shade, shade);
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, shade: number, n?: [V3, V3, V3, V3]) {
    this.tri(a, b, c, shade, n && [n[0], n[1], n[2]]);
    this.tri(a, c, d, shade, n && [n[0], n[2], n[3]]);
  }
}

/** Ear-clipping triangulation of a simple polygon (x, y), any winding; indices into pts. */
export function triangulate(pts: [number, number][]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const ccw = area > 0;
  const idx = [...Array(n).keys()];
  if (!ccw) idx.reverse();
  const out: [number, number, number][] = [];
  const cross2 = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p: number, a: number, b: number, c: number) => cross2(a, b, p) >= 0 && cross2(b, c, p) >= 0 && cross2(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 500) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length];
      const b = idx[i];
      const c = idx[(i + 1) % idx.length];
      if (cross2(a, b, c) <= 1e-9) continue;
      if (idx.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      out.push(ccw ? [a, b, c] : [a, c, b]);
      idx.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(ccw ? [idx[0], idx[1], idx[2]] : [idx[0], idx[2], idx[1]]);
  return out;
}

/**
 * A thin slab from a planform outline: `place` maps an outline point (u, v) to the slab's middle surface in model space,
 * `thick` gives its thickness there, `up` the slab's up direction. Top, bottom and the edge walls.
 */
function slab(s: Soup, outline: [number, number][], place: (u: number, v: number) => V3, thick: (u: number, v: number) => number, up: V3, shade: number) {
  const top = outline.map(([u, v]) => { const p = place(u, v); const t = thick(u, v) / 2; return [p[0] + up[0] * t, p[1] + up[1] * t, p[2] + up[2] * t] as V3; });
  const bot = outline.map(([u, v]) => { const p = place(u, v); const t = thick(u, v) / 2; return [p[0] - up[0] * t, p[1] - up[1] * t, p[2] - up[2] * t] as V3; });
  const tris = triangulate(outline);
  // Orientation: make the top face's normal point along `up`.
  const dotUp = (t: [number, number, number]) => {
    const n = crossV(subV(top[t[1]], top[t[0]]), subV(top[t[2]], top[t[0]]));
    return n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
  };
  const flip = tris.length > 0 && dotUp(tris[0]) < 0;
  for (const t of tris) {
    const [a, b, c] = flip ? [t[0], t[2], t[1]] : t;
    s.tri(top[a], top[b], top[c], shade);
    s.tri(bot[a], bot[c], bot[b], shade * 0.9);
  }
  // Walls: outward normals come from the winding (computed per face; the outline's own winding decides).
  const n = outline.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (flip) s.quad(top[j], top[i], bot[i], bot[j], shade * 0.85);
    else s.quad(top[i], top[j], bot[j], bot[i], shade * 0.85);
  }
}

/** A lathe along y: rings of `seg` points at stations (y, rx, rz, zc: centre height). Smooth normals. */
function lathe(s: Soup, st: { y: number; rx: number; rz: number; zc: number; x?: number }[], seg: number, shade: number, capEnds = false) {
  const ring = (k: (typeof st)[number]) => Array.from({ length: seg }, (_, i) => {
    const a = (i / seg) * Math.PI * 2;
    const p: V3 = [(k.x ?? 0) + Math.cos(a) * k.rx, k.y, k.zc + Math.sin(a) * k.rz];
    const n = normV([Math.cos(a) / Math.max(1e-3, k.rx), 0, Math.sin(a) / Math.max(1e-3, k.rz)]);
    return { p, n };
  });
  const rings = st.map(ring);
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    // Stations run nose to tail (y decreasing): wind so the outside faces out.
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      s.quad(A[i].p, A[j].p, B[j].p, B[i].p, shade, [A[i].n, A[j].n, B[j].n, B[i].n]);
    }
  }
  if (capEnds) {
    for (const [R, y, sign] of [[rings[0], st[0].y, 1], [rings[rings.length - 1], st[st.length - 1].y, -1]] as const) {
      const c: V3 = [st[sign > 0 ? 0 : st.length - 1].x ?? 0, y, sign > 0 ? st[0].zc : st[st.length - 1].zc];
      const nn: V3 = [0, sign, 0];
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        if (sign > 0) s.tri(c, R[j].p, R[i].p, shade * 0.6, [nn, nn, nn]);
        else s.tri(c, R[i].p, R[j].p, shade * 0.6, [nn, nn, nn]);
      }
    }
  }
}

const cache = new Map<string, ModelData>();

/** v0.18 the 3D model of a type (cached; unknown types: an A320, as the flat map). */
export function modelOf(typeId: string): ModelData {
  let m = cache.get(typeId);
  if (!m) cache.set(typeId, (m = buildModel(typeId)));
  return m;
}

function buildModel(typeId: string): ModelData {
  const s = silSpec(typeId);
  const soup = new Soup();
  const L = s.L;
  // Model y: the nose at +L/2; silhouette y (m aft of the nose) → model y.
  const Y = (y: number) => L / 2 - y;
  // A touch fuller than life (as the flat map's), so a narrowbody still has a body at map size.
  const h = (s.fw / 2) * 1.15;
  const tall = s.deck && s.deck > 0.8 ? 1.32 : 1.04;
  const y1 = L - s.tail;
  // Fuselage: ogive nose, the tube, the tail cone rising to the APU.
  const st: { y: number; rx: number; rz: number; zc: number }[] = [];
  for (const [f, r] of [[0, 0.02], [0.12, 0.42], [0.32, 0.72], [0.6, 0.92], [1, 1]] as const) st.push({ y: Y(s.nose * f), rx: h * r, rz: h * r * tall, zc: -h * (1 - r) * 0.25 });
  st.push({ y: Y((s.nose + y1) / 2), rx: h, rz: h * tall, zc: 0 });
  st.push({ y: Y(y1), rx: h, rz: h * tall, zc: 0 });
  for (const [f, r] of [[0.35, 0.82], [0.65, 0.55], [0.88, 0.3], [1, 0.12]] as const) st.push({ y: Y(y1 + s.tail * f), rx: h * r, rz: h * r * tall, zc: h * tall * 0.55 * f ** 1.4 });
  lathe(soup, st, 10, 1);
  // The 747's hump: a short second tube on the crown, from behind the nose to the deck's end.
  if (s.deck && s.deck <= 0.8) {
    const dl = s.deck * L;
    const hs: { y: number; rx: number; rz: number; zc: number }[] = [];
    for (const [f, r] of [[0.08, 0.2], [0.18, 0.62], [0.35, 0.8], [0.7, 0.78], [0.92, 0.55], [1, 0.12]] as const) hs.push({ y: Y(dl * f), rx: h * 0.66 * r / 0.8, rz: h * 0.5 * r / 0.8, zc: h * tall * 0.62 });
    lathe(soup, hs, 8, 1);
  }
  // Wings: low on the fuselage, 5° dihedral, thinner towards the tip.
  const b = s.S / 2;
  const wing = wingOutline(s);
  const zW = -h * tall * 0.5;
  const dih = Math.tan(5 * RAD);
  const r0 = wing[0][0];
  for (const sx of [1, -1]) {
    slab(soup, wing.map(([x, y]) => [sx * x, y] as [number, number]), (u, v) => [u, Y(v), zW + (Math.abs(u) - r0) * dih], (u) => s.rootC * 0.13 * (1 - 0.75 * Math.min(1, Math.abs(u) / b)), [0, 0, 1], 1);
  }
  // Tailplane: on the tail cone, 7° dihedral.
  const ht = tailplaneOutline(s);
  const zH = h * tall * 0.25;
  const dihH = Math.tan(7 * RAD);
  for (const sx of [1, -1]) {
    slab(soup, ht.map(([x, y]) => [sx * x, y] as [number, number]), (u, v) => [u, Y(v), zH + Math.abs(u) * dihH], () => s.htC * 0.1, [0, 0, 1], 1);
  }
  // Fin: swept, standing on the tail cone (outline in (aft, up) metres; the slab's "up" is the starboard side).
  const finH = Math.max(5, (L * 0.145) * (s.deck && s.deck > 0.8 ? 0.95 : 1));
  const cr = s.htC * 1.55;
  const ct = cr * 0.42;
  const fy0 = Math.min(L - cr - 0.5, s.htX * L - L * 0.035);
  const sw = Math.tan((s.htSweep + 6) * RAD);
  const zf = h * tall * 0.55;
  const fin: [number, number][] = [[fy0, 0], [fy0 + finH * sw, finH], [fy0 + finH * sw + ct, finH], [Math.min(L - 0.3, fy0 + cr), 0]];
  slab(soup, fin, (u, v) => [0, Y(u), zf + v], (_u, v) => cr * 0.09 * (1 - 0.5 * (v / finH)), [1, 0, 0], 0.95);
  // Nacelles: hanging under and ahead of the wing.
  let engX = 0;
  for (const nc of nacelles(s)) {
    engX = Math.max(engX, nc.x);
    for (const sx of [1, -1]) {
      const x = sx * nc.x;
      const zc = zW + (nc.x - r0) * dih - nc.w * 0.55;
      const r = nc.w / 2;
      lathe(soup, [
        { x, y: Y(nc.y), rx: r * 0.92, rz: r * 0.92, zc },
        { x, y: Y(nc.y + nc.l * 0.15), rx: r, rz: r, zc },
        { x, y: Y(nc.y + nc.l * 0.7), rx: r * 0.92, rz: r * 0.92, zc },
        { x, y: Y(nc.y + nc.l), rx: r * 0.6, rz: r * 0.6, zc },
      ], 8, 0.42, true);
    }
  }
  return { pos: new Float32Array(soup.pos), nrm: new Float32Array(soup.nrm), col: new Float32Array(soup.col), L, S: s.S, engX, top: zf + finH };
}
