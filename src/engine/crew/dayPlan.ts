// v0.9 roster planning like a real EASA operator (UPDATE-0.9.md §R; EASA-FTL.md §16). A crew-planning department plans
// the minimum days off first (blocks of 2–3 days: about 9 a month, never below 7, each block also the weekly 36 h /
// 2-night recovery rest), 4 weeks' annual leave a year weighted to the winter, publishes the roster 14 days ahead
// (days off in it are protected), and puts everyone else who is not flying on standby: home standby at base (early
// 05–17 or late 12–24), hotel standby at a station away from base, airport standby at busy bases, or reserve where a
// standby would make the duty limits tight. Runs in crew/index.ts daily; all picks deterministic (crew id order,
// hashUnit ties), no RNG. Days are base-local day indices (k: local date k × DAY).

import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { DAY, daysInMonth, fmtDay, fromUTC, monthKey, monthStart, yearOf } from '../core/time';
import type { CrewMember, Duty, GameState, Minute, MonthKey, StandbyKind, StatsRoster09, StatsV09 } from '../core/types';
import { hash } from '../core/util';
import { moraleShock } from './morale';
import { evalSegs, offsetAt, type LegalityIssue, type Seg } from './rules';
import { noteRecovery, onStandby, pruneStandby } from './standby';
import { crewIx, ctxOf, locAt, segsOf, standbySeg, touchCrewState, typeIdOf } from './timeline';

const R = () => BAL.v09.roster;

/** hashUnit with a murmur finaliser: FNV-1a alone clusters on short similar keys ('off:c3', 'off:c4'). */
function hashUnit(key: string): number {
  let h = hash(key);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
type Window = NonNullable<CrewMember['standby']>[number];

// ---------- days ----------

/** Base-local day index of t (local date k ↔ UTC midnight k × DAY). */
export const dayIndex = (base: string, t: Minute): number => Math.floor((t + offsetAt(base, t)) / DAY);
/** UTC minute of local midnight starting day k at `base`. */
export function midnight(base: string, k: number): Minute {
  const t = k * DAY;
  return t - offsetAt(base, t - offsetAt(base, t));
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'Tue 4 Nov' for day k. */
export const dayLabel = (k: number): string => `${WD[new Date(Date.UTC(2000, 0, 1) + k * DAY * 60_000).getUTCDay()]} ${fmtDay(k * DAY)}`;
const monthOfDay = (k: number): MonthKey => monthKey(k * DAY);
const firstDayOf = (mk: MonthKey): number => monthStart(mk) / DAY;

/** End of the last published day (the roster the crew see: today + 13). Pure. */
export function publishedTo(g: GameState): Minute {
  const home = g.company.homeBase;
  return g.dayPlan?.publishedTo ?? midnight(home, dayIndex(home, g.now) + R().publishDays);
}
const firstPlanDay = (g: GameState, base: string): number => (g.dayPlan ? dayIndex(base, g.dayPlan.from) : Infinity);

/** Binary search: is local day k in c's planned days off. */
export function offOn(c: CrewMember, k: number): boolean {
  const a = c.off;
  if (!a?.length) return false;
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < k) lo = m + 1;
    else hi = m;
  }
  return lo < a.length && a[lo] === k;
}

function addOff(c: CrewMember, days: number[]): void {
  const s = new Set(c.off ?? []);
  for (const k of days) s.add(k);
  c.off = [...s].sort((a, b) => a - b);
}

function removeOff(c: CrewMember, days: number[]): void {
  if (!c.off) return;
  const s = new Set(days);
  c.off = c.off.filter((k) => !s.has(k));
}

/** Is crew member `crewId` rostered OFF on t's base-local day. Pure. */
export function isOff(g: GameState, crewId: string, t: Minute): boolean {
  const c = g.crew[crewId];
  return !!c && offOn(c, dayIndex(c.base, t));
}

/** Days off that work [start, end) would take: the local days it touches, and the day before a morning start before 06:00. */
export function offDaysHit(c: CrewMember, start: Minute, end: Minute): number[] {
  if (!c.off?.length) return [];
  const a = dayIndex(c.base, start - R().off.morningFree);
  const b = dayIndex(c.base, end - 1);
  const out: number[] = [];
  for (const k of c.off) {
    if (k > b) break;
    if (k >= a) out.push(k);
  }
  return out;
}

/** v0.9 work [from, to) would take one of c's published days off (only the player does that: R.5). Pure. */
export function takesPublishedOff(g: GameState, c: CrewMember, from: Minute, to: Minute): boolean {
  const hits = offDaysHit(c, from, to);
  if (!hits.length) return false;
  const pub = dayIndex(c.base, publishedTo(g));
  return hits.some((k) => k < pub);
}

const isWorkSeg = (x: Seg) => x.kind === 'duty' || x.kind === 'pos' || x.kind === 'sby';

/** Days off taken by the fresh work segs of a plan (sorted, unique). */
function hitsOf(c: CrewMember, segs: Seg[]): number[] {
  const s = new Set<number>();
  for (const x of segs) if (isWorkSeg(x)) for (const k of offDaysHit(c, x.start, x.end)) s.add(k);
  return [...s].sort((a, b) => a - b);
}

/** Days off counted in month mk: planned ones, plus (old saves) free days before v0.9 planned them. */
function offsIn(g: GameState, c: CrewMember, mk: MonthKey, busy?: Busy): number {
  const a = firstDayOf(mk);
  const b = firstDayOf(mk + 1);
  let n = 0;
  for (const k of c.off ?? []) if (k >= a && k < b) n++;
  const from = firstPlanDay(g, c.base);
  const start = dayIndex(c.base, g.started);
  if (from > a && busy) for (let k = Math.max(a, start); k < Math.min(b, from); k++) if (!busy.work.has(k) && !busy.sby.has(k) && !blockedOn(c, k)) n++;
  return n;
}

/**
 * v0.9 the 'daysOff' issue for fresh work on planned days off (§R.3): illegal when the month would fall below 7 with no
 * unpublished day left in it to move the day off to, else tight (the auto-roster never takes one: check.ts acceptable).
 */
export function offIssue(g: GameState, c: CrewMember, segs: Seg[]): LegalityIssue | null {
  if (!c.off?.length) return null;
  const fresh = segs.filter((x) => x.fresh && isWorkSeg(x));
  if (!fresh.length) return null;
  const hits = hitsOf(c, fresh);
  if (!hits.length) return null;
  const v = breakView(g, c, hits);
  const dutyId = fresh.find((x) => offDaysHit(c, x.start, x.end).length)?.dutyId;
  return { code: 'daysOff', level: v.legal ? 'tight' : 'illegal', text: v.issue, dutyId };
}

/**
 * v0.9 fix: the legal floor as a hard limit on placing work. Fresh work (a tour crewed weeks ahead, a run of day
 * trips) must leave each month it touches enough free days to still reach 7 days off: its planned days off plus the
 * free days the planner has not reached yet (it turns them into days off). Illegal otherwise ('daysOff'). Pure.
 */
export function monthFloorIssue(g: GameState, c: CrewMember, base: Seg[], fresh: Seg[]): LegalityIssue | null {
  if (!g.dayPlan || !c.off) return null;
  const work = fresh.filter(isWorkSeg);
  if (!work.length) return null;
  const today = dayIndex(c.base, g.now);
  const from = firstPlanDay(g, c.base);
  const hit = new Set(hitsOf(c, work));
  const months = new Set<MonthKey>();
  for (const x of work) for (let k = dayIndex(c.base, x.start); k <= dayIndex(c.base, x.end - 1); k++) months.add(monthOfDay(k));
  let busy: Busy | null = null;
  for (const mk of months) {
    const a = firstDayOf(mk);
    const b = firstDayOf(mk + 1);
    // A month the crew member joined in is not counted (as the month-end count: dayPlanMonth).
    if (b <= today || a < from || midnight(c.base, a) < c.hired) continue;
    // v0.9.1: on the month's last day only work that takes one of its days off is weighed (seed 6: a crew-control fix
    // on 31 January took a purser's last two days off and left the month at 6; the last day was never counted).
    if (b <= today + 1 && ![...hit].some((k) => k >= a && k < b)) continue;
    let n = 0;
    for (const k of c.off) if (k >= a && k < b && !hit.has(k)) n++;
    // Most months already hold their 7 planned (8–10): nothing to count.
    if (n >= R().off.legalMonth) continue;
    const legal = legalFor(g, c, mk);
    if (n >= legal) continue;
    busy ??= busyDays(c, [...base, ...work].sort((x, y) => x.start - y.start), today - 45, b + 1);
    // Only days the planner has not reached yet count: a free planned day is standby (topUpOffs turns those into days
    // off while the month can still use them; counting them here let a tour use the room they were counted on).
    const open = g.dayPlan.planned !== undefined ? dayIndex(c.base, g.dayPlan.planned) : today + 1;
    for (let k = Math.max(a, today + 1, open); k < b && n < legal; k++) if (!offOn(c, k) && !busy.hit.has(k) && !blockedOn(c, k)) n++;
    if (n < legal) return { code: 'daysOff', level: 'illegal', text: `Days off in ${MONTH[mk % 12]} would fall to ${n} (minimum ${legal})`, dutyId: work[0].dutyId };
  }
  // Round 4: the year must still reach its 96 (pro rata): what c holds plus the free days the planner has not reached
  // yet. Cheap first (every day left counted free); the day-by-day count only when that is not enough (year end).
  const open = g.dayPlan.planned !== undefined ? dayIndex(c.base, g.dayPlan.planned) : today + 1;
  for (const y of new Set([...months].map((mk) => Math.floor(mk / 12)))) {
    const v = yearView(g, c, y);
    if (v.from >= v.y1 || v.y1 <= today + 1) continue;
    const lo = Math.max(open, today + 1, v.from);
    if (v.y1 - lo >= v.need) continue;
    const held = yearOffs(g, c, v, hit);
    if (held + Math.max(0, v.y1 - lo) >= v.need) continue;
    const yb = busyDays(c, [...base, ...work].sort((x, y) => x.start - y.start), lo, v.y1 + 1);
    let n = held;
    for (let k = lo; k < v.y1 && n < v.need; k++) if (!offOn(c, k) && !yb.hit.has(k) && !blockedOn(c, k)) n++;
    if (n < v.need) return { code: 'daysOff', level: 'illegal', text: `Days off in ${y} would fall to ${n} (minimum ${v.need})`, dutyId: work[0].dutyId };
  }
  return null;
}

/**
 * v0.9 round 4 fix r2 (§R.16.6): the floor on work already rostered. A month that can no longer reach its 7 (planned days
 * off plus every free day left, standby days included: topUpOffs turns those into days off) gets one back through the
 * first duty of the trip reporting before 06:00 whose eve is free of all other work: that duty carries the 'daysOff'
 * issue, the roster takes the crew member off it (Crew Control re-crews the seat as any other limit) and the eve
 * becomes the day off. Only an eve from tomorrow on: a month found short on its last day stays as it is. Pure.
 */
