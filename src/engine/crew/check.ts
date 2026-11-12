// Legality of a crew member on a pairing: status, rating, location (tickets planned in time), then the FTL
// timeline (rest, FDP, cumulative windows, recovery). Shared by checkAssignment and the auto-roster.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing } from '../core/types';
import { dayFloorIssue, eveFloorIssue, monthFloorIssue, offIssue, offMovable } from './dayPlan';
import { evalSegs, EXT_REST, levelOf, LIMITS, type LegalityIssue, type Seg } from './rules';
import { flightsRev } from '../core/entities';
import { aboard, block12m, cabinEarly, crewIx, crewRev, ctxOf, droppableHome, droppableOut, dutyBlock, dutySegs, locAt, outMerges, outTicket, planHome, posSeg, planHomeAfter, planOut, reserveSeat, ridesHome, segsOf, segsTagOf, ticketPrice, ticketSlotOk, typeIdOf, withoutTickets, type TicketPlan } from './timeline';
import { guestOn, homeOf, lastPart, sameTour, tourHomePlan, tourSpan, tourStationFor } from './tours';
import { dutyClash } from './avail';
import { leaveBackFor } from './leaveTrips';

export interface CrewPlan {
  level: Legality;
  issues: LegalityIssue[];
  out: TicketPlan | null;
  home: TicketPlan | null;
  /** The pairing's segs for this crew member (fresh). */
  segs: Seg[];
  /** Tickets home from the departure airport the crew no longer needs (they stay on for this trip). */
  drop?: string[];
  /** v0.12.1 later trips whose ticket out (bought from where the crew were) this trip leaves wrong: re-ticketed on taking it. */
  retick?: string[];
  /** v0.12.1 what those new tickets out cost. */
  retickCost?: number;
  /**
   * v0.19.3 the trip back out on the last day of an annual leave that began away (crew/leaveTrips.ts): this trip's first
   * duty leaves from the station they went home from. Bought with the trip's tickets (roster.ts buyTickets), not duty.
   */
  leaveBack?: TicketPlan;
  /** v0.22.1 a side trip from a tour station: the station they go back to after it (the seat's `backTo`; crew/tours.ts). */
  backTo?: string;
  /**
   * v0.23 planned as a guest on a tour part (the seat's `guest`): they fly this part's duties only and go back to where
   * they need to be. Whoever seats them writes it on the seat (roster.ts seatGuest).
   */
  guest?: true;
}

/**
 * v0.23 crew planned person by person: how far ahead a seat nobody can take for the whole part is covered duty by duty
 * (roster.ts coverRuns), and an open-ended tour part may be taken by a guest (the early heads-up's window: inside it a
 * seat is empty only when nobody legal is free for that duty).
 */
export const COVER_AHEAD = BAL.crewControl.earlyH * 60;

/** v0.22.1 a tour pairing's period start and station (leaveTrips.ts TourStay): where and from when its set lives on station. */
const tourStay = (g: GameState, p: Pairing): false | { from: Minute; station: string } => {
  const span = tourSpan(g, p);
  const dep = span && p.deploymentId ? g.deployments[p.deploymentId] : undefined;
  return span && dep ? { from: span.from, station: dep.base } : false;
};

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
      // On the first duty the block touches (the earlier ones can still be flown). v0.9 round 5: a block between
      // two duties of a tour (the crew stay at the station from first duty to last) falls on the first duty after
      // it: the roster splits the trip there and re-crews that part; before, it fell on the trip's first duty and
      // the crew member came off the whole tour days ahead. A block after the last duty (over the ticket home) is
      // no duty's problem.
      const d = duties.find((x) => x.report < b.to && x.release > b.from) ?? duties.find((x) => x.report >= b.to);
      if (!d) continue;
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
const planMemo = new WeakMap<GameState, { key: string; by: WeakMap<Pairing, Map<string, PlanMemo>> }>();
interface PlanMemo { plan: CrewPlan; ids: unknown[] }

/**
 * The crew member's own inputs of a plan (ctxOf, the status and day-off checks) and the day plan's bounds: the engine
 * changes them with a revision bump, a test or a tool may not, so the key carries the scalars and `crewIds` the
 * objects (by identity, arrays with their length; the engine replaces or bumps, never edits one in place unseen).
 */
