// v0.11 ETOPS on ferries and positioning (player decision, 26 Oct): we do as real operators do while we hold no ETOPS
// approval. Every empty leg respects the lower of the company's ETOPS approval and the aircraft's own capability
// (the 60-minute rule with no approval, EASA AMC 20-6 / CS-ETOPS): a crossing that needs more goes the long way on
// 60-minute fuel stops (the North Atlantic's northern hops: Keflavík, Kangerlussuaq, Iqaluit, Goose Bay), and one
// with no such way (the Pacific, the South Atlantic for a twin) is refused, with what real operators do instead.
// Four engines are not limited. Pure helpers shared by the engine, the Fleet card and the market.

import { etopsCap, heldEtops, typeOf } from '../core/perf';
import type { ApprovalId, GameState } from '../core/types';

/** '60 minutes' (the 60-minute rule), '120 minutes'; 'any distance' for four engines. */
export const capText = (cap: number): string => (cap === Infinity ? 'any distance' : `${cap || 60} minutes`);

/** Our ETOPS cap for a type, in words ('60 minutes' with no approval). */
export const etopsCapText = (g: GameState, typeId: string): string => capText(etopsCap(g.company.approvals, typeId));

const LADDER: [ApprovalId, number][] = [['etops120', 120], ['etops180', 180], ['etops240', 240]];

/**
 * The lowest ETOPS approval above the one we hold that the type can use and that passes `works` (a route exists
 * with that cap), or null (the type can't, or no approval would do). Pure.
 */
export function approvalThatWorks(g: GameState, typeId: string, works: (cap: number) => boolean): ApprovalId | null {
  const t = typeOf(typeId);
  if (t.engines !== 2) return null;
  const held = heldEtops(g.company.approvals);
  for (const [id, min] of LADDER) if (min > held && min <= t.etopsMax && works(min)) return id;
  return null;
}

/** 'ETOPS 180' from 'etops180'. */
export const approvalName = (id: ApprovalId): string => id.replace(/^etops/, 'ETOPS ');

/**
 * WHAT YOU CAN DO for a crossing we may not make, in one sentence: the approval that would open it (when the type is
 * capable), else what real operators do.
 */
export function etopsFixText(g: GameState, typeId: string, works?: (cap: number) => boolean): string {
  const t = typeOf(typeId);
  const id = works ? approvalThatWorks(g, typeId, works) : LADDER.find(([, m]) => m > heldEtops(g.company.approvals) && m <= t.etopsMax)?.[0] ?? null;
  if (id) return `Real operators get the approval first: ${approvalName(id)} (Company → Ladder) lets the ${t.short} fly it.`;
  return `The ${t.short} is capable of ${t.etopsMax ? `${t.etopsMax} minutes` : 'no ETOPS'}: a twin can't take this crossing on our certificate. A four-engine type can.`;
}

/**
 * The Fleet card's ETOPS line: what the rules really use. 'capable of 120 min · approved 60 min → ferries go the
 * northern way'; 'capable of 120 min · approved 180 min → flies up to 120 min'; 'not needed (four engines)'. Pure.
 */
export function etopsLine(g: GameState, typeId: string): string {
  const t = typeOf(typeId);
  if (t.engines !== 2) return 'not needed (four engines)';
  const held = heldEtops(g.company.approvals);
  const cap = etopsCap(g.company.approvals, typeId);
  const capable = t.etopsMax ? `capable of ${t.etopsMax} min` : 'not capable';
  if (!held) return `${capable} · approved 60 min → ferries go the northern way`;
  if (held === t.etopsMax) return `${capable} · approved ${held} min`;
  return `${capable} · approved ${held} min → flies up to ${cap || 60} min`;
}
