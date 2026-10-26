// Runtime crew index (crew → pairings, tickets; not saved) and per-crew FTL timelines built from the log,
// planned duties and positioning tickets (DESIGN.md §3.5, §5.2).

import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { distance } from '../core/geo';
import { deadheadFlights, flightsOf, flightsRev } from '../core/entities';
import { itinerary, ticketBlock } from '../ops/commercial';
import { DAY, fmtDateTime, fmtTime, monthKey, yearOf } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Minute, Pairing, StandbyKind } from '../core/types';
import { asbyRest, disruptiveKinds, isDisruptive, maxFdp, minRest, mkSeg, referenceTime, standbyCut, tzDeltaH, type RefTime, type Seg, type TimelineCtx } from './rules';
import { restOf } from './restPlan';

// ---------- index ----------

interface Ix {
  rev: number;
  built: number;
  pairingsOf: Map<string, Pairing[]>;
  byAircraft: Map<string, Pairing[]>;
  /** Scheduled commercial tickets per crew member. */
  tickets: Map<string, Flight[]>;
  /** Ticket / ridden flight id → duty id (v0.7: built on first use after a change). */
  readonly ticketDuty: Map<string, string>;
  /** Operated flight ids inside a (crewed or open) duty (v0.7: built on first use after a change). */
  readonly inDuty: Set<string>;
}

interface RawIx extends Omit<Ix, 'ticketDuty' | 'inDuty'> {
  g: GameState;
  dutyBuilt: number;
  td: Map<string, string>;
  ind: Set<string>;
}

const ixs = new WeakMap<GameState, Ix>();

/** The duty-side sets (most rebuilds are only read for pairings and tickets). */
function dutySets(r: RawIx): void {
  if (r.dutyBuilt === r.built) return;
  r.td = new Map();
  r.ind = new Set();
  for (const p of Object.values(r.g.pairings)) {
    for (const did of p.dutyIds) {
      const d = r.g.duties[did];
      if (!d) continue;
      for (const fid of d.deadheadIds) r.td.set(fid, d.id);
      for (const fid of d.flightIds) r.ind.add(fid);
    }
  }
  r.dutyBuilt = r.built;
}

function raw(g: GameState): Ix {
  let ix = ixs.get(g);
  if (!ix) {
    const r: RawIx = { g, rev: 1, built: 0, dutyBuilt: -1, pairingsOf: new Map(), byAircraft: new Map(), tickets: new Map(), td: new Map(), ind: new Set() };
    Object.defineProperty(r, 'ticketDuty', { get: () => (dutySets(r), r.td) });
    Object.defineProperty(r, 'inDuty', { get: () => (dutySets(r), r.ind) });
    ixs.set(g, (ix = r as unknown as Ix));
  }
  return ix;
}

/** Call after any change to pairings, duties, slots or tickets. */
export function touchCrew(g: GameState): void {
  raw(g).rev++;
}

/** v0.7: crew state the index does not hold changed (status, log, location, a duty done): memo keys move, no rebuild. */
const stateRevs = new WeakMap<GameState, number>();
export function touchCrewState(g: GameState): void {
  stateRevs.set(g, (stateRevs.get(g) ?? 0) + 1);
}

/** Revision of the crew plan and state (UI memo keys). */
export function crewRev(g: GameState): number {
  return raw(g).rev + (stateRevs.get(g) ?? 0);
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
};

export function crewIx(g: GameState): Ix {
  const ix = raw(g);
  if (ix.built === ix.rev) return ix;
  ix.pairingsOf = new Map();
  ix.byAircraft = new Map();
  for (const p of Object.values(g.pairings)) {
    if (p.aircraftId) push(ix.byAircraft, p.aircraftId, p);
    for (const s of p.slots) if (s.crewId) push(ix.pairingsOf, s.crewId, p);
  }
  ix.tickets = flightScan(g).tickets;
  for (const l of ix.pairingsOf.values()) l.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  for (const l of ix.byAircraft.values()) l.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  ix.built = ix.rev;
  return ix;
}

// ---------- flights and duties ----------

/** Crew travelling as passengers: a commercial ticket's crew, or the riders on one of our own empty legs. */
export const passengers = (f: Flight): string[] => (f.kind === 'deadhead' ? f.crewIds : f.riders ?? []);
export const aboard = (f: Flight, crewId: string): boolean => passengers(f).includes(crewId);
/** A positioning trip not yet over (commercial tickets stay 'scheduled' until they land). */
const live = (f: Flight): boolean => f.status === 'scheduled' || (f.kind !== 'deadhead' && f.status === 'enroute');

export const crewCount = (p: Pairing) => p.slots.reduce((n, s) => n + (s.crewId ? 1 : 0), 0);
/** v0.6: a required seat (not one above the legal minimum) is empty. */
export const requiredEmpty = (p: Pairing): boolean => p.slots.some((s) => !s.crewId && !s.above);
/** v0.6: an optional seat above the legal minimum is empty. */
export const aboveEmpty = (p: Pairing): boolean => p.slots.some((s) => !s.crewId && !!s.above);

/** On-blocks: actual, queued (enroute) or scheduled. */
export const onBlocks = (f: Flight): Minute => (f.status === 'done' ? f.ata ?? f.sta : f.status === 'enroute' ? f.eta ?? f.sta : f.sta);

export function dutyFlights(g: GameState, d: Duty): Flight[] {
  const out: Flight[] = [];
  for (const id of d.flightIds) {
    const f = g.flights[id];
    if (f) out.push(f);
  }
  return out;
}

