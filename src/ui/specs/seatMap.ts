// v0.18.1 the seat map (top-down layout of passenger accommodation, a "LOPA") of a cabin on a type: the deck geometry
// of data/lopa.ts filled with the cabin's seats class by class, front to back (business, premium economy, then
// economy), row by row at each class's pitch. Economy takes the longest pitch that still fits (34 in at most, 36 VIP;
// 28 in at least, then the dense layout down to 27 in). Every seat of the cabin is drawn: a short last row of a class
// loses its window seats (economy) or a middle seat (business, premium). Pure, cached; the SVG is a string.

import { lopaOf, type Anchor, type DeckGeo, type MonKind, type Side } from '../../data/lopa';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { ACMI_TYPES, type CabinLayout } from '../../data/acmiTypes';
import { upperDeckSeats } from '../../engine/core/perf';

export type SeatCls = 'J' | 'W' | 'Y' | 'R';
export interface SeatRect { x: number; y: number; w: number; h: number; cls: SeatCls; row: number; letter: string; exit: boolean }
export interface RowInfo { n: number; y: number; cls: SeatCls; exit: boolean; seats: number }
export interface DoorMark { y: number; label: string; kind: string; ow: boolean }
export interface MonRect { x: number; y: number; w: number; h: number; kind: MonKind }
export interface RestMark { y: number; h: number; where: 'overhead' | 'lower' | 'room'; who: 'fc' | 'cc'; x: number; w: number }

export interface DeckMap {
  id: 'main' | 'upper';
  width: number;
  /** Cabin length (inches, from the first item behind the flight deck); nose and tail drawn beyond it. */
  len: number;
  nose: number;
  tail: number;
  seats: SeatRect[];
  rows: RowInfo[];
  doors: DoorMark[];
  mons: MonRect[];
  rest: RestMark[];
  dividers: number[];
  wing?: { le: number; te: number };
  counts: Record<SeatCls, number>;
  /** Seats abreast per class on this deck ('2-4-2'). */
  abreast: Partial<Record<SeatCls, string>>;
}

export interface ClassPlan { cls: SeatCls; n: number; pitch: number }

export interface SeatMap {
  ok: true;
  typeId: string;
  decks: DeckMap[];
  counts: { J: number; W: number; Y: number };
  /** Pitch per class (inches). */
  pitch: Partial<Record<SeatCls, number>>;
  /** Economy in its dense layout (e.g. 3-3-3 on an A330). */
  dense: boolean;
  /** Below 28 in: drawn, but tighter than any airline flies. */
  tight: boolean;
}
export type SeatMapResult = SeatMap | { ok: false; typeId: string; reason: string };

export interface CabinIn { j: number; w: number; y: number; layout: CabinLayout }
export interface MapOpts { variant?: string; /** Crew rest recliner seats fitted (drawn as their own block). */ restSeats?: number; /** Bunks fitted: draw the compartments. */ bunks?: boolean }

const J_PITCH = (typeId: string, layout: CabinLayout, wide: boolean, pat: number[]): number => {
  if (!wide) return layout === 'vip' ? 42 : 36;
  // Lie-flat: 1-2-1 staggered or 2-2-2 angled at 44-45 in (Euro Atlantic 767, 777, A330); the 747's upper deck 2-2
  // recliners and the A380's full-flat suites longer.
  if (typeId === 'a388') return 52;
  // 747-100/-200 short upper deck: 2-2 recliners; -300/-400/-8 stretched upper deck: 2-2 angled sleepers.
  if ((typeId === 'b741' || typeId === 'b742') && pat.length === 2) return 38;
  if (typeId === 'b743' && pat.length === 2) return 42;
  if (typeId.startsWith('b74') && pat.length === 2) return 48;
  return layout === 'vip' ? 52 : 45;
};
const W_PITCH = 37;
const R_PITCH = 36;
const Y_MAX = (layout: CabinLayout) => (layout === 'vip' ? 36 : layout === 'all-economy' ? 32 : 34);
const DIVIDER = 6;
const WALL = 6;

