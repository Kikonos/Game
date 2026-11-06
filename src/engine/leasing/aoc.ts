// v0.17 type families on our AOC and AOC variations (UPDATE-0.17.md §H; lane `deals`).
// - A new game holds its start fleet's families; a loaded save every family in its fleet (no card on load).
// - Types of one family need no variation (A320ceo, A321ceo, A321neo and A320neo are all `A320`).
// - The first widebody family comes with Widebody operations (it puts a widebody type on the operations
//   specification); a second widebody family, and any new narrowbody family, needs a variation: $80K / $150K, 90 / 120
//   days at EASA (45 / 60 UK, 60 / 90 elsewhere), granted at its due date once 2 captains and 2 first officers are rated
//   (4 + 4 for an exotic, §T).
// - Revenue legs of a family not on the AOC are refused at departure (ops/approvalGate.ts gateMisses, `aoc` miss).

import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { ActionResult, AocVariation, GameState, Minute } from '../core/types';
import { ratedPilots } from '../ops/company';
import { regCountry } from '../ops/registration';
import { lockOf } from '../scenario/rules';

const A = () => BAL.v017.aoc;

/** EASA member states (EU 27 and Iceland, Liechtenstein, Norway, Switzerland). */
const EASA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH']);

/** 'easa' · 'uk' · 'other': the authority that varies our AOC (the home base's country). Pure. */
export function aocAuthority(g: GameState): 'easa' | 'uk' | 'other' {
  const c = regCountry(g);
  return c === 'GB' ? 'uk' : EASA.has(c) || !c ? 'easa' : 'other';
}

/** The body a family flies as (the 757/767 counts by the type asked; the family's own types otherwise). Pure. */
export function familyBody(family: RatingFamily, typeId?: string): 'narrow' | 'wide' {
  if (typeId) return typeOf(typeId).body;
  const ts = ACMI_TYPES_LIST.filter((t) => t.family === family);
  return ts.filter((t) => t.body === 'wide').length * 2 >= ts.length && ts.length ? 'wide' : 'narrow';
}

/** The fleet's families (delivering, stored and leased out included) and those of granted variations. Pure. */
export function fleetFamilies(g: GameState): RatingFamily[] {
  const out = new Set<RatingFamily>();
  for (const a of Object.values(g.fleet)) out.add(typeOf(a.typeId).family);
  for (const v of g.company.aocVariations ?? []) if (v.granted) out.add(v.family);
  return [...out].sort();
}

/** Load and new game (§L): the families on the AOC and the variations, defaulted. */
export function loadAoc(g: GameState): void {
  g.company.aocFamilies ??= fleetFamilies(g);
  g.company.aocVariations ??= [];
}

const wideHeld = (g: GameState) => g.company.approvals.includes('widebody') || g.company.pendingApprovals.some((p) => p.id === 'widebody');
/** A family with a widebody in it (the 757/767 counts: the 767 is the widebody of that rating). */
const isWideFamily = (f: RatingFamily) => ACMI_TYPES_LIST.some((t) => t.family === f && t.body === 'wide');

/**
 * The widebody family that comes with Widebody operations (§H): none while a widebody family is already on the AOC;
 * else the family of the first widebody signed (by its id order), or null with none in the fleet. Pure.
 */
export function firstWideFamily(g: GameState): RatingFamily | null {
  if ((g.company.aocFamilies ?? []).some(isWideFamily)) return null;
  let best: { id: string; fam: RatingFamily } | null = null;
  for (const a of Object.values(g.fleet)) {
    const t = typeOf(a.typeId);
    if (t.body !== 'wide') continue;
    const n = a.id;
    if (!best || n.length < best.id.length || (n.length === best.id.length && n < best.id)) best = { id: n, fam: t.family };
  }
  return best?.fam ?? null;
}

/** Families of aircraft that never came through the market (no delivery record: start fleet, scenario, dev). Pure. */
export function unsignedFamilies(g: GameState): Set<RatingFamily> {
  const out = new Set<RatingFamily>();
  for (const a of Object.values(g.fleet)) if (!a.delivery) out.add(typeOf(a.typeId).family);
  return out;
}

