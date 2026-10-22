// EASA FTL rules (Reg. (EU) 965/2012 Annex III Subpart FTL as amended by 83/2014; CS FTL.1). The reference is
// docs/acmi/EASA-FTL.md (v0.7.2): every table here is written there by article and pinned in ftl.test.ts.
// Pure functions on minutes; no GameState.

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
  /** v0.7.2 cabin crew report this much earlier (ORO.FTL.205(c)); caps augmented FDPs by the cabin rest table. */
  cabinEarly?: number;
}

/**
 * ORO.FTL.205(b)(1) Table 1, the 1–2 sector column: [from, to) local reference time (minutes after midnight) → max
 * FDP. Reports outside every band (17:00–04:59) get FDP_OUTSIDE. Each sector above 2 costs SECTOR_STEP, floor FDP_FLOOR.
 */
export const FDP_BANDS: readonly (readonly [number, number, number])[] = [
  [5 * H, 5 * H + 15, 12 * H], [5 * H + 15, 5 * H + 30, 12 * H + 15], [5 * H + 30, 5 * H + 45, 12 * H + 30], [5 * H + 45, 6 * H, 12 * H + 45],
  [6 * H, 13 * H + 30, 13 * H],
  [13 * H + 30, 14 * H, 12 * H + 45], [14 * H, 14 * H + 30, 12 * H + 30], [14 * H + 30, 15 * H, 12 * H + 15], [15 * H, 15 * H + 30, 12 * H],
  [15 * H + 30, 16 * H, 11 * H + 45], [16 * H, 16 * H + 30, 11 * H + 30], [16 * H + 30, 17 * H, 11 * H + 15],
];
export const FDP_OUTSIDE = 11 * H;
/** ORO.FTL.205(b)(2) Table 2: unknown acclimatised state (X), 1–2 sectors (same sector step and floor). */
export const FDP_UNKNOWN = 11 * H;
export const SECTOR_STEP = 30;
export const FDP_FLOOR = 9 * H;
/** Table 1 stops at 10 sectors. */
export const MAX_SECTORS = 10;

/** CS FTL.1.205(c): augmented FDP by extra pilots (1: 3 pilots, 2: 4 pilots) and rest facility class. */
export const AUG_FDP: Readonly<Record<1 | 2, Readonly<Record<1 | 2 | 3, number>>>> = {
  1: { 1: 16 * H, 2: 15 * H, 3: 14 * H },
  2: { 1: 17 * H, 2: 16 * H, 3: 15 * H },
};
/** +1:00 when the duty has ≤ 2 sectors and one of more than AUG_BONUS_FT continuous flight time; ≤ 3 sectors; 18:00 cap. */
export const AUG_BONUS = H;
export const AUG_BONUS_FT = 9 * H;
export const AUG_MAX_SECTORS = 3;
export const FDP_CAP = 18 * H;
/** Taxi out + in taken off the block time to estimate continuous flight time (bonus test). */
export const TAXI_ALLOWANCE = 20;

/** ORO.FTL.205(f) commander's discretion: +2:00, +3:00 augmented; the rest after may be reduced, never below 10:00. */
export const DISCRETION = { basic: 2 * H, augmented: 3 * H, minRest: 10 * H } as const;

/**
 * CS FTL.1.205(c) minimum in-flight rest for cabin crew by extended FDP (up to and including `upTo`) and rest class;
 * null = that class does not allow this FDP. Beyond the last row: not allowed.
 */
export const CABIN_REST: readonly { upTo: number; c1: number; c2: number | null; c3: number | null }[] = [
  { upTo: 14 * H + 30, c1: 90, c2: 90, c3: 90 },
  { upTo: 15 * H, c1: 105, c2: 120, c3: 140 },
  { upTo: 15 * H + 30, c1: 120, c2: 140, c3: 160 },
  { upTo: 16 * H, c1: 135, c2: 160, c3: 180 },
  { upTo: 16 * H + 30, c1: 155, c2: 180, c3: null },
  { upTo: 17 * H, c1: 180, c2: 205, c3: null },
  { upTo: 17 * H + 30, c1: 205, c2: null, c3: null },
  { upTo: 18 * H, c1: 230, c2: null, c3: null },
  { upTo: 18 * H + 30, c1: 265, c2: null, c3: null },
];

