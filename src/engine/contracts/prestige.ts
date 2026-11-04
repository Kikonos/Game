// v0.16 the client prestige ladder (UPDATE-0.16.md §B). Every client sits at a level 1–4 (brochure work · the charter
// market · national carriers and agencies · the majors and governments); our own level comes from the visibility we
// earn flying for them, our record and our approvals, and never drops. Offers come at our level with the odd stretch
// offer one level up.
//
// Step 0 (the shared skeleton): the levels are assigned to clients and derived for us FOR REAL (load and new game);
// the effects on offers (weights, stretch, pay, penalties) and the level-up messages are neutral stubs the `clients`
// lane fills in. Nothing here draws from the RNG or takes an id, so a game plays on exactly as before.

import { TENDER_CLIENT_SEEDS } from '../../data/fairs';
import { CLIENT_SEEDS, CLIENT_SEEDS_B1, CLIENT_SEEDS_V014, CLIENT_SEEDS_V08, CLIENT_SEEDS_V0121, type ClientSeed } from '../../data/naming';
import { BAL } from '../core/balance';
import { statsV016 } from '../core/stats016';
import { DAY, yearOf } from '../core/time';
import type { Client, Contract, GameState, PlayerPrestige, Prestige } from '../core/types';
import { aocSince } from './relations';

const P = BAL.v016.prestige;

export const PRESTIGE_LEVELS: Prestige[] = [1, 2, 3, 4];
/** Player words for each level. */
export const PRESTIGE_NAME: Record<Prestige, string> = { 1: 'Brochure work', 2: 'Charter market', 3: 'National carriers', 4: 'Majors and governments' };
/** One line on who sits there. */
export const PRESTIGE_WHO: Record<Prestige, string> = {
  1: 'Tour operators, holiday brochures and low-cost airlines',
  2: 'Leisure airlines, sports clubs, promoters, agencies and companies',
  3: 'National carriers, aid agencies and the home states\' ministries',
  4: 'The majors, big governments and defence ministries',
};

/** Small states whose foreign and defence ministries are everyday ACMI clients (level 3, not 4). */
const HOME_STATES = new Set(['PT', 'ES', 'LT', 'MT', 'LV', 'CZ', 'BG', 'EE']);

const BY_NAME: Record<string, Prestige> = {};
/** Roles by seed name (clients.ts keeps its own copy; no import either way, so neither module waits on the other). */
const ROLE_BY_NAME: Record<string, ClientSeed['role']> = {};
for (const s of [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1, ...CLIENT_SEEDS_V08, ...CLIENT_SEEDS_V014, ...CLIENT_SEEDS_V0121]) {
  if (s.prestige) BY_NAME[s.name] = s.prestige;
  if (s.role) ROLE_BY_NAME[s.name] = s.role;
}
for (const s of TENDER_CLIENT_SEEDS) if (s.prestige) BY_NAME[s.name] = s.prestige;

/** The level of a client by its seed, else by its kind and role (§B.2). Pure. */
export function seedPrestige(c: Pick<Client, 'name' | 'kind' | 'country'> & { rivalId?: string }, role: ClientSeed['role'] | undefined = undefined): Prestige {
  const byName = BY_NAME[c.name];
  if (byName) return byName;
  if (c.rivalId) return 2;
  switch (c.kind) {
    case 'government':
      if (role === 'aid' || role === 'health' || role === 'polar') return 3;
      return (role === 'foreign' || role === 'defence') && HOME_STATES.has(c.country) ? 3 : 4;
    case 'agency': return role === 'aid' || role === 'health' ? 3 : 2;
    case 'airline': return 3;
    case 'tourOperator': return 1;
    default: return 2;
  }
}

/** A client's level (its stored one, else derived now). Pure. */
export const clientPrestige = (c: Client | undefined): Prestige => (c ? c.prestige ?? seedPrestige(c, ROLE_BY_NAME[c.name]) : 2);

// ---------- our level ----------

/** Our record (visibility, level); created at level 1 with nothing earned. */
export function playerPrestige(g: GameState): PlayerPrestige {
  return (g.company.prestige ??= { level: 1, visibility: 0, levelAt: { 1: aocSince(g) } });
}

