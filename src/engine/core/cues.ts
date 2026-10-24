// v0.9 sound cues (UPDATE-0.9.md §S.1): runtime only, never saved. The engine emits an event name; the UI drains them
// after every advance and action (takeCues) and maps each to exactly one sound (src/ui/sound.ts SOUND_OF). Previews on
// copies are muted by isolatePauses (core/pause.ts): cue() is a no-op while a preview runs (muteCues), and the buffer
// is saved and restored around it, so a dry run never chimes or pauses the live game (v0.9 round 4).
// v0.9.1 (§S.6): a cue carries its message: what the chime is for, shown as a toast (and in the Inbox when it is a
// message). cue() drops one without a title, so no chime ever plays without its note.

import type { Decision, Message, Ref } from './types';

export type Cue =
  | 'message' | 'crewJoined' | 'paymentIn' | 'monthEnd' | 'headDone' | 'decision' | 'offerNew' | 'contractSigned' | 'flightDep' | 'flightArr'
  | 'aog' | 'delayPenalty' | 'sickCall' | 'latePayer' | 'offerLapsing' | 'worldEventOurs' | 'crewAmber' | 'ruleAlert'
  | 'cancelRisk' | 'airspaceActive' | 'cashNegative' | 'evacuation' | 'clientCollapse' | 'crewShortage' | 'crewOutOfHours'
  | 'achievement' | 'ladder' | 'headUnlocked' | 'headHired'
  // v0.9.1: a client's answer to a counter-offer, a warning without a sound of its own, an aircraft handed over.
  | 'counterReply' | 'notice' | 'delivered';

/** Every cue, in the §S.3 table order (tests, the UI's test list). */
export const CUES: Cue[] = [
  'message', 'crewJoined', 'paymentIn', 'monthEnd', 'headDone', 'decision', 'offerNew', 'contractSigned', 'flightDep', 'flightArr',
  'aog', 'delayPenalty', 'sickCall', 'latePayer', 'offerLapsing', 'worldEventOurs', 'crewAmber', 'ruleAlert',
  'cancelRisk', 'airspaceActive', 'cashNegative', 'evacuation', 'clientCollapse', 'crewShortage', 'crewOutOfHours',
  'achievement', 'ladder', 'headUnlocked', 'headHired', 'counterReply', 'notice', 'delivered',
];

/** v0.9.1 what a cue is for, in the player's words (the toast; the Inbox message when `msgId`). */
export interface CueNote {
  title: string;
  body?: string;
  tone?: Message['tone'];
  /** The Inbox message it came with. */
  msgId?: string;
  /** What it is about (an offer for a counter reply, an aircraft for a delivery). */
  ref?: Ref;
}
export interface CueEvent extends CueNote {
  cue: Cue;
}

const MAX = 64;
let buf: CueEvent[] = [];
/** Preview depth: while > 0 (a dry run on a copy of the state) cues are dropped. */
let muted = 0;

/** Raises a cue with its note; one without a title is dropped (a chime always says what it is for). */
export function cue(c: Cue, note: CueNote): void {
  if (muted || buf.length >= MAX || !note?.title?.trim()) return;
  buf.push({ ...note, cue: c });
}

/** Dry runs on copies: cue() is a no-op until the matching unmuteCues (nested previews stack). */
export function muteCues(): void {
  muted++;
}
export function unmuteCues(): void {
  muted = Math.max(0, muted - 1);
}
export const cuesMuted = (): boolean => muted > 0;

/** Takes and clears the pending cues with their notes (oldest first): the UI's drain. */
export function takeCueEvents(): CueEvent[] {
  const out = buf;
  buf = [];
  return out;
}
/** Takes and clears the pending cues, names only (tests). */
export const takeCues = (): Cue[] => takeCueEvents().map((e) => e.cue);

/** isolatePauses: keep what is pending, drop whatever a preview adds. */
export const saveCues = (): CueEvent[] => buf.slice();
export function restoreCues(saved: CueEvent[]): void {
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
  // v0.9.1: a warning without a sound of its own is a small thing needing attention (1 HI); news is calm (1 LO).
  return m.tone === 'warn' || m.tone === 'bad' ? 'notice' : 'message';
}

/** Decision kinds → cue (§S.3): emergencies get double/triple, the calm ones the cockpit ding. */
const OF_DECISION: Record<string, Cue> = {
  aog: 'aog', sickCrew: 'sickCall', latePayment: 'latePayer', crewShort: 'cancelRisk', rescue: 'cashNegative', airspace: 'airspaceActive',
  uninsurable: 'cancelRisk',
};

export function cueOfDecision(d: Pick<Decision, 'kind'>): Cue {
  return OF_DECISION[d.kind] ?? 'decision';
}
