// v0.18.2 crew utilisation (the player, a working flight attendant: "all crew have very little flying hours by month or
// year: just ACMI sparse duties, or really underused?"). Per person the block hours this month, in the last 28 days and
// over 12 months against what ACMI crew typically fly; idle crew by base, type and rank; pilots and cabin crew per
// aircraft; the monthly cost of crew beyond the sets the flying needs (sets.ts crewPlan); and what can be done about a
// surplus: unpaid leave asked for (not imposed), the v0.16.3 furlough, or redundancy with notice, severance and the
// morale it costs. Also the hold on hiring while crew sit idle (heads.ts crew desk). Pure, but for the two actions.

import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { isPilot } from '../core/perf';
import { DAY, fmtDate, monthKey } from '../core/time';
import type { ActionResult, CrewMember, GameState, Role } from '../core/types';
import { hashUnit } from '../core/util';
import { crewName } from './generate';
import { moraleShock } from './morale';
import { removeCrew } from './roster';
import { crewPlan, crewSupply, familyName, familyNeeds } from './sets';
import { touchCrew } from './timeline';

/** What ACMI crew typically fly (block hours): a month in season, a year; idle below `idle28` in 28 days. */
export const UTIL_TYPICAL = { monthLo: 60, monthHi: 85, yearLo: 700, yearHi: 850, idle28: 15, hold28: 40 };

/** Redundancy terms: notice (days), severance (months of pay a year served, at least `minMonths`), morale. */
export const REDUNDANCY = { noticeDays: { pilot: 90, cabin: 60 }, perYear: 0.5, minMonths: 1, moraleGroup: -6, moraleAll: -3 };

/** Unpaid leave offered: months, who takes it (share of those asked), their morale. */
export const UNPAID = { months: [1, 3] as number[], takes: 0.6, morale: 1, startDays: 2 };

export interface UtilPerson {
  id: string;
  name: string;
  role: Role;
  family: RatingFamily;
  base: string;
  /** Block hours this calendar month, in the last 28 days and over the last 12 months. */
  month: number;
  d28: number;
  y12: number;
  /** At work (not joining, sick, on leave or in training) and under UTIL_TYPICAL.idle28 hours in 28 days. */
  idle: boolean;
  /** Not at work now (joining, sick, on leave, in training, on notice). */
  away: boolean;
}

export interface UtilGroup {
  key: string;
  family: RatingFamily;
  label: string;
  role: Role;
  base: string;
  n: number;
  /** Average block hours in 28 days of those at work. */
  avg28: number;
  idle: number;
}

export interface UtilSurplus {
  family: RatingFamily;
  label: string;
  role: Role;
  /** People beyond the sets the flying needs (the Planning view's balance), and their pay a month with on-costs. */
  n: number;
  cost: number;
}

export interface Utilisation {
  people: UtilPerson[];
  groups: UtilGroup[];
  surplus: UtilSurplus[];
  /** Aircraft counted (the fleet less those away on a dry lease) and crew per aircraft (joiners left out). */
  aircraft: number;
  perAircraft: { pilots: number; cabin: number };
  /** Average block hours of pilots and cabin crew at work: 28 days and 12 months (those with a year on the books). */
  avg28: { pilots: number; cabin: number };
  avg12: { pilots: number; cabin: number };
  surplusCost: number;
  idle: number;
}

const blockOf = (c: CrewMember, from: number) => c.log.reduce((s, e) => s + (e.end > from ? e.block : 0), 0) / 60;

