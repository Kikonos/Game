// v0.9 crew out of hours (UPDATE-0.9.md §T): a named pilot or cabin crew member rostered on a flight who has reached a
// legal limit (the day's FDP, the 7/14/28-day duty, 28-day / year / 12-month flying, rest, the weekly recovery, the
// in-flight rest plan, the month's days off), as against a crew shortage (a seat with nobody to fill it). Pure reads.

import { flightsRev } from '../core/entities';
import type { GameState, OohLimit, Role } from '../core/types';
import { crewIssuesFor } from './check';
import { crewName } from './generate';
import type { IssueCode, LegalityIssue } from './rules';
import { flightCrewStatus } from './roster';
import { crewRev } from './timeline';

export type CrewAlertKind = 'short' | 'hours';

export interface OohInfo {
  crewId: string;
  name: string;
  role: Role;
  limit: OohLimit;
  /** The predicate after the name: 'has reached the 28-day flying limit (100 h)', 'is short of minimum rest' (OOH_TEXT). */
  limitText: string;
  /** Value and limit in minutes (0 when the rule has no number, e.g. the weekly recovery). */
  value: number;
  max: number;
  overMin: number;
  /** v0.9 round 4: the rule's own words when the limit name is only a category (standby + FDP, extensions, local nights). */
  text?: string;
}

const LIMIT_OF: Partial<Record<IssueCode, OohLimit>> = {
  fdp: 'fdp', ext7d: 'fdp', standby: 'fdp', rest: 'rest', lateEarly: 'rest', tzRest: 'rest',
  duty7d: 'duty7d', duty14d: 'duty14d', duty28d: 'duty28d', block28d: 'block28d', blockYear: 'blockYear',
  recovery: 'recovery', twoDays: 'recovery', daysOff: 'daysOff',
};

/** v0.9 round 4 (§V): the one name of each legal limit, used everywhere (map tag, gauges, cards, reasons). */
export const LIMIT_NAME: Record<OohLimit, string> = {
  fdp: 'day length (FDP)', duty7d: '7-day duty', duty14d: '14-day duty', duty28d: '28-day duty', block28d: '28-day flying',
  blockYear: 'year flying', block12m: '12-month flying', rest: 'rest', recovery: 'weekly rest', inflightRest: 'in-flight rest', daysOff: 'days off',
};

/** How each limit reads after the name: a full predicate ('Ana Silva is short of minimum rest'). */
export const OOH_TEXT: Record<OohLimit, string> = {
  fdp: `is over the ${LIMIT_NAME.fdp} limit`, duty7d: `has reached the ${LIMIT_NAME.duty7d} limit (60 h)`, duty14d: `has reached the ${LIMIT_NAME.duty14d} limit (110 h)`,
  duty28d: `has reached the ${LIMIT_NAME.duty28d} limit (190 h)`, block28d: `has reached the ${LIMIT_NAME.block28d} limit (100 h)`, blockYear: `has reached the ${LIMIT_NAME.blockYear} limit (900 h)`,
  block12m: `has reached the ${LIMIT_NAME.block12m} limit (1,000 h)`, rest: 'is short of minimum rest', recovery: 'is due the weekly 36 h rest',
  inflightRest: 'cannot rest in this cruise', daysOff: 'would fall below 7 days off this month',
};

/** Rules whose limit name is only a category: the card says the rule in its own words. */
const OWN_WORDS = new Set<IssueCode>(['standby', 'ext7d', 'lateEarly', 'tzRest']);

const ROLE_WORD: Record<Role, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', PUR: 'purser', CC: 'cabin crew' };
export const roleWord = (r: Role): string => ROLE_WORD[r];

/** 'Duty 28d 191:20 > 190:00' → [value, max] in minutes (the first two h:mm in the text). */
function numbers(text: string): [number, number] {
  const m = [...text.matchAll(/(\d+):(\d\d)/g)].map((x) => +x[1] * 60 + +x[2]);
  return m.length >= 2 ? [m[0], m[1]] : [0, 0];
}

