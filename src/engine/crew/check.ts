// Legality of a crew member on a pairing: status, rating, location (tickets planned in time), then the FTL
// timeline (rest, FDP, cumulative windows, recovery). Shared by checkAssignment and the auto-roster.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing } from '../core/types';
import { monthFloorIssue, offIssue, offMovable } from './dayPlan';
import { evalSegs, levelOf, LIMITS, type LegalityIssue, type Seg } from './rules';
import { flightsRev } from '../core/entities';
import { aboard, block12m, cabinEarly, crewIx, crewRev, ctxOf, droppableHome, droppableOut, dutyBlock, dutySegs, locAt, outTicket, planHome, planHomeAfter, planOut, segsOf, segsTagOf, typeIdOf, withoutTickets, type TicketPlan } from './timeline';

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

const bySeg = (x: Seg, y: Seg) => x.start - y.start || x.end - y.end;
/** True when the timeline is in bySeg order. */
function inOrder(a: Seg[]): boolean {
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const q = a[i];
    if (p.start > q.start || (p.start === q.start && p.end > q.end)) return false;
  }
  return true;
}
/**
 * Both timelines in one, by start then end (ties: `a`'s first). v0.9 round 3 speed: a linear merge when both are already
 * in order, as they almost always are (the same order as the stable sort of `[...a, ...b]`); else that sort.
 */
function merge(a: Seg[], b: Seg[]): Seg[] {
  if (!inOrder(a) || !inOrder(b)) return [...a, ...b].sort(bySeg);
  const out = new Array<Seg>(a.length + b.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];
    if (y.start < x.start || (y.start === x.start && y.end < x.end)) {
      out[k++] = y;
      j++;
    } else {
      out[k++] = x;
      i++;
    }
  }
  while (i < a.length) out[k++] = a[i++];
  while (j < b.length) out[k++] = b[j++];
  return out;
}

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
/**
 * v0.9 round 4 speed (§R.17): planCrew is a pure function of the state, the crew member, the pairing, the base
 * timeline and its arguments, and the read APIs ask the same question many times in one step (the ladder's re-checks,
 * Crew Control's candidates, a re-roster after a fix). Memo per state, crew and flight revision and minute, keyed by
 * pairing (identity: splitTourGap's probes share an id), crew member, mode and the base's timeline entry (a derived
 * base, or a jet ride, is planned afresh). The plan is shared read-only, as its segs already are.
 */
const planMemo = new WeakMap<GameState, { key: string; by: WeakMap<Pairing, Map<string, CrewPlan>> }>();

/**
 * The crew member's own inputs of a plan (ctxOf, the status and day-off checks) and the day plan's bounds: the engine
 * changes them with a revision bump, a test or a tool may not, so the key carries them.
 */
function crewKey(g: GameState, c: CrewMember): string {
  const dp = g.dayPlan;
  return `${c.base}|${c.loc}|${c.status}|${c.restUntil}|${c.lastRecovery}|${c.blockYear}|${c.blockYearOf}|${block12m(c, g.now)}|${c.hired}|${c.morale}|${c.notice?.leaves ?? ''}|${c.offSwapAt ?? ''}|${c.ratings.join()}|${JSON.stringify(c.blocks ?? null)}|${c.off ? c.off.join() : ''}|${JSON.stringify(c.offMonths ?? null)}|${JSON.stringify(c.freeMonths ?? null)}|${JSON.stringify(c.twoDays ?? null)}|${JSON.stringify(c.rot ?? null)}|${JSON.stringify(c.tzBack ?? null)}|${dp ? `${dp.from}:${dp.publishedTo ?? ''}:${dp.planned ?? ''}` : ''}`;
}

export function planCrew(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing = false, slack = 0, leaving?: string, ride?: TicketPlan): CrewPlan {
  const tag = ride ? undefined : segsTagOf(base);
  if (tag === undefined) return planCrewRaw(g, c, p, base, existing, slack, leaving, ride);
  const rev = `${crewRev(g)}:${flightsRev(g)}:${g.now}`;
  let memo = planMemo.get(g);
  if (!memo || memo.key !== rev) planMemo.set(g, (memo = { key: rev, by: new WeakMap() }));
  let m = memo.by.get(p);
  if (!m) memo.by.set(p, (m = new Map()));
  const k = `${c.id}:${existing ? 1 : 0}:${slack}:${leaving ?? ''}:${tag}:${crewKey(g, c)}`;
  let plan = m.get(k);
  if (!plan) m.set(k, (plan = planCrewRaw(g, c, p, base, existing, slack, leaving)));
  return plan;
}

