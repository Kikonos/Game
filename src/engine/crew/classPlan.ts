// v0.23 Class planner (the player: "build a tool that would help me schedule classes with as many people as possible at
// the best time possible without disrupting the roster too much. It has to be a balancing act. I don't want too many
// different classes with a few people, but I don't want full classes with massive roster disruption either").
//
// For one target type and one group (cabin crew or pilots) it proposes a set of classes: when each runs and who is in
// it. One control slides between "fewer, bigger classes" (stop 0) and "least roster disruption" (stop 4):
// - each person's cost on a start day is the rostered duties in the way of the course (the day before to its end);
//   leave, sickness and a join date in the way make the day impossible for them (a booked holiday is never moved);
// - a class is worth its people, less a price per class, per duty moved and per day waited; the prices move with the
//   slider (fewer, bigger: a class is dear and a duty cheap; least disruption: the other way round), and the best
//   class is placed again and again until everyone has a seat or nothing fits;
// - beyond the published roster nothing is in the way yet, so the crew forecast (crew/forecast.ts: the signed work's
//   crew-days against the crew's) caps how many of a rank may be away in a week; a rating given up for good (pilots
//   leave the old type when the course starts, cabin crew at three types the one they drop) is also held against the
//   fleet's changes for a year (an aircraft back from a dry lease, a lease that ends): nobody leaves a type that still
//   needs them, so a phase-out is paced by the aircraft leaving;
// - the result is then booked on a copy of the game through the real conversion and the real roster (the dry run Crew
//   Control uses): a flight the run leaves short sends the person whose duty it was to another class or out of the
//   plan, and the run is repeated; what the dry run shows (duties re-crewed, flights short, tickets) is the balance.
// Booking a proposal is startConversion per class, so classes are the same game entities as a conversion booked by
// hand (training blocks, the fees on the 'training' ledger line, the Inbox note, refunds, the Classes list).
// Read APIs are pure and deterministic.
//
// Also here: "Remove type rating" for cabin crew (the player: "for the phase-out, I want the ability to remove a type
// rating from the cabin crew so it opens a slot for another type rating, since they can have 3").

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { pushMessage } from '../core/messages';
import { complement, isPilot, typeOf } from '../core/perf';
import { DAY, fmtDay, fmtDayAt } from '../core/time';
import type { ActionResult, CrewMember, GameState, Minute, Pairing, Role } from '../core/types';
import { lockOf } from '../scenario/rules';
import { previewCopy } from './atomic';
import { ccqKeeps, classOf, classPhases, classStartFor, conversionClasses, conversionEarliest, conversionPlan, courseOf, dropChoices, ratingsLost, startConversion } from './conversion';
import { rosterHorizon } from './dayPlan';
import { crewDays, familyWord, PEAK, workDays } from './forecast';
import { crewName, crewPay } from './generate';
import { staffing, staffingAssign } from './hr';
import { fillAll, flightCrewStatus, emptyResult, recheckPairing, releaseCrew, rosterOf } from './roster';
import { awayOnDryLease, familyNeeds } from './sets';
import { crewRev, touchCrew, typeIdOf } from './timeline';

type Group = 'pilot' | 'cabin';
type Course = 'full' | 'ccq';

/** The planner's numbers. Stops run 0 (fewer, bigger classes) … 4 (least roster disruption). */
export const CLASS_PLAN = {
  /** Class sizes: cabin crew in one room with the door trainer and the slide (8–16), pilots in simulator pairs (4–8). */
  max: { cabin: 16, pilot: 8 } as Record<Group, number>,
  /** The smallest class worth running, by stop (a request for fewer people runs as one class all the same). */
  min: { cabin: [8, 6, 4, 3, 2], pilot: [4, 4, 2, 2, 2] } as Record<Group, number[]>,
  stops: 5,
  /** By stop, in people: the price of one class (a share of a full class), of one rostered duty moved and of one day waited. */
  klass: [0.6, 0.45, 0.3, 0.2, 0.1],
  duty: [0.02, 0.1, 0.25, 0.5, 1000],
  wait: [0.06, 0.04, 0.03, 0.02, 0.01],
  maxClasses: 10,
  /** Fleet changes looked at for a rating given up for good (days). */
  lookDays: 365,
  /** Dry runs at most (each sends the people whose duty stayed open elsewhere). */
  rounds: 8,
};

export interface ClassPlanRequest {
  family: RatingFamily;
  group: Group;
  /** Who (default: everyone of the group who can take the course). */
  crewIds?: string[];
  /** The last class ends by this minute (null: no date). */
  by?: Minute | null;
  /** 0 fewer, bigger classes … 4 least roster disruption. */
  balance: number;
  /** The player's own moves: a person into the class that starts on that day, or out of the plan. */
  pins?: Record<string, Minute | 'out'>;
  /** v0.23.1 cabin crew at three types: the type each gives up, as the player chose (default: dropDefaultFor). */
  drops?: Record<string, RatingFamily>;
}

export interface PlannedClass {
  /** 'B767-C1' (as it will be booked). */
  no: string;
  group: Group;
  course: Course;
  start: Minute;
  end: Minute;
  crewIds: string[];
  fees: number;
  /** Rostered duties of its people in the way (the day before to the end). */
  duties: number;
  phases: { label: string; from: Minute; to: Minute }[];
}

export interface NextClass { group: Group; course: Course; start: Minute; end: Minute; crewIds: string[]; bookFrom: Minute }

export interface FleetChange { at: Minute; delta: 1 | -1; reg: string; what: 'arrives' | 'back from dry lease' | 'lease ends' | 'sold' }

export interface ClassProposal {
  family: RatingFamily;
  group: Group;
  balance: number;
  by: Minute | null;
  classes: PlannedClass[];
  /** People asked for and not in a class, each with the reason in plain words. */
  leftOut: { crewId: string; why: string }[];
  asked: number;
  trained: number;
  /** Rostered duties in the way of the classes; the dry run hands them to others. */
  duties: number;
  /** Flights the dry run leaves short that are crewed today ('XY3040 24 Jun'). Empty unless the player's own moves force it. */
  short: string[];
  /** Weeks beyond the published roster the forecast shows short with these classes ('13 Jul: 737 pursers'). */
  thin: string[];
  fees: number;
  /** What the dry run spent beyond the course fees (tickets for the people who take over, days off bought back). */
  extra: number;
  first: Minute | null;
  finish: Minute | null;
  /** The last class ends after `by`. */
  late: boolean;
  /** Per person in a class: the duties in their way, and the rating a cabin crew member at three types gives up. */
  people: Record<string, { duties: number; drop?: RatingFamily; pinned?: true }>;
  /** v0.23.1 everyone asked for at three types (in a class or not): the type they give up at the end of the course. */
  drops: Record<string, RatingFamily>;
  /** Fleet facts the pacing used ('737 needs 8 captains from 12 Aug: CS-TDB back from dry lease'). */
  pace: string[];
  warnings: { level: 'warn' | 'bad'; text: string }[];
  ok: boolean;
  /**
   * v0.23.1 classes that can't be booked yet (more than the booking window ahead: a phase-out paced by the aircraft
   * leaving, in instalments): when each would run, who is in it, and the first day it can be booked. Their people are
   * not in `leftOut`.
   */
  next: NextClass[];
  /** For the month strip: the first possible start, the end of the published roster, the last start looked at. */
  earliest: Minute;
  rosterEnd: Minute;
  horizon: Minute;
}

const ROLE_ORDER: Role[] = ['CPT', 'FO', 'PUR', 'CC'];
const ROLE_PL: Record<Role, string> = { CPT: 'captains', FO: 'first officers', PUR: 'pursers', CC: 'cabin crew' };
const ROLE_ONE: Record<Role, string> = { CPT: 'captain', FO: 'first officer', PUR: 'purser', CC: 'cabin crew' };
const nRole = (n: number, r: Role) => `${n} ${n === 1 ? ROLE_ONE[r] : ROLE_PL[r]}`;
const groupOf = (c: CrewMember): Group => (isPilot(c.role) ? 'pilot' : 'cabin');
const stopOf = (b: number) => Math.min(CLASS_PLAN.stops - 1, Math.max(0, Math.round(b)));
/** The share of days a crew member works (the forecast's: 7 days off a month, 96 free days a year). */
const WORK_SHARE = 1 - Math.max(PEAK.offMonth / 30.44, PEAK.freeYear / 365);

// ---------- who, and the type's need ----------

/** Everyone of the group who could take the course onto `family` now (not rated on it, at work, not in a class), by rank. Pure. */
export function classCandidates(g: GameState, family: RatingFamily, group: Group): string[] {
  return Object.values(g.crew)
    .filter((c) => groupOf(c) === group && !c.ratings.includes(family) && !c.notice && !classOf(g, c.id) && !g.training.some((t) => t.crewId === c.id && t.end > g.now))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.id < b.id ? -1 : 1))
    .map((c) => c.id);
}

