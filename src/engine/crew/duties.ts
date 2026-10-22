// Duties, pairings and deployments (DESIGN.md §5.3). An aircraft's flights are cut into units at crew-change
// stations (home base, deployment base, night-stops), partitioned into FDPs by dynamic programming, then
// chained into trips (base → base) or deployment tours (staggered crew sets on station).

import { BAL } from '../core/balance';
import { flightsOf, nextId } from '../core/entities';
import { cabinMinimum, reportMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, dayStart, yearOf } from '../core/time';
import type { AcRest, Contract, CrewMember, CrewSlot, Deployment, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import {
  AUG_MAX_SECTORS, augLimitOf, disruptiveKinds, FDP_CAP, evalSegs, extFdp, LIMITS, localMin, longestWorkBlock, longSector, MAX_SECTORS, maxFdp, minRest, NIGHT_MAX_SECTORS, offsetAt, referenceTime,
  splitFdp, tzDeltaH, woclMinutes, worst, type Seg, type TimelineCtx,
} from './rules';
import { crewExtraFor, seatsFor, type Seat } from './extraSeats';
import { cabinEarly, cabinEarlyOf, crewCount, crewIx, dutyBlock, dutyFlights, onBlocks, touchCrew } from './timeline';
import { pilotsOnlyTrip, planRest, restOf, type RestLeg, type RestPlan } from './restPlan';

// ---------- duty measures ----------

interface Shape {
  report: Minute;
  release: Minute;
  fdp: number;
  sectors: number;
  longest: number;
  dep: string;
  restAt: string;
  /** v0.7.2 cabin crew report this much earlier (widebodies): the type's value (pickPlan may drop it, C2). */
  early: number;
  /** v0.7.3 the operated legs (split duty, rest plan, WOCL). */
  fl: Flight[];
  lastOn: Minute;
}

function shape(typeId: string, fl: Flight[], keepReport?: Minute): Shape {
  const rm = reportMinutes(typeId);
  const report = keepReport ?? fl[0].std - rm.report;
  const lastOn = onBlocks(fl[fl.length - 1]);
  let longest = 0;
  for (const f of fl) longest = Math.max(longest, f.block);
  return { report, release: lastOn + rm.post, fdp: lastOn - report, sectors: fl.length, longest, dep: fl[0].from, restAt: fl[fl.length - 1].to, early: cabinEarlyOf(typeId), fl, lastOn };
}

/** v0.7.3 how a duty is made legal (UPDATE-0.7.3.md §2.3): Table 2/3, split duty, planned extension, 3 or 4 pilots. */
export type PlanMode = 'basic' | 'split' | 'ext' | 'aug1' | 'aug2';
/** Partition cost of each mode (fewest duties first, then the cheapest way to make them legal). */
const MODE_COST: Record<PlanMode, number> = { basic: 0, split: 0.25, ext: 0.5, aug1: 1, aug2: 2 };

interface PlanPick {
  mode: PlanMode;
  augment: 0 | 1 | 2;
  max: number;
  /** Table 2/3 max (the discretion base after an extension). */
  basic: number;
  ok: boolean;
  /** Cabin crew early report on this duty (0 when their rest table would bind). */
  early: number;
  /** Extra cabin crew the rest plan needs. */
  restExtra: number;
  split?: NonNullable<Duty['split']>;
}

interface PlanCtx {
  rest: AcRest;
  /** The company holds the augmented crew approval. */
  canAug: boolean;
  /** Split duty allowed (a single unit when planning; the duty already split when re-measuring). */
  split: boolean;
  /** Planned extension allowed (planning a single unit; or kept when re-measuring). */
  ext: boolean;
  /** The player asked for 4 pilots. */
  forceAug?: boolean;
  /** v0.7.3 crewed at load from an older save: augmentation without the rest-plan check. */
  legacy?: boolean;
  cabinN: number;
}

/** A Table 2 report time and the clock it is read on. */
interface RefAt { reportLocal: number; acclimatised: boolean; tz: string }

const legsOf = (fl: Flight[]): RestLeg[] => fl.map((f) => ({ id: f.id, std: f.status === 'done' || f.status === 'enroute' ? f.atd ?? f.std : f.std, sta: onBlocks(f) }));

/** v0.7.3 the longest ground break of a duty at one airport as a split duty (CS FTL.1.220), or null under 3 h net. */
export function splitOf(fl: Flight[], tz: string): (NonNullable<Duty['split']> & { gap: number }) | null {
  const S = BAL.v073.split;
  let best: (NonNullable<Duty['split']> & { gap: number }) | null = null;
  for (let i = 1; i < fl.length; i++) {
    const a = fl[i - 1];
    const b = fl[i];
    if (a.to !== b.from) continue;
    const gap = b.std - onBlocks(a);
    const net = gap - S.excludeMin;
    if (net < S.minNet || (best && net <= best.net)) continue;
    const room: 'lounge' | 'hotel' = net >= S.hotelFrom || woclMinutes(tz, onBlocks(a), b.std) > 0 ? 'hotel' : 'lounge';
    best = { at: a.to, net, room, flightId: b.id, gap };
  }
  return best;
}

/**
 * v0.7.3 the first legal plan in the order basic → split → extension → 3 pilots → 4 pilots (the player's "4 pilots"
 * first), each tried only when allowed; augmentation needs both rest facilities, ≤ 3 sectors and a rest plan that
 * fits the cruise (CS FTL.1.205(c)(1)). Not legal: the basic limit with ok false.
 */
function pickPlan(sh: Shape, ref: RefAt, ctx: PlanCtx): PlanPick {
  const basic = maxFdp({ reportLocal: ref.reportLocal, sectors: sh.sectors, acclimatised: ref.acclimatised, augment: 0, restClass: null, longestBlock: sh.longest });
  const fail: PlanPick = { mode: 'basic', augment: 0, max: basic, basic, ok: false, early: sh.early, restExtra: 0 };
  const aug = (a: 1 | 2): PlanPick | null => {
    const { fc, cc } = ctx.rest;
    if (!ctx.canAug || !fc || !cc || sh.sectors > AUG_MAX_SECTORS) return null;
    // No cabin crew aboard (a pilots-only trip): the pilots' limit alone.
    const lim = ctx.cabinN > 0 ? augLimitOf(fc.cls, cc.cls, a, longSector(sh.sectors, sh.longest), sh.early) : augLimitOf(fc.cls, 1, a, longSector(sh.sectors, sh.longest), 0);
    if (sh.fdp > lim.max) return null;
    let extra = 0;
    if (!ctx.legacy) {
      const plan = planRest(legsOf(sh.fl), ctx.rest, a, sh.fdp + lim.early, ctx.cabinN);
      if (!plan.ok) return null;
      extra = plan.extraCabin;
    }
    return { mode: a === 1 ? 'aug1' : 'aug2', augment: a, max: lim.max, basic, ok: true, early: lim.early, restExtra: extra };
  };
  if (ctx.forceAug) {
    const x = aug(2);
    if (x) return x;
  }
  if (sh.sectors <= MAX_SECTORS && sh.fdp <= basic) return { ...fail, ok: true };
  if (ctx.split && sh.sectors <= MAX_SECTORS) {
    const sp = splitOf(sh.fl, ref.tz);
    const m = sp ? splitFdp(basic, sp.net) : null;
    if (sp && m !== null && sh.fdp <= m) return { ...fail, mode: 'split', max: m, ok: true, split: { at: sp.at, net: sp.net, room: sp.room, flightId: sp.flightId } };
  }
  if (ctx.ext && ref.acclimatised) {
    const m = extFdp(ref.reportLocal, sh.sectors, woclMinutes(ref.tz, sh.report, sh.lastOn));
    if (m !== null && sh.fdp <= m) return { ...fail, mode: 'ext', max: m, ok: true };
  }
  for (const a of ctx.forceAug ? ([] as (1 | 2)[]) : ([1, 2] as const)) {
    const x = aug(a);
    if (x) return x;
  }
  return fail;
}

export const canAugment = (g: GameState, rest: AcRest | 1 | 2 | 3 | null) => (typeof rest === 'object' && rest !== null ? !!rest.fc && !!rest.cc : !!rest) && g.company.approvals.includes('augmented');

/** v0.7.3 cabin crew a plan is made for: the legal minimum plus the client's required extra cabin crew; 0 on a pilots-only trip. */
function planCabinN(g: GameState, acId: string | null, fl: Flight[], p?: Pairing): number {
  if (p && pilotsOnlyTrip(g, p)) return 0;
  const ac = acId ? g.fleet[acId] : undefined;
  let req = 0;
  for (const f of fl) {
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    if (c) req = Math.max(req, c.requirements.extraCabin ?? 0);
  }
  return Math.max(cabinMinimum(ac?.cabin.total ?? 180), 1) + req;
}

/**
 * Plan-time choice: the stricter of the two clocks the crew may be on at report (v0.5.2): home base for the first
 * 48 h away (FTL state B, syncDuty), the departure airport after. Cutting only by the departure clock left early
 * 4-sector days one band over the limit once measured in their pairing.
 */
function planAugment(g: GameState, sh: Shape, ctx: PlanCtx): PlanPick {
  const a = pickPlan(sh, { reportLocal: localMin(sh.dep, sh.report), acclimatised: true, tz: sh.dep }, ctx);
  const home = g.company.homeBase;
  if (!a.ok || sh.dep === home || tzDeltaH(home, sh.dep, sh.report) === 0) return a;
  const b = pickPlan(sh, { reportLocal: localMin(home, sh.report), acclimatised: true, tz: home }, ctx);
  return !b.ok || MODE_COST[b.mode] > MODE_COST[a.mode] || (b.mode === a.mode && b.max < a.max) ? b : a;
}

export function dutyLegality(d: Duty): Legality {
  const max = d.maxFdp + (d.discretion ?? 0);
  return d.fdp > max ? 'illegal' : d.fdp > max - LIMITS.tightFdp ? 'tight' : 'legal';
}

/** v0.7.3 the duty's planning mode. */
export const modeOf = (d: Duty): PlanMode => (d.augment === 2 ? 'aug2' : d.augment === 1 ? 'aug1' : d.ext ? 'ext' : d.split ? 'split' : 'basic');

/** Stores a plan on a duty (augmentation, limit, extension / split, basic limit, cabin early report, extra cabin crew). */
function applyPick(d: Duty, pa: PlanPick): void {
  d.augment = pa.augment;
  d.maxFdp = pa.max;
  d.basicFdp = pa.basic;
  d.cabinEarly = pa.early;
  if (pa.mode === 'ext' && pa.ok) d.ext = true;
  else delete d.ext;
  if (pa.mode === 'split' && pa.split) d.split = pa.split;
  else delete d.split;
  if (pa.restExtra) d.restExtra = pa.restExtra;
  else delete d.restExtra;
}

/**
 * v0.7.3 the limit of a reported duty in the mode it reported with (never re-planned under way): the augmented,
 * extended or split maximum when still measurable, else Table 2/3.
 */
function keepMode(d: Duty, sh: Shape, ref: RefAt, rest: AcRest): PlanPick {
  const basic = maxFdp({ reportLocal: ref.reportLocal, sectors: sh.sectors, acclimatised: ref.acclimatised, augment: 0, restClass: null, longestBlock: sh.longest });
  const base: PlanPick = { mode: 'basic', augment: 0, max: basic, basic, ok: sh.fdp <= basic, early: d.cabinEarly ?? sh.early, restExtra: d.restExtra ?? 0 };
  if (d.augment > 0 && rest.fc && rest.cc && sh.sectors <= AUG_MAX_SECTORS) {
    const lim = augLimitOf(rest.fc.cls, rest.cc.cls, d.augment as 1 | 2, longSector(sh.sectors, sh.longest), sh.early);
    return { ...base, mode: d.augment === 1 ? 'aug1' : 'aug2', augment: d.augment, max: lim.max, ok: sh.fdp <= lim.max };
  }
  if (d.ext) {
    const m = extFdp(ref.reportLocal, sh.sectors, woclMinutes(ref.tz, sh.report, sh.lastOn));
    if (m !== null) return { ...base, mode: 'ext', max: m, ok: sh.fdp <= m };
  }
  if (d.split) {
    const sp = splitOf(sh.fl, ref.tz);
    const m = sp ? splitFdp(basic, sp.net) : null;
    if (sp && m !== null) return { ...base, mode: 'split', max: m, ok: sh.fdp <= m, split: { at: sp.at, net: sp.net, room: sp.room, flightId: sp.flightId } };
  }
  return base;
}

/**
 * Re-measures a duty from its flights in its pairing's context (reference time, plan). v0.7.3: the same plan order
 * as planning, but an extension or split only kept (never added), a reported duty's mode never changed, and
 * delayed reporting (CS FTL.1.205(d)): with crew notified of an earlier report, a delay under 4 h keeps the
 * notified report's limit, 4–10 h takes the more limiting, 10 h or more is a new day.
 */
export function syncDuty(g: GameState, d: Duty, p: Pairing): void {
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  if (!fl.length) {
    // Every leg cancelled: nothing to rest on, no stale augmentation (the complement shrinks back).
    if (d.augment > 0 || d.restExtra) {
      d.augment = 0;
      d.maxFdp = d.basicFdp ?? d.maxFdp;
      delete d.restExtra;
      delete d.forceAug;
    }
    return;
  }
  const typeId = (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';
  const crewed = crewCount(p) > 0;
  const reported = p.status === 'active' && d.report <= g.now && crewed;
  const sh = shape(typeId, fl, reported ? d.report : undefined);
  const refOf = (report: Minute): RefAt => {
    const r = referenceTime(p.base, sh.dep, Math.min(p.start, report), report);
    return { reportLocal: r.reportLocal, acclimatised: r.state !== 'X', tz: r.tz };
  };
  const ref = refOf(sh.report);
  const rest = restOf(g, p.aircraftId);
  let pa: PlanPick;
  if (reported) pa = keepMode(d, sh, ref, rest);
  else if (d.legacyRest && d.augment > 0) {
    // v0.7.3 crewed before the in-flight rest rules (an older save, within 72 h of loading): kept as rostered.
    pa = { ...keepMode(d, sh, ref, rest), mode: d.augment === 1 ? 'aug1' : 'aug2', augment: d.augment, max: d.maxFdp, ok: sh.fdp <= d.maxFdp };
  } else {
    const ctx: PlanCtx = { rest, canAug: canAugment(g, rest), split: !!d.split, ext: !!d.ext, forceAug: d.forceAug === 2, legacy: d.legacyRest, cabinN: planCabinN(g, p.aircraftId, fl, p) };
    pa = pickPlan(sh, ref, ctx);
    // Delayed reporting: only once crew were told a report time.
    if (!crewed) delete d.notified;
    else if (d.notified === undefined) d.notified = sh.report;
    else if (sh.report !== d.notified) {
      const delay = sh.report - d.notified;
      if (g.now <= d.notified - BAL.v073.delayed.republishH * 60 || delay >= 10 * 60) d.notified = sh.report;
      else if (delay > 0) {
        // The limit read at the notified report; the FDP still counts from the delayed one.
        const told = pickPlan(sh, refOf(d.notified), ctx);
        if (delay < 4 * 60 || !told.ok || (pa.ok && told.max < pa.max)) pa = told;
      }
    }
  }
  d.flightIds = fl.map((f) => f.id);
  d.report = sh.report;
  d.release = sh.release;
  d.fdp = sh.fdp;
  d.sectors = sh.sectors;
  applyPick(d, pa);
  d.restAt = sh.restAt;
  d.flightsEv = fl.reduce((s, f) => s + f.ev, 0);
  d.legality = dutyLegality(d);
}

/** Crew check before report (roster.guardDuty): a 'duty.report' event this long before the report. */
export const GUARD_MIN = 120;

/** (Re)queues duty.report (and its guard check GUARD_MIN before) / duty.release; bumping ev makes older events stale. */
export function queueDuty(g: GameState, d: Duty): void {
  d.ev++;
  const first = g.flights[d.flightIds[0]];
  if (!first || first.status === 'scheduled') {
    if (d.report - GUARD_MIN > g.now) schedule(g, d.report - GUARD_MIN, 'duty.report', d.id, d.ev);
    schedule(g, Math.max(d.report, g.now), 'duty.report', d.id, d.ev);
  }
  schedule(g, Math.max(d.release, g.now), 'duty.release', d.id, d.ev);
}

/**
 * v0.5.2: a duty under way whose next leg now leaves a night-stop after the last landing (an AOG or a long hold
 * away from base) ends at that landing: the crew go to the hotel and the later legs become a duty of their own
 * (own report, FDP and rest), not one duty stretched over days. Tickets home move to the new duty. The caller
 * re-sorts the pairing (refreshPairing). The new duty, or null.
 */
export function splitUnderWay(g: GameState, p: Pairing, d: Duty): Duty | null {
  if (d.done || d.report > g.now) return null;
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  const typeId = (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';
  const rm = reportMinutes(typeId);
  for (let i = 1; i < fl.length; i++) {
    const a = fl[i - 1];
    const b = fl[i];
    if (a.status !== 'done' || b.status !== 'scheduled') continue;
    const landed = onBlocks(a);
    const need = minRest({ dutyMin: landed - d.report + cabinEarly(g, p, d), atHome: a.to === g.company.homeBase, augmented: d.augment > 0, tzShift: tzDeltaH(g.company.homeBase, a.to, landed), extended: !!d.ext }) + rm.report + rm.post;
    if (b.std - landed < need) continue;
    const later = fl.slice(i);
    const d2: Duty = {
      id: nextId(g, 'du'), pairingId: p.id, report: Number.MAX_SAFE_INTEGER, release: 0, flightIds: later.map((f) => f.id), deadheadIds: [], sectors: 0,
      fdp: 0, maxFdp: 0, augment: 0, restAt: '', legality: 'legal', ev: 0, flightsEv: 0,
    };
    g.duties[d2.id] = d2;
    for (const f of later) f.dutyId = d2.id;
    d.flightIds = fl.slice(0, i).map((f) => f.id);
    d2.deadheadIds = d.deadheadIds.filter((id) => (g.flights[id]?.std ?? 0) > landed);
    d.deadheadIds = d.deadheadIds.filter((id) => !d2.deadheadIds.includes(id));
    p.dutyIds.push(d2.id);
    syncDuty(g, d, p);
    syncDuty(g, d2, p);
    if (crewCount(p) > 0) {
      queueDuty(g, d);
      queueDuty(g, d2);
    }
    touchCrew(g);
    return d2;
  }
  return null;
}

// ---------- pairings ----------

const ROLE_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];

/**
 * Complement for a pairing: the largest augmentation of its duties (the whole set flies every duty), the client's
 * required extra cabin crew, then the optional seats above the legal minimum (v0.6 crew-extra settings).
 */
export function pairingSeats(g: GameState, p: Pairing): Seat[] {
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const typeId = ac?.typeId ?? 'a320ceo';
  let augment: 0 | 1 | 2 = 0;
  let restCabin = 0;
  // Cabin crew are needed only when passengers are carried: a trip of empty legs flies with its pilots.
  let empty = true;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d) continue;
    if (d.augment > augment) augment = d.augment;
    if (d.augment > 0) restCabin = Math.max(restCabin, d.restExtra ?? 0);
    for (const fid of d.flightIds) {
      const k = g.flights[fid]?.kind;
      if (k && k !== 'positioning' && k !== 'ferry') empty = false;
    }
  }
  const c: Contract | undefined = p.contractId ? g.contracts[p.contractId] : undefined;
  const x = crewExtraFor(g, p.aircraftId, p.contractId);
  const seats = seatsFor(typeId, ac?.cabin.total ?? 180, x, c?.requirements.extraCabin ?? 0, { augment, restCabin, pilotsOnly: empty });
  const rank = (s: Seat) => (s.above ? 10 : 0) + ROLE_ORDER.indexOf(s.role);
  return seats.sort((a, b) => rank(a) - rank(b));
}

