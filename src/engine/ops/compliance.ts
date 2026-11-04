// v0.16 the Compliance Monitoring Manager (UPDATE-0.16.md §F; lane `ops`): the nominated post of ORO.GEN.200(a)(6),
// hired in Team › Nominated posts from the start. With one, ramp inspections find less (ramp.ts reads complianceFactor),
// the yearly audit's random paperwork finding comes less often and Level 2 deadlines are longer; the ramp finding's
// corrective action costs half ("the CMM adds line-station checks"). Paid monthly under 'salaries'.
//
// Step 0 (the shared skeleton): the record and its defaults are real, nobody can be hired yet, the factor is 1.

import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { monthKey, monthStart } from '../core/time';
import type { ActionResult, ComplianceState, GameState, HeadCandidate, MonthKey } from '../core/types';

const C = BAL.v016.compliance;

/** The record (created empty on first use: older saves never had one). */
export function complianceState(g: GameState): ComplianceState {
  const s = (g.compliance ??= { hired: null, stats: { rampSaved: 0 } });
  s.stats ??= { rampSaved: 0 };
  return s;
}

/** Load (and new game): the record's defaults (SAVE_VERSION stays 1). */
export function loadCompliance(g: GameState): void {
  complianceState(g);
}

/** Candidates (junior, mid, senior), rolled on first look and kept until one is hired. Step 0: none. */
export function complianceCandidates(_g: GameState): HeadCandidate[] {
  return [];
}
export function hireComplianceManager(_g: GameState, _candidate: number): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function fireComplianceManager(_g: GameState): ActionResult {
  return { ok: false, error: 'Not available yet' };
}

/** The manager's pay for month k, pro-rated from the day they joined (month-end bill and forecast alike). Pure. */
export function complianceBill(g: GameState, k: MonthKey = monthKey(g.now)): number {
  const h = g.compliance?.hired;
  if (!h) return 0;
  const a = monthStart(k), b = monthStart(k + 1);
  const from = Math.max(a, h.joins);
  return from < b ? Math.round(h.salary * ((b - from) / (b - a))) : 0;
}

/** Ramp finding mean × this (1 without a manager, or before they join). Pure. */
export function complianceFactor(g: GameState): number {
  const h = g.compliance?.hired;
  if (!h || h.joins > g.now) return 1;
  return 1 - C.rampCut * h.skill;
}

export interface ComplianceView {
  hired: ComplianceState['hired'];
  candidates: HeadCandidate[];
  /** Plain lines on what the post does for us. */
  does: string[];
  /** '−30 % ramp findings' once hired. */
  effect: string | null;
}

/** Team › Nominated posts. Pure. */
export function complianceView(g: GameState): ComplianceView {
  const s = g.compliance ?? { hired: null, stats: { rampSaved: 0 } };
  const f = complianceFactor(g);
  return {
    hired: s.hired, candidates: s.candidates ?? [],
    does: ['Audits our own stations and paperwork before the authority does', 'Fewer ramp inspection findings', 'Longer deadlines on audit findings'],
    effect: s.hired ? `${Math.round((1 - f) * 100)} % fewer ramp findings` : null,
  };
}

/** Month end (before the statement closes): the manager's pay. */
export function monthlyCompliance(g: GameState): void {
  const pay = complianceBill(g, g.finance.current.month);
  if (pay) post(g, 'salaries', -pay);
}
