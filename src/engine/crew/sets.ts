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
import { conversionClasses, ratingsLost } from './conversion';
import { crewExtraFor, rolesWithExtra } from './extraSeats';
import { payFor } from './generate';
import { hireQuote, type HireRequest } from './hr';

export const SET_ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];

/**
 * v0.9 the Planning view's one line on why 5 sets per aircraft still holds with v0.9 rostering (UPDATE-0.9.md §R.7):
 * ≈ 30.4 − 9 off − 2.3 leave − ≈ 1 sick/training ≈ 18 work days a person a month; 5 sets give ≈ 90 crew-days per seat
 * against 30–45 flying days, the rest is standby.
 */
export const SETS_WHY = '5 sets per aircraft: each person has 8–10 days off a month in 2–3-day blocks and 4 weeks’ leave; every other day is flying or standby.';

/** v0.9 fix: the Planning view's line for a fleet with a detached aircraft (replaces 'its sets on station plus 2 at base'). */
export const SETS_DETACHED = 'A detached aircraft needs its sets on station plus one in five for leave and change-overs.';
/**
 * v0.9 fix: crew sets an aircraft on a deployment needs: its sets on station (their days off are taken at the hotel,
 * inside the tour) plus a fifth for leave, sickness and the change-overs (the same 1.20 as the home rule), never fewer
 * than the home base's 5. Was on-station + 2 (7 for a 5-set detachment). Pure.
 */
export const setsForStation = (onStation: number): number => Math.max(BAL.crewSetsPerAircraft, Math.ceil(onStation * 1.2 - 1e-9));

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
  /**
   * v0.11.2 seats of this role in the sets needed that spare seniors fill (pursers in cabin crew seats, first officers
   * in relief pilot seats; counted in `balance`); on the senior role, how many of its spare fill them.
   */
  covered: number;
  /** v0.11.2 crew in one set with the client's own cabin crew seats as ours (whole sets for the round-up). */
  perSetAll: number;
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
  /** v0.9: 'Short: 2 CPT, 1 PUR, 2 CC' / 'Complete · 2 spare' (the tiles above show the rest). */
  verdict: string;
  /**
   * v0.11 crew counted here who also hold another fleet type (a backup there; counted here only). `spill`: crew hired
   * for `family` counted here because it has all it needs.
   */
  alsoRated: Backup[];
  /** v0.11 crew counted in another family who also hold this one (a backup here; counted there only). `spill`: hired here. */
  backupFrom: Backup[];
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

/**
 * Needs per family: aircraft, sets and the crew per role (each aircraft's complement × its sets, plus relief pilots).
 * v0.8 fix pack: the one source of truth for crew numbers (the Planning view here, staffing() for Hire and the bot).
 */
