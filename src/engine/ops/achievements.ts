// v0.9 achievements (UPDATE-0.9.md §14.1): milestones for the Company › Achievements gallery, checked daily and after
// the events that earn them. Some unlock a department head (ops/heads.ts).

import { ACHIEVEMENTS, type AchievementDef } from '../../data/achievements';
import type { GameState, HeadId, Minute } from '../core/types';

export interface AchievementView {
  id: string; title: string; text: string; icon: string; group: AchievementDef['group'];
  at: Minute | null; progress: { have: number; need: number; label: string } | null; head?: HeadId;
}

let progressHook: ((g: GameState, id: string) => { have: number; need: number; label: string } | null) | null = null;
export function setAchievementProgressHook(f: typeof progressHook): void {
  progressHook = f;
}

/** Every achievement with the date earned or its progress. Pure. */
export function achievementsView(g: GameState): AchievementView[] {
  return ACHIEVEMENTS.map((a) => {
    const at = g.achievements?.[a.id] ?? null;
    return { id: a.id, title: a.title, text: a.text, icon: a.icon, group: a.group, at, progress: at === null ? progressHook?.(g, a.id) ?? null : null, ...(a.head ? { head: a.head } : {}) };
  });
}
