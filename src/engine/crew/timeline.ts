// Runtime crew index (crew → pairings, tickets; not saved) and per-crew FTL timelines built from the log,
// planned duties and positioning tickets (DESIGN.md §3.5, §5.2).

import { ACMI_TYPES } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { distance } from '../core/geo';
import { blockMinutes } from '../core/perf';
import { yearOf } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Minute, Pairing } from '../core/types';
import { isDisruptive, maxFdp, minRest, referenceTime, tzDeltaH, type RefTime, type Seg, type TimelineCtx } from './rules';

// ---------- index ----------

interface Ix {
  rev: number;
  built: number;
  pairingsOf: Map<string, Pairing[]>;
  byAircraft: Map<string, Pairing[]>;
  /** Scheduled commercial tickets per crew member. */
  tickets: Map<string, Flight[]>;
  /** Ticket / ridden flight id → duty id. */
  ticketDuty: Map<string, string>;
}

const ixs = new WeakMap<GameState, Ix>();

function raw(g: GameState): Ix {
  let ix = ixs.get(g);
  if (!ix) ixs.set(g, (ix = { rev: 1, built: 0, pairingsOf: new Map(), byAircraft: new Map(), tickets: new Map(), ticketDuty: new Map() }));
  return ix;
}

/** Call after any change to pairings, duties, slots or tickets. */
export function touchCrew(g: GameState): void {
  raw(g).rev++;
}

export function crewRev(g: GameState): number {
  return raw(g).rev;
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
  ix.tickets = new Map();
  ix.ticketDuty = new Map();
  for (const p of Object.values(g.pairings)) {
    if (p.aircraftId) push(ix.byAircraft, p.aircraftId, p);
    for (const s of p.slots) if (s.crewId) push(ix.pairingsOf, s.crewId, p);
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      if (d) for (const fid of d.deadheadIds) ix.ticketDuty.set(fid, d.id);
    }
  }
  for (const f of Object.values(g.flights)) {
    if (f.kind !== 'deadhead' || f.status !== 'scheduled') continue;
    for (const id of f.crewIds) push(ix.tickets, id, f);
  }
  for (const l of ix.pairingsOf.values()) l.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  for (const l of ix.byAircraft.values()) l.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  ix.built = ix.rev;
  return ix;
}

// ---------- flights and duties ----------

export const crewCount = (p: Pairing) => p.slots.reduce((n, s) => n + (s.crewId ? 1 : 0), 0);

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

export function dutyBlock(g: GameState, d: Duty): number {
  let b = 0;
  for (const f of dutyFlights(g, d)) b += f.status === 'done' && f.ata !== undefined && f.atd !== undefined ? f.ata - f.atd : f.block;
  return b;
}

export const restClassOf = (g: GameState, p: Pairing): 1 | 2 | 3 | null => {
  const t = p.aircraftId ? g.fleet[p.aircraftId]?.typeId : undefined;
  return t ? (typeLookup(t)?.restClass ?? null) : null;
};

const typeLookup = (id: string) => ACMI_TYPES[id];

/** Max FDP for a duty of pairing p reporting at `report` from `dep` (reference time per acclimatisation). */
export function fdpLimitAt(g: GameState, p: Pairing, d: Duty, dep: string, report: Minute): { max: number; ref: RefTime } {
  const ref = referenceTime(p.base, dep, Math.min(p.start, report), report);
  let longest = 0;
  for (const f of dutyFlights(g, d)) longest = Math.max(longest, f.block);
  const max = maxFdp({ reportLocal: ref.reportLocal, sectors: d.sectors, acclimatised: ref.state !== 'X', augment: d.augment, restClass: restClassOf(g, p), longestBlock: longest });
  return { max, ref };
}

// ---------- tickets ----------