/** The aircraft of a family that need our crews today, and the changes known ahead (a year), in time order. Pure. */
export function fleetChanges(g: GameState, family: RatingFamily): { now: number; changes: FleetChange[] } {
  let now = 0;
  const changes: FleetChange[] = [];
  const until = g.now + CLASS_PLAN.lookDays * DAY + 60 * DAY;
  for (const ac of Object.values(g.fleet).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (typeOf(ac.typeId).family !== family || ac.status === 'stored') continue;
    const away = awayOnDryLease(g, ac);
    if (away) {
      const k = Object.values(g.contracts).find((x) => x.dry && (x.status === 'signed' || x.status === 'active') && x.aircraftIds.includes(ac.id));
      if (k && k.end > g.now && k.end < until) changes.push({ at: k.end, delta: 1, reg: ac.reg, what: 'back from dry lease' });
    } else {
      now++;
    }
    const gone = ac.sale ? { at: ac.sale.closes, what: 'sold' as const } : ac.ownership.kind === 'dryLeaseIn' ? { at: ac.ownership.leaseEnd, what: 'lease ends' as const } : null;
    if (gone && gone.at > g.now && gone.at < until) changes.push({ at: gone.at, delta: -1, reg: ac.reg, what: gone.what });
  }
  for (const d of g.leasing?.deals ?? []) {
    if (d.aircraftId || (d.stage !== 'approved' && d.stage !== 'signed' && d.stage !== 'conditions') || typeOf(d.offer.typeId).family !== family) continue;
    const at = (d.signedAt ?? d.signBy ?? g.now) + (d.offer.leadDays ?? 60) * DAY;
    if (at < until) changes.push({ at: Math.max(at, g.now + 1), delta: 1, reg: d.opts?.reg ?? `the ${typeOf(d.offer.typeId).short}`, what: 'arrives' });
  }
  changes.sort((a, b) => a.at - b.at || (a.reg < b.reg ? -1 : 1));
  // A dry-leased aircraft that is sold or handed back while away never needs our crews again.
  return { now, changes };
}

/** The first aircraft of the family still on its way to us ('delivering'): when it is ready to fly. Pure. */
export function nextArrival(g: GameState, family: RatingFamily): { at: Minute; reg: string } | null {
  let best: { at: Minute; reg: string } | null = null;
  for (const ac of Object.values(g.fleet).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (typeOf(ac.typeId).family !== family) continue;
    const pending = ac.status === 'delivering' || (ac.delivery && ac.delivery.arrived === undefined);
    if (!pending) continue;
    const at = ac.induction?.ready ?? ac.delivery?.handover ?? ac.deliveredAt;
    if (at > g.now && (!best || at < best.at)) best = { at, reg: ac.reg };
  }
  for (const c of fleetChanges(g, family).changes) if (c.what === 'arrives' && (!best || c.at < best.at)) best = { at: c.at, reg: c.reg };
  return best;
}

export interface ClassPlanNeed {
  /** Per rank of the group: counted on the target (rated, joining or in a class onto it), booked onto it, needed, short. */
  roles: { role: Role; have: number; booked: number; need: number; short: number }[];
  arrival: { at: Minute; reg: string } | null;
  /** 'Short 3 pursers and 20 cabin crew' / 'None short'. */
  text: string;
}

/** What the target type is short of in this group (the Planning card's numbers; people already booked onto it count as joiners). Pure. */
export function classPlanNeed(g: GameState, family: RatingFamily, group: Group): ClassPlanNeed {
  const lines = staffing(g).filter((l) => l.family === family && (isPilot(l.role) ? 'pilot' : 'cabin') === group);
  const booked = (r: Role) => conversionClasses(g).filter((k) => k.family === family).reduce((n, k) => n + k.crewIds.filter((id) => g.crew[id]?.role === r).length, 0);
  const roles = lines.map((l) => {
    const b = booked(l.role);
    // (People booked onto the type the old type can spare are in `have` already, as joiners: sets.ts crewSupply.)
    return { role: l.role, have: l.have, booked: b, need: l.need, short: Math.max(0, l.need - l.have - (l.covered ?? 0)) };
  });
  const short = roles.filter((r) => r.short > 0);
  const text = short.length ? `Short ${short.map((r) => nRole(r.short, r.role)).join(' and ')}` : roles.length ? 'None short' : 'No aircraft of this type';
  return { roles, arrival: nextArrival(g, family), text };
}

// ---------- facts the search reads ----------

interface Person {
  id: string;
  role: Role;
  course: Course;
  days: number;
  /** Not-done rostered duties: [report, release]. */
  duties: [Minute, Minute, string][];
  /** v0.23.1 those on the type they give up (at three types): after the course they go to others too. */
  dropDuties: [Minute, Minute, string][];
  /** Blocks that make a class impossible (leave, sickness, joining). */
  blocks: [Minute, Minute][];
  /** The family the forecast counts them in. */
  home: RatingFamily | null;
  /** Ratings the course ends for good. */
  lost: RatingFamily[];
  drop?: RatingFamily;
  /** Even spread of the ranks through the pool (ties). */
  order: number;
  /** inWay's answers by class start. */
  way: Map<number, string[]>;
  /** Keys of their fleet and rank ('B737:CC'), its cabin ranks, and whether the course ends that rating. */
  hk: string;
  hkCC: string;
  hkPUR: string;
  losesHome: boolean;
}

interface Week { from: Minute; to: Minute; margin: Map<string, number> }

/** Per week from `from`: the crew-days each family and rank has beyond the signed work (the forecast's need and supply). */
function weekMargins(g: GameState, from: Minute, n: number): Week[] {
  const sby = BAL.v073.standby.perFamily;
  const out: Week[] = [];
  for (let j = 0; j < n; j++) {
    const a = from + j * 7 * DAY;
    const b = a + 7 * DAY;
    const need = workDays(g, a, b);
    const have = crewDays(g, a, b);
    const margin = new Map<string, number>();
    for (const [f, h] of have) {
      const w = need.get(f);
      for (const r of ROLE_ORDER) margin.set(`${f}:${r}`, h[r] - (w && w[r] > 0 ? (w[r] + (sby[r] ?? 0) * 7) / PEAK.packing : 0));
    }
    out.push({ from: a, to: b, margin });
  }
  return out;
}

/** Crew per aircraft of a family and rank (the Planning view's need; an idle family: a full complement × the sets per aircraft). */
function perAircraft(g: GameState, family: RatingFamily): Partial<Record<Role, number>> {
  const f = familyNeeds(g).get(family);
  const out: Partial<Record<Role, number>> = {};
  if (f && f.aircraft > 0) {
    for (const r of ROLE_ORDER) if (f.need[r]) out[r] = f.need[r]! / f.aircraft;
    return out;
  }
  const ac = Object.values(g.fleet).find((a) => typeOf(a.typeId).family === family);
  if (!ac) return out;
  for (const r of complement(ac.typeId, ac.cabin.total)) out[r] = (out[r] ?? 0) + BAL.crewSetsPerAircraft;
  return out;
}

/**
 * The most a family needs of a rank from t on (a year), and the fleet change behind it: the aircraft that raises the
 * need (back from a dry lease, arriving), else the first one to leave (the need holds until then), else null.
 */
function needFrom(family: RatingFamily, role: Role, t: Minute, fc: { now: number; changes: FleetChange[] }, per: Partial<Record<Role, number>>): { need: number; why: FleetChange | null } {
  let n = fc.now;
  for (const c of fc.changes) if (c.at <= t) n += c.delta;
  let peak = n;
  let why: FleetChange | null = null;
  for (const c of fc.changes) {
    if (c.at <= t || c.at > t + CLASS_PLAN.lookDays * DAY) continue;
    n += c.delta;
    if (n > peak) {
      peak = n;
      why = c;
    }
  }
  if (!why) why = fc.changes.find((c) => c.at > t && c.delta < 0) ?? null;
  void family;
  return { need: Math.ceil(Math.max(0, peak) * (per[role] ?? 0) - 1e-9), why };
}

const overlap = (a: Minute, b: Minute, c: Minute, d: Minute) => Math.max(0, Math.min(b, d) - Math.max(a, c));

interface Slot { start: Minute; len: number; course: Course; ids: string[] }

