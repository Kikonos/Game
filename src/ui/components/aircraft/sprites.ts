// v0.10 aircraft sprites: the player's final raster art (public/aircraft/, made by scripts/sprites.py) and the
// layout data measured from it (sprites.gen.ts). Coordinates are pixels of the 2048-wide asset: x right, y down,
// nose RIGHT — the viewBox of AircraftArt.

import { ACMI_TYPES } from '../../../data/acmiTypes';
import { SPRITE_DATA } from './sprites.gen';

export type Pt = [number, number];

export interface SpriteLayout {
  /** Asset size (2048 wide). */
  w: number;
  h: number;
  /** Nose tip and tail-cone end x. */
  nose: number;
  tail: number;
  /** Crown line over the main cabin and the belly line ahead of the wing (y). */
  crown: number;
  belly: number;
  /** Fin + rudder outline (the mask's red area). */
  fin: Pt[];
  /** Fin frame: root leading edge, root trailing edge, tip leading edge, tip trailing edge. */
  finQuad: [Pt, Pt, Pt, Pt];
  /** Fuselage area stickers may use: crown to belly, above the windows over the wing, clear of the engines. */
  zone: Pt[];
  /** Window line used for the titles (top, bottom y), if found. */
  win: [number, number] | null;
  /** Wing / engine x range. */
  wing: [number, number] | null;
  /** Title band: start (px behind the nose), centre y, length, letter size. */
  titles: { x: number; y: number; w: number; size: number };
  silArea: number;
  /**
   * v0.10 the fuselage tube (scripts/sprites.py geometry): crown and belly y every `step` px from x0 (the tail end)
   * to the nose; under the fin and the wing they are the straight lines the body mask uses. -1 = no fuselage there.
   */
  body: { x0: number; step: number; crown: number[]; belly: number[] };
  /** v0.11 engines drawn on the near side: cowl trailing edge x, intake lip front x, lip width (px). */
  eng?: [number, number, number][];
  /** v0.11 lit white (linear luminance) of the fin, body and cowl regions; with <id>-shade.webp the painting model's light. */
  white?: [number, number, number];
}

/** Generated entry: the layout, or another sprite with byte-identical art. */
export type SpriteData = SpriteLayout | { same: string };

/** Real length (m) of each drawn aircraft, for same-scale comparisons. */
export const LENGTH_M: Record<string, number> = {
  a320ceo: 37.57, a321ceo: 44.51, a321neo: 44.51, 'a321neo-classic-doors': 44.51,
  a332: 58.82, 'a332-alt-engines': 58.82, a333: 63.67, a339: 63.66,
  a342: 59.4, a343: 63.69, a345: 67.93, a346: 75.36,
  a359: 66.8, a359ulr: 66.8, a35k: 73.79, a388: 72.72,
  b738: 39.47, b739: 42.11, b741: 70.66, b742: 70.66, b743: 70.66, b744: 70.66, 'b744-alt-engines': 70.66, b748: 76.25,
  b752: 47.32, b753: 54.43, b763: 54.94,
  b772: 63.73, b778: 70.86, b779: 76.72, b77w: 73.86,
  b788: 56.72, b789: 62.81, b78x: 68.28,
};

/**
 * v0.10 body paint: the masks carry a fuselage channel (G, made by scripts/sprites.py from the art), so the editor
 * offers body, belly, stripes, nose and engine colours. False puts the v0.10 'tail and engines only' editor back.
 */
export const BODY_PAINT = true;

export const SPRITE_IDS = Object.keys(SPRITE_DATA);

/** Sprite whose files a sprite id uses (identical art shares one set). */
export function fileOf(id: string): string {
  const d = SPRITE_DATA[id];
  return d && 'same' in d ? d.same : id;
}

/** Sprite for a sprite id, an ACMI type id or a catalog id; falls back to the A320. */
export function spriteOf(id: string): string {
  if (SPRITE_DATA[id]) return id;
  const art = ACMI_TYPES[id]?.art;
  return art && SPRITE_DATA[art] ? art : 'a320ceo';
}

export const hasSprite = (id: string): boolean => !!SPRITE_DATA[id] || !!(ACMI_TYPES[id]?.art && SPRITE_DATA[ACMI_TYPES[id].art]);

/** Layout of a sprite (or type) id. */
export function layoutOf(id: string): SpriteLayout {
  return SPRITE_DATA[fileOf(spriteOf(id))] as SpriteLayout;
}

/** Asset widths: cards and rows use the 1024, big views the 2048. */
export const ASSET_WIDTHS = [1024, 2048] as const;
export type AssetWidth = (typeof ASSET_WIDTHS)[number];

/** Relative URLs (the app is served from ./ and the PWA caches public/aircraft). */
export const spriteUrl = (id: string, w: AssetWidth): string => `aircraft/${fileOf(spriteOf(id))}-${w}.webp`;
/** v0.11 paint regions: R = fin, G = fuselage, B = engine cowls (scripts/sprites.py); 2048 wide like the big asset. */
export const maskUrl = (id: string): string => `aircraft/${fileOf(spriteOf(id))}-mask.png`;

/** v0.11 the painting model's light (1024 wide grey; scripts/sprites.py shading_field). */
export const shadeUrl = (id: string): string => `aircraft/${fileOf(spriteOf(id))}-shade.webp`;

/** Asset width for a drawn size in device pixels. */
export const assetFor = (devicePx: number): AssetWidth => (devicePx > 1100 ? 2048 : 1024);

/** Drawn length in px of the aircraft (nose to tail) per px of the asset. */
export function metresPerPx(id: string): number {
  const s = spriteOf(id), d = layoutOf(s);
  return (LENGTH_M[s] ?? 40) / Math.max(1, d.nose - d.tail);
}
