// v0.7.1 Crew Control dialog logic (pure, no React): which missing seat each ticked candidate fills, who can still be
// ticked once a seat is taken, the default picks, and the words for a flight that a fix cancels or hands to a rival.

import { canFill } from '../../engine/core/perf';
import type { CrewFix, Role } from '../../engine/core/types';
import type { SeatNeed } from '../../engine/crew';

export interface Pick { id: string; role: Role }

export interface SeatPlan {
  /** crewId → the seat they fill. */
  seat: Record<string, Role>;
  /** Seats still open after the picks. */
  open: SeatNeed[];
}

/** A person of `role` can sit in a `slot` seat (a captain may take the FO seat; CSD/SCC can work as CC). */
export const fits = (slot: Role, role: Role): boolean => slot === role || canFill(slot, role) || (slot === 'FO' && role === 'CPT');

/** Assigns the picks, in order, to the missing seats: an exact match first, then any seat they can fill. */
export function seatPlan(missing: SeatNeed[], picks: Pick[]): SeatPlan {
  const open = missing.map((m) => ({ ...m }));
  const seat: Record<string, Role> = {};
  for (const p of picks) {
    const slot = open.find((m) => m.n > 0 && m.role === p.role) ?? open.find((m) => m.n > 0 && fits(m.role, p.role));
    if (!slot) continue;
    slot.n--;
    seat[p.id] = slot.role;
  }
  return { seat, open: open.filter((m) => m.n > 0) };
}

/** Whether someone of `role` could still fill one of the open seats. */
export const canTake = (plan: SeatPlan, role: Role): boolean => plan.open.some((m) => fits(m.role, role));

/** The default ticks: the best candidate for each missing seat, in list order; the first option when none fits. */
export function defaultPicks(missing: SeatNeed[], options: Pick[]): string[] {
  const out: Pick[] = [];
  for (const o of options) {
    const plan = seatPlan(missing, out);
    if (!plan.open.length) break;
    if (canTake(plan, o.role)) out.push(o);
  }
  return out.length ? out.map((o) => o.id) : options.slice(0, 1).map((o) => o.id);
}

/** 'Choose who comes in' (standby at the airport) / 'Choose who flies in' (deadhead). */
export const chooseWord = (fix: CrewFix): string => (fix === 'callIn' ? 'Choose who comes in' : 'Choose who flies in');

/** After a cancel / sub-charter the flight is not 'then crewed': it is gone. Null for every other fix. */
export function goneText(fix: CrewFix, no: string, consequences: string[]): string | null {
  if (fix === 'cancel') return `${no} is cancelled`;
  if (fix === 'subcharter') {
    const rival = consequences.map((c) => /^(.+?) flies \d+ legs?/.exec(c)?.[1]).find(Boolean);
    return `${no} is flown by ${rival ?? 'the rival'}`;
  }
  return null;
}
