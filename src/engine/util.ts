export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const START_YEAR = 2026;
const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(START_YEAR, 0, 1);

/** Day index (0 = 1 Jan 2026) → JS Date (UTC). */
export function dayToDate(day: number): Date {
  return new Date(EPOCH + Math.floor(day) * DAY_MS);
}

export function dateToDay(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS);
}

export function yearOf(day: number): number {
  return dayToDate(day).getUTCFullYear();
}

export function monthKey(day: number): number {
  const d = dayToDate(day);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function dayOfYear(day: number): number {
  const d = dayToDate(day);
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(day: number, withWeekday = false): string {
  const d = dayToDate(day);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withWeekday ? `${WEEKDAYS[d.getUTCDay()]} ${s}` : s;
}

export function monthLabel(key: number, short = true): string {
  const y = Math.floor(key / 12);
  const m = key % 12;
  return short ? `${MONTHS[m]} ’${String(y).slice(2)}` : `${MONTHS[m]} ${y}`;
}

/** Stable 32-bit string hash (FNV-1a). */
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random value in [0,1) from a string key. */
export function hashUnit(str: string): number {
  return hash(str) / 4294967296;
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
