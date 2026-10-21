// Goals: few, big, earned (B3). DESIGN.md §5.9.

import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { statementTotals } from '../core/ledger';
import type { ApprovalId, GameState, GoalState } from '../core/types';
import { setGrantHook } from './company';
import { bumpReliable } from './util';

export interface GoalDef {
  id: string;
  title: string;
  desc: string;
  /** 0–1 progress for the UI. Pure. */
  progress(g: GameState): number;
}

const onAoc = (g: GameState) => Object.values(g.fleet).filter((a) => a.status !== 'delivering' && a.status !== 'leasedOut');

/** Approval held → 1, pending → 0.1–0.9 by elapsed time, else `base`. */
function approvalProgress(g: GameState, id: ApprovalId, base = 0): number {
  if (g.company.approvals.includes(id)) return 1;
  const p = g.company.pendingApprovals.find((x) => x.id === id);
  if (p) return 0.1 + 0.8 * Math.min(1, Math.max(0, (g.now - p.started) / Math.max(1, p.done - p.started)));
  return base;
}

function bestRevenue(g: GameState): number {
  let best = statementTotals(g.finance.current.lines).revenue;
  for (const st of g.finance.history) best = Math.max(best, statementTotals(st.lines).revenue);
  return best;
}

const ladderTypes = (ids: string[]) => ids.map((id) => typeOf(id).short);

/** v0.7 ladder goals: what opened and the next step (the celebration card). */
interface LadderInfo {
  /** The approval it follows (granted → goal posted at once, instead of the plain approval message). */
  approval?: ApprovalId;
  /** Types it opens (shown on the card). */
  types?: string[];
  body: string;
}

const wideOn = (g: GameState) => Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'wide');

/** v0.5 goals (BRIEF) and the v0.7 ladder goals, in ladder order. */
export const GOALS: (GoalDef & { ladder?: LadderInfo })[] = [
  { id: 'firstContract', title: 'First contract', desc: 'Sign your first contract.', progress: (g) => (Object.keys(g.contracts).length || g.stats.contractsDone ? 1 : 0) },
  { id: 'millionMonth', title: 'A $1M month', desc: 'Earn $1M revenue in one month.', progress: (g) => Math.min(1, Math.max(0, bestRevenue(g)) / 1_000_000) },
  { id: 'threeAircraft', title: 'Three aircraft', desc: 'Operate three aircraft.', progress: (g) => Math.min(1, onAoc(g).length / 3) },
  {
    id: 'etops120', title: 'ETOPS 120', desc: 'Earn ETOPS 120 approval.', progress: (g) => approvalProgress(g, 'etops120'),
    ladder: { approval: 'etops120', body: 'Our twins may now fly up to 120 minutes from an alternate: the Azores, Cape Verde and the thin North Atlantic. Next: ETOPS 180 after 120 days.' },
  },
  {
    id: 'widebodyOps', title: 'Widebody operator', desc: 'Earn Widebody operations approval.', progress: (g) => approvalProgress(g, 'widebody'),
    ladder: { approval: 'widebody', types: ['b763', 'a332', 'a333', 'a343'], body: 'You can now sign 767-300ERs, A330s and A340s. Next: ETOPS 180 and long-haul crews.' },
  },
  {
    id: 'firstWidebody', title: 'First widebody', desc: 'Add a widebody to the fleet.',
    progress: (g) => {
      const wide = wideOn(g);
      return wide.some((a) => a.status !== 'delivering') ? 1 : wide.length ? 0.5 : 0;
    },
    ladder: { body: 'Our first widebody is on the AOC. Next: long-haul augmented crews, then the 777.' },
  },
  { id: 'etops180', title: 'ETOPS 180', desc: 'Earn ETOPS 180 approval.', progress: (g) => (approvalProgress(g, 'etops180') || approvalProgress(g, 'etops120') * 0.4), ladder: { approval: 'etops180', body: 'The South Atlantic direct and the Indian Ocean are open. With augmented crews the 777s and the A380 come next.' } },
  { id: 'augmentedLongHaul', title: 'Long haul, heavy crew', desc: 'Fly a long-haul duty with an augmented crew.', progress: (g) => ((g.stats.augmentedDuties ?? 0) > 0 ? 1 : approvalProgress(g, 'augmented') * 0.5) },
  {
    id: 'first777', title: 'Triple Seven', desc: 'Operate a 777.',
    progress: (g) => {
      const t7 = Object.values(g.fleet).filter((a) => typeOf(a.typeId).family === 'B777');
      return t7.some((a) => a.status !== 'delivering') ? 1 : t7.length ? 0.5 : 0;
    },
    ladder: { body: 'A Triple Seven flies in our colours. Next: ETOPS 240 and the prestige long haul.' },
  },
  {
    id: 'etops240', title: 'ETOPS 240', desc: 'Earn ETOPS 240 approval.', progress: (g) => approvalProgress(g, 'etops240'),
    ladder: { approval: 'etops240', types: ['b789', 'a359', 'b77l'], body: 'You can now sign 787-9s, A350s and 777-200LRs, and bid for prestige long haul. Next: ultra-long-range (FRMS).' },
  },
  { id: 'ulrApproved', title: 'FRMS approved', desc: 'Earn ultra-long-range approval.', progress: (g) => approvalProgress(g, 'ulr'), ladder: { approval: 'ulr', types: ['a35u', 'b77l'], body: 'Sectors over 16 hours with 4 pilots are ours to fly. The top of the ladder.' } },
  { id: 'firstUlr', title: 'Ultra long range', desc: 'Fly an ultra-long-range sector.', progress: (g) => ((g.stats.ulrSectors ?? 0) > 0 ? 1 : approvalProgress(g, 'ulr') * 0.5), ladder: { body: 'Our first sector over 16 hours, flown with four pilots.' } },
];

