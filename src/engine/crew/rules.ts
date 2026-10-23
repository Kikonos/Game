// EASA FTL rules (Reg. (EU) 965/2012 Annex III Subpart FTL as amended by Reg. (EU) 83/2014; CS FTL.1 = ED Decision
// 2014/002/R as amended by ED Decision 2023/023/R). The reference is docs/acmi/EASA-FTL.md (v0.7.3, rewritten
// against the player's guide): every table here is written there by article and pinned in ftl.test.ts.
// Pure functions on minutes; no GameState.

import { DAY, dayStart, localOffset, yearOf } from '../core/time';
import type { Legality, Minute, StandbyKind } from '../core/types';

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
  /** The pilots' rest facility class (CS FTL.1.205(c)(2)). */
  restClass: 1 | 2 | 3 | null;
  /** v0.7.3 the cabin crew's rest facility class (CS FTL.1.205(c)(3)); absent = restClass. */
  cabinClass?: 1 | 2 | 3 | null;
  /** Longest sector block time (for the +1:00 augmented bonus). */
  longestBlock: number;
  /**
   * v0.7.2 cabin crew report this much earlier (ORO.FTL.205(c)). v0.7.3: no longer cuts the limit (the cabin crew
   * report with the pilots when their table would bind; augLimit); kept for old callers.
   */
  cabinEarly?: number;
}

/**
 * ORO.FTL.205(b)(1) Table 2 (basic max daily FDP, acclimatised crew), the 1–2 sector column: [from, to) local
 * reference time (minutes after midnight) → max FDP. Reports outside every band (17:00–04:59) get FDP_OUTSIDE. Each
 * sector above 2 costs SECTOR_STEP, floor FDP_FLOOR.
 */
export const FDP_BANDS: readonly (readonly [number, number, number])[] = [
  [5 * H, 5 * H + 15, 12 * H], [5 * H + 15, 5 * H + 30, 12 * H + 15], [5 * H + 30, 5 * H + 45, 12 * H + 30], [5 * H + 45, 6 * H, 12 * H + 45],
  [6 * H, 13 * H + 30, 13 * H],
  [13 * H + 30, 14 * H, 12 * H + 45], [14 * H, 14 * H + 30, 12 * H + 30], [14 * H + 30, 15 * H, 12 * H + 15], [15 * H, 15 * H + 30, 12 * H],
  [15 * H + 30, 16 * H, 11 * H + 45], [16 * H, 16 * H + 30, 11 * H + 30], [16 * H + 30, 17 * H, 11 * H + 15],
];
export const FDP_OUTSIDE = 11 * H;
/** ORO.FTL.205(b)(2) Table 3: unknown state of acclimatisation (X), 1–2 sectors (same sector step and floor). Table 4 (FRM) is not used. */
export const FDP_UNKNOWN = 11 * H;
export const SECTOR_STEP = 30;
export const FDP_FLOOR = 9 * H;
/** Table 2 stops at 10 sectors: more is never planned (v0.7.3 enforced). */
export const MAX_SECTORS = 10;
/** CS FTL.1.205(a)(1): consecutive night duties are computed with at most 4 sectors (the game: every night duty). */
export const NIGHT_MAX_SECTORS = 4;

/** CS FTL.1.205(c)(2)(i)/(ii): augmented FDP by extra pilots (1: 3 pilots, 2: 4 pilots) and the pilots' rest facility class. */
export const AUG_FDP: Readonly<Record<1 | 2, Readonly<Record<1 | 2 | 3, number>>>> = {
  1: { 1: 16 * H, 2: 15 * H, 3: 14 * H },
  2: { 1: 17 * H, 2: 16 * H, 3: 15 * H },
};
/** CS FTL.1.205(c)(4): +1:00 when the duty has ≤ 2 sectors and one of more than AUG_BONUS_FT continuous flight time; (c)(1) ≤ 3 sectors; 18:00 cap. */
export const AUG_BONUS = H;
export const AUG_BONUS_FT = 9 * H;
export const AUG_MAX_SECTORS = 3;
export const FDP_CAP = 18 * H;
/** Taxi out + in taken off the block time to estimate continuous flight time (bonus test). */
export const TAXI_ALLOWANCE = 20;

/**
 * ORO.FTL.205(f) commander's discretion, only for unforeseen circumstances at or after report: +2:00, +3:00 augmented,
 * on the basic FDP even after a planned extension (GM1 ORO.FTL.205(f)(1)(i)); the rest after may be reduced, never
 * below 10:00 (the game never reduces it); a report to the authority within 28 days when over 1:00.
 */