export const typeIdOf = (g: GameState, p: Pairing): string => (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';

/**
 * v0.7.2 ORO.FTL.205(c): cabin crew report this much before the pilots (widebodies); their FDP counts from their
 * own report and their max FDP grows by the same difference, so FDP legality is unchanged; rest after grows.
 * v0.7.3 per duty (`d.cabinEarly`: 0 when their in-flight rest table would bind, C2), else the type's.
 */
export function cabinEarly(g: GameState, p: Pairing, d?: Duty): number {
  return d?.cabinEarly ?? cabinEarlyOf(typeIdOf(g, p));
}
export function cabinEarlyOf(typeId: string): number {
  const t = ACMI_TYPES[typeId];
  return t ? BAL.v072.ftl.cabinEarlyMin[t.body] : 0;
}
const isCabin = (c: CrewMember) => c.role === 'PUR' || c.role === 'CC';

/** v0.7.2 logged block minutes in the 12 calendar months up to `t` (this month and the 11 before). */
export function block12m(c: CrewMember, t: Minute): number {
  const bm = c.blockMonths;
  if (!bm) return 0;
  const k = monthKey(t);
  let s = 0;
  // v0.9 round 4 speed: the 12 keys read directly (no key parse; the same sum).
  for (let m = k - 11; m <= k; m++) s += bm[m] ?? 0;
  return s;
}

export function dutyBlock(g: GameState, d: Duty): number {
  let b = 0;
  // v0.9 round 4 speed: read on every cached dutySegs hit, so no list is built.
  for (const id of d.flightIds) {
    const f = g.flights[id];
    if (f) b += f.status === 'done' && f.ata !== undefined && f.atd !== undefined ? f.ata - f.atd : f.block;
  }
  return b;
}

/**
 * Max FDP for a duty of pairing p reporting at `report` from `dep` (reference time per acclimatisation; positioning
 * merged before the duty). v0.7.3: an augmented duty keeps its augmented limit (it does not vary with report time);
 * an extended or split duty its planned limit when this report is the duty's own.
 */
export function fdpLimitAt(g: GameState, p: Pairing, d: Duty, dep: string, report: Minute): { max: number; ref: RefTime } {
  const ref = referenceTime(p.base, dep, Math.min(p.start, report), report);
  let longest = 0;
  for (const f of dutyFlights(g, d)) longest = Math.max(longest, f.block);
  const rest = restOf(g, p.aircraftId);
  let max = maxFdp({ reportLocal: ref.reportLocal, sectors: d.sectors, acclimatised: ref.state !== 'X', augment: d.augment, restClass: rest.fc?.cls ?? null, cabinClass: rest.cc?.cls ?? null, longestBlock: longest });
  if ((d.ext || d.split) && report === d.report) max = Math.max(max, d.maxFdp);
  return { max, ref };
}

// ---------- tickets ----------

export interface TicketPlan {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  /** Ride this own empty leg instead of buying a ticket. */
  rideId?: string;
}

const CHECKIN = () => BAL.deadheadCheckIn;
const hour = (t: Minute, up: boolean) => (up ? Math.ceil(t / 60) : Math.floor(t / 60)) * 60;

/** Per-person positioning ticket by distance (RESEARCH §5.3). */
export function ticketPrice(from: string, to: string): number {
  if (from === to) return 0;
  const km = distance(from, to);
  const [a, b, c] = BAL.deadheadTicket;
  return km < 1_500 ? a : km < 4_000 ? b : c;
}

/** Ticket door-to-door minutes: the airline itinerary (nonstop, or two legs and a connection; ops/commercial.ts). */
export const dhBlock = (from: string, to: string) => ticketBlock(from, to);

/** Rest after a ticket on its own. Debug round (26 Oct 2026): 14 h away after one across 4+ time zones, as after a duty
 * (seed 1: crew ticketed LIS–SJU, 13:25 on the way, then a duty from San Juan 13:45 later). */
const posRest = (t: TicketPlan, atHome: boolean, tzShift = 0) => minRest({ dutyMin: t.sta - t.std + CHECKIN(), atHome, augmented: false, tzShift });

/** Minimum time from a ticket's arrival at the outstation to the duty's report (airport to crew room). */
export const OUT_CONNECT = 60;
/** Preferred arrival margin before report (delays, immigration): used whenever a ticket that early still fits. */
export const OUT_BUFFER = 180;

/** A ticket out, or why none works (`why`: then `plan` is only the best guess, not workable). */
export interface OutTicket {
  plan: TicketPlan;
  why: string | null;
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
/** '21:40' today (UTC, as the duty modal shows times), else '2 Mar 21:40'. */
const at = (t: Minute, now: Minute) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? fmtTime(t) : fmtDateTime(t));
/** ' (via FRA)' for a ticket with a connection at a hub, else ''. Pure. */
export const viaText = (from: string, to: string, std: Minute, sta: Minute): string => {
  const legs = itinerary(from, to, std, sta);
  return legs.length > 1 ? ` (via ${legs[0].to})` : '';
};

/**
 * Ticket to the first departure of duty d, from `from`, for crew free to check in from `ready` (their rest after
 * earlier work; never before now). In order of preference:
 * 1. our own empty leg there (rideTo);
 * 2. same day, landing 3 h before report (rounded down to the hour; counts as FDP: positioning right before a
 *    duty is FDP) when the merged FDP keeps 30 min of slack;
 * 3. the day before, landing minimum rest before report (rest at the hotel; not FDP);
 * 4. any later same-day ticket landing at least an hour before report whose merged FDP keeps the slack, the
 *    arrival margin closest to 3 h.
 * Tickets leave on the hour and take the airline itinerary's time (ticketBlock). When none can be checked in
 * from `ready`, `why` says exactly why (earliest arrival vs report, or the FDP and the rest it would take).
 * `early`: option 3 only (the longer merged duty would eat the rest before the trip's next duty). Pure.
 */
export function outTicket(g: GameState, p: Pairing, d: Duty, from: string, ready: Minute = g.now, early = false): OutTicket {
  const to = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const free = Math.max(g.now, ready);
  const ride = early ? null : rideTo(g, from, to, d, free);
  if (ride) return { plan: ride, why: null };
  const blk = dhBlock(from, to);
  const mk = (std: Minute): TicketPlan => ({ from, to, std, sta: std + blk });
  const first = hour(free + CHECKIN(), true);
  // v0.11 the rest the check asks for after the ticket (posSeg): 14 h away from base after a ≥ 4 h time-zone shift
  // (CS FTL.1.235(b)(3)(ii)). Planned at 10 h, a ticket to Montréal or New York landed short of rest every time and
  // a delivery ferry from North America never found pilots.
  const rest = minRest({ dutyMin: blk + CHECKIN(), atHome: false, augmented: false, tzShift: tzDeltaH(p.base, to, d.report) });
  const rested = hour(d.report - rest - blk, false);
  if (early) return { plan: mk(rested), why: rested >= first ? null : `Rest at ${to} needed landing by ${at(rested + blk, g.now)}` };
  const disc = d.discretion ?? 0;
  /** Merged FDP and its limit for a ticket leaving at std. */
  const fdpOf = (std: Minute) => {
    const start = std - CHECKIN();
    return { fdp: d.fdp + (d.report - start), max: fdpLimitAt(g, p, d, from, start).max + disc };
  };
  const fits = (std: Minute) => {
    const x = fdpOf(std);
    return x.fdp <= x.max - 30;
  };
  const pref = hour(d.report - OUT_BUFFER - blk, false);
  const prefFits = fits(pref);
  if (pref >= first && prefFits) return { plan: mk(pref), why: null };
  if (rested >= first) return { plan: mk(rested), why: null };
  const last = hour(d.report - OUT_CONNECT - blk, false);
  let best: Minute | null = null;
  for (let std = Math.max(first, rested + 60); std <= last; std += 60) {
    if (!fits(std)) continue;
    if (best === null || Math.abs(d.report - std - blk - OUT_BUFFER) <= Math.abs(d.report - best - blk - OUT_BUFFER)) best = std;
  }
  if (best !== null) return { plan: mk(best), why: null };
  // Nothing works: the old best guess (same day if its FDP fits, else the day before) and the exact reason.
  const plan = mk(prefFits ? pref : rested);
  const t = (x: Minute) => at(x, g.now);
  const resting = free > g.now ? `Resting at ${from} until ${t(free)}; ` : '';
  const cap = (x: string) => (resting ? x : x[0].toUpperCase() + x.slice(1));
  if (last < first) {
    const arr = first + blk;
    return { plan, why: resting + cap(`earliest arrival ${to} ${t(arr)}${viaText(from, to, first, arr)}, must land by ${t(d.report - OUT_CONNECT)} (report ${t(d.report)})`) };
  }
  const x = fdpOf(last);
  const over = x.fdp > x.max ? `${hm(x.fdp)} > ${hm(x.max)} max` : `${hm(x.fdp)}, within 30 min of ${hm(x.max)} max`;
  return { plan, why: resting + cap(`deadhead + duty FDP ${over}; rest at ${to} needed landing by ${t(rested + blk)}`) };
}

/**
 * Whether a booked ticket out (leaving `from` at std, block blk) still works for d as it now stands: the crew rest
 * after it, or the ticket and the duty fit one FDP (a duty moved later leaves an early ticket's crew waiting on duty).
 */
export function outStillFits(g: GameState, p: Pairing, d: Duty, from: string, std: Minute, blk: number): boolean {
  const to = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const rest = minRest({ dutyMin: blk + CHECKIN(), atHome: false, augmented: false, tzShift: tzDeltaH(p.base, to, d.report) });
  if (std + blk + rest <= d.report) return true;
  const start = std - CHECKIN();
  return d.fdp + (d.report - start) <= fdpLimitAt(g, p, d, from, start).max + (d.discretion ?? 0);
}

/** The planned ticket out (outTicket's plan; workable when it can still be checked in: see outTicket). */
export function planOut(g: GameState, p: Pairing, d: Duty, from: string, early = false): TicketPlan {
  return outTicket(g, p, d, from, g.now, early).plan;
}

interface FlightScan {
  rev: number;
  /** Tickets and rides per crew member (commercial tickets scheduled, own legs scheduled or airborne). */
  tickets: Map<string, Flight[]>;
  /** Own empty legs still to fly, by from>to (rides; built on first use). */
  legs: Map<string, Flight[]> | null;
}
const scans = new WeakMap<GameState, FlightScan>();
/** Own legs that carry riders (runtime; rebuilt by a full scan after a load). */
const riderLegs = new WeakMap<GameState, Set<string>>();

export function noteRiders(g: GameState, f: Flight): void {
  riderSet(g).add(f.id);
}

function riderSet(g: GameState): Set<string> {
  let s = riderLegs.get(g);
  if (!s) {
    riderLegs.set(g, (s = new Set()));
    for (const f of Object.values(g.flights)) if (f.riders?.length) s.add(f.id);
  }
  return s;
}

/** Tickets per crew member, once per flight revision (ticket and ride changes always bump it). */
function flightScan(g: GameState): FlightScan {
  let sc = scans.get(g);
  if (sc && sc.rev === flightsRev(g)) return sc;
  sc = { rev: flightsRev(g), tickets: new Map(), legs: null };
  for (const f of deadheadFlights(g)) if (f.status === 'scheduled') for (const id of f.crewIds) push(sc.tickets, id, f);
  const riders = riderSet(g);
  for (const id of [...riders]) {
    const f = g.flights[id];
    if (!f || !f.riders?.length) riders.delete(id);
    else if (f.status === 'scheduled' || f.status === 'enroute') for (const c of f.riders) push(sc.tickets, c, f);
  }
  scans.set(g, sc);
  return sc;
}

function rideLegs(g: GameState): Map<string, Flight[]> {
  const sc = flightScan(g);
  if (sc.legs) return sc.legs;
  sc.legs = new Map();
  for (const id of Object.keys(g.fleet)) {
    for (const f of flightsOf(g, id)) if ((f.kind === 'positioning' || f.kind === 'ferry') && f.status === 'scheduled' && f.aircraftId === id) push(sc.legs, `${f.from}>${f.to}`, f);
  }
  return sc.legs;
}

/**
 * Our own empty leg from → to that lands at least an hour before the duty reports (and not more than two days
 * before), latest first: riding it is preferred to a ticket (DESIGN §5.3). Not legs of the duty itself.
 */
function rideTo(g: GameState, from: string, to: string, d: Duty, free: Minute): TicketPlan | null {
  let best: Flight | null = null;
  for (const f of rideLegs(g).get(`${from}>${to}`) ?? []) {
    if (f.status !== 'scheduled' || f.dutyId === d.id || f.std - CHECKIN() < free || f.sta > d.report - 60 || f.sta < d.report - 2 * 1440) continue;
    if (!best || f.sta > best.sta) best = f;
  }
  return best ? { from, to, std: best.std, sta: best.sta, rideId: best.id } : null;
}

/** Ticket home after the last duty: same day when the whole duty stays within 13 h, else after minimum rest. */
export function planHome(d: Duty, to: string, early = 0): TicketPlan {
  // v0.7.2 `early`: the cabin crew's earlier report (one ticket for the whole crew: the longest day sets the rest).
  const from = d.restAt;
  const blk = dhBlock(from, to);
  const std = hour(d.release + 60, true);
  if (std + blk - d.report + early <= 13 * 60) return { from, to, std, sta: std + blk };
  const rest = minRest({ dutyMin: d.release - d.report + early, atHome: false, augmented: d.augment > 0, tzShift: tzDeltaH(to, from, d.release) });
  const std2 = hour(d.release + rest + CHECKIN(), true);
  return { from, to, std: std2, sta: std2 + blk };
}

/** Ticket home leaving `wait` after release (a recovery rest at the hotel before positioning home). */
export function planHomeAfter(d: Duty, to: string, wait: number): TicketPlan {
  const std = hour(d.release + wait + CHECKIN(), true);
  return { from: d.restAt, to, std, sta: std + dhBlock(d.restAt, to) };
}

// ---------- segs ----------

export function ctxOf(g: GameState, c: CrewMember): TimelineCtx {
  return {
    base: c.base, restUntil: c.restUntil, lastRecovery: c.lastRecovery, blockYear: c.blockYear, blockYearOf: c.blockYearOf ?? yearOf(g.now),
    freeSince: c.log.length ? undefined : c.restUntil - 12 * 60, loc: c.loc, now: g.now, block12m: block12m(c, g.now),
    twoDays: c.twoDays, workEnd: c.log.length ? c.log[c.log.length - 1].end : c.restUntil - 12 * 60, rot: c.rot, tzBack: c.tzBack,
  };
}

/** v0.7.1: check-in before a ride: the FBO's 30 min for a chartered jet, the airline's for a ticket. */
export const checkInOf = (t: TicketPlan): number => ((t as Partial<Flight>).charter ? BAL.crewControl.jet.checkInMin : CHECKIN());

export function posSeg(t: TicketPlan, c: CrewMember, fresh = false): Seg {
  return mkSeg({ kind: 'pos', start: t.std - checkInOf(t), end: t.sta, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, rest: posRest(t, t.to === c.base, tzDeltaH(c.base, t.to, t.sta)), at: t.to, from: t.from, dutyId: undefined, ticketId: (t as Partial<Flight>).id, fresh });
}

/** A ticket already flown on its own is in the crew log (onFlightArrCrew); only merged ones still shape the duty. */
const flown = (t: TicketPlan): boolean => (t as Partial<Flight>).status === 'done';

/** Minimum rest after a duty that started at `start` and ends at `e` in `a` (home base `base`). */
const restAfterAt = (start: Minute, base: string, augmented: boolean, e: Minute, a: string, extended = false) => minRest({ dutyMin: e - start, atHome: a === base, augmented, tzShift: tzDeltaH(base, a, e), extended });

/**
 * Segs of duty d (pairing p) for crew c, with its out/home tickets: a ticket arriving less than minimum rest
 * before report is part of the FDP (F7); one leaving within 10 h of release extends the duty; others are
 * separate positioning segs.
 */
/** v0.7.3 dutySegs memo per duty (the hot path of the roster): segs are read-only, so cached ones are shared. */
interface SegMemo { v: (string | number)[]; segs: Seg[] }
const dutySegMemo = new WeakMap<Duty, SegMemo[]>();
/** The inputs of one call, filled in place (no allocation on a hit; copied into the memo on a miss). */
const KEY: (string | number)[] = [];
function fillKey(g: GameState, c: CrewMember, p: Pairing, d: Duty, out: TicketPlan | null, home: TicketPlan | null, fresh: boolean): number {
  const rest = p.aircraftId ? g.fleet[p.aircraftId]?.rest : undefined;
  const f0 = g.flights[d.flightIds[0]];
  const o = out as Partial<Flight> | null;
  const h = home as Partial<Flight> | null;
  let i = 0;
  KEY[i++] = (isCabin(c) ? 1 : 0) + (fresh ? 2 : 0) + (d.ext ? 4 : 0) + (d.split ? 8 : 0);
  KEY[i++] = c.base; KEY[i++] = p.base; KEY[i++] = d.restAt; KEY[i++] = f0?.from ?? ''; KEY[i++] = f0?.status ?? ''; KEY[i++] = p.aircraftId ?? '';
  KEY[i++] = d.ev; KEY[i++] = d.flightsEv; KEY[i++] = d.report; KEY[i++] = d.release; KEY[i++] = d.fdp; KEY[i++] = d.maxFdp; KEY[i++] = d.discretion ?? 0; KEY[i++] = d.cabinEarly ?? -1;
  KEY[i++] = d.augment; KEY[i++] = d.sectors; KEY[i++] = d.flightIds.length; KEY[i++] = p.start; KEY[i++] = rest?.fc?.cls ?? 0; KEY[i++] = rest?.cc?.cls ?? 0;
  KEY[i++] = joinedAt(p, c.id, d);
  KEY[i++] = o ? o.id ?? '' : '-'; KEY[i++] = o?.from ?? ''; KEY[i++] = o?.to ?? ''; KEY[i++] = o?.status ?? ''; KEY[i++] = o?.std ?? -1; KEY[i++] = o?.sta ?? -1;
  KEY[i++] = h ? h.id ?? '' : '-'; KEY[i++] = h?.from ?? ''; KEY[i++] = h?.to ?? ''; KEY[i++] = h?.status ?? ''; KEY[i++] = h?.std ?? -1; KEY[i++] = h?.sta ?? -1;
  return i;
}

export function dutySegs(g: GameState, c: CrewMember, p: Pairing, d: Duty, out: TicketPlan | null, home: TicketPlan | null, fresh = false): Seg[] {
  // Every input of dutySegsRaw (ids, places, flags, times, limits), compared in place.
  const n = fillKey(g, c, p, d, out, home, fresh);
  let list = dutySegMemo.get(d);
  if (list) {
    outer: for (const m of list) {
      for (let i = 0; i < n; i++) if (m.v[i] !== KEY[i]) continue outer;
      // The duty's block changes as its legs land (actual block times): read fresh. v0.9 round 3 speed: the cached list
      // itself when nothing changed (callers only read it or copy its segs into their own arrays).
      const block = dutyBlock(g, d);
      let same = true;
      for (const x of m.segs) if (x.kind === 'duty' && x.block !== block) same = false;
      // v0.9 round 4 speed: the updated list is kept (segsOf's dependency check reads the list by identity).
      if (!same) m.segs = m.segs.map((x) => (x.kind === 'duty' && x.block !== block ? { ...x, block } : x));
      return m.segs;
    }
  }
  const v = KEY.slice(0, n);
  const segs = dutySegsRaw(g, c, p, d, out, home, fresh);
  if (!list) dutySegMemo.set(d, (list = []));
  if (list.length >= 8) list.shift();
  list.push({ v, segs });
  return segs;
}

/** v0.9 round 4 (§Y.1): the report of crew member `crewId` on duty d: the slot's own `from` when they joined after the duty reported. */
function joinedAt(p: Pairing, crewId: string, d: Duty): Minute {
  for (const s of p.slots) {
    if (s.crewId !== crewId) continue;
    const f = s.from;
    return f !== undefined && f > d.report ? f : d.report;
  }
  return d.report;
}

function dutySegsRaw(g: GameState, c: CrewMember, p: Pairing, d: Duty, out: TicketPlan | null, home: TicketPlan | null, fresh: boolean): Seg[] {
  const segs: Seg[] = [];
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const early = isCabin(c) ? cabinEarly(g, p, d) : 0;
  // A replacement who joined after the report has a shorter day from their own report (its own Table 2 limit).
  const rep = joinedAt(p, c.id, d);
  const own = rep - d.report;
  let start = rep - early;
  let fdp = d.fdp - own + early;
  let max = (own ? fdpLimitAt(g, p, d, dep, rep).max : d.maxFdp) + (d.discretion ?? 0) + early;
  let tz = referenceTime(p.base, dep, Math.min(p.start, rep), rep).tz;
  let from = dep;
  let mergedOut: Seg['out'];
  if (out) {
    if (rep - out.sta < posRest(out, false)) {
      mergedOut = { id: (out as Partial<Flight>).id, to: dep, start, fdp, maxFdp: max, disruptive: isDisruptive(tz, start, d.release) };
      start = out.std - checkInOf(out);
      from = out.from;
      fdp = d.fdp - own + (rep - start);
      const lim = fdpLimitAt(g, p, d, out.from, start);
      max = lim.max + (d.discretion ?? 0) + early;
      tz = lim.ref.tz;
    } else if (!flown(out)) segs.push({ ...posSeg(out, c, fresh), dutyId: d.id });
  }
  let end = d.release;
  let at = d.restAt;
  let tail: Seg | null = null;
  let merged: Seg['home'];
  if (home) {
    if (home.std - d.release < 600) {
      merged = { id: (home as Partial<Flight>).id, from: d.restAt, std: home.std, release: d.release, rest: restAfterAt(start, c.base, d.augment > 0, d.release, d.restAt, !!d.ext) };
      end = home.sta;
      at = home.to;
    } else if (!flown(home)) tail = { ...posSeg(home, c, fresh), dutyId: d.id };
  }
  const k = disruptiveKinds(tz, start, end);
  segs.push(mkSeg({
    kind: 'duty', start, end, fdp, maxFdp: max, block: dutyBlock(g, d), sectors: d.sectors, aug: d.augment > 0,
    disruptive: k.early || k.late || k.night, early: k.early, late: k.late, night: k.night, ...(d.ext ? { ext: true } : {}), ...(d.split ? { split: true } : {}),
    rest: restAfterAt(start, c.base, d.augment > 0, end, at, !!d.ext), at, from, dutyId: d.id, fresh, home: merged, out: mergedOut,
  }));
  if (tail) segs.push(tail);
  return segs;
}

function ticketsFor(g: GameState, d: Duty, crewId: string, deps: unknown[]): { out: TicketPlan | null; home: TicketPlan | null } {
  let out: TicketPlan | null = null;
  let home: TicketPlan | null = null;
  deps.push(d.report, d.release);
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    deps.push(f ?? null);
    if (!f) continue;
    const on = aboard(f, crewId);
    deps.push(f.status, on, f.sta, f.std);
    if (f.status === 'cancelled' || !on) continue;
    if (f.sta <= d.report) out = f;
    else if (f.std >= d.release) home = f;
  }
  return { out, home };
}

