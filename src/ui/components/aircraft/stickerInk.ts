// Lettering colours of the livery stickers (tail code, titles): the usual ink of the paint under a sticker, or the
// colour that reads best when it straddles paints. Pure.

import type { Livery } from '../../../engine/core/types';
import { bodyColourAt, finStripeAt } from './bodyPaint';
import { autoBodyInk, autoFinInk, contrast, INK, lum } from './ink';
import { boxSamples, onFinSecond, sideAt, type StickerBox } from './stickers';

/** Paint a sticker can sit on: a colour (hex). v0.10: the fuselage may carry body paint (bodyPaint.ts). */
type Ground = string;

/** Lettering on the scheme's second colour: primary, else white / ink. */
function inkOnSecondary(lv: Livery): string {
  return contrast(lv.primary, lv.secondary) >= 2.2 ? lv.primary : lum(lv.secondary) < 0.4 ? '#ffffff' : INK;
}
/** The usual lettering colour on a ground: as before v0.10 on white, the fin colour and its second colour; on body
 *  paint the livery colour that reads best (the tail colours first), else white or ink. */
function inkOn(lv: Livery, gr: Ground): string {
  if (gr === '#ffffff') return autoBodyInk(lv);
  if (!lv.plain && gr === lv.primary) return autoFinInk(lv);
  if (!lv.plain && gr === lv.secondary) return inkOnSecondary(lv);
  const pool = [lv.primary, lv.secondary, '#ffffff', INK].filter((c) => c !== gr);
  const good = pool.find((c) => contrast(c, gr) >= 3);
  return good ?? pool.reduce((a, c) => (contrast(c, gr) > contrast(a, gr) ? c : a));
}

/** Paint under a viewBox point: the fin's scheme colours, the fuselage's body paint (white as drawn); null off the airframe. */
function groundAt(typeId: string, lv: Livery, X: number, Y: number): Ground | null {
  const side = sideAt(typeId, X, Y);
  if (!side) return null;
  if (side === 'fuselage') return bodyColourAt(typeId, lv, X, Y);
  if (lv.plain) return '#ffffff';
  return finStripeAt(typeId, lv, X, Y) ?? (onFinSecond(typeId, lv.tail, X, Y) ? lv.secondary : lv.primary);
}

/** Share of a sticker box's visible part on each ground, largest first (7 × 5 samples; empty when wholly clipped). */
function groundsUnder(typeId: string, lv: Livery, b: StickerBox): [Ground, number][] {
  const n = new Map<Ground, number>();
  let k = 0;
  for (const [X, Y] of boxSamples(b, 7, 5)) {
    const gr = groundAt(typeId, lv, X, Y);
    if (!gr) continue;
    n.set(gr, (n.get(gr) ?? 0) + 1);
    k++;
  }
  return [...n].map(([gr, c]): [Ground, number] => [gr, c / k]).sort((a, b) => b[1] - a[1]);
}

/**
 * Auto lettering colour for a sticker box: the usual ink of the ground under most of it; when it straddles
 * grounds (≥ 10 % each) and that ink fails on one, the colour with the best worst-case contrast.
 */
export function stickerInk(typeId: string, lv: Livery, b: StickerBox): string {
  const sig = groundsUnder(typeId, lv, b).filter(([, s]) => s >= 0.1);
  if (!sig.length) return b.side === 'fin' ? autoFinInk(lv) : autoBodyInk(lv);
  const pref = inkOn(lv, sig[0][0]);
  if (sig.length === 1) return pref;
  const score = (c: string) => Math.min(...sig.map(([gr]) => contrast(c, gr)));
  if (score(pref) >= 2.2) return pref;
  const best = [lv.secondary, lv.primary, '#ffffff', INK].reduce((a, c) => (score(c) > score(a) + 0.01 ? c : a));
  return score(best) >= 3 || sig[0][1] < 0.6 ? best : pref;
}

/** Background a sticker sits on (for contrast warnings): with its box, the paint under most of it; else the fin colour or white. */
export function stickerGround(lv: Livery, side: 'fin' | 'fuselage', at?: { typeId: string; box: StickerBox }): string {
  const top = at && groundsUnder(at.typeId, lv, at.box)[0];
  if (top) return top[0];
  return side === 'fin' && !lv.plain ? lv.primary : '#ffffff';
}
