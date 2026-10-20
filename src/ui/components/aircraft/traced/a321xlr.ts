import { profile as neo } from './a321neo';
import type { TracedProfile } from './types';

// A321XLR: same airframe in side view as the A321neo ACF (the extra centre tank is internal).
export const profile: TracedProfile = {
  ...neo,
  typeId: 'a321xlr',
  source: `derived from traced/a321neo (${neo.source})`,
};
