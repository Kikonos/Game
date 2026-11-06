// Alarm self-check (the player, 2026-11-05): before a crew alarm chimes, pauses or shows its card, it is checked again
// on its own terms, apart from the planner that raised it:
//   1. staleness: the flight is still scheduled and ahead, still on the duty the alarm names (not moved or re-cut);
//   2. the duty re-measured from its flights as they are now (syncDuty, on a copy of the game);
//   3. each named person judged by an independent FTL evaluator written from the rules (the scripts/invariants.ts
//      reading: ORO.FTL.210 cumulative duty and flying, ORO.FTL.235 rest, Table 2 day length, status, place, rating),
//      never by planCrew's caches;
//   4. the planner's own fix tried in a dry run on the copy (Crew Control's free fixes).
// Only a confirmed problem goes on to chime, pause and show its card, with a "Checked ✓" and the evidence (who, which
// limit, value against limit, when). When the check disagrees nothing chimes or pauses: a silent record is kept
// (GameState.selfCheck) for the UI to file into Bug reports with a snapshot, and counted (dev panel, bot report).
// Runs only when an alarm would fire; deterministic (it reads the game and works on a structured copy).

import { cabinMinimum, isPilot, reportMinutes, typeOf } from '../core/perf';
import { isolatePauses } from '../core/pause';
import { DAY, fmtDateTime } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Minute, OohLimit, Pairing, SelfCheckRecord, SelfCheckState } from '../core/types';
import { BAL } from '../core/balance';
import { cabinInflightRest, offsetAt } from './rules';
import { restOf } from './restPlan';

const H = 60;
/** A claim is refuted only when the independent reading is clear of the limit by this much (rounding, report times). */
const MARGIN = 15;

export type AlarmKind = 'short' | 'hours' | 'early' | 'takenOff' | 'rest';

export interface Verdict {
  confirmed: boolean;
  /** Evidence lines: 'Rui Teixeira (CPT): 7-day duty 66:12 of 60:00 at 6 Jun 15:20 UTC'. */
  evidence: string[];
  /** Why the alarm was withheld (empty when confirmed). */
  why: string;
}

const hm = (m: number) => `${m < 0 ? '−' : ''}${Math.floor(Math.abs(m) / 60)}:${String(Math.round(Math.abs(m) % 60)).padStart(2, '0')}`;
const nameOf = (c: CrewMember) => `${c.first} ${c.last} (${c.role})`;

// ---------- the independent FTL evaluator ----------

/** ORO.FTL.235 minimum rest (independent of crew/rules.ts minRest; the scripts/invariants.ts reading). */
export function restNeed(dutyMin: number, atHome: boolean, aug: boolean, tzH: number, ext: boolean): number {
  let base = atHome ? 12 * H : 10 * H;
  if (aug || (!atHome && tzH >= 4)) base = 14 * H;
  return Math.max(dutyMin, base) + (ext ? 4 * H : 0);
}

/**
 * CS FTL.1.205 Table 2 (acclimatised crew): the basic maximum daily FDP by local report time and sectors, written out
 * from the table (13:00 for 1–2 sectors from 06:00 to 13:29, 15 min less per half hour later down to 11:00 from 17:00
 * to 04:59, back up from 05:00; 30 min less per sector from the 3rd, never under 9:00).
 */
export function table2(reportLocal: number, sectors: number): number {
  const t = ((reportLocal % DAY) + DAY) % DAY;
  let base: number;
  if (t >= 6 * H && t < 13 * H + 30) base = 13 * H;
  else if (t >= 13 * H + 30 && t < 17 * H) base = 13 * H - 15 * (Math.floor((t - (13 * H + 30)) / 30) + 1);
  else if (t >= 17 * H || t < 5 * H) base = 11 * H;
  else base = 12 * H + 15 * Math.floor((t - 5 * H) / 15);
  return Math.max(9 * H, base - Math.max(0, sectors - 2) * 30);
}

/** Augmented day caps (CS FTL.1.205(c)(2), class 1 rest, one long sector): the most any augmented day may run. */
const AUG_CAP: Record<1 | 2, number> = { 1: 17 * H, 2: 18 * H };

interface Span { start: Minute; end: Minute; block: number; aug: boolean; ext: boolean; dep: string; arr: string; kind: 'duty' | 'ticket' | 'standby' | 'log'; weight: number }

