// v0.7.3 crew rest glyphs on the side profile (UPDATE-0.7.3.md §2.12): a static mark where the compartment
// really is — bunks (two short stacked bars) overhead, behind the cockpit, on the 747 upper deck or in the
// belly; curtained business seats as a tinted block on the window line; recliners as a small seat. Pure,
// cached per type and facility kinds; never animated.

import { ACMI_TYPES } from '../../../data/acmiTypes';
import type { AcRest, RestKind } from '../../../engine/core/types';
import { artGeometry } from './AircraftArt';
import { pathPoly } from './geometry';

/** What the art draws: the pilots' (fc) and cabin crew's (cc) rest kind, or null for none. */
export interface ArtRest { fc: RestKind | null; cc: RestKind | null }

const ART_REST = new Map<string, ArtRest>();
/** The art's rest prop for an aircraft's facilities (one shared object per kind pair, so memoised art stays put). */
export function artRest(r: AcRest | null | undefined): ArtRest | undefined {
  if (!r || (!r.fc && !r.cc)) return undefined;
  const fc = r.fc?.kind ?? null, cc = r.cc?.kind ?? null;
  const key = `${fc}|${cc}`;
  let a = ART_REST.get(key);
  if (!a) ART_REST.set(key, (a = { fc, cc }));
  return a;
}

export type RestGlyphKind = 'bunk' | 'seats' | 'recliner';
/** One glyph box in viewBox units (nose right, y down; x/y = top-left). */
export interface RestGlyph { kind: RestGlyphKind; x: number; y: number; w: number; h: number }

/** Where in the fuselage: 'top' = crown (overhead / upper deck), 'deck' = main deck window line, 'belly' = below the floor. */
type Zone = 'top' | 'deck' | 'belly';
type Fam = '777' | '787' | 'A350' | '747' | 'A380' | '767' | 'A330' | 'other';

const FAM: Record<string, Fam> = { B777: '777', B787: '787', A350: 'A350', B747: '747', A380: 'A380', 'A330/340': 'A330' };
const famOf = (typeId: string): Fam => {
  const t = ACMI_TYPES[typeId];
  if (!t) return 'other';
  if (t.id === 'b763') return '767';
  return FAM[t.family] ?? 'other';
};

/** Station (share of the fuselage from the nose) and zone of a bunk compartment, per family. */
function bunkSpot(kind: RestKind, fam: Fam): [number, Zone] {
  if (kind === 'fcrc') {
    if (fam === '777' || fam === '787' || fam === 'A350') return [0.12, 'top'];
    if (fam === '747') return [0.14, 'top'];
    // 767 / A330 / A340 behind the cockpit, drawn above the window line (clear of door 1); A380 on its main deck
    return [0.10, fam === 'A380' ? 'deck' : 'top'];
  }
  if (kind === 'ldmcr') return [0.62, 'belly'];
  // ccrc
  if (fam === 'A380') return [0.70, 'belly'];
  return [fam === '787' || fam === 'A350' ? 0.80 : fam === '747' ? 0.82 : 0.78, 'top'];
}

const cache = new Map<string, RestGlyph[]>();

/** Aftmost x (world, from the nose) of the drawn wing at or above height y; null without a wing there. */
function wingAft(typeId: string, y: number): number | null {
  const d = artGeometry(typeId).wing.fill;
  if (!d) return null;
  let m: number | null = null;
  for (const sub of d.split(/(?=M)/)) for (const [px, py] of pathPoly(sub, 6)) if (py >= y && (m === null || px > m)) m = px;
  return m;
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Glyph boxes for a type's rest facilities (one per distinct kind; the pilots' and cabin crew's sharing one kind —
 * e.g. business seats for both — draw once). Empty for no rest. Pure (cached).
 */