const sum = (a: readonly number[]) => a.reduce((s, x) => s + x, 0);

/** A pattern reduced to at most `max` seats abreast: the fullest block loses a seat first (the outer ones on a tie). */
export function capPattern(p: readonly number[], max?: number): number[] {
  const out = [...p];
  if (!max) return out;
  const order = out.length === 3 ? [0, 2, 1] : out.map((_, i) => i);
  while (sum(out) > max) {
    let k = order[0];
    for (const i of order) if (out[i] > out[k]) k = i;
    if (out[k] <= 1) break;
    out[k]--;
  }
  return out;
}

/** The seats of a short row: economy loses window seats (outer blocks), business and premium a middle seat. */
function shortRow(p: number[], n: number, cls: SeatCls): number[] {
  const out = [...p];
  let guard = 0;
  let i = 0;
  const order = cls === 'Y' || cls === 'R' ? (out.length === 3 ? [0, 2, 1] : [0, 1]) : out.length === 3 ? [1, 0, 2] : [0, 1];
  while (sum(out) > n && guard++ < 40) {
    const k = order[i++ % order.length];
    if (out[k] > 0) out[k]--;
  }
  return out;
}

const LETTERS: Record<string, string[]> = {
  '2-2': ['A', 'C', 'D', 'F'], '3-3': ['A', 'B', 'C', 'D', 'E', 'F'], '1-2-1': ['A', 'E', 'F', 'K'], '2-2-2': ['A', 'C', 'D', 'G', 'H', 'K'],
  '2-3-2': ['A', 'C', 'D', 'E', 'G', 'H', 'K'], '2-4-2': ['A', 'C', 'D', 'E', 'F', 'G', 'H', 'K'], '3-3-3': ['A', 'B', 'C', 'D', 'E', 'G', 'H', 'J', 'K'],
  '3-4-3': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'], '1-1-1': ['A', 'E', 'K'], '2-1-2': ['A', 'C', 'E', 'H', 'K'],
};
const letterOf = (pat: number[], i: number) => LETTERS[pat.join('-')]?.[i] ?? String.fromCharCode(65 + i);

interface Zone { y0: number; y1: number; max?: number; exitFirst: boolean }

/** Positions along the deck: each seg's start (and end of the cabin). */
function layoutSegs(d: DeckGeo) {
  let y = 0;
  const starts: number[] = [];
  for (const s of d.segs) {
    starts.push(y);
    y += s.len;
  }
  return { starts, len: y };
}

function anchorY(d: DeckGeo, starts: number[], a: Anchor): number {
  const [k, n, off] = a;
  let c = 0;
  for (let i = 0; i < d.segs.length; i++) {
    const s = d.segs[i];
    if ((k === 'd' && s.k === 'door') || (k === 'o' && s.k === 'ow')) {
      if (++c === n) return starts[i] + off;
    }
  }
  return off;
}

function zonesOf(d: DeckGeo, starts: number[]): Zone[] {
  const out: Zone[] = [];
  let exitNext = false;
  d.segs.forEach((s, i) => {
    if (s.k === 'seats') {
      out.push({ y0: starts[i], y1: starts[i] + s.len, max: s.max, exitFirst: exitNext });
      exitNext = false;
    } else if (s.k === 'ow') exitNext = true;
    else exitNext = false;
  });
  return out;
}

interface Placed { y: number; cls: SeatCls; n: number; pat: number[]; pitch: number; exit: boolean; zone: number }

/**
 * Rows of every class at these pitches into the zones, front to back; null when they do not fit. Business, premium
 * and crew rest seats run on row by row; economy (the last class) is spread over the zones left, as evenly as the
 * pitch allows, each zone's spare length shared out ahead of and behind its rows (bulkhead and door legroom). An exit
 * row stays at its exit.
 */
