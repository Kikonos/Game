// Legality of a crew member on a pairing: status, rating, location (tickets planned in time), then the FTL
// timeline (rest, FDP, cumulative windows, recovery). Shared by checkAssignment and the auto-roster.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { fmtDay } from '../core/time';
import type { CrewMember, Duty, GameState, Legality, Minute, Pairing } from '../core/types';
import { evalSegs, levelOf, type LegalityIssue, type Seg } from './rules';
import { crewIx, ctxOf, dutySegs, locAt, planHome, planOut, typeIdOf, type TicketPlan } from './timeline';

export interface CrewPlan {
  level: Legality;
  issues: LegalityIssue[];
  out: TicketPlan | null;
  home: TicketPlan | null;
  /** The pairing's segs for this crew member (fresh). */
  segs: Seg[];
}

/** Duties of p still to fly (not released), in report order. */
export function openDuties(g: GameState, p: Pairing): Duty[] {
  const out: Duty[] = [];
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (d && !d.done) out.push(d);
  }
  return out.sort((a, b) => a.report - b.report);
}

const merge = (a: Seg[], b: Seg[]) => [...a, ...b].sort((x, y) => x.start - y.start || x.end - y.end);

function statusIssues(c: CrewMember, from: number, to: number, family: string): LegalityIssue[] {
  const out: LegalityIssue[] = [];
  if (!c.ratings.includes(family as never)) out.push({ code: 'rating', level: 'illegal', text: `Not rated on ${family}` });
  for (const b of c.blocks ?? []) {
    if (b.from < to && b.to > from) {
      out.push({ code: 'status', level: 'illegal', text: b.why === 'joining' ? 'Not joined yet' : b.why === 'training' ? 'In training' : b.why === 'sick' ? 'Sick' : 'On leave' });
      break;
    }
  }
  return out;
}

/**
 * Plans crew c onto pairing p's open duties. `base` is c's timeline without p. With `existing`, uses the tickets
 * already bought for c (re-check of an assignment); otherwise plans new ones. `slack`: the auto-roster's planning
 * margin (TimelineCtx.slack). `leaving`: a pairing c leaves in the same change (swap).
 */
export function planCrew(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing = false, slack = 0, leaving?: string): CrewPlan {
  const duties = openDuties(g, p);
  if (!duties.length) return { level: 'legal', issues: [], out: null, home: null, segs: [] };
  const first = duties[0];
  const last = duties[duties.length - 1];
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  let out: TicketPlan | null = null;
  let home: TicketPlan | null = null;
  const issues: LegalityIssue[] = [];
  if (existing) {
    for (const fid of [...first.deadheadIds, ...last.deadheadIds]) {
      const f = g.flights[fid];
      if (!f || f.status === 'cancelled' || !f.crewIds.includes(c.id)) continue;
      if (f.sta <= first.report) out = f;
      else if (f.std >= last.release) home = f;
    }
    // A ticket not yet flown that no longer fits around the trip (a duty moved or the trip grew past it).
    for (const d of duties) {
      for (const fid of d.deadheadIds) {
        const f = g.flights[fid];
        if (!f || f.status !== 'scheduled' || f === out || f === home || !f.crewIds.includes(c.id)) continue;
        issues.push({ code: 'location', level: 'illegal', text: `Ticket ${f.from}–${f.to} clashes with the trip`, dutyId: d.id });
        break;
      }
    }
    const at = out ? out.to : locAt(c, base, first.report);
    const started = g.flights[first.flightIds[0]]?.status !== 'scheduled';
    if (at !== dep && !started) issues.push({ code: 'location', level: 'illegal', text: `At ${at}, not ${dep}`, dutyId: first.id });
  } else {
    const loc = locAt(c, base, first.report);
    if (loc !== dep) {
      out = planOut(g, p, first, loc);
      if (out.std - BAL.deadheadCheckIn < g.now) issues.push({ code: 'location', level: 'illegal', text: `Can't reach ${dep} in time`, dutyId: first.id });
    }
    // No ticket home when the crew's next work starts where this trip ends.
    if (last.restAt !== c.base && nextFrom(base, last.release) !== last.restAt) home = planHome(last, c.base);
  }
  const segs: Seg[] = [];
  for (const d of duties) segs.push(...dutySegs(g, c, p, d, d === first ? out : null, d === last ? home : null, true));
  const other = otherTrip(g, c, p, segs[0].start, segs[segs.length - 1].end, existing, leaving);
  if (other) issues.push({ code: 'overlap', level: 'illegal', text: `On another ${other.tour ? 'tour' : 'trip'} until ${fmtDay(other.end)}`, dutyId: first.id });
  issues.push(...statusIssues(c, segs[0].start, segs[segs.length - 1].end, typeOf(typeIdOf(g, p)).family));
  const ftl = evalSegs({ ...ctxOf(g, c), slack }, merge(base, segs));
  if (existing) {
    // Unforeseen delays on the day (ORO.FTL.205(f)): a held seat whose extended recovery slipped stays on the
    // duty about to report, flagged tight; a later duty is still re-planned.
    const soon = g.now + BAL.opsWindow;
    for (const i of ftl) if (i.code === 'recovery' && i.level === 'illegal' && i.dutyId && (g.duties[i.dutyId]?.report ?? Infinity) <= soon) i.level = 'tight';
  }
  issues.push(...ftl);
  return { level: levelOf(issues), issues, out, home, segs };
}

/** Where the crew's next planned work within 3 days after t starts ('' when none or unknown). */
function nextFrom(segs: Seg[], t: Minute): string {
  for (const s of segs) if (s.kind !== 'log' && s.start >= t) return s.start < t + 3 * 1440 ? s.from ?? '' : '';
  return '';
}

/**
 * Another trip or tour of c whose open duties overlap [from, to): one complement flies one pairing at a time
 * (interleaving two tours would send the crew home at the end of one while the other still needs them).
 * With `existing` (re-check of a held seat) only an earlier pairing counts. `leaving`: a pairing c is being
 * swapped off (manual swap), which no longer counts.
 */
export function otherTrip(g: GameState, c: CrewMember, p: Pairing, from: Minute, to: Minute, existing: boolean, leaving?: string): Pairing | null {
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (q.id === p.id || q.id === leaving || q.status === 'done' || q.status === 'broken') continue;
    // Re-checking a held seat: only the earlier pairing wins (the later one is flagged and re-rostered).
    if (existing && (q.start > p.start || (q.start === p.start && q.id > p.id))) continue;
    const open = openDuties(g, q);
    if (!open.length) continue;
    // A tour under way holds its crew at the station between duties too (a side trip would leave them elsewhere).
    const qs = q.tour ? Math.min(open[0].report, q.start) : open[0].report;
    const qe = open[open.length - 1].release;
    if (qs < to && qe > from) return q;
  }
  return null;
}

/** Acceptable for the auto-roster: nothing illegal; tight cumulative totals only with policies.allowTight. */
export function acceptable(g: GameState, plan: CrewPlan): boolean {
  for (const i of plan.issues) {
    if (i.level === 'illegal') return false;
    if (i.level === 'tight' && i.code !== 'fdp' && !g.company.policies.allowTight) return false;
  }
  return true;
}

export { merge as mergeSegs };
