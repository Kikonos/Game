// 747-8I: derived from the 747-400 trace (same nose, hump front, cockpit glass and tail cone) by
// b748Trace — plugs and GEnx-2B nacelles live in specs/heavy.ts. Correct traced/b744.ts, not this file.

import { b748Trace } from '../specs/heavy';
import { profile as b744 } from './b744';
import type { TracedProfile } from './types';

export const profile: TracedProfile = b748Trace(b744);
