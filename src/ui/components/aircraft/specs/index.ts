// All aircraft side-profile specs, keyed by AIRCRAFT type id.

import type { AircraftProfile } from '../types';
import { HEAVY } from './heavy';
import { NARROW_AIRBUS } from './narrow-airbus';
import { NARROW_BOEING } from './narrow-boeing';
import { REGIONAL } from './regional';
import { WIDE_TWIN } from './wide-twin';

export const PROFILES: AircraftProfile[] = [...REGIONAL, ...NARROW_AIRBUS, ...NARROW_BOEING, ...WIDE_TWIN, ...HEAVY];

export const PROFILE_BY_ID: Record<string, AircraftProfile> = Object.fromEntries(PROFILES.map((p) => [p.id, p]));
