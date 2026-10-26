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

/** Screen px per metre for a hangar `width` px wide: one scale for the whole line-up (the biggest frame ≈ 29 %: three jumbos a row). Pure. */
export function hangarScale(width: number): number {
  return Math.max(2.8, Math.min(5, (width * 0.29) / FRAME_M));
}