export const DISCRETION = { basic: 2 * H, augmented: 3 * H, minRest: 10 * H } as const;

/**
 * CS FTL.1.205(c)(3) minimum in-flight rest for cabin crew by extended FDP (up to and including `upTo`) and the cabin
 * crew's rest class; null = that class does not allow this FDP. The table ends at 17:31–18:00 (v0.7.3: the extra
 * 18:01–18:30 row is gone); beyond it: not allowed.
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
];

/** Minimum in-flight rest (minutes) for cabin crew on an extended FDP with a class 1/2/3 facility; null = not allowed. */
export function cabinInflightRest(fdp: number, cls: 1 | 2 | 3): number | null {
  const row = CABIN_REST.find((r) => fdp <= r.upTo);
  if (!row) return null;
  return cls === 1 ? row.c1 : cls === 2 ? row.c2 : row.c3;
}

/** The longest cabin crew extended FDP a rest class allows (the last CABIN_REST row it is not refused): 18:00 / 17:00 / 16:00. */
export function cabinFdpCap(cls: 1 | 2 | 3): number {
  let cap = 0;
  for (const r of CABIN_REST) if ((cls === 1 ? r.c1 : cls === 2 ? r.c2 : r.c3) !== null) cap = r.upTo;
  return cap;
}

/** Table 2 max FDP (1–2 sectors) by local reference report time. */
export function baseFdp(reportLocal: number): number {
  const m = ((Math.floor(reportLocal) % DAY) + DAY) % DAY;
  for (const [a, b, fdp] of FDP_BANDS) if (m >= a && m < b) return fdp;
  return FDP_OUTSIDE;
}

/** The CS FTL.1.205(c)(4) long-sector test: ≤ 2 sectors and one with more than 9:00 continuous flight time. */
export const longSector = (sectors: number, longestBlock: number) => sectors <= 2 && longestBlock - TAXI_ALLOWANCE > AUG_BONUS_FT;

/**
 * v0.7.3 augmented max FDP (C2): the pilots' CS FTL.1.205(c)(2) value for their class (+1:00 on one long sector,
 * 18:00 cap). When that plus the cabin crew's early report would pass the cabin crew's CS FTL.1.205(c)(3) table for
 * their class, the cabin crew report with the pilots (early 0); only if the pilots' value alone passes it is the
 * limit capped by the cabin table.
 */
export function augLimitOf(fcCls: 1 | 2 | 3, ccCls: 1 | 2 | 3, augment: 1 | 2, long: boolean, typeEarly: number): { max: number; early: number; capBy: 'pilots' | 'cabin' } {
  const pilots = Math.min(FDP_CAP, AUG_FDP[augment][fcCls] + (long ? AUG_BONUS : 0));
  const cap = cabinFdpCap(ccCls);
  if (pilots > cap) return { max: cap, early: 0, capBy: 'cabin' };
  return { max: pilots, early: pilots + typeEarly > cap ? 0 : typeEarly, capBy: 'pilots' };
}

/**
 * Max FDP: Table 2 (acclimatised) or Table 3 (X) less SECTOR_STEP per sector above 2 (floor FDP_FLOOR); augmented
 * (≤ 3 sectors): augLimitOf. More than MAX_SECTORS sectors: 0 (never legal).
 */
export function maxFdp(i: FdpInput): number {
  if (i.sectors > MAX_SECTORS) return 0;
  if (i.augment > 0 && i.restClass && i.sectors <= AUG_MAX_SECTORS) {
    const cc = i.cabinClass === undefined ? i.restClass : i.cabinClass;
    if (cc) return augLimitOf(i.restClass, cc, i.augment as 1 | 2, longSector(i.sectors, i.longestBlock), i.cabinEarly ?? 0).max;
  }
  const base = i.acclimatised ? baseFdp(i.reportLocal) : FDP_UNKNOWN;
  return Math.max(FDP_FLOOR, base - SECTOR_STEP * Math.max(0, i.sectors - 2));
}

// ---------- v0.7.3 planned extension (ORO.FTL.205(d), CS FTL.1.205(b)) ----------

/** WOCL (ORO.FTL.105(28)): 02:00–05:59 in the acclimatised time zone (minutes after local midnight, [from, to)). */
export const WOCL = { from: 2 * H, to: 6 * H } as const;
/** Night duty (ORO.FTL.105(9)): encroaches any part of 02:00–04:59. */
export const NIGHT = { from: 2 * H, to: 5 * H } as const;

