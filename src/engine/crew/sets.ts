// v0.7.4 crew planning by aircraft type family: crew SETS (one full crew for one aircraft) needed, complete now and
// with the joiners, per role have / needed / joining / away / short or over, cabin crew on several types counted once,
// and the round-up hire that completes the sets. Sets count only our own crew: an aircraft away on a dry lease needs
// none, and the client's cabin crew on a v0.8 mixed-crew contract fly their seats. Pure.

import { ACMI_TYPES, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { isPilot, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { Aircraft, GameState, Role } from '../core/types';
import { dropClientSeats } from './clientCrew';
import { conversionClasses } from './conversion';
import { crewExtraFor, rolesWithExtra } from './extraSeats';
import { salaryFor } from './generate';
import { hireQuote, type HireRequest } from './hr';

export const SET_ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];

export interface SetRole {
  role: Role;
  /** Crew in one set (may be fractional on a mixed family: an A320 and an A321 need different cabin crews). */
  perSet: number;
  /** For all the sets needed. */
  need: number;
  /** On the books for this family and staying (incl. joining, sick, on leave, training); each person counted once. */
  have: number;
  /** Of `have`: hired, not yet joined. */
  joining: number;
  /** Of `have`: sick, on leave or in training now. */
  away: number;
  /** Of `have`: cabin crew (or pilots) who also hold another fleet type, counted here once. */
  shared: number;
  /** have − need after seniors fill junior seats (FO → relief pilot, purser → cabin crew): < 0 short, > 0 over. */
  balance: number;
}

export interface TypeSet {
  typeId: string;
  short: string;
  aircraft: number;
  /** One set for this type: 'CPT 1 · FO 1 · PUR 1 · CC 3'. */
  set: Partial<Record<Role, number>>;
}

export interface FamilyPlan {
  family: RatingFamily;
  label: string;
  aircraft: number;
  types: TypeSet[];
  /** Sets per aircraft (5 normally; more for an aircraft on a deployment). */
  setsPerAircraft: number;
  setsNeeded: number;
  /** Complete sets with the crew working now (not joining); with the joiners. */
  setsNow: number;
  setsComplete: number;
  /** The role that decides the complete sets (null with no need). */
  limiting: Role | null;
  /** Relief pilots in the set because the fleet flies long (augmented) days. */
  augmented: boolean;
  /** v0.8 cabin crew places in the sets needed that clients' own cabin crew fly (mixed-crew contracts; not ours to staff). */
  clientCabin: number;
  /** v0.8 aircraft away on a dry lease (the lessee's crews fly them): no sets. */
  dryLeased: number;
  roles: SetRole[];
  /** 'A320 family: 4 aircraft · 5 sets each = 20 sets needed · you have 18 complete · short 2 CPT, 1 PUR, 2 CC'. */
  verdict: string;
}

const LABEL: Record<RatingFamily, string> = {
  A320: 'A320 family', B737: '737', 'B757/767': '757/767', 'A330/340': 'A330/A340', B777: '777', B787: '787', A350: 'A350', A380: 'A380', B747: '747',
};
export const familyName = (f: RatingFamily) => LABEL[f];

const count = (roles: Role[]) => roles.reduce<Partial<Record<Role, number>>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});

/** Augmented share of an aircraft's duties over the next 30 days and the most pilots any of them needs (1 → 3 pilots, 2 → 4). */
function augOf(g: GameState, aircraftId: string): { share: number; level: 0 | 1 | 2 } {
  let n = 0;
  let a = 0;
  let level: 0 | 1 | 2 = 0;
  const to = g.now + 30 * DAY;
  for (const p of Object.values(g.pairings)) {
    if (p.aircraftId !== aircraftId || p.status === 'done' || p.status === 'broken') continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (!d || d.done || d.report > to) continue;
      n++;
      if (d.augment > 0) {
        a++;
        if (d.augment > level) level = d.augment as 1 | 2;
      }
    }
  }
  return { share: n ? a / n : 0, level };
}