/** The crew's utilisation now. Pure. */
export function crewUtilisation(g: GameState): Utilisation {
  const fn = familyNeeds(g);
  const { homes } = crewSupply(g, fn);
  const mk = monthKey(g.now);
  const people: UtilPerson[] = [];
  for (const c of Object.values(g.crew)) {
    const away = c.status === 'joining' || c.status === 'sick' || c.status === 'leave' || c.status === 'training' || !!c.notice;
    const d28 = blockOf(c, g.now - 28 * DAY);
    const y12 = Object.values(c.blockMonths ?? {}).reduce((s, v) => s + v, 0) / 60;
    people.push({
      id: c.id, name: crewName(c), role: c.role, family: homes.get(c.id) ?? c.ratings[0], base: c.base,
      month: (c.blockMonths?.[mk] ?? 0) / 60, d28, y12, away,
      idle: !away && g.now - c.hired >= 28 * DAY && d28 < UTIL_TYPICAL.idle28,
    });
  }
  const gm = new Map<string, UtilGroup & { sum: number; at: number }>();
  for (const p of people) {
    const key = `${p.base}|${p.family}|${p.role}`;
    const x = gm.get(key) ?? { key, family: p.family, label: familyName(p.family), role: p.role, base: p.base, n: 0, avg28: 0, idle: 0, sum: 0, at: 0 };
    x.n++;
    if (!p.away) {
      x.at++;
      x.sum += p.d28;
    }
    if (p.idle) x.idle++;
    gm.set(key, x);
  }
  const groups = [...gm.values()].map(({ sum, at, ...x }) => ({ ...x, avg28: at ? sum / at : 0 }));
  groups.sort((a, b) => a.base.localeCompare(b.base) || a.label.localeCompare(b.label) || ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const surplus: UtilSurplus[] = [];
  for (const p of crewPlan(g)) {
    for (const r of p.roles) {
      if (r.balance <= 0) continue;
      const pay = Object.values(g.crew).filter((c) => c.role === r.role && homes.get(c.id) === p.family);
      const avg = pay.length ? pay.reduce((s, c) => s + c.salary, 0) / pay.length : 0;
      surplus.push({ family: p.family, label: p.label, role: r.role, n: r.balance, cost: Math.round(r.balance * avg * (1 + BAL.onCosts)) });
    }
  }
  let aircraft = 0;
  for (const f of fn.values()) aircraft += f.aircraft;
  const at = people.filter((p) => !p.away);
  const pil = at.filter((p) => isPilot(p.role));
  const cab = at.filter((p) => !isPilot(p.role));
  const avg = (xs: UtilPerson[], k: 'd28' | 'y12') => (xs.length ? xs.reduce((s, p) => s + p[k], 0) / xs.length : 0);
  const old = (xs: UtilPerson[]) => xs.filter((p) => g.now - (g.crew[p.id]?.hired ?? g.now) >= 365 * DAY);
  const onBooks = people.filter((p) => g.crew[p.id]?.status !== 'joining');
  return {
    people, groups, surplus, aircraft,
    perAircraft: { pilots: aircraft ? onBooks.filter((p) => isPilot(p.role)).length / aircraft : 0, cabin: aircraft ? onBooks.filter((p) => !isPilot(p.role)).length / aircraft : 0 },
    avg28: { pilots: avg(pil, 'd28'), cabin: avg(cab, 'd28') },
    avg12: { pilots: avg(old(pil), 'y12'), cabin: avg(old(cab), 'y12') },
    surplusCost: surplus.reduce((s, x) => s + x.cost, 0),
    idle: people.filter((p) => p.idle).length,
  };
}

const ROLE_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];

/**
 * The hold on hiring (the crew desk's round-up and its peak hires): crew of this family and rank at work flew under
 * UTIL_TYPICAL.hold28 hours on average in 28 days, with some idle. Returns why (plain), or null to hire. Pure.
 */
export function hireHold(g: GameState, family: RatingFamily, role: Role, u = crewUtilisation(g)): { why: string; idle: number; avg: number } | null {
  const xs = u.people.filter((p) => p.family === family && (p.role === role || (role === 'FO' && p.role === 'CRP')) && !p.away);
  if (xs.length < 4) return null;
  const avg = xs.reduce((s, p) => s + p.d28, 0) / xs.length;
  const idle = xs.filter((p) => p.idle).length;
  if (avg >= UTIL_TYPICAL.hold28 || idle < 2) return null;
  return { why: `${familyName(family)} ${ROLE_WORDS[role][1]} flew ${Math.round(avg)} h on average in the last 28 days; ${idle} flew under ${UTIL_TYPICAL.idle28} h`, idle, avg };
}

const ROLE_WORDS: Record<Role, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'], PUR: ['purser', 'pursers'], CC: ['cabin crew member', 'cabin crew'],
};
export const roleWords = (role: Role, n: number) => `${n} ${ROLE_WORDS[role][n === 1 ? 0 : 1]}`;

/** Crew of a family and rank who could go first: at work, not on notice, the least flown in 28 days first (then the newest). */
function candidates(g: GameState, family: RatingFamily, role: Role, u: Utilisation): CrewMember[] {
  return u.people
    .filter((p) => p.family === family && p.role === role && !p.away)
    .sort((a, b) => a.d28 - b.d28 || (g.crew[b.id].hired - g.crew[a.id].hired) || (a.id < b.id ? -1 : 1))
    .map((p) => g.crew[p.id]);
}

export interface UnpaidQuote { ids: string[]; asked: number; months: number; saved: number; from: number; to: number; why: string | null }

/**
 * Unpaid leave offered to up to `n` of a group's least-flown crew for `months`: about three in five take it (decided by
 * person and day, not by chance). They stay home without pay, their trips are crewed again, and their morale is a touch
 * better (they asked for the time). Pure.
 */
export function unpaidQuote(g: GameState, family: RatingFamily, role: Role, n: number, months: number): UnpaidQuote {
  const u = crewUtilisation(g);
  const from = Math.ceil((g.now + UNPAID.startDays * DAY) / DAY) * DAY;
  const to = from + Math.round(months * 30.44) * DAY;
  const day = Math.floor(g.now / DAY);
  const pool = candidates(g, family, role, u).slice(0, Math.max(0, Math.round(n * 2)));
  const ids = pool.filter((c) => hashUnit(`unpaid:${c.id}:${day}`) < UNPAID.takes).slice(0, n).map((c) => c.id);
  const saved = Math.round(ids.reduce((s, id) => s + g.crew[id].salary, 0) * (1 + BAL.onCosts) * months);
  const why = !pool.length ? 'Nobody of this rank is free to ask' : !ids.length ? 'Nobody asked would take it now' : null;
  return { ids, asked: pool.length, months, saved, from, to, why };
}