const bySeg = (a: Seg, b: Seg) => a.start - b.start || a.end - b.end;

/** A crew member's timeline: log, planned duties (with their tickets) and loose tickets; optionally without one pairing. */
/** v0.7: the log's segs, shared while the log array and its length stand (entries are never edited; segs are read-only). */
const logSegCache = new WeakMap<CrewMember['log'], { n: number; segs: Seg[] }>();
function logSegs(c: CrewMember): Seg[] {
  const hit = logSegCache.get(c.log);
  if (hit && hit.n === c.log.length) return hit.segs;
  const segs = c.log.map((e) => mkSeg({
    kind: 'log', start: e.start, end: e.end, fdp: e.fdp, maxFdp: Infinity, block: e.block, sectors: e.sectors, aug: e.augmented,
    disruptive: e.disruptive, rest: 0, at: '', dutyId: undefined, fresh: false, ext: e.ext, early: e.early, late: e.late, night: e.night,
  }));
  logSegCache.set(c.log, { n: c.log.length, segs });
  return segs;
}

/**
 * v0.9 round 3 speed: segsOf per crew member, per crew/flight revision and game minute (the key the crew read APIs
 * already use: control.ts memoOf, hr.ts availMemo), plus the standby list and the log (changed in place by the day
 * planner before it touches the revision). v0.9 round 4: the cached list itself is returned, shared read-only like
 * its segs (callers filter, merge or copy; none changes it in place).
 */
