// v0.22.1 the crew-alarm cross-check (the player: "I want every problem card regarding crew shortage … added quietly to
// the bug report. Then when I upload it here, I want you to cross-check them again to see if they actually were right or
// wrong"). Given a game and a flight a crew alarm was raised for, it searches ALL crew for a legal way to crew the
// flight, on its own terms, apart from the planner:
//   - who could take each seat: role and rating, not sick, on leave, in training or joining, nothing else planned over it;
//   - how they get there: already at the departure, or on an airline departure of the route's timetable they can still
//     check in for, either the same day (the ride then counts in the day's length) or the day before with the rest after
//     it; standby gives way (a call-out);
//   - the limits, by the independent evaluator of the alarm self-check (crew/selfCheck.ts judgePerson: rest before the
//     report, the day's length against Table 2, 7/14/28-day duty, 28-day flying) with the rides in the timeline;
//   - how they get back: to where their next work starts (a tour's station, the next trip's departure), on an airline
//     departure after the duty, with the rest before that work and its own limits read again with this trip in.
// Verdicts: RIGHT (no legal crew existed), WRONG (a legal crew plan the planner missed: who, how they get there, how
// they get back), UNSURE (a plan exists only by rules this check does not read: a planned day off, the weekly recovery
// rest, a captain in the first officer's seat …; or the alarm is about something it cannot judge).
// v0.23 it also reads, on its own terms, the rules it used to leave UNSURE: planned days off (one not published yet
// moves when its month has a free day; a published one is the crew member's, taken only by the game's own short-notice
// swap or an automatic buy-back, else that person is not available), the weekly recovery rest (36 h with two local
// nights inside any 168 h; 60 h read as certain) and the rest after a late finish or a trip across time zones.
// What a person holds (their duties still to fly) is read through crew/avail.ts, the one reading the planner shares;
// the limits stay this file's and selfCheck.ts's own (never rules.ts evalSegs).
// Pure for `g` (it works on a structured copy). Used by scripts/crewcheck.ts and the bot (`--crewcheck`).

import { BAL } from '../core/balance';
import { canFill, isPilot, reportMinutes, typeOf } from '../core/perf';
import { isolatePauses } from '../core/pause';
import { DAY, fmtDateTime } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Minute, Role } from '../core/types';
import { fullDeparture, nextDeparture, prevDeparture, ticketBlock } from '../ops/commercial';
import { heldDuties } from './avail';
import { planCrew } from './check';
import { dayIndex, midnight, publishedTo } from './dayPlan';
import { rootReason } from './reasons';
import { offsetAt } from './rules';
import { wouldSeat } from './roster';
import { inflightFits, judgePerson, restNeed, table2, workOf, type AlarmKind, type Span } from './selfCheck';
import { segsOf, standsBy } from './timeline';

export type CrossVerdict = 'RIGHT' | 'WRONG' | 'UNSURE';

export interface CrossSeat {
  role: Role;
  crewId: string;
  name: string;
  /** Where they are when the trip starts. */
  at: string;
  /** 'TP 123 LIS–JED 3 May 20:00, lands 4 May 03:10 (rests there first)'; '' when already at the departure. */
  out: string;
  /** 'back to JED on 5 May 06:00, lands 13:40, 3 days before F37080'; 'free after it'. */
  back: string;
  /** Why this seat is only UNSURE (a day off, a rule not read, the planner's own reason). */
  unsure: string[];
  /** What the planner says about this person for the trip ('' when it would accept them). */
  planner: string;
}

export interface CrossResult {
  verdict: CrossVerdict;
  flightId: string;
  no: string;
  leg: string;
  /** The seats judged (empty ones, and those of crew the check itself finds over a limit). */
  seats: Role[];
  /** The crew plan found (WRONG and UNSURE), one line per seat. */
  plan: CrossSeat[];
  /** One sentence: why this verdict. */
  why: string;
  /** Candidates looked at, and why the others cannot (reason → count). */
  tried: number;
  refused: Record<string, number>;
}

const H = 60;
const CHECKIN = () => BAL.deadheadCheckIn;
/** The ticket lands at least this long before the report (the engine's own connection). */
const CONNECT = 60;
const nameOf = (c: CrewMember) => `${c.first} ${c.last}`;

interface Work { start: Minute; end: Minute; from: string; to: string; kind: 'duty' | 'ticket'; what: string; home?: boolean }