export function familyNeeds(g: GameState) {
  const onStation = new Map<string, number>();
  for (const dp of Object.values(g.deployments)) {
    if (dp.end < g.now || dp.start > g.now + WINDOW) continue;
    onStation.set(dp.aircraftId, Math.max(onStation.get(dp.aircraftId) ?? 0, dp.setsOnStation));
  }
  // v0.11.2 `full`: the need with the client's cabin crew seats as ours (whole sets for the round-up).
  const fams = new Map<RatingFamily, { aircraft: number; sets: number; need: Partial<Record<Role, number>>; full: Partial<Record<Role, number>>; types: Map<string, TypeSet>; aug: boolean; client: number; dry: number }>();
  const famOf = (f: RatingFamily) => {
    let x = fams.get(f);
    if (!x) fams.set(f, (x = { aircraft: 0, sets: 0, need: {}, full: {}, types: new Map<string, TypeSet>(), aug: false, client: 0, dry: 0 }));
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
    const sets = setsForStation(onStation.get(ac.id) ?? 0);
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
      if (per[r]) f.full[r] = (f.full[r] ?? 0) + per[r]! * sets;
      f.client += (theirs[r] ?? 0) * sets;
    }
    // Long days flown with 3 or 4 pilots: relief pilots (or a second captain and first officer) for that share of the sets.
    const a = augOf(g, ac.id);
    if (a.level) {
      const extra = Math.ceil(sets * a.share - 1e-9);
      const roles: Role[] = a.level === 1 ? ['CRP'] : ['CPT', 'FO'];
      for (const r of roles) {
        f.need[r] = (f.need[r] ?? 0) + extra;
        f.full[r] = (f.full[r] ?? 0) + extra;
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

/**
 * One family's crew on another family's rating, for the card's backup line. v0.11.2 `spill`: crew counted away from
 * the family they were hired for (it has all it needs): on the card where they are counted, `family` is the family
 * they were hired for; on that family's card, `family` is where they are counted.
 */
export interface Backup { family: RatingFamily; label: string; cabin: number; pilots: number; spill?: true }

/** Senior roles that fill a junior role's seats in the sets (first officers relief pilot seats, pursers cabin crew seats). */
const SENIOR: Partial<Record<Role, Role>> = { CRP: 'FO', CC: 'PUR' };

/** The family each person is counted in (crew/hr.ts staffing() and the peak forecast use the same). */
export type CrewHomes = Map<string, RatingFamily>;

/**
 * Crew per family and role, each person once. v0.11 fix: a person on several types counts first in their HOME family
 * (the type they were hired for: their first rating); only those beyond the home family's need for their role spill
 * to the other family with the largest shortfall (ties: rating order), and back home when no family is short. Was:
 * every multi-type person went to the largest shortfall, so cabin crew hired for the A320 family with an extra
 * widebody rating filled the widebody's sets and Round up offered the same A320 hires again. Single-type crew and
 * saves without multi-type crew count exactly as before. Also returns, per family, who is counted there while also
 * holding another fleet type (`backups`: the flexibility, never counted twice).
 * v0.11.2 fixes: a family's need for a role counts the spare seniors who fill its seats (pursers beyond their own
 * need fly cabin crew seats, first officers relief pilot seats), so a multi-type cabin crew member is not kept home
 * for a seat a spare purser already fills; the seniors are placed first (roles in set order, then oldest first).
 * `homes`: the family each person is counted in (Hire view, peak forecast and offer checks count crew the same way).
 */
export function crewSupply(g: GameState, fams: Map<RatingFamily, { need: Partial<Record<Role, number>> }>) {
  const losing = new Map<string, RatingFamily[]>();
  for (const k of conversionClasses(g)) {
    for (const id of k.crewIds) {
      const c = g.crew[id];
      if (!c) continue;
      // v0.12.1 one rule for what a course ends (a CCQ keeps the old type).
      const lost = ratingsLost(c, k);
      if (lost.length) losing.set(id, [...(losing.get(id) ?? []), ...lost]);
    }
  }
  type Cell = { have: number; joining: number; away: number; shared: number };
  const out = new Map<string, Cell>();
  const homes: CrewHomes = new Map();
  const cell = (f: RatingFamily, r: Role) => {
    const k = `${f}:${r}`;
    let x = out.get(k);
    if (!x) out.set(k, (x = { have: 0, joining: 0, away: 0, shared: 0 }));
    return x;
  };
  const backups = new Map<RatingFamily, Map<string, Backup>>();
  const note = (on: RatingFamily, o: RatingFamily, pilot: boolean, spill: boolean) => {
    const m = backups.get(on) ?? new Map<string, Backup>();
    backups.set(on, m);
    const key = `${o}:${spill ? 1 : 0}`;
    const b = m.get(key) ?? { family: o, label: LABEL[o], cabin: 0, pilots: 0, ...(spill ? { spill: true as const } : {}) };
    if (pilot) b.pilots++;
    else b.cabin++;
    m.set(key, b);
  };
  const add = (f: RatingFamily, c: GameState['crew'][string], fs: RatingFamily[]) => {
    const x = cell(f, c.role);
    x.have++;
    homes.set(c.id, f);
    if (c.status === 'joining') x.joining++;
    else if (c.status === 'sick' || c.status === 'leave' || c.status === 'training') x.away++;
    if (fs.length > 1) {
      x.shared++;
      // Counted away from the family they were hired for: one 'spill' line (by that family); else each other rating.
      if (f !== fs[0]) note(f, fs[0], isPilot(c.role), true);
      else for (const o of fs) if (o !== f) note(f, o, isPilot(c.role), false);
    }
  };
  const need = (f: RatingFamily, r: Role) => Math.ceil((fams.get(f)!.need[r] ?? 0) - 1e-9);
  const gap = (f: RatingFamily, r: Role) => {
    const up = SENIOR[r];
    const spare = up ? Math.max(0, (out.get(`${f}:${up}`)?.have ?? 0) - need(f, up)) : 0;
    return need(f, r) - (out.get(`${f}:${r}`)?.have ?? 0) - spare;
  };
  const multi: { c: GameState['crew'][string]; fs: RatingFamily[] }[] = [];
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.notice) continue;
    const fs = c.ratings.filter((f) => fams.has(f) && !losing.get(c.id)?.includes(f));
    if (!fs.length) continue;
    if (fs.length === 1) add(fs[0], c, fs);
    else multi.push({ c, fs });
  }
  // Seniors first (they fill the juniors' seats), then oldest first.
  multi.sort((a, b) => SET_ROLES.indexOf(a.c.role) - SET_ROLES.indexOf(b.c.role));
  // Home first (the first rating still held in the fleet); the rest wait to spill.
  const spill: typeof multi = [];
  for (const m of multi) {
    if (gap(m.fs[0], m.c.role) > 0) add(m.fs[0], m.c, m.fs);
    else spill.push(m);
  }
  for (const { c, fs } of spill) {
    let best = fs[0];
    let most = 0;
    for (const f of fs.slice(1)) {
      const d = gap(f, c.role);
      if (d > most) {
        most = d;
        best = f;
      }
    }
    add(best, c, fs);
  }
  return { cells: out, backups, homes };
}

/** Can `have` crew per role fill `t` sets of `perSet` (first officers fill relief pilot seats, pursers cabin crew seats)? */
export function setsFit(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>, t: number): boolean {
  return missingFor(perSet, have, t).every((m) => m.count === 0);
}

/**
 * Crew left over per role after filling `t` complete sets (< 0: short), seniors spilling into junior seats first, and
 * how many seniors sit in each junior role's seats (`moved`, by the junior role). Pure.
 */
export function leftover(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>, t: number): { left: Record<Role, number>; moved: Partial<Record<Role, number>> } {
  const want = (r: Role) => Math.ceil((perSet[r] ?? 0) * t - 1e-9);
  const left = {} as Record<Role, number>;
  const moved: Partial<Record<Role, number>> = {};
  for (const r of SET_ROLES) left[r] = (have[r] ?? 0) - want(r);
  // FO → relief pilot, purser → cabin crew.
  for (const [from, to] of [['FO', 'CRP'], ['PUR', 'CC']] as const) {
    if (left[to] < 0 && left[from] > 0) {
      const m = Math.min(left[from], -left[to]);
      left[from] -= m;
      left[to] += m;
      moved[to] = m;
    }
  }
  return { left, moved };
}

/** Crew to hire per role for `t` complete sets (seniors spilling into junior seats first). Pure. */
export function missingFor(perSet: Partial<Record<Role, number>>, have: Partial<Record<Role, number>>, t: number): { role: Role; count: number }[] {
  const { left } = leftover(perSet, have, t);
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


/** v0.7.4 the Crew planning view, one entry per fleet family (largest fleet first). Pure. */
export function crewPlan(g: GameState): FamilyPlan[] {
  const fams = familyNeeds(g);
  const { cells: sup, backups } = crewSupply(g, fams);
  const out: FamilyPlan[] = [];
  for (const [family, f] of fams) {
    const perSet: Partial<Record<Role, number>> = {};
    for (const r of SET_ROLES) if (f.need[r]) perSet[r] = f.need[r]! / f.sets;
    const perAll: Partial<Record<Role, number>> = {};
    for (const r of SET_ROLES) if (f.full[r]) perAll[r] = f.full[r]! / f.sets;
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
    // v0.11.2 spare seniors in junior seats (the table shows them; the junior role is not short for those seats).
    const { moved } = leftover(perSet, have, f.sets);
    const roles: SetRole[] = [];
    for (const r of SET_ROLES) {
      const x = sup.get(`${family}:${r}`) ?? { have: 0, joining: 0, away: 0, shared: 0 };
      const need = Math.ceil((f.need[r] ?? 0) - 1e-9);
      if (!need && !x.have) continue;
      const short = miss.find((m) => m.role === r)!.count;
      // v0.11.2 fix: a junior role whose seats spare seniors fill is not short for them (was: 'short 2' cabin crew on a
      // complete card with 2 spare pursers).
      const inSeats = moved[r] ?? 0;
      const lent = r === 'FO' ? moved.CRP ?? 0 : r === 'PUR' ? moved.CC ?? 0 : 0;
      roles.push({ role: r, perSet: perSet[r] ?? 0, need, have: x.have, joining: x.joining, away: x.away, shared: x.shared, balance: short ? -short : x.have + inSeats - need, covered: inSeats || lent, perSetAll: perAll[r] ?? perSet[r] ?? 0 });
    }
    // The role that runs out first (the fewest whole sets with the seniors filling its seats). v0.11.2 fix: was each
    // role on its own, so 'limited by cabin crew' showed when spare pursers covered them and another role ran out.
    let limiting: Role | null = null;
    let lim = Infinity;
    for (const r of SET_ROLES) {
      if (!(perSet[r] ?? 0)) continue;
      const ok = (t: number) => missingFor(perSet, have, t).find((m) => m.role === r)!.count === 0;
      let lo = 0;
      let hi = 500;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (ok(mid)) lo = mid;
        else hi = mid - 1;
      }
      if (lo < lim) {
        lim = lo;
        limiting = r;
      }
    }
    const each = Math.round(f.sets / f.aircraft);
    const shortTxt = miss.filter((m) => m.count > 0).map((m) => `${m.count} ${m.role}`).join(', ');
    // v0.9 (§V.2) only what the tiles above don't show: the shortfall, or complete and any spare sets.
    const verdict = setsComplete >= f.sets
      ? `Complete${setsComplete > f.sets ? ` · ${setsComplete - f.sets} spare` : ''}`
      : `Short: ${shortTxt}`;
    out.push({
      family, label: LABEL[family], aircraft: f.aircraft, types: [...f.types.values()], setsPerAircraft: each, setsNeeded: f.sets, setsNow, setsComplete,
      limiting: setsComplete >= f.sets ? null : limiting, augmented: f.aug, clientCabin: Math.round(f.client), dryLeased: f.dry, roles, verdict,
      alsoRated: [...(backups.get(family)?.values() ?? [])].map((b) => ({ ...b })),
      backupFrom: [...backups].flatMap(([counted, m]) => (counted === family ? [] : [...m.values()].filter((b) => b.family === family).map((b) => ({ ...b, family: counted, label: LABEL[counted] })))),
    });
  }
  return out.sort((a, b) => b.aircraft - a.aircraft || a.label.localeCompare(b.label));
}

/**
 * The round-up choices: complete the sets needed (when short), and round a partial set up to whole sets (a role
 * held beyond the complete sets, e.g. one cabin crew more than 5 sets use). v0.11 fix: `next` is null when every set
 * is whole and complete: Round up then has nothing to offer ('Sets complete'), so pressing it twice never hires
 * twice. `spare`: one whole set more, offered only as its own choice. Pure.
 */
export function roundTargets(p: FamilyPlan): { complete: number | null; next: number | null; spare: number } {
  const complete = p.setsComplete < p.setsNeeded ? p.setsNeeded : null;
  const held = Math.max(p.setsNeeded, p.setsComplete);
  // v0.11.2 fix: what is left after the held sets, with spare pursers in cabin crew seats (first officers in relief
  // seats) and whole sets (a client's own cabin crew seats counted as ours). Was each role on its own against the
  // set without the client's seats: 2 spare pursers covering 2 cabin crew seats offered 'Round up to 12 sets' on a
  // complete A320 family, and a mixed-crew contract 'Round up to 14 sets' with 10 needed and complete.
  const per: Partial<Record<Role, number>> = {};
  const have: Partial<Record<Role, number>> = {};
  for (const r of p.roles) {
    per[r.role] = Math.max(r.perSet, r.perSetAll ?? 0);
    have[r.role] = r.have;
  }
  const { left } = leftover(per, have, held);
  let next = held;
  for (const r of SET_ROLES) if ((per[r] ?? 0) > 0 && left[r] > 0) next = Math.max(next, held + Math.ceil(left[r] / per[r]! - 1e-9));
  return { complete, next: next > held ? next : null, spare: held + 1 };
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
    const payroll = Math.round(payFor(g, m.role, p.family) * m.count * (1 + BAL.onCosts));
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
