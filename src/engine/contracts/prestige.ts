// v0.16 the client prestige ladder (UPDATE-0.16.md §B). Every client sits at a level 1–4 (brochure work · the charter
// market · national carriers and agencies · the majors and governments); our own level comes from the visibility we
// earn flying for them, our record and our approvals, and never drops. Offers come at our level with the odd stretch
// offer one level up.
//
// The levels are assigned to clients and derived for us on load and at a new game; the offer draw weighs clients by
// their level against ours (one stretch offer a month from a level up), their pay and penalties follow their level, and
// a level-up is a message with its card and the `ladder` chime. Nothing here draws from the RNG (offers.ts draws).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { TENDER_CLIENT_SEEDS } from '../../data/fairs';
import { CLIENT_SEEDS, CLIENT_SEEDS_B1, CLIENT_SEEDS_V014, CLIENT_SEEDS_V016, CLIENT_SEEDS_V08, CLIENT_SEEDS_V0121, type ClientSeed } from '../../data/naming';
import { BAL } from '../core/balance';
import { chance } from '../core/rng';
import { hash } from '../core/util';
import { statsV016 } from '../core/stats016';
import { DAY, yearOf } from '../core/time';
import { pushMessage } from '../core/messages';
import type { ApprovalId, Client, Contract, GameState, PlayerPrestige, Prestige, Stars } from '../core/types';
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
/** v0.16.1 stars by seed name, where the seed says (a flagship carrier 5, a small brochure 0). */
const STARS_BY_NAME: Record<string, Stars> = {};
/** Roles by seed name (clients.ts keeps its own copy; no import either way, so neither module waits on the other). */
const ROLE_BY_NAME: Record<string, ClientSeed['role']> = {};
// (v0.16.1 the v0.16 seeds too: Air France read by name was a plain airline, level 3.)
for (const s of [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1, ...CLIENT_SEEDS_V08, ...CLIENT_SEEDS_V014, ...CLIENT_SEEDS_V0121, ...CLIENT_SEEDS_V016]) {
  if (s.prestige) BY_NAME[s.name] = s.prestige;
  if (s.stars !== undefined) STARS_BY_NAME[s.name] = s.stars;
  if (s.role) ROLE_BY_NAME[s.name] = s.role;
}
for (const s of TENDER_CLIENT_SEEDS) if (s.prestige) BY_NAME[s.name] = s.prestige;

/** v0.24 the home state's ministries that call a local operator from the start (prestigeOfferWeight). */
const HOME_ROLES = new Set<string>(['foreign', 'defence']);

/** v0.24 seeds whose level changed since they were released (loadPrestige moves an older save's client). */
const RELEVELLED = new Set(['Frontex']);

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

// ---------- stars (v0.16.1) ----------
// The four levels stay the engine's (gating, weights, pay); the player sees a finer star rating per client: level 1 is
// 0★ (small brochures, tiny tour operators) or 1★ (the big tour operators, low-cost airlines), 2 → 2★, 3 → 3★, level 4
// is 4★ (the majors) or 5★ (flagship carriers, head-of-state, government and military work).

/** The big tour operators (1★; the rest of level 1's tour operators are 0★ unless their seed says). */
const BIG_BROCHURE = /^(TUI\b|Jet2holidays|DER Touristik|Apollo \(DER|Coral Travel|Anex Tour|Alpitour|Sunweb|alltours|Schauinsland|Corendon$|Itaka|Rainbow Tours|Sunwing|H\.I\.S\.)/;

/** The stars a client of this level shows (the level's lowest band when nothing finer is known). Pure. */
export const STARS_OF_LEVEL: Record<Prestige, Stars> = { 1: 0, 2: 2, 3: 3, 4: 4 };
/** The level a star band belongs to (the filter and the ladder read levels). Pure. */
export const LEVEL_OF_STARS: Record<Stars, Prestige> = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 4, 5: 4 };
/** Player words for each star band. */
export const STARS_NAME: Record<Stars, string> = { 0: 'Small brochures', 1: 'Big tour operators and low-cost', 2: 'Charter market', 3: 'National carriers', 4: 'The majors', 5: 'Flagships and governments' };
/** '3 of 5 stars' (accessible label, exports). Pure. */
export const starsLabel = (n: Stars): string => `${n} of 5 stars`;
/** '★★★☆☆' for plain text (messages). Pure. */
export const starsText = (n: Stars): string => '★'.repeat(n) + '☆'.repeat(5 - n);

