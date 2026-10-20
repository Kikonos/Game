// Legality of a crew member on a pairing: status, rating, location (tickets planned in time), then the FTL
// timeline (rest, FDP, cumulative windows, recovery). Shared by checkAssignment and the auto-roster.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { fmtDay } from '../core/time';
import type { CrewMember, Duty, GameState, Legality, Minute, Pairing } from '../core/types';
import { evalSegs, levelOf, LIMITS, type LegalityIssue, type Seg } from './rules';
import { aboard, crewIx, ctxOf, dutySegs, locAt, planHome, planHomeAfter, planOut, segsOf, typeIdOf, type TicketPlan } from './timeline';

export interface CrewPlan {
  level: Legality;
  issues: LegalityIssue[];
  out: TicketPlan | null;
  home: TicketPlan | null;
  /** The pairing's segs for this crew member (fresh). */
  segs: Seg[];
  /** Tickets home from the departure airport the crew no longer needs (they stay on for this trip). */
  drop?: string[];
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

function statusIssues(c: CrewMember, from: number, to: number, family: string, duties: Duty[]): LegalityIssue[] {
  const out: LegalityIssue[] = [];
  if (!c.ratings.includes(family as never)) out.push({ code: 'rating', level: 'illegal', text: `Not rated on ${family}`, dutyId: duties[0].id });
  for (const b of c.blocks ?? []) {
    if (b.from < to && b.to > from) {
      // On the first duty the block touches (the earlier ones can still be flown).
      const d = duties.find((x) => x.report < b.to && x.release > b.from) ?? duties[0];
      out.push({ code: 'status', level: 'illegal', text: b.why === 'joining' ? 'Not joined yet' : b.why === 'training' ? 'In training' : b.why === 'sick' ? 'Sick' : 'On leave', dutyId: d.id });
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
  const dropped: string[] = [];
  if (existing) {
    for (const fid of [...first.deadheadIds, ...last.deadheadIds]) {
      const f = g.flights[fid];
      if (!f || f.status === 'cancelled' || !aboard(f, c.id)) continue;
      if (f.sta <= first.report) out = f;
      else if (f.std >= last.release) home = f;
    }
    // A ticket not yet flown that no longer fits around the trip (a duty moved or the trip grew past it).
    for (const d of duties) {
      for (const fid of d.deadheadIds) {
        const f = g.flights[fid];
        if (!f || f.status !== 'scheduled' || f === out || f === home || !aboard(f, c.id)) continue;
        issues.push({ code: 'location', level: 'illegal', text: `Ticket ${f.from}–${f.to} clashes with the trip`, dutyId: d.id });
        break;
      }
    }
    const at = out ? out.to : locAt(c, base, first.report);
    const started = g.flights[first.flightIds[0]]?.status !== 'scheduled';
    if (at !== dep && !started) issues.push({ code: 'location', level: 'illegal', text: `At ${at}, not ${dep}`, dutyId: first.id });
  } else {
    // Still at the departure airport with a ticket home around this trip: they stay on instead.
    const drop: string[] = [];
    for (const x of base) {
      if (x.kind !== 'pos' || !x.ticketId || x.from !== dep || x.at !== c.base || x.start + BAL.deadheadCheckIn <= g.now) continue;
      if (x.start >= first.report - 2 * 1440 && x.start < last.release + 1440 && locAt(c, base, x.start) === dep) drop.push(x.ticketId);
    }
    if (drop.length) {
      base = base.filter((x) => !x.ticketId || !drop.includes(x.ticketId));
      dropped.push(...drop);
    }
    const loc = locAt(c, base, first.report);
    if (loc !== dep) {
      out = planOut(g, p, first, loc);
      if (out.std - BAL.deadheadCheckIn < g.now) issues.push({ code: 'location', level: 'illegal', text: `Can't reach ${dep} in time`, dutyId: first.id });
    }
    // No ticket home when the crew's next work starts where this trip ends.
    if (last.restAt !== c.base && nextFrom(base, last.release) !== last.restAt) home = planHome(last, c.base);
  }
  const build = () => {
    const out2: Seg[] = [];
    for (const d of duties) out2.push(...dutySegs(g, c, p, d, d === first ? out : null, d === last ? home : null, true));
    return out2;
  };
  let segs = build();
  let ftl = evalSegs({ ...ctxOf(g, c), slack }, merge(base, segs));
  // A new ticket home that would break the 168 h recovery: the crew take their recovery at the hotel first.
  if (!existing && home && ftl.some((i) => i.code === 'recovery' && i.level === 'illegal' && i.dutyId === last.id)) {
    const plain = home;
    for (const wait of [LIMITS.recovery, LIMITS.recovery + 12 * 60, LIMITS.recoveryLong]) {
      home = planHomeAfter(last, c.base, wait);
      const s2 = build();
      const f2 = evalSegs({ ...ctxOf(g, c), slack }, merge(base, s2));
      if (!f2.some((i) => i.code === 'recovery' && i.level === 'illegal')) {
        segs = s2;
        ftl = f2;
        break;
      }
      home = plain;
    }
  }
  const other = otherTrip(g, c, p, segs[0].start, segs[segs.length - 1].end, existing, leaving);
  if (other) issues.push({ code: 'overlap', level: 'illegal', text: `On another ${other.tour ? 'tour' : 'trip'} until ${fmtDay(other.end)}`, dutyId: first.id });
  issues.push(...statusIssues(c, segs[0].start, segs[segs.length - 1].end, typeOf(typeIdOf(g, p)).family, duties));
  if (existing) {
    // Unforeseen delays on the day (ORO.FTL.205(f)): a held seat whose extended recovery slipped stays on the
    // duty about to report, flagged tight; a later duty is still re-planned.
    const soon = g.now + BAL.opsWindow;
    for (const i of ftl) if (i.code === 'recovery' && i.level === 'illegal' && i.dutyId && (g.duties[i.dutyId]?.report ?? Infinity) <= soon) i.level = 'tight';
  }
  issues.push(...ftl);
  return { level: levelOf(issues), issues, out, home, segs, drop: dropped.length ? dropped : undefined };
}

/**
 * What a crew member's issue means for duty d of p: issues of an earlier (or the same) duty of p count in full
 * (the crew can't fly on from there), an illegal later duty of p only warns ('tight': the roster takes the crew
 * off from that duty), another trip's issue is that trip's problem and a loose ticket's (no duty: a stale ticket
 * home is simply not boarded) is no duty's ('legal' here).
 */
export function issueLevelFor(g: GameState, p: Pairing, d: Duty, i: LegalityIssue): Legality {
  if (!i.dutyId) return 'legal';
  if (i.dutyId === d.id) return i.level;
  const x = g.duties[i.dutyId];
  if (!x || x.pairingId !== p.id) return 'legal';
  if (x.report <= d.report) return i.level;
  return i.level === 'illegal' ? 'tight' : i.level;
}

/** Crew of d's pairing with a crew-level illegal issue for duty d (FDP is the duty's own check). Pure. */
export function crewIssuesFor(g: GameState, d: Duty): { crewId: string; issue: LegalityIssue }[] {
  const p = g.pairings[d.pairingId];
  if (!p || d.done) return [];
  const out: { crewId: string; issue: LegalityIssue }[] = [];
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
    const i = plan.issues.find((x) => x.code !== 'fdp' && issueLevelFor(g, p, d, x) === 'illegal');
    if (i) out.push({ crewId: c.id, issue: i });
  }
  return out;
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