/** v0.6: the legal minimum complement of a pairing (no client or company extras): pilots and cabin crew. */
export function legalMinimum(g: GameState, p: Pairing): { pilots: number; cabin: number } {
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  let augment: 0 | 1 | 2 = 0;
  let restCabin = 0;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d) continue;
    if (d.augment > augment) augment = d.augment;
    if (d.augment > 0) restCabin = Math.max(restCabin, d.restExtra ?? 0);
  }
  const seats = seatsFor(ac?.typeId ?? 'a320ceo', ac?.cabin.total ?? 180, { cabin: 0, pilot: 0 }, 0, { augment, restCabin });
  const pilots = seats.filter((s) => s.role === 'CPT' || s.role === 'FO' || s.role === 'CRP').length;
  return { pilots, cabin: seats.length - pilots };
}

/** Crew on a pairing above its legal minimum, by group (client-requested, company and optional extras). */
export function aboveMinimum(g: GameState, p: Pairing): { pilots: number; cabin: number } {
  const min = legalMinimum(g, p);
  let pilots = 0;
  let cabin = 0;
  for (const s of p.slots) {
    if (!s.crewId || !g.crew[s.crewId]) continue;
    if (s.role === 'CPT' || s.role === 'FO' || s.role === 'CRP') pilots++;
    else cabin++;
  }
  return { pilots: Math.max(0, pilots - min.pilots), cabin: Math.max(0, cabin - min.cabin) };
}

