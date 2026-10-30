// v0.7.1 one reason per person (UPDATE-0.7.1.md §6): a crew member's legality issues reduced to the ROOT cause,
// in plain words, with the full list behind it. A pilot on another trip is "busy", never "at LIS, not DUS".

import { AIRPORT_BY_CODE } from '../../data/airports';
import { typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtTime } from '../core/time';
import type { CrewMember, GameState, Minute, Pairing } from '../core/types';
import { openDuties, otherTrip } from './check';
import { LIMIT_NAME } from './outOfHours';
import { LIMITS, type LegalityIssue } from './rules';
import { crewIx, typeIdOf } from './timeline';

export type ReasonCode = 'place' | 'rest' | 'fdp' | 'busy' | 'sick' | 'leave' | 'joining' | 'training' | 'rating' | 'hours' | 'recovery'
  /** v0.12.1 only days off stand in the way (a published day off, the month's minimum): before, it read as 'place'. */
  | 'daysOff';

export interface Reason {
  code: ReasonCode;
  /** Short, after a name: 'busy on AWQ815 to London until 10:30', 'resting until 09:10', 'in Lisbon, landing 11:40 at the earliest'. */
  text: string;
  /** The full list for 'tap the person'. */
  all: string[];
  /** The moment the reason ends, when known (rest ends, trip ends, sick until). */
  until?: Minute;
}

/** Root-cause order: a later code never wins over an earlier one present in the issues. */
// v0.12.1 days off last: the softest blocker (a buy-back lifts it), named only when nothing harder is in the way.
const ORDER: ReasonCode[] = ['busy', 'sick', 'leave', 'joining', 'training', 'rating', 'rest', 'fdp', 'hours', 'recovery', 'place', 'daysOff'];

export const city = (code: string): string => AIRPORT_BY_CODE[code]?.city ?? code;
const at = (t: Minute, now: Minute) => (Math.floor(t / DAY) === Math.floor(now / DAY) ? fmtTime(t) : fmtDateTime(t));
const HM = /(\d+):(\d+)\s*(?:>|of)\s*(\d+):(\d+)/;
const toH = (h: string, m: string) => Math.round((Number(h) + Number(m) / 60) * 10) / 10;

/** The reason behind a 'status' issue (the block the trip touches), else the status itself. */
function statusCode(c: CrewMember, from: Minute, to: Minute): { code: ReasonCode; until?: Minute } {
  const b = c.blocks?.find((x) => x.from < to && x.to > from);
  const why = b?.why ?? (c.status === 'sick' || c.status === 'leave' || c.status === 'training' || c.status === 'joining' ? c.status : 'leave');
  return { code: why, until: b?.to };
}

/**
 * The one reason a crew member can't (or barely can) take pairing p, from their legality issues (FDP issues are the
 * duty's own and ignored). Null when nothing is wrong. Pure.
 */
