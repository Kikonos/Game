// Crew card "Next 14 days" strip (v0.5.2): colour keys, legend, layers and tap picking over the engine's
// crewCalendar blocks. Pure, no React, no writes.

import type { CalBlock } from '../../engine/crew';
import type { FlightType } from '../../engine/ops';

/** Colour key of a strip block: duty blocks by their legs' flight type, everything else by kind. */
export type CalKey = 'operating' | 'positioning' | 'ferry' | 'ride' | 'deadhead' | 'rest' | 'off' | 'sick' | 'joining' | 'training' | 'leave' | 'standby';

export const CAL_KEY_LABEL: Record<CalKey, string> = {
  operating: 'Operating', positioning: 'Positioning', ferry: 'Ferry', ride: 'Positioning (passenger)', deadhead: 'Deadhead',
  rest: 'Rest', off: 'Day off', sick: 'Sick', joining: 'Joining', training: 'Training', leave: 'Leave', standby: 'Standby',
};

/** Block title for the detail card and the list: the agreed flight-type words for work and travel, the engine's label otherwise. */
export function calLabel(b: Pick<CalBlock, 'kind' | 'flights' | 'label'>): string {
  const k = calKey(b);
  return k === 'operating' || k === 'positioning' || k === 'ferry' || k === 'ride' || k === 'deadhead' ? CAL_KEY_LABEL[k] : b.label;
}

/** Legend order: work first, then travel, status windows, rest and days off. */
export const CAL_KEYS: CalKey[] = ['operating', 'positioning', 'ferry', 'ride', 'deadhead', 'standby', 'sick', 'joining', 'training', 'leave', 'rest', 'off'];

/** A duty's type from its legs: any revenue leg → operating; only ferries → ferry; otherwise positioning. */
export function dutyType(b: Pick<CalBlock, 'flights'>): FlightType {
  const t = new Set((b.flights ?? []).map((f) => f.type));
  if (!t.size || t.has('operating')) return 'operating';
  return t.size === 1 && t.has('ferry') ? 'ferry' : 'positioning';
}

export function calKey(b: Pick<CalBlock, 'kind' | 'flights'>): CalKey {
  switch (b.kind) {
    case 'duty': return dutyType(b) as CalKey;
    case 'positioning': return 'ride';
    default: return b.kind;
  }
}

/**
 * Drawing layer: rest and days off underneath, status windows (sick, training…) above them, work and travel on top
 * (a deadhead to the training centre, or today's duty before a sick call, stays visible over the window).
 */
export function calLayer(b: Pick<CalBlock, 'kind'>): 0 | 1 | 2 {
  if (b.kind === 'rest' || b.kind === 'off') return 0;
  if (b.kind === 'sick' || b.kind === 'joining' || b.kind === 'training' || b.kind === 'leave') return 1;
  return 2;
}

/** Keys present in the blocks, in legend order. */
export function calLegend(blocks: Pick<CalBlock, 'kind' | 'flights'>[]): CalKey[] {
  const have = new Set(blocks.map(calKey));
  return CAL_KEYS.filter((k) => have.has(k));
}

/** Stable id of a block (selection, React key). */
export const calId = (b: Pick<CalBlock, 'kind' | 'start' | 'dutyId'>) => `${b.kind}-${b.dutyId ?? ''}-${b.start}`;

/**
 * The block under a tap at minute `t` (lane at `ppm` px per minute): the top-most layer containing `t`; a narrow
 * work block within `slop` px (12: a fingertip) wins over the rest / day off underneath (duties are a few px wide at 14 days).
 */
export function pickCal<B extends Pick<CalBlock, 'kind' | 'start' | 'end'>>(blocks: B[], t: number, ppm: number, slop = 12): B | null {
  const s = slop / Math.max(ppm, 1e-9);
  let best: B | null = null;
  let bestD = Infinity;
  for (const b of blocks) {
    if (calLayer(b) === 0) continue;
    const d = t < b.start ? b.start - t : t > b.end ? t - b.end : 0;
    if (d > s) continue;
    // Inside beats nearby; then the higher layer; then the nearer one.
    const score = d - calLayer(b) * 1e-3;
    if (score < bestD) {
      best = b;
      bestD = score;
    }
  }
  if (best) return best;
  return blocks.find((b) => calLayer(b) === 0 && b.start <= t && b.end > t) ?? null;
}

/** The block running at `now` (top layer first), for the default selection. */
export function calAt<B extends Pick<CalBlock, 'kind' | 'start' | 'end'>>(blocks: B[], now: number): B | null {
  const on = blocks.filter((b) => b.start <= now && b.end > now).sort((a, b) => calLayer(b) - calLayer(a));
  return on[0] ?? null;
}
