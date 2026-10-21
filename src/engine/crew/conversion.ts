// v0.6 bulk type-rating conversion (UPDATE-0.6.md §F2): the player sends many crew at once onto another type;
// classes of at most BAL.conv.classMax form automatically (pilots and cabin apart, full course and common-type
// apart), staggered through one training centre. Pilots convert in 42 days, cabin crew in 8; costs per head are
// charged once at booking. Read APIs are pure.

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { isPilot, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { DAY, fmtDate, fmtDay } from '../core/time';
import type { ActionResult, CrewMember, GameState, Minute, Role, TrainingClass, TrainingItem } from '../core/types';
import { staffing } from './hr';
import { crewName, salaryFor } from './generate';
import { moraleShock } from './morale';
import { removeCrew, rosterOf } from './roster';
import { offsetAt } from './rules';
import { touchCrew } from './timeline';

export interface ConversionRequest {
  crewIds: string[];
  family: RatingFamily;
  start: Minute;
  drop?: Record<string, RatingFamily>;
}

export interface ConversionClassPlan {
  no: string;
  group: 'pilot' | 'cabin';
  course: 'full' | 'ccq';
  start: Minute;
  end: Minute;
  crewIds: string[];
  costPerHead: number;
  cost: number;
  phases: { label: string; from: Minute; to: Minute }[];
}

export interface ConversionPlan {
  ok: boolean;
  classes: ConversionClassPlan[];
  cost: number;
  skipped: { crewId: string; why: string }[];
  warnings: { level: 'warn' | 'bad'; text: string }[];
  dutiesAffected: number;
  /** Per included crew member: ratings after completion (pilots drop the old type unless CCQ; cabin keep ≤ 3). */
  ratingsAfter: Record<string, RatingFamily[]>;
  /** Cabin crew at 3 types: the default rating they give up (player may override via drop). */
  dropDefault: Record<string, RatingFamily>;
  earliest: Minute;
}

const LABEL: Partial<Record<RatingFamily, string>> = { 'A330/340': 'A330', 'B757/767': 'B767' };

/** Short label of a rating family: 'A330/340' → 'A330', 'B757/767' → 'B767'. */
export function familyLabel(f: RatingFamily): string {
  return LABEL[f] ?? f;
}

type Group = 'pilot' | 'cabin';
type Course = 'full' | 'ccq';

/** Course phases by day (1-based, inclusive), RESEARCH §5.2. */
const PHASES: Record<`${Group}:${Course}`, [string, number, number][]> = {
  'pilot:full': [['Ground school', 1, 12], ['Simulator', 13, 28], ['Skill test & base training', 29, 30], ['Line training & line check', 31, 42]],
  'pilot:ccq': [['Differences ground', 1, 4], ['Simulator', 5, 10], ['Line check', 11, 14]],
  'cabin:full': [['Ground & safety', 1, 5], ['Doors, slides, fire & first aid', 6, 7], ['Exam & familiarisation', 8, 8]],
  'cabin:ccq': [['Differences course', 1, 3]],
};

/** Common-type partner of a family (Airbus CCQ A330/340 ↔ A350, Boeing 777 ↔ 787), else null. */
export function ccqPartner(f: RatingFamily): RatingFamily | null {
  for (const [a, b] of BAL.conv.ccq) {
    if (a === f) return b as RatingFamily;
    if (b === f) return a as RatingFamily;
  }
  return null;
}

const wideFamily = (f: RatingFamily) => ACMI_TYPES_LIST.some((t) => t.family === f && t.body === 'wide');

/** Course length (days) and price per head. */
export function courseOf(group: Group, course: Course, family: RatingFamily): { days: number; cost: number } {
  const C = BAL.conv;
  if (group === 'pilot') return course === 'ccq' ? { days: C.pilotCcqDays, cost: C.pilotCcqCost } : { days: C.pilotDays, cost: wideFamily(family) ? C.pilotCost.wide : C.pilotCost.narrow };
  return course === 'ccq' ? { days: C.cabinCcqDays, cost: C.cabinCcqCost } : { days: C.cabinDays, cost: C.cabinCost };
}

const groupOf = (c: CrewMember): Group => (isPilot(c.role) ? 'pilot' : 'cabin');
const courseFor = (c: CrewMember, family: RatingFamily): Course => {
  const p = ccqPartner(family);
  return p && c.ratings.includes(p) ? 'ccq' : 'full';
};

/** Base-local start of the day containing t (the training centre is at home base). */
function localDay(g: GameState, t: Minute): Minute {
  const off = offsetAt(g.company.homeBase, t);
  return Math.floor((t + off) / DAY) * DAY - off;
}

/** Earliest first-class start: the base-local day BAL.conv.leadDays ahead. */
export const conversionEarliest = (g: GameState): Minute => localDay(g, g.now + BAL.conv.leadDays * DAY + DAY - 1);

const classes = (g: GameState): TrainingClass[] => Object.values(g.classes ?? {});

/** Planned and running classes by start. Pure. */
export function conversionClasses(g: GameState): TrainingClass[] {
  return classes(g).filter((k) => k.status === 'planned' || k.status === 'running').sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

/** The planned or running class of a crew member. Pure. */
export function classOf(g: GameState, crewId: string): TrainingClass | null {
  for (const k of conversionClasses(g)) if (k.crewIds.includes(crewId)) return k;
  return null;
}

/** Default rating a cabin crew member at 3 types gives up: a family with no aircraft in the fleet, else the first. */
function defaultDrop(g: GameState, c: CrewMember): RatingFamily {
  const fleet = new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family));
  return c.ratings.find((f) => !fleet.has(f)) ?? c.ratings[0];
}

