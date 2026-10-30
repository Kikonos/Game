// v0.10 airframe variants: types whose airframes differ in a way the art shows (engines, door layout). Each
// airframe gets one when it is created (market roll, delivery, start fleet), deterministically; older saves get a
// stable one on load. No React: the engine and the UI both read these.

import { hashUnit } from '../engine/core/util';

export interface AirframeVariant {
  id: string;
  /** Short label for the Fleet card. */
  label: string;
  /** Sprite id (public/aircraft/<sprite>-*.webp). */
  sprite: string;
  /** Engines fitted, in plain words. */
  engines: string;
  /** Exit-limit seats when the variant changes them (else the type's). */
  maxSeats?: number;
  /** Share of the used market. */
  share: number;
  /** Build years the variant was delivered in (else any). */
  years?: [number, number];
}

/** Engines of every type (variants override). */
export const ENGINES: Record<string, string> = {
  a320ceo: 'CFM56-5B or IAE V2500',
  a321ceo: 'CFM56-5B or IAE V2500',
  a321neo: 'CFM LEAP-1A or Pratt & Whitney PW1100G',
  a320neo: 'CFM LEAP-1A or Pratt & Whitney PW1100G',
  b738: 'CFM56-7B',
  b739: 'CFM56-7B',
  b752: 'Rolls-Royce RB211-535 or Pratt & Whitney PW2000',
  b753: 'Rolls-Royce RB211-535E4 or Pratt & Whitney PW2043',
  b763: 'GE CF6-80C2 or Pratt & Whitney PW4000',
  a332: 'Rolls-Royce Trent 700, GE CF6-80E1 or Pratt & Whitney PW4000',
  a333: 'Rolls-Royce Trent 700, GE CF6-80E1 or Pratt & Whitney PW4000',
  a339: 'Rolls-Royce Trent 7000',
  a342: 'CFM56-5C (four)',
  a343: 'CFM56-5C (four)',
  a345: 'Rolls-Royce Trent 553 (four)',
  a346: 'Rolls-Royce Trent 556 (four)',
  a359: 'Rolls-Royce Trent XWB-84',
  a35u: 'Rolls-Royce Trent XWB-84',
  a35k: 'Rolls-Royce Trent XWB-97',
  a388: 'Rolls-Royce Trent 900 or Engine Alliance GP7200 (four)',
  b772: 'GE90-94B, Pratt & Whitney PW4090 or Rolls-Royce Trent 895',
  b77w: 'GE90-115B',
  b778: 'GE9X',
  b779: 'GE9X',
  b788: 'GEnx-1B or Rolls-Royce Trent 1000',
  b789: 'GEnx-1B or Rolls-Royce Trent 1000',
  b78x: 'GEnx-1B or Rolls-Royce Trent 1000',
  b741: 'Pratt & Whitney JT9D (four)',
  b742: 'Pratt & Whitney JT9D, GE CF6-50 or Rolls-Royce RB211-524 (four)',
  b743: 'Pratt & Whitney JT9D-7R4, GE CF6-50/-80C2 or Rolls-Royce RB211-524D4 (four)',
  b744: 'Pratt & Whitney PW4056, GE CF6-80C2 or Rolls-Royce RB211-524G/H (four)',
  b748: 'GEnx-2B (four)',
};

export const VARIANTS: Record<string, AirframeVariant[]> = {
  // Trent 700: long nacelle; CF6-80E1 and PW4168: short fan cowl with the core showing (the alternative sprite).
  a332: [
    { id: 'trent', label: 'Trent 700', sprite: 'a332', engines: 'Rolls-Royce Trent 700', share: 0.45 },
    { id: 'cf6pw', label: 'CF6 / PW4000', sprite: 'a332-alt-engines', engines: 'GE CF6-80E1 or Pratt & Whitney PW4168', share: 0.55 },
  ],
  // PW4056 / CF6-80C2: short fan cowl, long exhaust cone; RB211-524G/H: the Rolls-Royce nacelle (the alternative sprite).
  b744: [
    { id: 'pwge', label: 'PW4056 / CF6', sprite: 'b744', engines: 'Pratt & Whitney PW4056 or GE CF6-80C2 (four)', share: 0.75 },
    { id: 'rr', label: 'RB211-524', sprite: 'b744-alt-engines', engines: 'Rolls-Royce RB211-524G/H (four)', share: 0.25 },
  ],
  // Airbus Cabin Flex (from 2018): door 2 replaced by two pairs of overwing exits, 244 seats under EASA; the first
  // A321neos kept the four door pairs of the A321ceo (230). Engines are not a sprite difference.
  a321neo: [
    { id: 'acf', label: 'Cabin Flex', sprite: 'a321neo', engines: 'CFM LEAP-1A or Pratt & Whitney PW1100G', maxSeats: 244, share: 0.65 },
    { id: 'classic', label: 'Four door pairs', sprite: 'a321neo-classic-doors', engines: 'CFM LEAP-1A or Pratt & Whitney PW1100G', maxSeats: 230, share: 0.35, years: [2017, 2019] },
  ],
};

export const variantsOf = (typeId: string): AirframeVariant[] => VARIANTS[typeId] ?? [];

export function variantOf(typeId: string, id: string | undefined): AirframeVariant | undefined {
  const vs = VARIANTS[typeId];
  return vs ? vs.find((v) => v.id === id) ?? vs[0] : undefined;
}

/** A variant for an airframe built in `builtYear` from a uniform draw u in [0, 1); undefined for types without variants. */
export function pickVariant(typeId: string, builtYear: number, u: number): string | undefined {
  const vs = (VARIANTS[typeId] ?? []).filter((v) => !v.years || (builtYear >= v.years[0] && builtYear <= v.years[1]));
  if (!vs.length) return VARIANTS[typeId]?.[0]?.id;
  const sum = vs.reduce((n, v) => n + v.share, 0);
  let x = u * sum;
  for (const v of vs) {
    if (x < v.share) return v.id;
    x -= v.share;
  }
  return vs[vs.length - 1].id;
}

/** Stable variant for an airframe without a market roll (start fleet, dev aircraft, older saves): hashed from the game seed and the aircraft id. */
export const airframeVariant = (seed: number, acId: string, typeId: string, builtYear: number): string | undefined =>
  VARIANTS[typeId] ? pickVariant(typeId, builtYear, hashUnit(`${seed}:variant:${acId}`)) : undefined;

/** Engines of an airframe in plain words. */
export const enginesOf = (typeId: string, variant?: string): string => variantOf(typeId, variant)?.engines ?? ENGINES[typeId] ?? '';
