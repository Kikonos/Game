// v0.24 the "booked" figure (the player: "a discreet 'booked' statistic per aircraft and in general over several
// periods of time"): sold flying (contract, charter and route legs; never ferries, positioning or deadheads) as a share
// of the hours the aircraft was ours, looking back (what was flown) and ahead (what is on the books).
//
// Looking back reads the aircraft's own record (bookDays: sold block minutes per UTC day, kept for 400 days, written as
// each leg lands); flights themselves are pruned a week after their day. Looking ahead reads the flights planned and,
// for a base programme, the rotations not generated yet (its schedule is filed four weeks ahead).

import { flownRotations } from '../contracts/plan';
import { DAY, fromUTC, toDate } from '../core/time';
import type { Aircraft, Flight, GameState, Minute } from '../core/types';

/** Days of sold flying an aircraft keeps (a year to date and some). */
export const BOOK_KEEP_DAYS = 400;

/** A leg we were paid to fly (a revenue leg or a fuel stop on one). */
export const isSoldLeg = (f: Pick<Flight, 'kind'>): boolean => f.kind === 'revenue' || f.kind === 'techstop';

/** A sold leg landed: its block minutes on the day it landed (ops/flights.ts onArrive). */
export function noteBooked(ac: Aircraft, f: Flight, blockMin: number, now: Minute): void {
  if (!isSoldLeg(f) || blockMin <= 0) return;
  const day = Math.floor(now / DAY);
  const bd = (ac.bookDays ??= []);
  if (bd.length && bd[bd.length - 1][0] === day) bd[bd.length - 1][1] += Math.round(blockMin);
  else bd.push([day, Math.round(blockMin)]);
  while (bd.length && bd[0][0] <= day - BOOK_KEEP_DAYS) bd.shift();
}

/**
 * Load (once) and new game: an aircraft without the record gets one from the sold legs still in the save (the last week),
 * and counts from the earliest day those cover (today when there are none).
 */
export function loadBooked(g: GameState): void {
  // Once only: an aircraft that joins later starts its record at its first sold leg and counts from its arrival.
  const v024 = (g.stats.v024 ??= {});
  if (v024.booked) return;
  v024.booked = true;
  const today = Math.floor(g.now / DAY);
  const fresh = Object.values(g.fleet).filter((ac) => ac.bookDays === undefined);
  if (!fresh.length) return;
  const by = new Map<string, Map<number, number>>();
  let first = today;
  for (const f of Object.values(g.flights)) {
    if (!f.aircraftId || f.status !== 'done' || !isSoldLeg(f)) continue;
    const ac = g.fleet[f.aircraftId];
    if (!ac || ac.bookDays !== undefined) continue;
    const on = f.ata ?? f.sta;
    const day = Math.floor(on / DAY);
    const m = by.get(ac.id) ?? by.set(ac.id, new Map()).get(ac.id)!;
    m.set(day, (m.get(day) ?? 0) + Math.max(0, on - (f.atd ?? f.std)));
    first = Math.min(first, day);
  }
  for (const ac of fresh) {
    const m = by.get(ac.id);
    ac.bookDays = m ? [...m].sort((a, b) => a[0] - b[0]).map(([d, v]) => [d, Math.round(v)] as [number, number]) : [];
    ac.bookSince ??= Math.max(first, Math.floor(ac.deliveredAt / DAY));
  }
}

export type BookedPeriodId = 'last7' | 'last30' | 'last90' | 'ytd' | 'next7' | 'next30' | 'next90';
export interface BookedPeriod {
  id: BookedPeriodId;
  label: string;
  /** Looking back (flown) or ahead (on the books). */
  past: boolean;
  /** Sold block hours in the period. */
  bh: number;
  /** Hours the aircraft were ours in the period (24 a day). */
  hours: number;
  /** bh / hours (0–1); null when there were no hours (just delivered, tracking began today). */
  share: number | null;
  /** Sold block hours per aircraft-day; null with no hours. */
  perDay: number | null;
  /** Looking back: the record begins inside the period (a young company, a new aircraft, an older save): counted from here. */
  since?: Minute;
}

