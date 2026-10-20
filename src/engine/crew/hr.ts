// Hiring, training, staffing, capacity and sickness (B2). DESIGN.md §5.4, §5.1.5 check 11.

import { ACMI_TYPES, type RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushDecision, pushMessage } from '../core/messages';
import { complement, isPilot, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int } from '../core/rng';
import { DAY, dayStart, fmtDate, fmtDateTime, yearOf } from '../core/time';
import type { ActionResult, CrewMember, GameState, Minute, Role, SimEvent, TrainingKind } from '../core/types';
import { hashUnit } from '../core/util';
import { crewName, makeCrewMember, salaryFor } from './generate';
import { removeCrew, rosterOf } from './roster';
import { block28, crewIx, segsOf, touchCrew } from './timeline';

export interface HireRequest {
  role: Role;
  family: RatingFamily;
  base: string;
  count: number;
}

const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];
const ROLE_NAME: Record<Role, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', CSD: 'purser', SCC: 'senior cabin crew', CC: 'cabin crew' };

/** Pure quote (no g.rng): ready date jitter from hashUnit(role + base + now); hireCrew stores this exact date. */
export function hireQuote(g: GameState, r: HireRequest): { cost: number; readyAt: Minute } {
  const n = Math.max(0, Math.floor(r.count));
  const cost = (isPilot(r.role) ? BAL.hireCost.pilot : BAL.hireCost.cabin) * n;
  const days = Math.round((BAL.hireDays[r.role] ?? 45) * (0.8 + 0.4 * hashUnit(`${r.role}${r.base}${g.now}`)));
  return { cost, readyAt: dayStart(g.now) + days * DAY };
}

/** Creates 'joining' crew members, charges hiring cost, queues 'crew.join' at readyAt. */
export function hireCrew(g: GameState, r: HireRequest): ActionResult<{ crewIds: string[] }> {
  const n = Math.floor(r.count);
  if (!ROLES.includes(r.role)) return { ok: false, error: 'Unknown role' };
  if (n < 1 || n > 30) return { ok: false, error: 'Hire between 1 and 30 at a time' };
  if (!AIRPORT_BY_CODE[r.base]) return { ok: false, error: 'Unknown base' };
  if (!Object.values(ACMI_TYPES).some((t) => t.family === r.family)) return { ok: false, error: 'Unknown type family' };
  const q = hireQuote(g, r);
  if (g.company.cash < q.cost) return { ok: false, error: 'Not enough cash' };
  const crewIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCrewMember(g, r.role, r.family, r.base, 'joining');
    c.hired = q.readyAt;
    c.restUntil = q.readyAt;
    c.lastRecovery = q.readyAt;
    c.blockYearOf = yearOf(q.readyAt);
    c.blocks = [{ from: g.now, to: q.readyAt, why: 'joining' }];
    g.crew[c.id] = c;
    g.hires.push({ id: nextId(g, 'h'), role: r.role, family: r.family, base: r.base, crewId: c.id, ordered: g.now, ready: q.readyAt, cost: q.cost / n });
    schedule(g, q.readyAt, 'crew.join', c.id);
    crewIds.push(c.id);
  }
  post(g, 'hiring', -q.cost);
  return { ok: true, msg: `${n} ${ROLE_NAME[r.role]}${n > 1 ? 's' : ''} joining ${fmtDate(q.readyAt)}`, data: { crewIds } };
}

const TRAINING: Record<TrainingKind, (c: CrewMember) => { days: number; cost: number }> = {
  typeRating: (c) => (isPilot(c.role) ? { days: BAL.typeRating.pilotDays, cost: BAL.typeRating.pilotCost } : { days: BAL.typeRating.cabinDays, cost: BAL.typeRating.cabinCost }),
  conversion: (c) => (isPilot(c.role) ? { days: BAL.conversion.pilotDays, cost: BAL.conversion.pilotCost } : { days: BAL.conversion.cabinDays, cost: BAL.conversion.cabinCost }),
  command: () => ({ days: BAL.commandUpgrade.days, cost: BAL.commandUpgrade.cost }),
  sccm: () => ({ days: BAL.sccmCourse.days, cost: BAL.sccmCourse.cost }),
};

