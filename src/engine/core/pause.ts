// Auto-pause requests raised by handlers and actions (runtime only, not saved).
import { muteCues, restoreCues, saveCues, unmuteCues } from './cues';
// Every reason raised is kept; the caller decides which ones actually stop the clock (DESIGN.md §3.3, §6.5).

/** v0.7 'marketOffer': a new aircraft market offer (UI honours it only with market alerts on). */
export type PauseReason = 'decision' | 'urgentOffer' | 'aog' | 'monthEnd' | 'contractStart' | 'crewShortage' | 'marketOffer'
  /** v0.9 crew out of hours (red stage); a watch-desk rule. */
  | 'crewHours' | 'rule'
  /** v0.23.1 a route study done, a route launched (tickets on sale): report bmwdo5trhi3sl. */
  | 'network';

/** Priority when several honoured reasons arrive in the same event (first wins for the tooltip). */
export const PAUSE_ORDER: PauseReason[] = ['aog', 'decision', 'urgentOffer', 'crewHours', 'crewShortage', 'rule', 'network', 'contractStart', 'monthEnd', 'marketOffer'];

const pending = new Set<PauseReason>();

export function requestPause(reason: PauseReason): void {
  pending.add(reason);
}

/** v0.12.1 withdraws one pending request (a decision that was applied by operations before anyone saw it). */
export function dropPause(reason: PauseReason): void {
  pending.delete(reason);
}

/** Drops stale requests (start of every advance and every player action). */
export function clearPause(): void {
  pending.clear();
}

/** Opt-in reasons: honoured only when named (v0.7 market alerts), never by an omitted `honour` (tests, the bot). */
const OPT_IN: ReadonlySet<PauseReason> = new Set(['marketOffer']);

/** Takes and clears all pending requests; returns the highest-priority one in `honour` (any but the opt-in ones when omitted). */
export function takePause(honour?: ReadonlySet<PauseReason>): PauseReason | null {
  let hit: PauseReason | null = null;
  for (const r of PAUSE_ORDER) {
    if (pending.has(r) && (honour ? honour.has(r) : !OPT_IN.has(r))) {
      hit = r;
      break;
    }
  }
  pending.clear();
  return hit;
}

/**
 * v0.7.2.1: runs a preview on a copy of the game with pause requests isolated: whatever the copy raises is dropped
 * and the requests already pending are kept, so a quote never stops (or un-stops) the real clock.
 */
export function isolatePauses<T>(fn: () => T): T {
  const saved = [...pending];
  const cues = saveCues();
  muteCues();
  try {
    return fn();
  } finally {
    unmuteCues();
    pending.clear();
    for (const r of saved) pending.add(r);
    restoreCues(cues);
  }
}