const PERIODS: { id: BookedPeriodId; label: string; days: number | 'ytd'; past: boolean }[] = [
  { id: 'last7', label: 'Last 7 days', days: 7, past: true },
  { id: 'last30', label: 'Last 30 days', days: 30, past: true },
  { id: 'last90', label: 'Last 90 days', days: 90, past: true },
  { id: 'ytd', label: 'Year to date', days: 'ytd', past: true },
  { id: 'next7', label: 'Next 7 days', days: 7, past: false },
  { id: 'next30', label: 'Next 30 days', days: 30, past: false },
  { id: 'next90', label: 'Next 90 days', days: 90, past: false },
];

/** Sold block minutes of one aircraft flown in [from, now] (its record, by UTC day) and the minutes it was ours. */
function pastOf(g: GameState, ac: Aircraft, from: Minute): [number, number, Minute] {
  // An aircraft that joined after the record began counts from its arrival (it has no bookSince).
  const since = Math.max(from, ac.bookSince !== undefined ? ac.bookSince * DAY : -Infinity, ac.deliveredAt);
  if (since >= g.now) return [0, 0, g.now];
  const d0 = Math.floor(since / DAY);
  let min = 0;
  for (const [d, m] of ac.bookDays ?? []) if (d >= d0) min += m;
  return [min, g.now - since, since];
}

/** Sold block minutes of one aircraft planned in [now, to) and the minutes it is ours then. */
function aheadOf(g: GameState, ac: Aircraft, to: Minute, flights: Flight[]): [number, number] {
  const from = Math.max(g.now, ac.deliveredAt);
  if (from >= to) return [0, 0];
  let min = 0;
  for (const f of flights) {
    if (f.aircraftId !== ac.id || !isSoldLeg(f) || f.status === 'cancelled' || f.status === 'done') continue;
    min += Math.max(0, Math.min(f.sta, to) - Math.max(f.std, from));
  }
  // A base programme's rotations past the four weeks filed so far.
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || c.pattern.kind !== 'base' || c.generatedUntil >= to) continue;
    const slot = c.aircraftIds.indexOf(ac.id);
    if (slot < 0) continue;
    const after = Math.max(c.generatedUntil, from);
    for (const day of flownRotations(c.pattern, ac.typeId, slot)) {
      for (const r of day) {
        if (r.outStd < after || r.outStd >= to) continue;
        min += Math.max(0, Math.min(r.outSta, to) - r.outStd) + Math.max(0, Math.min(r.backSta, to) - r.backStd);
      }
    }
  }
  return [min, to - from];
}

/** January 1st (UTC) of the game's year. */
const yearStart = (now: Minute): Minute => fromUTC(toDate(now).getUTCFullYear(), 1, 1, 0);

/**
 * The booked figures of some aircraft (default: the whole fleet in service), one line per period: back 7, 30, 90 days
 * and the year to date, ahead 7, 30 and 90 days. Pure.
 */
export function bookedPeriods(g: GameState, aircraftIds?: string[]): BookedPeriod[] {
  const fleet = (aircraftIds ?? Object.keys(g.fleet)).map((id) => g.fleet[id]).filter((ac): ac is Aircraft => !!ac && (aircraftIds !== undefined || inService(ac)));
  const flights = Object.values(g.flights);
  return PERIODS.map((p) => {
    let min = 0;
    let avail = 0;
    const start = p.past ? (p.days === 'ytd' ? yearStart(g.now) : g.now - (p.days as number) * DAY) : g.now;
    let since = Infinity;
    for (const ac of fleet) {
      if (p.past) {
        const [m, a, s] = pastOf(g, ac, start);
        min += m;
        avail += a;
        if (a > 0) since = Math.min(since, s);
      } else {
        const [m, a] = aheadOf(g, ac, g.now + (p.days as number) * DAY, flights);
        min += m;
        avail += a;
      }
    }
    const hours = avail / 60;
    return {
      id: p.id, label: p.label, past: p.past, bh: Math.round((min / 60) * 10) / 10, hours: Math.round(hours),
      share: avail > 0 ? Math.min(1, min / avail) : null, perDay: avail > 0 ? Math.round((min / avail) * 24 * 10) / 10 : null,
      ...(p.past && since !== Infinity && since > start + 60 ? { since } : {}),
    };
  });
}

/** An aircraft that counts in the fleet figure: flying for us (not stored, not dry-leased out); one still on its way counts from its arrival. */
const inService = (ac: Aircraft): boolean => ac.status !== 'stored' && ac.status !== 'leasedOut';

/** '62 %' for a share, '–' with none. */
export const bookedPct = (share: number | null): string => (share === null ? '–' : `${Math.round(share * 100)} %`);
