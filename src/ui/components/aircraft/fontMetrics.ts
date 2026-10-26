// Space Grotesk Variable advances (em) for the livery lettering, measured in
// Chromium from the bundled latin woff2 (canvas measureText at 1000px). Static so
// sticker layout is pure and needs no DOM; unknown glyphs fall back to 0.62 em.

export type FontWeight = 500 | 700;

const ADV: Record<FontWeight, Record<string, number>> = {
  500: {
    A: 0.632, B: 0.663, C: 0.643, D: 0.665, E: 0.559, F: 0.537, G: 0.661, H: 0.656, I: 0.254, J: 0.602, K: 0.618, L: 0.544, M: 0.874,
    N: 0.667, O: 0.673, P: 0.603, Q: 0.673, R: 0.632, S: 0.609, T: 0.588, U: 0.669, V: 0.619, W: 0.887, X: 0.641, Y: 0.617, Z: 0.577,
    0: 0.645, 1: 0.435, 2: 0.598, 3: 0.606, 4: 0.63, 5: 0.599, 6: 0.615, 7: 0.559, 8: 0.611, 9: 0.615,
    ' ': 0.255, '&': 0.598, '-': 0.443, '.': 0.276, "'": 0.273, '/': 0.379,
  },
  700: {
    A: 0.634, B: 0.664, C: 0.644, D: 0.666, E: 0.554, F: 0.534, G: 0.662, H: 0.656, I: 0.264, J: 0.61, K: 0.626, L: 0.542, M: 0.882,
    N: 0.67, O: 0.676, P: 0.604, Q: 0.676, R: 0.632, S: 0.606, T: 0.588, U: 0.672, V: 0.618, W: 0.898, X: 0.644, Y: 0.624, Z: 0.576,
    0: 0.648, 1: 0.452, 2: 0.594, 3: 0.608, 4: 0.636, 5: 0.6, 6: 0.618, 7: 0.554, 8: 0.6, 9: 0.618,
    ' ': 0.254, '&': 0.591, '-': 0.432, '.': 0.298, "'": 0.294, '/': 0.388,
  },
};

export const FALLBACK_ADV = 0.62;
/** Ink above the baseline of capitals and figures (round overshoot included). */
export const CAP_ASC = 0.72;
/** Ink below the baseline: Q's tail, else round overshoot. */
const DESC_Q = 0.19, DESC = 0.02;

export const FONT_STACK = "var(--font-display, 'Space Grotesk Variable', sans-serif)";
/** The same font for canvas text (no CSS variables there). */
export const FONT_FAMILY = "'Space Grotesk Variable', 'Space Grotesk', sans-serif";

/** Advance width of `text` in em, letter-spacing (em) added after every glyph as browsers do. */
export function textWidthEm(text: string, weight: FontWeight = 700, spacing = 0): number {
  const t = ADV[weight] ?? ADV[700];
  let w = 0;
  for (const ch of text) w += (t[ch.toUpperCase()] ?? FALLBACK_ADV) + spacing;
  return w;
}

/** Ink box of upper-case `text` in em: ascent above and descent below the baseline. */
export function textInkEm(text: string): { asc: number; desc: number } {
  return { asc: CAP_ASC, desc: /Q/i.test(text) ? DESC_Q : DESC };
}