/**
 * v0.9 round 4 speed (§R.17): per crew member. A revision bump by another crew member's change no longer costs a
 * rebuild: an entry records everything its build read (`deps`: the pairings, duties, duty segs, tickets and scalars,
 * in reading order) and, when the crew or flight revision moved, the same walk reads them again and compares (a few
 * objects, no segs built). Entries that fail are dropped.
 *
 * v0.9 round 5 speed (§R.19): in two layers. The work layer (`WorkMemo`: the log, the duties and the tickets) is the
 * walk above; the standby layer (`SegsMemo`) lays the crew member's windows over it (addStandby) and is keyed on the
 * work entry, the standby list, its calls and the game minute's 28-day cut (`nowLo` / `nowHi`). The day planner
 * replaces nearly every crew member's standby list every day and a call-out or a fit replaces more: a third of all
 * timeline reads rebuilt the whole walk for a standby change alone; now only the overlay is laid again.
 */
interface WorkMemo { rev: number; frev: number; ex: string; log: unknown; logN: number; deps: unknown[]; segs: Seg[] }
interface SegsMemo { id: number; work: WorkMemo; nowLo: Minute; nowHi: Minute; sby: unknown; sbyN: number; calls: (Minute | undefined)[]; segs: Seg[] }
const workMemo = new WeakMap<CrewMember, WorkMemo[]>();
const segsMemo = new WeakMap<CrewMember, SegsMemo[]>();
/** A cached list → its entry (check.ts planCrew's memo keys on it: the base is the same while the entry stands). */
const segsTag = new WeakMap<Seg[], SegsMemo>();
let segsIds = 0;
export const segsTagOf = (segs: Seg[]): number | undefined => segsTag.get(segs)?.id;