/**
 * CS FTL.1.205(b): [from, to) local reference report time → max FDP with a planned extension for 1–2 / 3 / 4 / 5
 * sectors; null = not allowed. Outside every row (19:00–06:14 and 06:00–06:14): not allowed.
 */
export const EXT_TABLE: readonly (readonly [number, number, number | null, number | null, number | null, number | null])[] = [
  [6 * H, 6 * H + 15, null, null, null, null],
  [6 * H + 15, 6 * H + 30, 13 * H + 15, 12 * H + 45, 12 * H + 15, 11 * H + 45],
  [6 * H + 30, 6 * H + 45, 13 * H + 30, 13 * H, 12 * H + 30, 12 * H],
  [6 * H + 45, 7 * H, 13 * H + 45, 13 * H + 15, 12 * H + 45, 12 * H + 15],
  [7 * H, 13 * H + 30, 14 * H, 13 * H + 30, 13 * H, 12 * H + 30],
  [13 * H + 30, 14 * H, 13 * H + 45, 13 * H + 15, 12 * H + 45, null],
  [14 * H, 14 * H + 30, 13 * H + 30, 13 * H, 12 * H + 30, null],
  [14 * H + 30, 15 * H, 13 * H + 15, 12 * H + 45, 12 * H + 15, null],
  [15 * H, 15 * H + 30, 13 * H, 12 * H + 30, 12 * H, null],
  [15 * H + 30, 16 * H, 12 * H + 45, null, null, null],
  [16 * H, 16 * H + 30, 12 * H + 30, null, null, null],
  [16 * H + 30, 17 * H, 12 * H + 15, null, null, null],
  [17 * H, 17 * H + 30, 12 * H, null, null, null],
  [17 * H + 30, 18 * H, 11 * H + 45, null, null, null],
  [18 * H, 18 * H + 30, 11 * H + 30, null, null, null],
  [18 * H + 30, 19 * H, 11 * H + 15, null, null, null],
];

/** CS FTL.1.205(b) sector limit with a planned extension by WOCL encroachment: none 5, ≤ 2 h 4, more 2. */
export const extSectorCap = (woclMin: number) => (woclMin <= 0 ? 5 : woclMin <= 2 * H ? 4 : 2);

/** Max FDP with a planned extension (CS FTL.1.205(b) table and the WOCL sector caps); null = not allowed. */
export function extFdp(reportLocal: number, sectors: number, woclMin: number): number | null {
  if (sectors < 1 || sectors > extSectorCap(woclMin)) return null;
  const m = ((Math.floor(reportLocal) % DAY) + DAY) % DAY;
  const row = EXT_TABLE.find(([a, b]) => m >= a && m < b);
  if (!row) return null;
  return row[Math.max(2, sectors)] ?? null;
}

/** Minutes of [start, end] inside a daily local window [from, to) at `tz` (reference clock). */
export function localOverlap(tz: string, start: Minute, end: Minute, from: number, to: number): number {
  const off = offsetAt(tz, start);
  const a = start + off;
  const b = end + off;
  let n = 0;
  for (let w = dayStart(a) - DAY + from; w < b; w += DAY) n += Math.max(0, Math.min(b, w + (to - from)) - Math.max(a, w));
  return n;
}

/** WOCL encroachment (minutes) of a duty [report, end] at the reference clock. */
export const woclMinutes = (tz: string, report: Minute, end: Minute) => localOverlap(tz, report, end, WOCL.from, WOCL.to);

// ---------- v0.7.3 split duty (ORO.FTL.220, CS FTL.1.220) ----------

/** CS FTL.1.220(c): up to 50 % of the net break (≥ 3 h) added to the basic max, in 15 min steps, 16:00 ceiling (EASA FAQ). */
export function splitFdp(basic: number, net: number): number | null {
  if (net < 3 * H) return null;
  return Math.min(16 * H, basic + Math.floor(net / 2 / 15) * 15);
}

// ---------- v0.7.3 standby (ORO.FTL.225, CS FTL.1.225) ----------

/** CS FTL.1.225: other (home) standby at most 16 h; standby + FDP ≤ 18 h awake; airport standby + FDP ≤ 16 h. */
export const STANDBY = { homeMax: 16 * H, awakeMax: 18 * H, airportTotal: 16 * H, homeFree: 6 * H, homeFreeAug: 8 * H, airportFree: 4 * H, wakeMin: 60 } as const;

/**
 * Minutes off the max FDP for crew called from standby (CS FTL.1.225): airport standby beyond 4 h; home standby
 * beyond 6 h (8 h when the duty is augmented or split), not counting standby time between 23:00 and 07:00 (local at
 * `tz`) before they were contacted. Standby counts from its start to the report.
 */