/** Ratings after the course (pilots: one type unless common type; cabin: up to 3, `drop` given up at 3). */
function after(c: CrewMember, family: RatingFamily, course: Course, drop: RatingFamily | undefined): RatingFamily[] {
  if (isPilot(c.role)) return course === 'ccq' ? [...c.ratings, family] : [family];
  const kept = c.ratings.length >= 3 && drop ? c.ratings.filter((f) => f !== drop) : [...c.ratings];
  return [...kept, family];
}

const ROLE_PL: Record<Role, string> = { CPT: 'captains', FO: 'first officers', CRP: 'relief pilots', CSD: 'pursers', SCC: 'senior cabin crew', CC: 'cabin crew' };

/** Splits a pool into ceil(n/max) balanced classes, dealt round-robin from the given order. */
function deal<T>(xs: T[], max: number): T[][] {
  const k = Math.ceil(xs.length / max);
  const out: T[][] = Array.from({ length: k }, () => []);
  xs.forEach((x, i) => out[i % k].push(x));
  return out;
}

/** Pilots ordered CPT/FO alternately (simulator pairs), cabin seniors first. */
function ordered(g: GameState, ids: string[], group: Group): string[] {
  const by = (r: Role[]) => ids.filter((id) => r.includes(g.crew[id].role));
  if (group === 'cabin') return [...by(['CSD']), ...by(['SCC']), ...by(['CC'])];
  const cpt = by(['CPT']);
  const fo = by(['FO', 'CRP']);
  const out: string[] = [];
  for (let i = 0; i < Math.max(cpt.length, fo.length); i++) {
    if (i < cpt.length) out.push(cpt[i]);
    if (i < fo.length) out.push(fo[i]);
  }
  return out;
}

/** Earliest start ≥ t for a pilot class: at least pilotStaggerDays from every other pilot class start. */
function pilotSlot(t: Minute, starts: Minute[]): Minute {
  const gap = BAL.conv.pilotStaggerDays * DAY;
  for (let n = 0; n < 200; n++) {
    const clash = starts.filter((s) => Math.abs(t - s) < gap).sort((a, b) => b - a)[0];
    if (clash === undefined) return t;
    t = clash + gap;
  }
  return t;
}

/** Earliest start ≥ t for a cabin class: fewer than cabinParallel cabin classes in its days. */
function cabinSlot(t: Minute, len: number, busy: [Minute, Minute][]): Minute {
  const cands = [t, ...busy.map((b) => b[1]).filter((e) => e > t)].sort((a, b) => a - b);
  for (const c of cands) if (busy.filter(([a, b]) => a < c + len && b > c).length < BAL.conv.cabinParallel) return c;
  return cands[cands.length - 1];
}

