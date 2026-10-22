// v0.7.1 one reason per person (UPDATE-0.7.1.md §6): a crew member's legality issues reduced to the ROOT cause,
// in plain words, with the full list behind it. A pilot on another trip is "busy", never "at LIS, not DUS".

import { AIRPORT_BY_CODE } from '../../data/airports';
import { typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtTime } from '../core/time';
import type { CrewMember, GameState, Minute, Pairing } from '../core/types';
import { openDuties, otherTrip } from './check';
import { LIMITS, type LegalityIssue } from './rules';
import { typeIdOf } from './timeline';

export type ReasonCode = 'place' | 'rest' | 'fdp' | 'busy' | 'sick' | 'leave' | 'joining' | 'training' | 'rating' | 'hours' | 'recovery';

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
const ORDER: ReasonCode[] = ['busy', 'sick', 'leave', 'joining', 'training', 'rating', 'rest', 'fdp', 'hours', 'recovery', 'place'];

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
    set('rest', until !== undefined ? `resting until ${at(until, g.now)}` : `short of rest before it (${rest.text.toLowerCase()})`, until);
  }
  if (fdp) {
    const m = HM.exec(fdp.text);
    set('fdp', m ? `over the day limit (${m[1]}:${m[2]} of ${m[3]}:${m[4]})` : 'over the day limit');
  }
  const hours = has('block28d') ?? has('duty7d') ?? has('duty14d') ?? has('duty28d') ?? has('blockYear');
  if (hours) {
    const m = HM.exec(hours.text);
    const what = hours.code === 'block28d' ? 'flying hours in 28 days' : hours.code === 'blockYear' ? 'flying hours this year' : hours.code === 'duty7d' ? 'duty hours in 7 days' : hours.code === 'duty14d' ? 'duty hours in 14 days' : 'duty hours in 28 days';
    set('hours', m ? `at ${toH(m[1], m[2])} of ${toH(m[3], m[4])} ${what}` : `over the ${what} limit`);
  }
  if (has('recovery')) set('recovery', `due a weekly rest (${LIMITS.recovery / 60} h off) first`);
  // v0.7.3 rules (UPDATE-0.7.3.md §3): extension / night sectors / standby read as the day limit, the rest rules as rest.
  const day = has('ext7d') ?? has('nightSectors') ?? has('standby');
  if (day && !codes.has('fdp')) set('fdp', day.code === 'ext7d' ? 'already 2 extended days this week' : day.code === 'standby' ? 'on standby since early: the day would run past 18 h awake' : 'a second night in a row with more than 4 sectors');
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
  for (const code of ORDER) {
    const r = codes.get(code);
    if (r) return r;
  }
  return { code: 'place', text: all[0] ?? 'not available', all };
}
