// v0.10.2 registering a new aircraft: the registry's prefix (the home base's country, src/data/countries.ts) is fixed;
// the player types the rest. Each registry's real format (length and characters after the prefix), a suggestion in
// that format, and the check that the registration is free (every aircraft in the game: our fleet, including those
// still on delivery, and the business jets chartered for our crews; rivals and market offers carry none).

import { AIRPORT_BY_CODE } from '../../data/airports';
import type { GameState } from '../core/types';
import { hash } from '../core/util';

const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const D = '0123456789';
/** FAA: no I or O (they read as 1 and 0). */
const FAA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A registry's format after the prefix: the check, the hint shown when it fails, and a maker for suggestions
 *  (`r` gives uniform numbers in [0, 1)). */
export interface RegFormat {
  re: RegExp;
  hint: string;
  /** Characters allowed in the input (it strips the rest as the player types). */
  chars: RegExp;
  max: number;
  make: (r: () => number) => string;
}

const ch = (r: () => number, s: string) => s[Math.floor(r() * s.length)];
const letters = (n: number, first = '') => (r: () => number) => first + Array.from({ length: n - first.length }, () => ch(r, L)).join('');
const digits = (n: number, first = '') => (r: () => number) => first + ch(r, '123456789') + Array.from({ length: n - first.length - 1 }, () => ch(r, D)).join('');
const ALPHA = /[A-Z]/;
const ALNUM = /[A-Z0-9]/;
const NUM = /[0-9]/;
const fmt = (re: RegExp, hint: string, max: number, make: RegFormat['make'], chars = ALPHA): RegFormat => ({ re, hint, max, make, chars });
const three = fmt(/^[A-Z]{3}$/, '3 letters', 3, letters(3));
const four = fmt(/^[A-Z]{4}$/, '4 letters', 4, letters(4));

/** The formats that differ from the ICAO norm (a two-character prefix + 3 letters, a one-letter prefix + 4). By the
 *  prefix as countries.ts writes it; the country code where several states share one ('B-'). */
const FORMATS: Record<string, RegFormat> = {
  // Portugal: airline aircraft in the CS-T series
  'CS-': fmt(/^T[A-Z]{2}$/, 'T + 2 letters', 3, letters(3, 'T')),
  // Germany: D-A for aircraft over 20 t
  'D-': fmt(/^A[A-Z]{3}$/, 'A + 3 letters (over 20 t)', 4, letters(4, 'A')),
  // Switzerland: HB-J for jets
  'HB-': fmt(/^J[A-Z]{2}$/, 'J + 2 letters (jets)', 3, letters(3, 'J')),
  // Canada: C-F or C-G series
  'C-': fmt(/^[FG][A-Z]{3}$/, 'F or G + 3 letters', 4, (r) => (r() < 0.5 ? 'F' : 'G') + letters(3)(r)),
  // French overseas: F-O + 3 letters
  'F-O': three,
  // Zimbabwe: Z-ABC
  'Z-': three,
  // United States (and its territories): N + 1–5 characters: a digit 1–9 first, digits, then up to 2 letters at the
  // end, no I or O
  N: fmt(/^(?=.{1,5}$)[1-9][0-9]{0,4}[A-HJ-NP-Z]{0,2}$/, '1–5 characters: digits (not starting 0), then up to 2 letters (no I or O)', 5,
    (r) => `${digits(3)(r)}${ch(r, FAA)}${ch(r, FAA)}`, ALNUM),
  // Japan: JA + 4 characters, digits first (JA801A, JA13AN, JA8089)
  JA: fmt(/^(?=.{4}$)[0-9]{2,4}[A-Z]{0,2}$/, '4 characters: 2–4 digits, then letters', 4, (r) => `${digits(3)(r)}${ch(r, L)}`, ALNUM),
  // South Korea: HL + 4 digits
  HL: fmt(/^[0-9]{4}$/, '4 digits', 4, (r) => `${ch(r, '78')}${digits(3)(r)}`, NUM),
  // Philippines: RP-C + 4 digits
  'RP-': fmt(/^C[0-9]{4}$/, 'C + 4 digits', 5, (r) => `C${digits(4)(r)}`, ALNUM),
  // Vietnam: VN-A + 3 digits
  'VN-': fmt(/^A[0-9]{3}$/, 'A + 3 digits', 4, (r) => `A${digits(3)(r)}`, ALNUM),
  // Dominican Republic, Venezuela: 3–4 digits
  HI: fmt(/^[0-9]{3,4}$/, '3–4 digits', 4, digits(4), NUM),
  YV: fmt(/^[0-9]{3,4}$/, '3–4 digits', 4, digits(4), NUM),
  // Cuba: CU-T + 4 digits
  'CU-': fmt(/^T[0-9]{4}$/, 'T + 4 digits', 5, (r) => `T${digits(4)(r)}`, ALNUM),
  // Colombia: HK- + 4 digits (an optional letter after)
  'HK-': fmt(/^[0-9]{4}[A-Z]?$/, '4 digits (a letter after)', 5, digits(4), ALNUM),
  // Peru, Bolivia: 4 digits
  'OB-': fmt(/^[0-9]{4}$/, '4 digits', 4, digits(4), NUM),
  'CP-': fmt(/^[0-9]{4}$/, '4 digits', 4, digits(4), NUM),
  // Panama: digits then the operator's letters (HP-1823CMP)
  'HP-': fmt(/^[0-9]{3,4}[A-Z]{2,3}$/, '3–4 digits + 2–3 letters', 7, (r) => `${digits(4)(r)}${letters(3)(r)}`, ALNUM),
  // Bahrain, Oman, Rwanda: 2 letters after the longer prefix
  'A9C-': fmt(/^[A-Z]{2}$/, '2 letters', 2, letters(2)),
  'A4O-': fmt(/^[A-Z]{2}$/, '2 letters', 2, letters(2)),
  '9XR-': fmt(/^[A-Z]{2}$/, '2 letters', 2, letters(2)),
  // Azerbaijan: 2 letters + 2 digits (4K-AZ81)
  '4K-': fmt(/^[A-Z]{2}[0-9]{2}$/, '2 letters + 2 digits', 4, (r) => `${letters(2)(r)}${ch(r, D)}${ch(r, D)}`, ALNUM),
  // Armenia: 5 digits
  'EK-': fmt(/^[0-9]{5}$/, '5 digits', 5, digits(5), NUM),
  // China: 4 characters, 2 digits first (B-1234, B-30EE); Hong Kong: B-H, B-K or B-L + 2 letters; Macau: B-M + 2
  // letters; Taiwan: 5 digits
  CN: fmt(/^[0-9]{2}[0-9A-Z]{2}$/, '4 characters, 2 digits first', 4, digits(4), ALNUM),
  HK: fmt(/^[HKL][A-Z]{2}$/, 'H, K or L + 2 letters', 3, (r) => ch(r, 'HKL') + letters(2)(r)),
  MO: fmt(/^M[A-Z]{2}$/, 'M + 2 letters', 3, letters(3, 'M')),
  TW: fmt(/^[0-9]{5}$/, '5 digits', 5, digits(5), NUM),
};