interface Search {
  g: GameState;
  req: ClassPlanRequest;
  group: Group;
  people: Map<string, Person>;
  earliest: Minute;
  rosterEnd: Minute;
  lastEnd: Minute;
  weeks: Week[];
  fleets: Map<RatingFamily, { fc: { now: number; changes: FleetChange[] }; per: Partial<Record<Role, number>>; have: Partial<Record<Role, number>> }>;
  /** Per fleet and rank ('B737:PUR'): the people counted there with the days they are away anyway, and the number its sets need at work. */
  floors: Map<string, { here: Int16Array; need: number; at: Int16Array }>;
  /** Days looked at from `earliest` (the floors' arrays). */
  nDays: number;
  /** Candidate class starts per course (the same at every stop). */
  starts: Map<Course, Minute[]>;
  /** rankAt's lists (the same at every stop). */
  rank: Map<string, { p: Person; n: number }[]>;
  /** v0.23.1 the search for the classes that can't be booked yet (`far`): from this start on, beside the classes of the plan (`fixed`), these people only. */
  far?: { from: Minute; fixed: Slot[]; only: Set<string> };
  /** Duties the dry run found nobody for, per person. */
  open: Map<string, Set<string>>;
  banned: Set<string>;
  why: Map<string, string>;
}

/** Rostered duties of a person in the way of a class [start, start + len): from the day before. Kept per person and day (every stop asks again). */
function inWay(p: Person, start: Minute, len: number): string[] {
  const key = start * 64 + (len / DAY);
  const seen = p.way.get(key);
  if (seen) return seen;
  const out: string[] = [];
  for (const [a, b, id] of p.duties) if (b > start - DAY && a < start + len) out.push(id);
  for (const [a, , id] of p.dropDuties) if (a >= start + len) out.push(id);
  p.way.set(key, out);
  return out;
}

const blockedAt = (p: Person, start: Minute, len: number): boolean => p.blocks.some(([a, b]) => a < start + len && b > start - DAY);

/** What the people in the plan take from their fleets: heads per day, crew-days per forecast week, ratings given up for good. */
interface Usage {
  day: Map<string, Int16Array>;
  week: Map<string, Float64Array>;
  lost: Map<string, number>;
  /** While a class is tried on it: what to put back (old values, keys added), so it is used again as it was. */
  undo?: { cells: [Int16Array | Float64Array, number, number][]; keys: [Map<string, unknown>, string][]; lost: [string, number | undefined][] };
}

const newUsage = (): Usage => ({ day: new Map(), week: new Map(), lost: new Map() });
/** Starts trying a class on `u` (tryEnd puts it back). */
const tryOn = (u: Usage): Usage => ((u.undo = { cells: [], keys: [], lost: [] }), u);
/** Puts `u` back as it was before tryOn. */
function tryEnd(u: Usage): void {
  const x = u.undo;
  if (!x) return;
  for (let i = x.cells.length - 1; i >= 0; i--) x.cells[i][0][x.cells[i][1]] = x.cells[i][2];
  for (let i = x.lost.length - 1; i >= 0; i--) {
    const [k, v] = x.lost[i];
    if (v === undefined) u.lost.delete(k);
    else u.lost.set(k, v);
  }
  for (const [m, k] of x.keys) m.delete(k);
  u.undo = undefined;
}
function arrayOf<T extends Int16Array | Float64Array>(u: Usage, m: Map<string, T>, key: string, make: () => T): T {
  let a = m.get(key);
  if (!a) {
    m.set(key, (a = make()));
    u.undo?.keys.push([m as Map<string, unknown>, key]);
  }
  return a;
}
const dayIx = (s: Search, t: Minute) => Math.max(0, Math.round((t - s.earliest) / DAY));

/** Adds a person's class at `start` to the usage. */
function addUse(s: Search, u: Usage, p: Person, start: Minute): void {
  const len = p.days * DAY;
  const cells = u.undo?.cells;
  if (p.home) {
    const key = p.hk;
    const d = arrayOf(u, u.day, key, () => new Int16Array(s.nDays));
    const d0 = dayIx(s, start);
    for (let i = d0; i < Math.min(s.nDays, d0 + p.days); i++) {
      cells?.push([d, i, d[i]]);
      d[i]++;
    }
    const w = arrayOf(u, u.week, key, () => new Float64Array(s.weeks.length));
    const to = p.losesHome ? Infinity : start + len;
    for (let j = 0; j < s.weeks.length; j++) {
      // (A week the class does not touch adds nothing.)
      const o = overlap(s.weeks[j].from, s.weeks[j].to, start, to);
      if (o <= 0) continue;
      cells?.push([w, j, w[j]]);
      w[j] += (o / DAY) * WORK_SHARE;
    }
  }
  for (const f of p.lost) {
    const k = `${f}:${p.role}`;
    u.undo?.lost.push([k, u.lost.get(k)]);
    u.lost.set(k, (u.lost.get(k) ?? 0) + 1);
  }
}

/** The usage of every class placed so far. */
function usageOf(s: Search, slots: Slot[]): Usage {
  const u = newUsage();
  for (const k of slots) for (const id of k.ids) addUse(s, u, s.people.get(id)!, k.start);
  return u;
}

const CASH = 'Not enough cash for their course';

/** A refusal while searching (only whether, not why: the words are made for the left-out list alone). */
const NO = 'no';

/** May this person join a class at `start` beside the people in `u`: null, or why not (in plain words when `words`, for the left-out list). */
function refuse(s: Search, p: Person, start: Minute, u: Usage, words = false): string | null {
  const len = p.days * DAY;
  if (blockedAt(p, start, len)) return 'On leave or off sick in the class dates';
  const openIds = s.open.get(p.id);
  if (openIds && inWay(p, start, len).some((id) => openIds.has(id))) return 'Nobody free to take over their flights';
  if (p.home) {
    const key = p.hk;
    // Every day of the class, their fleet keeps the crew its sets need at work (people on leave or in a class are not).
    const fl = s.floors.get(key);
    if (fl && fl.need > 0) {
      const cc = p.hkCC;
      const pur = p.hkPUR;
      const fCC = s.floors.get(cc);
      const fPUR = s.floors.get(pur);
      const d0 = dayIx(s, start);
      const uKey = u.day.get(key);
      const uCC = u.day.get(cc);
      const uPUR = u.day.get(pur);
      const here = (i: number, k: string, f: { here: Int16Array } | undefined, used: Int16Array | undefined) => (f ? f.here[i] - (used?.[i] ?? 0) - (k === key ? 1 : 0) : 0);
      for (let i = d0; i < Math.min(s.nDays, d0 + p.days); i++) {
        if (p.role === 'CC' || p.role === 'PUR') {
          // Pursers beyond their own need fill cabin crew seats (as the sets).
          const hp = here(i, pur, fPUR, uPUR);
          const hc = here(i, cc, fCC, uCC);
          const np = fPUR ? fPUR.at[i] : 0;
          if (hp < np || hc + Math.max(0, hp - np) < (fCC ? fCC.at[i] : 0)) return words ? `The ${familyWord(p.home)} keeps ${nRole(fl.at[i], p.role)} at work` : NO;
        } else if (here(i, key, fl, uKey) < fl.at[i]) return words ? `The ${familyWord(p.home)} keeps ${nRole(fl.at[i], p.role)} at work` : NO;
      }
    }
    // The forecast beyond the published roster: the weeks this class takes them out of their fleet (for good when the rating goes).
    const to = p.losesHome ? Infinity : start + len;
    const used = u.week.get(key);
    const usedPur = p.role === 'CC' ? u.week.get(p.hkPUR) : undefined;
    for (let j = 0; j < s.weeks.length; j++) {
      const w = s.weeks[j];
      if (w.to <= s.rosterEnd || w.to <= start || w.from >= to) continue;
      const mine = (overlap(w.from, w.to, start, to) / DAY) * WORK_SHARE;
      let margin = w.margin.get(key) ?? 0;
      if (p.role === 'CC') margin += Math.max(0, (w.margin.get(p.hkPUR) ?? 0) - (usedPur?.[j] ?? 0));
      if ((used?.[j] ?? 0) + mine > margin + 1e-6) return words ? `The ${familyWord(p.home)} needs its ${ROLE_PL[p.role]} in the week of ${fmtDayAt(s.g.company.homeBase, w.from)}` : NO;
    }
  }
  // A rating given up for good: the fleet's need of it over the next year.
  const lossAt = s.group === 'pilot' ? start : start + len;
  for (const f of p.lost) {
    const fl = s.fleets.get(f);
    if (!fl) continue;
    const { need, why } = needFrom(f, p.role, lossAt, fl.fc, fl.per);
    const leaving = (u.lost.get(`${f}:${p.role}`) ?? 0) + 1;
    if ((fl.have[p.role] ?? 0) - leaving < need) return words ? `The ${familyWord(f)} needs ${nRole(need, p.role)}${why ? ` ${why.delta > 0 ? 'from' : 'until'} ${fmtDay(why.at)} (${why.reg} ${why.what})` : ''}` : NO;
  }
  return null;
}