/** Type rating, command upgrade, SCCM course or conversion: status 'training' until done (rostered work is re-crewed). */
export function trainCrew(g: GameState, crewId: string, kind: TrainingKind, family: RatingFamily): ActionResult {
  const c = g.crew[crewId];
  if (!c) return { ok: false, error: 'Crew member not found' };
  if (c.status === 'training' || c.status === 'joining' || c.status === 'sick') return { ok: false, error: `${crewName(c)} is ${c.status}` };
  if (kind === 'typeRating' || kind === 'conversion') {
    if (c.ratings.includes(family)) return { ok: false, error: 'Already rated' };
    if (!isPilot(c.role) && c.ratings.length >= 3) return { ok: false, error: 'Cabin crew hold at most 3 types' };
    if (kind === 'conversion' && !c.ratings.length) return { ok: false, error: 'Conversion needs an existing rating' };
  }
  if (kind === 'command') {
    if (c.role !== 'FO') return { ok: false, error: 'Only first officers upgrade to captain' };
    if (c.totalHours < BAL.commandUpgrade.minHours) return { ok: false, error: `Needs ${BAL.commandUpgrade.minHours.toLocaleString('en-US')} h (has ${Math.round(c.totalHours).toLocaleString('en-US')})` };
  }
  if (kind === 'sccm' && c.role !== 'CC') return { ok: false, error: 'Only cabin crew take the SCCM course' };
  const { days, cost } = TRAINING[kind](c);
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
export function crewAvailability(g: GameState, family: RatingFamily, typeId: string, from: Minute, to: Minute, programmeBH: number): Availability {
  const days = Math.max(1, Math.ceil((to - from) / DAY));
  const t = typeOf(typeId);
  const seats = t.cabins[0] ? t.cabins[0].j + t.cabins[0].w + t.cabins[0].y : 180;
  const per = countRoles(complement(typeId, seats, { extraCabin: g.company.policies.extraCabin }));
  const need = sizing(per, programmeBH / Math.max(1, days / 30.44));
  // Supply per role and day (exact role; seniors spill down below).
  const supply: Record<Role, Int32Array> = Object.fromEntries(ROLES.map((r) => [r, new Int32Array(days)])) as Record<Role, Int32Array>;
  const ix = crewIx(g);
  for (const c of Object.values(g.crew)) {
    if (!c.ratings.includes(family)) continue;
    const off = new Uint8Array(days);
    const mark = (a: Minute, b: Minute) => {
      for (let d = Math.max(0, Math.floor((a - from) / DAY)); d < days && from + d * DAY < b; d++) off[d] = 1;
    };
    for (const b of c.blocks ?? []) mark(b.from, b.to);
    for (const p of ix.pairingsOf.get(c.id) ?? []) if (!p.contractId && p.status !== 'done') mark(p.start, p.end);
    if (block28(segsOf(g, c), from) > 90 * 60) mark(from, from + 7 * DAY);
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
      let blk = 0;
      for (const f of Object.values(g.flights)) if (f.contractId === k.id && f.aircraftId && f.status !== 'cancelled') blk += f.block;
      bhMonth = blk / 60 / Math.max(1, (k.end - k.start) / DAY / 30.44);
    }
    const kPer = countRoles(complement(ac[0].typeId, ac[0].cabin.total, { extraCabin: g.company.policies.extraCabin + k.requirements.extraCabin }));
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
    // Spill seniors down: FO → CRP, CSD → SCC → CC.
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
    spill('CSD', 'SCC');
    spill('CSD', 'CC');
    spill('SCC', 'CC');
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
  have: number;
  need: number;
}

/** Staffing vs need (BAL.crewSetsPerAircraft complements per aircraft of the family) for the Crew screen. */
export function staffing(g: GameState): StaffingLine[] {
  const fams = new Map<RatingFamily, { typeId: string; seats: number; n: number }>();
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'leasedOut') continue;
    const f = typeOf(ac.typeId).family;
    const cur = fams.get(f);
    if (cur) cur.n++;
    else fams.set(f, { typeId: ac.typeId, seats: ac.cabin.total, n: 1 });
  }
  const out: StaffingLine[] = [];
  for (const [family, x] of fams) {
    const per = countRoles(complement(x.typeId, x.seats, { extraCabin: g.company.policies.extraCabin }));
    for (const r of ROLES) {
      if (!per[r]) continue;
      const have = Object.values(g.crew).filter((c) => c.role === r && c.ratings.includes(family)).length;
      out.push({ family, role: r, have, need: per[r]! * BAL.crewSetsPerAircraft * x.n });
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
  const c = g.crew[item.crewId];
  if (!c) return;
  if (item.kind === 'typeRating' || item.kind === 'conversion') {
    if (!c.ratings.includes(item.family)) c.ratings.push(item.family);
  } else if (item.kind === 'command') c.role = 'CPT';
  else if (item.kind === 'sccm') c.role = 'SCC';
  const wide = c.ratings.find((f) => salaryFor(c.role, f) !== salaryFor(c.role, 'A320'));
  c.salary = salaryFor(c.role, wide ?? c.ratings[0] ?? 'A320');
  clearBlock(c, 'training');
  if (c.status === 'training') c.status = 'available';
  const what = item.kind === 'command' ? 'command upgrade' : item.kind === 'sccm' ? 'SCCM course' : `${item.family} ${item.kind === 'conversion' ? 'conversion' : 'type rating'}`;
  pushMessage(g, { tone: 'good', cat: 'crew', title: `${crewName(c)} finished training`, body: `Completed the ${what}.`, ref: { kind: 'crew', id: c.id } });
  touchCrew(g);
}

/**
 * Daily sickness roll: p = 0.04/30 × (1 + max(0, 60 − morale)/100); sick for 2–5 days, taken off rostered work.
 * A slot that can't be refilled becomes a B3 'sickCrew' decision.
 */
export function dailySickness(g: GameState): void {
  for (const c of Object.values(g.crew)) {
    if (c.status === 'sick' || c.status === 'joining' || c.status === 'training' || c.status === 'leave' || c.status === 'onDuty') continue;
    if (c.blocks?.some((b) => b.why === 'sick' && b.to > g.now)) continue;
    const p = (BAL.sickPerMonth / 30) * (1 + Math.max(0, 60 - c.morale) / 100);
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
