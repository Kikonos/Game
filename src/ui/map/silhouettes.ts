// v0.12 Visual A: top-down aircraft silhouettes for the map (Flightradar24 style), one per type with its real
// proportions: length and span (src/data/aircraft.ts), fuselage width, wing sweep and chords, the tailplane, and the
// engines where they really hang under the wing (count and spanwise station). Pure (no DOM): the map turns a shape into
// SVG path strings once per type and size. Figures are approximations of published three-view drawings and type
// certificate data sheets (fuselage widths, engine stations as a share of the half span, tailplane spans).

import { AIRCRAFT } from '../../data/aircraft';

export interface SilSpec {
  /** Overall length and span (m). */
  L: number;
  S: number;
  /** Fuselage width (m). */
  fw: number;
  /** Nose taper and tail cone lengths (m). */
  nose: number;
  tail: number;
  /** Wing root leading edge at the fuselage side, as a share of the length from the nose. */
  wingX: number;
  /** Chords (m) at the fuselage side, at the trailing-edge kink and at the tip. */
  rootC: number;
  kinkC: number;
  tipC: number;
  /** Kink station (share of the half span). */
  kink: number;
  /** Leading-edge sweep (deg). */
  sweep: number;
  /** Wing tip: plain, raked (787, 777-300ER, 747-8) or curved (A350). */
  tip?: 'raked' | 'curved';
  /** Tailplane span (m), root chord (m), leading-edge sweep (deg); its root leading edge as a share of the length. */
  htS: number;
  htC: number;
  htSweep: number;
  htX: number;
  /** Engine stations on one wing, as a share of the half span (one per engine: 1 = twin, 2 = quad). */
  eng: number[];
  /** Nacelle length and width (m); share of the nacelle ahead of the wing's leading edge. */
  nl: number;
  nd: number;
  nOver: number;
  /** Upper deck seen from above (share of the length from the nose): the 747's hump; the A380's runs the whole way. */
  deck?: number;
}

type Shape = Omit<SilSpec, 'L' | 'S'>;

// ---------- families (shared geometry; length and span per type below) ----------

const A320: Shape = { fw: 3.95, nose: 4.6, tail: 9.5, wingX: 0.365, rootC: 6.0, kinkC: 3.7, tipC: 1.5, kink: 0.36, sweep: 27, htS: 12.45, htC: 3.6, htSweep: 31, htX: 0.835, eng: [0.33], nl: 4.4, nd: 2.3, nOver: 0.6 };
const A320NEO: Shape = { ...A320, nl: 5.0, nd: 2.55 };
const B737: Shape = { fw: 3.76, nose: 4.2, tail: 8.6, wingX: 0.375, rootC: 6.0, kinkC: 3.9, tipC: 1.25, kink: 0.3, sweep: 27, htS: 14.35, htC: 3.9, htSweep: 32, htX: 0.835, eng: [0.27], nl: 4.1, nd: 2.1, nOver: 0.72 };
const B757: Shape = { fw: 3.76, nose: 4.5, tail: 9, wingX: 0.37, rootC: 7.4, kinkC: 4.4, tipC: 1.7, kink: 0.3, sweep: 27, htS: 15.2, htC: 4.3, htSweep: 31, htX: 0.85, eng: [0.33], nl: 5.2, nd: 2.6, nOver: 0.62 };
const B767: Shape = { fw: 5.03, nose: 5.5, tail: 11, wingX: 0.36, rootC: 8.6, kinkC: 5.2, tipC: 2.2, kink: 0.3, sweep: 33, htS: 18.6, htC: 5.3, htSweep: 33, htX: 0.84, eng: [0.33], nl: 5.6, nd: 2.9, nOver: 0.6 };
const B777: Shape = { fw: 6.2, nose: 6.5, tail: 13, wingX: 0.36, rootC: 11.5, kinkC: 7.0, tipC: 2.5, kink: 0.28, sweep: 33, htS: 21.5, htC: 6.2, htSweep: 34, htX: 0.85, eng: [0.31], nl: 7.3, nd: 3.9, nOver: 0.55 };
const B777X: Shape = { ...B777, tip: 'raked', tipC: 1.8, nl: 7.6, nd: 4.3, rootC: 12 };
const B787: Shape = { fw: 5.77, nose: 6, tail: 12, wingX: 0.37, rootC: 10.5, kinkC: 6.0, tipC: 1.9, kink: 0.3, sweep: 34, tip: 'raked', htS: 19.5, htC: 5.7, htSweep: 34, htX: 0.85, eng: [0.32], nl: 6.5, nd: 3.5, nOver: 0.55 };
const A330: Shape = { fw: 5.64, nose: 6, tail: 12, wingX: 0.36, rootC: 10.6, kinkC: 6.0, tipC: 1.6, kink: 0.33, sweep: 32, htS: 19.4, htC: 5.5, htSweep: 33, htX: 0.85, eng: [0.31], nl: 6.5, nd: 3.0, nOver: 0.58 };
const A340: Shape = { ...A330, eng: [0.3, 0.6], nl: 5.2, nd: 2.3, nOver: 0.6 };
const A340NG: Shape = { ...A330, rootC: 11.5, kinkC: 6.6, eng: [0.3, 0.61], nl: 6.0, nd: 2.7, nOver: 0.6 };
const A350: Shape = { fw: 5.96, nose: 6.5, tail: 12, wingX: 0.37, rootC: 12, kinkC: 6.5, tipC: 1.8, kink: 0.32, sweep: 33, tip: 'curved', htS: 19.5, htC: 5.8, htSweep: 34, htX: 0.85, eng: [0.33], nl: 7.0, nd: 3.7, nOver: 0.55 };
const B747: Shape = { fw: 6.5, nose: 7, tail: 13, wingX: 0.355, rootC: 14, kinkC: 8, tipC: 3.0, kink: 0.3, sweep: 40, htS: 22.2, htC: 6.8, htSweep: 38, htX: 0.84, eng: [0.4, 0.7], nl: 6.0, nd: 2.9, nOver: 0.55, deck: 0.27 };
const A380: Shape = { fw: 7.14, nose: 7.5, tail: 13, wingX: 0.3, rootC: 17.5, kinkC: 10, tipC: 4.0, kink: 0.33, sweep: 35, htS: 30.4, htC: 8.5, htSweep: 36, htX: 0.8, eng: [0.37, 0.64], nl: 7.2, nd: 3.6, nOver: 0.55, deck: 0.93 };