/** The out-of-hours reading of a crew member's legality issue (null when it is not a limit: place, rating, status). */
export function infoOf(g: GameState, crewId: string, i: LegalityIssue): OohInfo | null {
  const c = g.crew[crewId];
  let limit = LIMIT_OF[i.code];
  if (!c || !limit) return null;
  if (i.code === 'blockYear' && /12 months/.test(i.text)) limit = 'block12m';
  let [value, max] = numbers(i.text);
  // Rest: 'Rest 9:10 < 12:00' reads value < max (short by the difference).
  const overMin = i.code === 'rest' ? Math.max(0, max - value) : Math.max(0, value - max);
  if (limit === 'recovery' || limit === 'daysOff') value = max = 0;
  return { crewId, name: crewName(c), role: c.role, limit, limitText: OOH_TEXT[limit], value, max, overMin, ...(OWN_WORDS.has(i.code) ? { text: i.text } : {}) };
}

const memo = new WeakMap<GameState, { key: string; m: Map<string, OohInfo[]> }>();

/**
 * Who on the flight's duty is out of hours, and which limit: crew taken off a seat for a limit (slot `ooh`), crew whose
 * own plan breaks a limit on this duty, and everyone aboard a duty whose day runs over its FDP. Pure (memoised per
 * state revision and minute).
 */
export function outOfHours(g: GameState, flightId: string): OohInfo[] {
  const key = `${crewRev(g)}:${flightsRev(g)}:${g.now}`;
  let c = memo.get(g);
  if (!c || c.key !== key) memo.set(g, (c = { key, m: new Map() }));
  const hit = c.m.get(flightId);
  if (hit) return hit;
  const out = compute(g, flightId);
  c.m.set(flightId, out);
  return out;
}

function compute(g: GameState, flightId: string): OohInfo[] {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!f || !d || !p || d.done) return [];
  const out: OohInfo[] = [];
  const seen = new Set<string>();
  for (const s of p.slots) {
    // Taken off for a limit (empty seat), or still aboard with an in-flight rest plan that failed at the gate (§Y.1).
    if (!s.ooh || (s.crewId && s.ooh.limit !== 'inflightRest')) continue;
    const cm = g.crew[s.ooh.crewId];
    if (!cm || seen.has(cm.id)) continue;
    seen.add(cm.id);
    out.push({ crewId: cm.id, name: crewName(cm), role: cm.role, limit: s.ooh.limit, limitText: OOH_TEXT[s.ooh.limit], value: 0, max: 0, overMin: s.ooh.over });
  }
  const cs = flightCrewStatus(g, flightId, { live: false });
  if (cs.level !== 'illegal' && cs.level !== 'missing') return out;

  for (const { crewId, issue } of crewIssuesFor(g, d)) {
    if (seen.has(crewId)) continue;
    const x = infoOf(g, crewId, issue);
    if (!x) continue;
    seen.add(crewId);
    out.push(x);
  }
  const max = d.maxFdp + (d.discretion ?? 0);
  if (d.fdp > max) {
    for (const s of p.slots) {
      const cm = s.crewId ? g.crew[s.crewId] : undefined;
      if (!cm || seen.has(cm.id)) continue;
      seen.add(cm.id);
      out.push({ crewId: cm.id, name: crewName(cm), role: cm.role, limit: 'fdp', limitText: OOH_TEXT.fdp, value: d.fdp, max, overMin: d.fdp - max });
    }
  }
  return out;
}

/**
 * v0.9 the kind of crew alert a flight carries: 'hours' when a named crew member is at a legal limit (it names a
 * person, so it wins when both apply), 'short' for any other missing or illegal crew (wrong place, busy, sick, not
 * rated, nobody free), null when the crew is fine. Pure.
 */
export function crewAlertKind(g: GameState, flightId: string): CrewAlertKind | null {
  const cs = flightCrewStatus(g, flightId, { live: false });
  if (cs.level !== 'missing' && cs.level !== 'illegal') {
    // A rest plan that failed at the gate (§Y.1) holds a flight whose crew are otherwise complete.
    const f = g.flights[flightId];
    const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
    return d && g.pairings[d.pairingId]?.slots.some((s) => s.ooh?.limit === 'inflightRest' && s.crewId) ? 'hours' : null;
  }
  return outOfHours(g, flightId).length ? 'hours' : 'short';
}
