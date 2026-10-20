// Cockpit window presets. Panes are polygons in fuselage-height units (H),
// relative to the spec anchor (lower front corner of the windscreen), u aft,
// v up. They sit just under the local roof line of the nose (see NOSE in
// specs/shared.ts); the spec's `scale` shrinks them on big fuselages.

import type { CockpitStyle } from './types';

type Poly = readonly (readonly [number, number])[];

export interface CockpitPreset {
  panes: Poly[];
  /** Painted surround (A350 raccoon mask) drawn under the panes. */
  mask?: Poly;
}

/** Three panes: raked windscreen, near-square sliding window, aft pane tapering to the rear. */
const three = (h: number, rake = 0.085): Poly[] => [
  [[0, 0], [rake, h], [0.19, h * 1.04], [0.165, 0]],
  [[0.19, 0], [0.212, h * 1.03], [0.305, h * 0.95], [0.3, 0]],
  [[0.325, 0], [0.328, h * 0.86], [0.38, h * 0.66], [0.41, 0]],
];

/** Two panes: windscreen and a long side window swept to a point. */
const two = (h: number, rake = 0.1): Poly[] => [
  [[0, 0], [rake, h], [0.225, h * 1.05], [0.205, 0]],
  [[0.23, 0], [0.242, h * 1.04], [0.345, h * 0.9], [0.43, 0.01]],
];

export const COCKPIT: Record<CockpitStyle, CockpitPreset> = {
  // A320/A330: raked windscreen, sliding side window, tapered rear window
  airbus: { panes: three(0.135) },
  // A380: same family, flatter panes between the decks
  a380: { panes: three(0.12, 0.07) },
  // A350: black "raccoon mask" round the panes, swept to a point at the rear
  a350: {
    mask: [[-0.04, -0.02], [-0.02, 0.06], [0.05, 0.13], [0.2, 0.158], [0.36, 0.15], [0.52, 0.1], [0.68, 0.015], [0.6, -0.025], [0.3, -0.035]],
    panes: [
      [[0, 0], [0.085, 0.13], [0.2, 0.138], [0.18, 0]],
      [[0.21, 0], [0.225, 0.138], [0.33, 0.125], [0.325, 0]],
      [[0.35, 0], [0.352, 0.112], [0.42, 0.075], [0.46, 0]],
    ],
  },
  // 737: tall upright-looking panes on a slim nose
  b737: { panes: three(0.145, 0.095) },
  // 757/767: the same flight deck
  b757: { panes: three(0.14, 0.095) },
  // 787: two big panes a side, the side window swept to a point
  b787: { panes: two(0.125, 0.11) },
  b777: { panes: three(0.115, 0.08) },
  b747: { panes: three(0.1, 0.07) },
  embraer: { panes: two(0.15, 0.1) },
  crj: { panes: two(0.145, 0.12) },
  atr: {
    panes: [
      [[0, 0], [0.09, 0.16], [0.22, 0.18], [0.21, 0]],
      [[0.235, 0], [0.24, 0.18], [0.35, 0.16], [0.36, 0]],
      [[0.385, 0], [0.387, 0.15], [0.44, 0.12], [0.46, 0.01]],
    ],
  },
  q400: {
    panes: [
      [[0, 0], [0.11, 0.155], [0.24, 0.165], [0.225, 0]],
      [[0.25, 0], [0.256, 0.165], [0.36, 0.15], [0.37, 0]],
      [[0.395, 0], [0.397, 0.14], [0.45, 0.115], [0.47, 0.01]],
    ],
  },
  c919: { panes: two(0.13, 0.1) },
  a220: { panes: two(0.135, 0.1) },
  overture: {
    panes: [
      [[0, 0], [0.18, 0.11], [0.36, 0.12], [0.33, 0]],
      [[0.37, 0], [0.38, 0.115], [0.5, 0.095], [0.58, 0]],
    ],
  },
};
