// Simplified EASA FTL rules (RESEARCH §5.1, DESIGN.md §5.2). Pure functions on minutes; no GameState.

import { DAY, dayStart, localOffset, yearOf } from '../core/time';
import type { Legality, Minute } from '../core/types';

const H = 60;

// Hot-path memos: UTC offsets per airport and hour, and calendar years (Date objects are slow in loops).
const offMemo = new Map<string, Map<number, number>>();
export function offsetAt(code: string, t: Minute): number {
  let m = offMemo.get(code);
  if (!m) offMemo.set(code, (m = new Map()));
  const h = Math.floor(t / H);
  let o = m.get(h);
  if (o === undefined) {
    if (m.size > 20_000) m.clear();
    m.set(h, (o = localOffset(code, h * H)));
  }
  return o;
}
export const localMin = (code: string, t: Minute) => ((((t + offsetAt(code, t)) % DAY) + DAY) % DAY);
let yr = { from: 0, to: -1, y: 0 };
export function yearFast(t: Minute): number {
  if (t >= yr.from && t < yr.to) return yr.y;
  const y = yearOf(t);
  const from = Math.round((Date.UTC(y, 0, 1) - Date.UTC(2000, 0, 1)) / 60_000);
  const to = Math.round((Date.UTC(y + 1, 0, 1) - Date.UTC(2000, 0, 1)) / 60_000);
  yr = { from, to, y };
  return y;
}

export interface FdpInput {
  /** Report time in minutes after local midnight where the crew is acclimatised. */
  reportLocal: number;
  /** Operated sectors (positioning before operating is not a sector). */
  sectors: number;
  /** false = unknown acclimatisation state "X" (base 11:00). */
  acclimatised: boolean;
  /** Extra pilots (in-flight rest). */
  augment: 0 | 1 | 2;
  restClass: 1 | 2 | 3 | null;
  /** Longest sector block time (for the +1:00 augmented bonus). */
  longestBlock: number;
}

/** F1 base max FDP (1–2 sectors) by local report time, 15-minute bands. */
export function baseFdp(reportLocal: number): number {
  const m = ((Math.floor(reportLocal) % DAY) + DAY) % DAY;
  if (m >= 5 * H && m < 6 * H) return 12 * H + 15 * Math.floor((m - 5 * H) / 15);
  if (m >= 6 * H && m < 13 * H + 30) return 13 * H;
  if (m >= 13 * H + 30 && m < 17 * H) return 12 * H + 45 - 15 * Math.floor((m - (13 * H + 30)) / 30);
  return 11 * H;
}

/** F3 augmented FDP by extra pilots and rest facility class (1 bunk … 3 seat). */
const AUG: Record<1 | 2, Record<1 | 2 | 3, number>> = {
  1: { 1: 16 * H, 2: 15 * H, 3: 14 * H },
  2: { 1: 17 * H, 2: 16 * H, 3: 15 * H },
};

/** Max FDP (F1 table, −0:30 per sector above 2, 9:00 floor; F3 augmented table, +1:00 long-sector bonus, 18:00 cap). */
export function maxFdp(i: FdpInput): number {
  if (i.augment > 0 && i.restClass && i.sectors <= 3) {
    let fdp = AUG[i.augment as 1 | 2][i.restClass];
    if (i.sectors <= 2 && i.longestBlock - 20 > 9 * H) fdp += H;
    return Math.min(18 * H, fdp);
  }
  const base = i.acclimatised ? baseFdp(i.reportLocal) : 11 * H;
  return Math.max(9 * H, base - 30 * Math.max(0, i.sectors - 2));
}

export interface RestInput {
  /** Previous duty length (minutes). */
  dutyMin: number;
  atHome: boolean;
  augmented: boolean;
  /** Time-zone shift of the trip in hours. */
  tzShift: number;
}

/** F8 minimum rest: max(duty, 12 h home / 10 h away); 14 h away after an augmented FDP or a ≥ 4 h shift. */
export function minRest(i: RestInput): number {
  let base = i.atHome ? 12 * H : 10 * H;
  if (!i.atHome && (i.augmented || i.tzShift >= 4)) base = 14 * H;
  return Math.max(i.dutyMin, base);
}

