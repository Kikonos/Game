// Hiring, training, staffing, capacity and sickness (B2). DESIGN.md §5.4, §5.1.5 check 11.

import { ACMI_TYPES, ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { flightsRev, nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushDecision, pushMessage } from '../core/messages';
import { isPilot, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int } from '../core/rng';
import { DAY, dayStart, fmtDate, fmtDateTime, yearOf } from '../core/time';
import type { ActionResult, CrewExtra, CrewMember, GameState, Minute, Role, SimEvent, TrainingKind } from '../core/types';
import { hashUnit } from '../core/util';
import { classOf, conversionClasses, conversionEarliest, onClassItemDone, startConversion } from './conversion';
import { crewExtraFor, rolesWithExtra } from './extraSeats';
import { familyNeeds } from './sets';
import { sickMult } from './morale';
import { crewName, makeCrewMember, salaryFor } from './generate';
import { removeCrew, rosterOf } from './roster';
import { block28, crewIx, crewRev, segsOf, touchCrew } from './timeline';
import type { Seg } from './rules';

export interface HireRequest {
  role: Role;
  family: RatingFamily;
  base: string;
  count: number;
  /** v0.7.2 cabin crew: 1–3 types (family first); pilots ignore it. */
  families?: RatingFamily[];
}

const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
const ROLE_NAME: Record<Role, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', PUR: 'purser', CC: 'cabin crew' };

export interface RatedMarket {
  /** Rated pilots of this family and rank on the market every 30 days, and how many are left now. */
  pool: number;
  left: number;
  /** Agency / sign-on fee per hire beyond the pool. */
  fee: number;
}

const wideFamily = (f: RatingFamily) => ACMI_TYPES_LIST.some((t) => t.family === f && t.body === 'wide');
const poolKey = (family: RatingFamily, role: Role) => `${family}:${role === 'CRP' ? 'FO' : role}`;

/** The market for type-rated pilots (null for cabin crew: plentiful). Pure. */
export function ratedMarket(g: GameState, family: RatingFamily, role: Role): RatedMarket | null {
  if (!isPilot(role)) return null;
  const P = BAL.ratedPool;
  const pool = (wideFamily(family) ? P.wide : P.narrow)[role === 'CPT' ? 'CPT' : 'FO'];
  const key = poolKey(family, role);
  let used = 0;
  for (const [t, k, n] of g.stats.ratedHires ?? []) if (k === key && t > g.now - 30 * DAY) used += n;
  return { pool, left: Math.max(0, pool - used), fee: Math.round((salaryFor(role, family) * 12 * P.feePct) / 100) * 100 };
}

/**
 * Pure quote (no g.rng): ready date jitter from hashUnit(role + base + now); hireCrew stores this exact date.
 * v0.6: pilots beyond the rated pool pay the agency fee each and take BAL.ratedPool.daysMult × as long.
 */
export function hireQuote(g: GameState, r: HireRequest): { cost: number; readyAt: Minute; beyondPool: number; fee: number } {
  const n = Math.max(0, Math.floor(r.count));
  const m = ratedMarket(g, r.family, r.role);
  const beyondPool = m ? Math.max(0, n - m.left) : 0;
  const fee = m ? m.fee * beyondPool : 0;
  // v0.7.2 cabin crew join in about a week; each extra type adds days and half the hiring cost.
  const H = BAL.v072.cabinHire;
  const k = isPilot(r.role) ? 1 : hireFamilies(r).length;
  const cost = (isPilot(r.role) ? BAL.hireCost.pilot : BAL.hireCost.cabin * (1 + H.extraTypeCost * (k - 1))) * n + fee;
  const base = isPilot(r.role)
    ? ((wideFamily(r.family) ? BAL.hireDaysWide : BAL.hireDays)[r.role] ?? 45) * (beyondPool ? BAL.ratedPool.daysMult : 1)
    : H.days + H.extraTypeDays * (k - 1);
  const days = Math.round(base * (0.8 + 0.4 * hashUnit(`${r.role}${r.base}${g.now}`)));
  return { cost, readyAt: dayStart(g.now) + days * DAY, beyondPool, fee };
}

/** v0.7.2 the types a hire holds: pilots one; cabin crew the family plus `families` (distinct, family first). */
export function hireFamilies(r: HireRequest): RatingFamily[] {
  if (isPilot(r.role)) return [r.family];
  return [...new Set([r.family, ...(r.families ?? [])])];
}

/** Creates 'joining' crew members, charges hiring cost, queues 'crew.join' at readyAt. */
export function hireCrew(g: GameState, r: HireRequest): ActionResult<{ crewIds: string[] }> {
  const n = Math.floor(r.count);
  if (!ROLES.includes(r.role)) return { ok: false, error: 'Unknown role' };
  if (n < 1 || n > 30) return { ok: false, error: 'Hire between 1 and 30 at a time' };
  if (!AIRPORT_BY_CODE[r.base]) return { ok: false, error: 'Unknown base' };
  const fams = hireFamilies(r);
  if (fams.some((f) => !Object.values(ACMI_TYPES).some((t) => t.family === f))) return { ok: false, error: 'Unknown type family' };
  if (fams.length > 3) return { ok: false, error: 'Cabin crew hold up to 3 types' };
  const q = hireQuote(g, r);
  if (g.company.cash < q.cost) return { ok: false, error: 'Not enough cash' };
  const crewIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCrewMember(g, r.role, r.family, r.base, 'joining');
    if (fams.length > 1) c.ratings = [...fams];
    // `hired` is the first working day; the joining block keeps them off the roster until then (v0.5.2: no fake
    // "rest until" the join date: the UI shows "Joins …" via crewStatusView).
    c.hired = q.readyAt;
    c.lastRecovery = q.readyAt;
    c.blockYearOf = yearOf(q.readyAt);
    c.blocks = [{ from: g.now, to: q.readyAt, why: 'joining' }];
    g.crew[c.id] = c;
    g.hires.push({ id: nextId(g, 'h'), role: r.role, family: r.family, base: r.base, crewId: c.id, ordered: g.now, ready: q.readyAt, cost: q.cost / n, ...(fams.length > 1 ? { families: [...fams] } : {}) });
    schedule(g, q.readyAt, 'crew.join', c.id);
    crewIds.push(c.id);
  }
  post(g, 'hiring', -q.cost);
  if (isPilot(r.role)) {
    const h = (g.stats.ratedHires ??= []).filter(([t]) => t > g.now - 30 * DAY);
    h.push([g.now, poolKey(r.family, r.role), n]);
    g.stats.ratedHires = h;
  }
  return { ok: true, msg: `${n} ${ROLE_NAME[r.role]}${n > 1 && !ROLE_NAME[r.role].endsWith('crew') ? 's' : ''} joining ${fmtDate(q.readyAt)}`, data: { crewIds } };
}