export function standbyCut(kind: 'home' | 'airport', sbyFrom: Minute, report: Minute, tz: string, augOrSplit: boolean, contacted?: Minute): number {
  const len = Math.max(0, report - sbyFrom);
  if (kind === 'airport') return Math.max(0, len - STANDBY.airportFree);
  const quietTo = Math.min(report, contacted ?? report);
  const quiet = quietTo > sbyFrom ? localOverlap(tz, sbyFrom, quietTo, 23 * H, 31 * H) : 0;
  return Math.max(0, len - quiet - (augOrSplit ? STANDBY.homeFreeAug : STANDBY.homeFree));
}

/** CS FTL.1.225(b) awake cap: from waking (wakeMin before standby starts) to the end of the FDP ≤ 18 h. */
export const standbyAwakeOk = (sbyFrom: Minute, fdpEnd: Minute): boolean => fdpEnd - (sbyFrom - STANDBY.wakeMin) <= STANDBY.awakeMax;

export interface RestInput {
  /** Previous duty length (minutes). */
  dutyMin: number;
  atHome: boolean;
  augmented: boolean;
  /** Time-zone shift of the trip in hours. */
  tzShift: number;
  /** v0.7.3 after a planned extension: +4 h (ORO.FTL.205(d), the post-flight option). */
  extended?: boolean;
}

/**
 * ORO.FTL.235(a)/(b) minimum rest: max(duty, 12 h home / 10 h away). v0.7.3: 14 h after any augmented FDP wherever
 * the crew rest (CS FTL.1.205(c)(6)) and away after a ≥ 4 h time-zone shift (CS FTL.1.235(b)(3)(ii)); +4 h after a
 * planned extension.
 */
export function minRest(i: RestInput): number {
  let base = i.atHome ? 12 * H : 10 * H;
  if (i.augmented || (!i.atHome && i.tzShift >= 4)) base = 14 * H;
  return Math.max(i.dutyMin, base) + (i.extended ? 4 * H : 0);
}

/** ORO.FTL.210 cumulative limits, ORO.FTL.235(d) recurrent extended recovery rest and CS FTL.1.235(a)(2). */
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
  /** Company policy, not EASA: a work block inside a tour of at most 6 duty days, then 2 days off. */
  blockDays: 6,
  daysOff: 2,
} as const;

// ---------- acclimatisation (ORO.FTL.105(1) Table 1, simplified: the reference is the home base clock) ----------

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

/** v0.7.3 disruptive schedules (ORO.FTL.105(8)): the early type for every home base (ARO.OPS.230; EASA-FTL.md §1). */
export const FTL_TYPE = 'early' as const;

/**
 * v0.7.3 CS FTL.1.235(a), early type: early start = duty starts 05:00–05:59; late finish = duty ends 23:00–01:59;
 * night duty = encroaches any part of 02:00–04:59 (reference clock).
 */
export function disruptiveKinds(tz: string, start: Minute, end: Minute): { early: boolean; late: boolean; night: boolean } {
  const s = localMin(tz, start);
  const e = localMin(tz, end);
  return { early: s >= 5 * H && s < 6 * H, late: e >= 23 * H || e < 2 * H, night: localOverlap(tz, start, end, NIGHT.from, NIGHT.to) > 0 };
}

/** Early start, late finish or night duty (disruptiveKinds). */
export function isDisruptive(tz: string, start: Minute, end: Minute): boolean {
  const k = disruptiveKinds(tz, start, end);
  return k.early || k.late || k.night;
}

/** v0.7.3 local days (ORO.FTL.105(15)): whole 00:00–24:00 days at `tz` inside [from, to]. */
export function localDaysIn(tz: string, from: Minute, to: Minute): number {
  const off = offsetAt(tz, from);
  const a = from + off;
  const b = to + off;
  const first = Math.ceil(a / DAY) * DAY;
  return Math.max(0, Math.floor((b - first) / DAY));
}

/**
 * v0.7.3 CS FTL.1.235(b)(3)(i): local nights at home base after a rotation, by its max time difference (rows ≤ 6,
 * ≤ 9, ≤ 12 h) and the hours since its first report (< 48, 48–71:59, 72–95:59, ≥ 96).
 */
