// Random operational events and the decision resolvers (B3). DESIGN.md §5.8.

import type { ActionResult, GameState, SimEvent } from '../core/types';

/** Daily rolls: sick crew, late payment notices, client changes, urgent evacuation offers (via contracts.generateOffer). TODO(B3) */
export function dailyEvents(_g: GameState): void {}

/** Applies a decision option (dispatch on decision.kind) and removes the decision. TODO(B3): resolvers. */
export function resolveDecision(g: GameState, decisionId: string, _optionId: string): ActionResult {
  const i = g.decisions.findIndex((d) => d.id === decisionId);
  if (i < 0) return { ok: false, error: 'Decision not found' };
  g.decisions.splice(i, 1);
  return { ok: true };
}

/** 'decision.expire': apply the default option if still open. */
export function onDecisionExpire(g: GameState, ev: SimEvent): void {
  const d = g.decisions.find((x) => x.id === ev.id);
  if (d) resolveDecision(g, d.id, d.defaultOption);
}
