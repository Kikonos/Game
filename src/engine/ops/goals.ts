// Goals: few, big, earned (B3). DESIGN.md §5.9.

import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { statementTotals } from '../core/ledger';
import type { ApprovalId, GameState } from '../core/types';
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

/** v0.5 goals (BRIEF). */
export const GOALS: GoalDef[] = [
  { id: 'firstContract', title: 'First contract', desc: 'Sign your first contract.', progress: (g) => (Object.keys(g.contracts).length || g.stats.contractsDone ? 1 : 0) },
  { id: 'millionMonth', title: 'A $1M month', desc: 'Earn $1M revenue in one month.', progress: (g) => Math.min(1, Math.max(0, bestRevenue(g)) / 1_000_000) },
  { id: 'threeAircraft', title: 'Three aircraft', desc: 'Operate three aircraft.', progress: (g) => Math.min(1, onAoc(g).length / 3) },
  {
    id: 'firstWidebody', title: 'First widebody', desc: 'Add a widebody to the fleet.',
    progress: (g) => {
      const wide = Object.values(g.fleet).filter((a) => typeOf(a.typeId).body === 'wide');
      return wide.some((a) => a.status !== 'delivering') ? 1 : wide.length ? 0.5 : 0;
    },
  },
  { id: 'etops180', title: 'ETOPS 180', desc: 'Earn ETOPS 180 approval.', progress: (g) => (approvalProgress(g, 'etops180') || approvalProgress(g, 'etops120') * 0.4) },
  { id: 'augmentedLongHaul', title: 'Long haul, heavy crew', desc: 'Fly a long-haul duty with an augmented crew.', progress: (g) => ((g.stats.augmentedDuties ?? 0) > 0 ? 1 : approvalProgress(g, 'augmented') * 0.5) },
  { id: 'firstUlr', title: 'Ultra long range', desc: 'Fly an ultra-long-range sector.', progress: (g) => ((g.stats.ulrSectors ?? 0) > 0 ? 1 : approvalProgress(g, 'ulr') * 0.5) },
];

/** Keeps g.goals in step with GOALS (saves from older builds). */
export function syncGoals(g: GameState): void {
  g.goals ??= [];
  for (const d of GOALS) if (!g.goals.some((x) => x.id === d.id)) g.goals.push({ id: d.id, done: null });
}

/** Daily: mark goals done, message (toast) + reliability +1. */
export function checkGoals(g: GameState): void {
  for (const st of g.goals) {
    if (st.done !== null) continue;
    const def = GOALS.find((d) => d.id === st.id);
    if (!def || def.progress(g) < 1) continue;
    st.done = g.now;
    bumpReliable(g, 1);
    pushMessage(g, { tone: 'good', cat: 'goal', title: `Goal reached: ${def.title}`, body: `${def.desc} Reliability +1.` });
  }
}