export const TZ_NIGHTS: readonly (readonly [number, number, number, number])[] = [[2, 2, 3, 3], [2, 3, 3, 4], [2, 3, 4, 5]];
/** Local nights needed at base after a rotation (0 below a 4 h difference). */
export function tzNights(maxDiffH: number, hoursSinceReport: number): number {
  if (maxDiffH < 4) return 0;
  const row = TZ_NIGHTS[maxDiffH <= 6 ? 0 : maxDiffH <= 9 ? 1 : 2];
  return row[hoursSinceReport < 48 ? 0 : hoursSinceReport < 72 ? 1 : hoursSinceReport < 96 ? 2 : 3];
}
/** CS FTL.1.235(b)(4): local nights at home between alternating east/west rotations. */
export const TZ_ALTERNATE_NIGHTS = 3;

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
  /** v0.7.3 'sby': home standby (25 % duty; not rest). */
  kind: 'log' | 'duty' | 'pos' | 'sby';
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
  /** v0.7.3 share of the seg counted towards the 7/14/28-day duty windows (home standby 0.25; absent = 1). */
  share?: number;
  /** v0.7.3 planned extension; early start / late finish / night duty (CS FTL.1.235(a)). */
  ext?: boolean;
  early?: boolean;
  late?: boolean;
  night?: boolean;
  /** v0.7.3 a split duty (the 8 h standby threshold, CS FTL.1.225(b)). */
  split?: boolean;
  /** v0.7.3 called out from home standby that began then (the 18 h awake cap). */
  sbyFrom?: Minute;
  /** v0.9 a standby seg's kind (absent = home); on a called duty, the kind it was called from (§R.3). */
  sby?: StandbyKind;
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
  /** v0.7.3 recovery rests with 2 whole local days logged per month; key 0 = the first month tracked (absent: none checked). */
  twoDays?: Record<number, number>;
  /** v0.7.3 end of the last logged work (log segs older than the timeline window are not in it). */
  workEnd?: Minute;
  /** v0.7.3 the current rotation away from base and the last return from one ≥ 4 h away (CS FTL.1.235(b)). */
  rot?: { start: Minute; maxTz: number; dir: -1 | 0 | 1 };
  tzBack?: { back: Minute; nights: number; dir: -1 | 1 };
}

