// v0.7.2 save migration: the cabin ranks CSD and SCC merged into PUR (UPDATE-0.7.2.md §4). Idempotent.

import { ACMI_TYPES } from '../../data/acmiTypes';
import { pushMessage } from '../core/messages';
import type { GameState, Role } from '../core/types';
import { crewPay } from './generate';

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

/**
 * v0.18.3 the cruise relief pilot rank is gone: augmented crews are extra captains and first officers flying in pairs.
 * Crew CRP → FO (ratings, base, hire date and history kept; paid as a first officer of their types, never less than
 * before), CRP seats → FO seats (the spare pilot seat above the minimum too), open hire orders and decision data → FO.
 * One quiet Inbox note when anyone changed. Idempotent. Returns how many records changed.
 */
export function migrateRelief(g: GameState): number {
  const crp = (r: unknown) => r === 'CRP';
  let people = 0;
  let n = 0;
  for (const c of Object.values(g.crew)) {
    if (!crp(c.role)) continue;
    c.role = 'FO';
    c.salary = Math.max(c.salary, crewPay(g, c));
    people++;
  }
  for (const h of g.hires) if (crp(h.role)) { h.role = 'FO'; n++; }
  for (const p of Object.values(g.pairings)) for (const s of p.slots) if (crp(s.role)) { s.role = 'FO'; n++; }
  for (const d of g.decisions) if (d.data && crp(d.data.role)) { d.data.role = 'FO'; n++; }
  if (people) {
    pushMessage(g, {
      cue: null, tone: 'info', cat: 'crew', title: 'Cruise relief pilots are now first officers',
      body: `${people === 1 ? 'Our 1 cruise relief pilot is' : `Our ${people} cruise relief pilots are`} now ${people === 1 ? 'a first officer' : 'first officers'}, with the same ratings and hire date and a first officer's pay. Long flights now carry extra captains and first officers instead: 3 pilots = 1 captain + 2 first officers, 4 pilots = 2 + 2, taking turns at the controls in pairs.`,
    });
  }
  return n + people;
}