/** A client's stars from its seed, else derived from its level, kind and role. Pure. */
export function seedStars(c: Pick<Client, 'name' | 'kind' | 'country'> & { rivalId?: string; prestige?: Prestige }, role: ClientSeed['role'] | undefined = ROLE_BY_NAME[c.name]): Stars {
  const byName = STARS_BY_NAME[c.name];
  if (byName !== undefined) return byName;
  const level = c.prestige ?? seedPrestige(c, role);
  if (level === 1) return c.kind === 'airline' || (c.kind === 'tourOperator' && BIG_BROCHURE.test(c.name)) ? 1 : 0;
  if (level === 4) return c.kind === 'government' || role === 'presidency' || role === 'defence' ? 5 : 4;
  return STARS_OF_LEVEL[level];
}

/** The stars a new client gets at creation (its seed's, else derived), so a fresh game and a loaded one agree. Pure. */
export function seedClientStars(s: Pick<Client, 'name' | 'kind' | 'country'> & { role?: ClientSeed['role']; prestige?: Prestige; stars?: Stars; rivalId?: string }): Stars {
  return s.stars ?? seedStars({ name: s.name, kind: s.kind, country: s.country, rivalId: s.rivalId, prestige: s.prestige ?? seedPrestige(s, s.role ?? ROLE_BY_NAME[s.name]) }, s.role ?? ROLE_BY_NAME[s.name]);
}

/** A client's stars (its stored ones, else derived now). Pure. */
export const clientStars = (c: Client | undefined): Stars => (c ? c.stars ?? seedStars(c) : 2);

/** Our own stars: the highest band our level reaches (level 4 reaches the flagships). Pure. */
export const PLAYER_STARS: Record<Prestige, Stars> = { 1: 1, 2: 2, 3: 3, 4: 5 };
export const playerStars = (g: GameState): Stars => PLAYER_STARS[playerLevel(g)];
/** The next star band above ours and the level it needs (null at the top). Pure. */
export function nextStars(g: GameState): { stars: Stars; level: Prestige } | null {
  const lv = playerLevel(g);
  return lv >= 4 ? null : { stars: PLAYER_STARS[(lv + 1) as Prestige], level: (lv + 1) as Prestige };
}

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
  for (const c of Object.values(g.clients)) {
    // v0.24 re-levelled seeds (Frontex 3 → 2: its return flights are bought from charter operators): an older save's
    // client follows its seed while we have not flown for it.
    if (RELEVELLED.has(c.name) && !c.jobs && c.prestige !== undefined && BY_NAME[c.name] && c.prestige !== BY_NAME[c.name]) {
      c.prestige = BY_NAME[c.name];
      c.stars = seedStars({ ...c, prestige: c.prestige });
    }
    c.prestige ??= seedPrestige(c, ROLE_BY_NAME[c.name]);
    c.stars ??= seedStars(c);
  }
  // v0.16.1 the filter's minimum level becomes a minimum of stars (the same clients hidden).
  if (g.filter?.minPrestige) {
    g.filter.minStars ??= STARS_OF_LEVEL[g.filter.minPrestige] || 2;
    delete g.filter.minPrestige;
  }
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

// ---------- effects on offers ----------

/**
 * The ladder's effects on the market (weights, stretch, IOSA asked, pay, penalties, relation hits). Off under vitest
 * so the offer-flow fixtures of every suite hold as before v0.16 (prestige.test.ts switches them on); on in the game,
 * the bot and the invariants script. The levels, the visibility and the level-ups themselves are never off.
 */
export const PRESTIGE_GATE = { on: !(typeof process !== 'undefined' && process.env?.VITEST) };

/** Our level now (level 1 before the record exists). Pure. */
export const playerLevel = (g: GameState): Prestige => g.company.prestige?.level ?? 1;

/** Whether a stretch offer may be made now: none in the last `stretchDays`. Pure. */
export function stretchOpen(g: GameState): boolean {
  const at = g.company.prestige?.stretchAt;
  return at === undefined || g.now - at >= P.stretchDays * DAY;
}

/** A client one level above ours we have not flown for yet: its offer would be a stretch offer. Pure. */
export const isStretchClient = (g: GameState, c: Client): boolean => clientPrestige(g.clients[c.id] ?? c) === playerLevel(g) + 1 && !(g.clients[c.id] ?? c).jobs;