export function crewKey(g: GameState, c: CrewMember): string {
  return `${c.base}|${c.loc}|${c.status}|${c.restUntil}|${c.lastRecovery}|${c.blockYear}|${c.blockYearOf}|${block12m(c, g.now)}|${c.hired}|${c.morale}|${c.notice?.leaves ?? ''}|${c.offSwapAt ?? ''}`;
}
export function crewIds(g: GameState, c: CrewMember): unknown[] {
  const dp = g.dayPlan;
  return [c.ratings, c.ratings.length, c.blocks, c.blocks?.length, c.off, c.off?.length, c.offMonths, c.freeMonths, c.twoDays, c.rot, c.tzBack, dp, dp?.from, dp?.publishedTo, dp?.planned];
}
const sameIds = (a: unknown[], b: unknown[]): boolean => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

export function planCrew(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing = false, slack = 0, leaving?: string, ride?: TicketPlan, also?: Pairing[], asGuest = false): CrewPlan {
  const tag = ride || also?.length ? undefined : segsTagOf(base);
  if (tag === undefined) return planCrewRaw(g, c, p, base, existing, slack, leaving, ride, also, asGuest);
  const rev = `${crewRev(g)}:${flightsRev(g)}:${g.now}`;
  let memo = planMemo.get(g);
  if (!memo || memo.key !== rev) planMemo.set(g, (memo = { key: rev, by: new WeakMap() }));
  let m = memo.by.get(p);
  if (!m) memo.by.set(p, (m = new Map()));
  const k = `${c.id}:${existing ? 1 : 0}${asGuest ? 'g' : ''}:${slack}:${leaving ?? ''}:${tag}:${crewKey(g, c)}`;
  const ids = crewIds(g, c);
  const hit = m.get(k);
  if (hit && sameIds(hit.ids, ids)) return hit.plan;
  const plan = planCrewRaw(g, c, p, base, existing, slack, leaving, undefined, undefined, asGuest);
  m.set(k, { plan, ids });
  return plan;
}

/**
 * v0.23 member or guest. A held seat is what it was seated as. A candidate for a tour part joins the set for the rest
 * of the rotation when the part is the tour's last (continuity: one crew stays together) and they are free for it; on
 * an earlier part (its member comes back after it), or when their own work stands in the way of the whole rotation and
 * the part lies inside the cover window, they are planned as a guest: this part's duties, then back to their own place.
 * `also`: trips they were seated on in the same roster run (not in the crew index yet).
 */
function planCrewRaw(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing: boolean, slack: number, leaving?: string, ride?: TicketPlan, also?: Pairing[], asGuest = false): CrewPlan {
  if (!p.tour) return planOne(g, c, p, base, existing, slack, false, leaving, ride, also);
  // A held seat (a re-check, or new tickets for someone seated) is what it was seated as.
  let seat: Pairing['slots'][number] | undefined;
  for (const x of p.slots) if (x.crewId === c.id) seat = x;
  if (existing || seat) return planOne(g, c, p, base, existing, slack, !!seat?.guest, leaving, ride, also);
  // (`asGuest`: the roster's cover run, a run of duties about to be split off as an earlier part.)
  if (asGuest || !lastPart(g, p)) return planOne(g, c, p, base, existing, slack, true, leaving, ride, also);
  const member = planOne(g, c, p, base, existing, slack, false, leaving, ride, also);
  if (acceptable(g, member)) return member;
  // Only what a guest plan can cure (not who they are: sick, on leave, not rated), and only inside the cover window.
  if (!member.issues.some((i) => i.level === 'illegal' && i.code !== 'status' && i.code !== 'rating')) return member;
  const open = openDuties(g, p);
  if (!open.length || open[open.length - 1].report > g.now + COVER_AHEAD) return member;
  const guest = planOne(g, c, p, base, existing, slack, true, leaving, ride, also);
  // (Refused both ways: the plan with less in the way is the one the day-off fallbacks and the reasons read.)
  const hard = (x: CrewPlan) => x.issues.filter((i) => i.level === 'illegal' && i.code !== 'daysOff').length;
  return acceptable(g, guest) || hard(guest) < hard(member) ? guest : member;
}