/**
 * v0.7.4 one confirm for several hire orders (the Crew planning round-up): all or nothing on cash, then each order
 * as hireCrew. Returns the crew ids and one line per order.
 */
export function hireBatch(g: GameState, reqs: HireRequest[]): ActionResult<{ crewIds: string[]; lines: string[] }> {
  const list = reqs.filter((r) => Math.floor(r.count) >= 1);
  if (!list.length) return { ok: false, error: 'Nobody to hire' };
  const cost = list.reduce((s, r) => s + hireQuote(g, r).cost, 0);
  if (g.company.cash < cost) return { ok: false, error: 'Not enough cash' };
  const crewIds: string[] = [];
  const lines: string[] = [];
  for (const r of list) {
    const res = hireCrew(g, r);
    if (!res.ok) return { ok: false, error: res.error };
    crewIds.push(...res.data!.crewIds);
    lines.push(res.msg ?? '');
  }
  const first = Math.min(...crewIds.map((id) => g.crew[id]?.hired ?? Infinity));
  const last = Math.max(...crewIds.map((id) => g.crew[id]?.hired ?? 0));
  return { ok: true, msg: `${crewIds.length} crew hired · joining ${first === last ? fmtDate(first) : `${fmtDate(first)} – ${fmtDate(last)}`}`, data: { crewIds, lines } };
}

