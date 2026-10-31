// Game clock: integer minutes since EPOCH (UTC). Calendar helpers, formatting, airport local time
// and the real-time speed table. See DESIGN.md §3.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { dstRule, standardOffsetHours } from '../../data/timezones';
import type { Minute, MonthKey } from './types';

export const EPOCH_MS = Date.UTC(2000, 0, 1);
export const HOUR = 60;
export const DAY = 1440;
export const WEEK = 7 * DAY;

/** Real milliseconds per game day at each speed (1× = 60 s, 2× = 30 s, 4× = 15 s). */
export type GameSpeed = 1 | 2 | 4;
export const SPEEDS: GameSpeed[] = [1, 2, 4];
export const MS_PER_DAY: Record<GameSpeed, number> = { 1: 60_000, 2: 30_000, 4: 15_000 };
/** Game minutes advanced per real millisecond. */
export const minutesPerMs = (s: GameSpeed) => DAY / MS_PER_DAY[s];
/** Clock label granularity per speed (minutes) so the clock ticks calmly (≈3 Hz or slower). */
export const CLOCK_STEP: Record<GameSpeed, number> = { 1: 10, 2: 15, 4: 30 };

export function toDate(t: Minute): Date {
  return new Date(EPOCH_MS + Math.floor(t) * 60_000);
}

/** UTC calendar time → game minute (month 1–12). */
export function fromUTC(y: number, m: number, d: number, hh = 0, mm = 0): Minute {
  return Math.round((Date.UTC(y, m - 1, d, hh, mm) - EPOCH_MS) / 60_000);
}

/** Default scenario start: 1 Mar 2027 00:00 UTC. */
export const START: Minute = fromUTC(2027, 3, 1);

export const dayIndex = (t: Minute) => Math.floor(t / DAY);
export const dayStart = (t: Minute): Minute => Math.floor(t / DAY) * DAY;
export const nextDayStart = (t: Minute): Minute => dayStart(t) + DAY;
export const minuteOfDay = (t: Minute) => ((Math.floor(t) % DAY) + DAY) % DAY;

export function monthKey(t: Minute): MonthKey {
  const d = toDate(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function monthStart(k: MonthKey): Minute {
  return fromUTC(Math.floor(k / 12), (k % 12) + 1, 1);
}

export function nextMonthStart(t: Minute): Minute {
  return monthStart(monthKey(t) + 1);
}

export function daysInMonth(k: MonthKey): number {
  return (monthStart(k + 1) - monthStart(k)) / DAY;
}

export function yearOf(t: Minute): number {
  return toDate(t).getUTCFullYear();
}

// ---------- local time ----------

const dstCache = new Map<string, [Minute, Minute]>();

/** Last Sunday of a month (1–12) at hh UTC. */
function lastSunday(y: number, m: number, hh: number): Minute {
  const last = new Date(Date.UTC(y, m, 0));
  return fromUTC(y, m, last.getUTCDate() - last.getUTCDay(), hh);
}

/** n-th Sunday of a month (1–12) at hh UTC. */
function nthSunday(y: number, m: number, n: number, hh: number): Minute {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return fromUTC(y, m, 1 + ((7 - first) % 7) + 7 * (n - 1), hh);
}

/** v0.12.1 last given weekday (0 = Sunday) of a month (1–12) at hh UTC. */
function lastWeekday(y: number, m: number, wd: number, hh: number): Minute {
  const last = new Date(Date.UTC(y, m, 0));
  return fromUTC(y, m, last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7), hh);
}

function dstWindow(rule: 'eu' | 'us' | 'eg', y: number): [Minute, Minute] {
  const key = `${rule}${y}`;
  let w = dstCache.get(key);
  if (!w) {
    // Egypt: from 00:00 local on the last Friday of April (22:00 UTC the evening before) to 24:00 local summer time on
    // the last Thursday of October (21:00 UTC).
    w = rule === 'eu' ? [lastSunday(y, 3, 1), lastSunday(y, 10, 1)]
      : rule === 'eg' ? [lastWeekday(y, 4, 5, 0) - 120, lastWeekday(y, 10, 4, 21)]
      : [nthSunday(y, 3, 2, 7), nthSunday(y, 11, 1, 6)];
    dstCache.set(key, w);
  }
  return w;
}

/** UTC offset of an airport at time t, in minutes (standard time + northern DST). */
export function localOffset(code: string, t: Minute): number {
  const a = AIRPORT_BY_CODE[code];
  if (!a) return 0;
  const std = standardOffsetHours(code, a.country, a.lon) * 60;
  const rule = dstRule(code, a.country, a.lon);
  if (!rule) return std;
  const [s, e] = dstWindow(rule, yearOf(t));
  return t >= s && t < e ? std + 60 : std;
}

/** Local wall-clock minute (still on the game-minute axis) at an airport. */
export const toLocal = (code: string, t: Minute): Minute => t + localOffset(code, t);
/** Minutes after local midnight at an airport. */
export const localMinuteOfDay = (code: string, t: Minute) => minuteOfDay(toLocal(code, t));

// ---------- formatting ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const p2 = (n: number) => String(n).padStart(2, '0');

/** '1 Mar 2027' or 'Mon 1 Mar 2027'. */
export function fmtDate(t: Minute, weekday = false): string {
  const d = toDate(t);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return weekday ? `${WEEKDAYS[d.getUTCDay()]} ${s}` : s;
}

/** '1 Mar' */
export function fmtDay(t: Minute): string {
  const d = toDate(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** v0.11 '4 Nov–7 Nov', or just '4 Nov' when both ends fall on the same day. */
export function fmtDayRange(a: Minute, b: Minute): string {
  const x = fmtDay(a), y = fmtDay(b);
  return x === y ? x : `${x}–${y}`;
}

/** '1 Mar' / '1 Mar 2027' on the local calendar at an airport (home-base dates in messages: classes, leave dates). */
export const fmtDayAt = (code: string, t: Minute): string => fmtDay(toLocal(code, t));
export const fmtDateAt = (code: string, t: Minute): string => fmtDate(toLocal(code, t));

/** '14:05' (UTC unless an airport is given). */
export function fmtTime(t: Minute, airport?: string): string {
  const m = airport ? localMinuteOfDay(airport, t) : minuteOfDay(t);
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/** v0.12.1 'Fri 07:20' (UTC): a time in the next few days, short enough for a chip. */
export function fmtWeekdayTime(t: Minute): string {
  return `${WEEKDAYS[toDate(t).getUTCDay()]} ${fmtTime(t)}`;
}

/**
 * v0.12.1 a date far off or in another year carries the year ('28 Nov 2028'); one within the coming months reads
 * '28 Nov' as before (an early-return notice for next year's November read like this November).
 */
export function fmtDayRel(t: Minute, now: Minute): string {
  return yearOf(t) !== yearOf(now) || Math.abs(t - now) > 300 * DAY ? fmtDate(t) : fmtDay(t);
}

/** '1 Mar 14:05' */
export function fmtDateTime(t: Minute): string {
  return `${fmtDay(t)} ${fmtTime(t)}`;
}

/** Duration as '2h 35m' (or 'h:mm' with clock = true). */
export function fmtDuration(min: number, clock = false): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  if (clock) return `${h}:${p2(m % 60)}`;
  return h ? `${h}h ${p2(m % 60)}m` : `${m % 60}m`;
}

export function fmtMonth(k: MonthKey, short = true): string {
  const y = Math.floor(k / 12);
  return short ? `${MONTHS[k % 12]} ’${String(y).slice(2)}` : `${MONTHS[k % 12]} ${y}`;
}
