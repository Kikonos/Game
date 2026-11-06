// v0.17 market tightness per type (UPDATE-0.17.md §A; lane `supply`). Each type has a tightness from 0 (aircraft easy
// to find) to 1 (none to be had), stored in g.leasing.tight. It moves monthly toward a target set by the market phase
// and the 2026–27 narrowbody easing; the season and today's supply shocks are added when it is read (tightNow). It
// drives the lessor calls' weights, the rent, the time an aircraft comes free and the extension rent.
// With BAL.v017.on false (bot --market=v16) tightNow is the type's scarcity: the v0.16 market exactly.

import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { SUPPLY_EVENT_TPLS } from '../../data/worldEvents';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { chance, gaussian, type RngHolder } from '../core/rng';
import { DAY, monthKey, toDate, yearOf } from '../core/time';
import type { GameState, Minute, SupplyShock, WorldEvent } from '../core/types';
import { clamp } from '../core/util';
import { eligibleTypes, shortName } from '../ops/market';
import { onAirlineFailure } from './batches';
import { leasingSide } from './side';

const S = () => BAL.v017.supply;
/** Zones near the Gulf: a war there lengthens block times between Europe and Asia (§A.3). */
const GULF_ZONES = ['iraq', 'iran', 'yemen', 'syria', 'levant'];

/** The type's base tightness (§A.2); a type missing from the table falls back on its scarcity. Pure. */
export function baseTight(typeId: string): number {
  return S().base[typeId] ?? typeOf(typeId).scarcity;
}

/** The season's offset at `t` for a body (§A.3: by UTC month, January first). Pure. */
export function seasonTight(body: 'narrow' | 'wide', t: Minute): number {
  const mo = toDate(t).getUTCMonth();
  return (body === 'wide' ? S().seasonWide : S().seasonNarrow)[mo] ?? 0;
}

/** The stored tightness (no season, no shocks): the monthly value, or the base on a save that has none yet. Pure. */
export function storedTight(g: GameState, typeId: string): number {
  return g.leasing?.tight[typeId] ?? baseTight(typeId);
}

/**
 * Tightness at `t` (default now), 0 (easy) to 1 (none to be had): the stored value + the season + the supply shocks
 * live then (§A.1). With the v0.17 market off: the type's scarcity (the v0.16 market). Pure.
 */
export function tightNow(g: GameState, typeId: string, t: Minute = g.now): number {
  const ty = typeOf(typeId);
  if (!BAL.v017.on) return ty.scarcity;
  let x = storedTight(g, typeId) + seasonTight(ty.body, t);
  for (const s of shocksOn(g, typeId, t)) x += s.delta;
  return Math.round(clamp(x, 0, 0.999) * 1000) / 1000;
}

/** 'Easy' · 'Normal' · 'Tight' · 'Very tight' · 'Almost none' (§A.1). Pure. */
export function tightWord(x: number): string {
  for (const [lim, w] of S().words) if (x < lim) return w;
  return S().words[S().words.length - 1][1];
}

/** The monthly target of a type: its base + the phase offset + the narrowbody easing of 2026–27 (§A.3). Pure. */
export function targetTight(g: GameState, typeId: string): number {
  const X = S();
  const phase = g.market.cycle?.phase ?? 'steady';
  let target = baseTight(typeId) + (X.phase[phase] ?? 0);
  if (X.easing.types.includes(typeId)) {
    const months = Math.max(0, monthKey(g.now) - monthKey(g.started));
    target += Math.max(X.easing.floor, X.easing.perMonth * Math.min(months, X.easing.months));
  }
  return target;
}

/**
 * Monthly (refreshMarket via monthlyLeasing): each type pulled toward its target with a little noise, on the side
 * stream `tight:<month>` (§A.3); last month's values kept for the outlook's arrows; lapsed shocks dropped; the
 * once-only 777-9 delay (2027–28).
 */
export function stepTightness(g: GameState): void {
  const L = g.leasing;
  if (!L) return;
  const X = S();
  const r = leasingSide(g, `tight:${monthKey(g.now)}`);
  L.prevTight = { ...L.tight };
  for (const t of ACMI_TYPES_LIST) {
    const x = L.tight[t.id] ?? baseTight(t.id);
    const next = x + (targetTight(g, t.id) - x) * X.pull + gaussian(r) * X.noise;
    L.tight[t.id] = Math.round(clamp(next, X.clamp[0], X.clamp[1]) * 10_000) / 10_000;
  }
  L.shocks = L.shocks.filter((s) => s.until > g.now);
  delay777x(g, r);
}

/** The 777-9 slips again (once, between the game start and December 2028; data/worldEvents.ts SUPPLY_EVENT_TPLS). */
function delay777x(g: GameState, r: RngHolder): void {
  const L = g.leasing!;
  const sup = (L.supply ??= {});
  if (sup.delay777x !== undefined) return;
  const y = yearOf(g.now);
  if (y < 2027 || y > 2028) return;
  // An even hazard over the months left to December 2028, so it comes once in that window.
  const left = Math.max(1, (2028 - y) * 12 + (11 - toDate(g.now).getUTCMonth()) + 1);
  if (!chance(r, 1 / left)) return;
  const tpl = SUPPLY_EVENT_TPLS.delay777x;
  const [delta, days] = S().shock.delay777x;
  sup.delay777x = g.now;
  addSupplyShock(g, { typeIds: ['b77w', 'b772'], delta, until: g.now + days * DAY, text: tpl.shockText });
  pushMessage(g, { tone: 'info', cat: 'commercial', topic: 'market', title: tpl.title, body: tpl.body });
}