/** Roles of the pairing's seats (required, then above the minimum). */
export const pairingRoles = (g: GameState, p: Pairing): Role[] => pairingSeats(g, p).map((s) => s.role);

const seatKey = (s: { role: Role; above?: boolean }) => (s.above ? `${s.role}+` : s.role);

/**
 * Start/end, slots and duty measures of a pairing. Slots follow the complement: assigned crew keep a slot of
 * their role (an above-minimum holder moves into an empty required seat of a role they can fill); surplus slots
 * are dropped (their crew returned for the caller to unassign).
 */
export function refreshPairing(g: GameState, p: Pairing): string[] {
  const duties = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
  duties.sort((a, b) => a.report - b.report);
  p.dutyIds = duties.map((d) => d.id);
  if (!duties.length) return [];
  if (p.status === 'planned') p.start = duties[0].report;
  for (const d of duties) if (!d.done) syncDuty(g, d, p);
  p.start = p.status === 'planned' ? duties[0].report : Math.min(p.start, duties[0].report);
  p.end = duties[duties.length - 1].release;
  const seats = pairingSeats(g, p);
  const dropped: string[] = [];
  // Extra seats (manual, above the complement) ride along unchanged after the complement's slots.
  const extras = p.slots.filter((s) => s.extra);
  const core = extras.length ? p.slots.filter((s) => !s.extra) : p.slots;
  if (seats.map(seatKey).join() !== core.map(seatKey).join()) {
    const old = core;
    const used = new Set<number>();
    const next: CrewSlot[] = seats.map((seat) => (seat.above ? { role: seat.role, crewId: null, above: true } : { role: seat.role, crewId: null }));
    // Same seat kind first, then the same role across kinds (a spare takes a required seat; a required holder an above one).
    for (const loose of [false, true]) {
      next.forEach((slot, j) => {
        if (slot.crewId) return;
        const i = old.findIndex((s, k) => !used.has(k) && s.crewId && s.role === slot.role && (loose || !!s.above === !!slot.above));
        if (i < 0) return;
        used.add(i);
        slot.crewId = old[i].crewId;
        if (old[i].locked) slot.locked = true;
        next[j] = slot;
      });
    }
    old.forEach((s, k) => {
      if (!used.has(k) && s.crewId) dropped.push(s.crewId);
    });
    p.slots = [...next, ...extras];
  }
  let lg: Legality = 'legal';
  for (const d of duties) lg = worst(lg, d.legality);
  p.legality = lg;
  delete p.illegalFrom;
  return dropped;
}

