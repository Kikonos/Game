// v0.9 sound cues (UPDATE-0.9.md §S.1): runtime only, never saved. The engine emits an event name; the UI drains them
// after every advance and action (takeCues) and maps each to exactly one sound (src/ui/sound.ts SOUND_OF). Previews on
// copies are muted by isolatePauses (core/pause.ts), which saves and restores this buffer.

import type { Decision, Message } from './types';

export type Cue =
  | 'message' | 'crewJoined' | 'paymentIn' | 'monthEnd' | 'headDone' | 'decision' | 'offerNew' | 'contractSigned' | 'flightDep' | 'flightArr'
  | 'aog' | 'delayPenalty' | 'sickCall' | 'latePayer' | 'offerLapsing' | 'worldEventOurs' | 'crewAmber' | 'ruleAlert'
  | 'cancelRisk' | 'airspaceActive' | 'cashNegative' | 'evacuation' | 'clientCollapse' | 'crewShortage' | 'crewOutOfHours'
  | 'achievement' | 'ladder' | 'headUnlocked' | 'headHired';

/** Every cue, in the §S.3 table order (tests, the UI's test list). */
export const CUES: Cue[] = [
  'message', 'crewJoined', 'paymentIn', 'monthEnd', 'headDone', 'decision', 'offerNew', 'contractSigned', 'flightDep', 'flightArr',
  'aog', 'delayPenalty', 'sickCall', 'latePayer', 'offerLapsing', 'worldEventOurs', 'crewAmber', 'ruleAlert',
  'cancelRisk', 'airspaceActive', 'cashNegative', 'evacuation', 'clientCollapse', 'crewShortage', 'crewOutOfHours',
  'achievement', 'ladder', 'headUnlocked', 'headHired',
];

const MAX = 64;
let buf: Cue[] = [];

export function cue(c: Cue): void {
  if (buf.length < MAX) buf.push(c);
}

/** Takes and clears the pending cues (oldest first). */
export function takeCues(): Cue[] {
  const out = buf;
  buf = [];
  return out;
}

/** isolatePauses: keep what is pending, drop whatever a preview adds. */
export const saveCues = (): Cue[] => buf.slice();
export function restoreCues(saved: Cue[]): void {
  buf = saved;
}

/** Problem kinds with a sound of their own (§S.3). */
const OF_PROBLEM: Partial<Record<string, Cue>> = {
  aog: 'aog', crewSick: 'sickCall', invoiceOverdue: 'latePayer', clientUnhappy: 'clientCollapse', airspaceClosed: 'airspaceActive', uninsurable: 'cancelRisk',
  penalty: 'delayPenalty', crewHours: 'crewOutOfHours',
};

/**
 * The one table from a posted message to its cue (§S.3); null = silent (market alerts, world news not touching us).
 * Topics first, then the problem kind, then the tone: good and info are routine ('message'), warn/bad without a kind
 * of their own also chime once ('message'): the loud ones are posted with an explicit cue.
 */
export function cueOfMessage(m: Pick<Message, 'topic' | 'problem' | 'tone' | 'cat'>): Cue | null {
  switch (m.topic) {
    case 'crewRed': return 'crewShortage';
    case 'crewHours': return 'crewOutOfHours';
    case 'achievement': return 'achievement';
    case 'ladder': return 'ladder';
    case 'head': return 'headDone';
    case 'market': case 'world': return null;
  }
  const k = m.problem?.kind;
  if (k && OF_PROBLEM[k]) return OF_PROBLEM[k]!;
  return 'message';
}

/** Decision kinds → cue (§S.3): emergencies get double/triple, the calm ones the cockpit ding. */
const OF_DECISION: Record<string, Cue> = {
  aog: 'aog', sickCrew: 'sickCall', latePayment: 'latePayer', crewShort: 'cancelRisk', rescue: 'cashNegative', airspace: 'airspaceActive',
  uninsurable: 'cancelRisk',
};

export function cueOfDecision(d: Pick<Decision, 'kind'>): Cue {
  return OF_DECISION[d.kind] ?? 'decision';
}