/** Planned work of c still to come (duties of the trips they hold, tickets and rides they are booked on), in time order. */
function workAhead(g: GameState, c: CrewMember, but: string): Work[] {
  const out: Work[] = [];
  // v0.23 what they hold: crew/avail.ts, the reading the planner's "busy" shares (standing by for a duty is not flying it).
  for (const x of heldDuties(g, c, Object.values(g.pairings), but)) {
    if (x.standsBy) continue;
    const fl = x.duty.flightIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
    if (!fl.length) continue;
    out.push({ start: x.start, end: x.end, from: fl[0].from, to: fl[fl.length - 1].to, kind: 'duty', what: `${fl[0].no} ${fmtDateTime(fl[0].std)}` });
  }
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || f.leaveTrip) continue;
    const on = f.kind === 'deadhead' ? f.crewIds.includes(c.id) : !!f.riders?.includes(c.id);
    if (on) out.push({ start: f.std - CHECKIN(), end: f.sta, from: f.from, to: f.to, kind: 'ticket', what: `ticket ${f.from}–${f.to} ${fmtDateTime(f.std)}`, home: f.to === c.base });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

interface Ride { from: string; to: string; std: Minute; sta: Minute }
const rideText = (r: Ride) => `${r.from}–${r.to} ${fmtDateTime(r.std)}, lands ${fmtDateTime(r.sta)}`;

/** The last airline departure from → to that lands by `by` and can still be checked in for from `ready` (null: none). */
function rideBy(from: string, to: string, by: Minute, ready: Minute): Ride | null {
  const blk = ticketBlock(from, to);
  let t = prevDeparture(from, to, by - blk);
  for (let n = 0; t !== null && n < 6; n++) {
    if (t - CHECKIN() < ready) return null;
    if (!fullDeparture(from, to, t)) return { from, to, std: t, sta: t + blk };
    t = prevDeparture(from, to, t - 1);
  }
  return null;
}

/** The first airline departure from → to that can be checked in for from `ready` (null: none in ten days). */
function rideAfter(from: string, to: string, ready: Minute): Ride | null {
  const blk = ticketBlock(from, to);
  let t = nextDeparture(from, to, Math.ceil((ready + CHECKIN()) / 5) * 5);
  for (let n = 0; t !== null && n < 6; n++) {
    if (!fullDeparture(from, to, t)) return { from, to, std: t, sta: t + blk };
    t = nextDeparture(from, to, t + 1);
  }
  return null;
}

/** Limits over (or rest short) in an independent reading, as short words; [] when clear. */
function over(r: ReturnType<typeof judgePerson>, place = true): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(r.values)) {
    if (!v) continue;
    if (k === 'rest' ? v[0] < v[1] : v[0] > v[1]) out.push(k === 'rest' ? 'rest' : k === 'fdp' ? 'day too long' : 'hours');
  }
  if (r.other.status) out.push('not available');
  if (r.other.rating) out.push('not rated');
  if (r.other.overlap) out.push('busy');
  if (place && r.other.location) out.push('wrong place');
  return out;
}

interface Cand { seat: CrossSeat; clean: boolean }

// ---------- v0.23 the rules read on their own: days off, the weekly rest, late finishes and time zones ----------

const OFF = () => BAL.v09.roster.off;

/** Whole local nights at `base` inside [from, to]: 8 h between 22:00 and 08:00 (ORO.FTL.105). */
function localNights(base: string, from: Minute, to: Minute): number {
  if (to <= from) return 0;
  const off = offsetAt(base, from);
  const a = from + off;
  const b = to + off;
  let n = 0;
  for (let day = Math.floor(a / DAY) - 1; day * DAY + 22 * H < b; day++) {
    const lo = Math.max(a, day * DAY + 22 * H);
    const hi = Math.min(b, day * DAY + 32 * H);
    if (hi - lo >= 8 * H) n++;
  }
  return n;
}

const localMinute = (base: string, t: Minute): number => (((t + offsetAt(base, t)) % DAY) + DAY) % DAY;

/**
 * The weekly recovery rest (ORO.FTL.235(d)) for work ending at `end`: 'ok' when a rest of 60 h with two local nights
 * (or the logged one) ends inside the 168 h before it, 'soft' when only a rest of 36–60 h does (60 h is owed after four
 * disruptive duties, which this reading does not count), 'due' when none does. `spans`: selfCheck.ts workOf.
 */