/** The work layer: the log's segs, the duties' and the loose tickets', sorted (no standby). */
function workOf(g: GameState, c: CrewMember, ex: string): WorkMemo {
  const rev = crewRev(g);
  const frev = flightsRev(g);
  let list = workMemo.get(c);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.ex !== ex || m.log !== c.log || m.logN !== c.log.length) continue;
      if (m.rev !== rev || m.frev !== frev) {
        if (!sameDeps(g, c, m)) {
          list.splice(i--, 1);
          continue;
        }
        m.rev = rev;
        m.frev = frev;
      }
      return m;
    }
  }
  const deps: unknown[] = [];
  const segs = logSegs(c).slice();
  walk(g, c, ex, deps, segs);
  const m: WorkMemo = { rev, frev, ex, log: c.log, logN: c.log.length, deps, segs };
  if (!list) workMemo.set(c, [m]);
  else {
    if (list.length >= 4) list.shift();
    list.push(m);
  }
  return m;
}

/** The standby windows' calls as read by addStandby (a call is written on the window in place). */
function sameCalls(m: SegsMemo, sby: CrewMember['standby']): boolean {
  const calls = m.calls;
  if (!sby) return calls.length === 0;
  if (calls.length !== sby.length) return false;
  for (let i = 0; i < sby.length; i++) if (sby[i].calledAt !== calls[i]) return false;
  return true;
}