/** Adds a supply shock (world events, Hajj weeks, failures). */
export function addSupplyShock(g: GameState, s: Omit<SupplyShock, 'id'>): void {
  if (!g.leasing) return;
  g.leasing.shocks.push({ id: nextId(g, 'ss'), ...s });
}

const allIds = () => ACMI_TYPES_LIST.map((t) => t.id);
const wideIds = () => ACMI_TYPES_LIST.filter((t) => t.body === 'wide').map((t) => t.id);

/**
 * Supply shocks from world events (§A.3): ops/world.ts startEvent calls this for every event, commercial/crises.ts for
 * a client's strike or grounding (its administration goes to onAirlineFailure directly). An airline failure releases
 * aircraft (batches.ts: the shock and the batch); the GTF crisis tightens the A320 family; a recession eases every
 * type; a closed airspace or a war near the Gulf tightens widebodies (longer block times need more lift).
 */
export function onSupplyEvent(g: GameState, e: WorldEvent): void {
  if (!BAL.v017.on || !g.leasing) return;
  const K = S().shock;
  const until = Math.max(e.end, g.now + DAY);
  switch (e.kind) {
    case 'airlineFailure':
      onAirlineFailure(g, e);
      return;
    case 'engineCrisis':
      if (e.tpl !== 'engineGtf') return;
      addSupplyShock(g, { typeIds: ['a320neo', 'a321neo'], delta: K.gtfNeo[0], until: g.now + K.gtfNeo[1] * DAY, text: 'GTF groundings: neos parked', eventId: e.id });
      addSupplyShock(g, { typeIds: ['a320ceo', 'b738', 'a321ceo'], delta: K.gtfCeo[0], until: g.now + K.gtfCeo[1] * DAY, text: 'GTF groundings: airlines keep their older jets', eventId: e.id });
      return;
    case 'recession':
      addSupplyShock(g, { typeIds: allIds(), delta: K.recession, until, text: 'Recession: airlines park aircraft', eventId: e.id });
      return;
    case 'airspace':
      addSupplyShock(g, { typeIds: wideIds(), delta: K.airspace, until, text: `${e.title}: longer routes need more widebodies`, eventId: e.id });
      return;
    case 'war':
      if (!e.zoneId || !GULF_ZONES.includes(e.zoneId)) return;
      addSupplyShock(g, { typeIds: wideIds(), delta: K.airspace, until, text: `${e.title}: longer routes need more widebodies`, eventId: e.id });
      return;
    default:
      return;
  }
}

/** The Hajj weeks tighten widebodies (ops/market.ts hajjShock adds it with the demand shock). */
export function hajjSupplyShock(g: GameState, until: Minute, text: string): void {
  if (!BAL.v017.on || !g.leasing) return;
  if (g.leasing.shocks.some((s) => s.text === text)) return;
  addSupplyShock(g, { typeIds: wideIds(), delta: S().shock.hajj, until, text });
}

/** Shocks live at `t` on a type (read by tightNow). Pure. */
export function shocksOn(g: GameState, typeId: string, t: Minute = g.now): SupplyShock[] {
  const fam = typeOf(typeId).family;
  return (g.leasing?.shocks ?? []).filter((s) => s.until > t && (s.typeIds?.includes(typeId) || s.families?.includes(fam)));
}

/** A move of more than this between two months shows as an arrow. */
const TREND_BAND = 0.01;

/**
 * The outlook's supply line (§A.4): the three tightest and the two easiest types we can fly or are one rung from
 * flying, with an arrow against last month. Pure.
 */
export function supplyOutlook(g: GameState): { typeId: string; word: string; trend: -1 | 0 | 1; tight: number }[] {
  if (!BAL.v017.on || !g.leasing) return [];
  const L = g.leasing;
  const seen = new Set<string>();
  const rows: { typeId: string; tight: number }[] = [];
  for (const e of eligibleTypes(g)) {
    if (seen.has(e.t.id)) continue;
    seen.add(e.t.id);
    rows.push({ typeId: e.t.id, tight: tightNow(g, e.t.id) });
  }
  rows.sort((a, b) => b.tight - a.tight || (a.typeId < b.typeId ? -1 : 1));
  const pick = rows.length <= 5 ? rows : [...rows.slice(0, 3), ...rows.slice(-2)];
  return pick.map((x) => {
    const now = L.tight[x.typeId] ?? baseTight(x.typeId);
    const prev = L.prevTight?.[x.typeId];
    const trend: -1 | 0 | 1 = prev === undefined || Math.abs(now - prev) <= TREND_BAND ? 0 : now > prev ? 1 : -1;
    return { typeId: x.typeId, word: tightWord(x.tight), trend, tight: x.tight };
  });
}

/** 'A330-200 very tight ↑ · A320ceo normal ↓' (§A.4). Pure. */
export function supplyText(g: GameState): string {
  return supplyOutlook(g)
    .map((s) => `${shortName(typeOf(s.typeId))} ${s.word.toLowerCase()}${s.trend > 0 ? ' ↑' : s.trend < 0 ? ' ↓' : ''}`)
    .join(' · ');
}
