// v0.7.3 home standby (ORO.FTL.225, CS FTL.1.225(b); UPDATE-0.7.3.md §3.7): a few crew per rating family on call at
// home 06:00–18:00 for the next days, called first by Crew Control (no overtime, a shorter day after 6 h). Standby
// counts 25 % towards the duty limits and is not rest; a roster duty planned on a standby day replaces it.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, monthKey } from '../core/time';
import type { CrewMember, GameState, Minute, Role } from '../core/types';
import { evalSegs, localMin, minRest, type Seg } from './rules';
import { ctxOf, segsOf, touchCrewState } from './timeline';

/** The home standby window a crew member is on at t (not yet called), else null. Pure. */
export function onStandby(g: GameState, crewId: string, t: Minute): { from: Minute; to: Minute } | null {
  const c = g.crew[crewId];
  const w = c?.standby?.find((s) => s.from <= t && t < s.to && s.calledAt === undefined);
  return w ? { from: w.from, to: w.to } : null;
}

/** A standby window as a timeline seg (25 % duty; called: it ends at the call-out's report, with no rest before it). */
export function standbySeg(c: CrewMember, w: NonNullable<CrewMember['standby']>[number], end?: Minute): Seg {
  const to = end ?? w.to;
  return {
    kind: 'sby', start: w.from, end: to, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, share: 0.25,
    rest: end !== undefined ? 0 : minRest({ dutyMin: 0, atHome: true, augmented: false, tzShift: 0 }), at: '', from: c.base,
  };
}

/** The UTC minute of `local` minutes after local midnight at `code` on the local day containing t. */
function localAt(code: string, t: Minute, local: number): Minute {
  return t - localMin(code, t) + local;
}

/** Free days (no work seg touching the local day at base) in t's month. */
function freeDaysInMonth(c: CrewMember, segs: Seg[], t: Minute): number {
  const mk = monthKey(t);
  const busy = new Set<number>();
  for (const s of segs) {
    if (s.end < t - 31 * DAY || s.start > t + 31 * DAY) continue;
    for (let d = Math.floor((s.start + 60) / DAY); d <= Math.floor((s.end + 60) / DAY); d++) if (monthKey(d * DAY) === mk) busy.add(d);
  }
  let days = 0;
  for (let d = Math.floor(t / DAY) - 31; d <= Math.floor(t / DAY) + 31; d++) if (monthKey(d * DAY) === mk) days++;
  void c;
  return days - busy.size;
}

/**
 * v0.7.3 the daily standby roster (crew 'day'): for today and the next BAL.v073.standby.aheadDays − 1 days, per rating
 * family with aircraft and role (1 CPT, FO, PUR, CC), crew at base with nothing else that day, rested at 06:00, legal
 * with the standby and keeping 8 free days in the month, least worked first, go on home standby 06:00–18:00 local.
 * Past windows and windows a planned duty took over are dropped.
 */
export function dailyStandby(g: GameState): void {
  const S = BAL.v073.standby;
  const home = g.company.homeBase;
  let changed = false;
  for (const c of Object.values(g.crew)) {
    if (!c.standby) continue;
    const keep = c.standby.filter((w) => w.to > g.now - DAY && (w.calledAt !== undefined || w.from <= g.now || !overlapsWork(g, c, w.from, w.to)));
    if (keep.length !== c.standby.length) changed = true;
    if (keep.length) c.standby = keep;
    else delete c.standby;
  }
  const fams = new Set<string>();
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'stored' && ac.status !== 'leasedOut' && ac.status !== 'delivering') fams.add(typeOf(ac.typeId).family);
  for (let k = 0; k < S.aheadDays; k++) {
    const from = localAt(home, g.now + k * DAY + 12 * 60, S.fromLocal);
    const to = from + S.hours * 60;
    if (to <= g.now || from < g.now) continue;
    for (const fam of [...fams].sort()) {
      for (const role of Object.keys(S.perFamily).sort() as Role[]) {
        const need = S.perFamily[role] ?? 0;
        const have = Object.values(g.crew).filter((c) => c.role === role && (c.ratings as string[]).includes(fam) && c.standby?.some((w) => w.from === from)).length;
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
          if (freeDaysInMonth(c, segs, from) - 1 < S.minDaysOff) continue;
          const test = [...segs, { ...standbySeg(c, { from, to }), fresh: true }].sort((a, b) => a.start - b.start || a.end - b.end);
          if (evalSegs(ctxOf(g, c), test).some((i) => i.level === 'illegal')) continue;
          picks.push({ c });
        }
        for (const { c } of picks.slice(0, need - have)) {
          (c.standby ??= []).push({ from, to });
          changed = true;
        }
      }
    }
  }
  if (changed) touchCrewState(g);
}

/** Any planned duty or ticket of c overlapping [from, to). */
function overlapsWork(g: GameState, c: CrewMember, from: Minute, to: Minute): boolean {
  return segsOf(g, c).some((s) => s.kind !== 'log' && s.kind !== 'sby' && s.start < to && s.end > from);
}

/** v0.7.3 a crew member on standby is called out now (Crew Control call-in): the window closes at their report. */
export function callFromStandby(g: GameState, crewId: string): boolean {
  const c = g.crew[crewId];
  const w = c?.standby?.find((s) => s.from <= g.now && g.now < s.to && s.calledAt === undefined);
  if (!c || !w) return false;
  w.calledAt = g.now;
  g.stats.standbyCalls = (g.stats.standbyCalls ?? 0) + 1;
  touchCrewState(g);
  return true;
}