function planCrewRaw(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing: boolean, slack: number, leaving?: string, ride?: TicketPlan): CrewPlan {
  const duties = openDuties(g, p);
  if (!duties.length) return { level: 'legal', issues: [], out: null, home: null, segs: [] };
  const first = duties[0];
  const last = duties[duties.length - 1];
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  let out: TicketPlan | null = null;
  let home: TicketPlan | null = null;
  const issues: LegalityIssue[] = [];
  const dropped: string[] = [];
  let booked: TicketPlan | null = null;
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
    // Not onto a tour: its crews come out fresh for the rotation.
    const drop = p.tour ? [] : droppableHome(g, c, base, dep, first.report, last.release);
    if (drop.length) {
      base = withoutTickets(base, drop);
      dropped.push(...drop);
    }
    // v0.7.1: a private jet already chartered for this crew member (crew/control.ts charterJet), or one being
    // quoted (`ride`), is their ride out; a booked one leaves the base timeline (it is the duty's, not a loose ticket).
    booked = ride ?? prebooked(g, first, c.id);
    const bookedId = booked ? (booked as Partial<Flight>).id : undefined;
    if (bookedId) base = withoutTickets(base, [bookedId]);
    const loc = locAt(c, base, first.report);
    if (booked) out = booked;
    else if (loc !== dep) {
      // From where they will be, once their rest after earlier work is over (crew away from base included).
      const o = outTicket(g, p, first, loc, readyAt(c, base, first.report, g.now));
      out = o.plan;
      if (o.why) issues.push({ code: 'location', level: 'illegal', text: o.why, dutyId: first.id });
    }
    // No ticket home when the crew's next work starts where this trip ends, or when it is a ticket straight back
    // out there (that ticket is dropped: a hotel night or two beats two tickets).
    if (last.restAt !== c.base && nextFrom(base, last.release) !== last.restAt) {
      const back = p.tour ? [] : droppableOut(g, c, base, last.restAt, last.release);
      const stay = back.length ? withoutTickets(base, back) : base;
      if (back.length && nextFrom(stay, last.release) === last.restAt) {
        base = stay;
        dropped.push(...back);
      } else home = planHome(last, c.base, cabinEarly(g, p));
    }
  }
  let segs = buildSegs(g, c, p, duties, out, home);
  // v0.9 round 4 speed: one context for the evaluations below (evalSegs reads it).
  const ctx = { ...ctxOf(g, c), slack };
  let ftl = evalSegs(ctx, merge(base, segs));
  // v0.5.2: a same-day ticket out (counted as FDP) whose longer first duty eats the rest or FDP of this trip:
  // the crew fly out the day before and rest at the hotel first.
  const own = new Set(p.dutyIds);
  if (!existing && out && !out.rideId && !booked && badRestFdp(ftl, own)) {
    const early = planOut(g, p, first, out.from, true);
    if (early.std < out.std && early.std - BAL.deadheadCheckIn >= g.now) {
      const plain = out;
      out = early;
      const s2 = buildSegs(g, c, p, duties, out, home);
      const f2 = evalSegs(ctx, merge(base, s2));
      if (badRestFdp(f2, own) < badRestFdp(ftl, own)) {
        segs = s2;
        ftl = f2;
      } else out = plain;
    }
  }
  // A new ticket home that would break the 168 h recovery: the crew take their recovery at the hotel first.
  if (!existing && home && ftl.some((i) => i.code === 'recovery' && i.level === 'illegal' && i.dutyId === last.id)) {
    const plain = home;
    for (const wait of [LIMITS.recovery, LIMITS.recovery + 12 * 60, LIMITS.recoveryLong]) {
      home = planHomeAfter(last, c.base, wait);
      const s2 = buildSegs(g, c, p, duties, out, home);
      const f2 = evalSegs(ctx, merge(base, s2));
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
  // v0.9 new work on a planned day off (UPDATE-0.9.md §R.3): the roster never takes one; a player change confirms it.
  // A tour (deployment) or a trip of several days moves the days off it lands on to free days later in the month (the
  // planner's own re-plan, crew/dayPlan.ts takeOffDays: no morale): legal when the month keeps its count. A day trip
  // never takes one (another crew member can fly it).
  if (!existing) {
    const off = offIssue(g, c, segs);
    const long = !!p.tour || (segs.length > 0 && segs[segs.length - 1].end - segs[0].start > 30 * 60);
    // v0.9 fix: the room to move a day off to is read on the whole timeline (other work takes days too).
    if (off) issues.push(long && off.level !== 'illegal' && offMovable(g, c, merge(base, segs), !!p.tour) ? { ...off, level: 'legal' } : off);
    // v0.9 fix: never below the month's legal 7 days off, counting the free days the planner can still give.
    const floor = off?.level === 'illegal' ? null : monthFloorIssue(g, c, base, segs);
    if (floor) issues.push(floor);
  }
  if (existing) {
    // Unforeseen delays on the day (ORO.FTL.205(f)): a held seat whose extended recovery slipped stays on the
    // duty once the crew has reported (tight); before report the crew is re-planned like any other limit (v0.9 fix:
    // the 168 h is never planned past).
    for (const i of ftl) if (i.code === 'recovery' && i.level === 'illegal' && i.dutyId && (g.duties[i.dutyId]?.report ?? Infinity) <= g.now) i.level = 'tight';
  }
  issues.push(...ftl);
  return { level: levelOf(issues), issues, out, home, segs, drop: dropped.length ? dropped : undefined };
}

/** Fresh segs of the pairing's open duties with the planned tickets (out before the first, home after the last). */
function buildSegs(g: GameState, c: CrewMember, p: Pairing, duties: Duty[], out: TicketPlan | null, home: TicketPlan | null): Seg[] {
  const first = duties[0];
  const last = duties[duties.length - 1];
  const segs: Seg[] = [];
  for (const d of duties) for (const x of dutySegs(g, c, p, d, d === first ? out : null, d === last ? home : null, true)) segs.push(x);
  return segs;
}

/** Illegal rest or FDP issues on the pairing's own duties. */
function badRestFdp(l: LegalityIssue[], own: Set<string>): number {
  let n = 0;
  for (const i of l) if (i.level === 'illegal' && (i.code === 'rest' || i.code === 'fdp') && !!i.dutyId && own.has(i.dutyId)) n++;
  return n;
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

/** v0.7.1: a chartered jet (Flight with `charter`) carrying c to duty d's first departure, still to land. */
function prebooked(g: GameState, d: Duty, crewId: string): TicketPlan | null {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    if (f && f.charter && f.status === 'scheduled' && f.to === dep && f.sta <= d.report && aboard(f, crewId)) return f;
  }
  return null;
}

/**
 * When crew c can check in for new work before t: the end of the rest after their last logged duty and after
 * their planned work ending by t (the rest evalSegs asks for after each seg).
 */
export function readyAt(c: CrewMember, segs: Seg[], t: Minute, now = -Infinity): Minute {
  let ready = c.restUntil;
  for (const s of segs) {
    if (s.end > t) break;
    // v0.9 standby not over yet gives way to the work being planned (rules.ts standbyView): a window running now
    // is a call-out (no rest before the duty), one not started is replaced.
    if (s.kind === 'sby' && s.end > now) continue;
    if (s.kind !== 'log') ready = Math.max(ready, s.end + s.rest);
  }
  return ready;
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

/**
 * v0.9 round 4 speed (§R.17): the trip's duties alone break a cumulative window for anyone. A new crew member's fresh
 * seg of a duty covers at least [report, release) with the duty's block and, except the last duty's (a ticket home
 * may extend it), ends at the release; a timeline only adds segs around them (standbyView drops standby, never
 * work). So at every duty but the last, the four rolling windows of any merged timeline are at least these sums:
 * above the refusing threshold (the limit, or 95 % of it without policies.allowTight), planCrew would refuse every
 * candidate with that issue, and the auto-roster can skip its candidate loop (a long tour part). Pure.
 */
export function overForAnyone(g: GameState, duties: Duty[]): boolean {
  const share = g.company.policies.allowTight ? 1 : LIMITS.tightShare;
  for (let j = 0; j + 1 < duties.length; j++) {
    const b = duties[j].release;
    const a7 = b - 7 * DAY;
    const a14 = b - 14 * DAY;
    const a28 = b - 28 * DAY;
    let d7 = 0;
    let d14 = 0;
    let d28 = 0;
    let blk = 0;
    for (let i = 0; i <= j; i++) {
      const d = duties[i];
      const hi = Math.min(b, d.release);
      d7 += Math.max(0, hi - Math.max(a7, d.report));
      d14 += Math.max(0, hi - Math.max(a14, d.report));
      d28 += Math.max(0, hi - Math.max(a28, d.report));
      if (d.release > a28 && d.release <= b) blk += dutyBlock(g, d);
    }
    if (d7 > LIMITS.duty7d * share || d14 > LIMITS.duty14d * share || d28 > LIMITS.duty28d * share || blk > LIMITS.block28d * share) return true;
  }
  return false;
}

/** Acceptable for the auto-roster: nothing illegal; tight cumulative totals only with policies.allowTight. */
export function acceptable(g: GameState, plan: CrewPlan): boolean {
  for (const i of plan.issues) {
    // v0.9 never a day off (published or not): the auto-roster, re-plans, the auto-fix and heads leave them alone.
    if (i.level === 'illegal' || (i.code === 'daysOff' && i.level !== 'legal')) return false;
    if (i.level === 'tight' && i.code !== 'fdp' && !g.company.policies.allowTight) return false;
  }
  return true;
}

export { merge as mergeSegs };
