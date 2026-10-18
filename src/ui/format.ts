import { store } from './store';

export function money(v: number, digits = 1): string {
  const sign = v < 0 ? '−' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits + 1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}

/** Signed money with explicit plus. */
export function moneyDelta(v: number, digits = 1): string {
  return v > 0 ? `+${money(v, digits)}` : money(v, digits);
}

export function fare(v: number): string {
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function int(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

export function pct(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function dist(km: number): string {
  if (store.settings.units === 'mi') return `${int(km * 0.621371)} mi`;
  return `${int(km)} km`;
}

export function hours(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${int(n)} ${n === 1 ? word : pluralWord}`;
}