/**
 * The weight of a client in the ordinary offer draw by its level against ours (§B.3): 1 at our level, 0.5 / 0.25 / 0.1
 * one / two / three below, 0.1 one above while a stretch offer is open (at most one in `stretchDays`), 0 two above.
 * A client we have flown for keeps calling whatever its level (they know us). Pure.
 */
export function prestigeOfferWeight(g: GameState, c: Client): number {
  if (!PRESTIGE_GATE.on) return 1;
  const cur = g.clients[c.id] ?? c;
  // v0.24 our own state's foreign and defence ministries (level 3 at most) know the operators at home: they call at our level from the start
  // (player at Malta: "no government contracts offered"). The big states' level-4 ministries keep the ladder.
  if (cur.kind === 'government' && HOME_ROLES.has(ROLE_BY_NAME[cur.name] ?? '') && clientPrestige(cur) <= 3 && cur.country === AIRPORT_BY_CODE[g.company.homeBase]?.country) return P.weight['0'];
  const diff = clientPrestige(cur) - playerLevel(g);
  if (diff <= 0) return P.weight[String(Math.max(-3, diff))] ?? 0;
  if (cur.jobs) return P.weight['0'];
  // v0.24 a national carrier or a major (a level 3–4 airline) one or two levels up shows itself now and then, outside
  // the monthly stretch slot (not a stretch offer). Before IOSA is filed its offer asks for IOSA (markStretch, thinned
  // by iosaKeep, and for a Newcomer by newcomerReach): a look at what the registration opens. Once filed or held it
  // keeps calling at the same weight, no longer thinned (a national carrier takes the filing, so its work can be
  // flown; a major still wants IOSA held): filing opens that work up instead of hiding it. A level-2 airline asks no
  // IOSA: it keeps the ladder (the stretch slot only).
  const show = diff <= 2 && clientPrestige(cur) >= 3 && asksIosa(cur) && !cur.rivalId ? P.iosaShow : 0;
  if (diff === 1) return stretchOpen(g) ? Math.max(P.weight['1'], show) : show;
  return show;
}

/** v0.24 the clients that ask a new operator for IOSA registration: airlines (IATA members audit their wet lessors to
 *  the IOSA standards and take the registration as the proof). Governments, the UN agencies and the aid bodies charter
 *  through their own checks (an EU AOC, insurance, often their own audit), not IOSA. Pure. */
export const asksIosa = (c: Pick<Client, 'kind'>): boolean => c.kind === 'airline';

/**
 * A draft's prestige marks (offers.ts generateOffer, before finalize): a client one level above ours (not yet flown
 * for) makes it a stretch offer while the month's stretch window is open, whichever way it was asked (a rival hiring
 * us is a peer, never a stretch); a national carrier or a major (level 3–4 airline) we have not flown for asks for
 * IOSA registration: a major wants it held, a national carrier is content with it filed (feasibility then says what
 * is missing). Clients we have flown for ask nothing new.
 *
 * v0.24 stage-aware (player: "a lot of IOSA contracts offered when I don't have IOSA yet"): with IOSA neither held
 * nor filed, only a share of those asks reach us (BAL.v016.prestige.iosaKeep, a side roll): enough to show what IOSA
 * brings. Returns 'drop' for the others (offers.ts draws another job; a lead, tender or event asked of that client
 * does not come). Once IOSA is filed or held, they all come. `agreed`: the client already said yes (a lead's own
 * offer, a pitch answered yes): the roll was made when the lead was quoted, so the ask always comes.
 */
export function markStretch(g: GameState, d: { client: Client; stretch?: true; iosaAsked?: true; req?: { approvals: ApprovalId[] } }, agreed = false): 'drop' | undefined {
  const cur = g.clients[d.client.id] ?? d.client;
  if (!PRESTIGE_GATE.on || cur.jobs) return undefined;
  const lv = clientPrestige(cur);
  if (lv === playerLevel(g) + 1 && !cur.rivalId && stretchOpen(g)) d.stretch = true;
  if (lv >= 3 && asksIosa(cur) && d.req && !d.req.approvals.includes('iosa') && !g.company.approvals.includes('iosa')) {
    const filed = g.company.pendingApprovals.some((p) => p.id === 'iosa');
    if (lv === 4 || !filed) {
      if (!filed && !agreed && !chance({ rng: hash(`${g.seed}:iosa:${g.seq}:${g.now}:${cur.id}`) | 0 }, P.iosaKeep)) return 'drop';
      d.req.approvals.push('iosa');
      d.iosaAsked = true;
    }
  }
  return undefined;
}