const TRAINING: Record<'command' | 'sccm', () => { days: number; cost: number }> = {
  command: () => ({ days: BAL.commandUpgrade.days, cost: BAL.commandUpgrade.cost }),
  sccm: () => ({ days: BAL.sccmCourse.days, cost: BAL.sccmCourse.cost }),
};

/**
 * Type rating, command upgrade, SCCM course or conversion: status 'training' until done (rostered work is re-crewed).
 * v0.6: a type rating or conversion is a one-person conversion class (startConversion: same rules and prices).
 */
export function trainCrew(g: GameState, crewId: string, kind: TrainingKind, family: RatingFamily): ActionResult {
  const c = g.crew[crewId];
  if (!c) return { ok: false, error: 'Crew member not found' };
  if (kind === 'typeRating' || kind === 'conversion') {
    const r = startConversion(g, { crewIds: [crewId], family, start: conversionEarliest(g) });
    return r.ok ? { ok: true, msg: r.msg } : r;
  }
  if (c.status === 'training' || c.status === 'joining' || c.status === 'sick') return { ok: false, error: `${crewName(c)} is ${c.status}` };
  if (kind === 'command') {
    if (c.role !== 'FO') return { ok: false, error: 'Only first officers upgrade to captain' };
    if (c.totalHours < BAL.commandUpgrade.minHours) return { ok: false, error: `Needs ${BAL.commandUpgrade.minHours.toLocaleString('en-US')} h (has ${Math.round(c.totalHours).toLocaleString('en-US')})` };
  }
  if (kind === 'sccm' && c.role !== 'CC') return { ok: false, error: 'Only cabin crew take the purser course' };
  const { days, cost } = TRAINING[kind]();
  if (g.company.cash < cost) return { ok: false, error: 'Not enough cash' };
  const start = g.now;
  const end = dayStart(g.now) + days * DAY;
  c.blocks = [...(c.blocks ?? []), { from: start, to: end, why: 'training' }];
  if (c.status !== 'onDuty') c.status = 'training';
  const item = { id: nextId(g, 't'), crewId, kind, family, start, end, cost };
  g.training.push(item);
  post(g, 'training', -cost);
  schedule(g, end, 'training.done', item.id);
  removeCrew(g, crewId, start, end);
  return { ok: true, msg: `${crewName(c)} in training until ${fmtDate(end)}` };
}

export interface RoleCapacity {
  /** Crew-days the programme needs vs free crew-days left after existing pairings, in the window. */
  need: number;
  free: number;
  /** Extra crew of this role to hire or move (0 when covered). */
  short: number;
}

export interface Availability {
  /** Complements the programme needs, and how many the free capacity covers. */
  setsNeeded: number;
  setsAvailable: number;
  byRole: Partial<Record<Role, RoleCapacity>>;
  /** First day the shortfall bites (null when covered). */
  firstShort: Minute | null;
}

/** RESEARCH §5.3 sizing: persons per role = ceil(ceil(BH/month × per flight / productive BH) × 1.2), at least one set. */
function sizing(per: Partial<Record<Role, number>>, bhMonth: number): Partial<Record<Role, number>> {
  const out: Partial<Record<Role, number>> = {};
  for (const r of ROLES) {
    const n = per[r];
    if (!n) continue;
    const prod = isPilot(r) ? BAL.pilotBHMonth : BAL.cabinBHMonth;
    out[r] = Math.max(n, Math.ceil(Math.ceil((bhMonth * n) / prod) * BAL.crewReserve));
  }
  return out;
}

