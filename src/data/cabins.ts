// v0.7 cabin layouts per type (UPDATE-0.7.md §F7.1): the type's presets plus a VIP layout derived from its size.

import { ACMI_TYPES, type AcmiType, type CabinPreset } from './acmiTypes';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Seats of the type's all-economy preset (else its largest preset). */
const allEconomyY = (t: AcmiType) => {
  const ae = t.cabins.find((c) => c.layout === 'all-economy');
  return ae ? ae.y : Math.max(...t.cabins.map((c) => c.j + c.w + c.y));
};

/** VIP: narrowbody 24J (28J above 200 seats) and half the all-economy seats; widebody 9% business (30–48) and 45%. */
export function vipPreset(t: AcmiType): CabinPreset {
  const wide = t.body === 'wide';
  const j = wide ? clamp(Math.round((t.maxSeats * 0.09) / 2) * 2, 30, 48) : t.maxSeats > 200 ? 28 : 24;
  // To the nearest 10 (the doc's examples: 90, 110, 150 and 180 Y).
  const y = Math.round((allEconomyY(t) * (wide ? 0.45 : 0.5)) / 10) * 10;
  return { label: `${j}J/${y}Y`, layout: 'vip', j, w: 0, y };
}

/** The type's presets (all-economy, two-class, three-class where listed) plus its VIP preset. */
export function cabinPresets(typeId: string): CabinPreset[] {
  const t = ACMI_TYPES[typeId];
  if (!t) return [];
  return [...t.cabins, vipPreset(t)];
}