/** offers.ts: a stretch offer reached the market: the next one waits `stretchDays`. Action-side. */
export function noteStretch(g: GameState, o: { stretch?: true }): void {
  if (!o.stretch) return;
  playerPrestige(g).stretchAt = g.now;
  statsV016(g).stretchOffers++;
}

/** The rate part of a client's level (−4 % brochure work … +8 % majors and governments). Pure. */
export function prestigePayPct(level: Prestige): number {
  return PRESTIGE_GATE.on ? P.payPct[level] ?? 0 : 0;
}

/** Delay penalties scale with the client's level (× 0.8 … × 1.6). Pure. */
export function prestigePenaltyX(level: Prestige): number {
  return PRESTIGE_GATE.on ? P.penaltyX[level] ?? 1 : 1;
}

/** Relation hits for our failures scale with the client's level (× 1 … × 1.5; relations.ts bumpClient). Pure. */
export const prestigeRelationX = (level: Prestige): number => (PRESTIGE_GATE.on ? P.relationX[level] ?? 1 : 1);

/** Player words for the rate line: '+4 % rate (national carrier, included)'. Pure. */
export const PRESTIGE_SHORT: Record<Prestige, string> = { 1: 'brochure work', 2: 'charter market', 3: 'national carrier', 4: 'major or government' };

/** What a level 3 / 4 client checks before it signs (plain lines) and whether we pass. Pure. */
export function prestigeRequirements(g: GameState, level: Prestige, kind: Client['kind'] = 'airline'): { line: string; ok: boolean }[] {
  const r = P.reqs[level];
  if (!r) return [];
  const { reliable, clean } = g.company.reputation;
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering');
  const year = yearOf(g.now);
  const age = fleet.length ? fleet.reduce((s, a) => s + Math.max(0, year - a.builtYear), 0) / fleet.length : 0;
  const held = g.company.approvals.includes('iosa');
  const filed = g.company.pendingApprovals.some((p) => p.id === 'iosa');
  // v0.24 IOSA is an airline's check (asksIosa); a ministry or an aid body looks at the rest.
  const out = [
    ...(asksIosa({ kind }) ? [{ line: level === 4 ? `IOSA registration held${held ? '' : filed ? ' (filed, not yet granted)' : ''}` : `IOSA registration${held ? '' : filed ? ' (filed: enough for now)' : ' (filed is enough)'}`, ok: held || (level === 3 && filed) }] : []),
    { line: `Reliable ${r.reliable} or more (now ${Math.round(reliable)})`, ok: reliable >= r.reliable },
    { line: `Fleet average age ${r.maxAge} years or less (now ${Math.round(age)})`, ok: age <= r.maxAge },
  ];
  if (r.clean) out.push({ line: `Clean record ${r.clean} or more (now ${Math.round(clean)})`, ok: clean >= r.clean });
  return out;
}

/** The offer dialog's prestige lines for a client: its level, a stretch note, what a level 3 / 4 client checks. Pure. */
export function offerPrestigeLines(g: GameState, offerId: string): { level: Prestige; stars: Stars; name: string; stretch: boolean; pay: string | null; checks: { line: string; ok: boolean }[] } | null {
  const o = g.offers[offerId];
  const c = o ? g.clients[o.clientId] : undefined;
  if (!o || !c) return null;
  const level = clientPrestige(c);
  const pay = o.prestigePct ? `${o.prestigePct > 0 ? '+' : '−'}${Math.round(Math.abs(o.prestigePct) * 100)} % rate (${PRESTIGE_SHORT[level]}, included)` : null;
  return { level, stars: clientStars(c), name: PRESTIGE_NAME[level], stretch: !!o.stretch, pay, checks: level >= 3 && !c.jobs ? prestigeRequirements(g, level, c.kind) : [] };
}

/** The sales module: a trade fair attended (+15, counted at our level) and a tender won (+40, the client's level). */
export function onFairAttended(g: GameState): void {
  addVisibility(g, P.fair, playerLevel(g));
}
export function onTenderWon(g: GameState, clientId: string): void {
  addVisibility(g, P.tenderWon, clientPrestige(g.clients[clientId]));
}