export function offerUnpaidLeave(g: GameState, family: RatingFamily, role: Role, n: number, months: number): ActionResult {
  const q = unpaidQuote(g, family, role, n, months);
  if (q.why) return { ok: false, error: q.why };
  for (const id of q.ids) {
    const c = g.crew[id];
    (c.blocks ??= []).push({ from: q.from, to: q.to, why: 'leave', furlough: true });
    removeCrew(g, id, q.from, q.to, `Unpaid leave from ${fmtDate(q.from)}`);
    moraleShock(g, c, 'pay', UNPAID.morale);
  }
  touchCrew(g);
  pushMessage(g, {
    tone: 'info', cat: 'crew', title: `${roleWords(role, q.ids.length)} on unpaid leave`,
    body: `${q.ids.map((id) => crewName(g.crew[id])).slice(0, 3).join(', ')}${q.ids.length > 3 ? ` and ${q.ids.length - 3} more` : ''} take ${q.months} month${q.months === 1 ? '' : 's'} off without pay from ${fmtDate(q.from)}: about $${Math.round(q.saved / 1000)}K saved. They asked for it; their trips are crewed again.`,
  });
  return { ok: true, msg: `${roleWords(role, q.ids.length)} take unpaid leave` };
}

export interface RedundancyQuote { ids: string[]; noticeDays: number; leaves: number; severance: number; saved: number; why: string | null }

/** Months of pay a crew member's severance is: REDUNDANCY.perYear a year served, at least minMonths. Pure. */
export const severanceMonths = (g: GameState, c: CrewMember) => Math.max(REDUNDANCY.minMonths, (REDUNDANCY.perYear * (g.now - c.hired)) / (365 * DAY));

/**
 * Redundancy for `n` of a group (the least flown, then the newest): notice (90 days for pilots, 60 for cabin crew,
 * flying as rostered until then), severance of half a month's pay a year served (at least a month's), and morale:
 * their colleagues of the same rank and type lose more than the rest. Pure.
 */
export function redundancyQuote(g: GameState, family: RatingFamily, role: Role, n: number): RedundancyQuote {
  const u = crewUtilisation(g);
  const s = u.surplus.find((x) => x.family === family && x.role === role)?.n ?? 0;
  const ids = candidates(g, family, role, u).slice(0, Math.min(n, s)).map((c) => c.id);
  const days = isPilot(role) ? REDUNDANCY.noticeDays.pilot : REDUNDANCY.noticeDays.cabin;
  const severance = Math.round(ids.reduce((t, id) => t + g.crew[id].salary * severanceMonths(g, g.crew[id]), 0));
  const saved = Math.round(ids.reduce((t, id) => t + g.crew[id].salary, 0) * (1 + BAL.onCosts));
  const why = !s ? `No ${ROLE_WORDS[role][1]} beyond what the ${familyName(family)} flying needs` : !ids.length ? 'Nobody of this rank is at work to let go' : null;
  return { ids, noticeDays: days, leaves: g.now + days * DAY, severance, saved, why };
}

export function makeRedundant(g: GameState, family: RatingFamily, role: Role, n: number): ActionResult {
  const q = redundancyQuote(g, family, role, n);
  if (q.why) return { ok: false, error: q.why };
  for (const id of q.ids) {
    const c = g.crew[id];
    c.notice = { given: g.now, leaves: q.leaves, redundant: true };
    redundantHook(g, c);
  }
  post(g, 'salaries', -q.severance);
  const gone = new Set(q.ids);
  for (const c of Object.values(g.crew)) {
    if (gone.has(c.id) || c.status === 'joining') continue;
    const same = c.role === role && c.ratings.includes(family);
    moraleShock(g, c, 'pay', same ? REDUNDANCY.moraleGroup : REDUNDANCY.moraleAll);
  }
  touchCrew(g);
  pushMessage(g, {
    tone: 'warn', cat: 'crew', cue: 'notice', title: `${roleWords(role, q.ids.length)} made redundant`,
    body: `${q.ids.map((id) => crewName(g.crew[id])).slice(0, 3).join(', ')}${q.ids.length > 3 ? ` and ${q.ids.length - 3} more` : ''} leave on ${fmtDate(q.leaves - 1)} after ${q.noticeDays} days' notice, flying as rostered until then. Severance $${Math.round(q.severance / 1000)}K paid now; their pay (about $${Math.round(q.saved / 1000)}K a month) stops when they leave. Morale ${REDUNDANCY.moraleGroup} for their colleagues, ${REDUNDANCY.moraleAll} for everyone else.`,
  });
  return { ok: true, msg: `${roleWords(role, q.ids.length)} on notice` };
}

/** Hook (crew/index.ts: the resignation's): work past the leave date released. */
let redundantHook: (g: GameState, c: CrewMember) => void = () => {};
export function setRedundantHook(f: typeof redundantHook): void {
  redundantHook = f;
}