/** May a class run on [start, start + len) beside the others: the centre's rules, both ways round. */
function slotFree(s: Search, start: Minute, len: number, slots: Slot[]): boolean {
  if (s.group === 'pilot') return slots.every((k) => Math.abs(k.start - start) >= BAL.conv.pilotStaggerDays * DAY);
  const hits = slots.filter((k) => k.start < start + len && k.start + k.len > start);
  if (hits.length >= BAL.conv.cabinParallel) return false;
  return hits.every((k) => slots.filter((x) => x !== k && x.start < k.start + k.len && x.start + x.len > k.start).length + 1 < BAL.conv.cabinParallel);
}

/** Pilots: captains and first officers in turn (simulator pairs); cabin: as ranked. */
function paired(s: Search, ids: string[]): string[] {
  if (s.group !== 'pilot') return ids;
  const cpt = ids.filter((id) => s.people.get(id)!.role === 'CPT');
  const fo = ids.filter((id) => s.people.get(id)!.role !== 'CPT');
  const out: string[] = [];
  for (let i = 0; i < Math.max(cpt.length, fo.length); i++) {
    if (i < cpt.length) out.push(cpt[i]);
    if (i < fo.length) out.push(fo[i]);
  }
  return out;
}

/** Everyone of a course free on a start day, fewest rostered duties in the way first (then spread through the ranks). Kept per search. */
function rankAt(s: Search, course: Course, start: Minute, len: number): { p: Person; n: number }[] {
  const key = `${course}:${start}`;
  let r = s.rank.get(key);
  if (!r) {
    r = [...s.people.values()]
      .filter((p) => p.course === course && !blockedAt(p, start, len))
      .map((p) => ({ p, n: inWay(p, start, len).length }))
      .sort((a, b) => a.n - b.n || a.p.order - b.p.order);
    s.rank.set(key, r);
  }
  return r;
}

/** One pass: the best class placed again and again. Returns the classes (people by id) and writes why the rest stay out. */
function place(s: Search): Slot[] {
  const st = stopOf(s.req.balance);
  const g = s.g;
  const max = CLASS_PLAN.max[s.group];
  const pins = s.req.pins ?? {};
  const far = s.far;
  const all = [...s.people.values()].filter((p) => (far ? far.only.has(p.id) : pins[p.id] !== 'out' && !s.banned.has(p.id)));
  const slots: Slot[] = [];
  // The classes beyond the booking window go beside the plan's own (the centre's room, the fleets' crew).
  const withFixed = (): Slot[] => (far ? [...far.fixed, ...slots] : slots);
  const left = new Set(all.map((p) => p.id));
  // The player's own moves first: each pinned person seeds (or joins) the class on that day.
  for (const p of all) {
    const pin = far ? undefined : pins[p.id];
    if (typeof pin !== 'number') continue;
    const len = p.days * DAY;
    let k = slots.find((x) => x.start === pin && x.course === p.course);
    if (!k) {
      if (classStartFor(g, s.group, pin, len) !== pin || !slotFree(s, pin, len, slots) || pin + len > s.lastEnd) continue;
      k = { start: pin, len, course: p.course, ids: [] };
      slots.push(k);
    }
    if (k.ids.length >= max || blockedAt(p, pin, len)) continue;
    k.ids.push(p.id);
    left.delete(p.id);
  }
  // Candidate start days per course (each as the centre would really start it beside the classes already booked).
  const daysOf = new Map<Course, { len: number; starts: Minute[] }>();
  for (const p of all) {
    if (daysOf.has(p.course)) continue;
    const len = p.days * DAY;
    // (The same at every stop: worked out once.)
    let starts = s.starts.get(p.course);
    if (!starts) {
      starts = [];
      // (Beyond the booking window a start a week: those classes are booked later, in instalments.)
      for (let t = far ? far.from : s.earliest; t + len <= s.lastEnd + DAY / 2; t += far ? 7 * DAY : DAY) {
        const d = classStartFor(g, s.group, t, len);
        if (d + len <= s.lastEnd && !starts.includes(d)) starts.push(d);
      }
      s.starts.set(p.course, starts);
    }
    daysOf.set(p.course, { len, starts });
  }
  const asked = all.length;
  const minSize = Math.min(CLASS_PLAN.min[s.group][st], asked);
  // The fees are paid at booking: the plan stays within the cash on hand.
  const feeOf = (c: Course) => courseOf(s.group, c, s.req.family).cost;
  const spent = () => slots.reduce((n, k) => n + k.ids.length * feeOf(k.course), 0);
  // Phase 1: new classes, evenly filled (the player's own classes count as started); phase 2: seats still free in them.
  const seeds = new Set(slots);
  for (let phase = 1; phase <= 2; phase++) {
    for (let guard = 0; guard < 200 && left.size; guard++) {
      let best: { v: number; k: Slot | null; start: Minute; len: number; course: Course; add: string[] } | null = null;
      const base = usageOf(s, withFixed());
      const cash = s.g.company.cash - spent();
      for (const [course, { len, starts }] of daysOf) {
        const pool = [...left].map((id) => s.people.get(id)!).filter((p) => p.course === course);
        // (Classes not bookable yet are paid when booked.)
        const afford = far ? Infinity : Math.floor(cash / feeOf(course) + 1e-9);
        if (!pool.length || afford < 1) continue;
        // The size a class takes of those still to place: as few classes as the room allows, evenly filled.
        const even = Math.ceil(pool.length / Math.ceil(pool.length / max));
        for (const start of starts) {
          const k = slots.find((x) => x.start === start && x.course === course) ?? null;
          if (phase === 1 && k && !seeds.has(k)) continue;
          if (phase === 2 && !k) continue;
          if (!k && (slots.length >= CLASS_PLAN.maxClasses || !slotFree(s, start, len, withFixed()))) continue;
          const room = Math.min(afford, k ? (phase === 1 ? Math.max(even, 1) : max) - k.ids.length : even);
          if (room <= 0) continue;
          // Those still to place, fewest duties in the way first (the order of everyone on that day, kept for every stop).
          const ranked = rankAt(s, course, start, len).filter((x) => left.has(x.p.id));
          const add: string[] = [];
          let moved = 0;
          const u = tryOn(base);
          for (const x of ranked) {
            if (add.length >= room) break;
            if (x.n * CLASS_PLAN.duty[st] >= 1) break;
            if (refuse(s, x.p, start, u)) continue;
            addUse(s, u, x.p, start);
            add.push(x.p.id);
            moved += x.n;
          }
          tryEnd(u);
          if (!add.length || (!k && add.length < minSize)) continue;
          const v = add.length - (k ? 0 : CLASS_PLAN.klass[st] * max) - moved * CLASS_PLAN.duty[st] - (k ? 0 : (CLASS_PLAN.wait[st] * (start - (far ? far.from : s.earliest))) / DAY);
          if (!best || v > best.v + 1e-9) best = { v, k, start, len, course, add };
        }
      }
      if (!best) break;
      const k = best.k ?? { start: best.start, len: best.len, course: best.course, ids: [] };
      if (!best.k) slots.push(k);
      if (best.k) seeds.delete(best.k);
      for (const id of best.add) {
        k.ids.push(id);
        left.delete(id);
      }
    }
  }
  // Why the rest stay out: the reason on the day that suits them best (not asked beyond the booking window).
  for (const id of far ? [] : left) {
    const p = s.people.get(id)!;
    const d = daysOf.get(p.course)!;
    let why = '';
    const free = d.starts.filter((t) => !blockedAt(p, t, d.len));
    if (s.g.company.cash - spent() < feeOf(p.course)) why = CASH;
    else if (!free.length) why = s.req.by ? `On leave or off sick until too late for ${fmtDay(s.req.by)}` : 'On leave or off sick in every class date';
    else {
      const u = usageOf(s, withFixed());
      const reasons = free.map((t) => refuse(s, p, t, u, true));
      const okDays = free.filter((_, i) => !reasons[i]);
      const seat = slots.find((k) => k.course === p.course && k.ids.length < max && okDays.includes(k.start));
      if (!okDays.length) why = reasons.find((x): x is string => !!x) ?? 'No class fits';
      else if (seat) {
        const n = inWay(p, seat.start, seat.len).length;
        why = n ? `${n === 1 ? 'A duty' : `${n} duties`} in the way of every class` : 'No class fits';
      } else if (!okDays.some((t) => slotFree(s, t, d.len, withFixed()))) why = 'No room at the training centre in time';
      else why = 'Would need a small class of their own';
    }
    s.why.set(id, why);
  }
  for (const k of slots) k.ids = paired(s, k.ids.sort((a, b) => s.people.get(a)!.order - s.people.get(b)!.order));
  return slots.filter((k) => k.ids.length).sort((a, b) => a.start - b.start || (a.course < b.course ? -1 : 1));
}

