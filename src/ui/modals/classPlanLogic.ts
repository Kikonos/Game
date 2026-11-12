// v0.23 the class planner's month strip and words (ClassPlanModal.tsx). Pure.

import { DAY, fmtMonth, monthKey, monthStart, toLocal } from '../../engine/core/time';
import type { Minute } from '../../engine/core/types';
import type { ClassProposal } from '../../engine/crew';

export interface StripMonth { key: number; label: string; left: number; width: number }
export interface StripBlock { no: string; start: Minute; left: number; width: number; lane: number; n: number }
export interface StripView {
  months: StripMonth[];
  blocks: StripBlock[];
  lanes: number;
  /** Positions (0–1) of today, the end of the published roster and the date asked for (null: off the strip). */
  today: number;
  roster: number | null;
  by: number | null;
}

/**
 * The month strip of a proposal: whole months from this one to the month the last class (or the date asked for) ends
 * in, at least two; classes as blocks in as few rows as their overlaps need. `home`: the base whose calendar is read.
 */
export function stripView(home: string, now: Minute, p: Pick<ClassProposal, 'classes' | 'rosterEnd' | 'by' | 'finish'>): StripView {
  const loc = (t: Minute) => toLocal(home, t);
  const k0 = monthKey(loc(now));
  const last = Math.max(loc(now) + 45 * DAY, p.finish !== null ? loc(p.finish - 1) : 0, p.rosterEnd ? loc(p.rosterEnd - 1) : 0);
  const k1 = Math.min(k0 + 6, monthKey(last));
  const from = monthStart(k0);
  const to = monthStart(k1 + 1);
  const pos = (t: Minute) => Math.min(1, Math.max(0, (loc(t) - from) / (to - from)));
  const months: StripMonth[] = [];
  for (let k = k0; k <= k1; k++) months.push({ key: k, label: fmtMonth(k).split(' ')[0], left: (monthStart(k) - from) / (to - from), width: (monthStart(k + 1) - monthStart(k)) / (to - from) });
  const ends: Minute[] = [];
  const blocks: StripBlock[] = [];
  for (const k of [...p.classes].sort((a, b) => a.start - b.start || (a.no < b.no ? -1 : 1))) {
    let lane = ends.findIndex((e) => e <= k.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = k.end;
    blocks.push({ no: k.no, start: k.start, left: pos(k.start), width: Math.max(0.012, pos(k.end) - pos(k.start)), lane, n: k.crewIds.length });
  }
  const inside = (t: Minute | null) => (t !== null && loc(t) > from && loc(t) < to ? pos(t) : null);
  return { months, blocks, lanes: Math.max(1, ends.length), today: pos(now), roster: inside(p.rosterEnd), by: inside(p.by) };
}

/** '13 each' / '13 · 13 · 12'. */
export function sizesText(p: Pick<ClassProposal, 'classes'>): string {
  const ns = p.classes.map((k) => k.crewIds.length);
  if (!ns.length) return '';
  return ns.every((n) => n === ns[0]) ? (ns.length > 1 ? `${ns[0]} each` : `${ns[0]} people`) : ns.join(' · ');
}

/** The plans the five stops show, as groups of stops sharing one plan ('0-1-2-3' and '4'): true when every stop shows the same. */
export function samePlan(ps: ClassProposal[]): boolean {
  const key = (p: ClassProposal) => p.classes.map((k) => `${k.start}:${[...k.crewIds].sort().join('.')}`).join('|');
  return ps.length > 0 && ps.every((p) => key(p) === key(ps[0]));
}

/** The month ends offered as a finish date: this month's (when a course still fits) and the next three. */
export function byChoices(home: string, now: Minute, earliest: Minute, days: number): { at: Minute; label: string }[] {
  const out: { at: Minute; label: string }[] = [];
  const k0 = monthKey(toLocal(home, now));
  for (let k = k0; k <= k0 + 4 && out.length < 4; k++) {
    // The last minute of the month on the base's calendar.
    const end = monthStart(k + 1) - (toLocal(home, monthStart(k + 1)) - monthStart(k + 1));
    if (end < earliest + days * DAY) continue;
    out.push({ at: end, label: `End of ${fmtMonth(k).split(' ')[0]}` });
  }
  return out;
}