function weeklyRest(c: CrewMember, spans: Span[], end: Minute, now: Minute): 'ok' | 'soft' | 'due' {
  const work = spans.filter((x) => x.kind !== 'leave' && !(x.kind === 'standby' && x.start > now)).sort((a, b) => a.start - b.start || a.end - b.end);
  let firm = c.lastRecovery;
  let soft = c.lastRecovery;
  let free = -Infinity;
  for (const x of work) {
    if (x.start >= end) break;
    if (free > -Infinity && x.start - free >= 36 * H && localNights(c.base, free, x.start) >= 2) {
      soft = Math.max(soft, x.start);
      if (x.start - free >= 60 * H) firm = Math.max(firm, x.start);
    }
    free = Math.max(free, x.end);
  }
  // (Nothing on record before the first work: time off since the last recovery counts as one.)
  if (!work.length || work[0].start >= end) return 'ok';
  if (end <= firm + 168 * H) return 'ok';
  return end <= soft + 168 * H ? 'soft' : 'due';
}

/** The rest rules after a late finish or a trip across time zones, for work starting at `start` from `dep`: the reason, or ''. */
function nightRules(c: CrewMember, spans: Span[], start: Minute, dep: string): string {
  // CS FTL.1.235(b)(3): local nights at home after a rotation four or more zones away.
  if (c.tzBack && start >= c.tzBack.back && localNights(c.base, c.tzBack.back, start) < c.tzBack.nights) return 'back from a trip across time zones';
  // A late finish (23:00–01:59) or a night duty, then an early start (05:00–05:59) from home base: a whole local night between.
  const s = localMinute(c.base, start);
  if (dep !== c.base || s < 5 * H || s >= 6 * H) return '';
  const prev = spans.filter((x) => (x.kind === 'duty' || x.kind === 'log') && x.end <= start).pop();
  if (!prev || start - prev.end >= 2 * DAY) return '';
  const e = localMinute(c.base, prev.end);
  const late = e >= 23 * H || e < 2 * H;
  const night = (() => {
    for (let t = prev.start; t < prev.end; t += 30) { const m = localMinute(c.base, t); if (m >= 2 * H && m < 5 * H) return true; }
    return false;
  })();
  return (late || night) && localNights(c.base, prev.end, start) < 1 ? 'finished late before an early start' : '';
}

/**
 * Planned days off, read on their own for work over [first, end) (the game's own rules, crew/dayPlan.ts and buyBack.ts,
 * in this file's words): the days the work touches (and the eve of a start before 06:00). None: free ('' note). One not
 * published yet moves when its month has a free day for it. A published one is the crew member's: the roster takes it
 * only at short notice, by their agreement to swap it or by an automatic buy-back; otherwise they are not available
 * (the player can still buy the day back on the card: the alarm is right to ask). And a month must keep its 7.
 * `busy`: base-local days with work of theirs (this trip included).
 */