export function eveFloorIssue(g: GameState, c: CrewMember, duties: Duty[], segs: Seg[]): LegalityIssue | null {
  const mf = R().off.morningFree;
  return floorThrough(g, c, duties, segs, (d) => {
    const k = dayIndex(c.base, d.report - mf);
    return k === dayIndex(c.base, d.report) ? null : k;
  });
}

/**
 * v0.9.1: the same floor when no early duty has a free eve (seed 3: a tour that grew by three days at the end of the
 * month left its crew 6 days off with no early report in it). The duty whose own day (to 06:00 the morning after) is
 * free of all other work carries the issue: the roster takes the crew member off it and that day becomes the day off.
 * Asked only after eveFloorIssue found none. Pure.
 */
export function dayFloorIssue(g: GameState, c: CrewMember, duties: Duty[], segs: Seg[]): LegalityIssue | null {
  return floorThrough(g, c, duties, segs, (d) => dayIndex(c.base, d.report));
}

function floorThrough(g: GameState, c: CrewMember, duties: Duty[], segs: Seg[], dayOf: (d: Duty) => number | null): LegalityIssue | null {
  if (!g.dayPlan || !c.off) return null;
  const mf = R().off.morningFree;
  const today = dayIndex(c.base, g.now);
  const from = firstPlanDay(g, c.base);
  let busy: Busy | null = null;
  let counted: { mk: MonthKey; n: number; legal: number } | null = null;
  // v0.9 round 5: of the duties that qualify, the one furthest ahead in its month (the seat it empties has the most
  // time to be re-crewed; the first one was emptied a day or two out, where nobody legal could reach it).
  let pick: LegalityIssue | null = null;
  let pickMk: MonthKey = -1;
  for (const d of duties) {
    // Not the first duty of a longer trip: the crew would come off the whole trip (its positioning is the eve's work).
    if (d.done || d.report <= g.now || (d === duties[0] && duties.length > 1)) continue;
    const k = dayOf(d);
    if (k === null || k <= today || offOn(c, k) || blockedOn(c, k)) continue;
    const mk = monthOfDay(k);
    const a = firstDayOf(mk);
    const b = firstDayOf(mk + 1);
    // A month not counted at its close (joined in it, before the planner) asks nothing.
    if (a < from || midnight(c.base, a) < c.hired) continue;
    if (!counted || counted.mk !== mk) {
      let n = 0;
      for (const o of c.off) if (o >= a && o < b) n++;
      // v0.9.1 speed: a month already holding 7 planned days off needs no day count (outside December the legal floor is
      // at most 7: legalFor); most rechecks of rostered work stop here.
      if (n >= R().off.legalMonth && mk % 12 !== 11) {
        counted = { mk, n, legal: R().off.legalMonth };
        continue;
      }
      busy ??= busyDays(c, segs, today, b + 31);
      for (let x = Math.max(a, today + 1); x < b; x++) if (!offOn(c, x) && !busy.hit.has(x) && !blockedOn(c, x)) n++;
      counted = { mk, n, legal: legalFor(g, c, mk) };
    }
    if (counted.n >= counted.legal) continue;
    // Free of everything but this duty (its own positioning goes with it; a standby window gives way to a day off).
    const m0 = midnight(c.base, k);
    const m1 = m0 + DAY + mf;
    if (segs.some((x) => x.kind !== 'log' && x.kind !== 'sby' && x.dutyId !== d.id && x.start < m1 && x.end > m0)) continue;
    const issue: LegalityIssue = { code: 'daysOff', level: 'illegal', text: `Days off in ${MONTH[mk % 12]} would fall to ${counted.n} (minimum ${counted.legal})`, dutyId: d.id };
    if (pick && pickMk !== mk) return pick;
    pick = issue;
    pickMk = mk;
  }
  return pick;
}

/**
 * v0.9 can the planner move the days off fresh work lands on (a tour, a trip of several days) without the month
 * losing them: each month touched keeps at least the planner's minimum (8) counting days that can still be moved
 * to an unpublished day of the same month. Pure, cheap (no timeline).
 */
export function offMovable(g: GameState, c: CrewMember, segs: Seg[], tour = false): boolean {
  const fresh = segs.filter((x) => x.fresh && isWorkSeg(x));
  const hits = hitsOf(c, fresh);
  if (!hits.length) return true;
  // A published day off is the crew member's (R.5): the planner never moves one for a trip, only the player (a
  // confirm). A detachment (tour) may: the crew are asked to swap it (morale −3, takeOffDays).
  if (!tour && hits[0] < dayIndex(c.base, publishedTo(g))) return false;
  const soon = dayIndex(c.base, g.now) + 2;
  const byMonth = new Map<MonthKey, number[]>();
  for (const k of hits) byMonth.set(monthOfDay(k), [...(byMonth.get(monthOfDay(k)) ?? []), k]);
  const busy = busyDays(c, segs, soon, hits[hits.length - 1] + 40);
  for (const [mk, ks] of byMonth) {
    // Free days left in the month (not off, not work, not leave) to take the days back.
    let room = 0;
    for (let k = Math.max(soon, firstDayOf(mk)); k < firstDayOf(mk + 1) && room < ks.length; k++) if (!offOn(c, k) && !busy.hit.has(k) && !blockedOn(c, k)) room++;
    const lost = Math.max(0, ks.length - room);
    if (lost && offsIn(g, c, mk) - lost < minFor(g, c, mk)) return false;
  }
  return true;
}

/**
 * v0.9 round 3 crew control's day-off swap: short-notice work that nobody without a change can take may land on a
 * published day off when the crew member agrees to swap it (BAL.v09.roster.swap): work reporting within 72 h, morale
 * ≥ 50, not asked in the last 14 days, the day off not starting within 12 h, and every month touched keeps its days off on free days of its own
 * (offMovable, as a tour's). The swap itself is takeOffDays (planner): morale −3, the day moved inside its month. Pure.
 */
export function offSwappable(g: GameState, c: CrewMember, segs: Seg[]): boolean {
  const S = R().swap;
  if (c.morale < S.minMorale || c.status === 'joining' || c.notice) return false;
  if (c.offSwapAt !== undefined && g.now - c.offSwapAt < S.everyDays * DAY) return false;
  const fresh = segs.filter((x) => x.fresh && isWorkSeg(x));
  if (fresh.length && fresh[0].start > g.now + S.horizonH * 60) return false;
  const hits = hitsOf(c, fresh);
  if (!hits.length) return true;
  if (midnight(c.base, hits[0]) < g.now + S.noticeH * 60) return false;
  return offMovable(g, c, segs, true);
}

/**
 * The month's minimum days off for c: 8 (the planner's floor), pro rata in a month partly on leave or sick; v0.9 round 5:
 * raised (to the cap at most) when the calendar year's 96 pro rata is behind its pace, so a hire's short month is made
 * up in the months left rather than found at the December close (yearPaceMin).
 */
function minFor(g: GameState, c: CrewMember, mk: MonthKey): number {
  const a = firstDayOf(mk);
  const b = firstDayOf(mk + 1);
  let away = 0;
  for (let k = a; k < b; k++) if (blockOn(c, k)) away++;
  const base = Math.ceil((R().off.minMonth * (b - a - away)) / (b - a));
  return Math.max(base, Math.min(R().off.maxMonth, yearPaceMin(g, c, mk)));
}

/**
 * v0.9 round 5: the days off month mk must hold for the year to reach its 96 pro rata: what is still needed after the
 * months before it (closed counts, planned days off, leave and sickness) and the leave and sick days ahead, spread over
 * the months left. 0 when the year asks nothing of this month. Pure.
 */
export function yearPaceMin(g: GameState, c: CrewMember, mk: MonthKey): number {
  // A cache of a pure function (offNeed asks for every crew member and day): the inputs are the identities the engine
  // replaces on a change (c.off, blocks, the month counts) and the day; a reload computes the same value.
  const day = dayIndex(c.base, g.now);
  const key = `${c.id}:${mk}`;
  let memo = paceMemo.get(g);
  if (!memo) paceMemo.set(g, (memo = new Map()));
  const hit = memo.get(key);
  if (hit && hit.off === c.off && hit.blocks === c.blocks && hit.om === c.offMonths && hit.fm === c.freeMonths && hit.day === day && hit.hired === c.hired) return hit.v;
  const v = yearPaceMinRaw(g, c, mk);
  memo.set(key, { off: c.off, blocks: c.blocks, om: c.offMonths, fm: c.freeMonths, day, hired: c.hired, v });
  return v;
}
const paceMemo = new WeakMap<GameState, Map<string, { off: unknown; blocks: unknown; om: unknown; fm: unknown; day: number; hired: number; v: number }>>();

function yearPaceMinRaw(g: GameState, c: CrewMember, mk: MonthKey): number {
  const v = yearView(g, c, Math.floor(mk / 12));
  const a = firstDayOf(mk);
  if (v.from >= v.y1 || a < v.from) return 0;
  const cur = monthOfDay(dayIndex(c.base, g.now));
  let held = 0;
  for (let m = monthOfDay(v.from); m < mk; m++) {
    if (m < cur) {
      held += (c.offMonths?.[m] ?? 0) + (c.freeMonths?.[m] ?? 0);
      continue;
    }
    for (const k of c.off ?? []) if (k >= firstDayOf(m) && k < firstDayOf(m + 1)) held++;
    held += freeDaysIn(c, m);
  }
  let ahead = 0;
  for (let m = mk; m < monthOfDay(v.y1); m++) ahead += freeDaysIn(c, m);
  const monthsLeft = monthOfDay(v.y1) - mk;
  return monthsLeft > 0 ? Math.ceil((v.need - held - ahead) / monthsLeft) : 0;
}

/** Leave and sick days (free of all duty) in month m, the days blockOn gives a block (its 6 h tolerance at both ends). */
function freeDaysIn(c: CrewMember, m: MonthKey): number {
  if (!c.blocks?.length) return 0;
  const a = firstDayOf(m);
  const b = firstDayOf(m + 1);
  let n = 0;
  for (const x of c.blocks) {
    if (x.why !== 'leave' && x.why !== 'sick') continue;
    n += Math.max(0, Math.min(b - 1, dayIndex(c.base, x.to - 6 * 60 - 1)) - Math.max(a, dayIndex(c.base, x.from + 6 * 60)) + 1);
  }
  return n;
}

/**
 * The legal floor (7), pro rata in a month partly on leave, sick or joining. v0.9 round 5: in the last month the calendar
 * year counts for c, what the year's 96 pro rata still needs (yearPaceMin: the closed months, leave and sickness
 * counted) is the month's floor too, so a short year is made whole by its last month and not found one day short at
 * the December close (a hire counted for two months needs 16: a 7 in November leaves 9 for December).
 */
export function legalFor(g: GameState, c: CrewMember, mk: MonthKey): number {
  const a = firstDayOf(mk);
  const b = firstDayOf(mk + 1);
  let away = 0;
  for (let k = a; k < b; k++) if (blockOn(c, k)) away++;
  const base = Math.ceil((R().off.legalMonth * (b - a - away)) / (b - a));
  if (mk % 12 !== 11 || !g.dayPlan) return base;
  return Math.max(base, Math.min(b - a - away, yearPaceMin(g, c, mk)));
}