const countRoles = (roles: Role[]) => roles.reduce<Partial<Record<Role, number>>>((m, r) => ((m[r] = (m[r] ?? 0) + 1), m), {});

/**
 * Capacity, not idleness (B1 feasibility check 11): free crew-days per role in [from, to) after other
 * programmes' needs, non-contract pairings, joining/training/leave and the 100 h/28 d block limit, vs the
 * programme's need (RESEARCH §5.3 sizing from `programmeBH`). Pure: no g.rng, no ids.
 */
/**
 * v0.7: crewAvailability's per-crew timelines and per-contract block totals, kept while the clock, the crew
 * plan and the flights stand still (offers are sized many times between two clock steps). Runtime only.
 */
const availMemo = new WeakMap<GameState, { key: string; segs: Map<string, Seg[]>; blk: Map<string, number> }>();
function memoOf(g: GameState) {
  const key = `${g.now}:${crewRev(g)}:${flightsRev(g)}`;
  let m = availMemo.get(g);
  if (!m || m.key !== key) availMemo.set(g, (m = { key, segs: new Map(), blk: new Map() }));
  return m;
}

export function crewAvailability(g: GameState, family: RatingFamily, typeId: string, from: Minute, to: Minute, programmeBH: number, extra?: CrewExtra): Availability {
  const days = Math.max(1, Math.ceil((to - from) / DAY));
  const t = typeOf(typeId);
  const seats = t.cabins[0] ? t.cabins[0].j + t.cabins[0].w + t.cabins[0].y : 180;
  // v0.6: the programme's crew with its extra crew (the spare pilot sized as a first officer).
  const x = extra ?? { cabin: g.company.policies.extraCabin, pilot: 0 };
  const per = countRoles(rolesWithExtra(typeId, seats, x).map((r) => (r === 'CRP' ? 'FO' : r)));
  const need = sizing(per, programmeBH / Math.max(1, days / 30.44));
  // Supply per role and day (exact role; seniors spill down below).
  const supply: Record<Role, Int32Array> = Object.fromEntries(ROLES.map((r) => [r, new Int32Array(days)])) as Record<Role, Int32Array>;
  const ix = crewIx(g);
  const memo = memoOf(g);
  for (const c of Object.values(g.crew)) {
    if (!c.ratings.includes(family)) continue;
    const off = new Uint8Array(days);
    const mark = (a: Minute, b: Minute) => {
      for (let d = Math.max(0, Math.floor((a - from) / DAY)); d < days && from + d * DAY < b; d++) off[d] = 1;
    };
    for (const b of c.blocks ?? []) mark(b.from, b.to);
    // v0.6: gone after the leave date; off this type from a conversion that ends the rating (as staffing()).
    if (c.notice) mark(c.notice.leaves, to);
    const k = classOf(g, c.id);
    if (k && k.family !== family && (k.group === 'pilot' ? k.course === 'full' : k.drop?.[c.id] === family)) mark(k.start, to);
    for (const p of ix.pairingsOf.get(c.id) ?? []) if (!p.contractId && p.status !== 'done') mark(p.start, p.end);
    let segs = memo.segs.get(c.id);
    if (!segs) memo.segs.set(c.id, (segs = segsOf(g, c)));
    if (block28(segs, from) > 90 * 60) mark(from, from + 7 * DAY);
    for (let d = 0; d < days; d++) if (!off[d]) supply[c.role][d]++;
  }
  // Other programmes of the family hold their sized crews while active.
  const held: Record<Role, Int32Array> = Object.fromEntries(ROLES.map((r) => [r, new Int32Array(days)])) as Record<Role, Int32Array>;
  for (const k of Object.values(g.contracts)) {
    if ((k.status !== 'signed' && k.status !== 'active') || k.end <= from || k.start >= to) continue;
    const ac = k.aircraftIds.map((id) => g.fleet[id]).filter((a) => a && typeOf(a.typeId).family === family);
    if (!ac.length) continue;
    let bhMonth = 0;
    if (k.pattern.kind === 'base') bhMonth = k.pattern.targetBH;
    else {
      let blk = memo.blk.get(k.id);
      if (blk === undefined) {
        blk = 0;
        for (const f of Object.values(g.flights)) if (f.contractId === k.id && f.aircraftId && f.status !== 'cancelled') blk += f.block;
        memo.blk.set(k.id, blk);
      }
      bhMonth = blk / 60 / Math.max(1, (k.end - k.start) / DAY / 30.44);
    }
    const kx = crewExtraFor(g, ac[0].id, k.id);
    const kPer = countRoles(rolesWithExtra(ac[0].typeId, ac[0].cabin.total, kx, k.requirements.extraCabin).map((r) => (r === 'CRP' ? 'FO' : r)));
    const kNeed = sizing(kPer, bhMonth);
    for (let d = 0; d < days; d++) {
      const day = from + d * DAY;
      if (day + DAY <= k.start || day >= k.end) continue;
      for (const r of ROLES) held[r][d] += kNeed[r] ?? 0;
    }
  }
  const byRole: Partial<Record<Role, RoleCapacity>> = {};
  const minAvail: Partial<Record<Role, number>> = {};
  let firstShort: Minute | null = null;
  for (let d = 0; d < days; d++) {
    // Spill seniors down: FO → CRP, PUR → CC (captains never spill into FO seats: hire FOs).
    const left: Record<Role, number> = Object.fromEntries(ROLES.map((r) => [r, supply[r][d] - held[r][d]])) as Record<Role, number>;
    const spill = (fromR: Role, toR: Role) => {
      const surplus = left[fromR] - (need[fromR] ?? 0);
      if (surplus > 0 && left[toR] < (need[toR] ?? 0)) {
        const m = Math.min(surplus, (need[toR] ?? 0) - left[toR]);
        left[fromR] -= m;
        left[toR] += m;
      }
    };
    spill('FO', 'CRP');
    spill('PUR', 'CC');
    for (const r of ROLES) {
      const n = need[r];
      if (!n) continue;
      const cap = (byRole[r] ??= { need: 0, free: 0, short: 0 });
      cap.need += n;
      cap.free += Math.max(0, left[r]);
      const short = Math.max(0, n - left[r]);
      if (short > cap.short) cap.short = short;
      if (short > 0 && firstShort === null) firstShort = from + d * DAY;
      minAvail[r] = Math.min(minAvail[r] ?? Infinity, left[r]);
    }
  }
  let setsNeeded = 0;
  let setsAvailable = Infinity;
  for (const r of ROLES) {
    const n = per[r];
    if (!n) continue;
    setsNeeded = Math.max(setsNeeded, Math.ceil((need[r] ?? 0) / n));
    setsAvailable = Math.min(setsAvailable, Math.max(0, Math.floor((minAvail[r] ?? 0) / n)));
  }
  return { setsNeeded, setsAvailable: setsAvailable === Infinity ? 0 : setsAvailable, byRole, firstShort };
}

