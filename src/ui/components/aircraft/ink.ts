// Colour helpers for livery lettering (hex in, hex out; anything else passes through). Pure.

import type { Livery } from '../../../engine/core/types';

export const INK = '#16213a';

function rgb(c: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${((1 << 24) | (c[0] << 16) | (c[1] << 8) | c[2]).toString(16).slice(1)}`;
}

export function lum(c: string): number {
  const x = rgb(c);
  if (!x) return 0.5;
  const [r, g, b] = x.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a: string, b: string) => {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** Auto lettering colour on the fin: second colour when it reads against the fin, else white / ink. */
export function autoFinInk(lv: Livery): string {
  if (lv.plain) return autoBodyInk(lv);
  return contrast(lv.secondary, lv.primary) >= 2.2 ? lv.secondary : lum(lv.primary) < 0.4 ? '#ffffff' : INK;
}

/** Auto lettering colour on the white fuselage: primary unless it vanishes on white. */
export function autoBodyInk(lv: Livery): string {
  return contrast(lv.primary, '#ffffff') >= 1.6 ? lv.primary : contrast(lv.secondary, '#ffffff') >= 1.6 ? lv.secondary : INK;
}