// ---------- the dry run ----------

/** Flights inside the published roster that are short of crew (or illegal) now. */
function shortFlights(g: GameState, until: Minute): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || f.kind === 'deadhead' || !f.aircraftId || f.std < g.now || f.std >= until) continue;
    const lv = flightCrewStatus(g, f.id, { live: false }).level;
    if (lv === 'missing' || lv === 'illegal') out.add(f.id);
  }
  return out;
}

/**
 * A dry run, kept small: the classes as booked, what it cost and the flights it left short, with whose seat each one
 * was (the copy of the game itself is let go: a dry run is tried again at other stops and in other requests).
 */
interface Tried {
  classes: { no: string; group: Group; course: Course; start: Minute; end: Minute; crewIds: string[]; costPerHead: number }[];
  errors: string[];
  cash: number;
  /** Flights left short that were crewed before, in the order the run found them. */
  newShort: string[];
  /** Per such flight: its number and time, its duty, the trip's duties and who left its empty seats. */
  flights: Map<string, { no: string; std: Minute; dutyId: string | null; tripDuties: string[]; left: string[] }>;
}

/** Books these classes on `h` through the real conversion (training blocks, fees, the roster run for their duties). */
function bookOn(h: GameState, family: RatingFamily, classes: { start: Minute; crewIds: string[] }[], drop?: Record<string, RatingFamily>): { classIds: string[]; errors: string[] } {
  const classIds: string[] = [];
  const errors: string[] = [];
  for (const k of [...classes].sort((a, b) => a.start - b.start)) {
    const r = startConversion(h, { crewIds: k.crewIds, family, start: k.start, drop });
    if (r.ok) classIds.push(...r.data!.classIds);
    else errors.push(r.error ?? 'Not booked');
  }
  return { classIds, errors };
}

/** The dry run of these classes on a copy of `g`, summed up (Tried). */
function dryRun(g: GameState, family: RatingFamily, slots: Slot[], drop: Record<string, RatingFamily>, rosterEnd: Minute, before: Set<string>): Tried {
  const h = previewCopy(g);
  const run = bookOn(h, family, slots.map((k) => ({ start: k.start, crewIds: k.ids })), drop);
  const classes: Tried['classes'] = [];
  for (const id of run.classIds) {
    const k = h.classes?.[id];
    if (k) classes.push({ no: k.no, group: k.group, course: k.course, start: k.start, end: k.end, crewIds: [...k.crewIds], costPerHead: k.costPerHead });
  }
  const newShort = [...shortFlights(h, rosterEnd)].filter((id) => !before.has(id));
  const flights: Tried['flights'] = new Map();
  for (const fid of newShort) {
    const f = h.flights[fid];
    if (!f) continue;
    const d = h.duties[f.dutyId ?? ''];
    const p: Pairing | undefined = d ? h.pairings[d.pairingId] : undefined;
    const left: string[] = [];
    for (const seat of p?.slots ?? []) if (!seat.crewId && seat.left?.crewId) left.push(seat.left.crewId);
    flights.set(fid, { no: f.no, std: f.std, dutyId: d ? d.id : null, tripDuties: p ? [...p.dutyIds] : [], left });
  }
  return { classes, errors: run.errors, cash: h.company.cash, newShort, flights };
}

/**
 * Dry runs kept between requests on the same game (the player moving the finish date or a person back and forth tries
 * the same classes again): by the state they were run on, at most RUNS_KEPT.
 */
const RUNS_KEPT = 64;
const kept = new WeakMap<GameState, { stamp: string; runs: Map<string, Tried> }>();
function runsOf(g: GameState): Map<string, Tried> {
  const stamp = `${g.now}|${crewRev(g)}|${g.company.cash}|${Object.keys(g.classes ?? {}).length}|${Object.keys(g.pairings).length}|${Object.keys(g.flights).length}|${g.messages.length}`;
  let k = kept.get(g);
  if (!k || k.stamp !== stamp) kept.set(g, (k = { stamp, runs: new Map() }));
  return k.runs;
}

const homeKeys = (home: RatingFamily | null, role: Role, lost: RatingFamily[]) => ({ hk: `${home}:${role}`, hkCC: `${home}:CC`, hkPUR: `${home}:PUR`, losesHome: !!home && lost.includes(home) });

function people(g: GameState, req: Omit<ClassPlanRequest, 'balance'>, ids: string[]): { map: Map<string, Person>; skipped: { crewId: string; why: string }[] } {
  // (Asked at the far end of the booking window: a joiner who arrives before then can still take a later class.)
  const plan = conversionPlan(g, { crewIds: ids, family: req.family, start: g.now + BAL.conv.maxAheadDays * DAY }, { quick: true });
  const skip = new Map(plan.skipped.map((x) => [x.crewId, x.why]));
  const { homeOf } = staffingAssign(g);
  const map = new Map<string, Person>();
  const skipped: { crewId: string; why: string }[] = [];
  const perRole = new Map<Role, number>();
  const seenRole = new Map<Role, number>();
  const ok = ids.filter((id) => g.crew[id] && !skip.has(id) && groupOf(g.crew[id]) === req.group);
  for (const id of ok) perRole.set(g.crew[id].role, (perRole.get(g.crew[id].role) ?? 0) + 1);
  for (const id of ids) {
    const c = g.crew[id];
    if (!c || groupOf(c) !== req.group) continue;
    if (skip.has(id)) {
      skipped.push({ crewId: id, why: skip.get(id)! });
      continue;
    }
    const course: Course = ccqKeeps(c, req.family) ? 'ccq' : 'full';
    const days = courseOf(req.group, course, req.family).days;
    // v0.23.1 the type given up at three types: the player's choice, else the default (the one with no aircraft, being
    // phased out or flown least: conversion.ts dropDefaultFor).
    const want = req.drops?.[id];
    const drop = req.group === 'cabin' && c.ratings.length >= 3 ? (want && dropChoices(c, req.family).includes(want) ? want : plan.dropDefault[id]) : undefined;
    const rostered = rosterOf(g, id, g.now, Infinity).filter((d) => !d.done);
    const lost = req.group === 'pilot' ? ratingsLost(c, { group: 'pilot', course, family: req.family }) : drop ? [drop] : [];
    const i = seenRole.get(c.role) ?? 0;
    seenRole.set(c.role, i + 1);
    const joins = c.status === 'joining' ? g.hires.find((x) => x.crewId === id)?.ready ?? c.hired : null;
    map.set(id, {
      id, role: c.role, course, days,
      duties: rostered.map((d) => [d.report, d.release, d.id]),
      dropDuties: drop ? rostered.filter((d) => { const q = g.pairings[d.pairingId]; return !!q?.aircraftId && typeOf(typeIdOf(g, q)).family === drop; }).map((d) => [d.report, d.release, d.id]) : [],
      blocks: [...(c.blocks ?? []).filter((b) => b.to > g.now).map((b) => [b.from, b.to] as [Minute, Minute]), ...(joins && joins > g.now ? [[g.now, joins + DAY] as [Minute, Minute]] : [])],
      home: homeOf.get(id)?.[0] ?? null, lost, drop,
      order: (i + 0.5) / (perRole.get(c.role) ?? 1),
      way: new Map(),
      ...homeKeys(homeOf.get(id)?.[0] ?? null, c.role, lost),
    });
  }
  return { map, skipped };
}

interface Prep {
  ids: string[];
  map: Map<string, Person>;
  skipped: { crewId: string; why: string }[];
  earliest: Minute;
  rosterEnd: Minute;
  horizon: Minute;
  by: Minute | null;
  lastEnd: Minute;
  fleets: Search['fleets'];
  floors: Search['floors'];
  nDays: number;
  weeks: Week[];
  before: Set<string>;
  /** Dry runs by the classes tried (every stop reads them). */
  runs: Map<string, Tried>;
  starts: Map<Course, Minute[]>;
  rank: Search['rank'];
  /** Beyond the booking window (made when first needed): its weeks and days, the last end looked at, its starts. */
  far?: { weeks: Week[]; floors: Search['floors']; nDays: number; lastEnd: Minute; starts: Map<Course, Minute[]> } | null;
}

/**
 * Who is at work in each fleet and rank, day by day from `earliest`: everyone the Planning view counts there, less leave,
 * sickness, joiners still to come and classes already booked.
 */