/** One planned duty of a crew member, measured from its flights as they are now (report and release from the legs). */
function dutySpan(g: GameState, d: Duty, p: Pairing, cabin: boolean): Span | null {
  const fl = d.flightIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
  if (!fl.length) return null;
  const typeId = (p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo';
  const rm = reportMinutes(typeId);
  const early = cabin ? d.cabinEarly ?? 0 : 0;
  const first = fl[0];
  const last = fl[fl.length - 1];
  const start = (first.status === 'scheduled' ? first.std + (first.delay ?? 0) : d.report) - (first.status === 'scheduled' ? rm.report + early : 0);
  const end = (last.status === 'done' ? last.ata ?? last.sta : last.status === 'enroute' ? last.eta ?? last.sta : last.sta + (last.delay ?? 0)) + rm.post;
  return { start, end, block: fl.reduce((s, f) => s + f.block, 0), aug: d.augment > 0, ext: !!d.ext, dep: first.from, arr: last.to, kind: 'duty', weight: 1 };
}

/** Everything a crew member works around t (28 days back, the next 3 days): flown log, planned duties, tickets, standby. */
function workOf(g: GameState, c: CrewMember, t: Minute, skipDuty?: string): Span[] {
  const out: Span[] = [];
  const from = t - 29 * DAY;
  const to = t + 3 * DAY;
  for (const e of c.log) if (e.end > from) out.push({ start: e.start, end: e.end, block: e.block, aug: e.augmented, ext: !!e.ext, dep: '', arr: '', kind: 'log', weight: 1 });
  const logged = (s: Span) => out.some((x) => x.kind === 'log' && x.start < s.end && s.start < x.end);
  for (const p of Object.values(g.pairings)) {
    if (p.status === 'done' || p.status === 'broken' || !p.slots.some((s) => s.crewId === c.id)) continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (!d) continue;
      const s = dutySpan(g, d, p, !isPilot(c.role));
      if (!s || s.end < from || s.start > to) continue;
      if (id !== skipDuty && !logged(s)) out.push(s);
      for (const tid of d.deadheadIds) {
        const tk = g.flights[tid];
        if (!tk || tk.status === 'cancelled' || !tk.crewIds.includes(c.id)) continue;
        out.push({ start: tk.std - H, end: tk.sta, block: 0, aug: false, ext: false, dep: tk.from, arr: tk.to, kind: 'ticket', weight: 1 });
      }
    }
  }
  for (const w of c.standby ?? []) {
    if (w.to < from || w.from > to) continue;
    const end = w.calledAt !== undefined ? Math.min(w.to, w.calledAt) : w.to;
    const kind = w.kind ?? 'home';
    if (kind === 'reserve' || end <= w.from) continue;
    out.push({ start: w.from, end, block: 0, aug: false, ext: false, dep: w.at ?? c.base, arr: w.at ?? c.base, kind: 'standby', weight: kind === 'airport' ? 1 : 0.25 });
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

const overlap = (s: Span, a: Minute, b: Minute) => Math.max(0, Math.min(s.end, b) - Math.max(s.start, a));

export interface PersonReading {
  /** Limit → [value, max] in minutes as the independent evaluator reads it (rest: [rest had, rest needed]). */
  values: Partial<Record<OohLimit, [number, number]>>;
  /** Plain problems it found on its own (status, place, rating, overlap), by the engine's issue code. */
  other: Partial<Record<'status' | 'location' | 'rating' | 'overlap', string>>;
}

/**
 * Judges one crew member on duty d (as if aboard, whether or not they still hold the seat): cumulative duty (7/14/28
 * days, standby 25 % at home, 100 % at the airport), 28-day flying, rest before the report, the day's length, status
 * blocks, place and type rating. Pure.
 */
export function judgePerson(g: GameState, c: CrewMember, d: Duty, p: Pairing): PersonReading {
  const values: PersonReading['values'] = {};
  const other: PersonReading['other'] = {};
  const me = dutySpan(g, d, p, !isPilot(c.role));
  if (!me) return { values, other };
  const work = workOf(g, c, me.end, d.id);
  const all = [...work, me];
  const sum = (days: number, block = false) => all.reduce((s, x) => s + (block ? (x.end > me.end - days * DAY ? x.block : 0) : overlap(x, me.end - days * DAY, me.end) * x.weight), 0);
  values.duty7d = [sum(7), 60 * H];
  values.duty14d = [sum(14), 110 * H];
  values.duty28d = [sum(28), 190 * H];
  values.block28d = [sum(28, true), 100 * H];
  // Rest before the report: from the end of the last work before it (a standby ended by this duty is its call-out).
  const prev = work.filter((x) => x.end <= me.start + 1 && x.kind !== 'standby').pop();
  const prevAny = work.filter((x) => x.end <= me.start + 1).pop();
  if (prev && prevAny === prev) {
    const atHome = me.dep === c.base;
    const tz = Math.abs(offsetAt(c.base, me.start) - offsetAt(me.dep, me.start)) / 60;
    values.rest = [me.start - prev.end, restNeed(prev.end - prev.start, atHome, prev.aug, tz, prev.ext)];
  }
  // The day's length against Table 2 at the departure's local report time (augmented: the cap of the class 1 table).
  const fdp = me.end - me.start - reportMinutes((p.aircraftId && g.fleet[p.aircraftId]?.typeId) || 'a320ceo').post;
  const max = d.augment > 0 ? AUG_CAP[d.augment as 1 | 2] : Math.max(table2(me.start + offsetAt(me.dep, me.start), d.flightIds.length), d.ext ? 14 * H : 0, d.split ? 16 * H : 0);
  values.fdp = [fdp, max + (d.discretion ?? 0)];
  const bl = c.blocks?.find((b) => b.from < me.end && b.to > me.start && (b.why === 'sick' || b.why === 'leave' || b.why === 'joining' || b.why === 'training'));
  if (bl) other.status = `${bl.why} ${fmtDateTime(bl.from)}–${fmtDateTime(bl.to)} UTC`;
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  if (ac && !c.ratings.includes(typeOf(ac.typeId).family)) other.rating = `not rated on the ${typeOf(ac.typeId).family}`;
  // Place: where the last work before the report ends (a ticket in, a duty), else where they are now.
  const lastPlace = [...work].filter((x) => x.end <= me.start + 1 && x.arr && x.kind !== 'standby').pop()?.arr ?? c.loc;
  if (lastPlace && lastPlace !== me.dep && me.start > g.now) other.location = `at ${lastPlace}, the duty leaves from ${me.dep}`;
  // Busy: other work (a duty or a ticket) inside this one.
  const clash = work.find((x) => (x.kind === 'duty' || x.kind === 'ticket') && x.start < me.end - 1 && me.start < x.end - 1);
  if (clash) other.overlap = `busy ${fmtDateTime(clash.start)}–${fmtDateTime(clash.end)} UTC`;
  return { values, other };
}

/** Engine issue codes and out-of-hours limits the independent reading can judge (others are trusted as raised). */
const AS_LIMIT: Record<string, OohLimit> = { fdp: 'fdp', rest: 'rest', duty7d: 'duty7d', duty14d: 'duty14d', duty28d: 'duty28d', block28d: 'block28d' };

/** True when the independent reading clearly refutes the claim `code` for this person; null when it cannot judge it. */
function refutes(r: PersonReading, code: string): boolean | null {
  if (code === 'status' || code === 'location' || code === 'rating' || code === 'overlap') return !r.other[code];
  const limit = AS_LIMIT[code];
  const v = limit ? r.values[limit] : undefined;
  if (!v) return null;
  if (limit === 'rest') return v[0] >= v[1] + MARGIN;
  return v[0] <= v[1] - MARGIN;
}

const CODE_WORDS: Record<string, string> = {
  blockYear: 'year flying limit', block12m: '12-month flying limit', recovery: 'weekly 36 h rest due', twoDays: 'two local days off due', daysOff: 'a planned day off',
  inflightRest: 'cannot rest in this cruise', ext7d: 'second extension in 7 days', nightSectors: 'too many night sectors', lateEarly: 'late finish before an early start',
  tzRest: 'rest after a time-zone change', standby: 'standby and duty too long together', workBlock: 'too many days in a row',
};

const LIMIT_WORDS: Partial<Record<OohLimit, string>> = { duty7d: '7-day duty', duty14d: '14-day duty', duty28d: '28-day duty', block28d: '28-day flying', rest: 'rest', fdp: 'day length (FDP)' };

/** 'Rui Teixeira (CPT): 7-day duty 66:12 of 60:00 at 6 Jun 15:20 UTC'. */
function line(c: CrewMember, limit: OohLimit, r: PersonReading, at: Minute): string {
  const v = r.values[limit];
  if (!v) return `${nameOf(c)}: ${LIMIT_WORDS[limit] ?? limit} (not checked independently)`;
  return limit === 'rest' ? `${nameOf(c)}: rest ${hm(v[0])} of ${hm(v[1])} needed, before ${fmtDateTime(at)} UTC` : `${nameOf(c)}: ${LIMIT_WORDS[limit]} ${hm(v[0])} of ${hm(v[1])} at ${fmtDateTime(at)} UTC`;
}

/** Limits over (or rest short) in a reading, with the evidence lines. */
function breaches(c: CrewMember, r: PersonReading, at: Minute): string[] {
  const out: string[] = [];
  for (const k of Object.keys(r.values) as OohLimit[]) {
    const v = r.values[k]!;
    if (k === 'rest' ? v[0] < v[1] - 1 : v[0] > v[1] + 1) out.push(line(c, k, r, at));
  }
  for (const o of Object.values(r.other)) out.push(`${nameOf(c)}: ${o}`);
  return out;
}

// ---------- in-flight rest, read on its own ----------

/**
 * Whether the in-flight rest of an augmented duty clearly fits at the gate (legs shifted by the hold to `at`): every
 * pilot group back to back on one leg's cruise, and every cabin crew round back to back on one leg's cabin window, with
 * MARGIN to spare. A sufficient test (it never says "fits" when it may not); the evidence line says what it found.
 */
export function inflightFits(g: GameState, d: Duty, p: Pairing, at: Minute): { fits: boolean; line: string } {
  const B = BAL.v073.rest;
  const fl = d.flightIds.map((id) => g.flights[id]).filter((f): f is Flight => !!f && f.status !== 'cancelled');
  const rest = restOf(g, p.aircraftId);
  if (!fl.length || d.augment <= 0 || !rest.fc) return { fits: false, line: 'no rest facility or no augmented crew' };
  const shift = Math.max(0, at - fl[0].std);
  const legs = fl.map((f) => ({ std: f.std + shift, sta: f.sta + shift }));
  const pilotWin = Math.max(...legs.map((l) => l.sta - B.todMin - B.wakeMin - (l.std + B.tocMin)));
  const pilotNeed = d.augment === 1 ? 90 + 120 + 120 : rest.fc.places >= 2 ? 90 + 120 : 90 + 90 + 120 + 120;
  const pOk = pilotNeed <= pilotWin - MARGIN;
  const cabin = p.slots.filter((s) => s.crewId && g.crew[s.crewId] && !isPilot(g.crew[s.crewId].role)).length;
  if (!cabin) return { fits: pOk, line: `pilots need ${hm(pilotNeed)} in a cruise of ${hm(pilotWin)}` };
  if (!rest.cc) return { fits: false, line: 'no cabin crew rest facility' };
  const cabinFdp = d.fdp + shift + (d.cabinEarly ?? 0);
  const need = cabinInflightRest(cabinFdp, rest.cc.cls);
  const per = Math.min(rest.cc.places, Math.floor(cabin / 2));
  const cabinWin = Math.max(...legs.map((l) => l.sta - B.cabinBeforeLanding - (l.std + B.cabinAfterTakeoff)));
  if (need === null || per < 1) return { fits: false, line: `cabin crew day ${hm(cabinFdp)}: no rest allowed in class ${rest.cc.cls}` };
  const rounds = Math.ceil(cabin / per);
  const cOk = rounds * need <= cabinWin - MARGIN;
  return { fits: pOk && cOk, line: `pilots need ${hm(pilotNeed)} of ${hm(pilotWin)} cruise; ${cabin} cabin crew ${rounds} × ${hm(need)} of ${hm(cabinWin)}` };
}

// ---------- the check ----------

/** A claim the alarm makes about one person: an issue code ('location', 'duty7d', …) or an out-of-hours limit. */
export interface Claim { crewId: string; code: string }

export interface CheckHooks {
  /** Re-measures a duty from its flights (duties.ts syncDuty). */
  sync: (h: GameState, d: Duty, p: Pairing) => void;
  /** The planner's own free fix for the flight (re-roster, standby call-out), run on the copy only. */
  fix?: (h: GameState, flightId: string) => void;
  /** Whether the flight's crew is still short or illegal on the copy (roster.ts flightCrewStatus). */
  bad: (h: GameState, flightId: string) => boolean;
  /** What the alarm claims about named crew (the engine's issue codes or out-of-hours limits), read on the copy. */
  claims?: (h: GameState, flightId: string) => Claim[];
}

/**
 * Checks one crew alarm on flight `flightId` before it fires. Pure for `g` (it works on a structured copy).
 * `names`: crew the alarm names that may no longer hold a seat (taken off for a limit).
 */
export function checkAlarm(g: GameState, kind: AlarmKind, flightId: string, hooks: CheckHooks, names: Claim[] = []): Verdict {
  const f = g.flights[flightId];
  const withhold = (why: string, evidence: string[] = []): Verdict => ({ confirmed: false, why, evidence });
  // 1. Staleness on the live game (cheap).
  if (!f) return withhold('the flight no longer exists');
  if (f.status !== 'scheduled') return withhold(`the flight is ${f.status}`);
  if (f.std + (f.delay ?? 0) + 6 * H < g.now) return withhold('the flight is long past its departure');
  const d0 = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d0 || !d0.flightIds.includes(f.id) || d0.done) return withhold('the duty was re-cut or is done');
  const p0 = g.pairings[d0.pairingId];
  if (!p0 || !p0.dutyIds.includes(d0.id)) return withhold('the duty has no trip any more');
  return isolatePauses(() => {
    // 2. The copy, the duty re-measured from its flights as they are now.
    const h = structuredClone(g);
    const d = h.duties[d0.id];
    const p = h.pairings[p0.id];
    const was = { report: d.report, fdp: d.fdp };
    hooks.sync(h, d, p);
    const moved = d.report !== was.report || d.fdp !== was.fdp ? `re-measured: report ${fmtDateTime(was.report)} → ${fmtDateTime(d.report)} UTC, day ${hm(was.fdp)} → ${hm(d.fdp)}` : '';
    const at = d.report;
    const evidence: string[] = [];
    if (moved) evidence.push(moved);
    // The in-flight rest at the gate: read on its own from the legs, the facilities and the crew aboard.
    if (kind === 'rest') {
      const r = inflightFits(h, d, p, Math.max(f.std + (f.delay ?? 0), h.now));
      evidence.push(`In-flight rest on ${f.no}: ${r.line}`);
      return r.fits ? withhold('the in-flight rest fits when read on its own', evidence) : { confirmed: true, evidence, why: '' };
    }
    // 3. Seats and the minimum crew, counted from the slots (not the planner's marks).
    const empty = p.slots.filter((s) => !s.crewId && !s.above);
    const aboard = p.slots.filter((s) => s.crewId && h.crew[s.crewId]).map((s) => h.crew[s.crewId!]);
    const pilots = aboard.filter((c) => isPilot(c.role));
    const ac = p.aircraftId ? h.fleet[p.aircraftId] : undefined;
    const pax = d.flightIds.some((id) => h.flights[id]?.kind === 'revenue' || h.flights[id]?.kind === 'techstop');
    const cabinMin = ac && pax ? cabinMinimum(ac.typeId, ac.cabin.total) : 0;
    const cabinN = aboard.length - pilots.length;
    if (empty.length) evidence.push(`${empty.length} seat${empty.length > 1 ? 's' : ''} empty (${empty.map((s) => s.role).join(', ')}) on ${f.no} ${f.from}–${f.to}, report ${fmtDateTime(at)} UTC`);
    if (pilots.length < 2 + d.augment) evidence.push(`pilots ${pilots.length} of ${2 + d.augment}`);
    else if (!pilots.some((c) => c.role === 'CPT')) evidence.push('no captain aboard');
    if (cabinN < cabinMin) evidence.push(`cabin crew ${cabinN} of ${cabinMin}`);
    // 4. Each named person, and everyone aboard, judged independently.
    const named = [...names, ...(hooks.claims?.(h, f.id) ?? [])];
    let claimsLeft = 0;
    let claimsRefuted = 0;
    const seen = new Set<string>();
    for (const n of named) {
      const c = h.crew[n.crewId];
      if (!c || seen.has(`${c.id}|${n.code}`)) continue;
      seen.add(`${c.id}|${n.code}`);
      const r = judgePerson(h, c, d, p);
      if (refutes(r, n.code) === true) {
        claimsRefuted++;
        continue;
      }
      claimsLeft++;
      const lim = AS_LIMIT[n.code];
      const o = r.other[n.code as keyof PersonReading['other']];
      evidence.push(lim ? line(c, lim, r, at) : o ? `${nameOf(c)}: ${o}` : `${nameOf(c)}: ${CODE_WORDS[n.code] ?? n.code} (as the roster reads it)`);
    }
    let breached = 0;
    for (const c of aboard) {
      const b = breaches(c, judgePerson(h, c, d, p), at);
      breached += b.length;
      evidence.push(...b);
    }
    const seatsBad = empty.length > 0 || pilots.length < 2 + d.augment || !pilots.some((c) => c.role === 'CPT') || cabinN < cabinMin;
    const problem = seatsBad || breached > 0 || claimsLeft > 0;
    if (!problem) {
      return withhold(
        claimsRefuted ? `every limit it names is clear when checked on its own (${claimsRefuted} claim${claimsRefuted > 1 ? 's' : ''} refuted), and every seat is filled` : 'every seat is filled and the crew aboard are within their limits',
        evidence,
      );
    }
    // 5. The planner's own fix, in a dry run: if it crews the flight, the alarm is not a confirmed problem.
    if (hooks.fix && (kind === 'short' || kind === 'early' || kind === 'takenOff') && seatsBad) {
      hooks.fix(h, f.id);
      if (h.flights[f.id] && !hooks.bad(h, f.id)) return withhold('the planner\'s own fix crews it (dry run)', evidence);
      evidence.push('no free fix: the roster run again and standby call-outs leave it short (dry run)');
    }
    return { confirmed: true, evidence: evidence.slice(0, 8), why: '' };
  });
}

// ---------- records and counters ----------

export function selfCheckState(g: GameState): SelfCheckState {
  return (g.selfCheck ??= { confirmed: 0, withheld: 0, log: [], pending: [] });
}

/** Counts a verdict; a withheld one is logged (last 20) and queued for the Bug reports (takeSelfCheckRecords). */
export function noteVerdict(g: GameState, kind: AlarmKind, f: Flight | undefined, title: string, v: Verdict): void {
  const s = selfCheckState(g);
  if (v.confirmed) {
    s.confirmed++;
    return;
  }
  s.withheld++;
  const rec: SelfCheckRecord = { t: g.now, kind, flightId: f?.id ?? '', no: f?.no ?? '', title, why: v.why, evidence: v.evidence.slice(0, 8) };
  s.log.unshift(rec);
  if (s.log.length > 20) s.log.length = 20;
  s.pending.push(rec);
  if (s.pending.length > 20) s.pending.splice(0, s.pending.length - 20);
}

/** The UI takes the records still to be filed into Bug reports (and clears them). */
export function takeSelfCheckRecords(g: GameState): SelfCheckRecord[] {
  const s = g.selfCheck;
  if (!s?.pending.length) return [];
  const out = s.pending;
  s.pending = [];
  return out;
}

let hooksSet: CheckHooks | null = null;
/** Crew Control registers the hooks (crew/control.ts ALARM_HOOKS): this module imports no planner code. */
export function setAlarmHooks(h: CheckHooks): void {
  hooksSet = h;
}

/**
 * Self-checks one crew alarm before it fires, counts it, and files a withheld one. A confirmed alarm leaves its evidence
 * on the flight (Flight.crewChecked, the card's "Checked ✓"). Without hooks (a module test) every alarm is confirmed.
 */
export function confirmAlarm(g: GameState, kind: AlarmKind, f: Flight, title: string, names: Claim[] = []): Verdict {
  if (!hooksSet) return { confirmed: true, evidence: [], why: '' };
  const v = checkAlarm(g, kind, f.id, hooksSet, names);
  noteVerdict(g, kind, f, title, v);
  if (v.confirmed) f.crewChecked = v.evidence.slice(0, 4);
  return v;
}

/** "Checked ✓" evidence for a confirmed alarm, one plain line (the message and card). */
export function checkedLine(v: Verdict): string {
  return v.evidence.length ? `Checked ✓ ${v.evidence.slice(0, 3).join('; ')}.` : 'Checked ✓';
}
