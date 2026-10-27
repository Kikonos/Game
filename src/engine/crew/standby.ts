// v0.7.3 standby (ORO.FTL.225, CS FTL.1.225; UPDATE-0.7.3.md §3.7). v0.9 (UPDATE-0.9.md §R): the kinds (home, hotel at a
// station away from base, airport, reserve), windows kept 28 days (they count towards the duty windows), conflicts with
// planned work clipped instead of whole days dropped, and the recovery bookkeeping that treats standby as work. The
// daily planner is crew/dayPlan.ts; dailyStandby below only serves the days an old save had already published.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { CrewMember, GameState, Minute, Role, StandbyKind } from '../core/types';
import { evalSegs, LIMITS, localMin, nightsIn, twoDayCredits } from './rules';
import { ctxOf, locAt, segsOf, standbySeg, touchCrewState } from './timeline';

type Window = NonNullable<CrewMember['standby']>[number];

/** The standby window (any kind) a crew member is on at t, not yet called, else null. Pure. */
export function onStandby(g: GameState, crewId: string, t: Minute): { from: Minute; to: Minute; kind: StandbyKind; at: string } | null {
  const c = g.crew[crewId];
  const w = c?.standby?.find((s) => s.from <= t && t < s.to && s.calledAt === undefined);
  return w && c ? { from: w.from, to: w.to, kind: w.kind ?? 'home', at: w.at ?? c.base } : null;
}

/** Rest an uncalled window asks for after it (12 h at home, 10 h away; airport standby its length; reserve none). */
export const restAfterWindow = (c: CrewMember, w: Window): number => standbySeg(c, w).rest;

/** The UTC minute of `local` minutes after local midnight at `code` on the local day containing t. */
function localAt(code: string, t: Minute, local: number): Minute {
  return t - localMin(code, t) + local;
}

/** Free days (no work seg touching the local day at base) in t's month. */
function freeDaysInMonth(segs: ReturnType<typeof segsOf>, t: Minute): number {
  const mk = monthKey(t);
  const busy = new Set<number>();
  for (const s of segs) {
    if (s.end < t - 31 * DAY || s.start > t + 31 * DAY) continue;
    for (let d = Math.floor((s.start + 60) / DAY); d <= Math.floor((s.end + 60) / DAY); d++) if (monthKey(d * DAY) === mk) busy.add(d);
  }
  let days = 0;
  for (let d = Math.floor(t / DAY) - 31; d <= Math.floor(t / DAY) + 31; d++) if (monthKey(d * DAY) === mk) days++;
  return days - busy.size;
}

/** v0.9: windows older than the 28-day duty window go. */
export function pruneStandby(g: GameState): void {
  let changed = false;
  for (const c of Object.values(g.crew)) {
    if (!c.standby) continue;
    const keep = c.standby.filter((w) => w.to > g.now - 28 * DAY);
    if (keep.length === c.standby.length) continue;
    changed = true;
    if (keep.length) c.standby = keep;
    else delete c.standby;
  }
  if (changed) touchCrewState(g);
}

/**
 * v0.7.3 the daily home standby roster, kept for the days an old save had published before v0.9 planned them
 * (g.dayPlan.from): for today and the next BAL.v073.standby.aheadDays − 1 days, per rating family with aircraft and
 * role (1 CPT, FO, PUR, CC), crew at base with nothing else that day, rested at 06:00, legal with the standby and
 * keeping 8 free days in the month, least worked first, go on home standby 06:00–18:00 local.
 */