/** Keeps g.goals in step with GOALS (saves from older builds), in GOALS order. */
export function syncGoals(g: GameState): void {
  g.goals ??= [];
  for (const d of GOALS) if (!g.goals.some((x) => x.id === d.id)) g.goals.push({ id: d.id, done: null });
  const rank = (id: string) => {
    const i = GOALS.findIndex((d) => d.id === id);
    return i < 0 ? GOALS.length : i;
  };
  g.goals.sort((a, b) => rank(a.id) - rank(b.id));
}

/** The aircraft a ladder goal is about (first widebody, first 777), for the message ref. */
function goalAircraft(g: GameState, id: string): string | undefined {
  const pick = (f: (typeId: string) => boolean) => Object.values(g.fleet).find((a) => a.status !== 'delivering' && f(a.typeId))?.id;
  if (id === 'firstWidebody') return pick((t) => typeOf(t).body === 'wide');
  if (id === 'first777') return pick((t) => typeOf(t).family === 'B777');
  if (id === 'firstUlr') return pick((t) => !!typeOf(t).ulr) ?? pick((t) => typeOf(t).body === 'wide');
  return undefined;
}

function reach(g: GameState, st: GoalState, def: (typeof GOALS)[number]): void {
  st.done = g.now;
  bumpReliable(g, 1);
  if (def.ladder) {
    const ac = goalAircraft(g, def.id);
    const types = def.ladder.types?.length ? ` (${ladderTypes(def.ladder.types).join(' · ')})` : '';
    pushMessage(g, { tone: 'good', cat: 'goal', topic: 'ladder', title: `Goal reached: ${def.title}`, body: `${def.ladder.body}${types} Reliability +1.`, ...(ac ? { ref: { kind: 'aircraft' as const, id: ac } } : {}) });
    return;
  }
  pushMessage(g, { tone: 'good', cat: 'goal', title: `Goal reached: ${def.title}`, body: `${def.desc} Reliability +1.` });
}

/** Daily: mark goals done, message (toast; ladder goals: the celebration card) + reliability +1. */
export function checkGoals(g: GameState): void {
  for (const st of g.goals) {
    if (st.done !== null) continue;
    const def = GOALS.find((d) => d.id === st.id);
    if (!def || def.progress(g) < 1) continue;
    reach(g, st, def);
  }
}

// A granted approval with a ladder goal posts the goal (one message per event) instead of "X approved".
setGrantHook((g, id) => {
  const def = GOALS.find((d) => d.ladder?.approval === id);
  const st = def && g.goals.find((x) => x.id === def.id);
  if (!def || !st || st.done !== null) return false;
  reach(g, st, def);
  return true;
});