/** The format after `prefix` (`country` tells apart the states sharing 'B-'). */
export function regFormat(prefix: string, country?: string): RegFormat {
  if (prefix === 'B-') return FORMATS[country === 'HK' || country === 'MO' || country === 'TW' ? country : 'CN'];
  return FORMATS[prefix] ?? (prefix.replace(/-$/, '').length <= 1 ? four : three);
}

/** The registry state: the home base's country. */
export function regCountry(g: GameState): string {
  return AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';
}

/** Every registration in use in the game: our fleet (signed, delivering, leased out) and the jets chartered for our
 *  crews. */
export function regsInUse(g: GameState): Set<string> {
  const used = new Set(Object.values(g.fleet).map((a) => a.reg.toUpperCase()));
  for (const f of Object.values(g.flights)) if (f.charter?.reg) used.add(f.charter.reg.toUpperCase());
  return used;
}

/** The input as typed, tidied: upper case, the prefix dropped if pasted in, only the format's characters, its length. */
export function cleanRegInput(prefix: string, raw: string, country?: string): string {
  const f = regFormat(prefix, country);
  let s = raw.toUpperCase().replace(/\s+/g, '');
  if (s.startsWith(prefix)) s = s.slice(prefix.length);
  return [...s].filter((c) => f.chars.test(c)).join('').slice(0, f.max);
}

export type RegCheck = { ok: true; reg: string } | { ok: false; reason: string };

/** Checks the characters after the prefix: the registry's format, and free in the game. */
export function checkRegistration(g: GameState, suffix: string, opt: { prefix?: string; country?: string; except?: string } = {}): RegCheck {
  const prefix = opt.prefix ?? g.company.regPrefix;
  const s = suffix.trim().toUpperCase();
  if (!s) return { ok: false, reason: 'Enter the registration' };
  const f = regFormat(prefix, opt.country ?? regCountry(g));
  if (!f.re.test(s)) return { ok: false, reason: f.hint };
  const reg = prefix + s;
  if (reg !== opt.except && regsInUse(g).has(reg)) {
    const by = Object.values(g.fleet).find((a) => a.reg.toUpperCase() === reg);
    return { ok: false, reason: by ? `Already used by our ${reg}` : `${reg} is already registered` };
  }
  return { ok: true, reg };
}

/** A free registration in the registry's format for an offer, the same every time for that offer (the game's random
 *  sequence is not touched: opening the dialog changes nothing). */
export function suggestRegistration(g: GameState, key: string): string {
  const prefix = g.company.regPrefix;
  const f = regFormat(prefix, regCountry(g));
  const used = regsInUse(g);
  let h = hash(`${g.seed}|reg|${key}`) || 1;
  const r = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let k = 0; k < 500; k++) {
    const s = f.make(r);
    if (f.re.test(s) && !used.has(prefix + s)) return prefix + s;
  }
  return prefix + f.make(r);
}

/** An aircraft's name as stored: trimmed, inner spaces single, at most NAME_MAX characters; '' = none. */
export const NAME_MAX = 24;
export function cleanAircraftName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}
