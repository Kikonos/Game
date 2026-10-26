// v0.12 Visual B: the hangar line-up on the Fleet screen. Every aircraft side by side at one scale (real lengths: an
// A320 is visibly small beside a 747 or an A380), biggest first so the line reads like a family photo. Pure.

import { artFor } from '../../data/acmiTypes';
import type { Aircraft } from '../../engine/core/types';
import { LENGTH_M } from '../components/aircraft/sprites';

export interface HangarItem {
  id: string;
  reg: string;
  name?: string;
  typeId: string;
  /** The side-view sprite (variant art). */
  sprite: string;
  /** Real overall length (m). */
  lengthM: number;
}

/** The fleet in line-up order: longest first, then by registration. Pure. */
export function hangarOrder(fleet: Pick<Aircraft, 'id' | 'reg' | 'name' | 'typeId' | 'variant'>[]): HangarItem[] {
  return fleet
    .map((ac) => {
      const sprite = artFor(ac.typeId, ac.variant);
      return { id: ac.id, reg: ac.reg, name: ac.name, typeId: ac.typeId, sprite, lengthM: LENGTH_M[sprite] ?? LENGTH_M[ac.typeId] ?? 40 };
    })
    .sort((a, b) => b.lengthM - a.lengthM || a.reg.localeCompare(b.reg));
}

/** The biggest side-view frame we draw (m): a 777-9 or 747-8 with its fin and a little air. */
const FRAME_M = 84;

/** Side-view frame per metre of aircraft length (fin, nose and air around the drawing). */
const FRAME_PER_M = 1.12;
/** Gap between aircraft (px). */
const GAP_PX = 30;

/**
 * Screen px per metre for a hangar `width` px wide: one scale for the whole line-up. A big fleet: the biggest frame
 * ≈ 29 % of the width (three jumbos a row). A small one that fits in a row at a larger scale is drawn larger (its
 * biggest aircraft up to 42 % of the width), the same scale for all of them. Pure.
 */
export function hangarScale(width: number, lengths: number[] = []): number {
  const base = (width * 0.29) / FRAME_M;
  let k = base;
  if (lengths.length) {
    const row = lengths.reduce((a, b) => a + b * FRAME_PER_M, 0);
    const fit = (width - GAP_PX * lengths.length) / row;
    const cap = (width * 0.42) / (Math.max(...lengths) * FRAME_PER_M);
    k = Math.max(base, Math.min(fit, cap));
  }
  return Math.max(2.8, Math.min(7, k));
}