/**
 * v0.9 round 4 the 96 free days a year (Directive 2000/79/EC; BAL yearMin), pro rata: counted from the first month
 * dayPlanMonth records for c (wholly after the hire and the first planned day), so `from` ≥ 1 January.
 */
interface YearView { y0: number; y1: number; from: number; need: number }
function yearView(g: GameState, c: CrewMember, year: number): YearView {
  const y0 = fromUTC(year, 1, 1) / DAY;
  const y1 = fromUTC(year + 1, 1, 1) / DAY;
  // The first whole day after the hire (dayPlanMonth skips a month whose first midnight is before it).
  const first = Math.max(firstPlanDay(g, c.base), dayIndex(c.base, c.hired - 1) + 1);
  const m = monthOfDay(first);
  const from = Math.max(y0, firstDayOf(first > firstDayOf(m) ? m + 1 : m));
  // Rounded down (Directive 2000/79 counts whole days of a calendar year): a crew member counted for one month needs
  // 8 (96 × 31 / 365 = 8.2), the planner's floor; round 4: a 2–3-month hire is no longer judged one day short.
  return { y0, y1, from, need: Math.floor((R().off.yearMin * Math.max(0, y1 - from)) / (y1 - y0)) };
}

/**
 * Free days of the year c holds: the closed months' counts (offMonths and freeMonths: leave and sickness are days
 * free of all duty too), and for the months not closed the planned days off (less `hit`) and the leave and sick
 * blocks (old blocks are pruned: crew/index.ts, hence freeMonths). The free unplanned days left are not in it.
 */
function yearOffs(g: GameState, c: CrewMember, v: YearView, hit?: Set<number>): number {
  if (v.from >= v.y1) return 0;
  const cur = monthOfDay(dayIndex(c.base, g.now));
  let n = 0;
  for (let m = monthOfDay(v.from); m < monthOfDay(v.y1); m++) {
    if (m < cur) {
      n += (c.offMonths?.[m] ?? 0) + (c.freeMonths?.[m] ?? 0);
      continue;
    }
    const a = firstDayOf(m);
    const b = firstDayOf(m + 1);
    for (const k of c.off ?? []) if (k >= a && k < b && !hit?.has(k)) n++;
  }
  const open = Math.max(v.from, firstDayOf(Math.max(cur, monthOfDay(v.from))));
  for (const x of c.blocks ?? []) {
    if (x.why !== 'leave' && x.why !== 'sick') continue;
    // The days blockOn gives the block (its 6 h tolerance at both ends).
    n += Math.max(0, Math.min(v.y1 - 1, dayIndex(c.base, x.to - 6 * 60 - 1)) - Math.max(open, dayIndex(c.base, x.from + 6 * 60)) + 1);
  }
  return n;
}

interface BreakView { legal: boolean; published: boolean; issue: string; first: number; movesTo: number | null }

function breakView(g: GameState, c: CrewMember, hits: number[], exact = false): BreakView {
  const pub = dayIndex(c.base, publishedTo(g));
  const first = hits[0];
  const published = hits.some((k) => k < pub);
  const mk = monthOfDay(first);
  const inMonth = hits.filter((k) => monthOfDay(k) === mk).length;
  // An unpublished day left in the month takes the day off back; else the month loses it.
  const lastDay = firstDayOf(mk + 1) - 1;
  // The roster's checks only need whether the month keeps its count (an unpublished day left in it); a view or a
  // break names the day.
  const movesTo = exact ? replacementDay(g, c, hits, mk) : null;
  const keeps = exact ? movesTo !== null && monthOfDay(movesTo) === mk : lastDay >= Math.max(pub, hits[hits.length - 1] + 1);
  const after = offsIn(g, c, mk) - (keeps ? 0 : inMonth);
  // Days of the month not planned yet can still take days off.
  const planned = g.dayPlan?.planned !== undefined ? dayIndex(c.base, g.dayPlan.planned) : pub;
  const open = Math.max(0, lastDay + 1 - Math.max(planned, firstDayOf(mk)));
  const legal = after + open >= R().off.legalMonth;
  const issue = !legal
    ? `Days off in ${MONTH[mk % 12]} would fall to ${after} (minimum ${R().off.legalMonth})`
    : `Day off ${dayLabel(first)}${published ? ' (published)' : ' (not published yet: it moves)'}`;
  return { legal, published, issue, first, movesTo };
}

/** The first free unpublished day in month mk (then the next month) a broken day off moves to; null when none. */
function replacementDay(g: GameState, c: CrewMember, taken: number[], mk: MonthKey, segs?: Seg[]): number | null {
  const pub = dayIndex(c.base, publishedTo(g));
  const soon = dayIndex(c.base, g.now) + 2;
  const busy = busyDays(c, segs ?? segsOf(g, c), soon, pub + 62);
  const skip = new Set(taken);
  const free = (k: number, capped: boolean) => !skip.has(k) && !offOn(c, k) && !busy.hit.has(k) && !blockedOn(c, k) && (!capped || !offRunOver(c, k, 1));
  // An unpublished day of the month first, then a free (standby) day of the published roster (one more day off at
  // short notice is no hardship), then the next month. Round 5: a day joining a run of days off longer than 3 only
  // when no other day would keep the count (the floor is law, the cap a preference).
  for (const capped of [true, false]) {
    for (let k = Math.max(pub, firstDayOf(mk)); k < firstDayOf(mk + 1); k++) if (free(k, capped)) return k;
    for (let k = Math.max(soon, firstDayOf(mk)); k < Math.min(pub, firstDayOf(mk + 1)); k++) if (free(k, capped)) return k;
  }
  for (let k = Math.max(pub, firstDayOf(mk + 1)); k < firstDayOf(mk + 2); k++) if (free(k, true)) return k;
  return null;
}

export interface OffBreak { day: Minute; protected: boolean; legal: boolean; text: string; morale: number; movesTo: Minute | null }

/**
 * What putting work [from, to) on crew member `crewId` does to their days off: null when none is touched. A published
 * day off is protected (a confirm, morale −6); an unpublished one simply moves. Pure.
 */
export function offBreak(g: GameState, crewId: string, from: Minute, to: Minute): OffBreak | null {
  const c = g.crew[crewId];
  if (!c) return null;
  const hits = offDaysHit(c, from, to);
  if (!hits.length) return null;
  const v = breakView(g, c, hits, true);
  const morale = v.published ? R().morale.broken : 0;
  const text = !v.legal
    ? `${v.issue}: illegal`
    : v.published
      ? `Takes ${c.first}'s day off ${dayLabel(v.first)}${v.movesTo !== null ? `; it moves to ${dayLabel(v.movesTo)}` : ''} (morale −${Math.abs(morale)})`
      : `Day off ${dayLabel(v.first)} moves${v.movesTo !== null ? ` to ${dayLabel(v.movesTo)}` : ''} (not published yet)`;
  return { day: midnight(c.base, v.first), protected: v.published, legal: v.legal, text, morale, movesTo: v.movesTo === null ? null : midnight(c.base, v.movesTo) };
}

/**
 * v0.9 work was placed on c's days off (a confirmed board move, a call-in on a day off, a manual assignment): the days
 * go, each published one costs morale −6 (Stats offBroken), and each is re-planned on the first free unpublished day of
 * its month (the next month when none is left). Returns the moves as [from, to | null] day indices.
 */
export function takeOffDays(g: GameState, c: CrewMember, segs: Seg[], planner = false): [number, number | null][] {
  const hits = hitsOf(c, segs);
  if (!hits.length) return [];
  const pub = dayIndex(c.base, publishedTo(g));
  removeOff(c, hits);
  const moves: [number, number | null][] = [];
  const all = mergeSorted(segsOf(g, c), segs);
  // One break per change, however many published days it touches (a 05:00 report takes the day off before's
  // morning too): the −6 the confirm shows.
  let broke = false;
  for (const k of hits) {
    // The planner's own move (a tour crewed over its days off: the day moves to a free one, no morale); a player's or
    // a call-in's break of a published day costs morale. A published day the planner moves for a detachment is never
    // silent: the crew member is asked to swap it (morale −3, once a change).
    if (planner) {
      rosterStats(g).offMoved = (rosterStats(g).offMoved ?? 0) + 1;
      if (k < pub && !broke) {
        broke = true;
        moraleShock(g, c, 'daysOff', R().swap.morale);
        c.offSwapAt = g.now;
        rosterStats(g).offSwaps = (rosterStats(g).offSwaps ?? 0) + 1;
      }
    } else if (k < pub && !broke) {
      broke = true;
      moraleShock(g, c, 'daysOff', R().morale.broken);
      rosterStats(g).offBroken++;
    }
    const to = replacementDay(g, c, hits, monthOfDay(k), all);
    if (to !== null) {
      addOff(c, [to]);
      clearDays(g, c, to, to + 1);
    }
    moves.push([k, to]);
  }
  touchCrewState(g);
  return moves;
}

/** Two seg lists as one, by start (the work just placed may not be in the timeline index yet). */
const mergeSorted = (a: Seg[], b: Seg[]): Seg[] => [...a, ...b].sort((x, y) => x.start - y.start);

/** Standby windows not started on days [a, b) (and the morning after) give way to days off. */
function clearDays(g: GameState, c: CrewMember, a: number, b: number): void {
  if (!c.standby) return;
  const from = midnight(c.base, a);
  const to = midnight(c.base, b) + R().off.morningFree;
  const keep = c.standby.filter((w) => w.calledAt !== undefined || w.from <= g.now || w.to <= from || w.from >= to);
  if (keep.length === c.standby.length) return;
  if (keep.length) c.standby = keep;
  else delete c.standby;
}

// ---------- per-crew day facts ----------

interface Busy {
  /** Days a day off can't take (work touching it, or the 06:00 morning after). */
  hit: Set<number>;
  /** Days with duty or travel. */
  work: Set<number>;
  /** Days with a standby window starting. */
  sby: Set<number>;
}

function busyDays(c: CrewMember, segs: Seg[], from: number, to: number): Busy {
  const hit = new Set<number>();
  const work = new Set<number>();
  const sby = new Set<number>();
  const mf = R().off.morningFree;
  for (const x of segs) {
    if (x.kind === 'sby') {
      const k = dayIndex(c.base, x.start);
      if (k >= from && k <= to) sby.add(k);
      continue;
    }
    const a = dayIndex(c.base, x.start);
    const b = dayIndex(c.base, x.end - 1);
    if (b < from - 1 || a > to) continue;
    for (let k = Math.max(a, from); k <= Math.min(b, to); k++) work.add(k);
    for (let k = Math.max(dayIndex(c.base, x.start - mf), from); k <= Math.min(b, to); k++) hit.add(k);
  }
  return { hit, work, sby };
}

/**
 * v0.9 round 5: a block of days off is at most 3 days (BAL off.block[1]) unless on leave: would making days [k, k+m)
 * off join a run longer than that (the days off already planned on either side counted)?
 */
export function offRunOver(c: CrewMember, k: number, m: number): boolean {
  let n = m;
  for (let x = k - 1; offOn(c, x); x--) n++;
  for (let x = k + m; offOn(c, x); x++) n++;
  return n > R().off.block[1];
}