function fill(zones: Zone[], plan: { cls: SeatCls; n: number; pat: number[]; pitch: number }[]): { rows: Placed[]; dividers: number[] } | null {
  const rows: Placed[] = [];
  const dividers: number[] = [];
  let z = 0;
  let cur = zones[0]?.y0 ?? 0;
  let first = true;
  let prev: SeatCls | null = null;
  const todo = plan.filter((c) => c.n > 0);
  for (const [ci, c] of todo.entries()) {
    let left = c.n;
    if (prev && z < zones.length && cur > zones[z].y0 + 0.01) {
      dividers.push(cur + DIVIDER / 2);
      cur += DIVIDER;
    }
    prev = c.cls;
    if (ci === todo.length - 1 && c.cls === 'Y') {
      // Economy: rows per zone, then thinned evenly until one fewer row would not seat everyone.
      const zs = zones.slice(z).map((zone, k) => {
        const y0 = k === 0 ? Math.max(cur, zone.y0) : zone.y0;
        const shared = k === 0 && y0 > zone.y0 + 0.01;
        const ab = sum(capPattern(c.pat, zone.max));
        const len = zone.y1 - y0;
        return { zone, zi: z + k, y0, len, ab, shared, cap: Math.max(0, Math.floor((len + 0.01) / c.pitch)) };
      });
      const r = zs.map((x) => x.cap);
      const seats = () => zs.reduce((s2, x, k) => s2 + r[k] * x.ab, 0);
      if (seats() < left) return null;
      for (;;) {
        let best = -1;
        let dens = -1;
        const have = seats();
        zs.forEach((x, k) => {
          if (r[k] <= 0 || have - x.ab < left) return;
          const d = (r[k] * c.pitch) / Math.max(1, x.len);
          if (d > dens + 1e-9) {
            dens = d;
            best = k;
          }
        });
        if (best < 0) break;
        r[best]--;
      }
      zs.forEach((x, k) => {
        if (!r[k] || left <= 0) return;
        const slack = x.len - r[k] * c.pitch;
        let y = x.y0 + (x.shared || x.zone.exitFirst ? 0 : Math.max(0, slack / 2));
        for (let i = 0; i < r[k] && left > 0; i++) {
          const pat = capPattern(c.pat, x.zone.max);
          const n = Math.min(left, sum(pat));
          rows.push({ y, cls: c.cls, n, pat, pitch: c.pitch, exit: i === 0 && x.zone.exitFirst, zone: x.zi });
          left -= n;
          y += c.pitch;
        }
      });
      return left > 0 ? null : { rows, dividers };
    }
    while (left > 0) {
      while (z < zones.length && cur + c.pitch > zones[z].y1 + 0.01) {
        z++;
        if (z < zones.length) {
          cur = zones[z].y0;
          first = true;
        }
      }
      if (z >= zones.length) return null;
      const zone = zones[z];
      const pat = capPattern(c.pat, zone.max);
      const cap = sum(pat);
      const n = Math.min(left, cap);
      rows.push({ y: cur, cls: c.cls, n, pat, pitch: c.pitch, exit: first && zone.exitFirst, zone: z });
      first = false;
      left -= n;
      cur += c.pitch;
    }
  }
  return { rows, dividers };
}

/** Seat widths (inches) to draw per class; aisles at least this wide. */
const SEAT_W: Record<SeatCls, number> = { J: 27, W: 20, Y: 18, R: 19 };
const AISLE: Record<SeatCls, number> = { J: 20, W: 19, Y: 18, R: 18 };

function rowSeats(width: number, row: Placed, num: number): SeatRect[] {
  const base = row.pat;
  const pat = row.n < sum(base) ? shortRow(base, row.n, row.cls) : base;
  const aisles = base.length - 1;
  const avail = width - 2 * WALL - aisles * AISLE[row.cls];
  const sw = Math.min(SEAT_W[row.cls] * (base.length === 2 && row.cls === 'J' && width > 200 ? 1.15 : 1), avail / sum(base));
  const depth = row.cls === 'J' ? Math.min(row.pitch * 0.82, 60) : Math.min(row.pitch * 0.72, 26);
  const out: SeatRect[] = [];
  let letterI = 0;
  base.forEach((b, bi) => {
    const full = b * sw;
    const x0 = bi === 0 ? WALL : bi === base.length - 1 ? width - WALL - full : (width - full) / 2;
    const have = pat[bi];
    // A short block keeps its aisle seats (economy: the window seat goes; business: the outer seat).
    const skip = b - have;
    for (let i = 0; i < b; i++) {
      const letter = letterOf(base, letterI++);
      const keep = bi === 0 ? i >= skip : bi === base.length - 1 ? i < have : i >= Math.floor(skip / 2) && i < Math.floor(skip / 2) + have;
      if (!keep) continue;
      out.push({ x: x0 + i * sw + 0.8, y: row.y + 2, w: sw - 1.6, h: depth, cls: row.cls, row: num, letter, exit: row.exit });
    }
  });
  return out;
}