/** Cumulative limits (F10) and recovery (F9). */
export const LIMITS = {
  duty7d: 60 * H,
  duty14d: 110 * H,
  duty28d: 190 * H,
  block28d: 100 * H,
  blockYear: 900 * H,
  recovery: 36 * H,
  /** Recovery after 4 or more disruptive duties since the last one. */
  recoveryLong: 60 * H,
  recoveryEvery: 168 * H,
  /** Disruptive duties that extend the next recovery. */
  disruptiveMax: 4,
  /** "tight" margins: FDP within 30 min of max, cumulative above 95 %. */
  tightFdp: 30,
  tightShare: 0.95,
  /** Work block inside a tour: at most 6 duty days, then 2 days off. */
  blockDays: 6,
  daysOff: 2,
} as const;

// ---------- acclimatisation (CS FTL.1.105, simplified) ----------

export type Acclim = 'B' | 'X' | 'D';

/** B/X/D from the zone difference (hours) and hours since the crew first reported away on this trip. */
export function acclimState(deltaH: number, hoursAway: number): Acclim {
  if (hoursAway < 48) return 'B';
  const dAt = deltaH < 4 ? 48 : deltaH <= 6 ? 72 : deltaH <= 9 ? 96 : 120;
  return hoursAway < dAt ? 'X' : 'D';
}

/** Absolute zone difference between two airports at t, hours (0–12). */
export function tzDeltaH(a: string, b: string, t: Minute): number {
  if (a === b) return 0;
  let d = Math.abs(offsetAt(a, t) - offsetAt(b, t)) / H;
  if (d > 12) d = 24 - d;
  return d;
}

export interface RefTime {
  state: Acclim;
  /** Reference report time (minutes after local midnight): base time in B, departure time in D. */
  reportLocal: number;
  /** Airport whose clock is the reference (base in B, departure otherwise). */
  tz: string;
}

/** FTL reference time for a report at `dep`, for crew based at `base` away since `tripStart`. */
export function referenceTime(base: string, dep: string, tripStart: Minute, report: Minute): RefTime {
  const state = acclimState(tzDeltaH(base, dep, report), (report - tripStart) / H);
  const tz = state === 'B' ? base : dep;
  return { state, reportLocal: localMin(tz, report), tz };
}

/** Early start, late finish or night: the duty touches a local 23:00–06:00 window (reference clock). */
export function isDisruptive(tz: string, start: Minute, end: Minute): boolean {
  const off = offsetAt(tz, start);
  const a = start + off;
  const b = end + off;
  for (let w = dayStart(a) - DAY + 23 * H; w < b; w += DAY) if (w < b && w + 7 * H > a) return true;
  return false;
}

/** Local nights inside [from, to]: 8 h falling between 22:00 and 08:00 at `tz` (EASA ORO.FTL.105). */
export function nightsIn(tz: string, from: Minute, to: Minute): number {
  const off = offsetAt(tz, from);
  const a = from + off;
  const b = to + off;
  let n = 0;
  for (let w = dayStart(a) - DAY + 22 * H; w < b; w += DAY) if (Math.min(b, w + 10 * H) - Math.max(a, w) >= 8 * H) n++;
  return n;
}

// ---------- timelines ----------

/** One stretch of duty in a crew member's (or a virtual crew set's) timeline. */
export interface Seg {
  kind: 'log' | 'duty' | 'pos';
  start: Minute;
  end: Minute;
  fdp: number;
  /** Limit incl. discretion (duty segs). */
  maxFdp: number;
  block: number;
  sectors: number;
  aug: boolean;
  disruptive: boolean;
  /** Minimum rest after the seg. */
  rest: number;
  /** Where the crew is after the seg ('' = unknown, log). */
  at: string;
  dutyId?: string;
  /** Being checked (a candidate assignment). */
  fresh?: boolean;
}

