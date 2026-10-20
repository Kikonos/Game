import { profile as a359 } from './a359';
import type { TracedProfile } from './types';

// A350-900ULR: externally the A350-900.
export const profile: TracedProfile = { ...a359, typeId: 'a35u', source: `derived from traced/a359 (${a359.source})` };