const MON_X: Record<Side, [number, number]> = { L: [0, 0.3], R: [0.7, 1], C: [0.33, 0.67], LC: [0, 0.62], CR: [0.38, 1], LCR: [0, 1] };

interface DeckPlan { deck: DeckGeo; plan: { cls: SeatCls; n: number; pat: number[]; pitch: number }[] }

/** Splits the cabin over the decks: on a two-deck type the upper deck takes its share of seats, business first. */
function splitDecks(typeId: string, decks: DeckGeo[], cab: CabinIn): Record<'main' | 'upper', { J: number; W: number; Y: number }> {
  const total = cab.j + cab.w + cab.y;
  if (decks.length < 2) return { main: { J: cab.j, W: cab.w, Y: cab.y }, upper: { J: 0, W: 0, Y: 0 } };
  let u = upperDeckSeats(typeId, total);
  const up = { J: 0, W: 0, Y: 0 };
  for (const k of ['J', 'W', 'Y'] as const) {
    const have = k === 'J' ? cab.j : k === 'W' ? cab.w : cab.y;
    up[k] = Math.min(have, u);
    u -= up[k];
  }
  return { main: { J: cab.j - up.J, W: cab.w - up.W, Y: cab.y - up.Y }, upper: up };
}

const cache = new Map<string, SeatMapResult>();