export function dailyStandby(g: GameState): void {
  const S = BAL.v073.standby;
  const home = g.company.homeBase;
  const until = g.dayPlan?.from ?? Infinity;
  let changed = false;
  const fams = new Set<string>();
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'stored' && ac.status !== 'leasedOut' && ac.status !== 'delivering') fams.add(typeOf(ac.typeId).family);
  for (let k = 0; k < S.aheadDays; k++) {
    const from = localAt(home, g.now + k * DAY + 12 * 60, S.fromLocal);
    const to = from + S.hours * 60;
    if (to <= g.now || from < g.now || from >= until) continue;
    // Crew already on this window, by family and role (counted once per day).
    const on = new Map<string, number>();
    for (const c of Object.values(g.crew)) {
      if (!c.standby?.some((w) => w.from === from)) continue;
      for (const r of c.ratings as string[]) on.set(`${r}|${c.role}`, (on.get(`${r}|${c.role}`) ?? 0) + 1);
    }
    for (const fam of [...fams].sort()) {
      for (const role of Object.keys(S.perFamily).sort() as Role[]) {
        const need = S.perFamily[role] ?? 0;
        const have = on.get(`${fam}|${role}`) ?? 0;
        if (have >= need) continue;
        // Cheap filters first, least worked (logged duty, 28 days) first; the full legality check only until filled.
        const pool: { c: CrewMember; work: number }[] = [];
        for (const c of Object.values(g.crew)) {
          if (c.role !== role || !(c.ratings as string[]).includes(fam) || c.base !== home || c.loc !== home || c.notice || c.standby?.some((w) => w.from === from)) continue;
          if (c.status === 'sick' || c.status === 'leave' || c.status === 'training' || c.status === 'joining') continue;
          if (c.restUntil > from || c.blocks?.some((b) => b.from < to && b.to > from - DAY)) continue;
          let work = 0;
          for (const e of c.log) if (e.end > from - 28 * DAY) work += e.end - e.start;
          pool.push({ c, work });
        }
        pool.sort((a, b) => a.work - b.work || (a.c.id < b.c.id ? -1 : 1));
        const picks: { c: CrewMember }[] = [];
        for (const { c } of pool) {
          if (picks.length >= need - have) break;
          const segs = segsOf(g, c);
          if (segs.some((x) => x.kind !== 'log' && x.start < to + 12 * 60 && x.end > from - 12 * 60)) continue;
          if (freeDaysInMonth(segs, from) - 1 < S.minDaysOff) continue;
          const test = [...segs, standbySeg(c, { from, to }, undefined, true)].sort((a, b) => a.start - b.start || a.end - b.end);
          if (evalSegs(ctxOf(g, c), test).some((i) => i.level === 'illegal')) continue;
          picks.push({ c });
        }
        for (const { c } of picks.slice(0, need - have)) {
          (c.standby ??= []).push({ from, to });
          for (const r of c.ratings as string[]) on.set(`${r}|${c.role}`, (on.get(`${r}|${c.role}`) ?? 0) + 1);
          changed = true;
        }
      }
    }
  }
  if (changed) touchCrewState(g);
}

/**
 * v0.9 planned work [from, until) (its rest included) replaces the standby it clashes with: windows not started yet
 * that overlap it or whose own rest would run into it go (the daily planner refills the day, clipped); a window
 * running now ends early enough for its rest. Matches evalSegs, which leaves future windows out of fresh work.
 */
export function dropStandby(g: GameState, c: CrewMember, from: Minute, until: Minute): void {
  if (!c.standby) return;
  let changed = false;
  const keep: Window[] = [];
  for (const w of c.standby) {
    if (w.calledAt !== undefined || w.to <= g.now || w.from >= until || w.to + restAfterWindow(c, w) <= from) {
      keep.push(w);
      continue;
    }
    changed = true;
    if (w.from > g.now) continue;
    // v0.10.2 work starting inside a window running now is a call-out from it (CS FTL.1.225), not the end of an
    // uncalled window: no rest is owed in between (BLU1109: an FO called at 16:51 for a 17:00 ticket was read as
    // 0:09 rested of the 12:00 owed after an uncalled home standby, and the ferry he was called for went red).
    // Crew-planning round: so is work given now that starts at (or soon after) the window's end, before the rest an
    // uncalled window would owe (seed 3: crew on a 03:00-15:00 home standby given a 15:00 duty at 10:55 were read as
    // released at 10:55 and 4:05 rested of 12:00). The duty's limit then counts the standby (CS FTL.1.225(b)).
    if (from < w.to + restAfterWindow(c, w) && w.kind !== 'reserve') {
      keep.push({ ...w, calledAt: g.now });
      noteCall(g);
      continue;
    }
    const end = Math.max(g.now, from - restAfterWindow(c, w));
    if (end > w.from) keep.push({ ...w, to: end });
  }
  if (!changed) return;
  if (keep.length) c.standby = keep;
  else delete c.standby;
  touchCrewState(g);
}