/** Rated pilots a variation needs before its grant (more for an exotic family, §T). Pure. */
export function variationCrew(family: RatingFamily): { CPT: number; FO: number } {
  const exotic = BAL.v017.exotic.types.some((id) => typeOf(id).family === family && (family === 'A380' || family === 'B747'));
  return exotic ? BAL.v017.exotic.crew : A().pilots;
}

/** Why a family may not fly revenue at `t` (null: it may) (§H gate). Pure. */
export function aocMiss(g: GameState, family: RatingFamily, t: Minute = g.now): { state: 'missing' | 'waiting' | 'late'; due: Minute | null } | null {
  if (!BAL.v017.on) return null;
  const fams = g.company.aocFamilies;
  if (!fams || fams.includes(family)) return null;
  // An aircraft that never came through the market (the start fleet, a scenario's, a dev one) brings its family.
  if (unsignedFamilies(g).has(family)) return null;
  // The first widebody family rides on Widebody operations (that approval's own gate applies).
  if (isWideFamily(family) && wideHeld(g) && !fams.some(isWideFamily)) {
    const first = firstWideFamily(g);
    if (!first || first === family) return null;
  }
  const v = (g.company.aocVariations ?? []).find((x) => x.family === family && !x.granted);
  if (!v) return { state: 'missing', due: null };
  if (v.done > t) return { state: 'late', due: v.done };
  // Due by then: a future departure counts on the grant when the pilots are rated or booked; today it waits for them.
  const need = variationCrew(family);
  const p = ratedPilots(g, [family], { booked: t > g.now });
  if (p.CPT >= need.CPT && p.FO >= need.FO && t > g.now) return null;
  return { state: 'waiting', due: v.done };
}

/** Whether revenue legs of a family may fly at `t` (§H gate). Pure. */
export function familyOnAoc(g: GameState, family: RatingFamily, t: Minute = g.now): boolean {
  return !aocMiss(g, family, t);
}

/** Whether a family needs a variation to fly: not on the AOC, none granted, not the family riding on Widebody operations. Pure. */
export function needsVariation(g: GameState, family: RatingFamily): boolean {
  if (!BAL.v017.on) return false;
  const fams = g.company.aocFamilies ?? fleetFamilies(g);
  if (fams.includes(family) || unsignedFamilies(g).has(family)) return false;
  if (isWideFamily(family) && wideHeld(g) && !fams.some(isWideFamily)) {
    const first = firstWideFamily(g);
    if (!first || first === family) return false;
  }
  return true;
}

