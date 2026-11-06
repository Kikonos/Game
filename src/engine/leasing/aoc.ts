// v0.17 type families on our AOC and AOC variations (UPDATE-0.17.md §H; lane `deals`). Step 0: every family counts as
// on the AOC (familyOnAoc true); the list itself is set on load (the fleet's families) so old saves need no card.

import type { RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../core/perf';
import type { ActionResult, AocVariation, GameState, Minute } from '../core/types';

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

/** Whether revenue legs of a family may fly at `t` (§H gate). Step 0: always. Pure. */
export function familyOnAoc(g: GameState, family: RatingFamily, t: Minute = g.now): boolean {
  void g;
  void family;
  void t;
  return true;
}

/** The variation for a family: cost, days, due date, rated pilots missing (§H). Step 0: none needed. Pure. */
export function variationQuote(g: GameState, family: RatingFamily): { cost: number; days: number; due: Minute; missing: { CPT: number; FO: number }; text: string } | null {
  void g;
  void family;
  return null;
}

/** Files a variation (`approvals` cost). Step 0: refused. */
export function applyVariation(g: GameState, family: RatingFamily): ActionResult {
  void g;
  void family;
  return { ok: false, error: 'AOC variations are not open yet' };
}

/** Company › Ladder › Types on our AOC (§N.1): the families held and the variations in progress. Pure. */
export function aocView(g: GameState): { families: RatingFamily[]; variations: AocVariation[] } {
  return { families: g.company.aocFamilies ?? fleetFamilies(g), variations: g.company.aocVariations ?? [] };
}

/** Daily: a variation granted at its due date once the pilots are rated. Step 0: nothing. */
export function dailyAoc(g: GameState): void {
  void g;
}
