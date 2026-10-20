// Shared spec building blocks: nose / tail-cone outlines (in fuselage-height
// units H, see types.ts) and door / window row helpers.

import type { DoorSpec, NoseSpec, TailConeSpec, WindowRow } from '../types';

// ---------- noses (u aft of the tip, v above the centreline, both in H) ----------

export const NOSE = {
  /**
   * A320 / A330 family: blunt radome with the tip just below the centreline, the windscreen
   * starting right behind the radome joint and the roof doming quickly up to the crown.
   */
  airbus: {
    upper: [0, -0.12, 0.02, -0.04, 0.12, 0.09, 0.3, 0.15, 0.34, 0.25, 0.44, 0.35, 0.6, 0.41, 0.78, 0.46, 0.95, 0.49, 1.25, 0.5, 1.4, 0.5, 1.55, 0.5, 1.7, 0.5],
    lower: [0, -0.12, 0.01, -0.21, 0.12, -0.33, 0.34, -0.4, 0.56, -0.46, 0.8, -0.5, 1.1, -0.5],
    radome: 0.3,
  },
  /** A350: lower, longer drooped nose, roof sloping smoothly over the windscreen mask. */
  a350: {
    upper: [0, -0.18, 0, -0.08, 0.1, 0.03, 0.3, 0.1, 0.34, 0.2, 0.42, 0.3, 0.56, 0.36, 0.74, 0.43, 0.92, 0.48, 1.2, 0.5, 1.4, 0.5, 1.6, 0.5, 1.8, 0.5],
    lower: [0, -0.18, 0, -0.28, 0.1, -0.38, 0.3, -0.44, 0.5, -0.49, 0.7, -0.5, 0.95, -0.5],
    radome: 0.28,
  },
  /** A380: low tip, one big convex sweep up to the upper-deck crown (H = full double-deck height). */
  a380: {
    upper: [0, -0.2, 0, -0.1, 0.04, 0.0, 0.16, 0.06, 0.24, 0.1, 0.32, 0.16, 0.42, 0.26, 0.52, 0.36, 0.64, 0.45, 0.85, 0.5, 1.0, 0.5, 1.15, 0.5, 1.3, 0.5],
    lower: [0, -0.2, 0, -0.3, 0.08, -0.4, 0.26, -0.45, 0.42, -0.49, 0.55, -0.5, 0.8, -0.5],
    radome: 0.14,
  },
  /** 737: long tapered nose drooping to a low tip, roof rising steeply over the windscreen. */
  b737: {
    upper: [0, -0.18, 0, -0.08, 0.15, 0.02, 0.42, 0.1, 0.46, 0.22, 0.54, 0.32, 0.7, 0.38, 0.93, 0.45, 1.15, 0.49, 1.5, 0.5, 1.7, 0.5, 1.9, 0.5, 2.1, 0.5],
    lower: [0, -0.18, 0, -0.27, 0.15, -0.35, 0.45, -0.41, 0.75, -0.47, 1.05, -0.5, 1.4, -0.5],
    radome: 0.38,
  },
  /** 757: the longest, most pointed nose of the family, windscreen well aft of the tip. */
  b757: {
    upper: [0, -0.2, 0, -0.1, 0.2, 0.0, 0.52, 0.1, 0.57, 0.22, 0.66, 0.32, 0.84, 0.38, 1.08, 0.45, 1.35, 0.49, 1.7, 0.5, 1.9, 0.5, 2.1, 0.5, 2.3, 0.5],
    lower: [0, -0.2, 0, -0.3, 0.12, -0.38, 0.4, -0.44, 0.65, -0.49, 0.85, -0.5, 1.2, -0.5],
    radome: 0.45,
  },
  /** 767: the 757 flight deck on the wide fuselage, so shorter in H units. */
  b767: {
    upper: [0, -0.18, 0, -0.08, 0.15, 0.02, 0.4, 0.1, 0.44, 0.22, 0.52, 0.32, 0.68, 0.38, 0.88, 0.45, 1.08, 0.49, 1.35, 0.5, 1.5, 0.5, 1.7, 0.5, 1.9, 0.5],
    lower: [0, -0.18, 0, -0.28, 0.1, -0.37, 0.32, -0.44, 0.5, -0.49, 0.65, -0.5, 0.9, -0.5],
    radome: 0.34,
  },
  /** 787: smooth drooped nose, tip low, the big windscreen faired into the roof. */
  b787: {
    upper: [0, -0.2, 0, -0.1, 0.12, 0.0, 0.32, 0.08, 0.36, 0.18, 0.44, 0.28, 0.58, 0.34, 0.75, 0.42, 0.93, 0.48, 1.2, 0.5, 1.4, 0.5, 1.6, 0.5, 1.8, 0.5],
    lower: [0, -0.2, 0, -0.3, 0.1, -0.39, 0.3, -0.44, 0.5, -0.49, 0.7, -0.5, 0.95, -0.5],
    radome: 0.3,
  },
  /** 777: long smooth ogive, small windows tucked under a gently rising roof. */
  b777: {
    upper: [0, -0.12, 0, -0.03, 0.1, 0.07, 0.3, 0.12, 0.33, 0.2, 0.4, 0.28, 0.54, 0.33, 0.74, 0.42, 0.96, 0.48, 1.3, 0.5, 1.5, 0.5, 1.7, 0.5, 1.9, 0.5],
    lower: [0, -0.12, 0, -0.22, 0.1, -0.32, 0.3, -0.38, 0.55, -0.46, 0.8, -0.5, 1.1, -0.5],
    radome: 0.28,
  },
  /** 747: nose.upper ends on the upper-deck hump top. */
  b747: {
    upper: [0, -0.14, 0, -0.04, 0.1, 0.08, 0.3, 0.18, 0.55, 0.3, 0.75, 0.66, 1.7, 0.72],
    lower: [0, -0.14, 0, -0.26, 0.12, -0.36, 0.4, -0.42, 0.7, -0.48, 1.0, -0.5, 1.4, -0.5],
    radome: 0.15,
  },
  /** E-Jets: short pointed nose with a slight droop, tall two-pane flight deck windows. */
  embraer: {
    upper: [0, -0.15, 0.01, -0.06, 0.12, 0.06, 0.34, 0.12, 0.38, 0.22, 0.48, 0.33, 0.64, 0.4, 0.82, 0.46, 0.98, 0.49, 1.28, 0.5, 1.42, 0.5, 1.56, 0.5, 1.7, 0.5],
    lower: [0, -0.15, 0.01, -0.25, 0.12, -0.35, 0.36, -0.41, 0.58, -0.47, 0.82, -0.5, 1.1, -0.5],
    radome: 0.32,
  },
  /** CRJ: long slender pointed nose. */
  crj: {
    upper: [0, -0.1, 0.02, 0.0, 0.2, 0.08, 0.5, 0.16, 0.85, 0.28, 1.4, 0.5, 2.2, 0.5],
    lower: [0, -0.1, 0, -0.22, 0.2, -0.34, 0.6, -0.4, 1.0, -0.47, 1.4, -0.5, 1.8, -0.5],
    radome: 0.3,
  },
  /** ATR: short rounded nose. */
  atr: {
    upper: [0, -0.12, 0, 0.0, 0.08, 0.1, 0.25, 0.17, 0.48, 0.28, 0.8, 0.5, 1.35, 0.5],
    lower: [0, -0.12, 0, -0.26, 0.1, -0.36, 0.3, -0.42, 0.5, -0.48, 0.7, -0.5, 0.95, -0.5],
    radome: 0.16,
  },
  /** Q400: longer pointed turboprop nose. */
  q400: {
    upper: [0, -0.12, 0, -0.02, 0.16, 0.08, 0.42, 0.16, 0.72, 0.28, 1.2, 0.5, 1.9, 0.5],
    lower: [0, -0.12, 0, -0.24, 0.16, -0.35, 0.5, -0.41, 0.85, -0.48, 1.2, -0.5, 1.5, -0.5],
    radome: 0.24,
  },
  /** C919: Airbus-like, slightly longer tip. */
  c919: {
    upper: [0, -0.12, 0, -0.03, 0.1, 0.09, 0.32, 0.14, 0.36, 0.23, 0.46, 0.33, 0.62, 0.4, 0.8, 0.46, 0.97, 0.49, 1.27, 0.5, 1.42, 0.5, 1.57, 0.5, 1.72, 0.5],
    lower: [0, -0.12, 0, -0.22, 0.12, -0.33, 0.36, -0.4, 0.6, -0.47, 0.85, -0.5, 1.15, -0.5],
    radome: 0.32,
  },
  /** A220: rounded nose, two big panes a side. */
  a220: {
    upper: [0, -0.12, 0, -0.02, 0.1, 0.1, 0.3, 0.15, 0.34, 0.24, 0.44, 0.34, 0.6, 0.4, 0.78, 0.46, 0.95, 0.49, 1.25, 0.5, 1.4, 0.5, 1.55, 0.5, 1.7, 0.5],
    lower: [0, -0.12, 0, -0.22, 0.11, -0.33, 0.33, -0.4, 0.57, -0.47, 0.8, -0.5, 1.1, -0.5],
    radome: 0.3,
  },
} satisfies Record<string, NoseSpec>;