/** The planning window: signed work over the next 60 days shapes each aircraft's crew. */
const WINDOW = 60 * DAY;

/**
 * v0.8 an aircraft away on a dry lease out: from its delivery ferry's departure until the lease ends (status
 * 'leasedOut' while the lessee has it). The lessee's crews fly it; once the lease ends it needs our crews again.
 */
export function awayOnDryLease(g: GameState, ac: Aircraft): boolean {
  if (ac.status === 'leasedOut') return true;
  for (const k of Object.values(g.contracts)) {
    if (!k.dry || (k.status !== 'signed' && k.status !== 'active') || k.dry.returnedAt !== undefined || !k.aircraftIds.includes(ac.id)) continue;
    if (k.dry.leasedAt !== undefined) return true;
    if (k.dry.outIds.some((id) => { const f = g.flights[id]; return !!f && (f.status === 'enroute' || f.status === 'done'); })) return true;
  }
  return false;
}

/**
 * v0.8 per role, the cabin crew a client's own crew fly on this aircraft, averaged over the planning window: each
 * mixed-crew contract's seats (CC first, the purser only when their senior leads) for the share of the window it
 * covers. Pure.
 */
function clientSeatsOf(g: GameState, aircraftId: string, roles: Role[]): Partial<Record<Role, number>> {
  const out: Partial<Record<Role, number>> = {};
  const from = g.now;
  const to = g.now + WINDOW;
  let covered = 0;
  for (const k of Object.values(g.contracts)) {
    const cc = k.requirements.clientCabin;
    if (!cc || cc.n <= 0 || (k.status !== 'signed' && k.status !== 'active') || !k.aircraftIds.includes(aircraftId)) continue;
    const span = Math.min(k.end, to) - Math.max(k.start, from);
    if (span <= 0) continue;
    const share = Math.min(span / WINDOW, 1 - covered);
    if (share <= 0) break;
    covered += share;
    const ours = count(dropClientSeats(roles.map((role) => ({ role })), cc).map((x) => x.role));
    const all = count(roles);
    for (const r of SET_ROLES) {
      const d = (all[r] ?? 0) - (ours[r] ?? 0);
      if (d > 0) out[r] = (out[r] ?? 0) + d * share;
    }
  }
  return out;
}

