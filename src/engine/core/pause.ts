// Auto-pause requests raised by handlers while the clock runs (runtime only, not saved).
// The store decides per its settings whether a reason actually pauses (DESIGN.md §6.5).

export type PauseReason = 'decision' | 'urgentOffer' | 'aog' | 'monthEnd' | 'contractStart' | 'crewShortage';

let pending: PauseReason | null = null;

export function requestPause(reason: PauseReason): void {
  if (!pending) pending = reason;
}

export function takePause(): PauseReason | null {
  const p = pending;
  pending = null;
  return p;
}