function dayOffRule(g: GameState, c: CrewMember, first: Minute, end: Minute, busy: Set<number>): { ok: boolean; note: string } {
  if (!g.dayPlan || !c.off) return { ok: true, note: '' };
  const today = dayIndex(c.base, g.now);
  const a = dayIndex(c.base, first - OFF().morningFree);
  const b = dayIndex(c.base, end - 1);
  const hits = c.off.filter((k) => k >= a && k <= b);
  const monthOf = (k: number) => { const dt = new Date(k * DAY * 60_000); return dt.getUTCFullYear() * 12 + dt.getUTCMonth(); };
  const firstOf = (mk: number) => Math.floor(Date.UTC(Math.floor(mk / 12), mk % 12, 1) / 60_000 / DAY);
  const blocked = (k: number) => !!c.blocks?.some((x) => x.from < midnight(c.base, k + 1) && x.to > midnight(c.base, k));
  const freeDay = (k: number) => !c.off!.includes(k) && !busy.has(k) && !blocked(k);
  // Free days later in the month a day off can move to.
  const room = (mk: number) => { let n = 0; for (let k = Math.max(today + 2, firstOf(mk)); k < firstOf(mk + 1); k++) if (freeDay(k)) n++; return n; };
  if (!hits.length) {
    // The month's legal 7: its days off, plus the free days the planner has not reached yet.
    const open = g.dayPlan.planned !== undefined ? dayIndex(c.base, g.dayPlan.planned) : today + 1;
    for (const mk of new Set([monthOf(dayIndex(c.base, first)), monthOf(b)])) {
      const m0 = firstOf(mk);
      const m1 = firstOf(mk + 1);
      if (m0 < dayIndex(c.base, g.dayPlan.from) || midnight(c.base, m0) < c.hired || m1 <= today) continue;
      let n = c.off.filter((k) => k >= m0 && k < m1).length;
      for (let k = Math.max(m0, today + 1, open); k < m1 && n < OFF().legalMonth; k++) if (freeDay(k)) n++;
      // (A month partly on leave or sick owes fewer: not judged here.)
      if (n < OFF().legalMonth && !c.blocks?.some((x) => x.from < midnight(c.base, m1) && x.to > midnight(c.base, m0))) return { ok: false, note: 'the month would fall below its 7 days off' };
    }
    return { ok: true, note: '' };
  }
  const pub = dayIndex(c.base, publishedTo(g));
  const byMonth = new Map<number, number>();
  for (const k of hits) byMonth.set(monthOf(k), (byMonth.get(monthOf(k)) ?? 0) + 1);
  const movable = [...byMonth].every(([mk, n]) => room(mk) >= n || c.off!.filter((k) => k >= firstOf(mk) && k < firstOf(mk + 1)).length - (n - room(mk)) >= OFF().minMonth);
  if (hits.every((k) => k >= pub)) return movable ? { ok: true, note: 'a day off not published yet moves within its month' } : { ok: false, note: 'on a planned day off its month has no free day for' };
  const soon = first <= g.now + BAL.v09.roster.swap.horizonH * 60;
  const settled = c.status !== 'joining' && !c.notice;
  const S = BAL.v09.roster.swap;
  if (soon && settled && movable && c.morale >= S.minMorale && (c.offSwapAt === undefined || g.now - c.offSwapAt >= S.everyDays * DAY) && midnight(c.base, hits[0]) >= g.now + S.noticeH * 60) {
    return { ok: true, note: 'a published day off swapped by agreement (short notice)' };
  }
  const B = BAL.v09.roster.buyBack;
  if ((g.company.policies.buyBack ?? 'auto') === 'auto' && first <= g.now + B.horizonH * 60 && settled && c.morale >= B.minMorale && !c.boughtOff?.includes(monthOf(hits[0]))) {
    return { ok: true, note: 'a published day off bought back (the company buys them automatically)' };
  }
  return { ok: false, note: 'on a published day off (only the player can buy it back)' };
}

/**
 * Cross-checks the crew alarm on a flight. `kind`: the alarm's kind when known (a 'rest' alarm is read as in-flight rest
 * at the gate; the others as seats to fill).
 */
