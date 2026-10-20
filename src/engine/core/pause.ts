// Auto-pause requests raised by handlers and actions (runtime only, not saved).
// Every reason raised is kept; the caller decides which ones actually stop the clock (DESIGN.md §3.3, §6.5).

export type PauseReason = 'decision' | 'urgentOffer' | 'aog' | 'monthEnd' | 'contractStart' | 'crewShortage';

/** Priority when several honoured reasons arrive in the same event (first wins for the tooltip). */
export const PAUSE_ORDER: PauseReason[] = ['aog', 'decision', 'urgentOffer', 'crewShortage', 'contractStart', 'monthEnd'];

const pending = new Set<PauseReason>();

export function requestPause(reason: PauseReason): void {
  pending.add(reason);
}

/** Drops stale requests (start of every advance and every player action). */
export function clearPause(): void {
  pending.clear();
}

/** Takes and clears all pending requests; returns the highest-priority one in `honour` (any when omitted). */
export function takePause(honour?: ReadonlySet<PauseReason>): PauseReason | null {
  let hit: PauseReason | null = null;
  for (const r of PAUSE_ORDER) {
    if (pending.has(r) && (!honour || honour.has(r))) {
      hit = r;
      break;
    }
  }
  pending.clear();
  return hit;
}