function planOne(g: GameState, c: CrewMember, p: Pairing, base: Seg[], existing: boolean, slack: number, guest: boolean, leaving?: string, ride?: TicketPlan, also?: Pairing[]): CrewPlan {
  const duties = openDuties(g, p);
  if (!duties.length) return { level: 'legal', issues: [], out: null, home: null, segs: [] };
  /** v0.23 the tour's own rules (crews come out fresh, stay to the rotation's end) are a member's, not a guest's. */
  const tour = !!p.tour && !guest;
  const first = duties[0];
  const last = duties[duties.length - 1];
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  let out: TicketPlan | null = null;
  let home: TicketPlan | null = null;
  const issues: LegalityIssue[] = [];
  const dropped: string[] = [];
  let booked: TicketPlan | null = null;
  let loose: string | undefined;
  /** Bug 1108b: this plan takes them home for a course after the trip (leaveBefore). */
  let forLeave = false;
  /** v0.19.3 the trip back out on the last day of an annual leave begun away (not bought yet). */
  let leaveBack: TicketPlan | undefined;
  /** v0.22.1 where they go after the trip: home base, or the tour station a side trip was flown from (crew/tours.ts). */
  let homeAt = c.base;
  let backTo: string | undefined;
  if (existing) {
    homeAt = homeOf(g, c, p);
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
    // v0.9.1: a stand-alone ticket home (its duty left the trip: a tour that shrank) is still the crew's way home
    // after the last duty: it counts on the 168 h like one bought with the trip (seed 2: 23 h at the hotel, then a
    // ticket landing 171 h after the last recovery, which no check saw).
    if (!home && last.restAt !== homeAt) {
      const t = looseHome(g, c, base, last);
      if (t) {
        home = t;
        loose = t.id;
        base = withoutTickets(base, [t.id]);
      }
    }
    const started = g.flights[first.flightIds[0]]?.status !== 'scheduled';
    // v0.10.1 a ticket out moves only crew who are where it leaves from (BLU511: an FO in Lisbon held a ticket out of
    // Düsseldorf; the roster read her as landed in Antalya, the gate found her in Lisbon and held the leg for 34 h). One
    // still to fly needs them at its departure by then; one flown (or under way) without them leaves them where they
    // really are, and the duty is checked from there.
    const tk = out && !started ? (out as Flight) : null;
    if (tk?.status === 'scheduled') {
      const w = locAt(c, base, tk.std);
      if (w !== tk.from) issues.push({ code: 'location', level: 'illegal', text: `At ${w}, not ${tk.from} for the ticket to ${tk.to}`, dutyId: first.id });
    } else if (tk && ((tk.status === 'enroute' && c.loc !== tk.from) || (tk.status === 'done' && locAt(c, base, first.report) !== tk.to))) out = null;
    let at = out ? out.to : locAt(c, base, first.report);
    // v0.19.3 the trip back out on the last day of an annual leave begun away, not bought yet (the daily run buys it).
    if (!out && at !== dep && !started) {
      const back = leaveBackFor(g, c, base, first.report, dep, tour && tourStay(g, p));
      if (back) {
        leaveBack = back;
        base = merge(base, [posSeg(back, c)]);
        at = dep;
      }
    }
    // (Bug 1108b: a reserve stands by at the station; it need not be at a departure elsewhere.)
    if (at !== dep && !started && !reserveSeat(p, c.id)) issues.push({ code: 'location', level: 'illegal', text: `At ${at}, not ${dep}`, dutyId: first.id });
  } else {
    // Still at the departure airport with a ticket home around this trip: they stay on instead.
    // Not onto a tour: its crews come out fresh for the rotation.
    const drop = tour ? [] : droppableHome(g, c, base, dep, first.report, last.release, last.restAt);
    if (drop.length) {
      base = withoutTickets(base, drop);
      dropped.push(...drop);
    }
    // v0.7.1: a private jet already chartered for this crew member (crew/control.ts charterJet), or one being
    // quoted (`ride`), is their ride out; a booked one leaves the base timeline (it is the duty's, not a loose ticket).
    booked = ride ?? prebooked(g, first, c.id);
    const bookedId = booked ? (booked as Partial<Flight>).id : undefined;
    if (bookedId) base = withoutTickets(base, [bookedId]);
    let loc = locAt(c, base, first.report);
    // v0.19.3 annual leave that began away ends with a trip back out on its last day to this trip's station (not duty).
    if (!booked && loc !== dep) {
      const back = leaveBackFor(g, c, base, first.report, dep, tour && tourStay(g, p));
      if (back) {
        leaveBack = back;
        base = merge(base, [posSeg(back, c)]);
        loc = dep;
      }
    }
    if (booked) out = booked;
    else if (loc !== dep) {
      // From where they will be, once their rest after earlier work is over (crew away from base included).
      const o = outTicket(g, p, first, loc, readyAt(c, base, first.report, g.now));
      out = o.plan;
      if (o.why) issues.push({ code: 'location', level: 'illegal', text: o.why, dutyId: first.id });
    }
    // No ticket home when the crew's next work starts where this trip ends, or when it is a ticket straight back
    // out there (that ticket is dropped: a hotel night or two beats two tickets).
    // Bug 1108b: never across a course: it starts and ends at home base. A course after this trip and before the crew's
    // next work sends them home after its last duty. (v0.19.3 annual leave no longer does: a leave that begins away
    // starts with a trip home on its first day and ends with one back out on its last, crew/leaveTrips.ts.)
    const leaveNext = leaveBefore(c, base, last.release, g.now + (BAL.scheduleHorizonDays - 1) * DAY);
    forLeave = leaveNext && last.restAt !== c.base;
    // v0.22.1 a set on station flying a side trip between its own tour duties goes back to the station after it.
    let station = leaveNext ? null : tourStationFor(g, c, p, first.report, last.release, loc, guest, also);
    // v0.23 "back to where they need to be": away from base with their next work (a duty, or the ticket out to their
    // next tour) starting from where they are now, they come back there after this trip, not home (bots: crew waiting at
    // Nantes for a ticket to their next station were refused for one duty elsewhere, "due in Nantes for their ticket").
    // Or their next work starts at a station the timeline does not take them to yet (home on leave from there, the trip
    // back out on the leave's last day not bought yet): straight there after this trip ("in Lisbon, not Barcelona").
    if (!station && !leaveNext && !tour) {
      const nx = nextWork(base, last.release);
      // (A ticket, alone or merged into its duty, that only takes them home or to where this trip ends is no reason to
      // go back for it: the old rule re-buys it from where they will be, `retick` below.)
      const dest = nx ? (nx.kind === 'pos' ? nx.at : nx.out?.to) : undefined;
      if (nx && nx.from && nx.from !== c.base && (dest === undefined || (dest !== c.base && dest !== last.restAt))) {
        if (nx.from === loc) station = loc;
        else if (nx.from !== last.restAt && locAt(c, base, nx.start) !== nx.from) station = nx.from;
      }
    }
    if (station) homeAt = backTo = station;
    // v0.23 ... and a ticket home they hold from where they are is no tie: this trip takes them away and brings them
    // home itself, so that ticket goes (it read "in Lisbon, not Kangerlussuaq" and refused them).
    if (out && loc !== c.base && homeAt !== loc) {
      const gone: string[] = [];
      for (const x of base) if (x.kind === 'pos' && x.ticketId && x.from === loc && x.at === c.base && x.start >= out.std && !x.leave) gone.push(x.ticketId);
      if (gone.length) {
        base = withoutTickets(base, gone);
        dropped.push(...gone);
      }
    }
    if (last.restAt !== homeAt && (leaveNext || nextFrom(base, last.release) !== last.restAt)) {
      const back = tour || leaveNext ? [] : droppableOut(g, c, base, last.restAt, last.release);
      const stay = back.length ? withoutTickets(base, back) : base;
      if (back.length && nextFrom(stay, last.release) === last.restAt) {
        base = stay;
        dropped.push(...back);
      } else home = tour && !leaveNext ? tourHomePlan(g, p, last, c.base, cabinEarly(g, p)) : planHome(last, homeAt, cabinEarly(g, p) + outExtra(out, duties));
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
    // v0.12.1 (review) and only a seat that exists (planOut's fallback can sit inside a closure).
    if (early.std < out.std && early.std - BAL.deadheadCheckIn >= g.now && ticketSlotOk(g, early.from, early.to, early.std, early.sta)) {
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
  // A new ticket home that would break the 168 h recovery: the crew take their recovery at the hotel first (v0.9.1: or
  // a stand-alone one is moved: the plain ticket after the duty first, else after the recovery; rebookHomeForRecovery
  // buys it at the release).
  if ((!existing || loose) && home && ftl.some((i) => i.code === 'recovery' && i.level === 'illegal' && i.dutyId === last.id)) {
    const plain = home;
    for (const wait of loose ? [-1, LIMITS.recovery, LIMITS.recovery + 12 * 60, LIMITS.recoveryLong] : [LIMITS.recovery, LIMITS.recovery + 12 * 60, LIMITS.recoveryLong]) {
      home = wait < 0 ? planHome(last, homeAt, cabinEarly(g, p)) : planHomeAfter(last, homeAt, wait);
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
  // BLU1396 round: after a planned extension the ticket home waits +4 h of rest; when this crew member rests 2 h more
  // than the minimum before the extended duty, the +2 h before / +2 h after option (ORO.FTL.205(d)) brings them home
  // 2 h sooner. evalSegs decides whether that option holds; the earlier ticket is kept only when nothing gets worse.
  if (!existing && home && last.ext && home.std > last.release + 60) {
    const alt = planHome(last, homeAt, cabinEarly(g, p), EXT_REST.after - EXT_REST.split);
    if (alt.std < home.std) {
      const s2 = buildSegs(g, c, p, duties, out, alt);
      const f2 = evalSegs(ctx, merge(base, s2));
      if (badCount(f2) <= badCount(ftl)) {
        home = alt;
        segs = s2;
        ftl = f2;
      }
    }
  }
  // v0.12.1 home on our own passenger flight (a seat free) instead of the airline ticket, when one leaves in time
  // (ridesHome: the ticket's rest or straight on, at most half a day later) and the timeline gets no worse.
  if (!existing && home && !home.rideId && !(home as Partial<Flight>).id) {
    for (const r of ridesHome(g, last, homeAt, home, cabinEarly(g, p))) {
      const s2 = buildSegs(g, c, p, duties, out, r);
      const f2 = evalSegs(ctx, merge(base, s2));
      if (badCount(f2) > badCount(ftl) || tightCount(f2) > tightCount(ftl)) continue;
      home = r;
      segs = s2;
      ftl = f2;
      break;
    }
  }
  const other = otherTrip(g, c, p, segs[0].start, segs[segs.length - 1].end, existing, leaving, also, guest);
  if (other) issues.push({ code: 'overlap', level: 'illegal', text: `On another ${other.tour ? 'tour' : 'trip'} until ${fmtDay(other.end)}`, dutyId: first.id });
  issues.push(...statusIssues(c, segs[0].start, segs[segs.length - 1].end, typeOf(typeIdOf(g, p)).family, duties));
  // v0.9 new work on a planned day off (UPDATE-0.9.md §R.3): the roster never takes one; a player change confirms it.
  // A tour (deployment) or a trip of several days moves the days off it lands on to free days later in the month (the
  // planner's own re-plan, crew/dayPlan.ts takeOffDays: no morale): legal when the month keeps its count. A day trip
  // never takes one (another crew member can fly it).
  if (!existing) {
    const off = offIssue(g, c, segs);
    const long = tour || (segs.length > 0 && segs[segs.length - 1].end - segs[0].start > 30 * 60);
    // v0.9 fix: the room to move a day off to is read on the whole timeline (other work takes days too).
    if (off) issues.push(long && off.level !== 'illegal' && offMovable(g, c, merge(base, segs), tour) ? { ...off, level: 'legal' } : off);
    // v0.9 fix: never below the month's legal 7 days off, counting the free days the planner can still give.
    const floor = off?.level === 'illegal' ? null : monthFloorIssue(g, c, base, segs);
    if (floor) issues.push(floor);
  }
  if (existing) {
    // v0.9 round 4 fix r2 (§R.16.6): a month that can no longer reach its 7 days off takes one back through an early
    // duty whose eve is free (dayPlan.ts eveFloorIssue): the roster takes the crew member off that duty alone.
    const all = merge(base, segs);
    const eve = eveFloorIssue(g, c, duties, all) ?? dayFloorIssue(g, c, duties, all);
    if (eve) issues.push(eve);
    // Unforeseen delays on the day (ORO.FTL.205(f)): a held seat whose extended recovery slipped stays on the
    // duty once the crew has reported (tight); before report the crew is re-planned like any other limit (v0.9 fix:
    // the 168 h is never planned past).
    for (const i of ftl) if (i.code === 'recovery' && i.level === 'illegal' && i.dutyId && (g.duties[i.dutyId]?.report ?? Infinity) <= g.now) i.level = 'tight';
  }
  // v0.12.1 a later trip's ticket out, not flown yet, from where the crew are now: this trip takes them elsewhere, so that
  // ticket is bought again from where they will be (S1027: a rested captain in Goma refused for "Lisbon, not Goma",
  // her out-ticket for a trip ten days on leaving Goma). Only a planned trip's first duty, not a tour's.
  const retick: string[] = [];
  let retickCost = 0;
  if (!existing) {
    for (const i of ftl) {
      if (i.code !== 'location' || i.level !== 'illegal' || !i.dutyId || own.has(i.dutyId)) continue;
      const q = g.pairings[g.duties[i.dutyId]?.pairingId ?? ''];
      // Bug 1108b: home for a course, a later trip or tour part from the station they leave gets its own ticket out after
      // the course (re-ticketed from home, or re-crewed when that does not work).
      const qd = q && q.status === 'planned' && (!q.tour || guestOn(q, c.id) || (forLeave && !!home)) ? openDuties(g, q)[0] : undefined;
      if (!q || !qd || qd.id !== i.dutyId) continue;
      const tk = qd.deadheadIds.map((id) => g.flights[id]).find((f) => !!f && f.kind === 'deadhead' && f.status === 'scheduled' && f.std - BAL.deadheadCheckIn > g.now && f.sta <= qd.report && aboard(f, c.id));
      if (!tk && forLeave && home && c.blocks?.some((b) => b.why === 'training' && b.from >= home!.sta - DAY && b.to <= qd.report)) {
        i.level = 'legal';
        if (!retick.includes(q.id)) {
          retick.push(q.id);
          retickCost += ticketPrice(c.base, g.flights[qd.flightIds[0]]?.from ?? qd.restAt);
        }
        continue;
      }
      if (!tk) continue;
      i.level = 'legal';
      if (!retick.includes(q.id)) {
        retick.push(q.id);
        retickCost += ticketPrice(home ? home.to : last.restAt, tk.to);
      }
    }
  }
  issues.push(...ftl);
  return { level: levelOf(issues), issues, out, home, segs, drop: dropped.length ? dropped : undefined, ...(retick.length ? { retick, retickCost } : {}), ...(leaveBack ? { leaveBack } : {}), ...(backTo ? { backTo } : {}), ...(guest ? { guest: true as const } : {}) };
}

/**
 * Rotations round: on a one-duty trip whose ticket out joins the duty's day (it lands too close to the report to rest),
 * the day runs from the ticket's check-in: the rest the ticket home waits for is measured from there (planHome's
 * `early`). Before, the ticket home left 11:30 after a 12:30 day and the whole plan read illegal. Pure.
 */
function outExtra(out: TicketPlan | null, duties: Duty[]): number {
  if (!out || duties.length !== 1 || out.rideId) return 0;
  const first = duties[0];
  return outMerges(out, first.report) ? Math.max(0, first.report - (out.std - BAL.deadheadCheckIn)) : 0;
}

/**
 * v0.9.1: c's stand-alone ticket (no duty holds it) out of the last duty's rest airport, the first work after that
 * duty's release and before the next report there: the trip's ticket home in all but name.
 */
export function looseHome(g: GameState, c: CrewMember, base: Seg[], last: Duty): Flight | null {
  const ix = crewIx(g);
  for (const s of base) {
    if (s.kind === 'log' || s.end <= last.release) continue;
    if (s.kind !== 'pos' || !s.ticketId || s.from !== last.restAt) return null;
    const f = g.flights[s.ticketId];
    return f && f.status === 'scheduled' && f.std >= last.release && !ix.ticketDuty.has(f.id) && aboard(f, c.id) ? f : null;
  }
  return null;
}

/** Fresh segs of the pairing's open duties with the planned tickets (out before the first, home after the last). */
function buildSegs(g: GameState, c: CrewMember, p: Pairing, duties: Duty[], out: TicketPlan | null, home: TicketPlan | null): Seg[] {
  const first = duties[0];
  const last = duties[duties.length - 1];
  const segs: Seg[] = [];
  for (const d of duties) for (const x of dutySegs(g, c, p, d, d === first ? out : null, d === last ? home : null, true)) segs.push(x);
  return segs;
}

/** Illegal issues of a plan's timeline. */
const badCount = (l: LegalityIssue[]): number => l.filter((i) => i.level === 'illegal').length;
const tightCount = (l: LegalityIssue[]): number => l.filter((i) => i.level === 'tight').length;

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
/**
 * Bug 1108b: a course c starts after t and before their next work (a duty or a ticket; standby gives way), and before
 * `until` (the schedule horizon: every duty before it is known): they must be home for it. Pure. (v0.19.3 annual leave
 * no longer counts: it begins away with a trip home on its first day, crew/leaveTrips.ts.)
 */
export function leaveBefore(c: CrewMember, segs: Seg[], t: Minute, until: Minute): boolean {
  let next = Math.min(t + 35 * 1440, until);
  for (const s of segs) {
    if (s.kind === 'log' || s.kind === 'sby' || s.start < t) continue;
    next = Math.min(next, s.start);
    break;
  }
  return !!c.blocks?.some((b) => b.why === 'training' && b.from >= t && b.from < next);
}

/** The crew member's next planned work (a duty or a ticket; not standby) starting at or after t. */
function nextWork(segs: Seg[], t: Minute): Seg | null {
  for (const s of segs) if (s.kind !== 'log' && s.kind !== 'sby' && s.start >= t) return s;
  return null;
}

function nextFrom(segs: Seg[], t: Minute): string {
  for (const s of segs) if (s.kind !== 'log' && s.start >= t) return s.start < t + 3 * 1440 ? s.from ?? '' : '';
  return '';
}

/**
 * v0.23 crew planned person by person. Another trip or tour part of c that stands in the way of work over [from, to)
 * (the plan's first check-in to its last landing): one whose open duties overlap it. A seat is a person's own duties and
 * nothing more, so the days between them are free for other work (one duty in the middle of another set's tour, a trip
 * from the station), as long as the timeline holds (rest, limits, where they are and the way back: evalSegs and
 * planCrew's tickets). Was: a tour held its crew "busy" for the whole rotation and a trip of several days from its
 * first duty to its last (v0.22.1 opened that for non-tour side trips from the station only).
 * Two holds stay, both about a member of a set (never a guest):
 *   - work that ends beyond the schedule horizon inside their rotation: the rotation's flying there is not known yet
 *     (its duties roll in 28 days ahead), so the set keeps them;
 *   - joining another set's rotation as a member while their own runs (two rotations at once).
 * With `existing` (re-check of a held seat) only an earlier pairing counts. `leaving`: a pairing c is being swapped
 * off (manual swap), which no longer counts. `also`: trips c was seated on in this roster run (not in the index yet).
 * `guest`: c is (or would be) a guest on p.
 */
export function otherTrip(g: GameState, c: CrewMember, p: Pairing, from: Minute, to: Minute, existing: boolean, leaving?: string, also?: Pairing[], guest = guestOn(p, c.id)): Pairing | null {
  const held = crewIx(g).pairingsOf.get(c.id) ?? [];
  const list = also?.length ? [...held, ...also.filter((x) => !held.includes(x))] : held;
  const member = !!p.tour && !guest;
  const known = g.now + (BAL.scheduleHorizonDays - 1) * DAY;
  for (const q of list) {
    if (q.id === p.id || q.id === leaving || q.status === 'broken') continue;
    const qGuest = guestOn(q, c.id);
    // Rotations round: parts of one set's tour are one commitment (a crew member re-seated on a later part of their own tour).
    if (sameTour(p, q) && member && !qGuest) continue;
    // Re-checking a held seat: only the earlier pairing wins (the later one is flagged and re-rostered).
    if (existing && (q.start > p.start || (q.start === p.start && q.id > p.id))) continue;
    const open = q.status === 'done' ? [] : openDuties(g, q);
    if (dutyClash(open, from, to) >= 0) return q;
    if (qGuest) continue;
    const span = tourSpan(g, q);
    const dep = span && q.deploymentId ? g.deployments[q.deploymentId] : undefined;
    // Crew bug round (the alarm self-check, s0501 AT1002): a finished part of another set's tour at the same station no
    // longer holds a crew member the roster has moved onto this set's tour there ("On another tour until 29 Apr" on 1 May).
    const moved = q.status === 'done' && !open.length && !!p.deploymentId && p.deploymentId === q.deploymentId;
    if (!span || !dep || span.to <= g.now || !(c.loc === dep.base || open.length) || moved) continue;
    const qs = Math.min(span.from, open[0]?.report ?? Infinity, q.start);
    const qe = Math.max(span.to, open[open.length - 1]?.release ?? -Infinity);
    if (qs < to && qe > from && (member || to > known)) return q;
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
