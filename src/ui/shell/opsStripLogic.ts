// v0.7.2 top bar ops strip (UPDATE-0.7.2.md F8): the pure parts (drop order, fit, 'when'). No React.

import { DAY, fmtDay, fmtTime } from '../../engine/core/time';

export type StripId = 'crewShort' | 'aog' | 'market' | 'next' | 'airborne' | 'onTime' | 'crew';

/** Drop order when space is short (first goes first). */
export const DROP: StripId[] = ['crew', 'onTime', 'airborne', 'next'];

/**
 * When a departure is, as the whole phrase: 'in 1h 20m', 'in 45m', 'in 10h' under 24 h (a duration, never a
 * clock-like h:mm); from 24 h a UTC date and time with no 'in': '3 Apr 00:10'. 'now' once due. Pure.
 */
export function countdown(dep: number, now: number): string {
  const m = Math.round(dep - now);
  if (m <= 0) return 'now';
  if (m >= DAY) return `${fmtDay(dep)} ${fmtTime(dep)}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `in ${h ? (mm ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`}`;
}

export interface FitItem { id: StripId; warn: boolean; w: number; /** Width as a slim chip (icon + value), warnings only. */ ws?: number }

/**
 * Which items fit in `room` px. CREW drops first; then the warning chips slim to icon + value (so ON TIME and
 * AIRBORNE still fit beside them); then ON TIME → AIRBORNE → NEXT drop; then warnings after the first fold into '+N'. Pure.
 */
export function fitStrip(items: FitItem[], room: number, gap: number, plusW: number): { show: Set<StripId>; folded: number; slim: boolean } {
  const show = new Set(items.map((i) => i.id));
  let slim = false;
  const w = (i: FitItem) => (slim && i.warn && i.ws ? i.ws : i.w);
  const width = (extra = 0) => {
    const vis = items.filter((i) => show.has(i.id));
    return vis.reduce((s, i) => s + w(i), 0) + gap * Math.max(0, vis.length - 1 + (extra ? 1 : 0)) + extra;
  };
  const warns = items.filter((i) => i.warn);
  for (const id of DROP) {
    if (width() <= room) return { show, folded: 0, slim };
    if (id === 'onTime' && warns.length) {
      slim = true;
      if (width() <= room) return { show, folded: 0, slim };
    }
    show.delete(id);
  }
  if (warns.length) slim = true;
  let folded = 0;
  while (width(folded ? plusW : 0) > room && warns.length - folded > 1) {
    folded++;
    show.delete(warns[warns.length - folded].id);
  }
  return { show, folded, slim };
}