export function crossCheck(g: GameState, flightId: string, kind?: AlarmKind): CrossResult {
  const f0 = g.flights[flightId];
  const base = (verdict: CrossVerdict, why: string, extra: Partial<CrossResult> = {}): CrossResult => ({
    verdict, flightId, no: f0?.no ?? '?', leg: f0 ? `${f0.from}–${f0.to} ${fmtDateTime(f0.std + (f0.delay ?? 0))}` : '', seats: [], plan: [], why, tried: 0, refused: {}, ...extra,
  });
  if (!f0) return base('UNSURE', 'the flight is no longer in this game');
  if (f0.status !== 'scheduled') return base('UNSURE', `the flight is ${f0.status} in this snapshot`);
  const d0 = f0.dutyId ? g.duties[f0.dutyId] : undefined;
  const p0 = d0 ? g.pairings[d0.pairingId] : undefined;
  if (!d0 || !p0 || d0.done) return base('UNSURE', 'the flight has no crew plan (duty) in this snapshot');
  return isolatePauses(() => {
    const h = structuredClone(g);
    const f = h.flights[flightId];
    const d = h.duties[d0.id];
    const p = h.pairings[p0.id];
    const ac = p.aircraftId ? h.fleet[p.aircraftId] : undefined;
    const typeId = ac?.typeId ?? 'a320ceo';
    const family = typeOf(typeId).family;
    const rm = reportMinutes(typeId);
    const legs = d.flightIds.map((id) => h.flights[id]).filter((x): x is Flight => !!x && x.status !== 'cancelled');
    if (!legs.length) return base('UNSURE', 'the duty has no legs left');
    const dep = legs[0].from;
    const arr = legs[legs.length - 1].to;
    // In-flight rest at the gate: read on its own from the legs, the facilities and the crew aboard.
    if (kind === 'rest') {
      const r = inflightFits(h, d, p, Math.max(f.std + (f.delay ?? 0), h.now));
      return r.fits ? base('WRONG', `the in-flight rest fits when read on its own: ${r.line}`) : base('RIGHT', `the in-flight rest does not fit: ${r.line}`);
    }
    const emptyOnly = legs.every((x) => x.kind === 'positioning' || x.kind === 'ferry');
    // The seats to fill: required seats that are empty, and seats whose holder the independent reading finds over a limit.
    const open: { i: number; role: Role; holder?: CrewMember; why?: string }[] = [];
    p.slots.forEach((s, i) => {
      if (s.above || (emptyOnly && !isPilot(s.role))) return;
      const c = s.crewId ? h.crew[s.crewId] : undefined;
      if (!c) open.push({ i, role: s.role });
      else if (!standsBy(h, p, d, c.id)) {
        const bad = over(judgePerson(h, c, d, p));
        // v0.23 ... and on the weekly rest and the late-finish / time-zone rest, read on their own.
        const sp = workOf(h, c, d.release);
        const me0 = Math.min(d.report, legs[0].std + (legs[0].delay ?? 0) - rm.report) - (isPilot(c.role) ? 0 : d.cabinEarly ?? 0);
        if (weeklyRest(c, sp, d.release, h.now) === 'due') bad.push('weekly rest due');
        const nr = nightRules(c, sp.filter((x) => x.end <= me0), me0, dep);
        if (nr) bad.push(nr);
        if (bad.length) open.push({ i, role: s.role, holder: c, why: bad.join(', ') });
      }
    });
    if (!open.length) {
      return base('UNSURE', kind === 'hours' || kind === 'takenOff'
        ? 'every seat is filled and nobody aboard is over a limit this check reads (rest, day length, 7/14/28-day duty, 28-day flying): the alarm names a rule it does not read'
        : 'every required seat is filled and the crew aboard are within their limits in this snapshot');
    }
    const aboard = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
    const start = Math.min(d.report, legs[0].std + (legs[0].delay ?? 0) - rm.report);
    const end = d.release;
    const sectors = legs.length;
    const refused: Record<string, number> = {};
    const no = (why: string) => { refused[why] = (refused[why] ?? 0) + 1; return null; };
    let tried = 0;

    /** One person for one seat: the plan, or null (counted by reason). */
    const judge = (c: CrewMember, seat: (typeof open)[number]): Cand | null => {
      tried++;
      const cabin = !isPilot(c.role);
      const myStart = start - (cabin ? d.cabinEarly ?? 0 : 0);
      if (!c.ratings.includes(family)) return no('not rated on the type');
      if (c.notice && c.notice.leaves <= end) return no('leaving the company');
      const ahead = workAhead(h, c, p.id);
      if (ahead.some((w) => w.kind === 'duty' && w.start < end && w.end > myStart)) return no('busy on another duty');
      // Where they are when the trip starts: the end of the last planned work before it, else where they are now.
      const before = ahead.filter((w) => w.end <= myStart);
      const at = before.length ? before[before.length - 1].to : c.loc;
      const unsure: string[] = [];
      // The way there.
      let out: Ride | null = null;
      let sameDay = false;
      if (at !== dep) {
        const ready = Math.max(h.now, c.restUntil, ...before.map((w) => w.end));
        const tz = Math.abs(offsetAt(c.base, myStart) - offsetAt(dep, myStart)) / 60;
        const blk = ticketBlock(at, dep);
        // The day before, with the rest after the ride (as long as the ride with its check-in, 10 h away, 14 h across 4+ zones).
        const rested = rideBy(at, dep, myStart - restNeed(blk + CHECKIN(), dep === c.base, false, tz, false), ready);
        // Else the same day: the ride counts in the day's length, read against Table 2 at its check-in.
        const same = rested ? null : rideBy(at, dep, myStart - CONNECT, ready);
        if (rested) out = rested;
        else if (same) {
          const fdp = end - rm.post - (same.std - CHECKIN());
          const lim = Math.min(table2(same.std - CHECKIN() + offsetAt(at, same.std), sectors), table2(same.std - CHECKIN() + offsetAt(c.base, same.std), sectors));
          if (d.augment > 0 || fdp > lim) return no('in the wrong place: flown in the same day the day runs too long, and no seat lands early enough to rest first');
          out = same;
          sameDay = true;
        } else return no(ahead.some((w) => w.start < myStart && w.end > h.now && w.kind === 'duty') ? 'busy until too late to get there' : 'in the wrong place: no airline seat lands in time');
      }
      // Seated on the copy with the ride in, judged by the independent evaluator.
      const slot = p.slots[seat.i];
      const was = slot.crewId;
      const added: string[] = [];
      const addRide = (r: Ride, duty: Duty) => {
        const id = `xc${added.length}`;
        h.flights[id] = { id, no: 'DH', aircraftId: null, contractId: null, kind: 'deadhead', from: r.from, to: r.to, std: r.std, sta: r.sta, block: r.sta - r.std, crewIds: [c.id], dutyId: null, status: 'scheduled', delay: 0, ev: 0 } as Flight;
        duty.deadheadIds.push(id);
        added.push(id);
      };
      const undo = () => {
        slot.crewId = was;
        for (const id of added) delete h.flights[id];
        d.deadheadIds = d.deadheadIds.filter((id) => !added.includes(id));
      };
      slot.crewId = c.id;
      if (out) addRide(out, d);
      try {
        const r = judgePerson(h, c, d, p);
        const bad = over(r, false);
        if (bad.length) return no(bad[0] === 'rest' ? 'short of rest before it' : bad[0] === 'hours' ? 'over a duty or flying limit with it' : bad[0] === 'day too long' ? 'the day would be too long' : bad[0] === 'busy' ? 'busy on other work' : bad[0]);
        // The way back: to where their next work starts (a way home already booked is no tie: it is re-booked).
        const next = ahead.find((w) => w.start >= end - 1 && !(w.kind === 'ticket' && w.home && w.from !== arr));
        let back = 'free after it';
        if (next) {
          const tzN = Math.abs(offsetAt(c.base, next.start) - offsetAt(next.from, next.start)) / 60;
          const atHome = next.from === c.base;
          const dayLen = end - (out && sameDay ? out.std - CHECKIN() : myStart);
          if (next.from === arr) {
            if (next.start - end < restNeed(dayLen, atHome, d.augment > 0, tzN, !!d.ext)) return no('no rest left before their next duty');
            back = `stays at ${arr} for ${next.what}`;
          } else {
            // Straight after the duty (the ride is duty, the rest after both), else after a rest at the hotel.
            const blkB = ticketBlock(arr, next.from);
            const direct = rideAfter(arr, next.from, end);
            const rested = rideAfter(arr, next.from, end + restNeed(dayLen, false, d.augment > 0, tzN, !!d.ext));
            const okDirect = direct && direct.sta - (out && sameDay ? out.std - CHECKIN() : myStart) <= 18 * H && next.start - direct.sta >= restNeed(direct.sta - myStart, atHome, d.augment > 0, tzN, !!d.ext);
            const okRested = rested && next.start - rested.sta >= restNeed(blkB + CHECKIN(), atHome, false, tzN, false);
            const ride = okDirect ? direct : okRested ? rested : null;
            if (!ride) return no('cannot be back for their next duty in time');
            addRide(ride, d);
            back = `back to ${next.from} on ${rideText(ride)}, ${Math.round((next.start - ride.sta) / H)} h before ${next.what}`;
          }
          // Their next duties read again with this trip in the timeline.
          let n = 0;
          for (const q of Object.values(h.pairings)) {
            if (q.id === p.id || q.status === 'done' || q.status === 'broken' || !q.slots.some((s) => s.crewId === c.id)) continue;
            for (const id of q.dutyIds) {
              const dn = h.duties[id];
              if (!dn || dn.done || dn.report < end || dn.report > end + 14 * DAY || n >= 6) continue;
              n++;
              if (over(judgePerson(h, c, dn, q), false).length) return no('a later duty of theirs would break a limit');
            }
          }
        }
        const first = out ? out.std - CHECKIN() : myStart;
        if (c.blocks?.some((b) => b.from < end && b.to > first)) return no('sick, on leave, in training or not joined yet');
        // v0.23 the weekly rest, the late-finish and time-zone rest and the planned days off, each read on its own.
        const spans = workOf(h, c, end);
        const wk = weeklyRest(c, spans, end, h.now);
        if (wk === 'due') return no('due a weekly rest (36 h with two local nights in 168 h)');
        if (wk === 'soft') unsure.push('the weekly rest holds only if 36 h is enough (60 h is owed after four early, late or night duties)');
        const nr = nightRules(c, spans.filter((x) => x.end <= first), first, out ? out.from : dep);
        if (nr) return no(nr);
        const busyDays = new Set<number>();
        for (const w of [...ahead, { start: first, end }]) for (let k = dayIndex(c.base, w.start); k <= dayIndex(c.base, w.end - 1); k++) busyDays.add(k);
        const off = dayOffRule(h, c, first, end, busyDays);
        if (!off.ok) return no(off.note);
        const notes: string[] = off.note ? [off.note] : [];
        if (seat.role === 'FO' && c.role === 'CPT') unsure.push('a captain in the first officer\'s seat');
        if (seat.role === 'CC' && c.role === 'PUR') unsure.push('a purser in a cabin crew seat');
        // What the planner itself says about this person (on the game as it is).
        let planner = '';
        const gc = g.crew[c.id];
        const plan = gc ? planCrew(g, gc, p0, segsOf(g, gc), false, BAL.rosterSlack) : null;
        // (What the roster does with the plan: accepted as it is, or by a day off moved, swapped or bought back.)
        if (gc && plan && !wouldSeat(g, gc, plan)) {
          const why = rootReason(g, plan.issues, gc, p0);
          planner = why ? `${why.code}: ${why.text}` : 'refused';
          // A rule this check does not read (the year's flying, two-day weekends, standby, night sectors …), or one it
          // reads more simply than the planner (days off, the weekly rest, time zones): UNSURE, not WRONG.
          if (why && (!['busy', 'place', 'rest', 'fdp'].includes(why.code) || /time zones|local night/.test(why.text))) unsure.push(`the planner's rule: ${why.text}`);
        }
        return {
          seat: { role: seat.role, crewId: c.id, name: nameOf(c), at, out: out ? `${rideText(out)}${sameDay ? ' (same day)' : ' (rests there first)'}` : '', back: notes.length ? `${back} (${notes.join('; ')})` : back, unsure, planner },
          clean: !unsure.length,
        };
      } finally {
        undo();
      }
    };

    // Candidates per seat: those at the departure first, then by id (a fixed order).
    const pool = Object.values(h.crew).filter((c) => !aboard.has(c.id) || open.some((s) => s.holder?.id === c.id)).sort((a, b) => Number(b.loc === dep) - Number(a.loc === dep) || (a.id < b.id ? -1 : 1));
    const used = new Set<string>();
    const plan: CrossSeat[] = [];
    let clean = true;
    let filled = 0;
    for (const seat of open) {
      let pick: Cand | null = null;
      for (const c of pool) {
        if (used.has(c.id) || seat.holder?.id === c.id || !canFill(seat.role, c.role)) continue;
        const x = judge(c, seat);
        if (!x) continue;
        if (x.clean) { pick = x; break; }
        pick ??= x;
      }
      if (!pick) continue;
      filled++;
      used.add(pick.seat.crewId);
      plan.push(pick.seat);
      if (!pick.clean) clean = false;
      // Seated for the next seat's judging (two pilots of one trip).
      p.slots[seat.i].crewId = pick.seat.crewId;
    }
    const seats = open.map((s) => s.role);
    const extra = { seats, plan, tried, refused };
    if (filled < open.length) {
      const top = Object.entries(refused).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`).join('; ');
      return base('RIGHT', `no legal crew for ${open.length - filled} of ${open.length} seat${open.length > 1 ? 's' : ''} (${seats.join(', ')}): ${top || 'nobody rated is free'}`, extra);
    }
    if (!clean) return base('UNSURE', `a crew exists only by a rule this check does not read (${[...new Set(plan.flatMap((s) => s.unsure))].join('; ')})`, extra);
    return base('WRONG', `a legal crew existed for ${seats.length === 1 ? 'the seat' : `all ${seats.length} seats`} (${seats.join(', ')})`, extra);
  });
}

/** The plan in plain lines ('CPT Vasco Pereira, at JED; back to JED on …'). */
export function crossPlanLines(r: CrossResult): string[] {
  return r.plan.map((s) => `${s.role} ${s.name}, at ${s.at}${s.out ? `: flies in ${s.out}` : ''}; ${s.back}${s.planner ? ` · planner: ${s.planner}` : ''}${s.unsure.length ? ` · unsure: ${s.unsure.join('; ')}` : ''}`);
}