function floorsOf(g: GameState, earliest: Minute, nDays: number): Search['floors'] {
  const floors: Search['floors'] = new Map();
  const { lines, homeOf } = staffingAssign(g);
  // v0.23.1 the need on each day: today's, less what the aircraft leaving by then took with them (a phase-out; never
  // more than today's: an aircraft coming back is the forecast's to weigh).
  const fleetNow = new Map<RatingFamily, { now: number; changes: FleetChange[] }>();
  for (const l of lines) {
    let fc = fleetNow.get(l.family);
    if (!fc) fleetNow.set(l.family, (fc = fleetChanges(g, l.family)));
    const at = new Int16Array(nDays).fill(l.need);
    if (fc.now > 0 && fc.changes.some((c) => c.delta < 0)) {
      for (let i = 0; i < nDays; i++) {
        const t = earliest + i * DAY + DAY / 2;
        let n = fc.now;
        for (const c of fc.changes) if (c.at <= t) n += c.delta;
        at[i] = Math.min(l.need, Math.ceil((l.need * Math.max(0, n)) / fc.now - 1e-9));
      }
    }
    floors.set(`${l.family}:${l.role}`, { here: new Int16Array(nDays), need: l.need, at });
  }
  for (const c of Object.values(g.crew)) {
    const f = homeOf.get(c.id)?.[0];
    const fl = f ? floors.get(`${f}:${c.role}`) : undefined;
    if (!fl) continue;
    const joins = c.status === 'joining' ? g.hires.find((x) => x.crewId === c.id)?.ready ?? c.hired : null;
    const away: [Minute, Minute][] = [...(c.blocks ?? []).map((b) => [b.from, b.to] as [Minute, Minute]), ...(joins && joins > g.now ? [[g.now, joins] as [Minute, Minute]] : []), ...(c.notice ? [[c.notice.leaves, Infinity] as [Minute, Minute]] : [])];
    for (let i = 0; i < nDays; i++) {
      const at = earliest + i * DAY + DAY / 2;
      if (!away.some(([a, b]) => a <= at && b > at)) fl.here[i]++;
    }
  }
  return floors;
}

/** The search beyond the booking window (a year ahead, or to the date asked), made once per request; null when nothing fits there. */
function farOf(g: GameState, prep: Prep): NonNullable<Prep['far']> | null {
  if (prep.far !== undefined) return prep.far;
  const longest = Math.max(1, ...[...prep.map.values()].map((p) => p.days));
  const lastEnd = Math.min(g.now + CLASS_PLAN.lookDays * DAY, prep.by ?? Infinity);
  if (lastEnd < prep.horizon + longest * DAY) return (prep.far = null);
  const nDays = Math.ceil((lastEnd - prep.earliest) / DAY) + 14;
  return (prep.far = { weeks: weekMargins(g, prep.earliest, Math.ceil(nDays / 7)), floors: floorsOf(g, prep.earliest, nDays), nDays, lastEnd, starts: new Map() });
}

/** What every stop of the slider reads: the people, the forecast's weeks, the fleet's changes, the flights short today. */
function prepare(g: GameState, req: Omit<ClassPlanRequest, 'balance'>): Prep {
  const ids = [...new Set(req.crewIds ?? classCandidates(g, req.family, req.group))];
  const { map, skipped } = people(g, req, ids);
  const earliest = conversionEarliest(g);
  const rosterEnd = rosterHorizon(g);
  const longest = Math.max(1, ...[...map.values()].map((p) => p.days));
  const horizon = g.now + BAL.conv.maxAheadDays * DAY;
  const by = req.by ?? null;
  const lastEnd = Math.min(horizon + longest * DAY, by ?? Infinity);
  const fleets: Search['fleets'] = new Map();
  for (const f of new Set([...map.values()].flatMap((p) => p.lost))) {
    const have: Partial<Record<Role, number>> = {};
    for (const l of staffing(g)) if (l.family === f) have[l.role] = l.have;
    if (!Object.keys(have).length) for (const c of Object.values(g.crew)) if (c.ratings.includes(f) && !c.notice) have[c.role] = (have[c.role] ?? 0) + 1;
    fleets.set(f, { fc: fleetChanges(g, f), per: perAircraft(g, f), have });
  }
  const weeks = map.size ? weekMargins(g, earliest, Math.ceil((BAL.conv.maxAheadDays + longest + 14) / 7)) : [];
  const nDays = BAL.conv.maxAheadDays + longest + 14;
  const floors = floorsOf(g, earliest, nDays);
  return { ids, map, skipped, earliest, rosterEnd, horizon, by, lastEnd, fleets, floors, nDays, weeks, before: shortFlights(g, rosterEnd), runs: runsOf(g), starts: new Map(), rank: new Map() };
}

