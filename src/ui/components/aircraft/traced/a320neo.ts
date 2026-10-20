import { profile as ceo } from './a320ceo';
import type { TracedProfile } from './types';

// A320neo: derived from the A320ceo trace (same fuselage, cockpit, doors, fin). No nacelle box:
// the neo engine (LEAP-1A / PW1100G) and sharklets stay parametric (specs/narrow-airbus.ts).
export const profile: TracedProfile = {
  ...ceo,
  typeId: 'a320neo',
  source: `derived from traced/a320ceo (${ceo.source}); engines parametric`,
  engines: undefined,
  notes: 'Derived: A320ceo fuselage trace; neo differs only by engines and sharklets.',
};