function newPairing(g: GameState, duties: Duty[], acId: string, deploymentId: string | null, tour?: Pairing['tour']): Pairing {
  const contractId = contractOfDuties(g, duties)?.id ?? null;
  const p: Pairing = {
    id: nextId(g, 'p'), aircraftId: acId, contractId, deploymentId, base: g.company.homeBase,
    start: duties[0].report, end: duties[duties.length - 1].release, dutyIds: duties.map((d) => d.id), slots: [], status: 'planned', legality: 'legal',
  };
  if (tour) p.tour = tour;
  g.pairings[p.id] = p;
  for (const d of duties) d.pairingId = p.id;
  refreshPairing(g, p);
  return p;
}

function contractOfDuties(g: GameState, duties: Duty[]): Contract | undefined {
  for (const d of duties) for (const id of d.flightIds) {
    const c = g.flights[id]?.contractId;
    if (c && g.contracts[c]) return g.contracts[c];
  }
  return undefined;
}

/**
 * Splits a pairing at t: duties reporting at or after t move to a new pairing with the same crew, seats and tour
 * (tickets stay on their duties). Lets one crew member leave from t (sickness, a manual change) while the rest of
 * the trip keeps its crew. Returns the later part, or null when one side would be empty.
 */
export function splitPairing(g: GameState, p: Pairing, t: Minute): Pairing | null {
  const ds = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
  const late = ds.filter((d) => d.report >= t);
  if (!late.length || late.length === ds.length) return null;
  const q: Pairing = {
    id: nextId(g, 'p'), aircraftId: p.aircraftId, contractId: p.contractId, deploymentId: p.deploymentId, base: p.base,
    start: late[0].report, end: p.end, dutyIds: late.map((d) => d.id), slots: p.slots.map((x) => ({ ...x })), status: 'planned', legality: 'legal',
  };
  if (p.tour) q.tour = { ...p.tour };
  g.pairings[q.id] = q;
  for (const d of late) d.pairingId = q.id;
  p.dutyIds = p.dutyIds.filter((id) => !late.some((d) => d.id === id));
  if (p.deploymentId) g.deployments[p.deploymentId]?.pairingIds.push(q.id);
  // A part with a smaller complement (an empty leg flies with pilots only) lets the others go: off its
  // flights and tickets too (releaseHook), not just its slots.
  for (const id of refreshPairing(g, p)) releaseHook(g, p, id);
  for (const id of refreshPairing(g, q)) releaseHook(g, q, id);
  touchCrew(g);
  return q;
}

let releaseHook: (g: GameState, p: Pairing, crewId: string) => void = () => {};
export function setReleaseHook(f: (g: GameState, p: Pairing, crewId: string) => void): void {
  releaseHook = f;
}

/** Deletes a pairing record (caller has already released its crew and tickets). */
export function deletePairing(g: GameState, p: Pairing): void {
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d || d.pairingId !== p.id) continue;
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.dutyId === d.id) f.dutyId = null;
    }
    delete g.duties[id];
  }
  if (p.deploymentId) {
    const dep = g.deployments[p.deploymentId];
    if (dep) dep.pairingIds = dep.pairingIds.filter((x) => x !== p.id);
  }
  delete g.pairings[p.id];
}

// ---------- building ----------

interface Spec {
  flights: Flight[];
}

const keyOf = (fl: Flight[]) => fl.map((f) => f.id).join(',');

/**
 * Fewest duties, then the cheapest plan (basic < split < extension < 3 < 4 pilots), then the most slack on the
 * tightest duty (DESIGN §5.3 step 3). v0.7.3: split duty and planned extension only for a single unit (they rescue
 * a long out-and-back or outstation wait, never merge two units into a longer day); never more than 10 sectors, nor
 * more than 4 on a night duty (CS FTL.1.205(a)(1), applied to every night duty).
 */
function partition(g: GameState, acId: string, typeId: string, rest: AcRest, units: Flight[][]): Spec[] {
  const canAug = canAugment(g, rest);
  const allowTight = g.company.policies.allowTight;
  const home = g.company.homeBase;
  interface Best { count: number; aug: number; slack: number; prev: number; flights: Flight[] }
  const best: (Best | null)[] = new Array(units.length + 1).fill(null);
  best[0] = { count: 0, aug: 0, slack: Infinity, prev: -1, flights: [] };
  for (let j = 1; j <= units.length; j++) {
    let fl: Flight[] = [];
    for (let i = j - 1; i >= 0; i--) {
      fl = [...units[i], ...fl];
      const sh = shape(typeId, fl);
      const single = i === j - 1;
      if (!single && (sh.fdp > 19 * 60 || sh.sectors > MAX_SECTORS)) break;
      const pa = planAugment(g, sh, { rest, canAug, split: single, ext: single, cabinN: planCabinN(g, acId, fl) });
      const tight = sh.fdp > pa.max - LIMITS.tightFdp;
      if (!single && (!pa.ok || (tight && !allowTight))) continue;
      if (!single && sh.sectors > NIGHT_MAX_SECTORS && disruptiveKinds(home, sh.report, sh.lastOn).night) continue;
      const prev = best[i];
      if (!prev) continue;
      const cand: Best = { count: prev.count + 1, aug: prev.aug + MODE_COST[pa.mode], slack: Math.min(prev.slack, pa.max - sh.fdp), prev: i, flights: fl };
      const cur = best[j];
      if (!cur || cand.count < cur.count || (cand.count === cur.count && (cand.aug < cur.aug || (cand.aug === cur.aug && cand.slack > cur.slack)))) best[j] = cand;
    }
  }
  const out: Spec[] = [];
  for (let j = units.length; j > 0; ) {
    const b = best[j]!;
    out.push({ flights: b.flights });
    j = b.prev;
  }
  return out.reverse();
}