export function seatMap(typeId: string, cab: CabinIn, opts: MapOpts = {}): SeatMapResult {
  const key = `${typeId}|${opts.variant ?? ''}|${cab.j}/${cab.w}/${cab.y}|${cab.layout}|${opts.restSeats ?? 0}|${opts.bunks ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = build(typeId, cab, opts);
  if (cache.size > 200) cache.clear();
  cache.set(key, r);
  return r;
}

function build(typeId: string, cab: CabinIn, opts: MapOpts): SeatMapResult {
  const L = lopaOf(typeId, opts.variant);
  if (!L) return { ok: false, typeId, reason: 'No cabin drawing for this type' };
  if (L.noMap || !L.decks.length) return { ok: false, typeId, reason: L.noMap ?? 'No cabin drawing for this type' };
  const wide = ACMI_TYPES[typeId]?.body === 'wide';
  const split = splitDecks(typeId, L.decks, cab);
  const decksIn = L.decks.map((d) => {
    const pats = d.id === 'upper' && L.upper ? L.upper : L;
    const { starts, len } = layoutSegs(d);
    return { d, pats, starts, len, zones: zonesOf(d, starts), n: split[d.id] };
  });
  type DeckRes = { rows: Placed[]; dividers: number[]; plan: DeckPlan['plan']; pitch: number; dense: boolean; tight: boolean };
  const tryDeck = (x: (typeof decksIn)[number], py: number, dense: boolean): Omit<DeckRes, 'pitch' | 'dense' | 'tight'> | null => {
    const jp = x.pats.j;
    const yp = dense && x.d.id === 'main' && L.yDense ? L.yDense : x.pats.y;
    const plan = [
      { cls: 'J' as const, n: x.n.J, pat: jp, pitch: J_PITCH(typeId, cab.layout, wide, jp) },
      { cls: 'W' as const, n: x.n.W, pat: x.pats.w ?? (L.w ?? yp), pitch: W_PITCH },
      ...(x.d.id === 'main' && opts.restSeats ? [{ cls: 'R' as const, n: opts.restSeats, pat: yp, pitch: R_PITCH }] : []),
      { cls: 'Y' as const, n: x.n.Y, pat: yp, pitch: py },
    ];
    const f = fill(x.zones, plan);
    return f ? { ...f, plan } : null;
  };
  // Each deck its own economy pitch: the longest that fits (standard layout, then dense, then tighter than airlines fly).
  const hi = Y_MAX(cab.layout);
  const solve = (x: (typeof decksIn)[number]): DeckRes | null => {
    const denseOk = !!L.yDense && x.d.id === 'main';
    for (const d of denseOk ? [false, true] : [false]) {
      for (let p = hi; p >= (d ? 27 : 28) - 1e-9; p -= 0.5) {
        const r = tryDeck(x, p, d);
        if (r) return { ...r, pitch: p, dense: d, tight: false };
      }
    }
    for (let p = 26.5; p >= 20; p -= 0.5) {
      const r = tryDeck(x, p, denseOk);
      if (r) return { ...r, pitch: p, dense: denseOk, tight: true };
    }
    return null;
  };
  const res: DeckRes[] = [];
  for (const x of decksIn) {
    const r = solve(x);
    if (!r) return { ok: false, typeId, reason: 'This cabin does not fit the drawing' };
    res.push(r);
  }
  const pitchY = (res.find((_, i) => decksIn[i].n.Y > 0) ?? res[0]).pitch;
  const dense = res.some((r) => r.dense);
  const tight = res.some((r, i) => r.tight && decksIn[i].n.Y > 0);
  // Row numbers: main deck from 1, no row 13; the upper deck from the next ten.
  let num = 0;
  const nextNum = () => {
    num++;
    if (num === 13) num++;
    return num;
  };
  const decks: DeckMap[] = decksIn.map((x, di) => {
    const r = res[di];
    const d = x.d;
    if (d.id === 'upper') num = Math.ceil((num + 1) / 10) * 10;
    const seats: SeatRect[] = [];
    const rows: RowInfo[] = [];
    for (const row of r.rows) {
      const n = nextNum();
      const s = rowSeats(d.width, row, n);
      seats.push(...s);
      rows.push({ n, y: row.y, cls: row.cls, exit: row.exit, seats: s.length });
    }
    const counts: Record<SeatCls, number> = { J: 0, W: 0, Y: 0, R: 0 };
    for (const s of seats) counts[s.cls]++;
    const doors: DoorMark[] = [];
    const mons: MonRect[] = [];
    let dn = 0;
    const pre = d.id === 'upper' ? 'U' : typeId === 'a388' ? 'M' : '';
    d.segs.forEach((s, i) => {
      const y0 = x.starts[i];
      if (s.k === 'door') {
        dn++;
        doors.push({ y: y0 + s.len / 2, label: `${pre}${dn}`, kind: s.kind, ow: false });
      } else if (s.k === 'ow') doors.push({ y: y0 + s.len / 2, label: 'Overwing exit', kind: 'III', ow: true });
      else if (s.k === 'mon') {
        for (const [kind, side] of s.items) {
          const [a, b] = MON_X[side];
          const xa = WALL + a * (d.width - 2 * WALL);
          const xb = WALL + b * (d.width - 2 * WALL);
          mons.push({ x: xa + 1, y: y0 + 2, w: xb - xa - 2, h: s.len - 4, kind });
        }
      }
    });
    // Crew rest compartments (when the airframe has bunks): overhead in the crown, under the floor, or a room.
    const rest: RestMark[] = [];
    if (opts.bunks && L.rest) {
      for (const who of ['fc', 'cc'] as const) {
        const sp = L.rest[who];
        if (!sp || sp.deck !== d.id) continue;
        let y = 0;
        if (sp.door > 0) {
          let c = 0;
          d.segs.forEach((s, i) => { if (s.k === 'door' && ++c === sp.door) y = x.starts[i] + (sp.where === 'room' ? s.len : 0); });
          if (sp.where === 'overhead' && sp.door > 1) y -= sp.len * 0.6;
        }
        const room = sp.where === 'room';
        rest.push({ y, h: sp.len, where: sp.where, who, x: room ? WALL : WALL + 10, w: room ? (d.width - 2 * WALL) * 0.3 : d.width - 2 * WALL - 20 });
      }
    }
    const wing = d.wing ? { le: anchorY(d, x.starts, d.wing[0]), te: anchorY(d, x.starts, d.wing[1]) } : undefined;
    const abreast: Partial<Record<SeatCls, string>> = {};
    for (const p of r.plan) if (p.n > 0) abreast[p.cls] = p.pat.join('-');
    return { id: d.id, width: d.width, len: x.len, nose: d.nose, tail: d.tail, seats, rows, doors, mons, rest, dividers: r.dividers, wing, counts, abreast };
  });
  const counts = { J: 0, W: 0, Y: 0 };
  for (const d of decks) {
    counts.J += d.counts.J;
    counts.W += d.counts.W;
    counts.Y += d.counts.Y;
  }
  const pitch: Partial<Record<SeatCls, number>> = {};
  if (cab.j) pitch.J = J_PITCH(typeId, cab.layout, wide, L.j);
  if (cab.w) pitch.W = W_PITCH;
  if (cab.y) pitch.Y = pitchY;
  if (opts.restSeats) pitch.R = R_PITCH;
  return { ok: true, typeId, decks, counts, pitch, dense, tight };
}

// ---------- SVG ----------

const f1 = (v: number) => Math.round(v * 10) / 10;

/** Wing half-span and engine stations in deck inches (from the catalog's span and length, to the drawing's scale). */
function wingShape(typeId: string, d: DeckMap) {
  const cat = AIRCRAFT_BY_ID[ACMI_TYPES[typeId]?.catalog ?? typeId];
  const drawn = d.nose + d.len + d.tail;
  const k = cat ? drawn / (cat.lengthM * 39.37) : 1;
  const half = cat ? (cat.spanM * 39.37 * k) / 2 : d.width * 2.5;
  return { half, quad: ACMI_TYPES[typeId]?.engines === 4 };
}

const MON_LABEL: Record<MonKind, string> = { G: 'G', WC: 'WC', ST: 'Stairs', CR: 'Crew rest', CL: '' };

/** One deck as an SVG group at x offset `ox` (inches); returns its markup and the width it takes. */
let clipN = 0;
function deckSvg(typeId: string, d: DeckMap, ox: number, withWing: boolean): { svg: string; w: number; h: number } {
  const clip = `smc${++clipN}`;
  const hull = 7;
  const W = d.width + 2 * hull;
  const wing = withWing && d.wing ? wingShape(typeId, d) : null;
  const span = wing ? Math.max(W / 2, wing.half) : W / 2;
  // The drawing shows the wing roots only (as airline seat maps do): the width is the cabin plus 70 % each side.
  const vis = wing ? Math.min(span, W / 2 + W * 0.7) : W / 2;
  const cx = ox + vis + 26;
  const x0 = cx - W / 2;
  const top = 10;
  const yC = top + d.nose; // cabin start
  const yE = yC + d.len; // cabin end
  const yT = yE + d.tail;
  const parts: string[] = [];
  // Wings and stabilisers first (behind the fuselage).
  if (wing && d.wing) {
    const le = yC + d.wing.le;
    const te = yC + d.wing.te;
    const chord = te - le;
    const sweep = Math.max(chord * 0.9, wing.half * 0.55);
    const tipC = chord * 0.28;
    for (const s of [-1, 1]) {
      const rx = cx + (s * W) / 2;
      const tx = cx + s * span;
      parts.push(`<path class="sm-wing" d="M${f1(rx)} ${f1(le)} L${f1(tx)} ${f1(le + sweep)} L${f1(tx)} ${f1(le + sweep + tipC)} L${f1(rx)} ${f1(te)} Z"/>`);
      const engs = wing.quad ? [0.38, 0.68] : [0.36];
      for (const e of engs) {
        const ex = cx + s * (W / 2 + (span - W / 2) * e);
        const ey = le + sweep * e * ((span - W / 2) / span) - chord * 0.35;
        parts.push(`<rect class="sm-eng" x="${f1(ex - W * 0.07)}" y="${f1(ey)}" width="${f1(W * 0.14)}" height="${f1(chord * 0.45)}" rx="${f1(W * 0.05)}"/>`);
      }
    }
    const hs = span * 0.36;
    const hy = yE + d.tail * 0.35;
    for (const s of [-1, 1]) parts.push(`<path class="sm-wing" d="M${f1(cx + (s * W) / 4)} ${f1(hy)} L${f1(cx + s * hs)} ${f1(hy + hs * 0.6)} L${f1(cx + s * hs)} ${f1(hy + hs * 0.6 + 20)} L${f1(cx)} ${f1(yT - 20)} Z"/>`);
  }
  // The hull: nose cone, straight cabin, tail cone (an upper deck without a cone ends rounded).
  const n = d.nose;
  const hullPath = d.id === 'upper'
    ? `M${f1(x0)} ${f1(yC - n * 0.3)} Q${f1(x0)} ${f1(top)} ${f1(cx)} ${f1(top)} Q${f1(x0 + W)} ${f1(top)} ${f1(x0 + W)} ${f1(yC - n * 0.3)} L${f1(x0 + W)} ${f1(yE)} Q${f1(x0 + W)} ${f1(yT)} ${f1(cx)} ${f1(yT)} Q${f1(x0)} ${f1(yT)} ${f1(x0)} ${f1(yE)} Z`
    : `M${f1(x0)} ${f1(yC)} C${f1(x0)} ${f1(yC - n * 0.55)} ${f1(cx - W * 0.28)} ${f1(top)} ${f1(cx)} ${f1(top)} C${f1(cx + W * 0.28)} ${f1(top)} ${f1(x0 + W)} ${f1(yC - n * 0.55)} ${f1(x0 + W)} ${f1(yC)} L${f1(x0 + W)} ${f1(yE)} C${f1(x0 + W)} ${f1(yE + d.tail * 0.5)} ${f1(cx + W * 0.08)} ${f1(yT - 10)} ${f1(cx)} ${f1(yT)} C${f1(cx - W * 0.08)} ${f1(yT - 10)} ${f1(x0)} ${f1(yE + d.tail * 0.5)} ${f1(x0)} ${f1(yE)} Z`;
  parts.push(`<path class="sm-hull" d="${hullPath}"/>`);
  parts.push(`<rect class="sm-floor" x="${f1(x0 + hull)}" y="${f1(yC)}" width="${f1(d.width)}" height="${f1(d.len)}"/>`);
  // Flight deck windows on the main deck.
  if (d.id === 'main' || typeId.startsWith('b74')) {
    if (!(d.id === 'main' && typeId.startsWith('b74'))) parts.push(`<path class="sm-cockpit" d="M${f1(cx - W * 0.22)} ${f1(top + n * 0.42)} L${f1(cx)} ${f1(top + n * 0.3)} L${f1(cx + W * 0.22)} ${f1(top + n * 0.42)} L${f1(cx + W * 0.2)} ${f1(top + n * 0.52)} L${f1(cx)} ${f1(top + n * 0.42)} L${f1(cx - W * 0.2)} ${f1(top + n * 0.52)} Z"/>`);
  }
  const fx = x0 + hull;
  // Crew rest compartments under the seats (dashed).
  for (const r of d.rest) {
    parts.push(`<rect class="sm-rest ${r.where}" x="${f1(fx + r.x)}" y="${f1(yC + r.y)}" width="${f1(r.w)}" height="${f1(r.h)}" rx="6"><title>${r.who === 'fc' ? 'Pilots' : 'Cabin crew'} bunks${r.where === 'overhead' ? ' (overhead)' : r.where === 'lower' ? ' (lower deck)' : ''}</title></rect>`);
  }
  for (const m of d.mons) {
    parts.push(`<rect class="sm-mon ${m.kind}" x="${f1(fx + m.x)}" y="${f1(yC + m.y)}" width="${f1(m.w)}" height="${f1(m.h)}" rx="3"/>`);
    const lbl = MON_LABEL[m.kind];
    if (lbl && m.w > 22 && m.h > 14) parts.push(`<text class="sm-mon-t" x="${f1(fx + m.x + m.w / 2)}" y="${f1(yC + m.y + m.h / 2 + 3.5)}">${m.w > 60 && m.kind === 'G' ? 'GALLEY' : lbl}</text>`);
  }
  for (const y of d.dividers) parts.push(`<line class="sm-div" x1="${f1(fx + 4)}" x2="${f1(fx + d.width - 4)}" y1="${f1(yC + y)}" y2="${f1(yC + y)}"/>`);
  for (const s of d.seats) {
    parts.push(`<rect class="sm-seat ${s.cls}${s.exit ? ' x' : ''}" x="${f1(fx + s.x)}" y="${f1(yC + s.y)}" width="${f1(s.w)}" height="${f1(s.h)}" rx="${s.cls === 'J' ? 4 : 3}"><title>${s.row}${s.letter}</title></rect>`);
    // The backrest (seats face the nose, up).
    const bh = Math.min(7, s.h * 0.28);
    parts.push(`<rect class="sm-back" x="${f1(fx + s.x + 1)}" y="${f1(yC + s.y + s.h - bh)}" width="${f1(s.w - 2)}" height="${f1(bh)}" rx="2"/>`);
  }
  for (const r of d.rows) parts.push(`<text class="sm-row${r.exit ? ' x' : ''}" x="${f1(x0 - 4)}" y="${f1(yC + r.y + 13)}">${r.n}</text>`);
  for (const dm of d.doors) {
    const y = yC + dm.y;
    const cls = dm.ow ? 'sm-ow' : 'sm-door';
    const a = dm.ow ? 7 : 10;
    parts.push(`<path class="${cls}" d="M${f1(x0 - 1)} ${f1(y - a)} L${f1(x0 - 1 - a * 1.2)} ${f1(y)} L${f1(x0 - 1)} ${f1(y + a)} Z"><title>${dm.ow ? 'Overwing exit' : `Door ${dm.label}L`}</title></path>`);
    parts.push(`<path class="${cls}" d="M${f1(x0 + W + 1)} ${f1(y - a)} L${f1(x0 + W + 1 + a * 1.2)} ${f1(y)} L${f1(x0 + W + 1)} ${f1(y + a)} Z"><title>${dm.ow ? 'Overwing exit' : `Door ${dm.label}R`}</title></path>`);
    if (!dm.ow) parts.push(`<text class="sm-door-t" x="${f1(x0 + W + 16)}" y="${f1(y + 4)}">${dm.label}</text>`);
  }
  return { svg: `<g clip-path="url(#${clip})">${parts.join('')}</g><clipPath id="${clip}"><rect x="${f1(cx - vis - 26)}" y="0" width="${f1(2 * vis + 52)}" height="${f1(yT + 12)}"/></clipPath>`, w: vis * 2 + 52, h: yT + 10 };
}

const svgCache = new Map<SeatMap, string>();

/** The whole seat map as an SVG string (decks side by side, the main deck first); styled by CSS classes. */
export function seatMapSvg(m: SeatMap): string {
  const hit = svgCache.get(m);
  if (hit) return hit;
  let ox = 30;
  let h = 0;
  const parts: string[] = [];
  for (const [i, d] of m.decks.entries()) {
    const g = deckSvg(m.typeId, d, ox, i === 0);
    if (m.decks.length > 1) parts.push(`<text class="sm-deck" x="${f1(ox + g.w / 2)}" y="-6">${d.id === 'upper' ? 'Upper deck' : 'Main deck'}</text>`);
    parts.push(`<g>${g.svg}</g>`);
    ox += g.w + 50;
    h = Math.max(h, g.h);
  }
  const top = m.decks.length > 1 ? -22 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${top} ${f1(ox - 20)} ${f1(h - top)}" class="sm-svg" preserveAspectRatio="xMidYMin meet">${parts.join('')}</svg>`;
  if (svgCache.size > 60) svgCache.clear();
  svgCache.set(m, svg);
  return svg;
}