type BlockWhy = 'sick' | 'leave' | 'training' | 'joining';
function blockOn(c: CrewMember, k: number): BlockWhy | null {
  if (!c.blocks) return null;
  const a = midnight(c.base, k);
  const b = a + DAY;
  for (const x of c.blocks) if (x.from < b - 6 * 60 && x.to > a + 6 * 60) return x.why;
  return null;
}
const blockedOn = (c: CrewMember, k: number) => blockOn(c, k) !== null;
/** Leave, sickness and joining reset the work-day count; training is work. */
const resets = (w: BlockWhy | null) => w === 'leave' || w === 'sick' || w === 'joining';

/** A pre-game pattern (2 days off in 7, phase by crew id) so a new company's crews start staggered. */
const virtualOff = (c: CrewMember, k: number) => (k + Math.floor(hashUnit(`off:${c.id}`) * 7)) % 7 < 2;

/** Work days in a row before day D (standby, duty, travel and training count; days off, leave and sickness reset). */
function runBefore(g: GameState, c: CrewMember, b: Busy, D: number): number {
  const today = dayIndex(c.base, g.now);
  const start = dayIndex(c.base, g.started);
  const from = firstPlanDay(g, c.base);
  let run = 0;
  for (let k = D - 1; k >= D - 14; k--) {
    if (offOn(c, k) || resets(blockOn(c, k))) break;
    if (k < start) {
      if (virtualOff(c, k)) break;
      run++;
    } else if (k < from) {
      if (!b.work.has(k) && !b.sby.has(k) && !blockedOn(c, k)) break;
      run++;
    } else if (k >= today || b.work.has(k) || b.sby.has(k) || blockedOn(c, k)) run++;
  }
  return run;
}

/** Runs of planned days off (2 or more days) starting in month mk. */
function blocksIn(c: CrewMember, mk: MonthKey): number {
  const a = firstDayOf(mk);
  const b = firstDayOf(mk + 1);
  let n = 0;
  for (let i = 0; i < (c.off?.length ?? 0); i++) {
    const k = c.off![i];
    if (k < a || k >= b || offOn(c, k - 1)) continue;
    if (offOn(c, k + 1)) n++;
  }
  return n;
}

// ---------- stats ----------

const ZERO_ROSTER = (): StatsRoster09 => ({ offDays: 0, sbyHome: 0, sbyHotel: 0, asby: 0, res: 0, leaveDays: 0, flying: 0, otherDays: 0, callOuts: 0, offBroken: 0, offBreaches: 0, maxRecGapH: 0, months: 0, monthsLow: 0 });

/** The v0.9 stats block (zeros on first use) and its §R part. */
export function v09Stats(g: GameState): StatsV09 {
  return (g.stats.v09 ??= { legalStreak: 0, cover: {}, slips: 0, oohRed: 0, oohAmber: 0, discretionUsed: 0, discretionRefused: 0, headHandled: 0, headMistakes: 0, jumboLoads: 0, lateGovPaid: 0, cOnTime: 0 });
}
export function rosterStats(g: GameState): StatsRoster09 {
  return (v09Stats(g).roster ??= ZERO_ROSTER());
}

// ---------- annual leave ----------

/** Family-and-role groups a crew member belongs to. */
const groupsOf = (c: CrewMember): string[] => c.ratings.map((f) => `${f}|${c.role}`);

/**
 * v0.9 annual leave (§R.3.1): 28 days a year in quarter blocks weighted to the ACMI low season (10/4/4/10), pro rata in
 * a partial year, never inside the published roster. Each block starts where its family-and-role group has the fewest
 * on leave and the family the fewest departures, at most max(1, ⌈10 %⌉) of the group away on any day; days that do not
 * fit carry to the next quarter. Ties by hashUnit(crew id + year + quarter). Leave never moves by itself.
 */
export function planLeave(g: GameState, year: number, crewIds?: string[]): number {
  const L = R().leave;
  const home = g.company.homeBase;
  // Never inside the published roster (at a new game: the first 14 days it is about to publish).
  const pub = Math.max(dayIndex(home, publishedTo(g)), dayIndex(home, g.now) + R().publishDays);
  const y0 = fromUTC(year, 1, 1) / DAY;
  const y1 = fromUTC(year + 1, 1, 1) / DAY;
  if (pub >= y1) return 0;
  const all = Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1));
  // On leave per group and day, and group sizes.
  const size = new Map<string, number>();
  const load = new Map<string, Int16Array>();
  const loadOf = (key: string) => load.get(key) ?? load.set(key, new Int16Array(y1 - y0 + 1)).get(key)!;
  for (const c of all) {
    if (c.notice) continue;
    for (const key of groupsOf(c)) size.set(key, (size.get(key) ?? 0) + 1);
    for (const b of c.blocks ?? []) {
      if (b.why !== 'leave') continue;
      for (const key of groupsOf(c)) {
        const arr = loadOf(key);
        for (let k = Math.max(y0, dayIndex(c.base, b.from)); k < Math.min(y1, dayIndex(c.base, b.to - 1) + 1); k++) arr[k - y0]++;
      }
    }
  }
  // Departures per family and day (the signed work the leave should avoid).
  const reports = new Map<string, Int16Array>();
  for (const f of Object.values(g.flights)) {
    if (f.kind === 'deadhead' || f.status !== 'scheduled' || !f.aircraftId) continue;
    const k = dayIndex(home, f.std);
    if (k < y0 || k >= y1) continue;
    const ac = g.fleet[f.aircraftId];
    if (!ac) continue;
    const fam = typeOf(ac.typeId).family;
    const arr = reports.get(fam) ?? reports.set(fam, new Int16Array(y1 - y0 + 1)).get(fam)!;
    arr[k - y0]++;
  }
  const want = new Set(crewIds ?? all.map((c) => c.id));
  let planned = 0;
  for (const c of all) {
    if (!want.has(c.id) || c.notice || (c.leaveYear ?? 0) >= year) continue;
    const joins = c.status === 'joining' ? dayIndex(c.base, c.blocks?.find((b) => b.why === 'joining')?.to ?? c.hired) + 1 : 0;
    const first = Math.max(pub, y0, joins);
    if (first >= y1) {
      c.leaveYear = year;
      continue;
    }
    const segs = segsOf(g, c);
    const busy = busyDays(c, segs, first, y1);
    // Round 5: a deployment tour keeps its crew at the station from its first duty to its last, so leave never lands
    // between two of its duties (the daily re-check would split the tour and re-crew its later part).
    for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
      if (!q.tour || q.status === 'done' || q.status === 'broken') continue;
      for (let k = Math.max(first, dayIndex(c.base, q.start)); k <= Math.min(y1 - 1, dayIndex(c.base, q.end - 1)); k++) busy.work.add(k);
    }
    const caps = groupsOf(c).map((key) => ({ arr: loadOf(key), cap: Math.max(1, Math.ceil(L.maxShare * (size.get(key) ?? 1))) }));
    const rep = c.ratings.map((f) => reports.get(f));
    const fits = (s: number, len: number): number => {
      // Score: group load and departures; Infinity over the cap, on work already planned or another block.
      let score = 0;
      for (let k = s; k < s + len; k++) {
        if (busy.work.has(k) || blockedOn(c, k)) return Infinity;
        for (const { arr, cap } of caps) {
          if (arr[k - y0] + 1 > cap) return Infinity;
          score += arr[k - y0] * 10;
        }
        for (const r of rep) score += r ? r[k - y0] : 0;
      }
      return score;
    };
    const place = (lo: number, hi: number, len: number, q: number): boolean => {
      let best = Infinity;
      const ties: number[] = [];
      for (let s = lo; s + len <= hi; s++) {
        const v = fits(s, len);
        if (v < best) {
          best = v;
          ties.length = 0;
        }
        if (v === best && v < Infinity) ties.push(s);
      }
      if (!ties.length) return false;
      const s = ties[Math.floor(hashUnit(`${c.id}${year}${q}`) * ties.length)];
      (c.blocks ??= []).push({ from: midnight(c.base, s), to: midnight(c.base, s + len), why: 'leave', annual: true });
      for (const { arr } of caps) for (let k = s; k < s + len; k++) arr[k - y0]++;
      removeOff(c, Array.from({ length: len }, (_, i) => s + i));
      clearDays(g, c, s, s + len);
      return true;
    };
    // Quarter blocks (shorter when the group is full, the rest carried on), then what is left anywhere in the year.
    let carry = 0;
    let total = 0;
    for (let q = 0; q < 4; q++) {
      const q0 = fromUTC(year, q * 3 + 1, 1) / DAY;
      const q1 = fromUTC(year + (q === 3 ? 1 : 0), q === 3 ? 1 : q * 3 + 4, 1) / DAY;
      const lo = Math.max(q0, first);
      const target = Math.round((L.quarters[q] * Math.max(0, q1 - lo)) / (q1 - q0)) + carry;
      carry = target;
      if (target < 3) continue;
      let days = target;
      while (days >= 3 && !place(lo, q1, days, q)) days--;
      if (days < 3) continue;
      total += days;
      carry = target - days;
    }
    for (let n = carry; n >= 3; n--) {
      if (!place(first, y1, n, 4)) continue;
      total += n;
      break;
    }
    if (total) planned++;
    c.leaveYear = year;
  }
  if (planned) touchCrewState(g);
  return planned;
}

// ---------- days off ----------

/**
 * v0.9 round 3 the stagger: at most this share of a family-and-role group is off on any day of a due block (a must
 * block, the 7th work day or the month's minimum, always goes). 30 % is the 9-in-30 average: a group of 10 has 3 off.
 */
const OFF_SHARE = 0.3;

/** Reports per family, role and station on day D (seats of the duties reporting then). */
function needOn(g: GameState, D: number): Map<string, number> {
  const home = g.company.homeBase;
  const a = midnight(home, D);
  const b = a + DAY;
  const out = new Map<string, number>();
  for (const p of crewIx(g).byAircraft.values()) {
    for (const q of p) {
      if (q.status === 'done' || q.status === 'broken' || q.end < a || q.start >= b) continue;
      const fam = typeOf(typeIdOf(g, q)).family;
      for (const id of q.dutyIds) {
        const d = g.duties[id];
        if (!d || d.done || d.report < a || d.report >= b) continue;
        const st = g.flights[d.flightIds[0]]?.from ?? d.restAt;
        for (const s of q.slots) if (!s.above) out.set(`${fam}|${s.role}|${st}`, (out.get(`${fam}|${s.role}|${st}`) ?? 0) + 1);
      }
    }
  }
  return out;
}

/**
 * v0.9 days off for every day up to the roster horizon not planned yet (§R.3.2): per crew member, a block of 2 (3 when
 * behind the pace for 9) from D when it is due (5 work days in a row, or behind the pace) or a must (6 in a row, or the
 * month would end below 8, or without its two 2-day blocks). A due block waits a day when it would leave the
 * family-and-role at that station below D's reports + 1. Only free days become days off; a must block that finds D
 * taken goes on the first two free days after it.
 */
