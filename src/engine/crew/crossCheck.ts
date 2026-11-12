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
// Pure for `g` (it works on a structured copy). Used by scripts/crewcheck.ts and the bot (`--crewcheck`).

import { BAL } from '../core/balance';
import { canFill, isPilot, reportMinutes, typeOf } from '../core/perf';
import { isolatePauses } from '../core/pause';
import { DAY, fmtDateTime } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Minute, Role } from '../core/types';
import { fullDeparture, nextDeparture, prevDeparture, ticketBlock } from '../ops/commercial';
import { acceptable, planCrew } from './check';
import { dayIndex } from './dayPlan';
import { rootReason } from './reasons';
import { offsetAt } from './rules';
import { inflightFits, judgePerson, restNeed, table2, type AlarmKind } from './selfCheck';
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
  for (const p of Object.values(g.pairings)) {
    if (p.id === but || p.status === 'done' || p.status === 'broken' || !p.slots.some((s) => s.crewId === c.id)) continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (!d || d.done || standsBy(g, p, d, c.id)) continue;
      const fl = d.flightIds.map((x) => g.flights[x]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
      if (!fl.length) continue;
      out.push({ start: d.report, end: d.release, from: fl[0].from, to: fl[fl.length - 1].to, kind: 'duty', what: `${fl[0].no} ${fmtDateTime(fl[0].std)}` });
    }
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
        // Rules this check does not read make the seat UNSURE, not WRONG.
        const first = out ? out.std - CHECKIN() : myStart;
        for (let k = dayIndex(c.base, first); k <= dayIndex(c.base, end); k++) if (c.off?.includes(k)) { unsure.push('a planned day off'); break; }
        if (c.blocks?.some((b) => b.from < end && b.to > first)) return no('sick, on leave, in training or not joined yet');
        if (seat.role === 'FO' && c.role === 'CPT') unsure.push('a captain in the first officer\'s seat');
        if (seat.role === 'CC' && c.role === 'PUR') unsure.push('a purser in a cabin crew seat');
        // What the planner itself says about this person (on the game as it is).
        let planner = '';
        const gc = g.crew[c.id];
        const plan = gc ? planCrew(g, gc, p0, segsOf(g, gc), false, BAL.rosterSlack) : null;
        if (gc && plan && !acceptable(g, plan)) {
          const why = rootReason(g, plan.issues, gc, p0);
          planner = why ? `${why.code}: ${why.text}` : 'refused';
          if (why && !['busy', 'place', 'rest', 'fdp'].includes(why.code)) unsure.push(`the planner's rule: ${why.text}`);
        }
        return {
          seat: { role: seat.role, crewId: c.id, name: nameOf(c), at, out: out ? `${rideText(out)}${sameDay ? ' (same day)' : ' (rests there first)'}` : '', back, unsure, planner },
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