/**
 * Debug round (26 Oct 2026): after a duty ended later than planned (a late landing), standby windows not started yet
 * begin after the rest it needs, or go when under 4 h are left (seed 3: a hotel standby at 08:45 after a duty that
 * ended at 01:04, 7:41 of 10:19 rested). The day planner refills a day that lost its window.
 */
export function clipToRest(g: GameState, c: CrewMember): void {
  // ... and a window in the next day at a station they did not end up at goes too (the trip changed after the day
  // was planned: a hotel standby at Gatwick for crew who flew home to Lisbon).
  let segs: ReturnType<typeof segsOf> | null = null;
  const away = (w: Window) => w.from < g.now + DAY && (w.at ?? c.base) !== (locAt(c, (segs ??= segsOf(g, c)), w.from) || c.base);
  if (!c.standby?.some((w) => w.calledAt === undefined && w.from > g.now && (w.from < c.restUntil || away(w)))) return;
  const keep: Window[] = [];
  for (const w of c.standby) {
    if (w.calledAt !== undefined || w.from <= g.now) keep.push(w);
    else if (away(w)) continue;
    else if (w.from >= c.restUntil) keep.push(w);
    else if (w.to - c.restUntil >= BAL.v09.roster.home.minH * 60) keep.push({ ...w, from: c.restUntil });
  }
  if (keep.length) c.standby = keep;
  else delete c.standby;
  touchCrewState(g);
}

/** v0.7.3 a crew member on standby is called out now (Crew Control call-in): the window closes at their report. */
export function callFromStandby(g: GameState, crewId: string): boolean {
  const c = g.crew[crewId];
  const w = c?.standby?.find((s) => s.from <= g.now && g.now < s.to && s.calledAt === undefined);
  if (!c || !w) return false;
  w.calledAt = g.now;
  noteCall(g);
  touchCrewState(g);
  return true;
}

function noteCall(g: GameState): void {
  g.stats.standbyCalls = (g.stats.standbyCalls ?? 0) + 1;
  const r = g.stats.v09?.roster;
  if (r) r.callOuts++;
}

/**
 * v0.7.3 crew placed on a trip whose first report falls inside their running standby window are called out
 * (design §3.7: roster picks, auto-fix and sick-call cover count as calls): the window closes at that report.
 * Told at short notice before the window starts (the night's roster run, crew control in the evening) for a report
 * inside it, the standby crew member covers the gap too: counted as a call, while the duty simply replaces the
 * standby (CS FTL.1.225: no standby time counts when the duty is given before it starts; the caller drops it).
 */
export function callIfOnStandby(g: GameState, crewId: string, report: Minute | undefined): boolean {
  const c = g.crew[crewId];
  if (report === undefined || !c) return false;
  const w = standbyFor(g, c, report);
  if (!w) return false;
  if (w.from <= g.now) return callFromStandby(g, crewId);
  noteCall(g);
  return true;
}

/** v0.9 minutes from the call to the report by kind: home 90, hotel 45, airport 20; reserve: the 10 h notice (§R.3). */
export function readyMinOf(kind: StandbyKind): number {
  const R = BAL.v09.roster;
  return kind === 'airport' ? R.airport.readyMin : kind === 'hotel' ? R.hotel.readyMin : kind === 'reserve' ? R.reserve.noticeMin : R.home.readyMin;
}

/**
 * v0.9 round 4 when a reserve crew member at `at` can be contacted: now, or 06:00 station-local when now falls in the
 * reserve's 8 h no-contact period (BAL.v09.roster.reserve.quiet, 22:00–06:00: CS FTL.1.230). Pure.
 */