/** Needs per family: aircraft, sets and the crew per role (each aircraft's complement × its sets, plus relief pilots). */
function needs(g: GameState) {
  const onStation = new Map<string, number>();
  for (const dp of Object.values(g.deployments)) {
    if (dp.end < g.now || dp.start > g.now + WINDOW) continue;
    onStation.set(dp.aircraftId, Math.max(onStation.get(dp.aircraftId) ?? 0, dp.setsOnStation));
  }
  const fams = new Map<RatingFamily, { aircraft: number; sets: number; need: Partial<Record<Role, number>>; types: Map<string, TypeSet>; aug: boolean; client: number; dry: number }>();
  const famOf = (f: RatingFamily) => {
    let x = fams.get(f);
    if (!x) fams.set(f, (x = { aircraft: 0, sets: 0, need: {}, types: new Map<string, TypeSet>(), aug: false, client: 0, dry: 0 }));
    return x;
  };
  const dryAway: Aircraft[] = [];
  for (const ac of Object.values(g.fleet)) {
    // v0.8 away on a dry lease: the lessee's crews fly it (no sets while it is away).
    if (awayOnDryLease(g, ac)) {
      dryAway.push(ac);
      continue;
    }
    const t = typeOf(ac.typeId);
    const sets = Math.max(BAL.crewSetsPerAircraft, (onStation.get(ac.id) ?? 0) + 2);
    // The most extra crew its long work over the next 60 days asks for (as the staffing model).
    let x = crewExtraFor(g, ac.id, null);
    for (const k of Object.values(g.contracts)) {
      if ((k.status !== 'signed' && k.status !== 'active') || k.end <= g.now || k.start > g.now + WINDOW || k.end - k.start < 30 * DAY || !k.aircraftIds.includes(ac.id)) continue;
      const kx = crewExtraFor(g, ac.id, k.id);
      if (kx.cabin + kx.pilot > x.cabin + x.pilot) x = kx;
    }
    const roles = rolesWithExtra(ac.typeId, ac.cabin.total, x);
    const per = count(roles);
    // v0.8 mixed crew: the client's cabin crew fly their seats while the contract runs; only ours are needed.
    const theirs = clientSeatsOf(g, ac.id, roles);
    const f = famOf(t.family);
    f.aircraft++;
    f.sets += sets;
    for (const r of SET_ROLES) {
      const own = (per[r] ?? 0) - (theirs[r] ?? 0);
      if (own > 0) f.need[r] = (f.need[r] ?? 0) + own * sets;
      f.client += (theirs[r] ?? 0) * sets;
    }
    // Long days flown with 3 or 4 pilots: relief pilots (or a second captain and first officer) for that share of the sets.
    const a = augOf(g, ac.id);
    if (a.level) {
      const extra = Math.ceil(sets * a.share - 1e-9);
      if (a.level === 1) f.need.CRP = (f.need.CRP ?? 0) + extra;
      else {
        f.need.CPT = (f.need.CPT ?? 0) + extra;
        f.need.FO = (f.need.FO ?? 0) + extra;
      }
      f.aug = true;
    }
    const ts = f.types.get(ac.typeId) ?? { typeId: ac.typeId, short: t.short, aircraft: 0, set: per };
    ts.aircraft++;
    f.types.set(ac.typeId, ts);
  }
  // Noted on the family card only when the family still flies other aircraft (crew are kept for its return).
  for (const ac of dryAway) {
    const f = fams.get(typeOf(ac.typeId).family);
    if (f) f.dry++;
  }
  return fams;
}

/** Crew per family and role, each person once: single-type crew first, then multi-type crew to the family that needs them most. */
function supply(g: GameState, fams: Map<RatingFamily, { need: Partial<Record<Role, number>> }>) {
  const losing = new Map<string, RatingFamily[]>();
  for (const k of conversionClasses(g)) {
    for (const id of k.crewIds) {
      const c = g.crew[id];
      if (!c) continue;
      const lost = k.group === 'pilot' ? (k.course === 'full' ? c.ratings.filter((f) => f !== k.family) : []) : k.drop?.[id] ? [k.drop[id]] : [];
      if (lost.length) losing.set(id, [...(losing.get(id) ?? []), ...lost]);
    }
  }
  type Cell = { have: number; joining: number; away: number; shared: number };
  const out = new Map<string, Cell>();
  const cell = (f: RatingFamily, r: Role) => {
    const k = `${f}:${r}`;
    let x = out.get(k);
    if (!x) out.set(k, (x = { have: 0, joining: 0, away: 0, shared: 0 }));
    return x;
  };
  const add = (f: RatingFamily, c: GameState['crew'][string], shared: boolean) => {
    const x = cell(f, c.role);
    x.have++;
    if (c.status === 'joining') x.joining++;
    else if (c.status === 'sick' || c.status === 'leave' || c.status === 'training') x.away++;
    if (shared) x.shared++;
  };
  const multi: { c: GameState['crew'][string]; fs: RatingFamily[] }[] = [];
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.notice) continue;
    const fs = c.ratings.filter((f) => fams.has(f) && !losing.get(c.id)?.includes(f));
    if (!fs.length) continue;
    if (fs.length === 1) add(fs[0], c, false);
    else multi.push({ c, fs });
  }
  for (const { c, fs } of multi) {
    // The family with the largest shortfall for this role (ties: the first rating).
    let best = fs[0];
    let gap = -Infinity;
    for (const f of fs) {
      const d = (fams.get(f)!.need[c.role] ?? 0) - (out.get(`${f}:${c.role}`)?.have ?? 0);
      if (d > gap) {
        gap = d;
        best = f;
      }
    }
    add(best, c, true);
  }
  return out;
}

