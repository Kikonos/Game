// v0.19.3 "Leave from away" (the player, a flight attendant: "they can deadhead home on the first day of leave and
// deadhead back on the last day of leave. That's how we used to do it at Getjet. That way it doesn't affect the
// rostering."). Annual leave that begins while the crew member is away from base (on a tour or a trip) starts with a
// ticket home on its first day and, when their next duty leaves from a station away from base, ends with a ticket back
// out there on its last day. Both are travel on a leave day: not duty, no rest after it, the leave keeps its days.
// Before (bug 1108b), a trip home was planned before the leave, which took days of the rotation.
//
// Pure helpers (plans, reading); the bookings are the roster's (roster.ts leaveTrips, buyTickets).

import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { CrewMember, Flight, GameState, Minute } from '../core/types';
import { nextDeparture } from '../ops/commercial';
import { dayIndex, midnight } from './dayPlan';
import type { Seg } from './rules';
import { crewIx, dhBlock, slotAfter, type TicketPlan } from './timeline';

type Block = NonNullable<CrewMember['blocks']>[number];

/** Annual leave (not sickness, a course, unpaid leave or a resignation's last days). */
export const isAnnual = (b: Block): boolean => b.why === 'leave' && !!b.annual;

/**
 * A next duty starting within this of the leave's end gets the trip back out on the leave's last day; a tour's (a set on
 * station) gets it whenever it comes: the set lives there, days off and standby at the hotel as before the leave.
 */
export const LEAVE_BACK_GAP = 2 * DAY;
/** The ticket back lands at least this long before the next duty's report. */
export const LEAVE_BACK_BUFFER = 3 * 60;

/** The end of the window the roster books tickets in (the schedule horizon: every duty in it is known). */
export const leaveHorizon = (g: GameState): Minute => g.now + (BAL.scheduleHorizonDays - 1) * DAY;

/**
 * The first seat from → to on base-local day k of crew member c (from 06:00 base time, else from midnight), checked in
 * no earlier than `notBefore`, landing by `latest`. Null when there is none that day. Pure.
 */
export function leaveTripPlan(g: GameState, c: CrewMember, from: string, to: string, k: number, notBefore: Minute, latest: Minute, kind: 'home' | 'back', b?: Block): TicketPlan | null {
  if (from === to || !from || !to) return null;
  // (Inside the leave: a block that does not run from midnight to midnight cuts its first and last day.)
  const a = Math.max(midnight(c.base, k), b?.from ?? -Infinity);
  const z = Math.min(midnight(c.base, k + 1), b?.to ?? Infinity);
  const blk = dhBlock(from, to);
  const lo = Math.max(notBefore + BAL.deadheadCheckIn, g.now + BAL.deadheadCheckIn);
  for (const start of [a + 6 * 60, a]) {
    const t0 = Math.max(start, lo);
    if (t0 >= z) continue;
    // (The timetable first: no hour-by-hour seat search on a day the route does not fly.)
    const dep = nextDeparture(from, to, t0, 2);
    if (dep === null || dep >= z) continue;
    const std = slotAfter(g, from, to, dep, blk);
    if (std === null || std >= z || std + blk > latest) continue;
    return { from, to, std, sta: std + blk, leaveTrip: kind };
  }
  return null;
}

/** The crew member's leave tickets ('home' or 'back') for leave block b, not cancelled. */
export function leaveTicketsOf(g: GameState, c: CrewMember, b: Block, kind: 'home' | 'back'): Flight[] {
  const out: Flight[] = [];
  for (const f of crewIx(g).tickets.get(c.id) ?? []) {
    if (f.leaveTrip !== kind || f.status === 'cancelled' || !f.crewIds.includes(c.id)) continue;
    if (f.std >= b.from - DAY && f.std < b.to + DAY) out.push(f);
  }
  return out;
}

