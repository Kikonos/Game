// v0.7.2 top bar ops strip (UPDATE-0.7.2.md F8): the pure parts (drop order, fit, countdown). No React.

import { fmtTime } from '../../engine/core/time';

export type StripId = 'crewShort' | 'aog' | 'market' | 'next' | 'airborne' | 'onTime' | 'crew';

/** Drop order when space is short (first goes first). */
export const DROP: StripId[] = ['crew', 'onTime', 'airborne', 'next'];

/** '1:20' to a departure (h:mm), '0:05'; past 24 h the UTC time. */
export function countdown(min: number, dep: number): string {
  const m = Math.max(0, Math.round(min));
  if (m >= 24 * 60) return fmtTime(dep);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Which items fit in `room` px: drop facts in DROP order, then fold warnings after the first into a '+N' chip. Pure. */
export function fitStrip(items: { id: StripId; warn: boolean; w: number }[], room: number, gap: number, plusW: number): { show: Set<StripId>; folded: number } {
  const show = new Set(items.map((i) => i.id));
  const width = (extra = 0) => {
    const vis = items.filter((i) => show.has(i.id));
    return vis.reduce((s, i) => s + i.w, 0) + gap * Math.max(0, vis.length - 1 + (extra ? 1 : 0)) + extra;
  };
  for (const id of DROP) {
    if (width() <= room) return { show, folded: 0 };
    show.delete(id);
  }
  const warns = items.filter((i) => i.warn);
  let folded = 0;
  while (width(folded ? plusW : 0) > room && warns.length - folded > 1) {
    folded++;
    show.delete(warns[warns.length - folded].id);
  }
  return { show, folded };
}