/** Per type: the family's shape plus what differs (stretch moves the wing aft as a share of the length). */
const OWN: Record<string, Partial<SilSpec> & { base: Shape }> = {
  a320ceo: { base: A320 },
  a321ceo: { base: A320, wingX: 0.385 },
  a321neo: { base: A320NEO, wingX: 0.385 },
  a320neo: { base: A320NEO },
  b738: { base: B737 },
  b739: { base: B737, wingX: 0.39 },
  b752: { base: B757 },
  b753: { base: B757, wingX: 0.385 },
  b763: { base: B767 },
  a332: { base: A330, wingX: 0.345 },
  a333: { base: A330, wingX: 0.37 },
  a339: { base: A330, wingX: 0.37, nl: 7.0, nd: 3.5 },
  a342: { base: A340, wingX: 0.35 },
  a343: { base: A340, wingX: 0.37 },
  a345: { base: A340NG, wingX: 0.36 },
  a346: { base: A340NG, wingX: 0.4 },
  b772: { base: B777 },
  b77w: { base: B777, wingX: 0.395, tip: 'raked', tipC: 1.9, nd: 4.1 },
  b778: { base: B777X, wingX: 0.38 },
  b779: { base: B777X, wingX: 0.4 },
  b788: { base: B787, wingX: 0.355 },
  b789: { base: B787 },
  b78x: { base: B787, wingX: 0.39 },
  a359: { base: A350 },
  a35u: { base: A350 },
  a35k: { base: A350, wingX: 0.4, nl: 7.4, nd: 3.9 },
  b741: { base: B747 },
  b742: { base: B747 },
  b743: { base: B747, deck: 0.36 },
  b744: { base: B747, deck: 0.36, eng: [0.37, 0.65], tipC: 2.6 },
  b748: { base: B747, deck: 0.4, eng: [0.38, 0.66], wingX: 0.37, tip: 'raked', tipC: 2.0, nl: 6.3, nd: 3.1 },
  a388: { base: A380 },
};

/** Silhouette family per type, for the legend and the test table. */
export const SIL_FAMILY: Record<string, string> = {
  a320ceo: 'A320', a321ceo: 'A320', a321neo: 'A320neo', a320neo: 'A320neo', b738: '737', b739: '737', b752: '757', b753: '757', b763: '767',
  a332: 'A330', a333: 'A330', a339: 'A330neo', a342: 'A340', a343: 'A340', a345: 'A340-500/600', a346: 'A340-500/600',
  b772: '777', b77w: '777', b778: '777X', b779: '777X', b788: '787', b789: '787', b78x: '787', a359: 'A350', a35u: 'A350', a35k: 'A350',
  b741: '747', b742: '747', b743: '747', b744: '747', b748: '747', a388: 'A380',
};

