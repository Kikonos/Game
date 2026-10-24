// Crew card "Next 14 days" strip (v0.5.2): colour keys, legend, layers and tap picking over the engine's
// crewCalendar blocks. Pure, no React, no writes.

import type { CalBlock } from '../../engine/crew';
import type { FlightType } from '../../engine/ops';

/** Colour key of a strip block: duty blocks by their legs' flight type, everything else by kind. */
/** v0.9 §R: 'standby' = home standby; hotel standby, airport standby and reserve have their own keys. */
export type CalKey = 'operating' | 'positioning' | 'ferry' | 'ride' | 'deadhead' | 'rest' | 'off' | 'sick' | 'joining' | 'training' | 'leave' | 'standby'
  | 'sbyHotel' | 'asby' | 'res';

export const CAL_KEY_LABEL: Record<CalKey, string> = {
  operating: 'Operating', positioning: 'Positioning', ferry: 'Ferry', ride: 'Positioning (passenger)', deadhead: 'Deadhead',
  rest: 'Rest', off: 'Day off', sick: 'Sick', joining: 'Joining', training: 'Training', leave: 'Leave', standby: 'Home standby',
  sbyHotel: 'Hotel standby', asby: 'Airport standby', res: 'Reserve',
};

/** v0.9 §R.8 roster codes, as the board writes them (legend and strip keys). */
export const CAL_KEY_CODE: Partial<Record<CalKey, string>> = { off: 'OFF', standby: 'SBY', sbyHotel: 'SBY DUB', asby: 'ASBY', res: 'RES', leave: 'LEAVE' };

/** Block title for the detail card and the list: the agreed flight-type words for work and travel, the engine's label otherwise. */
export function calLabel(b: Pick<CalBlock, 'kind' | 'flights' | 'label'>): string {
  const k = calKey(b);
  return k === 'operating' || k === 'positioning' || k === 'ferry' || k === 'ride' || k === 'deadhead' ? CAL_KEY_LABEL[k] : b.label;
}

/** Legend order: work first, then travel, status windows, rest and days off. */
export const CAL_KEYS: CalKey[] = ['operating', 'positioning', 'ferry', 'ride', 'deadhead', 'off', 'standby', 'sbyHotel', 'asby', 'res', 'leave', 'sick', 'joining', 'training', 'rest'];

/** v0.9 §R.8 strip text of a non-duty block: OFF / OFF DUB, SBY E / SBY L, SBY DUB, ASBY, RES, LEAVE; else its label. */
export function stripText(b: Pick<CalBlock, 'kind' | 'label' | 'flights' | 'sby' | 'shift' | 'at'>): string {
  const k = calKey(b);
  if (k === 'off') return b.label === 'Free' ? '' : b.at ? `OFF ${b.at}` : 'OFF';
  if (k === 'standby') return b.shift ? `SBY ${b.shift}` : 'SBY';
  if (k === 'sbyHotel') return b.at ? `SBY ${b.at}` : 'SBY';
  if (k === 'asby') return 'ASBY';
  if (k === 'res') return 'RES';
  if (k === 'leave' && b.label === 'Leave') return 'LEAVE';
  return b.label;
}

/** A duty's type from its legs: any revenue leg → operating; only ferries → ferry; otherwise positioning. */
export function dutyType(b: Pick<CalBlock, 'flights'>): FlightType {
  const t = new Set((b.flights ?? []).map((f) => f.type));
  if (!t.size || t.has('operating')) return 'operating';
  return t.size === 1 && t.has('ferry') ? 'ferry' : 'positioning';
}

export function calKey(b: Pick<CalBlock, 'kind' | 'flights'> & { sby?: CalBlock['sby'] }): CalKey {
  switch (b.kind) {
    case 'duty': return dutyType(b) as CalKey;
    case 'positioning': return 'ride';
    case 'standby': return b.sby === 'hotel' ? 'sbyHotel' : b.sby === 'airport' ? 'asby' : b.sby === 'reserve' ? 'res' : 'standby';
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
export function calLegend(blocks: (Pick<CalBlock, 'kind' | 'flights'> & { sby?: CalBlock['sby'] })[]): CalKey[] {
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