export function restGlyphs(typeId: string, rest: ArtRest): RestGlyph[] {
  const kinds = [...new Set([rest.fc, rest.cc].filter((k): k is RestKind => !!k))];
  if (!kinds.length) return [];
  const key = `${typeId}|${kinds.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const g = artGeometry(typeId);
  const fam = famOf(typeId);
  const L = g.L, H = g.H, x0 = g.tip[0];
  const rows = [...g.p.windows].sort((a, b) => a.y - b.y);
  // main deck window line (the lowest row: the A380's main deck, the 747's below its upper deck)
  const main = rows[0];
  const upper = rows.length > 1 ? rows[rows.length - 1] : undefined;
  const winY = main ? main.y : H * 0.1;
  const winH = main ? main.h : H * 0.06;
  const at = (s: number) => x0 + s * L;
  // world box (x from the nose, y up) → viewBox top-left box
  const box = (kind: RestGlyphKind, cx: number, cy: number, w: number, h: number): RestGlyph =>
    ({ kind, x: r3(-(cx + w / 2)), y: r3(-(cy + h / 2)), w: r3(w), h: r3(h) });
  const out: RestGlyph[] = [];
  for (const k of kinds) {
    if (k === 'jSeats') {
      // curtained business seats: a tinted block 0.14–0.24 on the window line
      const a = at(0.14), b = at(0.24);
      out.push(box('seats', (a + b) / 2, winY, b - a, winH * 2.2));
      continue;
    }
    if (k === 'recliners') {
      const s = H * 0.3;
      out.push(box('recliner', at(0.86), winY, s * 1.15, s));
      continue;
    }
    const [st, zone] = bunkSpot(k, fam);
    let x = at(st);
    const w = H * 0.5, h = H * 0.24;
    let cy: number;
    if (zone === 'top') {
      // between the window tops (the upper deck's on a 747) and the crown
      const floor = (fam === '747' && upper && x >= upper.x0 - H ? upper.y + upper.h / 2 : winY + winH / 2);
      cy = (g.upperY(x) + floor) / 2;
    } else if (zone === 'deck') {
      cy = winY;
    } else {
      // below the main deck floor, clear of the belly line; moved aft of the drawn wing (it hangs over the belly)
      cy = (g.lowerY(x) + (winY - H * 0.2)) / 2;
      const aft = wingAft(typeId, cy - h / 2);
      if (aft !== null) x = Math.min(at(0.72), Math.max(x, aft + w / 2 + H * 0.02));
      cy = (g.lowerY(x) + (winY - H * 0.2)) / 2;
    }
    out.push(box('bunk', x, cy, w, h));
  }
  cache.set(key, out);
  return out;
}

/** Desktop tooltip for the marks: who rests where (e.g. "Crew rest: pilots' bunks · business seats for cabin crew"). */
const WHERE: Record<RestKind, string> = {
  fcrc: 'bunks behind the cockpit', ccrc: 'overhead bunks', ldmcr: 'lower-deck bunk module',
  jSeats: 'curtained business seats', recliners: 'crew rest recliners',
};
export function restTitle(rest: ArtRest): string {
  if (rest.fc && rest.fc === rest.cc) return `Crew rest: ${WHERE[rest.fc]} for pilots and cabin crew`;
  const parts: string[] = [];
  if (rest.fc) parts.push(`pilots' ${WHERE[rest.fc]}`);
  if (rest.cc) parts.push(`${WHERE[rest.cc]} for cabin crew`);
  return `Crew rest: ${parts.join(' · ')}`;
}

/** A box grown about its centre to at least w × h (viewBox units). */
const grow = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) => {
  const W = Math.max(b.w, w), H = Math.max(b.h, h);
  return { x: r3(b.x - (W - b.w) / 2), y: r3(b.y - (H - b.h) / 2), w: r3(W), h: r3(H) };
};

/**
 * Glyph shapes inside a box (viewBox units): bunk = two stacked bars. `unit` = viewBox units per CSS px:
 * the mark never drops under 7 px wide with bars 1.8 px high and a 0.9 px gap, so it reads on a 120 px Market thumbnail.
 */
export function bunkBars(b: RestGlyph, unit = 0): { x: number; y: number; w: number; h: number }[] {
  const bh = Math.max(b.h * 0.38, 1.8 * unit), gap = Math.max(b.h - 2 * bh, 0.9 * unit);
  const o = grow(b, 7 * unit, 2 * bh + gap);
  return [
    { x: o.x, y: o.y, w: o.w, h: r3(bh) },
    { x: o.x, y: r3(o.y + o.h - bh), w: o.w, h: r3(bh) },
  ];
}

/** Business seat block, at least 3 px high, with seat dividers when there is room (≥ 3 px a seat). */
export function seatBlock(b: RestGlyph, unit = 0): { box: { x: number; y: number; w: number; h: number }; ticks: number[] } {
  const box = grow(b, 0, 3 * unit);
  const n = unit > 0 && box.w / unit < 12 ? 0 : 3;
  return { box, ticks: Array.from({ length: n }, (_, i) => r3(box.x + ((i + 1) * box.w) / (n + 1))) };
}

/** Recliner outline path (nose right: the seat faces the nose, back leaning aft); at least 7 × 6 px. */
export function reclinerPath(b: RestGlyph, unit = 0): string {
  const { x, y, w, h } = grow(b, 7 * unit, 6 * unit);
  const p = (u: number, v: number) => `${r3(x + u * w)} ${r3(y + v * h)}`;
  // back (leaning aft = left), cushion, leg rest raised towards the nose, one pedestal
  return `M${p(0.06, 0.04)}L${p(0.3, 0.7)}L${p(0.7, 0.7)}L${p(0.96, 0.46)}M${p(0.5, 0.7)}L${p(0.5, 0.96)}M${p(0.34, 0.96)}L${p(0.66, 0.96)}`;
}
