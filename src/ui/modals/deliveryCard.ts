// v0.12 Visual B: when the 'Welcome to the fleet' card opens. UI only (the engine's 'delivered' cue says an aircraft was
// handed over); never for the aircraft a new game starts with, once per aircraft per session. Pure.

import type { CueEvent } from '../../engine/core/cues';
import type { GameState } from '../../engine/core/types';

/** The aircraft whose welcome card this cue opens, or null (not a delivery, gone, a starting aircraft, already shown). */
export function deliveryCardFor(g: GameState, e: Pick<CueEvent, 'cue' | 'ref'>, shown: ReadonlySet<string>): string | null {
  if (e.cue !== 'delivered' || e.ref?.kind !== 'aircraft') return null;
  const ac = g.fleet[e.ref.id];
  if (!ac || shown.has(ac.id)) return null;
  // The fleet a new game starts with was 'delivered' at the start, with no handover: never a welcome card.
  if (!ac.delivery && ac.deliveredAt <= g.started) return null;
  return ac.id;
}