export function segsOf(g: GameState, c: CrewMember, excludePairing?: string): Seg[] {
  const work = workOf(g, c, excludePairing ?? '');
  const now = g.now;
  let list = segsMemo.get(c);
  if (list) {
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (m.work !== work || m.sby !== c.standby || m.sbyN !== (c.standby?.length ?? 0) || now <= m.nowLo || now > m.nowHi) continue;
      if (!sameCalls(m, c.standby)) {
        list.splice(i--, 1);
        continue;
      }
      return m.segs;
    }
  }
  const segs = work.segs.slice();
  const b = addStandby(g, c, segs);
  const calls: (Minute | undefined)[] = [];
  for (const w of c.standby ?? []) calls.push(w.calledAt);
  const m: SegsMemo = { id: ++segsIds, work, nowLo: b.lo, nowHi: b.hi, sby: c.standby, sbyN: c.standby?.length ?? 0, calls, segs };
  if (!list) segsMemo.set(c, [m]);
  else {
    if (list.length >= 4) list.shift();
    list.push(m);
  }
  segsTag.set(segs, m);
  return segs;
}

const DEPS: unknown[] = [];
function sameDeps(g: GameState, c: CrewMember, m: WorkMemo): boolean {
  DEPS.length = 0;
  walk(g, c, m.ex, DEPS, null);
  const d = m.deps;
  if (DEPS.length !== d.length) return false;
  for (let i = 0; i < d.length; i++) if (DEPS[i] !== d[i]) return false;
  return true;
}

/**
 * The work build (into `segs`: the log's segs, the duties' and the loose tickets', sorted) or, with null, only its
 * inputs (`deps`): one walk, so the dependency list always matches what the build read. Standby is the overlay's
 * (segsOf, addStandby).
 */