export function planOffDays(g: GameState): void {
  const dp = g.dayPlan;
  if (!dp) return;
  const home = g.company.homeBase;
  const last = dayIndex(home, g.now + BAL.rosterHorizonDays * DAY);
  const today = Math.max(dayIndex(home, dp.from), dayIndex(home, g.now));
  let D = Math.max(dayIndex(home, dp.planned ?? dp.from), today);
  const crew = Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1));
  // Crew never planned (added since the last run: a joiner, a transfer) catch up from today.
  const fresh = new Set(crew.filter((c) => c.off === undefined).map((c) => c.id));
  const from = fresh.size ? today : D;
  if (from > last) return;
  const facts = new Map<string, { segs: Seg[]; busy: Busy }>();
  for (const c of crew) {
    const segs = segsOf(g, c);
    facts.set(c.id, { segs, busy: busyDays(c, segs, from - 45, last + 40) });
  }
  for (let X = from; X < D && X <= last; X++) planDay(g, X, crew, facts, fresh);
  for (; D <= last; D++) planDay(g, D, crew, facts);
  for (const c of crew) c.off ??= [];
  dp.planned = midnight(home, last + 1);
  touchCrewState(g);
}

/** One crew member's days-off need on day D (null: no block wanted). */
interface OffNeed {
  c: CrewMember;
  must: boolean;
  /** Due (5 in a row, behind the pace) or, one day before that, early (only to level the group: see planDay). */
  early: boolean;
  run: number;
  /** Days off still short of the pace for the target (higher: more urgent). */
  behindBy: number;
  len: number;
}

// Round 4 fix r2: tour crews plan like everyone else (aiming at the cap with an earlier block cost seed 1 twice the
// shortages: the sets' crews were off when their wave needed them; UPDATE-0.9.md §R.16.6).
function offNeed(g: GameState, c: CrewMember, D: number, busy: Busy): OffNeed | null {
  const O = R().off;
  const run = runBefore(g, c, busy, D);
  const mk = monthOfDay(D);
  const m0 = firstDayOf(mk);
  const m1 = firstDayOf(mk + 1);
  const mDays = daysInMonth(mk);
  const offs = offsIn(g, c, mk, busy);
  let before = 0;
  for (const k of c.off ?? []) if (k >= m0 && k < D) before++;
  before += offs - (c.off ?? []).filter((k) => k >= m0 && k < m1).length;
  let freeLeft = 0;
  for (let k = D; k < m1; k++) if (!offOn(c, k) && !busy.hit.has(k) && !blockedOn(c, k)) freeLeft++;
  const dom = D - m0 + 1;
  const pace = (O.targetMonth * dom) / mDays;
  const minM = minFor(g, c, mk);
  const missing = minM - offs;
  const blocks = blocksIn(c, mk);
  // v0.9 round 4: a block already planned within the next days (a must that found D taken and went on the first
  // free days after it) answers the run, and one inside this month its pace too: no second block stacks behind
  // it. The month's minimum still asks for its own (a block ahead may sit in the next month).
  let ahead = false;
  let aheadInMonth = false;
  for (let k = D + 1; k <= D + 10 && !ahead; k++) if (offOn(c, k)) {
    ahead = true;
    aheadInMonth = k < m1;
  }
  // Must: the 7th work day, the month's minimum no longer reachable otherwise, or falling behind the minimum's
  // pace (work rostered later can fill the month's last days: the minimum is kept on pace, not left to the end).
  const must = (!ahead && run >= O.mustAfter) || (missing > 0 && freeLeft <= missing + 1) || (blocks < 2 && (2 - blocks) * 2 + 1 >= freeLeft)
    || (!aheadInMonth && before < Math.floor((minM * dom) / mDays) - 1);
  // Behind the target's pace counts from the second week (on day 1 every crew member would be "behind" on the
  // same day and the whole company would go off together).
  const behind = dom >= 8 && before < pace - 1.5;
  const due = (!ahead && run >= O.dueAfter) || (!aheadInMonth && behind);
  const early = !must && !due && !ahead && run >= O.dueAfter - 1;
  if (!must && !due && !early) return null;
  if (!must && offs >= O.maxMonth) return null;
  let len = before + 2 < (O.targetMonth * (dom + 2)) / mDays - 1 ? O.block[1] : O.block[0];
  if (!must) len = Math.min(len, O.maxMonth - offs);
  if (len < O.block[0]) {
    if (!must) return null;
    len = O.block[0];
  }
  return { c, must, early, run, behindBy: pace - before, len };
}

function planDay(g: GameState, D: number, crew: CrewMember[], facts: Map<string, { segs: Seg[]; busy: Busy }>, only?: Set<string>): void {
  const O = R().off;
  // Reports and crew available per family|role|station on D (built on first use).
  const cov: { need: Map<string, number> | null; avail: Map<string, number> | null } = { need: null, avail: null };
  const stationOf = (c: CrewMember) => locAt(c, facts.get(c.id)!.segs, midnight(c.base, D) + 6 * 60);
  const short = (c: CrewMember): boolean => {
    if (!cov.need) {
      cov.need = needOn(g, D);
      const av = (cov.avail = new Map<string, number>());
      for (const x of crew) {
        if (offOn(x, D) || blockedOn(x, D) || x.status === 'joining') continue;
        const st = stationOf(x);
        for (const f of x.ratings) av.set(`${f}|${x.role}|${st}`, (av.get(`${f}|${x.role}|${st}`) ?? 0) + 1);
      }
    }
    const st = stationOf(c);
    return c.ratings.some((f) => {
      const n = cov.need!.get(`${f}|${c.role}|${st}`) ?? 0;
      return n > 0 && (cov.avail!.get(`${f}|${c.role}|${st}`) ?? 0) - 1 < n + 1;
    });
  };
  // Group sizes and who is off on D, D+1 and D+2 (the stagger looks at every day of a block).
  const SPAN = O.block[1];
  const size = new Map<string, number>();
  const offAt: Map<string, number>[] = Array.from({ length: SPAN }, () => new Map());
  for (const x of crew) {
    if (x.status === 'joining' && blockedOn(x, D)) continue;
    for (const k of groupsOf(x)) {
      size.set(k, (size.get(k) ?? 0) + 1);
      for (let j = 0; j < SPAN; j++) if (offOn(x, D + j)) offAt[j].set(k, (offAt[j].get(k) ?? 0) + 1);
    }
  }
  const cap = (k: string) => Math.max(1, Math.ceil(OFF_SHARE * (size.get(k) ?? 1) - 1e-9));
  const room = (c: CrewMember, len: number) => groupsOf(c).every((k) => {
    for (let j = 0; j < Math.min(len, SPAN); j++) if ((offAt[j].get(k) ?? 0) >= cap(k)) return false;
    return true;
  });
  // Who wants a block from D: musts first (they always go), then the most urgent (longest run, furthest behind).
  const needs: OffNeed[] = [];
  for (const c of crew) {
    if ((only && !only.has(c.id)) || offOn(c, D) || blockedOn(c, D) || (c.notice && midnight(c.base, D) >= c.notice.leaves)) continue;
    const n = offNeed(g, c, D, facts.get(c.id)!.busy);
    if (n) needs.push(n);
  }
  needs.sort((a, b) => Number(b.must) - Number(a.must) || Number(a.early) - Number(b.early) || b.run - a.run || b.behindBy - a.behindBy
    || hashUnit(`${a.c.id}:${D}`) - hashUnit(`${b.c.id}:${D}`));
  // Crew who will be due within a day per group, not placed yet (an early block levels the days they would crowd).
  const pending = new Map<string, number>();
  for (const n of needs) if (!n.must) for (const k of groupsOf(n.c)) pending.set(k, (pending.get(k) ?? 0) + 1);
  for (const n of needs) {
    const { c, must } = n;
    let len = n.len;
    const { busy } = facts.get(c.id)!;
    if (!must) for (const k of groupsOf(c)) pending.set(k, (pending.get(k) ?? 1) - 1);
    if (!must && n.run === O.dueAfter && short(c)) continue;
    // Staggered: a due block waits while its group already has its share off on a day of the block.
    if (!must && !room(c, len)) {
      if (len > O.block[0] && room(c, O.block[0])) len = O.block[0];
      else continue;
    }
    // Early (one day before due): only while the group's next days cannot hold everyone due by then.
    if (n.early && !groupsOf(c).some((k) => (pending.get(k) ?? 0) + 1 > (cap(k) - (offAt[1].get(k) ?? 0)) + (cap(k) - (offAt[2 % SPAN].get(k) ?? 0)))) continue;
    // Round 5: a block joins no run of days off longer than 3 (`capped`); a must that fits nowhere else may (the
    // floor is law, the cap a preference).
    const fits = (k: number, m: number, capped = true) => {
      for (let i = k; i < k + m; i++) if (offOn(c, i) || busy.hit.has(i) || blockedOn(c, i)) return false;
      return !capped || !offRunOver(c, k, m);
    };
    let at: number | null = null;
    if (fits(D, len)) at = D;
    else if (len > O.block[0] && fits(D, O.block[0])) {
      at = D;
      len = O.block[0];
    } else if (must) {
      for (const capped of [true, false]) {
        len = O.block[0];
        for (let k = D + 1; k <= D + 10; k++) if (fits(k, len, capped)) { at = k; break; }
        // No two free days together: a single day off (1 day and 2 local nights) keeps the count.
        if (at === null) {
          len = 1;
          for (let k = D; k <= D + 6; k++) if (fits(k, 1, capped)) { at = k; break; }
        }
        if (at !== null) break;
      }
    }
    if (at === null) continue;
    const days = Array.from({ length: len }, (_, i) => at! + i);
    addOff(c, days);
    for (const k of groupsOf(c)) for (const d of days) if (d - D >= 0 && d - D < SPAN) offAt[d - D].set(k, (offAt[d - D].get(k) ?? 0) + 1);
    clearDays(g, c, at, at + len);
    const av = cov.avail as Map<string, number> | null;
    if (av) for (const f of c.ratings) {
      const key = `${f}|${c.role}|${stationOf(c)}`;
      av.set(key, (av.get(key) ?? 1) - 1);
    }
  }
}

// ---------- standby ----------

/** Where the crew member is at `t` per their timeline (base when unknown). */
const whereAt = (c: CrewMember, segs: Seg[], t: Minute) => locAt(c, segs, t) || c.base;

interface DayFacts {
  /** Reports at a station on the day: early (before 12:00 local) and late, per role. */
  early: Map<string, number>;
  late: Map<string, number>;
  /** Round 5: the day's first report at a station (any role), and per station|role the seats reporting before the default standby window can reach them (preBefore). */
  first: Map<string, Minute>;
  pre: Map<string, number>;
  /** Round 5: windows already placed that start before the kind's default start, per station|role (the early cover). */
  preShifts: Map<string, number>;
  /** Our departures 05:00–10:00 local per station|family, and the first of them. */
  wave: Map<string, { n: number; first: Minute }>;
  /** Home windows already on the day per station|role|shift; airport windows per station|family|role. */
  shifts: Map<string, number>;
  airport: Map<string, number>;
}

