// v0.17 "Aircraft market" (UPDATE-0.17.md; engine/leasing). Public API, load and the daily and monthly hooks.
// Step 0 (§Q.1): real signatures, neutral bodies — the game plays exactly as v0.16.4 until the lanes fill them.
// Owners: tightness/terms/calls/spot/batches → lane `supply`; credit/rfp/deals/induction/aoc/exotic/index → lane `deals`.

import { BAL } from '../core/balance';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import type { GameState, Leasing, MonthKey } from '../core/types';
import { lcFeeBill } from '../finance/lc';
import { dailyAoc, loadAoc } from './aoc';
import { dailyDeals } from './deals';
import { dailyInduction } from './induction';
import { dailyRfps } from './rfp';
import { dailySpot } from './spot';
import { baseTight, stepTightness } from './tightness';
import { minHoursBill } from './terms';

export { aocView, applyVariation, familyOnAoc, fleetFamilies, variationQuote } from './aoc';
export { onAirlineFailure } from './batches';
export { dailyCalls } from './calls';
export { exposureOf, gradeOf, leasebackLessorFor, leasebackLessorOk, lessorRating } from './credit';
export { addTechReps, dealsOpen, leasingForecastItems, loiQuote, meetConditions, signLease, signLoi, usesLoi, walkAway, type LoiOpts, type LoiQuote } from './deals';
export { exoticPath, isExotic } from './exotic';
export { camoCapacity, camoLoad, inductionPlan, type InductionPlan } from './induction';
export { rfpPreview, sendRfp, withdrawRfp, type RfpDraft, type RfpPreview } from './rfp';
export { askSpot, spotSources, type SpotDraft } from './spot';
export { bandOf, extensionRentX, quoteTerms, type TermsDraft, type TermsQuote } from './terms';
export { onSupplyEvent, shocksOn, supplyOutlook, tightNow, tightWord } from './tightness';
export { leasingSide } from './side';
export { lcInUse } from '../finance/lc';

const emptyStats = (): Leasing['stats'] => ({
  rfps: 0, answers: {}, lois: 0, signed: 0, walked: 0, declined: 0, conditions: 0,
  inductions: 0, inductionDays: 0, camoWaitDays: 0, spot: 0, batches: 0, calls: { narrow: 0, wide: 0 }, minHoursBilled: 0, forfeited: 0,
});

/**
 * Load and new game (§L): `g.leasing` with the base tightness of every type, empty lists and stats; missing type keys
 * get their base; the AOC families. Step 0 rolls nothing (the lane moves the start toward today's phase target on
 * its side stream).
 */
export function loadLeasing(g: GameState): void {
  const L = (g.leasing ??= { tight: {}, shocks: [], rfps: [], deals: [], quiet: {}, lc: {}, lcAccrued: 0, stats: emptyStats() });
  L.tight ??= {};
  for (const t of ACMI_TYPES_LIST) L.tight[t.id] ??= baseTight(t.id);
  L.shocks ??= [];
  L.rfps ??= [];
  L.deals ??= [];
  L.quiet ??= {};
  L.lc ??= {};
  L.lcAccrued ??= 0;
  L.stats ??= emptyStats();
  loadAoc(g);
}

/** Bumps the leasing revision (the problem cards' and the UI's cache key). */
export function touchLeasing(g: GameState): void {
  if (g.leasing) g.leasing.rev = (g.leasing.rev ?? 0) + 1;
}

/** Daily (ops/index.ts, after dailyMarket): requests, deals, transitions, variations, short-term. Step 0: all neutral. */
export function dailyLeasing(g: GameState): void {
  if (!g.leasing || !BAL.v017.on) return;
  dailyRfps(g);
  dailyDeals(g);
  dailyInduction(g);
  dailyAoc(g);
  dailySpot(g);
}

/** Monthly (end of refreshMarket): tightness moves. Step 0: nothing moves. */
export function monthlyLeasing(g: GameState): void {
  if (!g.leasing || !BAL.v017.on) return;
  stepTightness(g);
}

/** The month-end bill's leasing part (ops/finance.ts monthEndBill): minimum-hours reserves and letter-of-credit fees. Step 0: 0. Pure. */
export function leasingBill(g: GameState, k: MonthKey): number {
  if (!g.leasing) return 0;
  return minHoursBill(g, k) + lcFeeBill(g, k);
}