export interface StaffingLine {
  family: RatingFamily;
  role: Role;
  /** Rated crew who stay on the type (v0.6: without those on notice or converting away from it). */
  have: number;
  need: number;
  /** v0.6: rated crew on notice (not in have). */
  leaving: number;
  /** v0.6: rated crew booked on a conversion that ends their rating on this type (not in have). */
  converting: number;
  /** v0.7.2 cabin crew counted here who also hold another type in the fleet. */
  shared?: number;
}

/**
 * Staffing vs need for the Crew screen, the hire screen and the bot. v0.8 fix pack: the need is the Planning view's
 * (sets.ts familyNeeds, one source of truth): BAL.crewSetsPerAircraft complements per aircraft of the family (more for
 * an aircraft on a deployment), the extra crew its long work asks for and relief pilots for augmented days; without
 * the seats a client's own cabin crew fly (mixed crew) and without aircraft away on a dry lease. Relief pilots count
 * as first officers here (a first officer fills a relief seat).
 */
export function staffing(g: GameState): StaffingLine[] {
  const fams = new Map<RatingFamily, Partial<Record<Role, number>>>();
  for (const [family, f] of familyNeeds(g)) {
    // Rounded per role as the Planning view shows them, relief pilots added to the first officers.
    const need: Partial<Record<Role, number>> = {};
    for (const r of ROLES) {
      const v = Math.ceil((f.need[r] ?? 0) - 1e-9);
      if (!v) continue;
      const role: Role = r === 'CRP' ? 'FO' : r;
      need[role] = (need[role] ?? 0) + v;
    }
    fams.set(family, need);
  }
  // One pass over the crew: who keeps each rating (pilots on a full course to another type lose the old one; cabin
  // crew at 3 types drop the one named in the class).
  const losing = new Map<string, RatingFamily[]>();
  for (const k of conversionClasses(g)) {
    for (const id of k.crewIds) {
      const c = g.crew[id];
      if (!c) continue;
      const lost = k.group === 'pilot' ? (k.course === 'full' ? c.ratings.filter((f) => f !== k.family) : []) : k.drop?.[id] ? [k.drop[id]] : [];
      if (lost.length) losing.set(id, [...(losing.get(id) ?? []), ...lost]);
    }
  }
  const count = new Map<string, { have: number; leaving: number; converting: number; shared: number }>();
  for (const c of Object.values(g.crew)) {
    for (const f of c.ratings) {
      const key = `${f}:${c.role}`;
      let x = count.get(key);
      if (!x) count.set(key, (x = { have: 0, leaving: 0, converting: 0, shared: 0 }));
      if (c.notice) x.leaving++;
      else if (losing.get(c.id)?.includes(f)) x.converting++;
      else {
        x.have++;
        // v0.7.2 cabin crew on several types also count towards another fleet family.
        if (!isPilot(c.role) && c.ratings.some((o) => o !== f && fams.has(o))) x.shared++;
      }
    }
  }
  const out: StaffingLine[] = [];
  for (const [family, need] of fams) {
    for (const r of ROLES) {
      if (!need[r]) continue;
      const { shared, ...x } = count.get(`${family}:${r}`) ?? { have: 0, leaving: 0, converting: 0, shared: 0 };
      out.push({ family, role: r, need: need[r]!, ...x, ...(shared ? { shared } : {}) });
    }
  }
  return out;
}