/** Whether the level's thresholds hold now (§B.3); level 1 always. Pure. */
export function levelReached(g: GameState, level: Prestige, visibility: number = g.company.prestige?.visibility ?? 0): boolean {
  if (level === 1) return true;
  const t = P.levels[level];
  const months = (g.now - aocSince(g)) / (30.44 * DAY);
  const { reliable, clean } = g.company.reputation;
  return visibility >= t.visibility && (g.stats.contractsDone ?? 0) >= t.contracts && reliable >= t.reliable && clean >= t.clean
    && (!t.iosa || g.company.approvals.includes('iosa')) && months >= t.months;
}

/** The highest level whose thresholds hold now (no memory). Pure. */
export function prestigeLevelFor(g: GameState, visibility?: number): Prestige {
  let out: Prestige = 1;
  for (const l of PRESTIGE_LEVELS) if (levelReached(g, l, visibility)) out = l;
  return out;
}

/** Revenue block minutes a contract has flown (its monthly use). Pure. */
const flownMin = (c: Contract): number => Object.values(c.use).reduce((s, u) => s + (u.blockMin ?? 0), 0);

/** Visibility one contract earns: its block hours and the completion bonus, weighted by the client's level. Pure. */
export function contractVisibility(g: GameState, c: Contract): { amount: number; level: Prestige } {
  const level = clientPrestige(g.clients[c.clientId]);
  return { amount: Math.round(((flownMin(c) / 60) * P.perBH[level] + P.perContract[level]) * 10) / 10, level };
}

/**
 * An older save's record from its history (§B.4): the visibility its completed contracts would have earned, and the
 * level = max(what the thresholds allow, the highest client level with `derivedJobs` completed jobs, the highest with
 * one job less one). Pure.
 */
export function derivePrestige(g: GameState): PlayerPrestige {
  let visibility = 0;
  const jobsAt: Record<Prestige, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const from: Record<Prestige, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'completed' || c.dry) continue;
    const { amount, level } = contractVisibility(g, c);
    visibility += amount;
    from[level] += amount;
    jobsAt[level]++;
  }
  visibility = Math.round(visibility * 10) / 10;
  let level = prestigeLevelFor(g, visibility);
  for (const l of PRESTIGE_LEVELS) {
    if (jobsAt[l] >= P.derivedJobs && l > level) level = l;
    else if (jobsAt[l] >= 1 && l - 1 > level) level = (l - 1) as Prestige;
  }
  const s = statsV016(g);
  for (const l of PRESTIGE_LEVELS) s.visibilityFrom[l] = Math.round((s.visibilityFrom[l] + from[l]) * 10) / 10;
  const levelAt: PlayerPrestige['levelAt'] = {};
  for (const l of PRESTIGE_LEVELS) if (l <= level) levelAt[l] = l === 1 ? aocSince(g) : g.now;
  return { level, visibility, levelAt, derived: true };
}

/**
 * Load (and new game): every client at a level (every creation site sets one too: clients.ts, commercial/state.ts,
 * rivals.ts, so a client added after this pass is never without); our record derived once from history, never lowered.
 */
export function loadPrestige(g: GameState): void {
  for (const c of Object.values(g.clients)) c.prestige ??= seedPrestige(c, ROLE_BY_NAME[c.name]);
  if (!g.company.prestige) g.company.prestige = derivePrestige(g);
  const p = g.company.prestige;
  p.levelAt ??= {};
  p.levelAt[1] ??= aocSince(g);
  statsV016(g);
}

/** Visibility earned (never decays), counted by the level it came from. Action-side. */
export function addVisibility(g: GameState, amount: number, from: Prestige): void {
  if (amount <= 0) return;
  const p = playerPrestige(g);
  p.visibility = Math.round((p.visibility + amount) * 10) / 10;
  const s = statsV016(g);
  s.visibilityFrom[from] = Math.round((s.visibilityFrom[from] + amount) * 10) / 10;
}

/** accept.ts completeContract: the contract's visibility, once. */
export function onContractDoneVisibility(g: GameState, c: Contract): void {
  if (c.visibilityDone || c.dry) return;
  c.visibilityDone = true;
  const { amount, level } = contractVisibility(g, c);
  addVisibility(g, amount, level);
}