/** v0.12 map colour per family (the player reads the type at a glance): Airbus and Boeing families each get their own hue,
 *  variants (neo, 777X, A340-500/600) keep their family's. Order = the legend's. */
export const SIL_COLOURS: { family: string; label: string; colour: string }[] = [
  { family: 'A320', label: 'A320 / A321', colour: '#3b82f6' },
  { family: 'A330', label: 'A330', colour: '#a855f7' },
  { family: 'A340', label: 'A340', colour: '#ec4899' },
  { family: 'A350', label: 'A350', colour: '#0d9488' },
  { family: 'A380', label: 'A380', colour: '#ef4444' },
  { family: '737', label: '737', colour: '#22c55e' },
  { family: '757', label: '757', colour: '#a3e635' },
  { family: '767', label: '767', colour: '#b45309' },
  { family: '777', label: '777', colour: '#f97316' },
  { family: '787', label: '787', colour: '#06b6d4' },
  { family: '747', label: '747', colour: '#facc15' },
];
const COLOUR_OF = new Map(SIL_COLOURS.map((c) => [c.family, c.colour]));

/** The colour family of a type (A321neo → A320, 777-9 → 777, A340-600 → A340). */
export const silColourFamily = (typeId: string): string => (SIL_FAMILY[typeId] ?? 'A320').replace(/neo$|X$|-500\/600$/, '');

/** The map fill of a type: its family's colour. */
export const silColour = (typeId: string): string => COLOUR_OF.get(silColourFamily(typeId)) ?? '#3b82f6';

const DIMS = new Map(AIRCRAFT.map((a) => [a.id, { L: a.lengthM, S: a.spanM }]));

/** The silhouette spec of a type (unknown types: an A320, so nothing ever goes undrawn). */
export function silSpec(typeId: string): SilSpec {
  const own = OWN[typeId] ?? OWN.a320ceo;
  const d = DIMS.get(OWN[typeId] ? typeId : 'a320ceo') ?? { L: 37.6, S: 34.1 };
  const { base, ...rest } = own;
  return { ...base, ...d, ...rest };
}

/** Types with a silhouette of their own. */
export const SIL_TYPES = Object.keys(OWN);

// ---------- size on the map ----------

/**
 * v0.14 to scale: every aircraft on the map shares ONE pixels-per-metre, so an A330 (60.3 m span) is drawn 1.7 times
 * an A320 (35.8 m) and a 747 (70.6 m long) twice its length, at every zoom (v0.12 grew icons with the 0.7 power of the
 * real size and shrank widebodies to fit their stands, so the two read alike). The scale grows gently as the map zooms
 * in (the 0.22 power of the zoom), clamped for the whole set together: the smallest type in the set never under
 * SIL_MIN_PX (still tappable; the tap target is bigger anyway), the largest never over SIL_MAX_PX.
 */
export const SIL_MIN_PX = 18;
export const SIL_MAX_PX = 64;
/** Largest dimension (m) of the smallest and the largest type with a silhouette (A320 37.6 m; A380 79.8 m span). */
const dimOf = (id: string) => { const s = silSpec(id); return Math.max(s.L, s.S); };
export const SIL_MIN_M = Math.min(...SIL_TYPES.map(dimOf));
export const SIL_MAX_M = Math.max(...SIL_TYPES.map(dimOf));
/** Px per metre at the whole-world zoom (k = 1): the smallest type at SIL_MIN_PX; and how fast it grows with the zoom. */
const ZOOM_POW = 0.22;

/** v0.14 screen px per metre for every aircraft at map zoom k (1 = the whole world). Pure. */
export function mapPxPerM(k: number): number {
  const lo = SIL_MIN_PX / SIL_MIN_M;
  const hi = SIL_MAX_PX / SIL_MAX_M;
  return Math.max(lo, Math.min(hi, lo * Math.max(1, k) ** ZOOM_POW));
}

/** v0.14 silhouettes are built once at this px per metre; the map scales each glyph by mapPxPerM(k) / SIL_BUILD_K. */
export const SIL_BUILD_K = 0.6;

/** Screen px per metre for a type as built (the same for every type: to scale). */
export function silScale(_s?: Pick<SilSpec, 'L' | 'S'>): number {
  return SIL_BUILD_K;
}

/** Largest dimension in screen px as built. */
export const silPx = (s: Pick<SilSpec, 'L' | 'S'>) => Math.max(s.L, s.S) * silScale(s);

// ---------- geometry ----------

type Pt = [number, number];
const RAD = Math.PI / 180;