export type IssueCode = 'fdp' | 'rest' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'recovery' | 'rating' | 'location' | 'status' | 'overlap' | 'workBlock'
  /** v0.7.3 */
  | 'ext7d' | 'nightSectors' | 'lateEarly' | 'twoDays' | 'tzRest' | 'standby'
  /** v0.9 work on a planned day off (UPDATE-0.9.md §R.3; crew/dayPlan.ts offIssue). */
  | 'daysOff';

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
    // v0.7.3 home standby counts 25 % (CS FTL.1.225(b)(3)).
    const sh = x.share ?? 1;
    if (on7) {
      if (x.end <= a7 && x.start < a7 - 2 * DAY) on7 = false;
      else d7 += sh * Math.max(0, hi - Math.max(a7, x.start));
    }
    if (on14) {
      if (x.end <= a14 && x.start < a14 - 2 * DAY) on14 = false;
      else d14 += sh * Math.max(0, hi - Math.max(a14, x.start));
    }
    d28 += sh * Math.max(0, hi - Math.max(a28, x.start));
    if (x.end > a28 && x.end <= b) blk += x.block;
  }
  for (let k = i + 1; k < segs.length && segs[k].start < b; k++) {
    const x = segs[k];
    const hi = Math.min(b, x.end);
    const sh = x.share ?? 1;
    d7 += sh * Math.max(0, hi - Math.max(a7, x.start));
    d14 += sh * Math.max(0, hi - Math.max(a14, x.start));
    d28 += sh * Math.max(0, hi - Math.max(a28, x.start));
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
export function evalSegs(ctx: TimelineCtx, segsIn: Seg[]): LegalityIssue[] {
  const issues: LegalityIssue[] = [];
  const segs = standbyView(ctx, segsIn);
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
  // v0.7.3 two local days twice a month (ORO.FTL.235(d)): planned qualifying gaps per month; months checked from
  // the one after tracking began (ctx.twoDays[0]).
  const td = ctx.twoDays;
  const tdFrom = td?.[0] ?? Infinity;
  // Months before now's are never checked: gaps ending before it (less a day for the base clock) are skipped.
  const tdMin = !td ? Infinity : ctx.now !== undefined ? monthStartOf(ctx.now) - DAY : -Infinity;
  let tdPlanned: Map<number, number> | null = null;
  let tdChecked = -1;
  // v0.7.3 time-zone recovery (CS FTL.1.235(b)): the rotation under way and the last return.
  let rot = ctx.rot ? { ...ctx.rot } : null;
  let back = ctx.tzBack ? { ...ctx.tzBack } : null;
  let lastAwayDir: -1 | 0 | 1 = back?.dir ?? 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // Planned recovery gaps with 2 whole local days, by the month of the first whole day.
    if (td && s.kind !== 'log' && s.start >= tdMin) {
      const tdPrev = Math.max(prevEnd, ctx.workEnd ?? -Infinity);
      if (tdPrev > -Infinity && s.start - tdPrev >= LIMITS.recovery) {
        tdPlanned ??= new Map();
        for (const [mk, n] of twoDayCredits(ctx.base, tdPrev, s.start)) tdPlanned.set(mk, Math.min(2, (tdPlanned.get(mk) ?? 0) + n));
      }
    }
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
    // v0.7.3 a standby window already over is history (it still counts in the duty windows).
    const target = s.kind !== 'log' && !(s.kind === 'sby' && s.end <= (ctx.now ?? -Infinity)) && (firstFresh < 0 || !!s.fresh || (i > firstFresh && s.start < lastFreshEnd + 28 * DAY));
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
      } else {
        // After a logged duty: where they are now, or where its ticket home still to land takes them (v0.7.4 segsOf).
        const loc = p?.at || ctx.loc;
        if (loc && s.from && s.from !== loc && s.start > (ctx.now ?? Infinity)) pushIssue(issues, 'location', 'illegal', `At ${loc}, not ${s.from}`, tgt);
      }
      // The next seg must also respect this seg's rest (a later seg's start airport is checked as a target).
      const n = segs[i + 1];
      if (n && s.fresh && !n.fresh) {
        if (n.start < s.end) pushIssue(issues, 'overlap', 'illegal', 'Overlaps another duty', tgt);
        else if (n.start < s.end + s.rest) pushIssue(issues, 'rest', 'illegal', `Rest before next duty ${hm(n.start - s.end)} < ${hm(s.rest)}`, tgt);
      }
      if (s.kind === 'duty') {
        if (s.fdp > s.maxFdp) pushIssue(issues, 'fdp', 'illegal', `FDP ${hm(s.fdp)} > ${hm(s.maxFdp)}`, tgt);
        else if (s.fdp > s.maxFdp - LIMITS.tightFdp) pushIssue(issues, 'fdp', 'tight', `FDP ${hm(s.fdp)} of ${hm(s.maxFdp)}`, tgt);
        // v0.7.3 called from home standby: at most 18 h awake by the end of the FDP (woken an hour before standby).
        if (s.sbyFrom !== undefined) {
          // v0.9 airport standby: standby + FDP ≤ 16 h (CS FTL.1.225(a)); home and hotel: 18 h awake.
          if (s.sby === 'airport') {
            if (s.start + s.fdp - s.sbyFrom > STANDBY.airportTotal) pushIssue(issues, 'standby', 'illegal', `On airport standby from ${hm(localMin(ctx.base, s.sbyFrom))}: standby and duty over 16 h`, tgt);
          } else if (!standbyAwakeOk(s.sbyFrom, s.start + s.fdp)) pushIssue(issues, 'standby', 'illegal', `On standby from ${hm(localMin(ctx.base, s.sbyFrom))}: more than 18 h awake by the end of the day`, tgt);
        }
        // v0.7.3 planned extension: at most 2 in any 7 days per crew member (CS FTL.1.205(b)).
        if (s.ext) {
          let n = 0;
          for (let k = i; k >= 0 && segs[k].start > s.start - 7 * DAY; k--) if (segs[k].ext) n++;
          if (n > EXT_PER_WEEK) pushIssue(issues, 'ext7d', 'illegal', `Already ${EXT_PER_WEEK} extended days this week (the rule allows ${EXT_PER_WEEK} in any 7 days)`, tgt);
        }
      }
      // v0.7.3 the last duty before (log or planned): consecutive nights, late/night → early at home base.
      let pd: Seg | null = null;
      for (let k = i - 1; k >= 0; k--) if (segs[k].kind === 'duty' || segs[k].kind === 'log') { pd = segs[k]; break; }
      if (pd && s.kind === 'duty' && s.night && pd.night && s.sectors > NIGHT_MAX_SECTORS && s.start - pd.end < 2 * DAY) pushIssue(issues, 'nightSectors', 'illegal', `Consecutive night duties: at most ${NIGHT_MAX_SECTORS} sectors (this one has ${s.sectors})`, tgt);
      if (pd && (s.kind === 'duty' || s.kind === 'sby') && s.early && s.from === ctx.base && (pd.late || pd.night) && s.start - pd.end < 2 * DAY && nightsIn(ctx.base, segs[i - 1].end, s.start) < 1) {
        pushIssue(issues, 'lateEarly', 'illegal', 'Finished late and starts early: the rest must include a whole local night (8 h between 22:00 and 08:00)', tgt);
      }
      // v0.7.3 time-zone recovery at home base after a ≥ 4 h rotation (CS FTL.1.235(b)(3)(i)).
      if (back && s.start >= back.back && s.kind !== 'log' && nightsIn(ctx.base, back.back, s.start) < back.nights) {
        pushIssue(issues, 'tzRest', 'illegal', `Back from a trip across time zones: ${back.nights} local nights at home before the next duty`, tgt);
      }
      // v0.7.3 two local days twice a month: checked at the first work of a later month.
      if (td && s.kind !== 'log') {
        const ms = monthOf(s.start);
        // Past months are history: from the current month (and never the first month tracked) on.
        for (let m = Math.max(tdChecked + 1, tdFrom + 1, monthOf(ctx.now ?? s.start)); m < ms; m++) {
          tdChecked = m;
          if ((td[m] ?? 0) + (tdPlanned?.get(m) ?? 0) < 2) pushIssue(issues, 'twoDays', 'illegal', 'Twice a month crew need a weekend of 2 whole days off', tgt);
        }
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
    // Rotations of planned work: away from the end of a seg resting elsewhere, back when one ends at base.
    if (s.kind !== 'log' && s.at) {
      if (s.at !== ctx.base) {
        const dz = signedTz(ctx.base, s.at, s.end);
        if (!rot) {
          // Changing direction (both ≥ 4 h): 3 local nights at home between the rotations (CS FTL.1.235(b)(4)).
          rot = { start: s.start, maxTz: 0, dir: 0 };
          const dir = Math.abs(dz) >= 4 ? (Math.sign(dz) as -1 | 1) : 0;
          if (target && back && dir && lastAwayDir && dir !== lastAwayDir && nightsIn(ctx.base, back.back, s.start) < TZ_ALTERNATE_NIGHTS) {
            pushIssue(issues, 'tzRest', 'illegal', `Changing from ${lastAwayDir > 0 ? 'eastbound' : 'westbound'} to ${dir > 0 ? 'eastbound' : 'westbound'} needs ${TZ_ALTERNATE_NIGHTS} local nights at home in between`, s);
          }
        }
        if (Math.abs(dz) > rot.maxTz) {
          rot.maxTz = Math.abs(dz);
          rot.dir = Math.sign(dz) as -1 | 0 | 1;
        }
      } else if (rot) {
        if (rot.maxTz >= 4) {
          back = { back: s.end, nights: tzNights(rot.maxTz, (s.end - rot.start) / H), dir: rot.dir === 1 ? 1 : -1 };
          lastAwayDir = back.dir;
        }
        rot = null;
      }
    }
  }
  return issues;
}

