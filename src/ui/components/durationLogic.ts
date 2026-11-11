// v0.20.1 how long a job runs, at a glance (the player has time blindness: "I'd like to know how many days/months the
// contract would be ... If it crosses over to another year, it has to be displayed"). The view behind
// components/DurationStrip.tsx: a row of month cells from the current game month (twelve at least), the job's days
// filled in, a tick for today, every year named at its first month, and one plain line with the length in days and in
// months and the dates. Pure.

import { DAY, dayIndex, daysInMonth, minuteOfDay, monthKey, monthStart, toDate } from '../../engine/core/time';
import type { Minute, MonthKey } from '../../engine/core/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Days in an average month (365.25 / 12). */
const MONTH_DAYS = 30.4375;

export interface DurationCell {
  key: MonthKey;
  /** 'J', 'F', 'M' … */
  initial: string;
  /** The part of the month the job covers (0–1 from the month's first day); from === to: none. */
  from: number;
  to: number;
}

export interface DurationView {
  /** The cells, grouped by year (each group is labelled with its year). */
  years: { year: number; cells: DurationCell[] }[];
  /** How many month cells in all (12–maxCells). */
  count: number;
  /** Where today is in the first cell (0–1). */
  today: number;
  /** Months of the job after the last cell; 0 when it all fits. `moreText`: '+7 months, to Mar 2032' (the end year named). */
  more: number;
  moreText: string | null;
  /** Calendar days, first to last, both counted. */
  days: number;
  /** '67 days', '14 months (1 year 2 months)' … the parts of the line, and the line itself. */
  daysText: string;
  monthsText: string | null;
  datesText: string;
  text: string;
  /** The same in a sentence, for screen readers. */
  aria: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** '3–14 Mar', '21 Mar – 26 May', '21 Nov 2029 – 26 Jan 2030' (the year named whenever it is not this year's). Pure. */
export function spanDates(now: Minute, first: Minute, last: Minute): string {
  const a = toDate(first), b = toDate(last);
  const ya = a.getUTCFullYear(), yb = b.getUTCFullYear(), yn = toDate(now).getUTCFullYear();
  const da = `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`, db = `${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`;
  if (ya !== yb) return `${da} ${ya} – ${db} ${yb}`;
  const y = ya !== yn ? ` ${ya}` : '';
  if (dayIndex(first) === dayIndex(last)) return `${da}${y}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${a.getUTCDate()}–${db}${y}`;
  return `${da} – ${db}${y}`;
}

/** Whole calendar months from the first day to the day after the last ('1 Jun – 31 Aug' is 3), else null. Pure. */
function wholeMonths(first: Minute, last: Minute): number | null {
  const a = toDate(first), b = toDate(last + DAY);
  if (a.getUTCDate() !== b.getUTCDate()) return null;
  const n = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  return n > 0 ? n : null;
}

/** The length in words: ['12 days', null], ['67 days', 'about 2 months'], ['425 days', '14 months (1 year 2 months)']. Pure. */
export function spanLength(first: Minute, last: Minute): { days: number; daysText: string; monthsText: string | null } {
  const days = Math.max(1, dayIndex(last) - dayIndex(first) + 1);
  const daysText = plural(days, 'day');
  const exact = wholeMonths(first, last);
  // Under two months the days say it (a whole calendar month or two is still named: '31 days · 1 month').
  if (days < 60 && !exact) return { days, daysText, monthsText: null };
  const months = exact ?? Math.max(2, Math.round(days / MONTH_DAYS));
  if (months < 12) return { days, daysText, monthsText: `${exact ? '' : 'about '}${plural(months, 'month')}` };
  const y = Math.floor(months / 12), m = months % 12;
  return { days, daysText, monthsText: `${plural(months, 'month')} (${plural(y, 'year')}${m ? ` ${plural(m, 'month')}` : ''})` };
}

/**
 * The strip for a job from `first` to `last` (any minute of its first and of its last day, on the calendar it is read
 * in), seen from `now`. Twelve month cells at least, more when the job runs on, `maxCells` (three years) at most. Pure.
 */
export function durationView(now: Minute, first: Minute, last: Minute, maxCells = 36): DurationView {
  const end = Math.max(first, last);
  const k0 = monthKey(now);
  const kEnd = monthKey(end);
  const count = Math.min(maxCells, Math.max(12, kEnd - k0 + 1));
  const d0 = dayIndex(first), d1 = dayIndex(end) + 1;
  const years: DurationView['years'] = [];
  for (let i = 0; i < count; i++) {
    const key = k0 + i;
    const ms = dayIndex(monthStart(key)), dim = daysInMonth(key);
    const from = Math.min(1, Math.max(0, (d0 - ms) / dim)), to = Math.min(1, Math.max(0, (d1 - ms) / dim));
    const year = Math.floor(key / 12);
    const cell: DurationCell = { key, initial: MONTHS[key % 12][0], from, to: Math.max(from, to) };
    const group = years[years.length - 1];
    if (group && group.year === year) group.cells.push(cell);
    else years.push({ year, cells: [cell] });
  }
  const today = Math.min(1, Math.max(0, (dayIndex(now) + minuteOfDay(now) / DAY - dayIndex(monthStart(k0))) / daysInMonth(k0)));
  const { days, daysText, monthsText } = spanLength(first, end);
  const datesText = spanDates(now, first, end);
  const text = [daysText, monthsText, datesText].filter(Boolean).join(' · ');
  const more = Math.max(0, kEnd - (k0 + count - 1));
  const y0 = toDate(first).getUTCFullYear(), y1 = toDate(end).getUTCFullYear();
  const aria = `Runs ${daysText}${monthsText ? `, ${monthsText}` : ''}: ${datesText.replace(' – ', ' to ').replace('–', ' to ')}${y0 !== y1 ? `, from ${y0} into ${y1}` : ''}.`;
  const moreText = more ? `+${plural(more, 'month')}, to ${MONTHS[kEnd % 12]} ${Math.floor(kEnd / 12)}` : null;
  return { years, count, today, more, moreText, days, daysText, monthsText, datesText, text, aria };
}
