// v0.17 "Aircraft market" (UPDATE-0.17.md; engine/leasing). Public API, load and the daily and monthly hooks.
// Step 0 (§Q.1): real signatures, neutral bodies — the game plays exactly as v0.16.4 until the lanes fill them.
// Owners: tightness/terms/calls/spot/batches → lane `supply`; credit/rfp/deals/induction/aoc/exotic/index → lane `deals`.

import { BAL } from '../core/balance';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import type { GameState, Leasing, MonthKey } from '../core/types';
import { dailyLc, lcFeeBill, monthlyLc } from '../finance/lc';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { postProblem } from '../problems';
import { inductionDelayCard } from '../problems/leasing';
import { usd } from '../ops/util';
import { dailyAoc, loadAoc } from './aoc';
import { dailyCredit } from './credit';
import { dailyDeals } from './deals';
import { dailyInduction } from './induction';
import { dailyRfps } from './rfp';
import { dailySpot } from './spot';
import { baseTight, stepTightness } from './tightness';
import { minHoursBill } from './terms';

export { aocAuthority, aocMiss, aocView, applyVariation, familyOnAoc, fleetFamilies, needsVariation, variationCrew, variationQuote } from './aoc';
export { onAirlineFailure } from './batches';
export { dailyCalls } from './calls';
export { capOf, depositMonthsFor, exposureOf, gradeOf, gradeWords, leasebackLessorFor, leasebackLessorOk, lessorRating, lessorStance, rating, widebodiesInAll } from './credit';
export { addTechReps, cashToSign, dealsOpen, dealsWaiting, depositDue, exoticSecurityOf, leasingForecastItems, loiQuote, meetConditions, paintCost, signLease, signLoi, transitionCost, usesLoi, walkAway, type LoiOpts, type LoiQuote } from './deals';
export { exoticPath, isExotic } from './exotic';
export { addTechRepsToInduction, camoCapacity, camoFreeAt, camoLoad, inductionPlan, inductionStep, inductionSteps, type InductionPlan } from './induction';
export { aircraftChance, bandYears, rfpPreview, sendRfp, withdrawRfp, type RfpDraft, type RfpPreview } from './rfp';
export { issueLc, lcRoom, lcWhy, releaseLc } from '../finance/lc';
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
  // The lessor rating first (requests and committees read it).
  dailyCredit(g);
  dailyRfps(g);
  dailyDeals(g);
  // Findings with work booked soon after: the amber card (else a quiet message).
  dailyInduction(g, (ac) => {
    const card = inductionDelayCard(g, ac.id);
    if (!card) return false;
    postProblem(g, card, { cat: 'company', topic: 'market', cue: 'notice' });
    return true;
  });
  dailyAoc(g);
  dailyLc(g);
  dailySpot(g);
}

/** Monthly (end of refreshMarket): tightness moves. Step 0: nothing moves. */
export function monthlyLeasing(g: GameState): void {
  if (!g.leasing || !BAL.v017.on) return;
  // Into the closing month (refreshMarket runs before the statement closes): letter-of-credit fees, then the
  // minimum-hours reserves not flown (terms.ts minHoursBill; posted here once, as `reserves`).
  monthlyLc(g);
  const k = g.finance.current.month;
  const minH = Math.round(minHoursBill(g, k));
  if (minH > 0) {
    post(g, 'reserves', -minH);
    g.leasing.stats.minHoursBilled += minH;
    pushMessage(g, { tone: 'info', cat: 'finance', topic: 'market', cue: null, title: `Minimum-hours reserves: ${usd(minH)}`, body: 'Leases signed since v0.17 bill a minimum of flight hours a month as reserves, flown or not.' });
  }
  stepTightness(g);
}

/** The month-end bill's leasing part (ops/finance.ts monthEndBill): minimum-hours reserves and letter-of-credit fees. Step 0: 0. Pure. */
export function leasingBill(g: GameState, k: MonthKey): number {
  if (!g.leasing) return 0;
  return minHoursBill(g, k) + lcFeeBill(g, k);
}
