import { resizeNacelle } from '../specs/wide-twin';
import { profile as b772 } from './b772';
import type { TracedProfile } from './types';

// 777-200LR: the 777-200ER fuselage (same trace) with the GE90-110B/115B nacelle (spec 4.05 x 8.8 m
// against the -200ER's 3.9 x 8.6 m); the raked tips stay parametric.
export const profile: TracedProfile = {
  ...b772,
  typeId: 'b77l',
  source: `derived from traced/b772 (${b772.source}); GE90-115B nacelle`,
  engines: b772.engines?.map((e) => resizeNacelle(e, 8.8 / 8.6, 4.05 / 3.9)),
};