/**
 * The trip home of leave b, booked (a ticket not cancelled) or flown (the crew's journey record: a flown ticket is
 * dropped from the flights two days after it lands): where it left from and when it lands. Null when the leave did not
 * begin away (or its trip home is not booked yet). Pure.
 */
export function leaveHomeTrip(g: GameState, c: CrewMember, b: Block): { from: string; std: Minute; sta: Minute; ticket?: Flight } | null {
  const f = leaveTicketsOf(g, c, b, 'home')[0];
  if (f) return { from: f.from, std: f.std, sta: f.sta, ticket: f };
  const x = c.flown?.find((r) => r.lv && r.s >= b.from - DAY && r.s < b.to && r.legs.length && r.legs[r.legs.length - 1][2] === c.base);
  return x ? { from: x.legs[0][1], std: x.s, sta: x.e } : null;
}

/** A trip back out of leave b booked or flown (as leaveHomeTrip). */
export function leaveBackTaken(g: GameState, c: CrewMember, b: Block): boolean {
  if (leaveTicketsOf(g, c, b, 'back').length) return true;
  return !!c.flown?.some((r) => r.lv && r.s >= b.from && r.s < b.to + DAY && r.legs.length && r.legs[0][1] === c.base);
}

const backSegOf = (segs: Seg[], c: CrewMember, b: Block): Seg | undefined =>
  segs.find((s) => s.leave && s.from === c.base && s.start >= b.from && s.start < b.to + DAY);

/**
 * The trip back out for a duty reporting at `report` from `dep` (away from base): when an annual leave that began away
 * (its trip home is in the timeline) ends within LEAVE_BACK_GAP before it (any time before, on a tour) with no other
 * work between, a seat from base
 * on the leave's last day (else the day before) landing LEAVE_BACK_BUFFER before the report. Null otherwise. Pure.
 */
export function leaveBackFor(g: GameState, c: CrewMember, segs: Seg[], report: Minute, dep: string, tour = false): TicketPlan | null {
  if (!dep || dep === c.base || !c.blocks?.length) return null;
  const b = c.blocks.find((x) => isAnnual(x) && x.to <= report && (tour || report < x.to + LEAVE_BACK_GAP) && x.to > g.now);
  if (!b) return null;
  const home = leaveHomeTrip(g, c, b);
  if (!home || backSegOf(segs, c, b) || leaveBackTaken(g, c, b)) return null;
  // Nothing else between the trip home and the duty (standby gives way).
  if (segs.some((s) => !s.leave && s.kind !== 'log' && s.kind !== 'sby' && s.start >= home.sta && s.start < report)) return null;
  return leaveBackPlan(g, c, b, dep, report - LEAVE_BACK_BUFFER);
}

/** The seat back from base to `to` on the last day of leave b (else the day before it), landing by `latest`. Pure. */
export function leaveBackPlan(g: GameState, c: CrewMember, b: Block, to: string, latest: Minute): TicketPlan | null {
  const kLast = dayIndex(c.base, b.to - 1);
  const k0 = dayIndex(c.base, b.from);
  for (const k of [kLast, kLast - 1]) {
    if (k <= k0) break;
    const p = leaveTripPlan(g, c, c.base, to, k, b.from, latest, 'back', b);
    if (p) return p;
  }
  return null;
}

/**
 * The seat home from `from` on the first day of leave b (the day it can when the leave has begun; else the next day),
 * after `notBefore` (the end of their last work), landing inside the leave. Pure.
 */
export function leaveHomePlan(g: GameState, c: CrewMember, b: Block, from: string, notBefore: Minute): TicketPlan | null {
  const k0 = dayIndex(c.base, Math.max(b.from, g.now));
  const kLast = dayIndex(c.base, b.to - 1);
  for (const k of [k0, k0 + 1]) {
    if (k > kLast || (k > k0 && k >= kLast)) break;
    const p = leaveTripPlan(g, c, from, c.base, k, notBefore, b.to, 'home', b);
    if (p) return p;
  }
  return null;
}
