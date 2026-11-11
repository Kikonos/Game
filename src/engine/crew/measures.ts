// v0.20.1 Crew › Utilisation › Measures in place (report bmwba4v0r3aj, the player: "I've put some crew on unpaid leave,
// but I just got a notification and nothing else happens after. I want live numbers of who's on unpaid leave, by rank
// and job, until when, how much it's saving me"). What is running now to cut crew cost, from the engine's own records:
// unpaid leave (utilisation.ts, a furlough block per person), the company-wide furlough (finance/distress.ts, the same
// block plus the distress record), redundancy notice (crew.notice.redundant) and conversion courses (crew/conversion.ts).
// The money is the month-end payroll's: a furlough block takes the person's salary with on-costs off the 'salaries'
// line pro rata (distress.ts furloughSaving); a redundant person's pay stops when they leave; severance was paid on
// the day notice was given (half a month's pay a year served, at least a month's: severanceMonths). Pure.

import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import type { GameState, Minute, Role } from '../core/types';
import { conversionClasses } from './conversion';
import { crewName } from './generate';
import { REDUNDANCY, UNPAID } from './utilisation';

export type MeasureKind = 'unpaid' | 'furlough' | 'notice' | 'convert';

export interface MeasurePerson {
  id: string;
  name: string;
  role: Role;
  family: RatingFamily;
  /** Away from (unpaid leave, furlough, a course), or notice given (redundancy). */
  from: Minute;
  /** Back on (first minute at work again), or the day they leave (redundancy), or the course's end. */
  to: Minute;
  /** Pay with on-costs a month. */
  pay: number;
}

export interface MeasureGroup {
  role: Role;
  family: RatingFamily;
  people: MeasurePerson[];
}

export interface Measure {
  kind: MeasureKind;
  /** Plain name: 'Unpaid leave', 'Furlough', 'Redundancy notice', 'Converting to A330'. */
  label: string;
  people: MeasurePerson[];
  /** Heads by rank (CPT, FO, PUR, CC). */
  byRole: Record<Role, number>;
  /** By rank and type, captains first, names sorted by the day they are back. */
  groups: MeasureGroup[];
  /** Saved a month while it runs (pay with on-costs); for redundancy, the pay saved a month once they have left. */
  monthly: number;
  /** Saved over the whole measure (the furlough blocks' days at the month-end payroll's rate); 0 for redundancy. */
  total: number;
  /** Paid for it: severance (redundancy), the course fees (conversion). */
  cost: number;
  /** Any of it running now (some away / on notice), or all of it still to start. */
  running: boolean;
  /** The soonest start (when nothing is running yet), the soonest back (or leaves), and the last. */
  starts: Minute;
  soonest: Minute;
  last: Minute;
  /** The morale effect when it was put in place (the engine's numbers), plain; null when none. */
  morale: string | null;
}

export interface Measures {
  list: Measure[];
  /** Saving a month now: unpaid leave and furlough running or about to start. */
  monthly: number;
  /** More a month once those on redundancy notice have left. */
  later: number;
  /** One-off costs paid for the measures listed (severance, course fees). */
  costs: number;
}

export const MEASURE_ROLES: Role[] = ['CPT', 'FO', 'PUR', 'CC'];
const MONTH = 30.44 * DAY;
const FAMILY_SHORT: Partial<Record<RatingFamily, string>> = { 'A330/340': 'A330', 'B757/767': 'B767' };

function signed(v: number): string {
  return v > 0 ? `+${v}` : `−${Math.abs(v)}`;
}

