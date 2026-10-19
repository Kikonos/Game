// Seeded PRNG (mulberry32). The state lives in the game save, so a loaded
// game continues with exactly the same random sequence.

export interface RngHolder {
  rng: number;
}

export function next(h: RngHolder): number {
  h.rng = (h.rng + 0x6d2b79f5) | 0;
  let t = h.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function range(h: RngHolder, lo: number, hi: number): number {
  return lo + (hi - lo) * next(h);
}

export function int(h: RngHolder, lo: number, hi: number): number {
  return Math.floor(range(h, lo, hi + 1));
}

export function chance(h: RngHolder, p: number): boolean {
  return next(h) < p;
}

export function pick<T>(h: RngHolder, xs: readonly T[]): T {
  return xs[Math.floor(next(h) * xs.length)];
}

export function gaussian(h: RngHolder): number {
  const u = Math.max(1e-9, next(h));
  const v = next(h);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function weightedPick<T>(h: RngHolder, xs: readonly T[], weight: (x: T) => number): T | undefined {
  const total = xs.reduce((s, x) => s + Math.max(0, weight(x)), 0);
  if (total <= 0) return undefined;
  let r = next(h) * total;
  for (const x of xs) {
    r -= Math.max(0, weight(x));
    if (r <= 0) return x;
  }
  return xs[xs.length - 1];
}