/** Can `have` crew per role fill `t` sets of `perSet` (first officers fill relief pilot seats, pursers cabin crew seats)? */
export function setsFit(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>, t: number): boolean {
  return missingFor(perSet, have, t).every((m) => m.count === 0);
}

/** Crew to hire per role for `t` complete sets (seniors spilling into junior seats first). Pure. */
export function missingFor(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>, t: number): { role: Role; count: number }[] {
  const want = (r: Role) => Math.ceil((perSet[r] ?? 0) * t - 1e-9);
  const left: Record<string, number> = {};
  for (const r of SET_ROLES) left[r] = (have[r] ?? 0) - want(r);
  // FO → relief pilot, purser → cabin crew.
  for (const [from, to] of [['FO', 'CRP'], ['PUR', 'CC']] as const) {
    if (left[to] < 0 && left[from] > 0) {
      const m = Math.min(left[from], -left[to]);
      left[from] -= m;
      left[to] += m;
    }
  }
  return SET_ROLES.map((r) => ({ role: r, count: Math.max(0, -left[r]) }));
}

/** The most complete sets these crew fill (≤ 500). Pure. */
export function completeSets(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>): number {
  if (!SET_ROLES.some((r) => (perSet[r] ?? 0) > 0)) return 0;
  let lo = 0;
  let hi = 500;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (setsFit(perSet, have, mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** v0.7.4 the Crew planning view, one entry per fleet family (largest fleet first). Pure. */
export function crewPlan(g: GameState): FamilyPlan[] {
  const fams = needs(g);
  const sup = supply(g, fams);
  const out: FamilyPlan[] = [];
  for (const [family, f] of fams) {
    const perSet: Partial<Record<Role, number>> = {};
    for (const r of SET_ROLES) if (f.need[r]) perSet[r] = f.need[r]! / f.sets;
    const have: Partial<Record<Role, number>> = {};
    const now: Partial<Record<Role, number>> = {};
    for (const r of SET_ROLES) {
      const x = sup.get(`${family}:${r}`);
      have[r] = x?.have ?? 0;
      now[r] = (x?.have ?? 0) - (x?.joining ?? 0);
    }
    const setsComplete = completeSets(perSet, have);
    const setsNow = completeSets(perSet, now);
    const miss = missingFor(perSet, have, f.sets);
    const roles: SetRole[] = [];
    for (const r of SET_ROLES) {
      const x = sup.get(`${family}:${r}`) ?? { have: 0, joining: 0, away: 0, shared: 0 };
      const need = Math.ceil((f.need[r] ?? 0) - 1e-9);
      if (!need && !x.have) continue;
      const short = miss.find((m) => m.role === r)!.count;
      roles.push({ role: r, perSet: perSet[r] ?? 0, need, have: x.have, joining: x.joining, away: x.away, shared: x.shared, balance: short ? -short : x.have - need });
    }
    // The role that runs out first (the fewest whole sets on its own).
    let limiting: Role | null = null;
    let lim = Infinity;
    for (const r of SET_ROLES) {
      const p = perSet[r] ?? 0;
      if (!p) continue;
      const own = Math.floor((have[r] ?? 0) / p + 1e-9);
      if (own < lim) {
        lim = own;
        limiting = r;
      }
    }
    const each = Math.round(f.sets / f.aircraft);
    const shortTxt = miss.filter((m) => m.count > 0).map((m) => `${m.count} ${m.role}`).join(', ');
    const head = `${LABEL[family]}: ${plural(f.aircraft, 'aircraft').replace(/aircrafts$/, 'aircraft')} · ${each} sets each = ${f.sets} sets needed`;
    const verdict = setsComplete >= f.sets
      ? `${head} · you have ${setsComplete} complete${setsComplete > f.sets ? ` (${setsComplete - f.sets} spare)` : ''}`
      : `${head} · you have ${setsComplete} complete · short ${shortTxt}`;
    out.push({
      family, label: LABEL[family], aircraft: f.aircraft, types: [...f.types.values()], setsPerAircraft: each, setsNeeded: f.sets, setsNow, setsComplete,
      limiting: setsComplete >= f.sets ? null : limiting, augmented: f.aug, clientCabin: Math.round(f.client), dryLeased: f.dry, roles, verdict,
    });
  }
  return out.sort((a, b) => b.aircraft - a.aircraft || a.label.localeCompare(b.label));
}

/** The round-up choices: complete the sets needed (when short), and the next whole set count above both. Pure. */
export function roundTargets(p: FamilyPlan): { complete: number | null; next: number } {
  const complete = p.setsComplete < p.setsNeeded ? p.setsNeeded : null;
  // The smallest whole set count with no role left over in a partial set, at least one above what is needed and held.
  let next = Math.max(p.setsNeeded, p.setsComplete);
  for (const r of p.roles) if (r.perSet > 0) next = Math.max(next, Math.ceil(r.have / r.perSet - 1e-9));
  if (next <= Math.max(p.setsNeeded, p.setsComplete)) next = Math.max(p.setsNeeded, p.setsComplete) + 1;
  return { complete, next };
}

/** Crew per role to hire for `target` complete sets of a family. Pure. */
export function roundUpRoles(p: FamilyPlan, target: number): { role: Role; count: number }[] {
  const perSet: Partial<Record<Role, number>> = {};
  const have: Partial<Record<Role, number>> = {};
  for (const r of p.roles) {
    perSet[r.role] = r.perSet;
    have[r.role] = r.have;
  }
  return missingFor(perSet, have, target).filter((m) => m.count > 0);
}

export interface RoundUpLine { req: HireRequest; cost: number; readyAt: number; payroll: number; beyondPool: number }

/**
 * The hire orders that complete `target` sets of a family, each with its cost, join date and monthly payroll (salary
 * plus on-costs). Cabin crew and pursers hold `cabinTypes` (the family first; up to 3). Pure.
 */
export function roundUpQuote(g: GameState, p: FamilyPlan, target: number, cabinTypes: RatingFamily[] = [p.family]): { lines: RoundUpLine[]; cost: number; payroll: number } {
  const lines: RoundUpLine[] = [];
  const fams = [p.family, ...cabinTypes.filter((f) => f !== p.family)].slice(0, 3);
  for (const m of roundUpRoles(p, target)) {
    const req: HireRequest = isPilot(m.role) ? { role: m.role, family: p.family, base: g.company.homeBase, count: m.count } : { role: m.role, family: p.family, base: g.company.homeBase, count: m.count, families: fams };
    const q = hireQuote(g, req);
    const payroll = Math.round(salaryFor(m.role, p.family) * m.count * (1 + BAL.onCosts));
    lines.push({ req, cost: q.cost, readyAt: q.readyAt, payroll, beyondPool: q.beyondPool });
  }
  return { lines, cost: lines.reduce((s, l) => s + l.cost, 0), payroll: lines.reduce((s, l) => s + l.payroll, 0) };
}

/** A type's set in words: '1 CPT + 1 FO + 1 PUR + 3 CC'. */
export function setWords(set: Partial<Record<Role, number>>): string {
  return SET_ROLES.filter((r) => set[r]).map((r) => `${set[r]} ${r}`).join(' + ');
}

/** Known family for a type id (tests). */
export const familyOf = (typeId: string): RatingFamily | null => ACMI_TYPES[typeId]?.family ?? null;
