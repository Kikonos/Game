// Livery constants (v0.5.1, LIVERY.md §1.5). No React: the engine and the UI both read these.
// Logo artwork lives in src/ui/components/aircraft/logos.ts, keyed by LOGO_IDS. Client colours are generic
// pairs, not copies of any real airline scheme.

import type { Livery } from '../engine/core/types';
import { AIRPORT_BY_CODE } from './airports';

export const LOGO_IDS = ['arc', 'swift', 'globe', 'polaris', 'compass', 'sunrise', 'wave', 'peaks', 'chevrons', 'ribbon', 'orbit', 'kite', 'feather', 'spark', 'prism'] as const;
export type LogoId = (typeof LOGO_IDS)[number];

export const LOGO_NAMES: Record<LogoId, string> = {
  arc: 'Arc', swift: 'Swift', globe: 'Globe', polaris: 'Polaris', compass: 'Compass', sunrise: 'Sunrise', wave: 'Wave', peaks: 'Peaks',
  chevrons: 'Chevrons', ribbon: 'Ribbon', orbit: 'Orbit', kite: 'Kite', feather: 'Feather', spark: 'Spark', prism: 'Prism',
};

/** Logos a client livery may use (picked by client hash). */
export const CLIENT_LOGOS: readonly LogoId[] = ['globe', 'compass', 'wave', 'peaks', 'orbit', 'prism', 'arc'];

/** 16 generic primary/secondary pairs for client liveries. */
export const CLIENT_PALETTE: readonly [string, string][] = [
  ['#7a1f2b', '#e8b04a'], ['#0f4c5c', '#e36414'], ['#1d3557', '#e63946'], ['#2b2d42', '#8d99ae'],
  ['#14532d', '#facc15'], ['#4c1d95', '#f472b6'], ['#0c4a6e', '#38bdf8'], ['#7c2d12', '#fdba74'],
  ['#134e4a', '#5eead4'], ['#3f3f46', '#f59e0b'], ['#831843', '#fbcfe8'], ['#1e3a8a', '#fde047'],
  ['#365314', '#bef264'], ['#0f172a', '#22d3ee'], ['#9a3412', '#1e293b'], ['#155e75', '#f8fafc'],
];

export const WHITE_LIVERY: Livery = { primary: '#ffffff', secondary: '#c0c7d6', tail: 'solid', plain: true, stickers: [] };
/** Title screen and brand art. */
export const BRAND_LIVERY: Livery = { primary: '#1e4fd8', secondary: '#3ee6ff', tail: 'sweep' };
/** Aircraft-market cards (no operator yet). */
export const MARKET_LIVERY: Livery = { ...WHITE_LIVERY, stickers: [] };

/** Paint shops (MRO hangars that strip and paint airliners); unknown airports dropped at load. */
export const PAINT_SHOPS: readonly string[] = ['LIS', 'MAD', 'MLA', 'VNO', 'SNN', 'LDE', 'TLS', 'HAM', 'BUD', 'IST', 'AUH', 'SIN'].filter((c) => !!AIRPORT_BY_CODE[c]);

export const MAX_STICKERS = 6;
/** v0.10 fuselage stripes per livery. */
export const MAX_STRIPES = 3;
export const MAX_TITLE = 28;
export const MAX_CODE = 3;

// ---------- v0.10 body paint presets ----------

export type BodyPresetId = 'eurowhite' | 'cheatline' | 'fullColour' | 'bellyBand';

export const BODY_PRESETS: { id: BodyPresetId; label: string; hint: string }[] = [
  { id: 'eurowhite', label: 'Eurowhite', hint: 'White fuselage, coloured tail and engines' },
  { id: 'cheatline', label: 'Classic cheatline', hint: 'A stripe along the windows, a thin one under it, grey belly' },
  { id: 'fullColour', label: 'Full colour', hint: 'The whole fuselage in the tail colour' },
  { id: 'bellyBand', label: 'Belly band', hint: 'White top, coloured belly with an accent line' },
];

/** The body paint of a preset in the livery's own colours (the tail scheme and the stickers are kept). Pure. */
export function bodyPreset(id: BodyPresetId, lv: Livery): Livery['body'] {
  const p = lv.primary, s = lv.secondary;
  switch (id) {
    case 'eurowhite':
      return undefined;
    case 'cheatline':
      return { belly: { color: '#c9ced8', split: 0.7, tilt: 0 }, stripes: [{ color: p, y: 0.4, h: 0.1, windows: true }, { color: s, y: 0.56, h: 0.03 }] };
    case 'fullColour':
      return { color: p, engines: s, lip: '#ffffff' };
    case 'bellyBand':
      return { belly: { color: p, split: 0.58, tilt: 0 }, stripes: [{ color: s, y: 0.545, h: 0.035 }] };
  }
}