export interface TimelineCtx {
  /** Crew base: local nights for recovery. */
  base: string;
  /** End of rest after the last logged duty. */
  restUntil: Minute;
  lastRecovery: Minute;
  /** Logged block minutes in calendar year `blockYearOf`. */
  blockYear: number;
  blockYearOf: number;
  /** End of the last duty when the log is empty (time off before the first seg counts towards recovery). */
  freeSince?: Minute;
  /**
   * Planning margin: each planned duty is assumed to release this much late for the extended recovery that
   * follows it, so a routine delay doesn't break a fresh roster (0 when re-checking work in place).
   */
  slack?: number;
}

export type IssueCode = 'fdp' | 'rest' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'recovery' | 'rating' | 'location' | 'status' | 'overlap' | 'workBlock';

export interface LegalityIssue {
  code: IssueCode;
  level: Legality;
  text: string;
  dutyId?: string;
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const RANK: Record<Legality, number> = { legal: 0, tight: 1, illegal: 2 };
export const worst = (a: Legality, b: Legality): Legality => (RANK[a] >= RANK[b] ? a : b);

export function levelOf(issues: LegalityIssue[]): Legality {
  let l: Legality = 'legal';
  for (const i of issues) l = worst(l, i.level);
  return l;
}

/** Duty minutes of all segs clipped to [a, b], scanning back from index i (segs sorted by start). */
function dutyIn(segs: Seg[], i: number, a: Minute, b: Minute): number {
  let s = 0;
  for (let k = i; k >= 0; k--) {
    const x = segs[k];
    if (x.end <= a && x.start < a - 2 * DAY) break;
    s += Math.max(0, Math.min(b, x.end) - Math.max(a, x.start));
  }
  for (let k = i + 1; k < segs.length && segs[k].start < b; k++) s += Math.max(0, Math.min(b, segs[k].end) - Math.max(a, segs[k].start));
  return s;
}

function blockIn(segs: Seg[], i: number, a: Minute, b: Minute): number {
  let s = 0;
  for (let k = i; k >= 0; k--) {
    const x = segs[k];
    if (x.end <= a && x.start < a - 2 * DAY) break;
    if (x.end > a && x.end <= b) s += x.block;
  }
  return s;
}

/**
 * Checks a timeline (sorted by start). Targets: fresh segs and the planned segs after the first fresh one
 * (within 28 days); with no fresh seg, every non-log seg. Rest, FDP, rolling duty/block windows, calendar-year
 * block and the 36/60 h recovery every 168 h.
 */
export function evalSegs(ctx: TimelineCtx, segs: Seg[]): LegalityIssue[] {
  const issues: LegalityIssue[] = [];
  let firstFresh = -1;
  let lastFreshEnd = -Infinity;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].fresh) {
      if (firstFresh < 0) firstFresh = i;
      lastFreshEnd = Math.max(lastFreshEnd, segs[i].end);
    }
  }
  const isTarget = (i: number) => {
    const s = segs[i];
    if (s.kind === 'log') return false;
    if (firstFresh < 0) return true;
    return !!s.fresh || (i > firstFresh && s.start < lastFreshEnd + 28 * DAY);
  };
  const add = (code: IssueCode, level: Legality, text: string, s: Seg) => issues.push({ code, level, text, dutyId: s.dutyId });
  let anchor = ctx.lastRecovery;
  let disruptive = 0;
  let prevEnd = ctx.freeSince ?? -Infinity;
  let lastLog = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].kind === 'log') lastLog = i;
  // Planned block per calendar year, accumulated in time order (segs end in order for non-overlapping timelines).
  let plannedYear = 0;
  let plannedYearOf = ctx.blockYearOf;
  const slack = ctx.slack ?? 0;
  const endOf = (x: Seg) => (x.kind === 'duty' ? x.end + slack : x.end);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Recovery: the gap before s qualifies when it is long enough and holds two local nights.
    if (prevEnd > -Infinity) {
      const need = disruptive >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
      if (s.start - prevEnd >= need && nightsIn(ctx.base, prevEnd, s.start) >= 2 && s.start > anchor) {
        anchor = s.start;
        disruptive = 0;
      }
    }
    if (s.kind !== 'log') {
      const y = yearFast(s.end);
      if (y !== plannedYearOf) {
        plannedYearOf = y;
        plannedYear = 0;
      }
      plannedYear += s.block;
    }
    if (isTarget(i)) {
      const tgt = s;
      // Rest after the previous seg (the last logged one rests until ctx.restUntil).
      if (i > 0) {
        const p = segs[i - 1];
        const restEnd = i - 1 === lastLog ? Math.max(p.end + (p.rest || 0), ctx.restUntil) : p.end + p.rest;
        if (s.start < p.end) add('overlap', 'illegal', 'Overlaps another duty', tgt);
        else if (s.start < restEnd) add('rest', 'illegal', `Rest ${hm(s.start - p.end)} < ${hm(restEnd - p.end)}`, tgt);
      } else if (s.start < ctx.restUntil) add('rest', 'illegal', 'Still resting', tgt);
      // The next seg must also respect this seg's rest.
      const n = segs[i + 1];
      if (n && s.fresh && !n.fresh) {
        if (n.start < s.end) add('overlap', 'illegal', 'Overlaps another duty', tgt);
        else if (n.start < s.end + s.rest) add('rest', 'illegal', `Rest before next duty ${hm(n.start - s.end)} < ${hm(s.rest)}`, tgt);
      }
      if (s.kind === 'duty') {
        if (s.fdp > s.maxFdp) add('fdp', 'illegal', `FDP ${hm(s.fdp)} > ${hm(s.maxFdp)}`, tgt);
        else if (s.fdp > s.maxFdp - LIMITS.tightFdp) add('fdp', 'tight', `FDP ${hm(s.fdp)} of ${hm(s.maxFdp)}`, tgt);
      }
      const cum = (code: IssueCode, v: number, lim: number, label: string) => {
        if (v > lim) add(code, 'illegal', `${label} ${hm(v)} > ${hm(lim)}`, tgt);
        else if (v > lim * LIMITS.tightShare) add(code, 'tight', `${label} ${hm(v)} of ${hm(lim)}`, tgt);
      };
      cum('duty7d', dutyIn(segs, i, s.end - 7 * DAY, s.end), LIMITS.duty7d, 'Duty 7d');
      cum('duty14d', dutyIn(segs, i, s.end - 14 * DAY, s.end), LIMITS.duty14d, 'Duty 14d');
      cum('duty28d', dutyIn(segs, i, s.end - 28 * DAY, s.end), LIMITS.duty28d, 'Duty 28d');
      if (s.block > 0) {
        cum('block28d', blockIn(segs, i, s.end - 28 * DAY, s.end), LIMITS.block28d, 'Block 28d');
        const logged = ctx.blockYearOf === plannedYearOf ? ctx.blockYear : 0;
        cum('blockYear', logged + plannedYear, LIMITS.blockYear, 'Block year');
      }
      if (endOf(s) > anchor + LIMITS.recoveryEvery) add('recovery', 'illegal', 'No 36 h recovery in 168 h', tgt);
    }
    if (s.disruptive) disruptive++;
    prevEnd = Math.max(prevEnd, endOf(s));
  }
  return issues;
}

/** End of the latest qualifying recovery rest before t (lastRecovery when none in the timeline). */
export function recoveryAnchor(ctx: TimelineCtx, segs: Seg[], t: Minute): Minute {
  let anchor = ctx.lastRecovery;
  let disruptive = 0;
  let prevEnd = ctx.freeSince ?? -Infinity;
  for (const s of segs) {
    if (s.start > t) break;
    if (prevEnd > -Infinity) {
      const need = disruptive >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
      if (s.start - prevEnd >= need && nightsIn(ctx.base, prevEnd, s.start) >= 2 && s.start > anchor) {
        anchor = s.start;
        disruptive = 0;
      }
    }
    if (s.disruptive) disruptive++;
    prevEnd = Math.max(prevEnd, s.end);
  }
  // A long enough free stretch up to t also counts.
  if (prevEnd > -Infinity && t - prevEnd >= (disruptive >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery) && nightsIn(ctx.base, prevEnd, t) >= 2) anchor = Math.max(anchor, t);
  return anchor;
}

/** Longest run of duty days (local day indices, sorted unique) where gaps of < 2 free days continue the block. */
export function longestWorkBlock(days: number[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i] - days[i - 1] <= LIMITS.daysOff ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