/** Day facts for days [X0, X1] in one pass over the pairings and windows (v0.9 speed: was one pass per day). */
function dayFactsAll(g: GameState, X0: number, X1: number): Map<number, DayFacts> {
  const home = g.company.homeBase;
  const a = midnight(home, X0);
  const b = midnight(home, X1 + 1);
  const out = new Map<number, DayFacts>();
  const of = (X: number) => out.get(X) ?? out.set(X, { early: new Map(), late: new Map(), first: new Map(), pre: new Map(), preShifts: new Map(), wave: new Map(), shifts: new Map(), airport: new Map() }).get(X)!;
  for (let X = X0; X <= X1; X++) of(X);
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const A = R().airport;
  const preBefore = preBeforeMin();
  for (const list of crewIx(g).byAircraft.values()) {
    for (const p of list) {
      if (p.status === 'done' || p.status === 'broken' || p.end < a || p.start >= b + DAY) continue;
      const fam = typeOf(typeIdOf(g, p)).family;
      for (const id of p.dutyIds) {
        const d = g.duties[id];
        if (!d || d.done) continue;
        const fl = g.flights[d.flightIds[0]];
        const st = fl?.from ?? d.restAt;
        const X = dayIndex(st, d.report);
        if (X < X0 || X > X1) continue;
        const f = of(X);
        const loc = (d.report + offsetAt(st, d.report)) % DAY;
        for (const s of p.slots) if (!s.above) inc(loc < 12 * 60 ? f.early : f.late, `${st}|${s.role}`);
        if (d.report < (f.first.get(st) ?? Infinity)) f.first.set(st, d.report);
        if (loc < preBefore) for (const s of p.slots) if (!s.above) inc(f.pre, `${st}|${s.role}`);
        if (fl) {
          const dl = (fl.std + offsetAt(st, fl.std)) % DAY;
          if (dl >= A.waveFrom && dl < A.waveEnd) {
            // Round 4: the wave is the station's (every family: the cabin seat covers them all); per family its first departure.
            for (const key of [`${st}|${fam}`, `${st}|*`]) {
              const w = f.wave.get(key) ?? { n: 0, first: Infinity };
              w.n++;
              w.first = Math.min(w.first, fl.std);
              f.wave.set(key, w);
            }
          }
        }
      }
    }
  }
  for (const c of Object.values(g.crew)) {
    for (const w of c.standby ?? []) {
      const X = dayIndex(c.base, w.from);
      if (X < X0 || X > X1) continue;
      const f = of(X);
      const st = w.at ?? c.base;
      if (w.kind === 'airport') {
        for (const fam of c.ratings) inc(f.airport, `${st}|${fam}|${asbyRole(c.role)}`);
        inc(f.airport, `${st}|*|${asbyRole(c.role)}`);
      }
      else if ((w.kind ?? 'home') === 'home') inc(f.shifts, `${st}|${c.role}|${w.shift ?? shiftOf(c, w)}`);
      if (w.kind !== 'airport' && w.kind !== 'reserve' && isPre(c, w)) inc(f.preShifts, `${st}|${c.role}`);
    }
  }
  return out;
}

/** Round 5: a report before this station-local minute needs standby that starts before the default window does. */
function preBeforeMin(): number {
  const S = R();
  return Math.max(S.hotel.from + S.hotel.readyMin, S.home.early[0] + S.home.readyMin) + S.earlyCover.slackMin;
}
/** A home or hotel window starting before its kind's default start (station-local): the early cover. */
function isPre(c: CrewMember, w: Window): boolean {
  const S = R();
  const at = w.at ?? c.base;
  return localMinAt(at, w.from) < ((w.kind ?? 'home') === 'hotel' ? S.hotel.from : S.home.early[0]);
}
const localMinAt = (code: string, t: Minute): number => (t + offsetAt(code, t)) % DAY;

/** v0.9 round 3: airport standby is 1 CPT, 1 FO and 1 cabin crew: a purser counts as the cabin seat (was one each). */
const asbyRole = (r: CrewMember['role']): string => (r === 'PUR' ? 'CC' : r);

const shiftOf = (c: CrewMember, w: Window): 'E' | 'L' => ((w.from + offsetAt(c.base, w.from)) % DAY < 12 * 60 ? 'E' : 'L');

/** The window of day X before clipping, by kind and shift (home base-local; hotel station-local). */
/**
 * Round 4: airport standby at a busy morning wave at `at` (the station's departures of every family, 05:00–12:00): 1 CPT
 * and 1 FO per family with a departure in it, 1 cabin crew per station; null when the wave is small or the seats are
 * taken. At home base and at a deployment station alike (the waves are mostly at the stations of our base programmes).
 */
function asbyWindow(c: CrewMember, at: string, f: DayFacts): Window | null {
  const S = R();
  const sw = f.wave.get(`${at}|*`);
  const cabin = c.role === 'PUR' || c.role === 'CC';
  const per = S.airport.per[cabin ? 'CC' : c.role] ?? 0;
  if (!sw || sw.n < S.airport.minWave || per <= 0) return null;
  for (const fam of c.ratings) {
    const wave = f.wave.get(`${at}|${fam}`);
    if (!wave) continue;
    const key = cabin ? `${at}|*|CC` : `${at}|${fam}|${c.role}`;
    if ((f.airport.get(key) ?? 0) >= per) continue;
    const from = (cabin ? sw.first : wave.first) - S.airport.leadMin;
    return { from, to: from + S.airport.hours * 60, kind: 'airport', ...(at !== c.base ? { at } : {}) };
  }
  return null;
}

function rawWindow(c: CrewMember, X: number, at: string, f: DayFacts, prevShift: 'E' | 'L' | null): { w: Window; kind: StandbyKind } {
  const S = R();
  const m = midnight(c.base, X);
  // Round 5: the early cover. A station whose day's first report comes before the default window plus the response
  // time can reach it gets, per role, one standby per seat reporting that early, starting (response time + slack)
  // before that report; starting between 23:00 and 07:00, the night is not counted towards the call-out cut until
  // contacted (CS FTL.1.225(b)(5)). After a day off the window still opens at 06:00 (planStandby clips it).
  const earlyFrom = (dflt: Minute, ready: number): Minute => {
    const first = f.first.get(at);
    if (first === undefined || (f.pre.get(`${at}|${c.role}`) ?? 0) <= (f.preShifts.get(`${at}|${c.role}`) ?? 0)) return dflt;
    return Math.min(dflt, first - ready - S.earlyCover.slackMin);
  };
  if (at !== c.base) {
    // Round 4: a station with a morning wave puts a crew at the airport first; else hotel standby.
    const asby = asbyWindow(c, at, f);
    if (asby) return { w: asby, kind: 'airport' };
    const ms = midnight(at, dayIndex(at, m + 12 * 60));
    const from = earlyFrom(ms + S.hotel.from, S.hotel.readyMin);
    return { w: { from, to: from + (S.hotel.to - S.hotel.from), kind: 'hotel', at }, kind: 'hotel' };
  }
  // Early or late: keep the work block's shift, else the one with fewer crew per report.
  let shift: 'E' | 'L';
  if (prevShift) shift = prevShift;
  else {
    const e = ((f.shifts.get(`${at}|${c.role}|E`) ?? 0) + 1) / ((f.early.get(`${at}|${c.role}`) ?? 0) + 1);
    const l = ((f.shifts.get(`${at}|${c.role}|L`) ?? 0) + 1) / ((f.late.get(`${at}|${c.role}`) ?? 0) + 1);
    shift = e < l ? 'E' : l < e ? 'L' : hashUnit(`${c.id}:${X}`) < 0.5 ? 'E' : 'L';
  }
  if (shift === 'E') {
    // Airport standby at a busy morning wave, from the early shift (asbyWindow).
    const asby = asbyWindow(c, at, f);
    if (asby) return { w: asby, kind: 'airport' };
  }
  const [a, b] = shift === 'E' ? S.home.early : S.home.late;
  const from = shift === 'E' ? earlyFrom(m + a, S.home.readyMin) : m + a;
  return { w: { from, to: from + (b - a), shift }, kind: 'home' };
}

/** Issues a fresh window brings (new ones only, against the timeline without it). */
function windowIssues(g: GameState, c: CrewMember, segs: Seg[], w: Window, base: () => Set<string>): { illegal: boolean; tight: boolean } {
  const seg = standbySeg(c, w, undefined, true);
  const test = insert(segs, seg);
  let illegal = false;
  let tight = false;
  for (const i of evalSegs(ctxOf(g, c), test)) {
    if (i.level === 'legal' || i.code === 'fdp') continue;
    if (i.dutyId && base().has(`${i.dutyId}:${i.code}:${i.level}`)) continue;
    if (i.level === 'illegal') illegal = true;
    else if (i.code === 'duty7d' || i.code === 'duty14d' || i.code === 'duty28d') tight = true;
  }
  return { illegal, tight };
}

function insert(segs: Seg[], x: Seg): Seg[] {
  let i = segs.length;
  while (i > 0 && (segs[i - 1].start > x.start || (segs[i - 1].start === x.start && segs[i - 1].end > x.end))) i--;
  return [...segs.slice(0, i), x, ...segs.slice(i)];
}

/** Rest an uncalled window of this kind asks for before the next work. */
const restOf = (c: CrewMember, w: Window) => standbySeg(c, w).rest;

/** v0.9 speed: per game, crew whose timeline (this signature) was checked clean. A cache of a pure check. */
const cleanMemo = new WeakMap<GameState, Map<string, string>>();
function cleanSig(c: CrewMember, segs: Seg[], now: Minute): string {
  // The timeline from `now` on: history only drops out (lower cumulative duty); what it leaves for the future is in
  // rest and recovery. Stored for the next day's check (its now).
  let s = `${c.lastRecovery}|${c.restUntil}|${c.loc}`;
  for (const x of segs) if (x.end > now) s += `|${x.kind}${x.start}-${x.end}${x.fresh ? 'f' : ''}`;
  return s;
}

/**
 * v0.9 standby for every published day from today (§R.3.4): each crew member free on the day (not off, on leave, sick,
 * in training or joining, no duty or ticket touching it) gets one window, by where they are at 06:00: home standby at
 * base (early or late, the work block's shift kept), airport standby from the early shift where a family has 6 or more
 * morning departures, hotel standby at a station away from base. A window starts after the rest from earlier work (and
 * after 06:00 following a day off) and ends early enough for the full rest before the next; under 4 h it is not
 * rostered. One that would make the duty limits tight, or illegal, becomes reserve; an illegal reserve is not
 * rostered ('Rest (limits)'). Windows starting within 36 h are re-checked the same way.
 */