/** Leading-edge y (m from the nose) of the wing at x (m from the centreline). */
function leY(s: SilSpec, x: number): number {
  const r = s.fw / 2;
  return s.wingX * s.L + Math.max(0, x - r) * Math.tan(s.sweep * RAD);
}

/** Right wing outline (x outwards, y aft, metres from the nose), root to tip along the leading edge, back along the trailing edge. */
export function wingOutline(s: SilSpec): Pt[] {
  const b = s.S / 2;
  const r = s.fw * 0.35;
  const xk = s.fw / 2 + s.kink * (b - s.fw / 2);
  const root: Pt = [r, leY(s, 0)];
  const pts: Pt[] = [root];
  if (s.tip) {
    // Raked / curved tip: the last ~9 % of the span sweeps back harder.
    const xr = b - (s.S * 0.045);
    pts.push([xr, leY(s, xr)]);
    pts.push([b, leY(s, xr) + (b - xr) * Math.tan((s.sweep + (s.tip === 'raked' ? 22 : 16)) * RAD)]);
    const tipTE = pts[2][1] + s.tipC * 0.35;
    pts.push([b, tipTE]);
    // The trailing edge carries on from the regular tip chord to the rake.
    pts.push([xr, leY(s, xr) + s.tipC * 1.1]);
  } else {
    pts.push([b, leY(s, b)]);
    pts.push([b, leY(s, b) + s.tipC]);
  }
  pts.push([xk, leY(s, xk) + s.kinkC]);
  pts.push([s.fw / 2, leY(s, 0) + s.rootC]);
  pts.push([r, leY(s, 0) + s.rootC]);
  return pts;
}

/** Right tailplane outline (same frame). */
export function tailplaneOutline(s: SilSpec): Pt[] {
  const r = s.fw * 0.2;
  const y0 = s.htX * s.L;
  const b = s.htS / 2;
  const t = Math.tan(s.htSweep * RAD);
  const tipLE = y0 + (b - r) * t;
  const tipC = s.htC * 0.38;
  return [[r, y0], [b, tipLE], [b, tipLE + tipC], [r, Math.min(s.L - 0.4, y0 + s.htC * 1.05)]];
}

