// Goals: few, big, earned (B3). DESIGN.md §5.9.

import type { GameState } from '../core/types';

export interface GoalDef {
  id: string;
  title: string;
  desc: string;
  /** 0–1 progress for the UI. */
  progress(g: GameState): number;
}

/** v0.5 goals (BRIEF). TODO(B3): real progress functions. */
export const GOALS: GoalDef[] = [
  { id: 'firstContract', title: 'First contract', desc: 'Sign your first contract.', progress: (g) => (Object.keys(g.contracts).length ? 1 : 0) },
  { id: 'millionMonth', title: 'A $1M month', desc: 'Earn $1M revenue in one month.', progress: () => 0 },
  { id: 'threeAircraft', title: 'Three aircraft', desc: 'Operate three aircraft.', progress: (g) => Math.min(1, Object.keys(g.fleet).length / 3) },
  { id: 'firstWidebody', title: 'First widebody', desc: 'Add a widebody to the fleet.', progress: () => 0 },
  { id: 'etops180', title: 'ETOPS 180', desc: 'Earn ETOPS 180 approval.', progress: (g) => (g.company.approvals.includes('etops180') ? 1 : 0) },
  { id: 'augmentedLongHaul', title: 'Long haul, heavy crew', desc: 'Fly a long-haul duty with an augmented crew.', progress: () => 0 },
  { id: 'firstUlr', title: 'Ultra long range', desc: 'Fly an ultra-long-range sector.', progress: () => 0 },
];

/** Daily: mark goals done, message + small reputation bonus. TODO(B3) */
export function checkGoals(_g: GameState): void {}