function walk(g: GameState, c: CrewMember, ex: string, deps: unknown[], segs: Seg[] | null): void {
  const ix = crewIx(g);
  const own = new Set<string>();
  const ps = ix.pairingsOf.get(c.id);
  deps.push(c.base, ps ? ps.length : 0);
  for (const p of ps ?? []) {
    deps.push(p, p.id, p.dutyIds.length);
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      deps.push(d ?? null);
      if (!d) continue;
      // A released duty's tickets still to fly are loose positioning (listed below), even for the excluded
      // pairing: re-planning only touches the tickets of duties still to fly.
      deps.push(d.done);
      if (d.done) continue;
      deps.push(d.deadheadIds.length);
      for (const fid of d.deadheadIds) {
        own.add(fid);
        deps.push(fid);
      }
      if (p.id === ex) continue;
      const t = ticketsFor(g, d, c.id, deps);
      const ds = dutySegs(g, c, p, d, t.out, t.home);
      deps.push(ds);
      if (segs) for (const s of ds) segs.push(s);
    }
  }
  const ts = ix.tickets.get(c.id);
  deps.push(ts ? ts.length : 0);
  for (const f of ts ?? []) {
    deps.push(f, f.status, f.kind, f.id);
    if (!live(f) || own.has(f.id)) continue;
    deps.push(f.std, f.sta, f.from, f.to, f.charter);
    if (!segs) continue;
    const ps = posSeg(f, c);
    // v0.7.4 a released duty's ticket home already inside its log entry (logged up to the landing) is not counted twice.
    // Its landing is still where the crew will be: the log entry carries it (a copy; the cached seg stays as logged), so
    // the roster plans the next ticket out from there and not from where the crew are until it flies.
    const k = segs.findIndex((l) => l.kind === 'log' && l.start <= ps.start && l.end >= ps.end);
    if (k >= 0) {
      if (segs[k].at !== ps.at) segs[k] = { ...segs[k], at: ps.at };
      continue;
    }
    segs.push(ps);
  }
  if (segs) segs.sort(bySeg);
}

/** v0.9 share of a standby window counted towards the ORO.FTL.210 duty windows, by kind (§R.3). */
export const sbyShare = (kind: StandbyKind | undefined): number => BAL.v09.roster.share[kind ?? 'home'] ?? 0.25;

/** v0.9 a standby window as a timeline seg (uncalled; `end` cuts it at a call-out, with no rest before the duty). */
export function standbySeg(c: CrewMember, w: NonNullable<CrewMember['standby']>[number], end?: Minute, fresh = false): Seg {
  // v0.9 speed: an uncalled window's seg is the same object every time (windows are replaced, never edited, except
  // calledAt; segs are shared read-only, as logSegs' are).
  const plain = end === undefined && !fresh && w.calledAt === undefined;
  if (plain) {
    const hit = SBY_SEGS.get(w);
    if (hit && hit.base === c.base) return hit.seg;
  }
  const seg = makeSbySeg(c, w, end, fresh);
  if (plain) SBY_SEGS.set(w, { base: c.base, seg });
  return seg;
}
const SBY_SEGS = new WeakMap<object, { base: string; seg: Seg }>();
function makeSbySeg(c: CrewMember, w: NonNullable<CrewMember['standby']>[number], end: Minute | undefined, fresh: boolean): Seg {
  const kind = w.kind ?? 'home';
  const at = w.at ?? c.base;
  const to = end ?? w.to;
  // Rest after an uncalled window (ORO.FTL.235): 12 h at home, 10 h away; airport standby is duty (its length);
  // reserve is neither duty nor rest.
  const rest = end !== undefined || kind === 'reserve' ? 0 : minRest({ dutyMin: kind === 'airport' ? w.to - w.from : 0, atHome: at === c.base, augmented: false, tzShift: 0 });
  return mkSeg({ kind: 'sby', start: w.from, end: to, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, share: sbyShare(kind), rest, at: '', from: at, ...(kind !== 'home' ? { sby: kind } : {}), ...(fresh ? { fresh: true } : {}) });
}

/**
 * v0.7.3 standby windows in a timeline (CS FTL.1.225): not rest; they move nobody (no `at`, so where the crew are
 * stays the last movement's) and start where the crew are (base, or the station of a hotel standby). A called window
 * ends at the report of the duty it was called for, whose max FDP shrinks by kind (rules.ts standbyView) and which
 * carries the awake cap. v0.9: every kind with its share; past windows stay 28 days (the duty windows count them).
 */
/**
 * v0.9 round 3 speed: per standby list (and its length, the number called and the base), its uncalled windows as
 * sorted segs: most timelines are read many times between two changes of the list.
 */
const sbyLists = new WeakMap<object, { n: number; called: number; base: string; segs: Seg[] }>();