/** Minimum in-flight rest (minutes) for cabin crew on an extended FDP with a class 1/2/3 facility; null = not allowed. */
export function cabinInflightRest(fdp: number, cls: 1 | 2 | 3): number | null {
  const row = CABIN_REST.find((r) => fdp <= r.upTo);
  if (!row) return null;
  return cls === 1 ? row.c1 : cls === 2 ? row.c2 : row.c3;
}

/** v0.7.2 the longest cabin crew extended FDP a rest class allows (the last CABIN_REST row it is not refused). */
export function cabinFdpCap(cls: 1 | 2 | 3): number {
  let cap = 0;
  for (const r of CABIN_REST) if ((cls === 1 ? r.c1 : cls === 2 ? r.c2 : r.c3) !== null) cap = r.upTo;
  return cap;
}

/** Table 1 max FDP (1–2 sectors) by local reference report time. */
export function baseFdp(reportLocal: number): number {
  const m = ((Math.floor(reportLocal) % DAY) + DAY) % DAY;
  for (const [a, b, fdp] of FDP_BANDS) if (m >= a && m < b) return fdp;
  return FDP_OUTSIDE;
}

/** Max FDP: Table 1/2 less SECTOR_STEP per sector above 2 (floor FDP_FLOOR); augmented: AUG_FDP (+AUG_BONUS), FDP_CAP. */
export function maxFdp(i: FdpInput): number {
  if (i.augment > 0 && i.restClass && i.sectors <= AUG_MAX_SECTORS) {
    let fdp = AUG_FDP[i.augment as 1 | 2][i.restClass];
    if (i.sectors <= 2 && i.longestBlock - TAXI_ALLOWANCE > AUG_BONUS_FT) fdp += AUG_BONUS;
    // v0.7.2 the cabin crew (reporting `cabinEarly` before) must still get their in-flight rest (CABIN_REST).
    return Math.min(FDP_CAP, fdp, cabinFdpCap(i.restClass) - (i.cabinEarly ?? 0));
  }
  const base = i.acclimatised ? baseFdp(i.reportLocal) : FDP_UNKNOWN;
  return Math.max(FDP_FLOOR, base - SECTOR_STEP * Math.max(0, i.sectors - 2));
}

export interface RestInput {
  /** Previous duty length (minutes). */
  dutyMin: number;
  atHome: boolean;
  augmented: boolean;
  /** Time-zone shift of the trip in hours. */
  tzShift: number;
}

/**
 * ORO.FTL.235(a)/(b) minimum rest: max(duty, 12 h home / 10 h away); CS FTL.1.205(c) / CS FTL.1.235(b): 14 h away
 * after an augmented FDP or a ≥ 4 h time-zone shift.
 */
export function minRest(i: RestInput): number {
  let base = i.atHome ? 12 * H : 10 * H;
  if (!i.atHome && (i.augmented || i.tzShift >= 4)) base = 14 * H;
  return Math.max(i.dutyMin, base);
}

