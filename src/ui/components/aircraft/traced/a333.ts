import { A330_PLUGS, stretchTrace } from '../specs/wide-twin';
import { profile as a332 } from './a332';
import type { TracedProfile } from './types';

// A330-300: the A330-200 trace with the -300's two plugs (3.2 m between doors 1 and 2, 1.65 m
// between doors 3 and 4), so the traced nose, cockpit and tail cone stay exact. Door 3 is the
// -300's smaller Type I exit (0.76 x 1.4 m), top a little below the door tops.
const L = 63.67;
const base = stretchTrace(a332, 58.82, 'a333', L, A330_PLUGS, `derived from traced/a332 (${a332.source}), A330-300 plugs`);
const d3 = base.doors[2];

export const profile: TracedProfile = {
  ...base,
  doors: base.doors.map((d) => (d === d3 ? { x: d.x + (d.w - 0.76 / L) / 2, w: 0.76 / L, h: 1.4 / L, y: d.y + 0.35 / L } : d)),
};