// ---------- effects on offers (lane `clients` fills these in; neutral until then) ----------

/**
 * The weight of a client in the ordinary offer draw by its level against ours (§B.3: 1 at our level, less below, a
 * stretch one level up, never two). Step 0: 1 for everyone (today's draw).
 */
export function prestigeOfferWeight(_g: GameState, _c: Client): number {
  return 1;
}

/** A draft from a client one level above ours is a stretch offer (at most one in `stretchDays`). Step 0: nothing. */
export function markStretch(_g: GameState, _d: { client: Client; stretch?: true }): void {}

/** The rate part of a client's level (−4 % … +8 %). Step 0: 0 (today's prices). */
export function prestigePayPct(_level: Prestige): number {
  return 0;
}

/** Penalties and relation hits scale with the client's level. Step 0: 1. */
export function prestigePenaltyX(_level: Prestige): number {
  return 1;
}

/** What a level 3 / 4 client checks before it signs (plain lines) and whether we pass. Pure. */
export function prestigeRequirements(g: GameState, level: Prestige): { line: string; ok: boolean }[] {
  const r = P.reqs[level];
  if (!r) return [];
  const { reliable, clean } = g.company.reputation;
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering');
  const year = yearOf(g.now);
  const age = fleet.length ? fleet.reduce((s, a) => s + Math.max(0, year - a.builtYear), 0) / fleet.length : 0;
  const out = [
    { line: `IOSA registration`, ok: g.company.approvals.includes('iosa') },
    { line: `Reliable ${r.reliable} or more (now ${Math.round(reliable)})`, ok: reliable >= r.reliable },
    { line: `Fleet average age ${r.maxAge} years or less (now ${Math.round(age)})`, ok: age <= r.maxAge },
  ];
  if (r.clean) out.push({ line: `Clean record ${r.clean} or more (now ${Math.round(clean)})`, ok: clean >= r.clean });
  return out;
}

export interface PrestigeView {
  level: Prestige;
  name: string;
  who: string;
  visibility: number;
  /** The next level and what it still needs (plain lines), null at the top. */
  next: { level: Prestige; name: string; need: { label: string; have: number; need: number; ok: boolean }[]; missing: string[] } | null;
}

/** The Prestige card (Company › Overview). Pure. */
export function prestigeView(g: GameState): PrestigeView {
  const p = g.company.prestige ?? { level: 1 as Prestige, visibility: 0, levelAt: {} };
  const level = p.level;
  let next: PrestigeView['next'] = null;
  if (level < 4) {
    const nl = (level + 1) as Prestige;
    const t = P.levels[nl];
    const months = Math.floor((g.now - aocSince(g)) / (30.44 * DAY));
    const { reliable, clean } = g.company.reputation;
    const done = g.stats.contractsDone ?? 0;
    const iosa = g.company.approvals.includes('iosa');
    const need = [
      { label: 'Visibility', have: Math.round(p.visibility), need: t.visibility, ok: p.visibility >= t.visibility },
      { label: 'Contracts done', have: done, need: t.contracts, ok: done >= t.contracts },
      { label: 'Reliable', have: Math.round(reliable), need: t.reliable, ok: reliable >= t.reliable },
      { label: 'Months on the AOC', have: months, need: t.months, ok: months >= t.months },
      ...(t.clean ? [{ label: 'Clean record', have: Math.round(clean), need: t.clean, ok: clean >= t.clean }] : []),
      ...(t.iosa ? [{ label: 'IOSA registration', have: iosa ? 1 : 0, need: 1, ok: iosa }] : []),
    ];
    const missing = need.filter((x) => !x.ok).map((x) => (x.label === 'IOSA registration' ? 'IOSA registration' : `${x.label} ${x.need} (now ${x.have})`));
    next = { level: nl, name: PRESTIGE_NAME[nl], need, missing };
  }
  return { level, name: PRESTIGE_NAME[level], who: PRESTIGE_WHO[level], visibility: Math.round(p.visibility), next };
}

/** Daily: level-ups with their message and card (lane `clients`). Step 0: nothing (no message, no level change). */
export function dailyPrestige(_g: GameState): void {}