/**
 * A unit too long for any legal duty (a positioning leg straight into a long sector, say) is cut at its sector
 * boundaries so a fresh crew can join at the outstation ("slip crew": positioned in by ticket, the other crew rests
 * there). A revenue sector and its tech-stop legs stay one chain, unless that chain alone is too long for one crew
 * (an early report out of Kabul with a fuel stop, say): then the crew changes at the fuel stop.
 */
function slipUnits(g: GameState, acId: string, typeId: string, rest: AcRest, u: Flight[]): Flight[][] {
  if (u.length < 2) return [u];
  const fits = (fl: Flight[]) => planAugment(g, shape(typeId, fl), { rest, canAug: canAugment(g, rest), split: true, ext: true, cabinN: planCabinN(g, acId, fl) }).ok;
  if (fits(u)) return [u];
  return bySector(u).flatMap((x) => (x.length > 1 && !fits(x) ? x.map((f) => [f]) : [x]));
}

/** A unit cut at its sector boundaries (tech-stop legs stay with their sector). */
function bySector(u: Flight[]): Flight[][] {
  const out: Flight[][] = [];
  let cur: Flight[] = [];
  for (const f of u) {
    if (cur.length && f.kind !== 'techstop') {
      out.push(cur);
      cur = [];
    }
    cur.push(f);
  }
  if (cur.length) out.push(cur);
  return out;
}

const isDeploymentContract = (g: GameState, c: Contract | undefined): c is Contract & { pattern: { kind: 'base'; base: string } } =>
  !!c && c.pattern.kind === 'base' && c.pattern.base !== g.company.homeBase;

/**
 * Rebuilds the open (uncrewed, planned) pairings of an aircraft from `from` on: free flights → units → duties →
 * trips and deployment tours. Crewed pairings are kept. Duties whose flights did not change keep their ids.
 */
export function planAircraft(g: GameState, acId: string, from: Minute): void {
  const ac = g.fleet[acId];
  if (!ac) return;
  const typeId = ac.typeId;
  const rest = restOf(g, acId);
  const home = g.company.homeBase;
  const ix = crewIx(g);
  const old = new Map<string, Duty>();
  let gone = 0;
  for (const p of [...(ix.byAircraft.get(acId) ?? [])]) {
    if (p.status !== 'planned' || p.start < from || crewCount(p) > 0) continue;
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      if (d) old.set(d.flightIds.join(','), d);
    }
    deletePairing(g, p);
    gone++;
  }
  // v0.7: the index stays valid when no open pairing went.
  if (gone) touchCrew(g);
  absorbTrailing(g, acId, from);
  const inDuty = new Set<string>();
  for (const p of crewIx(g).byAircraft.get(acId) ?? []) for (const did of p.dutyIds) for (const fid of g.duties[did]?.flightIds ?? []) inDuty.add(fid);

  const all = flightsOf(g, acId).filter((f) => f.status !== 'cancelled' && f.aircraftId === acId);
  const stations = new Set([home]);
  for (const f of all) {
    const c = f.contractId ? g.contracts[f.contractId] : undefined;
    if (c && c.pattern.kind === 'base') stations.add(c.pattern.base);
  }
  const rm = reportMinutes(typeId);
  // Runs of consecutive free flights; a long ground gap (night-stop) or a crewed flight ends a run.
  const runs: Flight[][] = [];
  let run: Flight[] = [];
  for (const f of all) {
    const free = f.status === 'scheduled' && f.std >= from && !inDuty.has(f.id);
    if (!free) {
      if (run.length) runs.push(run);
      run = [];
      continue;
    }
    const prev = run[run.length - 1];
    if (prev) {
      const gapNeed = minRest({ dutyMin: 0, atHome: prev.to === home, augmented: false, tzShift: 0 }) + rm.report + rm.post;
      if (f.std - prev.sta >= gapNeed || prev.to !== f.from) {
        runs.push(run);
        run = [];
      }
    }
    run.push(f);
  }
  if (run.length) runs.push(run);

  const specs: Spec[] = [];
  for (const r of runs) {
    const units: Flight[][] = [];
    let u: Flight[] = [];
    for (let i = 0; i < r.length; i++) {
      u.push(r[i]);
      if (i < r.length - 1 && stations.has(r[i].to)) {
        units.push(u);
        u = [];
      }
    }
    if (u.length) units.push(u);
    specs.push(...partition(g, acId, typeId, rest, units.flatMap((x) => slipUnits(g, acId, typeId, rest, x))));
  }

  // Duty records (reused when the flights are the same).
  const trips: Duty[] = [];
  const byDep = new Map<string, Duty[]>();
  for (const s of specs) {
    const k = keyOf(s.flights);
    const o = old.get(k);
    const d: Duty = o ?? {
      id: nextId(g, 'du'), pairingId: '', report: 0, release: 0, flightIds: s.flights.map((f) => f.id), deadheadIds: [], sectors: 0, fdp: 0, maxFdp: 0,
      augment: 0, restAt: '', legality: 'legal', ev: 0, flightsEv: 0,
    };
    d.flightIds = s.flights.map((f) => f.id);
    d.deadheadIds = [];
    delete d.done;
    g.duties[d.id] = d;
    for (const f of s.flights) f.dutyId = d.id;
    // Provisional measures (the stricter clock); refreshPairing re-measures in pairing context (keeping the plan's
    // extension or split, chosen here for a single unit).
    const sh = shape(typeId, s.flights);
    const pa = planAugment(g, sh, { rest, canAug: canAugment(g, rest), split: true, ext: true, forceAug: d.forceAug === 2, cabinN: planCabinN(g, acId, s.flights) });
    Object.assign(d, { report: sh.report, release: sh.release, fdp: sh.fdp, sectors: sh.sectors, restAt: sh.restAt });
    applyPick(d, pa);
    d.flightsEv = s.flights.reduce((n, f) => n + f.ev, 0);
    d.legality = dutyLegality(d);
    const c = contractOfDuties(g, [d]);
    // v0.5.2: an empty leg into a deployment from an outstation is a pilots-only ferry: the tour's cabin crew
    // deadhead straight to the base instead of first flying out to the aircraft (from home they ride along).
    const remoteIn = isDeploymentContract(g, c) && emptyDuty(g, d) && g.flights[d.flightIds[0]]?.from !== home && !specs.some((x) => x.flights[0].std < s.flights[0].std && x.flights.some((f) => f.contractId === c.id && f.kind !== 'positioning' && f.kind !== 'ferry'));
    if (isDeploymentContract(g, c) && !remoteIn) {
      const l = byDep.get(c.id) ?? [];
      l.push(d);
      byDep.set(c.id, l);
    } else trips.push(d);
  }
  for (const [cid, duties] of byDep) {
    const left = chainDeployment(g, g.contracts[cid], acId, duties);
    trips.push(...left);
  }
  trips.sort((a, b) => a.report - b.report);
  buildTrips(g, acId, trips);
  if (gone || specs.length) touchCrew(g);
}

