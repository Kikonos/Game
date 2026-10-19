// Approvals (progression gates) and policies (B3). DESIGN.md §5.11.

import type { ActionResult, ApprovalId, GameState, Policies, SimEvent } from '../core/types';

export interface ApprovalDef {
  id: ApprovalId;
  name: string;
  desc: string;
  cost: number;
  days: number;
  /** Other approvals needed first. */
  requires: ApprovalId[];
}

/** v0.5 subset of RESEARCH §6 (G5, G6, G8, G9 …). TODO(B3): requirements beyond prerequisites (months of ops, fleet). */
export const APPROVALS: ApprovalDef[] = [
  { id: 'etops120', name: 'ETOPS 120', desc: 'Twin-engine ops up to 120 min from an alternate: North Atlantic, Cape Verde, Caribbean.', cost: 250_000, days: 180, requires: [] },
  { id: 'etops180', name: 'ETOPS 180', desc: 'Direct South Atlantic, Indian Ocean. Needs 12 months at ETOPS 120.', cost: 350_000, days: 365, requires: ['etops120'] },
  { id: 'augmented', name: 'Augmented crew ops', desc: '3–4 pilot crews with in-flight rest: FDP up to 18 h.', cost: 300_000, days: 60, requires: [] },
  { id: 'ulr', name: 'Ultra-long-range (FRMS)', desc: 'Sectors over 16 h with 4 pilots. Needs augmented ops.', cost: 900_000, days: 270, requires: ['augmented', 'etops180'] },
  { id: 'iosa', name: 'IOSA registration', desc: 'IATA audit many airline clients require.', cost: 180_000, days: 240, requires: [] },
  { id: 'dg', name: 'Dangerous goods', desc: 'Weapons, rescue gear, aid cargo and medical oxygen.', cost: 60_000, days: 60, requires: [] },
];

export function applyApproval(_g: GameState, _id: ApprovalId): ActionResult {
  return { ok: false, error: 'Approvals are not built yet' };
}

/** 'approval.done'. TODO(B3) */
export function onApprovalDone(_g: GameState, _ev: SimEvent): void {}

export function setPolicies(g: GameState, patch: Partial<Policies>): ActionResult {
  g.company.policies = { ...g.company.policies, ...patch };
  return { ok: true };
}
