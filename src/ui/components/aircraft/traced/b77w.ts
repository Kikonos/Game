import { resizeNacelle, stretchTrace } from '../specs/wide-twin';
import { profile as b772 } from './b772';
import type { TracedProfile } from './types';

// 777-300ER: the 777-200ER trace with the -300's plugs (5.3 m between door 2 and the wing, 4.83 m
// just aft of the wing box, ahead of the -200's door 3), so the traced nose, cockpit and tail cone
// stay exact. Five door pairs: the -200's L3/L4 become L4/L5 and a new L3 sits over the wing
// (32.0 m, specs/heavy.ts); GE90-115B nacelle (4.05 x 8.8 m against 3.9 x 8.6 m).
export const B777_200_M = 63.73;
export const B777_PLUGS = [{ at: 0.335, m: 5.3 }, { at: 0.545, m: 4.83 }] as const;

/** A stretched 777 from the -200ER trace: L3 over the wing at `l3` m, nacelle scaled by `kw` x `kh`. */
export function b777Stretch(typeId: string, L: number, plugs: readonly { at: number; m: number }[], l3: number, kw: number, kh: number): TracedProfile {
  const t = stretchTrace(b772, B777_200_M, typeId, L, plugs, `derived from traced/b772 (${b772.source}), ${L} m`);
  const d = t.doors[0];
  return {
    ...t,
    doors: [...t.doors, { ...d, x: l3 / L }].sort((a, b) => a.x - b.x),
    engines: t.engines?.map((e) => resizeNacelle(e, kw, kh)),
  };
}

export const profile: TracedProfile = b777Stretch('b77w', 73.86, B777_PLUGS, 32.0, 8.8 / 8.6, 4.05 / 3.9);
