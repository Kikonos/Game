import { resizeNacelle } from '../specs/wide-twin';
import { profile as a333 } from './a333';
import type { TracedProfile } from './types';

// A330-900: the A330-300 fuselage (derived trace) with the bigger Trent 7000 hung 0.7 m further
// forward (spec nacelles: 3.5 x 8.0 m against 3.06 x 8.1 m); sharklets stay parametric.
const L = 63.67;

export const profile: TracedProfile = {
  ...a333,
  typeId: 'a339',
  source: `derived from traced/a333 (${a333.source}); Trent 7000 nacelle`,
  engines: a333.engines?.map((e) => resizeNacelle(e, 8.0 / 8.1, 3.5 / 3.06, -0.7 / L)),
};