function addStandby(g: GameState, c: CrewMember, segs: Seg[]): { lo: Minute; hi: Minute } {
  const list = c.standby ?? [];
  // The minutes for which the 28-day cut keeps the same windows in (`now` in (lo, hi]).
  let lo = -Infinity;
  let hi = Infinity;
  const old = g.now - 28 * 1440;
  for (const w of list) {
    if (w.to < old) lo = Math.max(lo, w.to);
    else hi = Math.min(hi, w.to);
  }
  const bounds = { lo: lo + 28 * 1440, hi: hi + 28 * 1440 };
  if (!list.length) return bounds;
  let called = 0;
  for (const w of list) if (w.calledAt !== undefined) called++;
  let e = sbyLists.get(list);
  if (!e || e.n !== list.length || e.called !== called || e.base !== c.base) {
    const un: Seg[] = [];
    for (const w of list) if (w.calledAt === undefined) un.push(standbySeg(c, w));
    un.sort(bySeg);
    sbyLists.set(list, (e = { n: list.length, called, base: c.base, segs: un }));
  }
  const add: Seg[] = [];
  for (const x of e.segs) if (x.end >= old) add.push(x);
  for (const w of called ? list : []) {
    if (w.to < old || w.calledAt === undefined) continue;
    const k = segs.findIndex((x) => x.kind === 'duty' && x.start >= w.calledAt! - 60 && x.start < w.calledAt! + 1440);
    // v0.9 fix: called for a ticket (a fly-in), the window runs to the ticket's check-in: the rest before it ended at
    // the window's start, not at the flight (a zero-length window read as rest up to the ticket: 2 nights, a recovery).
    const any = k >= 0 ? k : segs.findIndex((x) => (x.kind === 'pos' || x.kind === 'log') && x.start >= w.calledAt! - 60 && x.start < w.calledAt! + 1440);
    const end = any >= 0 ? Math.max(w.calledAt, segs[any].start) : w.calledAt;
    const kind = w.kind ?? 'home';
    if (k >= 0 && kind !== 'reserve') {
      const y = segs[k];
      // Round 4: the 23:00–07:00 exclusion on the standby station's clock; airport standby is part of the duty period
      // the rest after it must cover (rules.ts asbyRest).
      const by = standbyCut(kind === 'airport' ? 'airport' : 'home', w.from, y.start, kind === 'hotel' ? w.at ?? c.base : c.base, y.aug || !!y.split, w.calledAt);
      segs[k] = { ...y, maxFdp: y.maxFdp - by, sbyFrom: w.from, sby: kind, ...(kind === 'airport' ? { rest: asbyRest(c.base, w.from, y) } : {}) };
    }
    if (end > w.from) add.push(standbySeg(c, w, end));
  }
  if (!add.length) return bounds;
  // v0.9 speed: merged into the sorted timeline (as a stable sort of both: timeline segs first on a tie).
  if (called) add.sort(bySeg);
  const out = new Array<Seg>(segs.length + add.length);
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < segs.length && j < add.length) out[n++] = bySeg(segs[i], add[j]) <= 0 ? segs[i++] : add[j++];
  while (i < segs.length) out[n++] = segs[i++];
  while (j < add.length) out[n++] = add[j++];
  segs.length = 0;
  for (let k = 0; k < n; k++) segs.push(out[k]);
  return bounds;
}

/** A seg of a deployment tour: its crews rotate through base, so their tickets are never dropped. */
const onTour = (g: GameState, x: Seg): boolean => !!(x.dutyId && g.pairings[g.duties[x.dutyId]?.pairingId ?? '']?.tour);

/**
 * Tickets home from `dep` that a trip from dep in [report, release) makes unnecessary: the crew are still there
 * (a positioning seg, or a ticket merged into the duty before it) and stay on instead of flying home and back out
 * (DESIGN §5.3: a hotel night is cheaper than two tickets). Not tickets already checked in, nor a tour's. Pure.
 */
export function droppableHome(g: GameState, c: CrewMember, segs: Seg[], dep: string, report: Minute, release: Minute): string[] {
  const out: string[] = [];
  const now = g.now;
  const near = (start: Minute) => start + CHECKIN() > now && start >= report - 2 * 1440 && start < release + 1440;
  for (const x of segs) {
    if (onTour(g, x)) continue;
    if (x.kind === 'pos' && x.ticketId && x.from === dep && x.at === c.base && near(x.start) && locAt(c, segs, x.start) === dep) out.push(x.ticketId);
    else if (x.kind === 'duty' && x.home?.id && x.home.from === dep && x.at === c.base && near(x.home.std - CHECKIN())) out.push(x.home.id);
  }
  return out;
}

/**
 * Tickets out of base to `station` that become unnecessary when a trip ends there at `release`: the crew's next
 * work is a trip from the station they were going to fly back out to (the first thing after release, within two
 * days), so they stay on instead of flying home first. Not tickets already checked in. Pure.
 */
export function droppableOut(g: GameState, c: CrewMember, segs: Seg[], station: string, release: Minute): string[] {
  const now = g.now;
  for (const x of segs) {
    if (x.kind === 'log' || x.end <= release) continue;
    if (x.start < release || x.start >= release + 2 * 1440 || onTour(g, x)) return [];
    if (x.kind === 'pos' && x.ticketId && x.from === c.base && x.at === station && x.start > now) return [x.ticketId];
    if (x.kind === 'duty' && x.out?.id && x.from === c.base && x.out.to === station && x.start > now) return [x.out.id];
    return [];
  }
  return [];
}

/** The timeline without the given tickets (positioning segs removed, merged ones taken off their duty). */
export function withoutTickets(segs: Seg[], ids: string[]): Seg[] {
  if (!ids.length) return segs;
  const out: Seg[] = [];
  for (const x of segs) {
    if (x.ticketId && ids.includes(x.ticketId)) continue;
    let y = x;
    if (y.home?.id && ids.includes(y.home.id)) y = { ...y, end: y.home.release, at: y.home.from, rest: y.home.rest, home: undefined };
    if (y.out?.id && ids.includes(y.out.id)) y = { ...y, start: y.out.start, fdp: y.out.fdp, maxFdp: y.out.maxFdp, from: y.out.to, disruptive: y.out.disruptive, out: undefined };
    out.push(y);
  }
  return out;
}

/**
 * Where the crew member will be at t (end of the last planned seg before t, else now). Logged duties carry no place,
 * except one ending with a ticket home still to land (segsOf): the crew will be where it lands.
 */
export function locAt(c: CrewMember, segs: Seg[], t: Minute): string {
  let at = c.loc;
  for (const s of segs) {
    if (s.end > t) break;
    if (s.at) at = s.at;
  }
  return at;
}

/** Block minutes in (t − 28 d, t]. */
export function block28(segs: Seg[], t: Minute): number {
  let b = 0;
  for (const s of segs) if (s.end > t - 28 * 1440 && s.end <= t) b += s.block;
  return b;
}