/** The crew cost measures in place now (running, or booked to start). Pure. */
export function crewMeasures(g: GameState): Measures {
  const on = 1 + BAL.onCosts;
  const fu = g.treasury?.distress?.furlough;
  const furloughIds = new Set(fu && g.now < fu.until ? fu.crewIds : []);
  const bucket = new Map<string, { kind: MeasureKind; label: string; people: MeasurePerson[]; total: number; cost: number; family?: RatingFamily }>();
  const add = (key: string, kind: MeasureKind, label: string) => {
    let b = bucket.get(key);
    if (!b) bucket.set(key, (b = { kind, label, people: [], total: 0, cost: 0 }));
    return b;
  };
  for (const c of Object.values(g.crew).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (c.status === 'joining') continue;
    const pay = Math.round(c.salary * on);
    const family = c.ratings[0];
    // Unpaid leave and the furlough: a furlough block not over yet (the person's latest one).
    const blk = (c.blocks ?? []).filter((x) => x.furlough && x.to > g.now).sort((a, b) => a.from - b.from)[0];
    if (blk) {
      const isFurlough = furloughIds.has(c.id) && fu && blk.from === fu.from && blk.to === fu.until;
      const b = isFurlough ? add('furlough', 'furlough', 'Furlough') : add('unpaid', 'unpaid', 'Unpaid leave');
      b.people.push({ id: c.id, name: crewName(c), role: c.role, family, from: blk.from, to: blk.to, pay });
      // The whole block at the payroll's rate (about: the month end counts the days of each month).
      b.total += c.salary * on * ((blk.to - Math.max(blk.from, c.payFrom ?? blk.from)) / MONTH);
    }
    if (c.notice?.redundant && c.notice.leaves > g.now) {
      const b = add('notice', 'notice', 'Redundancy notice');
      b.people.push({ id: c.id, name: crewName(c), role: c.role, family, from: c.notice.given, to: c.notice.leaves, pay });
      const months = Math.max(REDUNDANCY.minMonths, (REDUNDANCY.perYear * (c.notice.given - c.hired)) / (365 * DAY));
      b.cost += c.salary * months;
    }
  }
  for (const k of conversionClasses(g)) {
    if (k.end <= g.now) continue;
    const name = FAMILY_SHORT[k.family] ?? k.family;
    const b = add(`convert:${k.family}`, 'convert', `Converting to ${name}`);
    b.family = k.family;
    for (const id of k.crewIds) {
      const c = g.crew[id];
      if (!c) continue;
      b.people.push({ id, name: crewName(c), role: c.role, family: c.ratings.find((f) => f !== k.family) ?? c.ratings[0], from: k.start, to: k.end, pay: Math.round(c.salary * on) });
    }
    b.cost += k.costPerHead * k.crewIds.length;
  }
  const order: MeasureKind[] = ['unpaid', 'furlough', 'notice', 'convert'];
  const list: Measure[] = [];
  for (const b of [...bucket.values()].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || (x.label < y.label ? -1 : 1))) {
    if (!b.people.length) continue;
    const byRole = { CPT: 0, FO: 0, PUR: 0, CC: 0 } as Record<Role, number>;
    for (const p of b.people) byRole[p.role]++;
    const gm = new Map<string, MeasureGroup>();
    for (const p of b.people) {
      const key = `${p.role}|${p.family}`;
      const x = gm.get(key) ?? { role: p.role, family: p.family, people: [] };
      x.people.push(p);
      gm.set(key, x);
    }
    const groups = [...gm.values()].sort((x, y) => MEASURE_ROLES.indexOf(x.role) - MEASURE_ROLES.indexOf(y.role) || (x.family < y.family ? -1 : 1));
    for (const x of groups) x.people.sort((p, q) => p.to - q.to || p.name.localeCompare(q.name));
    const saves = b.kind === 'unpaid' || b.kind === 'furlough' || b.kind === 'notice';
    const running = b.kind === 'notice' || b.people.some((p) => p.from <= g.now);
    list.push({
      kind: b.kind, label: b.label, people: b.people, byRole, groups,
      monthly: saves ? b.people.reduce((s, p) => s + p.pay, 0) : 0,
      total: Math.round(b.total),
      cost: Math.round(b.cost),
      running,
      starts: Math.min(...b.people.map((p) => p.from)),
      soonest: Math.min(...b.people.map((p) => p.to)),
      last: Math.max(...b.people.map((p) => p.to)),
      morale: moraleOf(g, b.kind),
    });
  }
  const now = list.filter((m) => m.kind === 'unpaid' || m.kind === 'furlough');
  return {
    list,
    monthly: now.reduce((s, m) => s + m.monthly, 0),
    later: list.filter((m) => m.kind === 'notice').reduce((s, m) => s + m.monthly, 0),
    costs: list.reduce((s, m) => s + m.cost, 0),
  };
}

/** The morale the measure cost (or gave) when it was put in place: the engine's own numbers, plain. */
function moraleOf(_g: GameState, kind: MeasureKind): string | null {
  switch (kind) {
    case 'unpaid': return `Morale ${signed(UNPAID.morale)} for them: they asked for the time`;
    case 'furlough': return `Morale ${signed(BAL.v0163.furlough.morale)} for them, ${signed(BAL.v0163.furlough.moraleOthers)} for everyone else; some may resign`;
    case 'notice': return `Morale ${signed(REDUNDANCY.moraleGroup)} for their colleagues of the same rank and type, ${signed(REDUNDANCY.moraleAll)} for everyone else`;
    default: return null;
  }
}
