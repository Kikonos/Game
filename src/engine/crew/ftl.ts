// EASA FTL (docs/acmi/EASA-FTL.md, RESEARCH §5.1, DESIGN.md §5.2): public checks on crew members and duties. (B2)
// Pure rules live in rules.ts; timelines in timeline.ts.

import { DAY, yearOf } from '../core/time';
import type { CrewMember, Duty, GameState, Legality, Minute } from '../core/types';
import { planCrew } from './check';
import { dutyLegality as dutyLevel } from './duties';
import { LIMITS, levelOf, minRest, recoveryAnchor, type LegalityIssue } from './rules';
import { block12m, ctxOf, segsOf } from './timeline';

export {
  acclimState, AUG_FDP, baseFdp, CABIN_REST, cabinInflightRest, DISCRETION, FDP_BANDS, isDisruptive, LIMITS, longestWorkBlock, maxFdp, minRest, nightsIn, referenceTime, tzDeltaH,
  type Acclim, type FdpInput, type IssueCode, type LegalityIssue, type RefTime, type RestInput,
} from './rules';

export interface LegalityReport {
  level: Legality;
  issues: LegalityIssue[];
}

export interface CrewWindows {
  duty7d: number;
  duty14d: number;
  duty28d: number;
  block28d: number;
  blockYear: number;
  /** v0.7.2 block minutes in this calendar month and the 11 before (logged + planned). */
  block12m: number;
  restUntil: Minute;
  /** Latest start of the next 36 h recovery rest. */
  recoveryDue: Minute;
}

/** Rolling totals at time t from the log plus planned duties up to t (clipped to each window). */
export function crewWindows(g: GameState, c: CrewMember, t: Minute): CrewWindows {
  const segs = segsOf(g, c).filter((s) => s.start < t);
  // Standby counts by its share (home and hotel 25 %, airport in full, reserve not at all: CS FTL.1.225, ORO.FTL.230).
  const dutyIn = (a: Minute) => segs.reduce((n, s) => n + (s.share ?? 1) * Math.max(0, Math.min(t, s.end) - Math.max(a, s.start)), 0);
  let block28d = 0;
  let planned = 0;
  let planned12m = 0;
  const y = yearOf(t);
  let restUntil = c.restUntil;
  for (const s of segs) {
    if (s.end > t - 28 * DAY && s.end <= t) block28d += s.block;
    if (s.kind !== 'log' && s.end <= t && yearOf(s.end) === y) planned += s.block;
    if (s.kind !== 'log' && s.end <= t) planned12m += s.block;
    if (s.kind !== 'log' && s.end <= t) restUntil = Math.max(restUntil, s.end + s.rest);
  }
  const ctx = ctxOf(g, c);
  return {
    duty7d: dutyIn(t - 7 * DAY),
    duty14d: dutyIn(t - 14 * DAY),
    duty28d: dutyIn(t - 28 * DAY),
    block28d,
    blockYear: (ctx.blockYearOf === y ? c.blockYear : 0) + planned,
    block12m: block12m(c, t) + planned12m,
    restUntil,
    recoveryDue: recoveryAnchor(ctx, segs, t) + LIMITS.recoveryEvery,
  };
}

/** Can this crew member fly this duty's pairing (rating, status, location/positioning, rest, FDP, cumulative, recovery)? */
export function checkAssignment(g: GameState, crewId: string, dutyId: string): LegalityReport {
  const c = g.crew[crewId];
  const d = g.duties[dutyId];
  const p = d && g.pairings[d.pairingId];
  if (!c || !d || !p) return { level: 'illegal', issues: [{ code: 'status', level: 'illegal', text: 'Not found' }] };
  const onIt = p.slots.some((s) => s.crewId === crewId);
  const plan = planCrew(g, c, p, segsOf(g, c, p.id), onIt);
  const issues = plan.issues.filter((i) => !i.dutyId || i.dutyId === d.id || i.code !== 'fdp');
  return { level: levelOf(issues), issues };
}

/** Duty-level legality from its FDP vs max FDP (+ discretion): tight within 30 min of the limit. */
export function dutyLegality(_g: GameState, d: Duty): Legality {
  return dutyLevel(d);
}

/** Days with no duty in the calendar month of t so far and in total (guideline 7 per month; shown, not enforced). */
export function daysOffInMonth(g: GameState, c: CrewMember, monthStartT: Minute, monthEndT: Minute): number {
  const busy = new Set<number>();
  for (const s of segsOf(g, c)) {
    if (s.end <= monthStartT || s.start >= monthEndT) continue;
    for (let t = Math.max(s.start, monthStartT); t < Math.min(s.end, monthEndT); t = Math.floor(t / DAY) * DAY + DAY) busy.add(Math.floor(t / DAY));
  }
  return Math.round((monthEndT - monthStartT) / DAY) - busy.size;
}

/** Minimum rest after a duty (re-export helper for panels). */
export const restAfter = (dutyMin: number, atHome: boolean, augmented = false) => minRest({ dutyMin, atHome, augmented, tzShift: 0 });