// ---------- tail cones (u <= 0 relative to the tail tip, in H) ----------

export const TAIL = {
  /** A320: crown runs straight to a high tip, long belly upsweep. */
  airbusNarrow: {
    upper: [-1.2, 0.5, -0.8, 0.5, -0.3, 0.49, 0, 0.45],
    lower: [-3.3, -0.5, -2.5, -0.5, -1.1, -0.1, 0, 0.33],
    apu: 0.1,
  },
  /** A330 (fitted to the 3-view). */
  airbusWide: {
    upper: [-1.2, 0.5, -0.8, 0.5, -0.3, 0.495, 0, 0.47],
    lower: [-3.3, -0.5, -2.6, -0.5, -1.2, -0.1, 0, 0.38],
    apu: 0.09,
  },
  /** A350: 787-like tapering cone. */
  a350: {
    upper: [-2.0, 0.5, -1.2, 0.5, -0.5, 0.36, 0, 0.26],
    lower: [-3.6, -0.5, -2.4, -0.5, -1.0, -0.15, 0, 0.1],
    apu: 0.08,
  },
  a380: {
    upper: [-1.0, 0.5, -0.6, 0.5, -0.25, 0.42, 0, 0.36],
    lower: [-2.6, -0.5, -1.8, -0.5, -0.8, -0.05, 0, 0.22],
    apu: 0.05,
  },
  /** 737NG (fitted to the 3-view): high cut-off tip with APU exhaust. */
  b737: {
    upper: [-1.6, 0.5, -1.0, 0.5, -0.35, 0.45, 0, 0.39],
    lower: [-4.1, -0.5, -3.0, -0.5, -1.2, -0.3, 0, 0.18],
    apu: 0.15,
  },
  /** 737 MAX: longer, more pointed cone. */
  b737max: {
    upper: [-1.7, 0.5, -1.1, 0.5, -0.4, 0.42, 0, 0.32],
    lower: [-4.1, -0.5, -3.0, -0.5, -1.2, -0.28, 0, 0.2],
    apu: 0.08,
  },
  b757: {
    upper: [-1.6, 0.5, -1.0, 0.5, -0.35, 0.44, 0, 0.36],
    lower: [-4.0, -0.5, -2.9, -0.5, -1.2, -0.26, 0, 0.17],
    apu: 0.12,
  },
  /** 787 (fitted to the 3-view): long upsweep to a mid-height tip. */
  b787: {
    upper: [-2.3, 0.5, -1.4, 0.5, -0.6, 0.33, 0, 0.225],
    lower: [-3.8, -0.5, -2.6, -0.5, -1.1, -0.18, 0, 0.07],
    apu: 0.08,
  },
  /** 777: tail cone ends in a vertical blade. */
  b777: {
    upper: [-1.2, 0.5, -0.7, 0.5, -0.3, 0.4, 0, 0.32],
    lower: [-3.4, -0.5, -2.4, -0.5, -1.0, -0.1, 0, 0.18],
    blade: true,
  },
  b747: {
    upper: [-1.6, 0.5, -1.0, 0.5, -0.4, 0.4, 0, 0.3],
    lower: [-3.4, -0.5, -2.4, -0.5, -1.0, -0.12, 0, 0.15],
    apu: 0.08,
  },
  /** E-Jets / A220 / C919. */
  regional: {
    upper: [-1.3, 0.5, -0.85, 0.5, -0.3, 0.47, 0, 0.4],
    lower: [-3.3, -0.5, -2.4, -0.5, -1.0, -0.12, 0, 0.27],
    apu: 0.11,
  },
  /** CRJ: slim cone under the T-tail. */
  crj: {
    upper: [-1.5, 0.5, -1.0, 0.5, -0.4, 0.44, 0, 0.36],
    lower: [-3.8, -0.5, -2.7, -0.5, -1.2, -0.15, 0, 0.2],
    apu: 0.1,
  },
  /** ATR / Q400: strong upsweep to a high tip. */
  turboprop: {
    upper: [-1.2, 0.5, -0.8, 0.5, -0.3, 0.48, 0, 0.45],
    lower: [-3.6, -0.5, -2.4, -0.5, -1.0, 0.05, 0, 0.3],
  },
} satisfies Record<string, TailConeSpec>;

// ---------- doors & windows ----------

export const pax = (x: number, w?: number, h?: number): DoorSpec => ({ x, w, h, kind: 'pax' });
export const exit = (x: number, w?: number, h?: number): DoorSpec => ({ x, w, h, kind: 'exit' });
export const cargo = (x: number, w?: number, h?: number): DoorSpec => ({ x, w, h, kind: 'cargo' });

export const row = (x0: number, x1: number, y: number, pitch: number, w: number, h: number, gaps?: WindowRow['gaps']): WindowRow => ({ x0, x1, y, pitch, w, h, gaps });
