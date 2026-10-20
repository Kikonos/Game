import { profile as ceo } from './a321ceo';
import type { TracedProfile } from './types';

// A321neo (Airbus Cabin Flex): derived from the A321ceo trace (same 44.51 m fuselage, nose and
// tail cone). Door 3 is replaced by a pair of overwing exits, so its window gap closes and the
// exits leave the A320 overwing spacing (+4.27 m plug); engine and sharklets stay parametric.
// Wing root on the A320 trace's station + 4.27 m plug (the A321 photo's wing root reads ~3 m aft).
const L = 44.51, plug = 4.27 / L;
const door3 = (d: { x: number }) => d.x > 0.5 && d.x < 0.6;

export const profile: TracedProfile = {
  ...ceo,
  typeId: 'a321neo',
  source: `derived from traced/a321ceo (${ceo.source}); ACF doors, engines parametric`,
  doors: ceo.doors.filter((d) => !door3(d)),
  windows: {
    ...ceo.windows,
    gaps: [
      ...ceo.windows.gaps.filter(([a]) => !(a > 0.5 && a < 0.6)),
      // the A320 trace's overwing-exit gaps (m) moved by the forward plug
      ...([[14.04, 14.45], [14.99, 15.26], [15.58, 16.42]] as const).map(([a, b]): [number, number] => [a / L + plug, b / L + plug]),
    ],
  },
  wingRoot: { from: 12.01 / L + plug, to: 19.75 / L + plug, y: ceo.wingRoot?.y ?? 0.0201 },
  engines: undefined,
  notes: 'Derived: A321ceo fuselage trace with ACF doors (no door 3, overwing exits); wing root at the A320 station + plug.',
};
