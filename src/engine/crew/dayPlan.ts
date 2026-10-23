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
import type { CrewMember, GameState, Minute, MonthKey, StandbyKind, StatsRoster09, StatsV09 } from '../core/types';
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
  const busy = busyDays(c, segs ?? segsOf(g, c), pub, pub + 62);
  const skip = new Set(taken);
  for (const m of [mk, mk + 1]) {
    for (let k = Math.max(pub, firstDayOf(m)); k < firstDayOf(m + 1); k++) {
      if (skip.has(k) || offOn(c, k) || busy.hit.has(k) || blockedOn(c, k)) continue;
      return k;
    }
  }
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
  const all = segsOf(g, c);
  for (const k of hits) {
    // The planner's own move (a tour crewed over its days off: the day moves to a free one, no morale); a player's or
    // a call-in's break of a published day costs morale.
    if (planner) rosterStats(g).offMoved = (rosterStats(g).offMoved ?? 0) + 1;
    else if (k < pub) {
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

/** At most this share of a family-and-role group starts a due (not a must) block on any day. */
const OFF_SHARE = 0.35;

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
  // Group sizes and who is off on D (the stagger).
  const size = new Map<string, number>();
  const offNow = new Map<string, number>();
  for (const x of crew) {
    if (x.status === 'joining' && blockedOn(x, D)) continue;
    for (const k of groupsOf(x)) {
      size.set(k, (size.get(k) ?? 0) + 1);
      if (offOn(x, D)) offNow.set(k, (offNow.get(k) ?? 0) + 1);
    }
  }
  for (const c of crew) {
    if ((only && !only.has(c.id)) || offOn(c, D) || blockedOn(c, D) || (c.notice && midnight(c.base, D) >= c.notice.leaves)) continue;
    const { busy } = facts.get(c.id)!;
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
    const missing = O.minMonth - offs;
    const blocks = blocksIn(c, mk);
    const must = run >= O.mustAfter || (missing > 0 && freeLeft <= missing + 1) || (blocks < 2 && (2 - blocks) * 2 + 1 >= freeLeft);
    // Behind the pace only counts in the second half of the month (early on, every crew member would be "behind"
    // on the same day and the whole company would go off together).
    const behind = dom >= 15 && before < pace - 1.5;
    const due = run >= O.dueAfter || behind;
    if (!must && !due) continue;
    if (!must && offs >= O.maxMonth) continue;
    if (!must && run === O.dueAfter && short(c)) continue;
    // Staggered: a due block waits while its family-and-role group already has its share off that day.
    if (!must && groupsOf(c).some((k) => (offNow.get(k) ?? 0) >= Math.max(1, Math.ceil(OFF_SHARE * (size.get(k) ?? 1))))) continue;
    let len = before + 2 < (O.targetMonth * (dom + 2)) / mDays - 1 ? O.block[1] : O.block[0];
    if (!must) len = Math.min(len, O.maxMonth - offs);
    if (len < O.block[0]) {
      if (!must) continue;
      len = O.block[0];
    }
    const fits = (k: number, n: number) => {
      for (let i = k; i < k + n; i++) if (offOn(c, i) || busy.hit.has(i) || blockedOn(c, i)) return false;
      return true;
    };
    let at: number | null = null;
    if (fits(D, len)) at = D;
    else if (len > O.block[0] && fits(D, O.block[0])) {
      at = D;
      len = O.block[0];
    } else if (must) {
      len = O.block[0];
      for (let k = D + 1; k <= D + 10; k++) if (fits(k, len)) { at = k; break; }
    }
    if (at === null) continue;
    const days = Array.from({ length: len }, (_, i) => at! + i);
    addOff(c, days);
    if (at === D) for (const k of groupsOf(c)) offNow.set(k, (offNow.get(k) ?? 0) + 1);
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
  /** Our departures 05:00–10:00 local per station|family, and the first of them. */
  wave: Map<string, { n: number; first: Minute }>;
  /** Home windows already on the day per station|role|shift; airport windows per station|family|role. */
  shifts: Map<string, number>;
  airport: Map<string, number>;
}

function dayFacts(g: GameState, X: number): DayFacts {
  const home = g.company.homeBase;
  const a = midnight(home, X);
  const b = a + DAY;
  const f: DayFacts = { early: new Map(), late: new Map(), wave: new Map(), shifts: new Map(), airport: new Map() };
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  const A = R().airport;
  for (const list of crewIx(g).byAircraft.values()) {
    for (const p of list) {
      if (p.status === 'done' || p.status === 'broken' || p.end < a || p.start >= b + DAY) continue;
      const fam = typeOf(typeIdOf(g, p)).family;
      for (const id of p.dutyIds) {
        const d = g.duties[id];
        if (!d || d.done) continue;
        const fl = g.flights[d.flightIds[0]];
        const st = fl?.from ?? d.restAt;
        const k = dayIndex(st, d.report);
        if (k !== X) continue;
        const loc = (d.report + offsetAt(st, d.report)) % DAY;
        for (const s of p.slots) if (!s.above) inc(loc < 12 * 60 ? f.early : f.late, `${st}|${s.role}`);
        if (fl) {
          const dl = (fl.std + offsetAt(st, fl.std)) % DAY;
          if (dl >= 5 * 60 && dl < A.waveEnd) {
            const w = f.wave.get(`${st}|${fam}`) ?? { n: 0, first: Infinity };
            w.n++;
            w.first = Math.min(w.first, fl.std);
            f.wave.set(`${st}|${fam}`, w);
          }
        }
      }
    }
  }
  for (const c of Object.values(g.crew)) {
    for (const w of c.standby ?? []) {
      if (dayIndex(c.base, w.from) !== X) continue;
      const st = w.at ?? c.base;
      if (w.kind === 'airport') for (const fam of c.ratings) inc(f.airport, `${st}|${fam}|${c.role}`);
      else if ((w.kind ?? 'home') === 'home') inc(f.shifts, `${st}|${c.role}|${w.shift ?? shiftOf(c, w)}`);
    }
  }
  return f;
}

const shiftOf = (c: CrewMember, w: Window): 'E' | 'L' => ((w.from + offsetAt(c.base, w.from)) % DAY < 12 * 60 ? 'E' : 'L');

/** The window of day X before clipping, by kind and shift (home base-local; hotel station-local). */
function rawWindow(c: CrewMember, X: number, at: string, f: DayFacts, prevShift: 'E' | 'L' | null): { w: Window; kind: StandbyKind } {
  const S = R();
  const m = midnight(c.base, X);
  if (at !== c.base) {
    const ms = midnight(at, dayIndex(at, m + 12 * 60));
    return { w: { from: ms + S.hotel.from, to: ms + S.hotel.to, kind: 'hotel', at }, kind: 'hotel' };
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
    // Airport standby at a busy morning wave: 1 CPT, FO and CC per family, from the early shift.
    for (const fam of c.ratings) {
      const wave = f.wave.get(`${at}|${fam}`);
      const per = S.airport.per[c.role === 'PUR' ? 'CC' : c.role] ?? 0;
      if (!wave || wave.n < S.airport.minWave || (f.airport.get(`${at}|${fam}|${c.role}`) ?? 0) >= per) continue;
      const from = wave.first - S.airport.leadMin;
      return { w: { from, to: from + S.airport.hours * 60, kind: 'airport' }, kind: 'airport' };
    }
  }
  const [a, b] = shift === 'E' ? S.home.early : S.home.late;
  return { w: { from: m + a, to: m + b, shift }, kind: 'home' };
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
  const facts = new Map<number, DayFacts>();
  const factsOf = (X: number) => facts.get(X) ?? facts.set(X, dayFacts(g, X)).get(X)!;
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
    // Windows starting within 36 h: still legal with everything planned since?
    for (const w of [...(c.standby ?? [])]) {
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
      if (segs.some((x) => x.kind !== 'sby' && x.start < m1 && x.end > m)) {
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
      segs = insert(segs, standbySeg(c, w));
      baseIssues = null;
      changed = true;
      const kind = w.kind ?? 'home';
      if (kind === 'home') {
        const sh = w.shift ?? shiftOf(c, w);
        f.shifts.set(`${c.base}|${c.role}|${sh}`, (f.shifts.get(`${c.base}|${c.role}|${sh}`) ?? 0) + 1);
        prevShift = sh;
      } else {
        if (kind === 'airport') for (const fam of c.ratings) f.airport.set(`${at}|${fam}|${c.role}`, (f.airport.get(`${at}|${fam}|${c.role}`) ?? 0) + 1);
        prevShift = kind === 'airport' ? 'E' : null;
      }
    }
    if (c.standby) c.standby.sort((x, y) => x.from - y.from);
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
  noteStarted(g);
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

/** After the roster run: standby for the published days. */
export function dayPlanAfter(g: GameState): void {
  if (!g.dayPlan) return;
  planStandby(g);
}

/** Month end (crew 'month'): each crew member's days off in the month just closed, their morale, the counters. */
export function dayPlanMonth(g: GameState): void {
  if (!g.dayPlan) return;
  const O = R().off;
  const M = R().morale;
  const r = rosterStats(g);
  for (const c of Object.values(g.crew)) {
    const mk = monthOfDay(dayIndex(c.base, g.now) - 1);
    const a = firstDayOf(mk);
    if (a < firstPlanDay(g, c.base) || midnight(c.base, a) < c.hired || c.status === 'joining' || blockedMonth(c, mk)) continue;
    const n = offsIn(g, c, mk);
    (c.offMonths ??= {})[mk] = n;
    for (const k in c.offMonths) if (+k < mk - 12) delete c.offMonths[k];
    r.months++;
    if (n < O.legalMonth) r.monthsLow++;
    const delta = n > M.above ? Math.min(M.aboveMax, (n - M.above) * M.aboveEach) : n < M.below ? (M.below - n) * M.belowEach : 0;
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
  line: string;
}

/** One crew member's month (base-local) by day: days off, standby by kind, flying, leave and the rest. Pure. */
export function crewMonth(g: GameState, crewId: string, t: Minute): CrewMonthView {
  const c = g.crew[crewId];
  const mk = c ? monthKey(t + offsetAt(c.base, t)) : monthKey(t);
  const v: CrewMonthView = { key: mk, label: MONTH[mk % 12], off: 0, offMin: 7, offTarget: [8, 10], standby: { home: 0, hotel: 0, airport: 0, reserve: 0 }, flying: 0, leave: 0, other: 0, line: '' };
  if (!c) return v;
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
  v.line = `${v.label}: days off ${v.off} of ${v.offMin} minimum · standby ${sby} · flying ${v.flying} · leave ${v.leave}`;
  return v;
}

/** The standby window a crew member is on now (any kind) with its station, else null. Pure. */
export function standbyNow(g: GameState, crewId: string): { kind: StandbyKind; at: string; to: Minute } | null {
  const w = onStandby(g, crewId, g.now);
  return w ? { kind: w.kind, at: w.at, to: w.to } : null;
}

