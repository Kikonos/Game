// 737 MAX 8: derived from the 737-800 trace (same nose and cockpit glass) by b737MaxTrace — MAX
// plugs, tail cone and LEAP-1B nacelle live in specs/narrow-boeing.ts. Correct traced/b738.ts, not this file.

import { b737MaxTrace } from '../specs/narrow-boeing';
import { profile as b738 } from './b738';
import type { TracedProfile } from './types';

export const profile: TracedProfile = b737MaxTrace(b738, 'b38m');