/** v0.7.3 extended FDPs allowed per crew member in any 7 days. */
const EXT_PER_WEEK = 2;
/** UTC month key of t (year × 12 + month); the bounds of the last 4 months looked up are cached (evalSegs' hot path). */
const MO: { from: number; to: number; m: number }[] = [];
let mo = { from: 0, to: -1, m: 0 };
const monthOf = (t: Minute): number => {
  if (t >= mo.from && t < mo.to) return mo.m;
  for (const x of MO) if (t >= x.from && t < x.to) return (mo = x).m;
  const d = new Date(Date.UTC(2000, 0, 1) + t * 60_000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const base = Date.UTC(2000, 0, 1);
  mo = { from: (Date.UTC(y, m, 1) - base) / 60_000, to: (Date.UTC(y, m + 1, 1) - base) / 60_000, m: y * 12 + m };
  MO.unshift(mo);
  if (MO.length > 4) MO.pop();
  return mo.m;
};
/** Start (UTC minute) of t's month. */
const monthStartOf = (t: Minute): Minute => (monthOf(t), mo.from);
/**
 * v0.7.3 two-local-day recoveries a free stretch [from, to] gives, by month: its whole local days at `tz` counted per
 * month, two days making one (at most 2 a month); nothing when it holds fewer than 2 whole days.
 */
export function twoDayCredits(tz: string, from: Minute, to: Minute): Map<number, number> {
  const out = new Map<number, number>();
  const off = offsetAt(tz, from);
  const n = localDaysIn(tz, from, to);
  if (n < 2) return out;
  const first = Math.ceil((from + off) / DAY) * DAY - off;
  // The last 62 days at most (only the months near the end are checked), a month at a time.
  for (let k = Math.max(0, n - 62); k < n; ) {
    const mk = monthOf(first + k * DAY + 12 * H);
    const kEnd = Math.min(n, Math.ceil((mo.to - first - 12 * H) / DAY));
    if (kEnd - k >= 2) out.set(mk, Math.min(2, Math.floor((kEnd - k) / 2)));
    k = kEnd;
  }
  // A stretch whose days split 1 + 1 across two months still is one 2-day recovery (the month of its first day).
  if (!out.size) out.set(monthOf(first + 12 * H), 1);
  return out;
}
/** Signed zone difference of b vs a at t, hours in [−12, 12] (east +). */
export function signedTz(a: string, b: string, t: Minute): number {
  let d = (offsetAt(b, t) - offsetAt(a, t)) / H;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  return d;
}

/**
 * v0.7.3 standby in a timeline (CS FTL.1.225). v0.9 (§R.3): every kind (home, hotel, airport, reserve). Work being
 * planned (fresh, not standby) treats windows not started yet as replaceable: they are left out (the roster drops or
 * re-plans them; crew/standby.ts clearStandby), and a window running now that would cut the rest before that work ends
 * early. A running window a duty reports inside is a call-out: the standby counts until the report (no rest in
 * between); home and hotel standby shrink the max FDP beyond 6 h (8 h augmented or split; 23:00–07:00 before the call
 * not counted) with the 18 h awake cap, airport standby beyond 4 h with standby + FDP ≤ 16 h, reserve not at all (the
 * FDP counts from report). Unchanged without standby segs.
 */
function standbyView(ctx: TimelineCtx, segs: Seg[]): Seg[] {
  let any = false;
  for (const x of segs) if (x.kind === 'sby') { any = true; break; }
  if (!any) return segs;
  const now = ctx.now ?? -Infinity;
  let freshWork = false;
  for (const x of segs) if (x.fresh && x.kind !== 'sby') { freshWork = true; break; }
  const drop = new Set<number>();
  const called = new Map<number, number>();
  const cut = new Map<number, Minute>();
  const isWork = (y: Seg) => y.kind !== 'sby' && y.kind !== 'log';
  for (let i = 0; i < segs.length; i++) {
    const x = segs[i];
    if (x.kind !== 'sby' || x.fresh) continue;
    if (freshWork && ctx.now !== undefined && x.start > now) {
      drop.add(i);
      continue;
    }
    // Work overlapping the window (segs sorted by start: a few back, then forward while they start inside it).
    let w = -1;
    for (let k = i - 1; k >= 0 && k >= i - 4; k--) if (isWork(segs[k]) && segs[k].end > x.start) { w = k; break; }
    if (w < 0) for (let k = i + 1; k < segs.length && segs[k].start < x.end; k++) if (isWork(segs[k])) { w = k; break; }
    if (w < 0) {
      // A running window ends early for fresh work whose start its rest would cut.
      if (freshWork && x.end > now) {
        for (let k = i + 1; k < segs.length && segs[k].start < x.end + x.rest; k++) {
          if (!segs[k].fresh || !isWork(segs[k])) continue;
          const end = Math.max(now, segs[k].start - x.rest);
          if (end <= x.start) drop.add(i);
          else cut.set(i, end);
          break;
        }
      }
      continue;
    }
    const y = segs[w];
    if (x.start > now || y.kind !== 'duty' || y.start < x.start) drop.add(i);
    else called.set(i, w);
  }
  const out: Seg[] = [];
  const cutOf = new Map<number, Seg>();
  for (const [i, w] of called) {
    const x = segs[i];
    const y = segs[w];
    const kind = x.sby ?? 'home';
    if (kind === 'reserve') continue;
    const by = standbyCut(kind === 'airport' ? 'airport' : 'home', x.start, y.start, ctx.base, y.aug || !!y.split);
    cutOf.set(w, { ...y, maxFdp: y.maxFdp - by, sbyFrom: x.start, sby: kind });
  }
  for (let i = 0; i < segs.length; i++) {
    if (drop.has(i)) continue;
    const w = called.get(i);
    const c = cut.get(i);
    if (w !== undefined) out.push({ ...segs[i], end: segs[w].start, rest: 0 });
    else if (c !== undefined) out.push({ ...segs[i], end: c });
    else out.push(cutOf.get(i) ?? segs[i]);
  }
  return out;
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