function clearBlock(c: CrewMember, why: 'joining' | 'training'): void {
  c.blocks = (c.blocks ?? []).filter((b) => b.why !== why);
  if (!c.blocks.length) delete c.blocks;
}

/** 'crew.join': status → available at base. */
export function onCrewJoin(g: GameState, ev: SimEvent): void {
  const c = g.crew[ev.id];
  if (!c || c.status !== 'joining') return;
  c.status = 'available';
  c.loc = c.base;
  clearBlock(c, 'joining');
  const h = g.hires.find((x) => x.crewId === c.id);
  g.hires = g.hires.filter((x) => x.crewId !== c.id);
  // One message per hire batch, when its last member joins.
  if (h && !g.hires.some((x) => x.ordered === h.ordered && x.role === h.role && x.base === h.base)) {
    const n = Object.values(g.crew).filter((x) => x.hired === c.hired && x.role === c.role && x.base === c.base).length;
    pushMessage(g, { tone: 'good', cat: 'crew', title: `${n} new ${ROLE_NAME[c.role]}${n > 1 ? 's' : ''} joined`, body: `${n > 1 ? 'They are' : `${crewName(c)} is`} available at ${c.base} from today.`, ref: { kind: 'crew', id: c.id } });
  }
  touchCrew(g);
}