/**
 * Empty legs planned (or re-planned) right after a crewed duty, from where it ends (the positioning home after a
 * job): the duty's own crew fly them when the FDP and their timelines allow, instead of a fresh crew positioned in
 * while they ride home on tickets. Their tickets home are re-planned (retickHook).
 */
function absorbTrailing(g: GameState, acId: string, from: Minute): void {
  const ix = crewIx(g);
  const fl = flightsOf(g, acId).filter((f) => f.status === 'scheduled' && f.aircraftId === acId && f.std >= from && !ix.inDuty.has(f.id));
  if (!fl.length) return;
  for (const p of [...(ix.byAircraft.get(acId) ?? [])]) {
    if (crewCount(p) === 0 || p.status === 'done' || p.status === 'broken') continue;
    const open = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d && !d.done).sort((a, b) => a.report - b.report);
    const d = open[open.length - 1];
    const lastF = d && g.flights[d.flightIds[d.flightIds.length - 1]];
    if (!d || !lastF || lastF.status === 'cancelled') continue;
    const add: Flight[] = [];
    let at = d.restAt;
    let t = onBlocks(lastF);
    for (const f of fl) {
      if (f.std < t) continue;
      if (f.from !== at || f.std - t > 3 * 60 || (f.kind !== 'positioning' && f.kind !== 'ferry')) break;
      add.push(f);
      at = f.to;
      t = f.sta;
    }
    if (!add.length) continue;
    const before = [...d.flightIds];
    d.flightIds = [...before, ...add.map((f) => f.id)];
    syncDuty(g, d, p);
    touchCrew(g);
    let ok = d.legality !== 'illegal';
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (!ok || !c) continue;
      if (crewTrailOkHook && !crewTrailOkHook(g, p, c)) ok = false;
    }
    if (!ok) {
      d.flightIds = before;
      syncDuty(g, d, p);
      touchCrew(g);
      continue;
    }
    for (const f of add) f.dutyId = d.id;
    refreshPairing(g, p);
    queueDuty(g, d);
    retickHook(g, p);
    touchCrew(g);
  }
}

/** Hook (roster.ts): can crew member c fly pairing p as it now stands (its tickets home will be re-planned)? */
let crewTrailOkHook: ((g: GameState, p: Pairing, c: CrewMember) => boolean) | null = null;
export function setCrewTrailOkHook(f: (g: GameState, p: Pairing, c: CrewMember) => boolean): void {
  crewTrailOkHook = f;
}

/** Only empty legs (positioning / ferry): flown with pilots only when it is a trip of its own. */
function emptyDuty(g: GameState, d: Duty): boolean {
  return d.flightIds.every((id) => {
    const k = g.flights[id]?.kind;
    return k === 'positioning' || k === 'ferry';
  });
}

/** Trips: from a duty until one releases at home base, a > 3-day gap, or 6 duty days (then 2 days off). */
function buildTrips(g: GameState, acId: string, duties: Duty[]): void {
  const home = g.company.homeBase;
  const dayOf = (t: Minute) => Math.floor((t + offsetAt(home, t)) / DAY);
  let cur: Duty[] = [];
  const empty = (d: Duty) => emptyDuty(g, d);
  // v0.5.2: empty duties after the trip's last revenue duty are their own pilots-only trip (a ferry: the cabin
  // crew aren't needed at the destination and go home by ticket; the pilots usually fly on, crew.planCrew drop).
  const close = () => {
    let k = cur.length;
    while (k > 0 && empty(cur[k - 1])) k--;
    if (k > 0 && k < cur.length) {
      newPairing(g, cur.slice(0, k), acId, null);
      newPairing(g, cur.slice(k), acId, null);
    } else if (cur.length) newPairing(g, cur, acId, null);
    cur = [];
  };
  for (const d of duties) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const firstDep = g.flights[d.flightIds[0]]?.from;
      const days = new Set(cur.map((x) => dayOf(x.report)));
      days.add(dayOf(d.report));
      const cont = last.restAt !== home && firstDep === last.restAt && d.report - last.release <= 3 * DAY && d.report - last.release >= 10 * 60 && days.size <= LIMITS.blockDays;
      if (!cont) close();
    }
    cur.push(d);
    if (d.restAt === home) close();
  }
  close();
}

// ---------- deployments ----------

const rotation = (g: GameState) => g.company.policies.rotationWeeks * 7 * DAY;

/** On-station period of set s that contains t (null before the set exists). */
export function periodOf(dep: Deployment, s: number, t: Minute, R: number): { from: Minute; to: Minute } | null {
  const a = dep.anchors?.[s];
  if (a === undefined) return null;
  if (t < a) {
    const from = Math.max(dep.start, a - R);
    return t < from ? null : { from, to: a };
  }
  const k = Math.floor((t - a) / R);
  return { from: a + k * R, to: a + (k + 1) * R };
}

function anchorsFor(start: Minute, sets: number, R: number): Minute[] {
  const out: Minute[] = [];
  for (let s = 0; s < sets; s++) out.push(start + Math.max(1, Math.round(((s + 1) * R) / sets / DAY)) * DAY);
  return out;
}

interface TourState {
  set: number;
  from: Minute;
  to: Minute;
  pairing: Pairing | null;
  duties: Duty[];
  segs: Seg[];
  days: number[];
}

/** A duty as a virtual crew set's seg (no tickets); v0.7.2 from the cabin crew's earlier report (the longer day). */
function virtualSeg(g: GameState, d: Duty, tripStart: Minute, base: string, fresh = false): Seg {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const tz = referenceTime(base, dep, Math.min(tripStart, d.report), d.report).tz;
  const p = g.pairings[d.pairingId];
  const early = p ? cabinEarly(g, p, d) : 0;
  const start = d.report - early;
  const k = disruptiveKinds(tz, start, d.release);
  return {
    kind: 'duty', start, end: d.release, fdp: d.fdp + early, maxFdp: d.maxFdp + (d.discretion ?? 0) + early, block: dutyBlock(g, d), sectors: d.sectors,
    aug: d.augment > 0, disruptive: k.early || k.late || k.night, early: k.early, late: k.late, night: k.night, ...(d.ext ? { ext: true } : {}),
    rest: minRest({ dutyMin: d.release - start, atHome: d.restAt === base, augmented: d.augment > 0, tzShift: tzDeltaH(base, d.restAt, d.release), extended: !!d.ext }),
    at: d.restAt, from: dep, dutyId: d.id, fresh,
  };
}

interface Chainer {
  take(d: Duty): boolean;
  tours: Map<string, TourState>;
}

/**
 * Round-robin chaining: each duty (report order) goes to the on-station set free longest (earliest rest end)
 * that stays legal (rest, FDP, cumulative, recovery, 6-on/2-off); ties by set index. Crewed tours also check
 * their real crew (via `crewOk`).
 */