/** Why a crew member can't join (null: eligible). */
function skipWhy(g: GameState, c: CrewMember | undefined, family: RatingFamily, start: Minute): string | null {
  if (!c) return 'Not found';
  if (c.notice) return 'Resigned (on notice)';
  if (c.ratings.includes(family)) return `Already rated on the ${familyLabel(family)}`;
  const k = classOf(g, c.id);
  if (k) return `Already booked on ${k.no}`;
  if (g.training.some((x) => x.crewId === c.id)) return 'In training';
  if (c.status === 'joining') {
    const h = g.hires.find((x) => x.crewId === c.id);
    const joins = h?.ready ?? c.blocks?.find((b) => b.why === 'joining')?.to ?? c.hired;
    if (joins > start) return `Joins ${fmtDay(joins)}, after the start`;
  }
  return null;
}

interface Pool {
  group: Group;
  course: Course;
  ids: string[];
}

const usd = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1000)}K`);
const span = (a: Minute, b: Minute) => `${fmtDay(a)} – ${fmtDay(b - 1)}`;

/** Plan a conversion without booking it: classes, dates, cost, skipped crew and fleet-short warnings. Pure. */
export function conversionPlan(g: GameState, r: ConversionRequest): ConversionPlan {
  const earliest = conversionEarliest(g);
  const start = localDay(g, Math.max(earliest, r.start) + 6 * 60);
  const skipped: ConversionPlan['skipped'] = [];
  const warnings: ConversionPlan['warnings'] = [];
  const ratingsAfter: Record<string, RatingFamily[]> = {};
  const dropDefault: Record<string, RatingFamily> = {};
  const pools: Pool[] = [
    { group: 'pilot', course: 'full', ids: [] }, { group: 'pilot', course: 'ccq', ids: [] },
    { group: 'cabin', course: 'full', ids: [] }, { group: 'cabin', course: 'ccq', ids: [] },
  ];
  const seen = new Set<string>();
  for (const id of r.crewIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const c = g.crew[id];
    const why = skipWhy(g, c, r.family, start);
    if (why) {
      skipped.push({ crewId: id, why });
      continue;
    }
    const group = groupOf(c);
    const course = courseFor(c, r.family);
    let drop: RatingFamily | undefined;
    if (group === 'cabin' && c.ratings.length >= 3) {
      dropDefault[id] = defaultDrop(g, c);
      const want = r.drop?.[id];
      drop = want && c.ratings.includes(want) ? want : dropDefault[id];
    }
    ratingsAfter[id] = after(c, r.family, course, drop);
    pools.find((p) => p.group === group && p.course === course)!.ids.push(id);
  }
  // Classes: balanced, staggered through one training centre (existing classes count).
  const booked = conversionClasses(g);
  const pilotStarts = booked.filter((k) => k.group === 'pilot').map((k) => k.start);
  const cabinBusy: [Minute, Minute][] = booked.filter((k) => k.group === 'cabin').map((k) => [k.start, k.end]);
  const seq = new Map<Group, number>();
  const nextNo = (group: Group) => {
    const n = (seq.get(group) ?? classes(g).filter((k) => k.family === r.family && k.group === group).length) + 1;
    seq.set(group, n);
    return `${familyLabel(r.family)}-${group === 'pilot' ? 'P' : 'C'}${n}`;
  };
  const out: ConversionClassPlan[] = [];
  for (const pool of pools) {
    if (!pool.ids.length) continue;
    const { days, cost } = courseOf(pool.group, pool.course, r.family);
    const len = days * DAY;
    for (const members of deal(ordered(g, pool.ids, pool.group), BAL.conv.classMax)) {
      let t = start;
      if (pool.group === 'pilot') {
        t = localDay(g, pilotSlot(t, pilotStarts) + 6 * 60);
        pilotStarts.push(t);
      } else {
        t = localDay(g, cabinSlot(t, len, cabinBusy) + 6 * 60);
        cabinBusy.push([t, t + len]);
      }
      const end = t + len;
      const phases = PHASES[`${pool.group}:${pool.course}`].map(([label, a, b]) => ({ label, from: t + (a - 1) * DAY, to: t + b * DAY }));
      out.push({ no: nextNo(pool.group), group: pool.group, course: pool.course, start: t, end, crewIds: members, costPerHead: cost, cost: cost * members.length, phases });
    }
  }
  const total = out.reduce((s, k) => s + k.cost, 0);
  // Warnings, red first.
  const tooFar = start > g.now + BAL.conv.maxAheadDays * DAY;
  if (tooFar) warnings.push({ level: 'bad', text: `Classes can be booked at most ${BAL.conv.maxAheadDays} days ahead` });
  if (total > g.company.cash) warnings.push({ level: 'bad', text: `Costs ${usd(total)}, more than the cash on hand (${usd(g.company.cash)})` });
  const inFleet = Object.values(g.fleet).some((a) => typeOf(a.typeId).family === r.family);
  if (!inFleet && out.length) warnings.push({ level: 'warn', text: `No ${familyLabel(r.family)} in the fleet or on order` });
  const included = out.flatMap((k) => k.crewIds);
  for (const l of staffing(g)) {
    const during = included.filter((id) => g.crew[id].role === l.role && g.crew[id].ratings.includes(l.family)).length;
    if (during) {
      const have = l.have - during;
      if (have < l.need) warnings.push({ level: have < l.need * 0.8 ? 'bad' : 'warn', text: `${familyLabel(l.family)} ${ROLE_PL[l.role]} during the course: ${have} of ${l.need} needed` });
    }
    const lost = included.filter((id) => g.crew[id].role === l.role && g.crew[id].ratings.includes(l.family) && !ratingsAfter[id].includes(l.family)).length;
    if (lost) {
      const have = l.have - lost;
      if (have < l.need) warnings.push({ level: have < l.need * 0.8 ? 'bad' : 'warn', text: `After the course: ${familyLabel(l.family)} ${ROLE_PL[l.role]} ${have} of ${l.need}` });
    }
  }
  let dutiesAffected = 0;
  for (const k of out) for (const id of k.crewIds) dutiesAffected += rosterOf(g, id, k.start, k.end).filter((d) => !d.done).length;
  if (dutiesAffected) warnings.push({ level: 'warn', text: `${dutiesAffected} rostered dut${dutiesAffected === 1 ? 'y loses' : 'ies lose'} crew; the auto-roster will re-crew ${dutiesAffected === 1 ? 'it' : 'them'}` });
  warnings.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
  const ok = out.length > 0 && total <= g.company.cash && !tooFar;
  return { ok, classes: out, cost: total, skipped, warnings, dutiesAffected, ratingsAfter, dropDefault, earliest };
}

/**
 * Books the conversion: classes with their members (training blocks, TrainingItems, 'training.done' events),
 * the cost once to 'training', and their rostered work in the class dates back to the auto-roster.
 */
export function startConversion(g: GameState, r: ConversionRequest): ActionResult<{ classIds: string[] }> {
  if (!ACMI_TYPES_LIST.some((t) => t.family === r.family)) return { ok: false, error: 'Unknown type family' };
  const plan = conversionPlan(g, r);
  if (!plan.classes.length) {
    const s = plan.skipped[0];
    const c = s ? g.crew[s.crewId] : undefined;
    return { ok: false, error: s ? `${c ? `${crewName(c)}: ` : ''}${s.why}` : 'Nobody to convert' };
  }
  if (!plan.ok) return { ok: false, error: plan.warnings.find((w) => w.level === 'bad')?.text ?? 'This conversion can’t be booked' };
  g.classes ??= {};
  const ids: string[] = [];
  for (const k of plan.classes) {
    const id = nextId(g, 'tc');
    const cls: TrainingClass = {
      id, no: k.no, family: r.family, group: k.group, course: k.course, start: k.start, end: k.end, crewIds: [...k.crewIds], costPerHead: k.costPerHead, status: 'planned',
    };
    for (const cid of k.crewIds) {
      const c = g.crew[cid];
      if (k.group === 'cabin' && c.ratings.length >= 3) {
        const gone = c.ratings.find((f) => !plan.ratingsAfter[cid].includes(f));
        if (gone) (cls.drop ??= {})[cid] = gone;
      }
      const item: TrainingItem = { id: nextId(g, 't'), crewId: cid, kind: k.course === 'full' ? 'typeRating' : 'conversion', family: r.family, start: k.start, end: k.end, cost: k.costPerHead, classId: id };
      g.training.push(item);
      schedule(g, k.end, 'training.done', item.id);
      c.blocks = [...(c.blocks ?? []), { from: k.start, to: k.end, why: 'training' }];
    }
    g.classes[id] = cls;
    ids.push(id);
  }
  post(g, 'training', -plan.cost);
  // Their work from the day before the class to its end goes back to the auto-roster (anyone away comes home
  // first); only the class itself stays blocked.
  for (const k of plan.classes) {
    for (const cid of k.crewIds) {
      removeCrew(g, cid, k.start - DAY, k.end);
      const c = g.crew[cid];
      if (c.blocks) c.blocks = c.blocks.filter((b) => !(b.why === 'leave' && b.from === k.start - DAY && b.to === k.end));
    }
  }
  touchCrew(g);
  const label = familyLabel(r.family);
  const pil = plan.classes.filter((k) => k.group === 'pilot');
  const cab = plan.classes.filter((k) => k.group === 'cabin');
  const part = (ks: ConversionClassPlan[], who: string) => {
    if (!ks.length) return '';
    const same = ks.every((k) => k.start === ks[0].start && k.end === ks[0].end);
    const list = ks.map((k) => `${k.no} (${k.crewIds.length})${same ? '' : ` ${span(k.start, k.end)}`}`);
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    return `${who} ${joined}${same ? ` ${span(ks[0].start, ks[0].end)}` : ''}.`;
  };
  const n = plan.classes.length;
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: `Conversion ${label} booked: ${n} class${n > 1 ? 'es' : ''}`,
    body: `${[part(pil, 'Pilots'), part(cab, 'Cabin')].filter(Boolean).join(' ')} ${usd(plan.cost)} charged. Their rostered work in those dates goes back to the auto-roster.`,
    ref: { kind: 'crew', id: plan.classes[0].crewIds[0] },
  });
  return { ok: true, msg: `Conversion ${label} booked: ${n} class${n > 1 ? 'es' : ''} · ${usd(plan.cost)}`, data: { classIds: ids } };
}

/** Refund share for leaving a class now: 100% more than refundFull days before it starts, 50% after, 0 once running. */
export function refundShare(g: GameState, k: TrainingClass): number {
  if (k.status !== 'planned' || k.start <= g.now) return 0;
  return k.start - g.now > BAL.conv.refundFull * DAY ? 1 : 0.5;
}

/** Takes one member out of a class: their course, training block and the class seat. */
function dropMember(g: GameState, k: TrainingClass, crewId: string): void {
  g.training = g.training.filter((x) => !(x.classId === k.id && x.crewId === crewId));
  k.crewIds = k.crewIds.filter((x) => x !== crewId);
  if (k.drop) delete k.drop[crewId];
  const c = g.crew[crewId];
  if (!c) return;
  if (c.blocks) {
    c.blocks = c.blocks.filter((b) => !(b.why === 'training' && b.from === k.start && b.to === k.end));
    if (!c.blocks.length) delete c.blocks;
  }
  if (c.status === 'training') c.status = c.restUntil > g.now ? 'resting' : 'available';
}

/** Cancels a whole class or one member of it, refunding 100/50/0% of the course fees (BAL.conv.refundFull). */
export function cancelConversion(g: GameState, classId: string, crewId?: string): ActionResult<{ refund: number }> {
  const k = g.classes?.[classId];
  if (!k || (k.status !== 'planned' && k.status !== 'running')) return { ok: false, error: 'Class not found' };
  if (crewId && !k.crewIds.includes(crewId)) return { ok: false, error: 'Not in this class' };
  const who = crewId ? [crewId] : [...k.crewIds];
  const share = refundShare(g, k);
  const refund = Math.round(k.costPerHead * who.length * share);
  for (const id of who) dropMember(g, k, id);
  if (!k.crewIds.length) k.status = 'cancelled';
  if (refund) post(g, 'training', refund);
  touchCrew(g);
  const c = crewId ? g.crew[crewId] : undefined;
  const what = crewId ? `${c ? crewName(c) : 'Crew member'} taken off ${k.no}` : `${k.no} cancelled`;
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: `${what}${refund ? ` · ${usd(refund)} refunded` : ''}`,
    body: refund ? `${Math.round(share * 100)}% of the course fees refunded. They go back on the roster.` : 'No refund once the class is under way. They go back on the roster.',
    ref: crewId ? { kind: 'crew', id: crewId } : undefined,
  });
  return { ok: true, msg: `${what}${refund ? ` · ${usd(refund)} refunded` : ''}`, data: { refund } };
}

/** Daily: classes whose start came begin (members' status follows their training blocks). */
export function dailyClasses(g: GameState): void {
  for (const k of Object.values(g.classes ?? {})) {
    if (k.status !== 'planned' || k.start > g.now) continue;
    k.status = 'running';
    for (const id of k.crewIds) {
      const c = g.crew[id];
      if (c && c.status !== 'onDuty') c.status = 'training';
    }
  }
}

/**
 * A class member's course is done ('training.done' with a classId): new ratings (pilots: one type unless common
 * type; cabin: up to 3), salary, pilot bond, morale +career. The class message comes once, when its last member
 * completes. True when handled here.
 */
export function onClassItemDone(g: GameState, item: TrainingItem): boolean {
  const k = item.classId ? g.classes?.[item.classId] : undefined;
  if (!k) return false;
  const c = g.crew[item.crewId];
  const old = c ? [...c.ratings] : [];
  if (c && k.crewIds.includes(c.id)) {
    if (k.group === 'pilot') {
      c.ratings = k.course === 'ccq' ? [...new Set([...c.ratings, k.family])] : [k.family];
      if (k.course === 'full') c.bondUntil = k.end + Math.round(BAL.conv.bondMonths * 30.44) * DAY;
    } else {
      const drop = k.drop?.[c.id];
      if (c.ratings.length >= 3) c.ratings = c.ratings.filter((f) => f !== (drop ?? c.ratings[0]));
      if (!c.ratings.includes(k.family)) c.ratings.push(k.family);
    }
    const wide = c.ratings.find((f) => salaryFor(c.role, f) !== salaryFor(c.role, 'A320'));
    c.salary = salaryFor(c.role, wide ?? c.ratings[0] ?? 'A320');
    if (c.blocks) {
      c.blocks = c.blocks.filter((b) => !(b.why === 'training' && b.from === k.start && b.to === k.end));
      if (!c.blocks.length) delete c.blocks;
    }
    if (c.status === 'training') c.status = c.restUntil > g.now ? 'resting' : 'available';
    moraleShock(g, c, 'career', BAL.morale.career);
  }
  if (!g.training.some((x) => x.classId === k.id) && k.status !== 'done') {
    k.status = 'done';
    g.stats.conversions = (g.stats.conversions ?? 0) + 1;
    const label = familyLabel(k.family);
    const n = k.crewIds.length;
    const kept = old.filter((f) => f !== k.family).map(familyLabel);
    const body = k.group === 'pilot'
      ? k.course === 'ccq' ? `Common type rating: they keep the ${kept.join(', ') || 'old type'} and fly both.` : `Their ${kept.join(', ') || 'old'} rating is no longer current.`
      : `${n} cabin crew now hold the ${label}${kept.length ? ` (they keep the ${kept.join(', ')})` : ''}.`;
    pushMessage(g, {
      tone: 'good', cat: 'crew', title: `${k.no} finished: ${n} ${k.group === 'pilot' ? `pilot${n > 1 ? 's' : ''} now fly the ${label}` : `cabin crew now hold the ${label}`}`,
      body, ref: c ? { kind: 'crew', id: c.id } : undefined,
    });
  }
  touchCrew(g);
  return true;
}

/** The class behind a training block (crew calendar): its label 'Conversion A330' and detail with the phase. Pure. */
export function classBlockText(g: GameState, crewId: string, from: Minute, to: Minute): { label: string; detail: string } | null {
  const k = Object.values(g.classes ?? {}).find((x) => x.crewIds.includes(crewId) && x.start < to && x.end > from && x.status !== 'cancelled');
  if (!k) return null;
  const phases = PHASES[`${k.group}:${k.course}`];
  const t = Math.min(Math.max(g.now, k.start), k.end - 1);
  const ph = phases.find(([, a, b]) => t >= k.start + (a - 1) * DAY && t < k.start + b * DAY) ?? phases[0];
  const line = k.group === 'pilot' && k.course === 'full' ? '\nLine training is flown under supervision; the trainee is not rostered.' : '';
  return { label: `Conversion ${familyLabel(k.family)}`, detail: `Class ${k.no} · ${ph[0]} d${ph[1]}–${ph[2]} · ends ${fmtDate(k.end - 1)}${line}` };
}
