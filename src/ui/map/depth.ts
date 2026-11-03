// v0.15 Depth: subtle 3D touches that stay 2D (CSS transforms, canvas sprites; no WebGL). Pure parts:
//  - the map's gentle perspective tilt at close zoom, its forward and inverse projection (taps and pans are hit-tested
//    on the untilted map, so they land exactly where the finger is on the tilted one), and how far the tilted plane
//    shows past the map's edges;
//  - the soft shadow each of our aircraft casts on the map, offset and softened with its altitude;
//  - the hangar line-up's depth (rows further back a touch smaller and fainter).

// ---------- tilt ----------

/** v0.15 the tilt at its fullest (degrees): a gentle lean, the far edge of the map a few per cent smaller. */
export const TILT_MAX_DEG = 10;
/** Map zoom (k, 1 = the whole world) where the tilt starts, and where it is full: the closest zoom levels only. */
export const TILT_K0 = 6;
export const TILT_K1 = 11;
/** Perspective distance as a multiple of the map's height (the same look on an iPhone and an iPad). */
export const TILT_PERSP = 2.4;

/** v0.15 the tilt (degrees) at map zoom k: none below TILT_K0, easing in (smoothstep) to TILT_MAX_DEG at TILT_K1. Pure. */
export function tiltDeg(k: number, max = TILT_MAX_DEG): number {
  if (!(k > TILT_K0) || max <= 0) return 0;
  const x = Math.min(1, (k - TILT_K0) / (TILT_K1 - TILT_K0));
  return max * x * x * (3 - 2 * x);
}

/** The CSS transform of the tilted layer (its origin: the middle of the bottom edge). '' when flat. */
export function tiltCss(deg: number, h: number): string {
  return deg > 0.01 ? `perspective(${Math.round(h * TILT_PERSP)}px) rotateX(${deg.toFixed(3)}deg)` : '';
}

const RAD = Math.PI / 180;

/**
 * Where a point of the map layer (px from its top left, w × h box) shows on screen once tilted by `deg` about its
 * bottom edge (CSS `perspective(P) rotateX(deg)`, origin 50% 100%). Pure.
 */
export function tiltProject(x: number, y: number, w: number, h: number, deg: number): [number, number] {
  if (!(deg > 0) || !(h > 0)) return [x, y];
  const P = h * TILT_PERSP;
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const X = x - w / 2;
  const Y = y - h;
  const D = 1 - (Y * s) / P;
  return [w / 2 + X / D, h + (Y * c) / D];
}

/** The inverse of tiltProject: the map-layer point under a screen point (px from the box's top left). Pure. */
export function untilt(x: number, y: number, w: number, h: number, deg: number): [number, number] {
  if (!(deg > 0) || !(h > 0)) return [x, y];
  const P = h * TILT_PERSP;
  const c = Math.cos(deg * RAD);
  const s = Math.sin(deg * RAD);
  const sy = y - h;
  const Y = sy / (c + (sy * s) / P);
  const D = 1 - (Y * s) / P;
  return [w / 2 + (x - w / 2) * D, h + Y];
}

/**
 * How far past its top edge (ey) and each side (ex) the map layer shows once tilted by `deg` (px of the layer): the
 * far edge recedes, so the layer must reach a little beyond the box to fill the screen to the corners. Pure.
 */
export function tiltBleed(w: number, h: number, deg: number): { ex: number; ey: number } {
  if (!(deg > 0) || !(h > 0)) return { ex: 0, ey: 0 };
  const top = untilt(0, 0, w, h, deg);
  return { ex: Math.ceil(Math.max(0, -top[0])), ey: Math.ceil(Math.max(0, -top[1])) };
}

// ---------- aircraft shadows ----------

/**
 * v0.15 one fixed light, high in the north-west (the usual light of a drawn map and of the game's own drop shadows):
 * every shadow falls the same way, down and a little to the right, so its distance from the aircraft reads as height
 * at a glance. (Shadows from the real sun would scatter in every direction, stretch at dawn and vanish on the night
 * side of the map, where half the fleet usually is.) Unit vector, screen px.
 */
export const SHADE_DIR: [number, number] = [0.5, Math.sqrt(3) / 2];
/** Pre-rendered softness steps per type (0 = on the ground: crisp; the last: in cruise). */
export const SHADE_LEVELS = 6;
/** Altitude (ft) at which a shadow is as far and soft as it gets. */
export const SHADE_TOP_FT = 38_000;

/** Height share 0–1 for an altitude: eased so the first few thousand feet already lift the shadow clear. Pure. */
export function shadeLift(altFt: number): number {
  const a = Math.max(0, Math.min(1, altFt / SHADE_TOP_FT));
  return a ** 0.6;
}

/**
 * The shadow of an aircraft at `altFt`, its glyph scaled by z (the map's icon scale): offset (screen px, along
 * SHADE_DIR) and which softness step to draw. On the ground it sits a pixel or two off, crisp; in cruise about ten pixels
 * away, soft. Pure.
 */
export function shadeOf(altFt: number, z = 1): { dx: number; dy: number; level: number } {
  const f = shadeLift(altFt);
  const d = (1.5 + 8.5 * f) * Math.max(0.5, z);
  return { dx: d * SHADE_DIR[0], dy: d * SHADE_DIR[1], level: Math.round(f * (SHADE_LEVELS - 1)) };
}

/** A softness step's blur (px, as built) and density (0–1): crisp and dense on the ground, soft and light up high. Pure. */
export function shadeLevel(i: number): { blur: number; alpha: number } {
  const f = Math.max(0, Math.min(1, i / (SHADE_LEVELS - 1)));
  return { blur: 0.4 + 1.6 * f, alpha: 0.9 - 0.3 * f };
}

/**
 * A plausible altitude (ft) for a leg known only by its progress 0–1 (the cosmetic legs a dry-leased aircraft flies
 * for its lessee): climb over the first 15 %, descend over the last 18 %. Pure.
 */
export function altByProgress(p: number, top = 36_000): number {
  if (!(p > 0) || p >= 1) return 0;
  if (p < 0.15) return top * (1 - (1 - p / 0.15) ** 1.7);
  if (p > 0.82) return top * ((1 - p) / 0.18) ** 1.15;
  return top;
}

// ---------- hangar ----------

/**
 * v0.15 the hangar's side view stands its rows on one floor: the top row furthest back. A row `back` steps behind the
 * front one is drawn a touch smaller and fainter (at most two steps: 4 % smaller), so the line-up gains depth while
 * every aircraft in a row keeps the same true scale. Pure.
 */
export function hangarDepth(back: number): { scale: number; fade: number } {
  const d = Math.max(0, Math.min(2, Math.round(back)));
  return { scale: 1 - 0.02 * d, fade: 1 - 0.07 * d };
}