export function planStandby(g: GameState): void {
  const dp = g.dayPlan;
  if (!dp) return;
  const home = g.company.homeBase;
  const S = R();
  const today = dayIndex(home, g.now);
  const lastPub = today + S.publishDays - 1;
  dp.publishedTo = Math.max(dp.publishedTo, midnight(home, lastPub + 1));
  const from = Math.max(today, dayIndex(home, dp.from));
  let facts: Map<number, DayFacts> | null = null;
  const factsOf = (X: number) => (facts ??= dayFactsAll(g, from, lastPub)).get(X)!;
  let changed = false;
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.status === 'joining' && !c.blocks?.some((b) => b.why === 'joining')) continue;
    let segs = segsOf(g, c);
    let baseIssues: Set<string> | null = null;
    const base = () => (baseIssues ??= new Set(evalSegs(ctxOf(g, c), segs).filter((i) => i.dutyId).map((i) => `${i.dutyId}:${i.code}:${i.level}`)));
    // Windows not started yet make way for work planned or moved since (a delay, a new trip): clipped to start after
    // its rest and end early enough for their own, dropped under 4 h.
    if (c.standby?.some((w) => w.calledAt === undefined && w.from > g.now)) {
      const work = segs.filter((x) => x.kind !== 'sby' && x.kind !== 'log');
      let clipped = false;
      const keep: Window[] = [];
      for (const w of c.standby) {
        if (w.calledAt !== undefined || w.from <= g.now) {
          keep.push(w);
          continue;
        }
        let a = Math.max(w.from, c.restUntil);
        let b = w.to;
        const r = restOf(c, w);
        for (const y of work) {
          if (y.start >= b + r || y.end + y.rest <= a) continue;
          if (y.start >= a) b = Math.min(b, y.start - r);
          else a = Math.max(a, y.end + y.rest);
        }
        if (a === w.from && b === w.to) keep.push(w);
        else {
          clipped = true;
          if (b - a >= S.home.minH * 60) keep.push({ ...w, from: a, to: b });
        }
      }
      if (clipped) {
        if (keep.length) c.standby = keep;
        else delete c.standby;
        segs = segsOf(g, c);
        changed = true;
      }
    }
    // Future windows behind a limit (work planned around them since: a tour that grew, a re-plan) are fitted again.
    // v0.9 speed: a timeline with no issue at all needs no window-by-window check below.
    let clean = false;
    // v0.9 speed: a timeline found clean on an earlier day and unchanged since stays clean (no full check again).
    const sig = cleanSig(c, segs, g.now);
    if (cleanMemo.get(g)?.get(c.id) === sig) clean = true;
    else if (c.standby?.some((w) => w.calledAt === undefined && w.from > g.now)) {
      const all = evalSegs(ctxOf(g, c), segs);
      if (all.some((i) => i.level === 'illegal' && i.code !== 'location' && i.code !== 'fdp')) {
        fitStandby(g, [c.id]);
        segs = segsOf(g, c);
        changed = true;
      } else {
        baseIssues = new Set(all.filter((i) => i.dutyId).map((i) => `${i.dutyId}:${i.code}:${i.level}`));
        clean = all.every((i) => i.level === 'legal');
      }
    }
    // Windows starting within 36 h: still legal with everything planned since?
    for (const w of clean ? [] : [...(c.standby ?? [])]) {
      if (w.calledAt !== undefined || w.from <= g.now || w.from > g.now + 36 * 60) continue;
      const rest = segs.filter((x) => !(x.kind === 'sby' && x.start === w.from));
      const v = windowIssues(g, c, rest, w, base);
      if (!v.illegal && !(v.tight && w.kind !== 'reserve')) continue;
      const r: Window = { from: w.from, to: w.to, kind: 'reserve', ...(w.at ? { at: w.at } : {}) };
      const ok = w.kind !== 'reserve' && !windowIssues(g, c, rest, r, base).illegal;
      c.standby = c.standby!.filter((x) => x !== w);
      if (ok) c.standby.push(r);
      if (!c.standby.length) delete c.standby;
      segs = ok ? insert(rest, standbySeg(c, r)) : rest;
      changed = true;
    }
    let prevShift: 'E' | 'L' | null = null;
    // v0.9 speed: only the work and windows inside the published days are looked at day by day.
    const span0 = midnight(c.base, from);
    const span1 = midnight(c.base, lastPub + 1);
    const work = segs.filter((x) => x.kind !== 'sby' && x.end > span0 && x.start < span1);
    for (let X = from; X <= lastPub; X++) {
      const m = midnight(c.base, X);
      const m1 = midnight(c.base, X + 1);
      if (offOn(c, X) || blockedOn(c, X) || (c.notice && m >= c.notice.leaves)) {
        prevShift = null;
        continue;
      }
      const has = c.standby?.find((w) => w.from >= m && w.from < m1);
      if (has) {
        prevShift = (has.kind ?? 'home') === 'home' ? has.shift ?? shiftOf(c, has) : null;
        continue;
      }
      if (work.some((x) => x.start < m1 && x.end > m)) {
        prevShift = null;
        continue;
      }
      const at = whereAt(c, segs, m + 6 * 60);
      const f = factsOf(X);
      const raw = rawWindow(c, X, at, f, prevShift);
      // Clip: after the rest from earlier work (06:00 after a day off), before the rest the next work needs.
      let a = raw.w.from;
      let ready = c.restUntil;
      for (const x of segs) if (x.kind !== 'log' && x.end <= raw.w.to && x.start < raw.w.from) ready = Math.max(ready, x.end + x.rest);
      a = Math.max(a, ready, g.now);
      if (offOn(c, X - 1)) a = Math.max(a, m + S.off.morningFree);
      const next = segs.find((x) => x.kind !== 'log' && x.start >= a);
      let b = raw.w.to;
      if (next) b = Math.min(b, next.start - restOf(c, raw.w));
      let w: Window | null = b - a >= S.home.minH * 60 ? { ...raw.w, from: a, to: b } : null;
      if (w) {
        const v = windowIssues(g, c, segs, w, base);
        if (v.illegal || v.tight) {
          // Reserve: the day from the end of the rest to the next work (no rest of its own after it).
          const ra = Math.max(m, ready, g.now);
          const rb = next ? Math.min(m1, next.start) : m1;
          const r: Window = { from: ra, to: rb, kind: 'reserve', ...(at !== c.base ? { at } : {}) };
          w = rb - ra >= S.home.minH * 60 && !windowIssues(g, c, segs, r, base).illegal ? r : null;
        }
      }
      if (!w) {
        prevShift = null;
        continue;
      }
      (c.standby ??= []).push(w);
      if (w.kind === 'reserve') clean = false;
      segs = insert(segs, standbySeg(c, w));
      baseIssues = null;
      changed = true;
      const kind = w.kind ?? 'home';
      if (kind !== 'airport' && kind !== 'reserve' && isPre(c, w)) f.preShifts.set(`${at}|${c.role}`, (f.preShifts.get(`${at}|${c.role}`) ?? 0) + 1);
      if (kind === 'home') {
        const sh = w.shift ?? shiftOf(c, w);
        f.shifts.set(`${c.base}|${c.role}|${sh}`, (f.shifts.get(`${c.base}|${c.role}|${sh}`) ?? 0) + 1);
        prevShift = sh;
      } else {
        if (kind === 'airport') {
          for (const fam of c.ratings) f.airport.set(`${at}|${fam}|${asbyRole(c.role)}`, (f.airport.get(`${at}|${fam}|${asbyRole(c.role)}`) ?? 0) + 1);
          f.airport.set(`${at}|*|${asbyRole(c.role)}`, (f.airport.get(`${at}|*|${asbyRole(c.role)}`) ?? 0) + 1);
        }
        prevShift = kind === 'airport' ? 'E' : null;
      }
    }
    if (c.standby) c.standby.sort((x, y) => x.from - y.from);
    // Clean before, and every window added since passed its own check: tomorrow's same timeline needs no full check.
    const memo = cleanMemo.get(g) ?? cleanMemo.set(g, new Map()).get(g)!;
    if (clean) memo.set(c.id, cleanSig(c, segs, g.now + DAY));
    else memo.delete(c.id);
  }
  if (changed) touchCrewState(g);
}

/**
 * v0.9 after the roster placed crew on new work (which ignored their windows not started yet: rules.ts standbyView),
 * their future windows are fitted again in time order: one that now breaks a limit (rest, the weekly recovery, a
 * tight 7/14/28-day duty) becomes reserve, or goes when reserve breaks it too. The daily planner refills the day.
 */
export function fitStandby(g: GameState, ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    const c = g.crew[id];
    if (!c?.standby) continue;
    const future = c.standby.filter((w) => w.calledAt === undefined && w.from > g.now).sort((a, b) => a.from - b.from);
    if (!future.length) continue;
    const starts = new Set(future.map((w) => w.from));
    let segs = segsOf(g, c).filter((x) => !(x.kind === 'sby' && starts.has(x.start)));
    let baseIssues: Set<string> | null = null;
    const base = () => (baseIssues ??= new Set(evalSegs(ctxOf(g, c), segs).filter((i) => i.dutyId).map((i) => `${i.dutyId}:${i.code}:${i.level}`)));
    const keep: Window[] = [];
    let moved = false;
    for (const w of future) {
      const v = windowIssues(g, c, segs, w, base);
      let x: Window | null = w;
      if (v.illegal || (v.tight && w.kind !== 'reserve')) {
        moved = true;
        const r: Window = { from: w.from, to: w.to, kind: 'reserve', ...(w.at ? { at: w.at } : {}) };
        x = w.kind !== 'reserve' && !windowIssues(g, c, segs, r, base).illegal ? r : null;
      }
      if (!x) continue;
      keep.push(x);
      segs = insert(segs, standbySeg(c, x));
      baseIssues = null;
    }
    if (!moved) continue;
    const rest = c.standby.filter((w) => !(w.calledAt === undefined && w.from > g.now));
    c.standby = [...rest, ...keep].sort((a, b) => a.from - b.from);
    if (!c.standby.length) delete c.standby;
    changed = true;
  }
  if (changed) touchCrewState(g);
}

// ---------- daily ----------

/** Recovery bookkeeping for standby windows that started since yesterday (standby is not rest). */
function noteStarted(g: GameState): void {
  for (const c of Object.values(g.crew)) {
    for (const w of c.standby ?? []) if (w.from > g.now - DAY && w.from <= g.now) noteRecovery(c, w.from, g);
  }
}

/** Yesterday's crew-days by kind (Stats.v09.roster), from the first planned day on. */
function countYesterday(g: GameState): void {
  const r = rosterStats(g);
  for (const c of Object.values(g.crew)) {
    const Y = dayIndex(c.base, g.now) - 1;
    if (Y < firstPlanDay(g, c.base) || c.status === 'joining') continue;
    const a = midnight(c.base, Y);
    const b = a + DAY;
    const why = blockOn(c, Y);
    if (why === 'leave') r.leaveDays++;
    else if (why) r.otherDays++;
    else if (offOn(c, Y)) r.offDays++;
    else if (c.log.some((e) => e.start < b && e.end > a)) r.flying++;
    else {
      const w = c.standby?.find((x) => x.from >= a && x.from < b);
      const k = w?.kind ?? (w ? 'home' : null);
      if (k === 'home') r.sbyHome++;
      else if (k === 'hotel') r.sbyHotel++;
      else if (k === 'airport') r.asby++;
      else if (k === 'reserve') r.res++;
      else r.otherDays++;
    }
  }
}

