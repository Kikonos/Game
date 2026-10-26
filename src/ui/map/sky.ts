// v0.12 Visual A: day and night on the map. The night side is a soft raster (one world wide, the sun on the 0°
// meridian) built from the sun's real elevation: full daylight above +0.8°, darkening through civil and nautical
// twilight to full night at −14°. On the Mercator map x is linear in longitude, so as the sun moves west the same
// raster only slides sideways (a compositor shift); it is rebuilt only when the declination drifts or the theme changes.
// City lights: every airport glows softly once its sun is well below the horizon. Pure maths here (the canvas fill
// takes any RGBA buffer) so it can be tested.

const RAD = Math.PI / 180;

/** Sun elevations (deg) where the night shade starts and where it is full. */
export const NIGHT_FROM = 0.8;
export const NIGHT_FULL = -14;
/** City lights fade in between these elevations (after sunset, by the end of civil twilight). */
export const LIGHTS_FROM = -2;
export const LIGHTS_FULL = -9;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Night shade 0 (day) … 1 (full night) at a sun elevation (deg): a soft twilight band, never a hard edge. */
export function nightAlpha(elev: number): number {
  return smooth(clamp01((NIGHT_FROM - elev) / (NIGHT_FROM - NIGHT_FULL)));
}

/** City-light strength 0 … 1 at a sun elevation (deg). */
export function lightAlpha(elev: number): number {
  return smooth(clamp01((LIGHTS_FROM - elev) / (LIGHTS_FROM - LIGHTS_FULL)));
}

/** Same thing on sin(elevation) (no asin per pixel): the band is narrow enough for sin to be all but linear. */
const S_FROM = Math.sin(NIGHT_FROM * RAD);
const S_FULL = Math.sin(NIGHT_FULL * RAD);

/**
 * Fills `out` (RGBA, w × h) with the night for a sun at longitude 0 and declination `dec`: column i is longitude
 * −180 + (i + ½)·360/w, row j is latitude latOf(j). Colour rgb, alpha up to maxA (0–1).
 */
export function fillNight(out: Uint8ClampedArray, w: number, h: number, dec: number, latOf: (j: number) => number, rgb: [number, number, number], maxA: number): void {
  const sd = Math.sin(dec * RAD);
  const cd = Math.cos(dec * RAD);
  const cosL = new Float32Array(w);
  for (let i = 0; i < w; i++) cosL[i] = Math.cos((-180 + ((i + 0.5) * 360) / w) * RAD);
  const span = S_FROM - S_FULL;
  for (let j = 0; j < h; j++) {
    const lat = latOf(j) * RAD;
    const a = Math.sin(lat) * sd;
    const b = Math.cos(lat) * cd;
    let p = j * w * 4;
    for (let i = 0; i < w; i++) {
      const s = a + b * cosL[i];
      const t = smooth(clamp01((S_FROM - s) / span));
      out[p] = rgb[0];
      out[p + 1] = rgb[1];
      out[p + 2] = rgb[2];
      out[p + 3] = Math.round(t * maxA * 255);
      p += 4;
    }
  }
}

/** Latitude (deg) of a map y on the game's Mercator (mapData.projection: scale MAP_W / 2π, y of the equator 774). */
export function mercLat(y: number, mapW: number, y0 = 774): number {
  const r = mapW / (2 * Math.PI);
  return (2 * Math.atan(Math.exp((y0 - y) / r)) - Math.PI / 2) / RAD;
}

/** '#rrggbb' or 'r, g, b' (a CSS custom property's text) → rgb; falls back to `dflt`. */
export function parseRgb(s: string, dflt: [number, number, number]): [number, number, number] {
  const t = s.trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  const m = t.split(/[ ,]+/).map(Number);
  return m.length >= 3 && m.slice(0, 3).every((x) => Number.isFinite(x)) ? [m[0], m[1], m[2]] : dflt;
}