/** One stop's own plan: the search at its prices, then the dry run until no flight is left short. Yields before each search and each dry run not made yet. */
function* solve(g: GameState, req: ClassPlanRequest, prep: Prep): Generator<void, ClassProposal, void> {
  const { ids, map, skipped, earliest, rosterEnd, horizon, by, lastEnd, fleets, before } = prep;
  const s: Search = { g, req, group: req.group, people: map, earliest, rosterEnd, lastEnd, weeks: prep.weeks, fleets, floors: prep.floors, nDays: prep.nDays, starts: prep.starts, rank: prep.rank, open: new Map(), banned: new Set(), why: new Map() };
  let slots: Slot[] = [];
  let run: Tried | null = null;
  let newShort: string[] = [];
  const drops: Record<string, RatingFamily> = {};
  for (const p of map.values()) if (p.drop) drops[p.id] = p.drop;
  const pins = req.pins ?? {};
  for (let round = 0; round < CLASS_PLAN.rounds; round++) {
    s.why.clear();
    yield;
    slots = place(s);
    if (!slots.length) {
      run = null;
      newShort = [];
      break;
    }
    // The same classes at another stop (or round, or request) were tried already: the same dry run (it is deterministic).
    const inRun = slots.flatMap((k) => k.ids);
    const key = `${req.family}|${slots.map((k) => `${k.start}:${k.ids.join('.')}`).join('|')}|${inRun.filter((id) => drops[id]).map((id) => `${id}>${drops[id]}`).join('.')}`;
    let tried = prep.runs.get(key);
    if (!tried) {
      yield;
      tried = dryRun(g, req.family, slots, drops, rosterEnd, before);
      if (prep.runs.size >= RUNS_KEPT) prep.runs.delete(prep.runs.keys().next().value!);
      prep.runs.set(key, tried);
    }
    run = tried;
    newShort = tried.newShort;
    if (!newShort.length) break;
    // Whose duty stayed open: the seat remembers who left it. They go to another class (or out) next round.
    let blamed = 0;
    const inPlan = new Map(slots.flatMap((k) => k.ids.map((id) => [id, k] as [string, Slot])));
    for (const fid of newShort) {
      const f = tried.flights.get(fid);
      for (const who of f?.left ?? []) {
        if (!inPlan.has(who) || typeof pins[who] === 'number') continue;
        const set = s.open.get(who) ?? new Set<string>();
        const size = set.size;
        for (const did of f!.tripDuties) set.add(did);
        if (f!.dutyId) set.add(f!.dutyId);
        s.open.set(who, set);
        if (set.size > size) blamed++;
        // The last rounds: whoever still leaves a flight open stays out of the plan.
        if (round >= CLASS_PLAN.rounds - 3) s.banned.add(who);
      }
    }
    if (!blamed) {
      // Nobody to name (a knock-on change): the people with duties in the way of the class around it stay out.
      const f = tried.flights.get(newShort[0]);
      const k = slots.find((x) => f && f.std >= x.start - DAY && f.std < x.start + x.len) ?? slots[0];
      const worst = k.ids.filter((id) => typeof pins[id] !== 'number').map((id) => ({ id, n: inWay(map.get(id)!, k.start, k.len).length })).sort((a, b) => b.n - a.n)[0];
      if (!worst || !worst.n) break;
      s.banned.add(worst.id);
    }
  }
  // The classes as the dry run booked them (their numbers, the centre's dates).
  const classes: PlannedClass[] = [];
  const peopleOut: ClassProposal['people'] = {};
  if (run) {
    for (const k of run.classes) {
      const ph = classPhases(k);
      let duties = 0;
      for (const cid of k.crewIds) {
        const p = map.get(cid)!;
        const n = inWay(p, k.start, k.end - k.start).length;
        duties += n;
        peopleOut[cid] = { duties: n, ...(p.drop ? { drop: p.drop } : {}), ...(typeof pins[cid] === 'number' ? { pinned: true as const } : {}) };
      }
      classes.push({ no: k.no, group: k.group, course: k.course, start: k.start, end: k.end, crewIds: [...k.crewIds], fees: k.costPerHead * k.crewIds.length, duties, phases: ph });
    }
  }
  const placed = new Set(classes.flatMap((k) => k.crewIds));
  // v0.23.1 the rest, beyond the booking window: the next instalments (a phase-out paced by the aircraft leaving).
  const next: NextClass[] = [];
  // (Not those the cash leaves out: they could be booked now.)
  const later = [...map.values()].filter((p) => !placed.has(p.id) && pins[p.id] !== 'out' && s.why.get(p.id) !== CASH).map((p) => p.id);
  const far = later.length ? farOf(g, prep) : null;
  if (far) {
    const fixed: Slot[] = classes.map((k) => ({ start: k.start, len: k.end - k.start, course: k.course, ids: k.crewIds }));
    const from = classStartFor(g, req.group, horizon + DAY, (map.get(later[0])?.days ?? 1) * DAY);
    const s2: Search = { ...s, weeks: far.weeks, floors: far.floors, nDays: far.nDays, lastEnd: far.lastEnd, starts: far.starts, why: new Map(), far: { from, fixed, only: new Set(later) } };
    for (const k of place(s2)) {
      if (k.start <= horizon) continue;
      next.push({ group: req.group, course: k.course, start: k.start, end: k.start + k.len, crewIds: k.ids, bookFrom: k.start - BAL.conv.maxAheadDays * DAY });
    }
  }
  const inNext = new Set(next.flatMap((k) => k.crewIds));
  const leftOut: ClassProposal['leftOut'] = [...skipped];
  for (const p of map.values()) {
    if (placed.has(p.id) || inNext.has(p.id)) continue;
    leftOut.push({ crewId: p.id, why: pins[p.id] === 'out' ? 'Taken out' : s.banned.has(p.id) ? 'Nobody free to take over their flights' : s.why.get(p.id) ?? 'No class fits' });
  }
  const fees = classes.reduce((n, k) => n + k.fees, 0);
  const extra = run ? Math.max(0, Math.round(g.company.cash - run.cash - fees)) : 0;
  const finish = classes.length ? Math.max(...classes.map((k) => k.end)) : null;
  const first = classes.length ? Math.min(...classes.map((k) => k.start)) : null;
  const short = newShort.map((id) => run!.flights.get(id)).filter((f): f is NonNullable<typeof f> => !!f).sort((a, b) => a.std - b.std).map((f) => `${f.no} ${fmtDay(f.std)}`);
  // The forecast with the classes in: weeks beyond the published roster that turn short (only the player's own moves can do it).
  const thin: string[] = [];
  const home = g.company.homeBase;
  for (const w of s.weeks) {
    if (w.to <= rosterEnd) continue;
    const used = new Map<string, number>();
    for (const k of classes) {
      for (const id of k.crewIds) {
        const p = map.get(id)!;
        if (!p.home) continue;
        const to = p.lost.includes(p.home) ? Infinity : k.end;
        const key = `${p.home}:${p.role}`;
        used.set(key, (used.get(key) ?? 0) + (overlap(w.from, w.to, k.start, to) / DAY) * WORK_SHARE);
      }
    }
    for (const [key, u] of used) {
      const [f, r] = key.split(':') as [RatingFamily, Role];
      const spare = r === 'CC' ? Math.max(0, (w.margin.get(`${f}:PUR`) ?? 0) - (used.get(`${f}:PUR`) ?? 0)) : 0;
      if (u > 0 && u > (w.margin.get(key) ?? 0) + spare + 0.5) thin.push(`${fmtDayAt(home, w.from)}: ${familyWord(f)} ${ROLE_PL[r]}`);
    }
  }
  const pace: string[] = [];
  for (const [f, fl] of fleets) {
    const roles = ROLE_ORDER.filter((r) => (req.group === 'pilot') === isPilot(r) && fl.per[r]);
    if (!roles.length) continue;
    const w = needFrom(f, roles[0], earliest, fl.fc, fl.per).why;
    const need = roles.map((r) => nRole(needFrom(f, r, earliest, fl.fc, fl.per).need, r)).join(' and ');
    pace.push(`The ${familyWord(f)} needs ${need}${w ? ` ${w.delta > 0 ? 'from' : 'until'} ${fmtDay(w.at)} (${w.reg} ${w.what})` : ''}`);
    for (const c of fl.fc.changes.filter((x) => x.delta < 0 && x !== w).slice(0, 2)) pace.push(`${c.reg}: ${c.what} ${fmtDay(c.at)}`);
  }
  const warnings: ClassProposal['warnings'] = [];
  if (fees > g.company.cash) warnings.push({ level: 'bad', text: `Costs more than the cash on hand` });
  if (short.length) warnings.push({ level: 'bad', text: `${short.length} flight${short.length === 1 ? '' : 's'} left short: ${short.slice(0, 3).join(', ')}${short.length > 3 ? '…' : ''}` });
  if (thin.length) warnings.push({ level: 'warn', text: `Thin ${thin.slice(0, 2).join('; ')}${thin.length > 2 ? '…' : ''}` });
  for (const e of new Set(run?.errors ?? [])) warnings.push({ level: 'bad', text: e });
  const late = by !== null && finish !== null && finish > by;
  const lk = lockOf(g, 'training');
  if (lk) warnings.push({ level: 'bad', text: lk });
  return {
    family: req.family, group: req.group, balance: stopOf(req.balance), by, classes, leftOut,
    asked: ids.filter((id) => g.crew[id] && groupOf(g.crew[id]) === req.group).length, trained: placed.size,
    duties: classes.reduce((n, k) => n + k.duties, 0), short, thin, fees, extra, first, finish, late, people: peopleOut, drops, next, pace, warnings,
    ok: classes.length > 0 && fees <= g.company.cash && !lk && !(run?.errors.length),
    earliest, rosterEnd, horizon,
  };
}

/** What a plan costs at a stop's prices (people trained count for one each; a flight left short rules a plan out). */
function priceAt(stop: number, p: ClassProposal): number {
  const waited = p.finish !== null ? (p.finish - p.earliest) / DAY : 0;
  return CLASS_PLAN.klass[stop] * CLASS_PLAN.max[p.group] * p.classes.length + Math.min(1, CLASS_PLAN.duty[stop]) * p.duties + CLASS_PLAN.wait[stop] * waited - p.trained + 1000 * p.short.length;
}

/**
 * The proposal at every stop of the slider (0 fewer, bigger classes … 4 least roster disruption): each stop's search
 * makes a plan, and each stop then takes the plan that is best at its own prices, so a stop never shows a plan that
 * another beats on every count. Deterministic. Pure (copies of the game take the dry runs).
 */
export function classProposals(g: GameState, req: Omit<ClassPlanRequest, 'balance'>): ClassProposal[] {
  const it = classPlanSteps(g, req);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * classProposals a step at a time (the dialog runs it between frames, so the screen stays live while it works): yields
 * before each search and each dry run not made yet, returns the proposals. The same result. Pure.
 */
export function* classPlanSteps(g: GameState, req: Omit<ClassPlanRequest, 'balance'>): Generator<void, ClassProposal[], void> {
  const prep = prepare(g, req);
  const made = new Map<string, ClassProposal>();
  for (let b = 0; b < CLASS_PLAN.stops; b++) {
    const p = yield* solve(g, { ...req, balance: b }, prep);
    const key = p.classes.map((k) => `${k.start}:${[...k.crewIds].sort().join('.')}`).join('|');
    if (!made.has(key)) made.set(key, p);
  }
  const plans = [...made.values()];
  const out: ClassProposal[] = [];
  for (let b = 0; b < CLASS_PLAN.stops; b++) {
    let best = plans[0];
    for (const p of plans) if (priceAt(b, p) < priceAt(b, best) - 1e-9) best = p;
    out.push({ ...best, balance: b });
  }
  return out;
}

/** The proposal at one stop (see classProposals). Deterministic. Pure. */
export function classProposal(g: GameState, req: ClassPlanRequest): ClassProposal {
  return classProposals(g, req)[stopOf(req.balance)];
}

/**
 * Books a proposal: each class through startConversion, in date order (the same steps the dry run took, so the
 * roster ends as the proposal showed). One Inbox note on top of the classes' own.
 */
export function bookClassPlan(g: GameState, p: Pick<ClassProposal, 'family' | 'classes' | 'people'> & Partial<Pick<ClassProposal, 'group' | 'next'>>): ActionResult<{ classIds: string[] }> {
  const lk = lockOf(g, 'training');
  if (lk) return { ok: false, error: lk };
  if (!p.classes.length) return { ok: false, error: 'No class to book' };
  const drop: Record<string, RatingFamily> = {};
  for (const [id, x] of Object.entries(p.people)) if (x.drop) drop[id] = x.drop;
  const cash = g.company.cash;
  const run = bookOn(g, p.family, p.classes.map((k) => ({ start: k.start, crewIds: k.crewIds })), drop);
  if (!run.classIds.length) return { ok: false, error: run.errors[0] ?? 'Nothing booked' };
  const n = run.classIds.length;
  const heads = run.classIds.reduce((s, id) => s + (g.classes?.[id]?.crewIds.length ?? 0), 0);
  // v0.23.1 the next instalment: a reminder on the day its first class can be booked.
  if (p.next?.length && p.group) {
    const at = Math.min(...p.next.map((k) => k.bookFrom));
    g.classNext = [...(g.classNext ?? []).filter((x) => x.family !== p.family || x.group !== p.group), { family: p.family, group: p.group, at, crewIds: p.next.flatMap((k) => k.crewIds) }];
  }
  const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);
  return { ok: true, msg: `${n} class${n === 1 ? '' : 'es'} booked · ${heads} people · ${usd(cash - g.company.cash)}`, data: { classIds: run.classIds } };
}