export function reserveContact(g: GameState, at: string): Minute {
  const [q0, q1] = BAL.v09.roster.reserve.quiet;
  const local = localMin(at, g.now);
  if (local >= q0) return g.now + DAY - local + q1;
  if (local < q1) return g.now + q1 - local;
  return g.now;
}

/**
 * v0.7.3 the standby window a duty reporting at `report` calls c out of: running now, or starting within
 * BAL.v073.standby.noticeMin (short notice), not called yet, the report inside it (or in the wake-up hour before).
 * v0.9: a running window needs the kind's response time before the report; reserve only answers a report at least
 * 10 h after the call (round 4: the call waits for 06:00 in the no-contact period), inside or after the window. Pure.
 */
export function standbyFor(g: GameState, c: CrewMember, report: Minute): { from: Minute; to: Minute; kind: StandbyKind; at: string } | null {
  const S = BAL.v073.standby;
  if (report < g.now || !c.standby) return null;
  for (const s of c.standby) {
    if (s.calledAt !== undefined || g.now >= s.to) continue;
    const kind = s.kind ?? 'home';
    if (kind === 'reserve') {
      if (s.from <= g.now && report - reserveContact(g, s.at ?? c.base) >= BAL.v09.roster.reserve.noticeMin) return { from: s.from, to: s.to, kind, at: s.at ?? c.base };
      continue;
    }
    if (s.from - g.now > S.noticeMin || report >= s.to || report < Math.min(g.now, s.from - S.wakeMin)) continue;
    if (s.from <= g.now && report < g.now + readyMinOf(kind)) continue;
    return { from: s.from, to: s.to, kind, at: s.at ?? c.base };
  }
  return null;
}

/** v0.7.3 called out from standby at this moment (no overtime, no morale hit for a lost day off). */
export const calledNow = (g: GameState, crewId: string): boolean => !!g.crew[crewId]?.standby?.some((w) => w.calledAt === g.now);

/**
 * End of c's last work before t: logged duty and travel, and (v0.9) standby or reserve windows (neither is rest, so
 * neither can be part of a recovery rest).
 */
export function workEndBefore(c: CrewMember, t: Minute): Minute {
  let end = -Infinity;
  for (const e of c.log) if (e.end <= t && e.end > end) end = e.end;
  for (const w of c.standby ?? []) {
    if (w.from >= t) continue;
    const e = Math.min(t, w.calledAt ?? w.to);
    if (e > end) end = e;
  }
  return end > -Infinity ? end : c.restUntil - 12 * 60;
}

/**
 * ERRP bookkeeping before work starting at t (a duty report, a logged ticket, v0.9 a standby window starting): the
 * time off since the last work counts as extended recovery when long enough with two local nights (the log is
 * pruned, so the anchor must move whenever work starts, not only at duty reports). v0.9: the longest gap between
 * recovery rests seen (Stats.v09.roster.maxRecGapH).
 */
export function noteRecovery(c: CrewMember, t: Minute, g?: GameState): void {
  const prevEnd = workEndBefore(c, t);
  const dis = c.log.filter((e) => e.start >= c.lastRecovery && e.end <= t && e.disruptive).length;
  const need = dis >= LIMITS.disruptiveMax ? LIMITS.recoveryLong : LIMITS.recovery;
  if (t - prevEnd >= need && nightsIn(c.base, prevEnd, t) >= 2) {
    const r = g?.stats.v09?.roster;
    if (r && prevEnd > c.lastRecovery && c.lastRecovery > c.hired) r.maxRecGapH = Math.max(r.maxRecGapH, Math.round((prevEnd - c.lastRecovery) / 60));
    c.lastRecovery = Math.max(c.lastRecovery, t);
  }
  // v0.7.3 ORO.FTL.235(d): recovery rests with 2 whole local days, by the month of the first one (key 0: tracking began).
  if (t - prevEnd >= LIMITS.recovery) {
    for (const [mk, n] of twoDayCredits(c.base, prevEnd, t)) {
      const td = (c.twoDays ??= { 0: mk });
      td[mk] = Math.min(2, (td[mk] ?? 0) + n);
      for (const k in td) if (+k && +k < mk - 3) delete td[k];
    }
  }
}