export interface TicketPlan {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
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

export const dhBlock = (from: string, to: string) => blockMinutes('a320ceo', from, to);

const posRest = (t: TicketPlan, atHome: boolean) => minRest({ dutyMin: t.sta - t.std + CHECKIN(), atHome, augmented: false, tzShift: 0 });

/**
 * Ticket to the first departure of duty d: same day (departs report − 3 h − block, rounded down to the hour;
 * counts as FDP) when the merged FDP keeps 30 min of slack, else the day before with minimum rest on arrival.
 */
export function planOut(g: GameState, p: Pairing, d: Duty, from: string): TicketPlan {
  const to = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const blk = dhBlock(from, to);
  const std = hour(d.report - 180 - blk, false);
  const start = std - CHECKIN();
  const { max } = fdpLimitAt(g, p, d, from, start);
  if (d.fdp + (d.report - start) <= max + (d.discretion ?? 0) - 30) return { from, to, std, sta: std + blk };
  const rest = minRest({ dutyMin: blk + CHECKIN(), atHome: false, augmented: false, tzShift: 0 });
  const std2 = hour(d.report - rest - blk, false);
  return { from, to, std: std2, sta: std2 + blk };
}

/** Ticket home after the last duty: same day when the whole duty stays within 13 h, else after minimum rest. */
export function planHome(d: Duty, to: string): TicketPlan {
  const from = d.restAt;
  const blk = dhBlock(from, to);
  const std = hour(d.release + 60, true);
  if (std + blk - d.report <= 13 * 60) return { from, to, std, sta: std + blk };
  const rest = minRest({ dutyMin: d.release - d.report, atHome: false, augmented: d.augment > 0, tzShift: tzDeltaH(to, from, d.release) });
  const std2 = hour(d.release + rest + CHECKIN(), true);
  return { from, to, std: std2, sta: std2 + blk };
}

// ---------- segs ----------

export function ctxOf(g: GameState, c: CrewMember): TimelineCtx {
  return {
    base: c.base, restUntil: c.restUntil, lastRecovery: c.lastRecovery, blockYear: c.blockYear, blockYearOf: c.blockYearOf ?? yearOf(g.now),
    freeSince: c.log.length ? undefined : c.restUntil - 12 * 60,
  };
}

export function posSeg(t: TicketPlan, c: CrewMember, fresh = false): Seg {
  return { kind: 'pos', start: t.std - CHECKIN(), end: t.sta, fdp: 0, maxFdp: 0, block: 0, sectors: 0, aug: false, disruptive: false, rest: posRest(t, t.to === c.base), at: t.to, fresh };
}

/**
 * Segs of duty d (pairing p) for crew c, with its out/home tickets: a ticket arriving less than minimum rest
 * before report is part of the FDP (F7); one leaving within 10 h of release extends the duty; others are
 * separate positioning segs.
 */
export function dutySegs(g: GameState, c: CrewMember, p: Pairing, d: Duty, out: TicketPlan | null, home: TicketPlan | null, fresh = false): Seg[] {
  const segs: Seg[] = [];
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  let start = d.report;
  let fdp = d.fdp;
  let max = d.maxFdp + (d.discretion ?? 0);
  let tz = referenceTime(p.base, dep, Math.min(p.start, d.report), d.report).tz;
  if (out) {
    if (d.report - out.sta < posRest(out, false)) {
      start = out.std - CHECKIN();
      fdp = d.fdp + (d.report - start);
      const lim = fdpLimitAt(g, p, d, out.from, start);
      max = lim.max + (d.discretion ?? 0);
      tz = lim.ref.tz;
    } else segs.push(posSeg(out, c, fresh));
  }
  let end = d.release;
  let at = d.restAt;
  let tail: Seg | null = null;
  if (home) {
    if (home.std - d.release < 600) {
      end = home.sta;
      at = home.to;
    } else tail = posSeg(home, c, fresh);
  }
  segs.push({
    kind: 'duty', start, end, fdp, maxFdp: max, block: dutyBlock(g, d), sectors: d.sectors, aug: d.augment > 0,
    disruptive: isDisruptive(tz, start, end),
    rest: minRest({ dutyMin: end - start, atHome: at === c.base, augmented: d.augment > 0, tzShift: tzDeltaH(c.base, at, end) }),
    at, dutyId: d.id, fresh,
  });
  if (tail) segs.push(tail);
  return segs;
}

function ticketsFor(g: GameState, d: Duty, crewId: string): { out: TicketPlan | null; home: TicketPlan | null } {
  let out: TicketPlan | null = null;
  let home: TicketPlan | null = null;
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    if (!f || f.status === 'cancelled' || !f.crewIds.includes(crewId)) continue;
    if (f.sta <= d.report) out = f;
    else if (f.std >= d.release) home = f;
  }
  return { out, home };
}

const bySeg = (a: Seg, b: Seg) => a.start - b.start || a.end - b.end;

/** A crew member's timeline: log, planned duties (with their tickets) and loose tickets; optionally without one pairing. */
export function segsOf(g: GameState, c: CrewMember, excludePairing?: string): Seg[] {
  const ix = crewIx(g);
  const segs: Seg[] = c.log.map((e) => ({
    kind: 'log' as const, start: e.start, end: e.end, fdp: e.fdp, maxFdp: Infinity, block: e.block, sectors: e.sectors, aug: e.augmented,
    disruptive: e.disruptive, rest: 0, at: '',
  }));
  const own = new Set<string>();
  for (const p of ix.pairingsOf.get(c.id) ?? []) {
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      if (!d) continue;
      for (const fid of d.deadheadIds) own.add(fid);
      if (d.done || p.id === excludePairing) continue;
      const t = ticketsFor(g, d, c.id);
      for (const s of dutySegs(g, c, p, d, t.out, t.home)) segs.push(s);
    }
  }
  for (const f of ix.tickets.get(c.id) ?? []) {
    if (f.status !== 'scheduled' || own.has(f.id)) continue;
    segs.push(posSeg(f, c));
  }
  return segs.sort(bySeg);
}

/** Where the crew member will be at t (end of the last planned seg before t, else now). */
export function locAt(c: CrewMember, segs: Seg[], t: Minute): string {
  let at = c.loc;
  for (const s of segs) {
    if (s.end > t) break;
    if (s.kind !== 'log' && s.at) at = s.at;
  }
  return at;
}

/** Block minutes in (t − 28 d, t]. */
export function block28(segs: Seg[], t: Minute): number {
  let b = 0;
  for (const s of segs) if (s.end > t - 28 * 1440 && s.end <= t) b += s.block;
  return b;
}