/**
 * v0.23.1 daily: a booked plan's next instalment can be booked now (classProposal's `next`): one Inbox line, then the
 * reminder goes. Nothing when everyone in it is already rated, booked or gone.
 */
export function dailyClassReminders(g: GameState): void {
  if (!g.classNext?.length) return;
  const keep: NonNullable<GameState['classNext']> = [];
  for (const x of g.classNext) {
    if (x.at > g.now) {
      keep.push(x);
      continue;
    }
    const left = x.crewIds.filter((id) => g.crew[id] && !g.crew[id].ratings.includes(x.family) && !classOf(g, id) && !g.crew[id].notice);
    if (!left.length) continue;
    const label = familyWord(x.family);
    const who = x.group === 'pilot' ? `${left.length} pilot${left.length === 1 ? '' : 's'}` : `${left.length} cabin crew`;
    pushMessage(g, {
      tone: 'info', cat: 'crew', title: `Next ${label} classes can be booked`,
      body: `${who} still to train. Plan classes on the ${label} card in Crew › Planning.`,
      ref: { kind: 'crew', id: `classes:${x.family}` },
    });
  }
  if (keep.length) g.classNext = keep;
  else delete g.classNext;
}

// ---------- remove a type rating (cabin crew) ----------

export interface RemoveRatingPlan {
  family: RatingFamily;
  /** Who loses it, and what they keep. */
  people: { crewId: string; keeps: RatingFamily[]; trips: number; pay: number }[];
  skipped: { crewId: string; why: string }[];
  /** The type's cabin crew: rated on it now and after, and the number its sets need. */
  coverage: { role: Role; have: number; after: number; need: number }[];
  /** Rostered trips on the type they come off. */
  trips: number;
  /** Flights the dry run leaves short ('XY3040 24 Jun'). */
  short: string[];
  /** Payroll a month after, less before. */
  pay: number;
  warnings: { level: 'warn' | 'bad'; text: string }[];
  ok: boolean;
}

/** Trips (not started) of a person on aircraft of a family. */
function tripsOn(g: GameState, crewId: string, family: RatingFamily): Pairing[] {
  const ids = new Set(rosterOf(g, crewId, g.now, Infinity).filter((d) => !d.done).map((d) => d.pairingId));
  return [...ids].map((id) => g.pairings[id]).filter((p) => p && p.aircraftId && typeOf(typeIdOf(g, p)).family === family).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/** Why a person can't give the rating up (null: they can). */
function keepWhy(g: GameState, c: CrewMember | undefined, family: RatingFamily): string | null {
  if (!c) return 'Not found';
  if (isPilot(c.role)) return 'Pilots change type by a conversion course';
  if (!c.ratings.includes(family)) return `Not rated on the ${familyWord(family)}`;
  if (c.ratings.length < 2) return `The ${familyWord(family)} is their only type`;
  const under = tripsOn(g, c.id, family).find((p) => p.status === 'active' || p.start <= g.now);
  if (under) return `Flying the ${familyWord(family)} until ${fmtDay(under.end)}`;
  return null;
}

/** Takes the rating off these people on `g`: their trips on the type go back to the roster. Returns the trips touched. */
function dropRating(g: GameState, ids: string[], family: RatingFamily): number {
  const label = familyWord(family);
  let trips = 0;
  for (const id of ids) {
    const c = g.crew[id];
    const hit = tripsOn(g, id, family);
    c.ratings = c.ratings.filter((f) => f !== family);
    c.salary = crewPay(g, c);
    // A class that would have ended this rating at its end has nothing to end any more.
    for (const k of conversionClasses(g)) if (k.drop?.[id] === family) delete k.drop[id];
    for (const p of hit) releaseCrew(g, p, id, `No longer rated on the ${label}`);
    if (hit.length) {
      fillAll(g, hit, emptyResult(), new Set([id]));
      for (const p of hit) if (g.pairings[p.id]) recheckPairing(g, p);
    }
    trips += hit.length;
  }
  touchCrew(g);
  return trips;
}

/** What removing `family` from these cabin crew does: who, the type's cover after, trips to re-crew (a dry run). Pure. */
export function removeRatingPlan(g: GameState, crewIds: string[], family: RatingFamily): RemoveRatingPlan {
  const people: RemoveRatingPlan['people'] = [];
  const skipped: RemoveRatingPlan['skipped'] = [];
  for (const id of [...new Set(crewIds)]) {
    const c = g.crew[id];
    const why = keepWhy(g, c, family);
    if (why) skipped.push({ crewId: id, why });
    else people.push({ crewId: id, keeps: c.ratings.filter((f) => f !== family), trips: tripsOn(g, id, family).length, pay: crewPay(g, { role: c.role, ratings: c.ratings.filter((f) => f !== family) }) - c.salary });
  }
  const ids = people.map((p) => p.crewId);
  const lines = staffing(g).filter((l) => l.family === family && !isPilot(l.role));
  const until = rosterHorizon(g);
  const before = shortFlights(g, until);
  const h = previewCopy(g);
  if (ids.length) dropRating(h, ids, family);
  // Everyone rated on the type (people on two types count on both: the Planning view shares them out).
  const rated = (x: GameState, r: Role) => Object.values(x.crew).filter((c) => c.role === r && !c.notice && c.ratings.includes(family)).length;
  const coverage = lines.map((l) => ({ role: l.role, have: rated(g, l.role), after: rated(h, l.role), need: l.need }));
  const short = [...shortFlights(h, until)].filter((id) => !before.has(id)).map((id) => h.flights[id]).sort((a, b) => a.std - b.std).map((f) => `${f.no} ${fmtDay(f.std)}`);
  const warnings: RemoveRatingPlan['warnings'] = [];
  // Pursers beyond their own need fill cabin crew seats (as Planning counts them).
  const purSpare = Math.max(0, (coverage.find((x) => x.role === 'PUR')?.after ?? 0) - (coverage.find((x) => x.role === 'PUR')?.need ?? 0));
  for (const x of coverage) {
    const have = x.after + (x.role === 'CC' ? purSpare : 0);
    if (have < x.need && x.after < x.have) warnings.push({ level: 'bad', text: `Leaves the ${familyWord(family)} short: ${x.after} of ${x.need} ${ROLE_PL[x.role]}` });
  }
  if (short.length) warnings.push({ level: 'bad', text: `${short.length} flight${short.length === 1 ? '' : 's'} left short: ${short.slice(0, 3).join(', ')}${short.length > 3 ? '…' : ''}` });
  return { family, people, skipped, coverage, trips: people.reduce((n, p) => n + p.trips, 0), short, pay: people.reduce((n, p) => n + p.pay, 0), warnings, ok: ids.length > 0 };
}

/**
 * Removes a type rating from cabin crew (it frees one of their three places for another type). Their trips on the type
 * that have not started go back to the roster; pay follows the types they still hold. Nothing is charged.
 */
export function removeRating(g: GameState, crewIds: string[], family: RatingFamily): ActionResult<{ crewIds: string[]; trips: number }> {
  if (!ACMI_TYPES_LIST.some((t) => t.family === family)) return { ok: false, error: 'Unknown type' };
  const ids = [...new Set(crewIds)].filter((id) => !keepWhy(g, g.crew[id], family));
  if (!ids.length) {
    const c = g.crew[crewIds[0]];
    return { ok: false, error: `${c ? `${crewName(c)}: ` : ''}${keepWhy(g, c, family) ?? 'Nobody to change'}` };
  }
  const trips = dropRating(g, ids, family);
  const label = familyWord(family);
  const n = ids.length;
  const names = ids.slice(0, 6).map((id) => crewName(g.crew[id])).join(', ');
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: `${n} cabin crew no longer rated on the ${label}`,
    body: `${names}${n > 6 ? ` and ${n - 6} more` : ''}. ${trips ? `${trips} trip${trips === 1 ? '' : 's'} on the ${label} went back to the roster. ` : ''}Each has a place free for another type.`,
    ref: { kind: 'crew', id: ids[0] },
  });
  return { ok: true, msg: `${label} rating removed from ${n} ${n === 1 ? 'person' : 'people'}`, data: { crewIds: ids, trips } };
}