/** The variation for a family: cost, days, due date if filed today, rated pilots missing, the line (§H). Null: none needed. Pure. */
export function variationQuote(g: GameState, family: RatingFamily, typeId?: string): { cost: number; days: number; due: Minute; missing: { CPT: number; FO: number }; text: string } | null {
  if (!needsVariation(g, family)) return null;
  const body = familyBody(family, typeId);
  const auth = aocAuthority(g);
  const days = A().days[auth][body === 'wide' ? 1 : 0];
  const cost = A().cost[body];
  const need = variationCrew(family);
  const p = ratedPilots(g, [family], { booked: true });
  const missing = { CPT: Math.max(0, need.CPT - p.CPT), FO: Math.max(0, need.FO - p.FO) };
  const pending = (g.company.aocVariations ?? []).find((v) => v.family === family && !v.granted);
  const due = pending?.done ?? g.now + days * DAY;
  const who = auth === 'uk' ? 'The UK CAA' : auth === 'easa' ? 'The authority' : 'The authority';
  const crew = missing.CPT || missing.FO ? ` It needs ${need.CPT} rated captains and ${need.FO} first officers before the grant (${[missing.CPT ? `${missing.CPT} captain${missing.CPT === 1 ? '' : 's'}` : '', missing.FO ? `${missing.FO} first officer${missing.FO === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')} to rate).` : '';
  const text = pending
    ? `The ${family} variation is due ${fmtDay(pending.done)}.${crew}`
    : `${who} takes ${days} days to add the ${family} to our AOC (about ${fmtDay(due)} if filed today), ${usdK(cost)}.${crew}`;
  return { cost, days, due, missing, text };
}

const usdK = (v: number) => `$${Math.round(v / 1000)}K`;

/** Files a variation (`approvals` cost) (§H). Our own action: quiet. */
export function applyVariation(g: GameState, family: RatingFamily, typeId?: string): ActionResult {
  const lk = lockOf(g, 'fleet');
  if (lk) return { ok: false, error: lk };
  if ((g.company.aocVariations ?? []).some((v) => v.family === family && !v.granted)) return { ok: false, error: `The ${family} variation is already filed` };
  const q = variationQuote(g, family, typeId);
  if (!q) return { ok: false, error: `The ${family} needs no variation` };
  if (g.company.cash < q.cost) return { ok: false, error: `Not enough cash: ${usdK(q.cost)} to file` };
  post(g, 'approvals', -q.cost);
  const v: AocVariation = { family, filed: g.now, done: g.now + q.days * DAY, cost: q.cost };
  (g.company.aocVariations ??= []).push(v);
  pushMessage(g, {
    tone: 'info', cat: 'company', topic: 'ladder', cue: null, title: `AOC variation filed: ${family}`,
    body: `Due ${fmtDay(v.done)} (${q.days} days). OM-B, the MEL, the training and maintenance programmes for the ${family}: ${usdK(q.cost)}.${q.missing.CPT || q.missing.FO ? ` Book conversions: ${q.missing.CPT + q.missing.FO} more pilots must be rated before the grant.` : ''}`,
  });
  return { ok: true, msg: `${family} variation filed · due ${fmtDay(v.done)}` };
}

/** Company › Ladder › Types on our AOC (§N.1): the families held, the variations in progress with the pilots missing. Pure. */
export function aocView(g: GameState): { families: RatingFamily[]; variations: (AocVariation & { waiting: string | null; missing: { CPT: number; FO: number } })[]; withWidebody: RatingFamily | null } {
  const fams = g.company.aocFamilies ?? fleetFamilies(g);
  const variations = (g.company.aocVariations ?? []).filter((v) => !v.granted).map((v) => {
    const need = variationCrew(v.family);
    const p = ratedPilots(g, [v.family], { booked: true });
    const missing = { CPT: Math.max(0, need.CPT - p.CPT), FO: Math.max(0, need.FO - p.FO) };
    const waiting = missing.CPT ? `Waiting for ${missing.CPT} rated captain${missing.CPT === 1 ? '' : 's'}` : missing.FO ? `Waiting for ${missing.FO} rated first officer${missing.FO === 1 ? '' : 's'}` : null;
    return { ...v, waiting, missing };
  });
  const first = wideHeld(g) ? firstWideFamily(g) : null;
  return { families: fams, variations, withWidebody: first && !fams.includes(first) ? first : null };
}

/** Daily: a variation granted at its due date once the pilots are rated; the Widebody operations family joins at its grant. */
export function dailyAoc(g: GameState): void {
  const co = g.company;
  if (!co.aocFamilies) return;
  for (const v of co.aocVariations ?? []) {
    if (v.granted || v.done > g.now) continue;
    const need = variationCrew(v.family);
    const p = ratedPilots(g, [v.family]);
    if (p.CPT < need.CPT || p.FO < need.FO) continue;
    v.granted = g.now;
    if (!co.aocFamilies.includes(v.family)) co.aocFamilies.push(v.family);
    pushMessage(g, {
      tone: 'good', cat: 'company', topic: 'ladder', cue: 'ladder', title: `The ${v.family} is on our AOC`,
      body: `The authority granted the variation${v.done < g.now - DAY ? ` (due ${fmtDay(v.done)}; it waited for rated pilots)` : ''}. Revenue flights on the ${v.family} may go.`,
    });
  }
  for (const f of unsignedFamilies(g)) if (!co.aocFamilies.includes(f)) co.aocFamilies.push(f);
  if (co.approvals.includes('widebody')) {
    const first = firstWideFamily(g);
    if (first && !co.aocFamilies.includes(first)) co.aocFamilies.push(first);
  }
}
