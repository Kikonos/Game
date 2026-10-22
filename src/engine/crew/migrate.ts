// v0.7.2 save migration: the cabin ranks CSD and SCC merged into PUR (UPDATE-0.7.2.md §4). Idempotent.

import { ACMI_TYPES } from '../../data/acmiTypes';
import type { GameState, Role } from '../core/types';

const OLD = new Set<string>(['CSD', 'SCC']);

/**
 * Crew CSD/SCC → PUR (salary, ratings and history kept). Pairing slots: the first senior cabin slot → PUR, further
 * ones → PUR on two-purser types, else CC (their crew member, a PUR now, still fits a CC seat). Hire orders too.
 * Message text stays as written (history). Returns how many records changed.
 */
export function migrateRanks(g: GameState): number {
  let n = 0;
  const fix = (r: string): Role => (OLD.has(r) ? 'PUR' : (r as Role));
  for (const c of Object.values(g.crew)) if (OLD.has(c.role)) { c.role = 'PUR'; n++; }
  for (const h of g.hires) if (OLD.has(h.role)) { h.role = 'PUR'; n++; }
  for (const p of Object.values(g.pairings)) {
    if (!p.slots.some((s) => OLD.has(s.role))) continue;
    const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
    const pursers = (ac && ACMI_TYPES[ac.typeId]?.pursers) ?? 1;
    let seniors = p.slots.filter((s) => s.role === 'PUR').length;
    for (const s of p.slots) {
      if (!OLD.has(s.role)) continue;
      s.role = seniors < pursers ? 'PUR' : 'CC';
      seniors++;
      n++;
    }
  }
  for (const d of g.decisions) if (d.data && typeof d.data.role === 'string' && OLD.has(d.data.role)) { d.data.role = fix(d.data.role); n++; }
  return n;
}