function chainer(g: GameState, dep: Deployment, crewOk: (p: Pairing, d: Duty) => boolean): Chainer {
  const R = rotation(g);
  const home = g.company.homeBase;
  const dayOf = (t: Minute) => Math.floor((t + offsetAt(dep.base, t)) / DAY);
  const tours = new Map<string, TourState>();
  for (const pid of dep.pairingIds) {
    const p = g.pairings[pid];
    if (!p?.tour) continue;
    const duties = p.dutyIds.map((id) => g.duties[id]).filter((d): d is Duty => !!d);
    tours.set(`${p.tour.set}:${p.tour.from}`, {
      set: p.tour.set, from: p.tour.from, to: p.tour.to, pairing: p, duties,
      segs: duties.map((d) => virtualSeg(g, d, p.start, home)), days: [...new Set(duties.map((d) => dayOf(d.report)))].sort((a, b) => a - b),
    });
  }
  const take = (d: Duty): boolean => {
    let pick: TourState | null = null;
    let pickRest = Infinity;
    const sets = dep.anchors?.length ?? 0;
    for (let s = 0; s < sets; s++) {
      const per = periodOf(dep, s, d.report, R);
      if (!per) continue;
      const key = `${s}:${per.from}`;
      const st = tours.get(key) ?? { set: s, from: per.from, to: per.to, pairing: null, duties: [], segs: [], days: [] };
      const day = dayOf(d.report);
      const days = st.days.includes(day) ? st.days : [...st.days, day].sort((a, b) => a - b);
      if (longestWorkBlock(days) > LIMITS.blockDays) continue;
      const tripStart = Math.min(st.duties[0]?.report ?? d.report, d.report);
      const i = st.segs.findIndex((x) => x.start > d.report);
      const at = i < 0 ? st.segs.length : i;
      const last = st.segs[at - 1];
      const segs = [...st.segs.slice(0, at), virtualSeg(g, d, tripStart, home, true), ...st.segs.slice(at)];
      // A fresh set arrives rested the day before its period (positioning counts as duty).
      const ctx: TimelineCtx = { base: home, restUntil: -Infinity, lastRecovery: per.from - DAY, blockYear: 0, blockYearOf: yearOf(d.report), slack: BAL.rosterSlack };
      if (evalSegs(ctx, segs).some((i) => i.level === 'illegal' && i.code !== 'fdp')) continue;
      if (st.pairing && crewCount(st.pairing) > 0 && !crewOk(st.pairing, d)) continue;
      const restEnd = last ? last.end + last.rest : -Infinity;
      if (restEnd < pickRest) {
        pick = st;
        pickRest = restEnd;
      }
    }
    if (!pick) return false;
    const key = `${pick.set}:${pick.from}`;
    tours.set(key, pick);
    pick.duties.push(d);
    pick.duties.sort((x, y) => x.report - y.report);
    pick.segs.push(virtualSeg(g, d, pick.duties[0].report, home));
    pick.segs.sort((x, y) => x.start - y.start);
    const day = dayOf(d.report);
    if (!pick.days.includes(day)) pick.days = [...pick.days, day].sort((a, b) => a - b);
    return true;
  };
  return { take, tours };
}

/** Hook for crewed tours (set by roster.ts to avoid an import cycle): can every crew member of p also fly d? */
let crewOkHook: (g: GameState, p: Pairing, d: Duty) => boolean = () => true;
export function setCrewOkHook(f: (g: GameState, p: Pairing, d: Duty) => boolean): void {
  crewOkHook = f;
}

/** Hook (roster.ts): re-plans the crew's tickets after a crewed tour grew past its ends (the ticket home moves). */
let retickHook: (g: GameState, p: Pairing) => void = () => {};
export function setRetickHook(f: (g: GameState, p: Pairing) => void): void {
  retickHook = f;
}

/**
 * Places free deployment duties into tours (creating the deployment and sizing its sets on first use).
 * Returns the duties no set can legally take (they become trips).
 */
function chainDeployment(g: GameState, c: Contract, acId: string, duties: Duty[]): Duty[] {
  if (c.pattern.kind !== 'base') return duties;
  const base = c.pattern.base;
  const R = rotation(g);
  duties.sort((a, b) => a.report - b.report || (a.id < b.id ? -1 : 1));
  let dep = Object.values(g.deployments).find((x) => x.contractId === c.id && x.aircraftId === acId);
  if (!dep) {
    const start = dayStart(duties[0].report);
    dep = { id: nextId(g, 'dp'), contractId: c.id, aircraftId: acId, base, start, end: Math.max(c.end, duties[duties.length - 1].release), setsOnStation: 0, pairingIds: [] };
    // setsOnStation = max(peak duties/day × 8/6, BH per 28 days / 85), +1 while chaining can't cover the days.
    const perDay = new Map<number, number>();
    let bh = 0;
    for (const d of duties) {
      const k = Math.floor((d.report + offsetAt(base, d.report)) / DAY);
      perDay.set(k, (perDay.get(k) ?? 0) + 1);
      if (d.report < start + 28 * DAY) bh += dutyBlock(g, d);
    }
    const span = Math.min(28, Math.max(14, (duties[duties.length - 1].release - start) / DAY));
    const peak = Math.max(...perDay.values());
    let sets = Math.max(1, Math.ceil((peak * 8) / 6), Math.ceil((bh / 60) * (28 / span) / BAL.cabinBHMonth));
    for (; sets < BAL.maxSetsOnStation; sets++) {
      const trial: Deployment = { ...dep, anchors: anchorsFor(start, sets, R), pairingIds: [] };
      const ch = chainer(g, trial, () => true);
      if (duties.every((d) => ch.take(d))) break;
    }
    dep.setsOnStation = sets;
    dep.sized = sets;
    dep.anchors = anchorsFor(start, sets, R);
    g.deployments[dep.id] = dep;
  }
  dep.sized ??= dep.setsOnStation;
  dep.anchors ??= anchorsFor(dep.start, dep.setsOnStation, R);
  dep.end = Math.max(dep.end, duties[duties.length - 1].release);
  const ch = chainer(g, dep, (p, d) => crewOkHook(g, p, d));
  const left: Duty[] = [];
  for (const d of duties) {
    if (ch.take(d)) continue;
    // One extra set at most beyond the sizing (a whole tour of crew for a stray duty is waste: it flies as a
    // trip from base instead); a duty before the deployment's start can't join any set.
    if (d.report >= dep.start && dep.anchors.length < Math.min(BAL.maxSetsOnStation, dep.sized + 1)) {
      dep.anchors.push(dayStart(d.report) + R);
      dep.setsOnStation = dep.anchors.length;
      if (ch.take(d)) continue;
    }
    left.push(d);
  }
  for (const st of ch.tours.values()) {
    if (st.pairing) {
      const p = st.pairing;
      const fresh = st.duties.filter((d) => !p.dutyIds.includes(d.id));
      if (!fresh.length) continue;
      const [from, to] = [p.start, p.end];
      for (const d of fresh) d.pairingId = p.id;
      p.dutyIds.push(...fresh.map((d) => d.id));
      refreshPairing(g, p);
      if (crewCount(p) > 0) {
        for (const d of fresh) queueDuty(g, d);
        // Duties past the old ends: the crew stay on (tickets out/home move with the tour).
        if (fresh.some((d) => d.report < from || d.release > to)) retickHook(g, p);
      }
      continue;
    }
    if (!st.duties.length) continue;
    const p = newPairing(g, st.duties, acId, dep.id, { set: st.set, from: st.from, to: st.to });
    dep.pairingIds.push(p.id);
  }
  dep.pairingIds.sort((a, b) => {
    const x = g.pairings[a]?.tour;
    const y = g.pairings[b]?.tour;
    return (x?.from ?? 0) - (y?.from ?? 0) || (x?.set ?? 0) - (y?.set ?? 0);
  });
  return left;
}