/** Engine nacelles (centre x, front y, length, width; metres) on the right wing. */
export function nacelles(s: SilSpec): { x: number; y: number; l: number; w: number }[] {
  const b = s.S / 2;
  return s.eng.map((eta, i) => {
    const x = eta * b;
    // Outboard nacelles of a quad are a little smaller (747, A340 the same engine, but the wing hides more of it).
    const k = s.eng.length > 1 && i > 0 ? 0.96 : 1;
    return { x, y: leY(s, x) - s.nl * s.nOver * k, l: s.nl * k, w: s.nd * k };
  });
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** One wing (or tailplane) and its mirror as two closed shapes (they overlap the fuselage). */
function pair(pts: Pt[], k: number, cy: number): string {
  // Every shape winds the same way as the fuselage (clockwise on screen), so where they overlap the nonzero fill
  // stays filled and the outline (stroke under the fill) never shows through.
  const cw = (q: Pt[]) => (area(q) >= 0 ? q : [...q].reverse());
  const one = (sx: number) => `M${cw(pts.map(([x, y]) => [sx * x, y] as Pt)).map(([x, y]) => `${fmt(x * k)} ${fmt((y - cy) * k)}`).join('L')}Z`;
  return one(1) + one(-1);
}

/** Shoelace area (positive: clockwise with y down). */
function area(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const [x0, y0] = q[i];
    const [x1, y1] = q[(i + 1) % q.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export interface Silhouette {
  /** Fuselage, wings and tailplane (screen px, nose up, centred on the middle of the length). */
  body: string;
  /** The engine nacelles, drawn under the wing: only the part ahead of the leading edge shows. */
  engines: string;
  /** The upper deck (747 hump, A380 full length): a lighter band on the crown. */
  deck: string;
  /** Contrails: one thin wedge per engine behind the tail (faded by the fill's gradient), one aircraft length long. */
  trails: string;
  /** Half the length and half the span (screen px). */
  hl: number;
  hs: number;
  engineCount: number;
}

/** Engines are drawn this much wider than life so a narrowbody's still show at 24 px. */
const ENGINE_BOOST = 1.3;
/** Fuselage width boost at map size. */
const FUSE_BOOST = 1.25;

/** The silhouette of a spec at k screen px per metre. */
export function buildSilhouette(s: SilSpec, k: number, fuseBoost = 1): Silhouette {
  const cy = s.L / 2;
  const h = (s.fw * fuseBoost) / 2;
  const y1 = s.L - s.tail;
  const end = s.fw * 0.12;
  // Fuselage: an ogive nose, a parallel tube, a tail cone up to the APU exhaust.
  const n = (x: number, y: number) => `${fmt(x * k)} ${fmt((y - cy) * k)}`;
  const fus = `M${n(0, 0)}C${n(h * 0.62, 0)} ${n(h, s.nose * 0.38)} ${n(h, s.nose)}L${n(h, y1)}C${n(h, y1 + s.tail * 0.55)} ${n(end * 2, s.L - s.tail * 0.12)} ${n(end, s.L)}`
    + `L${n(-end, s.L)}C${n(-end * 2, s.L - s.tail * 0.12)} ${n(-h, y1 + s.tail * 0.55)} ${n(-h, y1)}L${n(-h, s.nose)}C${n(-h, s.nose * 0.38)} ${n(-h * 0.62, 0)} ${n(0, 0)}Z`;
  const body = fus + pair(wingOutline(s), k, cy) + pair(tailplaneOutline(s), k, cy);
  let engines = '';
  let trails = '';
  for (const nc of nacelles(s)) {
    const w = Math.max(nc.w * ENGINE_BOOST, 1.7 / k);
    const l = nc.l * 1.05;
    for (const sx of [1, -1]) {
      const x0 = sx * nc.x - w / 2;
      const x1 = sx * nc.x + w / 2;
      const r = w * 0.45;
      const yb = nc.y + l;
      // Rounded intake, a little taper to the exhaust.
      engines += `M${n(x0, nc.y + r)}Q${n(x0, nc.y)} ${n(x0 + r, nc.y)}L${n(x1 - r, nc.y)}Q${n(x1, nc.y)} ${n(x1, nc.y + r)}L${n(x1 - w * 0.12, yb)}L${n(x0 + w * 0.12, yb)}Z`;
      // Contrail: forms a short way behind the engine, spreads a little as it fades (one aircraft length).
      const t0 = s.L + s.L * 0.1;
      const t1 = t0 + s.L * 1.05;
      const xe = sx * nc.x * 0.9;
      const w0 = Math.max(0.4 / k, nc.w * 0.18);
      const w1 = w0 * 2.2;
      const drift = sx * nc.x * 0.08;
      trails += `M${n(xe - w0, t0)}L${n(xe + w0, t0)}L${n(xe + drift + w1, t1)}L${n(xe + drift - w1, t1)}Z`;
    }
  }
  let deck = '';
  if (s.deck) {
    const dl = s.deck * s.L;
    const w = h * 0.62;
    const y0 = s.nose * 0.45;
    if (s.deck > 0.8) {
      // A380: a lighter band along the whole crown.
      deck = `M${n(0, y0)}C${n(w, y0)} ${n(w, y0 + 2)} ${n(w, y0 + 4)}L${n(w, dl - 4)}C${n(w, dl)} ${n(-w, dl)} ${n(-w, dl - 4)}L${n(-w, y0 + 4)}C${n(-w, y0 + 2)} ${n(-w, y0)} ${n(0, y0)}Z`;
    } else {
      // 747: the hump, widest over the cockpit, tapering into the crown behind.
      const v = h * 0.86;
      deck = `M${n(0, y0)}C${n(v * 1.1, y0)} ${n(v, s.nose * 0.8)} ${n(v, dl * 0.55)}C${n(v, dl * 0.85)} ${n(v * 0.3, dl)} ${n(0, dl)}C${n(-v * 0.3, dl)} ${n(-v, dl * 0.85)} ${n(-v, dl * 0.55)}C${n(-v, s.nose * 0.8)} ${n(-v * 1.1, y0)} ${n(0, y0)}Z`;
    }
  }
  return { body, engines, deck, trails, hl: (s.L / 2) * k, hs: (s.S / 2) * k, engineCount: s.eng.length * 2 };
}

const cache = new Map<string, Silhouette>();

/** The map silhouette of a type at its map size (cached). `px` overrides the size (largest dimension, screen px). */
export function silhouette(typeId: string, px?: number): Silhouette {
  const key = `${typeId}|${px ?? ''}`;
  let s = cache.get(key);
  if (!s) {
    const spec = silSpec(typeId);
    const k = px ? px / Math.max(spec.L, spec.S) : silScale(spec);
    // Map size: the fuselage a little fuller than life so a 24 px icon still has a body (FR24 does the same).
    s = buildSilhouette(spec, k, Math.max(spec.L, spec.S) * k < 60 ? FUSE_BOOST : 1);
    cache.set(key, s);
  }
  return s;
}