export function rootReason(g: GameState, issues: LegalityIssue[], c: CrewMember, p?: Pairing, subjectNo?: string): Reason | null {
  const bad = issues.filter((i) => i.code !== 'fdp' && i.level !== 'legal');
  const fdp = issues.find((i) => i.code === 'fdp' && i.level !== 'legal');
  if (!bad.length && !fdp) return null;
  const all = [...new Set([...bad, ...(fdp ? [fdp] : [])].map((i) => i.text))];
  const has = (code: LegalityIssue['code']) => bad.find((i) => i.code === code);
  const open = p ? openDuties(g, p) : [];
  const from = open[0]?.report ?? g.now;
  const to = open[open.length - 1]?.release ?? g.now + DAY;
  const codes = new Map<ReasonCode, Reason>();
  const set = (code: ReasonCode, text: string, until?: Minute) => codes.set(code, { code, text, all, until });
  if (has('overlap')) {
    const q = p ? otherTrip(g, c, p, from, to, false) : null;
    const qd = q ? openDuties(g, q) : [];
    const f = qd.length ? g.flights[qd[0].flightIds[0]] : undefined;
    const end = qd.length ? qd[qd.length - 1].release : undefined;
    // Flight numbers repeat day by day: another day's leg is dated, and a leg with the subject's own number is
    // called "another day's", so nobody reads "busy on the flight he is missing from".
    const subject = p ? g.flights[openDuties(g, p)[0]?.flightIds[0] ?? '']?.no : undefined;
    const sameNo = !!f && f.no === (subjectNo ?? subject);
    const today = !!f && Math.floor(f.std / DAY) === Math.floor(g.now / DAY);
    const which = f ? `${sameNo ? "another day's " : ''}${f.no} to ${city(f.to)}${!today && !sameNo ? ` on ${fmtDay(f.std)}` : ''}` : '';
    set('busy', f ? `busy on ${which} until ${end !== undefined ? at(end, g.now) : fmtDay(q!.end)}` : `busy on another ${q?.tour ? 'tour' : 'trip'}${end !== undefined ? ` until ${at(end, g.now)}` : ''}`, end);
  }
  if (has('status')) {
    const s = statusCode(c, from, to);
    const until = s.until !== undefined ? ` until ${fmtDay(s.until)}` : '';
    set(s.code, s.code === 'joining' ? `not joined yet${s.until !== undefined ? ` (joins ${fmtDay(s.until)})` : ''}` : s.code === 'training' ? `in training${until}` : s.code === 'sick' ? `sick${until}` : `on leave${until}`, s.until);
  }
  if (has('rating')) set('rating', `not rated on the ${p ? typeOf(typeIdOf(g, p)).family : 'type'}`);
  const rest = has('rest');
  if (rest) {
    const until = c.restUntil > from ? c.restUntil : undefined;
    // v0.12.1 the rest before their NEXT trip: name it (BLU1570: 'short of rest before it' read as resting now, while the
    // captain was simply rostered on BLU755 that evening).
    const next = /^Rest before next duty (\d+:\d\d) < (\d+:\d\d)/.exec(rest.text);
    const q = next && p ? nextTrip(g, c, p) : null;
    const qf = q ? g.flights[openDuties(g, q)[0]?.flightIds[0] ?? ''] : undefined;
    if (qf && next) set('rest', `rostered next on ${qf.no} ${city(qf.from)}–${city(qf.to)} (${fmtDay(qf.std)}): only ${next[1]} rest before it, ${next[2]} needed`);
    else set('rest', until !== undefined ? `resting until ${at(until, g.now)}` : `short of rest before it (${rest.text.toLowerCase()})`, until);
  }
  if (fdp) {
    const m = HM.exec(fdp.text);
    set('fdp', m ? `over the day-length limit (${m[1]}:${m[2]} of ${m[3]}:${m[4]})` : 'over the day-length limit');
  }
  const hours = has('block28d') ?? has('duty7d') ?? has('duty14d') ?? has('duty28d') ?? has('blockYear');
  if (hours) {
    const m = HM.exec(hours.text);
    // v0.9 round 4 (§V): the one name of each limit (crew/outOfHours.ts LIMIT_NAME).
    const what = hours.code === 'blockYear' && /12 months/.test(hours.text) ? LIMIT_NAME.block12m : LIMIT_NAME[hours.code as 'block28d' | 'blockYear' | 'duty7d' | 'duty14d' | 'duty28d'];
    set('hours', m ? `at ${toH(m[1], m[2])} of ${toH(m[3], m[4])} h ${what}` : `over the ${what} limit`);
  }
  if (has('recovery')) set('recovery', `due a weekly rest (${LIMITS.recovery / 60} h off) first`);
  // v0.7.3 rules (UPDATE-0.7.3.md §3): extension / night sectors / standby read as the day limit, the rest rules as rest.
  const day = has('ext7d') ?? has('nightSectors') ?? has('standby');
  if (day && !codes.has('fdp')) {
    // The standby's start from the rule's own words ('On standby from 06:00: …').
    const since = day.code === 'standby' ? /from (\d\d:\d\d)/.exec(day.text)?.[1] : undefined;
    set('fdp', day.code === 'ext7d' ? 'already 2 extended days this week' : day.code === 'standby' ? `on standby since ${since ?? 'early morning'}: standby plus the day would pass 18 h awake` : 'a second night in a row with more than 4 sectors');
  }
  const rest2 = has('lateEarly') ?? has('tzRest');
  if (rest2 && !codes.has('rest')) set('rest', rest2.code === 'lateEarly' ? 'finished late: needs a whole local night before an early start' : 'back from a trip across time zones: needs local nights at home first');
  if (has('twoDays') && !codes.has('recovery')) set('recovery', 'due a 2-day weekend off this month');
  const loc = has('location');
  if (loc) {
    const arr = /earliest arrival (\w{3}) ([^,]+), must land by/i.exec(loc.text);
    const where = /^At (\w{3}), not (\w{3})/.exec(loc.text);
    const resting = /^Resting at (\w{3}) until ([^;]+);/.exec(loc.text);
    if (arr) set('place', `in ${city(resting?.[1] ?? c.loc)}, landing ${arr[2].trim()} at the earliest`);
    else if (where) set('place', `in ${city(where[1])}, not ${city(where[2])}`);
    else if (/FDP/.test(loc.text)) set('place', `in ${city(resting?.[1] ?? c.loc)}: flown in the same day the day runs too long`);
    else set('place', `in ${city(c.loc)}, can't get there in time`);
  }
  // v0.12.1 a day off (published, or the month's minimum): its own words, never the 'place' fallback (BLU1565: Lisbon
  // captains on days off read as 'free in Lisbon, flown in the same day the day runs too long').
  const off = has('daysOff');
  if (off) set('daysOff', offText(off.text));
  for (const code of ORDER) {
    const r = codes.get(code);
    if (r) return r;
  }
  return { code: 'place', text: all[0] ?? 'not available', all };
}

/**
 * v0.12.1 a 'daysOff' issue in plain words: 'on a day off Tue 26 Oct (published)', 'short of days off in October (6 of
 * 7 with this trip)'. Pure.
 */
export function offText(text: string): string {
  const m = /^Days off in (\S+) would fall to (\d+) \(minimum (\d+)\)/.exec(text);
  if (m) return `short of days off in ${m[1]} (${m[2]} of ${m[3]} with this trip)`;
  const d = /^Day off (\w{3} \d+ \w{3})(?: \((published)\))?/.exec(text);
  if (d) return `on a day off ${d[1]}${d[2] ? ' (published)' : ''}`;
  return text.charAt(0).toLowerCase() + text.slice(1);
}


/** v0.12.1 c's next trip after p (the one a short rest after p bites on). */
function nextTrip(g: GameState, c: CrewMember, p: Pairing): Pairing | null {
  let best: Pairing | null = null;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (q.id === p.id || q.status === 'done' || q.status === 'broken' || q.start < p.start) continue;
    if (!best || q.start < best.start) best = q;
  }
  return best;
}