/** Builds (or keeps) the aircraft's duties from `from` and returns those overlapping [from, to), in time order. */
export function buildDuties(g: GameState, aircraftId: string, from: Minute, to: Minute): Duty[] {
  planAircraft(g, aircraftId, from);
  const out: Duty[] = [];
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) {
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (d && d.release > from && d.report < to) out.push(d);
    }
  }
  return out.sort((a, b) => a.report - b.report);
}

// ---------- v0.7.3 contract chains (UPDATE-0.7.3.md §2.9) ----------

/** An operated chain of a programme (legs between crew-change stations, no night stop), UTC, offsets applied. */
export interface ChainShape { from: string; std: Minute; legs: { std: Minute; sta: Minute; from?: string; to?: string }[] }

export interface DutyNeed {
  mode: PlanMode | 'none';
  /** The chain's FDP (report to the last landing) and the limit of the plan found (Table 2 when none). */
  fdp: number;
  max: number;
  /** The rest plan of an augmented need, or the failed plan that rules augmentation out. */
  plan: RestPlan | null;
  /** 'Longest day 12:40 of 13:00 (2 pilots)', 'Bunks → 3 pilots, 16 h limit ✓', … */
  text: string;
  /** What blocks it when mode is 'none': no facility, cruise too short, no approval, too long whatever the rest. */
  why?: 'noRest' | 'tooShort' | 'approval' | 'tooLong' | 'cabin';
}

const kindWords = (r: AcRest): string => {
  const f = r.fc;
  if (!f) return 'No crew rest';
  return f.kind === 'fcrc' || f.kind === 'ccrc' ? 'Bunks' : f.kind === 'ldmcr' ? 'Lower-deck bunks' : f.kind === 'jSeats' ? `Business seats (class ${f.cls})` : `Recliners (class ${f.cls})`;
};

/**
 * v0.7.3 what crewing one chain on this type and these facilities needs (UPDATE-0.7.3.md §2.9 C7): Table 2 at the
 * chain's report time and sectors (acclimatised at the departure), then split duty, a planned extension, 3 and 4
 * pilots with the rest plan. Pure.
 */
export function dutyNeed(g: GameState, typeId: string, rest: AcRest, chain: ChainShape): DutyNeed {
  const fl: Flight[] = chain.legs.map((l, i) => ({
    id: `chain${i}`, from: l.from ?? (i ? `X${i}` : chain.from), to: l.to ?? `X${i + 1}`, std: l.std, sta: l.sta, block: l.sta - l.std, status: 'scheduled',
  } as Flight));
  if (!fl.length) return { mode: 'basic', fdp: 0, max: 0, plan: null, text: '' };
  const sh = shape(typeId, fl);
  const approved = g.company.approvals.includes('augmented');
  const t = typeOf(typeId);
  const seats = t.cabins[0] ? t.cabins[0].j + t.cabins[0].w + t.cabins[0].y : 180;
  const ctx: PlanCtx = { rest, canAug: approved && !!rest.fc && !!rest.cc, split: true, ext: true, cabinN: Math.max(cabinMinimum(seats), 1) };
  const pa = pickPlan(sh, { reportLocal: localMin(sh.dep, sh.report), acclimatised: true, tz: sh.dep }, ctx);
  const hmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  const hrs = (m: number) => (m % 60 ? hmm(m) : `${m / 60} h`);
  if (pa.ok) {
    if (pa.mode === 'basic') return { mode: 'basic', fdp: sh.fdp, max: pa.max, plan: null, text: `Longest day ${hmm(sh.fdp)} of ${hmm(pa.max)} (2 pilots)` };
    if (pa.mode === 'ext') return { mode: 'ext', fdp: sh.fdp, max: pa.max, plan: null, text: `Longest day ${hmm(sh.fdp)}: a planned extension (${hmm(pa.max)}), twice a week per crew` };
    if (pa.mode === 'split') return { mode: 'split', fdp: sh.fdp, max: pa.max, plan: null, text: `Longest day ${hmm(sh.fdp)}: a split duty (a ${hmm(pa.split!.net)} break on the ground → ${hmm(pa.max)})` };
    const plan = planRest(legsOf(fl), rest, pa.augment as 1 | 2, sh.fdp + pa.early, ctx.cabinN);
    const blocked = Math.max(0, ...Object.values(plan.blocked));
    const pilots = pa.augment === 1 ? '3 pilots' : 'needs a 4th pilot';
    const seatsLine = blocked ? ` · ${blocked} ${rest.fc?.kind === 'recliners' ? 'recliners' : 'business seats'} blocked on the long legs` : '';
    const extra = plan.extraCabin ? ` · ${plan.extraCabin} more cabin crew for in-flight rest` : '';
    return { mode: pa.mode, fdp: sh.fdp, max: pa.max, plan, text: `${kindWords(rest)} → ${pilots}, ${hrs(pa.max)} limit${pa.augment === 1 ? ' ✓' : ''}${seatsLine}${extra}` };
  }
  // Not plannable: why.
  const day = hmm(sh.fdp);
  if (sh.fdp > FDP_CAP) return { mode: 'none', fdp: sh.fdp, max: pa.max, plan: null, text: `A ${day} day is longer than any crew may fly (18 h even with 4 pilots in bunks)`, why: 'tooLong' };
  if (!rest.fc || !rest.cc) return { mode: 'none', fdp: sh.fdp, max: pa.max, plan: null, text: `No crew rest → ✗ a ${day} day needs in-flight rest`, why: 'noRest' };
  if (!approved) return { mode: 'none', fdp: sh.fdp, max: pa.max, plan: null, text: `A ${day} day needs an augmented crew: we have no approval for it`, why: 'approval' };
  for (const a of [2, 1] as const) {
    const lim = augLimitOf(rest.fc.cls, rest.cc.cls, a, longSector(sh.sectors, sh.longest), sh.early);
    if (sh.fdp > lim.max || sh.sectors > AUG_MAX_SECTORS) continue;
    const plan = planRest(legsOf(fl), rest, a, sh.fdp + lim.early, ctx.cabinN);
    if (plan.code === 'tooShort') {
      const longest = Math.max(...fl.map((f) => f.block));
      return { mode: 'none', fdp: sh.fdp, max: pa.max, plan, text: `The cruise is too short for in-flight rest (${fl.length} leg${fl.length > 1 ? 's' : ''} of ${hmm(longest)})`, why: 'tooShort' };
    }
    return { mode: 'none', fdp: sh.fdp, max: pa.max, plan, text: plan.why ?? `A ${day} day doesn't fit the cabin crew's rest`, why: 'cabin' };
  }
  if (sh.sectors > AUG_MAX_SECTORS) return { mode: 'none', fdp: sh.fdp, max: pa.max, plan: null, text: `A ${day} day with ${sh.sectors} sectors: in-flight rest allows at most 3`, why: 'tooLong' };
  return { mode: 'none', fdp: sh.fdp, max: pa.max, plan: null, text: `A ${day} day is longer than ${kindWords(rest).toLowerCase()} allow even with 4 pilots`, why: 'tooLong' };
}
