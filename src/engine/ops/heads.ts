// v0.9 department heads (UPDATE-0.9.md §5): seven hires earned through achievements. Each has a salary and a skill,
// takes routine work by the player's rules, makes the odd mistake, can be overridden or switched off, and never takes
// the big decisions (which contracts, which aircraft, crises).

import { HEAD_DEFS, HEAD_IDS } from '../../data/heads';
import type { ActionResult, GameState, Head, HeadCandidate, HeadId, HeadLogLine, HeadProposal, HeadRules, Minute } from '../core/types';

export interface HeadView {
  id: HeadId; title: string; icon: string; unlocked: boolean; unlockText: string;
  progress: { label: string; have: number; need: number } | null;
  person: { name: string; skill: number; salary: number; since: Minute } | null;
  candidates: HeadCandidate[]; on: boolean; rules: HeadRules;
  does: string[]; never: string[]; proposals: HeadProposal[]; log: HeadLogLine[];
  handled: number; mistakes: number; overridden: number;
}

/** Default rules per head (§5.2). */
export function defaultRules(id: HeadId): HeadRules {
  switch (id) {
    case 'opsControl': return { maxDelayMin: 120, standbyFirst: true };
    case 'crewDesk': return { fixMax: 8_000, jetMax: 0, autoHire: false };
    case 'credit': return { waiveTrusted: true, depositSlow: true };
    case 'fleetPlanner': return { autoFerryMax: 0 };
    case 'watch': return { alerts: [] };
    default: return {};
  }
}

export function lockedHead(id: HeadId): Head {
  return { id, unlockedAt: null, hired: null, on: true, rules: defaultRules(id), proposals: [], log: [], handled: 0, mistakes: 0, overridden: 0 };
}

/** The head's record (a locked default when the save has none). */
const headOf = (g: GameState, id: HeadId): Head => g.heads?.[id] ?? lockedHead(id);

/** Unlock progress (§5.1), null when unlocked. Pure. */
export function headProgress(g: GameState, id: HeadId): { label: string; have: number; need: number } | null {
  if (headOf(g, id).unlockedAt !== null) return null;
  return progressHook?.(g, id) ?? null;
}
let progressHook: ((g: GameState, id: HeadId) => { label: string; have: number; need: number } | null) | null = null;
export function setHeadProgressHook(f: typeof progressHook): void {
  progressHook = f;
}

/** One head as the Team view shows it. Pure. */
export function headView(g: GameState, id: HeadId): HeadView {
  const h = headOf(g, id);
  const def = HEAD_DEFS[id];
  return {
    id, title: def.title, icon: def.icon, unlocked: h.unlockedAt !== null, unlockText: def.unlockText, progress: headProgress(g, id),
    person: h.hired ? { ...h.hired } : null, candidates: h.hired ? [] : (h.candidates ?? []), on: h.on, rules: { ...defaultRules(id), ...h.rules },
    does: def.does, never: def.never, proposals: h.proposals, log: h.log, handled: h.handled, mistakes: h.mistakes, overridden: h.overridden,
  };
}

/** All seven, in the Team list order. Pure. */
export function headsView(g: GameState): HeadView[] {
  return HEAD_IDS.map((id) => headView(g, id));
}

export function hireHead(_g: GameState, _id: HeadId, _candidate: number): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function fireHead(_g: GameState, _id: HeadId): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function setHeadOn(_g: GameState, _id: HeadId, _on: boolean): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function setHeadRules(_g: GameState, _id: HeadId, _rules: Partial<HeadRules>): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function acceptProposal(_g: GameState, _id: HeadId, _proposalId: string): ActionResult {
  return { ok: false, error: 'Not available yet' };
}
export function dismissProposal(_g: GameState, _id: HeadId, _proposalId: string): ActionResult {
  return { ok: false, error: 'Not available yet' };
}

export interface AnalystView { name: string; skill: number; score: number; verdict: 'take' | 'counter' | 'pass'; aircraftId: string | null; marginPct: number; counter: number | null; lines: string[] }

/** The commercial analyst's take on an offer; null unless hired and on. Pure. */
export function analystView(_g: GameState, _offerId: string): AnalystView | null {
  return null;
}

export function ferryAircraft(_g: GameState, _aircraftId: string, _to: string): ActionResult<{ flightIds: string[]; cost: number }> {
  return { ok: false, error: 'Not available yet' };
}