/** Before the roster run: housekeeping, annual leave, days off up to the horizon. */
export function dayPlanBefore(g: GameState): void {
  if (!g.dayPlan) return;
  pruneStandby(g);
  countYesterday(g);
  for (const c of Object.values(g.crew)) if (c.off?.length && c.off[0] < dayIndex(c.base, g.now) - 40) c.off = c.off.filter((k) => k >= dayIndex(c.base, g.now) - 40);
  const y = yearOf(g.now);
  // New hires after 90 days' service; next year's leave from 1 December.
  const due = Object.values(g.crew).filter((c) => (c.leaveYear ?? 0) < y && g.now - c.hired >= R().leave.afterServiceDays * DAY).map((c) => c.id);
  if (due.length) planLeave(g, y, due);
  if (monthKey(g.now) % 12 === 11) {
    const next = Object.values(g.crew).filter((c) => (c.leaveYear ?? 0) < y + 1 && g.now - c.hired >= R().leave.afterServiceDays * DAY).map((c) => c.id);
    if (next.length && planLeave(g, y + 1, next) > 1) {
      pushMessage(g, { tone: 'info', cat: 'crew', title: `Annual leave for ${y + 1} is planned`, body: '28 days each, mostly in winter; at most 1 in 10 of a crew group away at once.' });
    }
  }
  planOffDays(g);
}

/** After the roster run: the month's legal days off topped up, then standby for the published days. */
export function dayPlanAfter(g: GameState): void {
  if (!g.dayPlan) return;
  topUpOffs(g);
  planStandby(g);
  // v0.9 fix: after planStandby, so a window it starts right now (a hotel standby from 06:00 local = the daily tick)
  // is noted too; before, it was neither today's (not planned yet) nor tomorrow's (not after a day ago).
  noteStarted(g);
}

/**
 * v0.9 (§R.3): a month heading below its days off (the planner's 8, pro rata: work that left published days, a tour that took some) gets
 * free planned days back as days off, the earliest from tomorrow (one more day off at short notice is no hardship),
 * when the free days the planner has not reached yet could not hold them. This month and the next.
 */
function topUpOffs(g: GameState): void {
  let changed = false;
  const planned = g.dayPlan?.planned;
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.status === 'joining' || !c.off || c.notice) continue;
    const today = dayIndex(c.base, g.now);
    // This month and the next (a tour crewed weeks ahead fills both).
    for (const mk of [monthOfDay(today), monthOfDay(today) + 1]) {
      const end = firstDayOf(mk + 1);
      const lo = Math.max(today + 1, firstDayOf(mk));
      // Not the month they joined in (not counted at its end either: dayPlanMonth).
      if (lo >= end || midnight(c.base, firstDayOf(mk)) < c.hired) continue;
      // v0.9 fix: only free days the planner has not reached yet are its own to give (planOffDays); the rest of the
      // deficit comes from free days already planned (standby), the earliest first. Busy unplanned days are no room.
      const open = planned !== undefined ? dayIndex(c.base, planned) : end;
      // Cheap first: a planned month whose days off, with every day the planner has not reached yet, reach the floor.
      if (firstDayOf(mk) >= firstPlanDay(g, c.base)) {
        const unplanned = Math.max(0, end - Math.max(lo, open));
        let offs = 0;
        for (const k of c.off) if (k >= firstDayOf(mk) && k < end) offs++;
        const have = offs + unplanned;
        // v0.9.1: the unplanned days count as room only while two weeks of them are left (busy ones are no room: seed 4
        // closed a month at 6 when a tour filled its last unplanned days and a free planned day was never given back).
        if ((have >= R().off.minMonth || have >= minFor(g, c, mk)) && (unplanned > 14 || offs >= minFor(g, c, mk))) continue;
      }
      const busy = busyDays(c, segsOf(g, c), firstDayOf(mk), end);
      const free = (k: number, capped: boolean) => !offOn(c, k) && !busy.hit.has(k) && !blockedOn(c, k) && (!capped || !offRunOver(c, k, 1));
      let room = 0;
      for (let k = Math.max(lo, open); k < end; k++) if (free(k, false)) room++;
      // Towards the planner's 8 (pro rata), not the legal 7: a day taken later by a change on the day still leaves 7.
      // Round 5: days that keep every run of days off within 3 first; the legal 7 may then join a longer run.
      let deficit = minFor(g, c, mk) - offsIn(g, c, mk, busy) - room;
      for (const capped of [true, false]) {
        if (!capped && offsIn(g, c, mk, busy) + room >= legalFor(g, c, mk)) break;
        for (let k = lo; k < Math.min(end, open) && deficit > 0; k++) {
          if (!free(k, capped)) continue;
          c.off = [...c.off, k].sort((a, b) => a - b);
          // Round 4: the window of the morning after goes too (a day off runs to 06:00: clearDays, as planDay).
          clearDays(g, c, k, k + 1);
          deficit--;
          changed = true;
        }
      }
    }
  }
  if (changed) touchCrewState(g);
}

/** Month end (crew 'month'): each crew member's days off in the month just closed, their morale, the counters. */
export function dayPlanMonth(g: GameState): void {
  if (!g.dayPlan) return;
  const M = R().morale;
  const r = rosterStats(g);
  for (const c of Object.values(g.crew)) {
    const mk = monthOfDay(dayIndex(c.base, g.now) - 1);
    const a = firstDayOf(mk);
    if (a < firstPlanDay(g, c.base) || midnight(c.base, a) < c.hired || c.status === 'joining') continue;
    // Round 4: the month's leave and sick days (the 96 a year counts them; blocks are pruned 40 days on).
    let free = 0;
    for (let k = a; k < firstDayOf(mk + 1); k++) {
      const why = blockOn(c, k);
      if (why === 'leave' || why === 'sick') free++;
    }
    (c.freeMonths ??= {})[mk] = free;
    for (const k in c.freeMonths) if (+k < mk - 12) delete c.freeMonths[k];
    if (blockedMonth(c, mk)) continue;
    const n = offsIn(g, c, mk);
    (c.offMonths ??= {})[mk] = n;
    for (const k in c.offMonths) if (+k < mk - 12) delete c.offMonths[k];
    r.months++;
    if (n < legalFor(g, c, mk)) r.monthsLow++;
    // Round 4: the year's 96 (pro rata) at its December close.
    if (mk % 12 === 11) {
      const v = yearView(g, c, Math.floor(mk / 12));
      if (v.from < v.y1) {
        r.years = (r.years ?? 0) + 1;
        if (yearOffs(g, c, v) < v.need) r.yearsLow = (r.yearsLow ?? 0) + 1;
      }
    }
    const below = Math.min(M.below, minFor(g, c, mk));
    const delta = n > M.above ? Math.min(M.aboveMax, (n - M.above) * M.aboveEach) : n < below ? (below - n) * M.belowEach : 0;
    if (delta) moraleShock(g, c, 'daysOff', delta);
  }
}

/** A month mostly on leave, sick or joining (no days-off count for it). */
function blockedMonth(c: CrewMember, mk: MonthKey): boolean {
  let n = 0;
  for (let k = firstDayOf(mk); k < firstDayOf(mk + 1); k++) if (blockOn(c, k) && blockOn(c, k) !== 'leave') n++;
  return n > 10;
}

/** New game (crew 'init'): plans from the start day: leave for the year, days off and standby for the first 14 days. */
export function dayPlanInit(g: GameState): void {
  const home = g.company.homeBase;
  const from = midnight(home, dayIndex(home, g.now));
  g.dayPlan = { from, publishedTo: from, planned: from };
  rosterStats(g);
  planLeave(g, yearOf(g.now), Object.keys(g.crew));
  planOffDays(g);
  planStandby(g);
}

/**
 * Old saves (crew 'load'): the roster already published (14 days) stays as it is; v0.9 plans from the first base
 * midnight 14 days ahead, the rest of the year's leave included (pro rata), with one message.
 */
export function dayPlanLoad(g: GameState): void {
  if (g.dayPlan) {
    rosterStats(g);
    return;
  }
  const home = g.company.homeBase;
  const from = midnight(home, dayIndex(home, g.now + R().publishDays * DAY - 1) + 1);
  g.dayPlan = { from, publishedTo: from, planned: from };
  rosterStats(g);
  planLeave(g, yearOf(g.now), Object.keys(g.crew).filter((id) => g.now - g.crew[id].hired >= R().leave.afterServiceDays * DAY || g.crew[id].hired <= g.started));
  const k = dayIndex(home, from);
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: 'Roster planning changed',
    body: `From ${fmtDay(k * DAY)}, days off are planned (8–10 a month, a 2-day block every week, 4 weeks' leave a year) and other free days are standby. The roster published up to ${fmtDay((k - 1) * DAY)} stays as it is.`,
  });
}

// ---------- read APIs ----------

export interface CrewMonthView {
  key: MonthKey;
  label: string;
  off: number;
  offMin: 7;
  offTarget: [number, number];
  standby: { home: number; hotel: number; airport: number; reserve: number };
  flying: number;
  leave: number;
  other: number;
  /** v0.9 round 4: free days held in the month's calendar year (closed months, planned days off, leave, sick) and its 96 pro rata. */
  year: number;
  yearMin: number;
  line: string;
}

/** One crew member's month (base-local) by day: days off, standby by kind, flying, leave and the rest. Pure. */
export function crewMonth(g: GameState, crewId: string, t: Minute): CrewMonthView {
  const c = g.crew[crewId];
  const mk = c ? monthKey(t + offsetAt(c.base, t)) : monthKey(t);
  const v: CrewMonthView = { key: mk, label: MONTH[mk % 12], off: 0, offMin: 7, offTarget: [8, 10], standby: { home: 0, hotel: 0, airport: 0, reserve: 0 }, flying: 0, leave: 0, other: 0, year: 0, yearMin: R().off.yearMin, line: '' };
  if (!c) return v;
  const yv = yearView(g, c, Math.floor(mk / 12));
  v.year = yearOffs(g, c, yv);
  v.yearMin = yv.need;
  // Counted from the first whole month after the hire (or the first planned one): said when that is not January.
  const yearFrom = yv.from > yv.y0 && yv.from < yv.y1 ? ` from ${MONTH[monthOfDay(yv.from) % 12]}` : '';
  const a = firstDayOf(mk);
  const b = firstDayOf(mk + 1);
  const segs = segsOf(g, c);
  const busy = busyDays(c, segs, a, b);
  v.off = offsIn(g, c, mk, busy);
  const from = firstPlanDay(g, c.base);
  for (let k = a; k < b; k++) {
    const why = blockOn(c, k);
    if (why === 'leave') v.leave++;
    else if (why) v.other++;
    else if (offOn(c, k) || (k < from && !busy.work.has(k) && !busy.sby.has(k))) continue;
    else if (busy.work.has(k)) v.flying++;
    else {
      const m = midnight(c.base, k);
      const w = c.standby?.find((x) => x.from >= m && x.from < m + DAY);
      if (w) v.standby[w.kind ?? 'home']++;
      else v.other++;
    }
  }
  const sby = v.standby.home + v.standby.hotel + v.standby.airport + v.standby.reserve;
  v.line = `${v.label}: days off ${v.off} of ${v.offMin} minimum · ${v.year} of ${v.yearMin} this year${yearFrom} · standby ${sby} · flying ${v.flying} · leave ${v.leave}`;
  return v;
}

/** The standby window a crew member is on now (any kind) with its station, else null. Pure. */
export function standbyNow(g: GameState, crewId: string): { kind: StandbyKind; at: string; to: Minute } | null {
  const w = onStandby(g, crewId, g.now);
  return w ? { kind: w.kind, at: w.at, to: w.to } : null;
}