/** 'training.done': add the rating / role, status → available. */
export function onTrainingDone(g: GameState, ev: SimEvent): void {
  const item = g.training.find((x) => x.id === ev.id);
  if (!item) return;
  g.training = g.training.filter((x) => x.id !== ev.id);
  if (onClassItemDone(g, item)) return;
  const c = g.crew[item.crewId];
  if (!c) return;
  if (item.kind === 'typeRating' || item.kind === 'conversion') {
    if (!c.ratings.includes(item.family)) c.ratings.push(item.family);
  } else if (item.kind === 'command') c.role = 'CPT';
  else if (item.kind === 'sccm') c.role = 'PUR';
  const wide = c.ratings.find((f) => salaryFor(c.role, f) !== salaryFor(c.role, 'A320'));
  c.salary = salaryFor(c.role, wide ?? c.ratings[0] ?? 'A320');
  clearBlock(c, 'training');
  if (c.status === 'training') c.status = 'available';
  const what = item.kind === 'command' ? 'command upgrade' : item.kind === 'sccm' ? 'Purser course' : `${item.family} ${item.kind === 'conversion' ? 'conversion' : 'type rating'}`;
  pushMessage(g, { tone: 'good', cat: 'crew', title: `${crewName(c)} finished training`, body: `Completed the ${what}.`, ref: { kind: 'crew', id: c.id } });
  touchCrew(g);
}

/**
 * Daily sickness roll: p = 0.04/30 × (1 + max(0, 65 − morale)/50) (v0.6 morale.sickMult); sick for 2–5 days, taken off rostered work.
 * A slot that can't be refilled becomes a B3 'sickCrew' decision.
 */
export function dailySickness(g: GameState): void {
  for (const c of Object.values(g.crew)) {
    if (c.status === 'sick' || c.status === 'joining' || c.status === 'training' || c.status === 'leave' || c.status === 'onDuty') continue;
    if (c.blocks?.some((b) => b.why === 'sick' && b.to > g.now)) continue;
    const p = (BAL.sickPerMonth / 30) * sickMult(c.morale);
    if (!chance(g, p)) continue;
    const days = int(g, BAL.sickDays[0], BAL.sickDays[1]);
    // A sick call covers the coming days (crew call in the evening before): today's duties stay, tomorrow's are
    // re-crewed with a day's notice for a replacement to position.
    let from = dayStart(g.now) + DAY;
    for (const d of rosterOf(g, c.id, g.now, from)) if (d.report < from) from = Math.max(from, d.release);
    const to = from + days * DAY;
    c.blocks = [...(c.blocks ?? []), { from, to, why: 'sick' }];
    const res = removeCrew(g, c.id, from, to);
    const f = res.uncovered.map((id) => g.flights[id]).filter((x) => x && x.std < to + DAY).sort((a, b) => a.std - b.std)[0];
    if (f) {
      pushDecision(g, {
        kind: 'sickCrew',
        title: `${crewName(c)} called in sick`,
        body: `${crewName(c)} (${c.role}) is off sick from tomorrow for ${days} days and nobody legal can take ${f.no} ${f.from}–${f.to} on ${fmtDateTime(f.std)}.`,
        options: [
          { id: 'callIn', label: 'Call in a crew member', desc: 'Someone gives up days off to cover.', tone: 'warn', chips: ['Morale −4'] },
          { id: 'subcharter', label: 'Sub-charter the flight', desc: 'A rival operates the legs; we still bill the client.', tone: 'warn' },
          { id: 'cancel', label: 'Cancel the flight', desc: 'Penalty and reputation hit.', tone: 'bad' },
        ],
        defaultOption: 'callIn',
        expires: Math.max(g.now + 60, Math.min(f.std - 120, g.now + 12 * 60)),
        ref: { kind: 'flight', id: f.id },
        data: { crewId: c.id, flightId: f.id },
      });
    } else {
      pushMessage(g, { tone: 'info', cat: 'crew', title: `${crewName(c)} is off sick`, body: `From tomorrow, ${days} days. Their duties were re-crewed.`, ref: { kind: 'crew', id: c.id } });
    }
  }
}