/** ORO.FTL.210 cumulative limits and ORO.FTL.235(d) / CS FTL.1.235 recovery. */
export const LIMITS = {
  duty7d: 60 * H,
  duty14d: 110 * H,
  duty28d: 190 * H,
  block28d: 100 * H,
  blockYear: 900 * H,
  /** v0.7.2: 1,000 h of flight time in any 12 consecutive calendar months. */
  block12m: 1000 * H,
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
  /** Where the seg starts (the crew must be there; '' / absent = unknown). */
  from?: string;
  dutyId?: string;
  /** Ticket (deadhead flight) behind a 'pos' seg. */
  ticketId?: string;
  /**
   * v0.5.2: a ticket home merged into this duty seg (leaving within 10 h of release): the ticket (once bought),
   * where it leaves from and when, and the seg's end, rest and place without it (a later trip from there drops it).
   */
  home?: { id?: string; from: string; std: Minute; release: Minute; rest: number };
  /** v0.5.2: a ticket out merged into this duty seg's FDP: the ticket and the seg's start, FDP, limit and origin without it. */
  out?: { id?: string; to: string; start: Minute; fdp: number; maxFdp: number; disruptive: boolean };
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
  /** v0.7.2 logged block minutes in this calendar month and the 11 before (absent = 0: old saves). */
  block12m?: number;
  /** End of the last duty when the log is empty (time off before the first seg counts towards recovery). */
  freeSince?: Minute;
  /** Where the crew member is now and the time: the first planned work starting later must start there. */
  loc?: string;
  now?: Minute;
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

/**
 * Duty minutes in the 7, 14 and 28 days and block minutes in the 28 days up to b (seg i ends there; segs sorted by
 * start), scanning back from i. v0.7: the four windows in one pass, into a shared buffer (no allocation).
 */
const WIN = new Float64Array(4);
function windowsAt(segs: Seg[], i: number, b: Minute): Float64Array {
  const a7 = b - 7 * DAY;
  const a14 = b - 14 * DAY;
  const a28 = b - 28 * DAY;
  let d7 = 0;
  let d14 = 0;
  let d28 = 0;
  let blk = 0;
  let on7 = true;
  let on14 = true;
  for (let k = i; k >= 0; k--) {
    const x = segs[k];
    if (x.end <= a28 && x.start < a28 - 2 * DAY) break;
    const hi = Math.min(b, x.end);
    if (on7) {
      if (x.end <= a7 && x.start < a7 - 2 * DAY) on7 = false;
      else d7 += Math.max(0, hi - Math.max(a7, x.start));
    }
    if (on14) {
      if (x.end <= a14 && x.start < a14 - 2 * DAY) on14 = false;
      else d14 += Math.max(0, hi - Math.max(a14, x.start));
    }
    d28 += Math.max(0, hi - Math.max(a28, x.start));
    if (x.end > a28 && x.end <= b) blk += x.block;
  }
  for (let k = i + 1; k < segs.length && segs[k].start < b; k++) {
    const x = segs[k];
    const hi = Math.min(b, x.end);
    d7 += Math.max(0, hi - Math.max(a7, x.start));
    d14 += Math.max(0, hi - Math.max(a14, x.start));
    d28 += Math.max(0, hi - Math.max(a28, x.start));
  }
  WIN[0] = d7;
  WIN[1] = d14;
  WIN[2] = d28;
  WIN[3] = blk;
  return WIN;
}

// Module-level helpers (no closures per call in the hot path).
const pushIssue = (issues: LegalityIssue[], code: IssueCode, level: Legality, text: string, s: Seg) => issues.push({ code, level, text, dutyId: s.dutyId });
function cumIssue(issues: LegalityIssue[], code: IssueCode, v: number, lim: number, label: string, tgt: Seg): void {
  if (v > lim) pushIssue(issues, code, 'illegal', `${label} ${hm(v)} > ${hm(lim)}`, tgt);
  else if (v > lim * LIMITS.tightShare) pushIssue(issues, code, 'tight', `${label} ${hm(v)} of ${hm(lim)}`, tgt);
}
const segEnd = (x: Seg, slack: number) => (x.kind === 'duty' ? x.end + slack : x.end);

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
  let anchor = ctx.lastRecovery;
  let disruptive = 0;
  let prevEnd = ctx.freeSince ?? -Infinity;
  let lastLog = -1;
  for (let i = 0; i < segs.length; i++) if (segs[i].kind === 'log') lastLog = i;
  // Planned block per calendar year, accumulated in time order (segs end in order for non-overlapping timelines).
  let plannedYear = 0;
  let plannedYearOf = ctx.blockYearOf;
  let planned12m = 0;
  const slack = ctx.slack ?? 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Recovery: the gap before s qualifies when it is long enough and holds two local nights.
    if (prevEnd > -Infinity) {
      const need = disruptive >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
      if (s.start - prevEnd >= need && nightsIn(ctx.base, prevEnd, s.start) >= 2 && s.start >= anchor) {
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
      planned12m += s.block;
    }
    const target = s.kind !== 'log' && (firstFresh < 0 || !!s.fresh || (i > firstFresh && s.start < lastFreshEnd + 28 * DAY));
    if (target) {
      const tgt = s;
      // Rest after the previous seg (the last logged one rests until ctx.restUntil).
      if (i > 0) {
        const p = segs[i - 1];
        const restEnd = i - 1 === lastLog ? Math.max(p.end + (p.rest || 0), ctx.restUntil) : p.end + p.rest;
        if (s.start < p.end) pushIssue(issues, 'overlap', 'illegal', 'Overlaps another duty', tgt);
        else if (s.start < restEnd) pushIssue(issues, 'rest', 'illegal', `Rest ${hm(s.start - p.end)} < ${hm(restEnd - p.end)}`, tgt);
      } else if (s.start < ctx.restUntil) pushIssue(issues, 'rest', 'illegal', 'Still resting', tgt);
      // Continuity: work starts where the previous duty or ticket left the crew (the first, where they are now).
      const p = i > 0 ? segs[i - 1] : null;
      if (p && p.kind !== 'log') {
        if (p.at && s.from && p.at !== s.from) pushIssue(issues, 'location', 'illegal', `At ${p.at}, not ${s.from}`, tgt);
      } else if (ctx.loc && s.from && s.from !== ctx.loc && s.start > (ctx.now ?? Infinity)) pushIssue(issues, 'location', 'illegal', `At ${ctx.loc}, not ${s.from}`, tgt);
      // The next seg must also respect this seg's rest (a later seg's start airport is checked as a target).
      const n = segs[i + 1];
      if (n && s.fresh && !n.fresh) {
        if (n.start < s.end) pushIssue(issues, 'overlap', 'illegal', 'Overlaps another duty', tgt);
        else if (n.start < s.end + s.rest) pushIssue(issues, 'rest', 'illegal', `Rest before next duty ${hm(n.start - s.end)} < ${hm(s.rest)}`, tgt);
      }
      if (s.kind === 'duty') {
        if (s.fdp > s.maxFdp) pushIssue(issues, 'fdp', 'illegal', `FDP ${hm(s.fdp)} > ${hm(s.maxFdp)}`, tgt);
        else if (s.fdp > s.maxFdp - LIMITS.tightFdp) pushIssue(issues, 'fdp', 'tight', `FDP ${hm(s.fdp)} of ${hm(s.maxFdp)}`, tgt);
      }
      const w = windowsAt(segs, i, s.end);
      cumIssue(issues, 'duty7d', w[0], LIMITS.duty7d, 'Duty 7d', tgt);
      cumIssue(issues, 'duty14d', w[1], LIMITS.duty14d, 'Duty 14d', tgt);
      cumIssue(issues, 'duty28d', w[2], LIMITS.duty28d, 'Duty 28d', tgt);
      if (s.block > 0) {
        cumIssue(issues, 'block28d', w[3], LIMITS.block28d, 'Block 28d', tgt);
        const logged = ctx.blockYearOf === plannedYearOf ? ctx.blockYear : 0;
        cumIssue(issues, 'blockYear', logged + plannedYear, LIMITS.blockYear, 'Block year', tgt);
        if (ctx.block12m) cumIssue(issues, 'blockYear', ctx.block12m + planned12m, LIMITS.block12m, 'Block 12 months', tgt);
      }
      if (segEnd(s, slack) > anchor + LIMITS.recoveryEvery) pushIssue(issues, 'recovery', 'illegal', 'No 36 h recovery in 168 h', tgt);
    }
    // Disruptive duties since the last recovery (as noteRecovery counts them from the log).
    if (s.disruptive && s.start >= anchor) disruptive++;
    prevEnd = Math.max(prevEnd, segEnd(s, slack));
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
      if (s.start - prevEnd >= need && nightsIn(ctx.base, prevEnd, s.start) >= 2 && s.start >= anchor) {
        anchor = s.start;
        disruptive = 0;
      }
    }
    // Disruptive duties since the last recovery (as noteRecovery counts them from the log).
    if (s.disruptive && s.start >= anchor) disruptive++;
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
