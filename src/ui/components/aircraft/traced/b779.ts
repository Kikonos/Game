import { B777_PLUGS, b777Stretch } from './b77w';
import type { TracedProfile } from './types';

// 777-9: the 777-300ER stretch plus 1.6 m ahead of and 1.26 m behind the wing (specs/heavy.ts),
// same nose family; GE9X nacelle (4.4 x 9.4 m against 3.9 x 8.6 m) and the larger 777X windows.
const t = b777Stretch('b779', 76.72, [{ ...B777_PLUGS[0], m: 5.3 + 1.6 }, { ...B777_PLUGS[1], m: 4.83 + 1.26 }], 32.0 + 1.6, 9.4 / 8.6, 4.4 / 3.9);

export const profile: TracedProfile = { ...t, windows: { ...t.windows, h: (t.windows.h * 0.46) / 0.38 } };