export interface PrestigeView {
  level: Prestige;
  name: string;
  who: string;
  visibility: number;
  /** Plain lines on what the level brings (pay, penalties, stretch offers). */
  brings: string[];
  /** A level 3–4 player without IOSA: the clients at this level ask for it. */
  iosaNote: string | null;
  /** The next level and what it still needs (plain lines), null at the top. */
  next: { level: Prestige; name: string; need: { label: string; have: number; need: number; ok: boolean }[]; missing: string[] } | null;
}

/** '+4 %' / '−4 %' / '0 %'. */
const pctWord = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v) * 100)} %`;

/** What flying at a level brings, in player words. Pure. */
export function levelBrings(level: Prestige): string[] {
  const pay = P.payPct[level] ?? 0;
  const pen = P.penaltyX[level] ?? 1;
  return [
    `Rates ${pay ? pctWord(pay) : 'as quoted'} for ${PRESTIGE_SHORT[level]} clients`,
    pen === 1 ? 'Normal delay penalties' : `Delay penalties × ${pen}${pen > 1 ? ' and a harder relation hit when we fail' : ''}`,
    level < 4 ? `One stretch offer a month from a ${PRESTIGE_SHORT[(level + 1) as Prestige]} (more stars than yours)` : 'Every client in the market calls',
  ];
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
    const missing = need.filter((x) => !x.ok).map((x) => (x.label === 'IOSA registration' ? 'IOSA registration held' : `${x.label} ${x.need.toLocaleString('en-US')} (now ${x.have.toLocaleString('en-US')})`));
    next = { level: nl, name: PRESTIGE_NAME[nl], need, missing };
  }
  const iosaHeld = g.company.approvals.includes('iosa');
  const iosaFiled = g.company.pendingApprovals.some((x) => x.id === 'iosa');
  const iosaNote = level >= 3 && !iosaHeld ? (iosaFiled ? 'IOSA registration filed: national carriers take that for now; the majors want it granted.' : 'New national carriers ask for IOSA registration: file it under Other approvals.') : null;
  return { level, name: PRESTIGE_NAME[level], who: PRESTIGE_WHO[level], visibility: Math.round(p.visibility), brings: levelBrings(level), iosaNote, next };
}

/** The level-up message body: what it brings and what the next level needs. Pure. */
export function levelUpText(g: GameState, level: Prestige): { title: string; body: string } {
  const who = PRESTIGE_WHO[level].charAt(0).toLowerCase() + PRESTIGE_WHO[level].slice(1);
  const brings = levelBrings(level).map((x) => x.charAt(0).toLowerCase() + x.slice(1)).join('; ');
  const v = prestigeView({ ...g, company: { ...g.company, prestige: { ...playerPrestige(g), level } } });
  const nextLine = v.next ? ` Next, ${v.next.name}: ${v.next.missing.length ? v.next.missing.join(', ') : 'every requirement met'}.` : ' This is the top of the ladder.';
  return { title: `New rating: ${starsText(PLAYER_STARS[level])} ${PRESTIGE_NAME[level]}`, body: `We are flying for ${who} now. It brings: ${brings}.${nextLine}` };
}

/**
 * Daily: one level up at a time when the next level's thresholds hold (never down), told as a card with the `ladder`
 * chime; a contract signed off a stretch offer is counted once.
 */
export function dailyPrestige(g: GameState): void {
  const p = playerPrestige(g);
  // A stretch offer signed (the offer stays 14 days after closing; the contract remembers for good).
  for (const o of Object.values(g.offers)) {
    if (!o.stretch || o.status !== 'accepted') continue;
    const c = Object.values(g.contracts).find((k) => k.offerId === o.id);
    if (c && !c.stretch) {
      c.stretch = true;
      statsV016(g).stretchSigned++;
    }
  }
  if (p.level >= 4 || g.gameOver) return;
  const nl = (p.level + 1) as Prestige;
  if (!levelReached(g, nl)) return;
  p.level = nl;
  p.levelAt[nl] = g.now;
  const { title, body } = levelUpText(g, nl);
  pushMessage(g, { tone: 'good', cat: 'commercial', topic: 'ladder', title, body, cue: 'ladder' });
}
