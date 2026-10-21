// Crew calendar (v0.5.2): everything that blocks a person over a window, for the crew card's "Next 14 days"
// strip and its tap-for-details: duties (with each leg's flight type), positioning on our aircraft, airline
// deadheads, rest, sickness, joining, training, leave and days off. Plus the card header's status line.
// Pure read APIs (no RNG, no writes).

import { BAL } from '../core/balance';
import { deadheadFlights } from '../core/entities';
import { DAY, fmtDate, fmtDateTime, fmtDay, fmtDuration, fmtTime } from '../core/time';
import type { CrewMember, Duty, Flight, GameState, Legality, Minute, TrainingKind } from '../core/types';
import { commercialItinerary } from '../ops/commercial';
import { FLIGHT_TYPE_LABEL, flightType, type FlightType } from '../ops/flightType';
import { rosterOf } from './roster';
import { offsetAt } from './rules';
import { dutyFlights, segsOf } from './timeline';

export type CalKind = 'duty' | 'positioning' | 'deadhead' | 'sick' | 'joining' | 'training' | 'leave' | 'off' | 'standby' | 'rest';

/** Strip labels (one word). 'standby' is reserved: the engine has no standby duty yet. */
export const CAL_LABEL: Record<CalKind, string> = {
  duty: 'Duty', positioning: 'Positioning', deadhead: 'Deadhead', sick: 'Sick', joining: 'Joining', training: 'Training',
  leave: 'Leave', off: 'Day off', standby: 'Standby', rest: 'Rest',
};

export interface CalFlight {
  id: string;
  no: string;
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  type: FlightType;
}

export interface CalBlock {
  kind: CalKind;
  start: Minute;
  end: Minute;
  /** Short label for the strip ('Duty', 'Ferry duty', 'Sick'…). */
  label: string;
  /** One or two lines for the tap-for-details panel. */
  detail: string;
  /** Flights of the block (duty legs, the ticket or the ridden leg). */
  flightIds?: string[];
  flights?: CalFlight[];
  dutyId?: string;
  legality?: Legality;
  /** Station (rest, day off) when away from base. */
  at?: string;
}

const KIND_ORDER: CalKind[] = ['joining', 'sick', 'training', 'leave', 'duty', 'positioning', 'deadhead', 'standby', 'rest', 'off'];

const hhmm = (t: Minute) => fmtTime(t);
const span = (a: Minute, b: Minute) => (Math.floor(a / DAY) === Math.floor(b / DAY) ? `${fmtDay(a)} ${hhmm(a)}–${hhmm(b)}` : `${fmtDateTime(a)} – ${fmtDateTime(b)}`);
const calFlight = (g: GameState, f: Flight): CalFlight => ({ id: f.id, no: f.no, from: f.from, to: f.to, std: f.atd ?? f.std, sta: f.ata ?? f.sta, type: flightType(g, f) });

const TRAINING_WHAT: Record<TrainingKind, string> = { typeRating: 'type rating', conversion: 'conversion course', command: 'Command upgrade', sccm: 'SCCM course' };

function trainingWhat(g: GameState, c: CrewMember, from: Minute, to: Minute): string {
  const it = g.training.find((x) => x.crewId === c.id && x.start < to && x.end > from);
  if (!it) return 'Training';
  return it.kind === 'typeRating' || it.kind === 'conversion' ? `${it.family} ${TRAINING_WHAT[it.kind]}` : TRAINING_WHAT[it.kind];
}

/** Joining date of a crew member still to join (hire order, block or the old saves' future `hired`), else null. */
export function joinsAt(g: GameState, c: CrewMember): Minute | null {
  if (c.status !== 'joining') return null;
  return g.hires.find((h) => h.crewId === c.id)?.ready ?? c.blocks?.find((b) => b.why === 'joining')?.to ?? Math.max(c.hired, c.restUntil);
}

/** Sick, joining, training and leave windows (blocks, plus a hire order without one). */
function statusBlocks(g: GameState, c: CrewMember): CalBlock[] {
  const out: CalBlock[] = [];
  const blocks = [...(c.blocks ?? [])];
  const joins = joinsAt(g, c);
  if (joins !== null && !blocks.some((b) => b.why === 'joining')) {
    const h = g.hires.find((x) => x.crewId === c.id);
    blocks.push({ from: Math.min(h?.ordered ?? g.now, g.now), to: joins, why: 'joining' });
  }
  for (const b of blocks) {
    if (b.why === 'joining') {
      out.push({ kind: 'joining', start: b.from, end: b.to, label: 'Joining', detail: `Joins ${fmtDate(b.to)} at ${c.base}. Notice period, then company induction; no flying before.` });
    } else if (b.why === 'sick') {
      out.push({ kind: 'sick', start: b.from, end: b.to, label: 'Sick', detail: `Off sick from ${fmtDay(b.from)}, expected back ~${fmtDay(b.to)}. Rostered work was re-crewed.` });
    } else if (b.why === 'training') {
      const what = trainingWhat(g, c, b.from, b.to);
      out.push({ kind: 'training', start: b.from, end: b.to, label: 'Training', detail: `${what} until ${fmtDate(b.to)}.` });
    } else {
      out.push({ kind: 'leave', start: b.from, end: b.to, label: 'Leave', detail: `On leave until ${fmtDate(b.to)}.` });
    }
  }
  return out;
}

function dutyBlock(g: GameState, d: Duty): CalBlock {
  const fl = dutyFlights(g, d).filter((f) => f.status !== 'cancelled');
  const flights = fl.map((f) => calFlight(g, f));
  const types = new Set(flights.map((f) => f.type));
  const label = types.size === 1 && types.has('ferry') ? 'Ferry duty' : types.size === 1 && types.has('positioning') ? 'Positioning duty' : 'Duty';
  const route = fl.length ? [fl[0].from, ...fl.map((f) => f.to)].join('–') : d.restAt;
  const legs = flights.map((f) => `${f.no} ${f.from}–${f.to} ${hhmm(f.std)}–${hhmm(f.sta)} ${FLIGHT_TYPE_LABEL[f.type]}`).join(' · ');
  const fdp = `FDP ${fmtDuration(d.fdp, true)} of ${fmtDuration(d.maxFdp + (d.discretion ?? 0), true)}`;
  return {
    kind: 'duty', start: d.report, end: d.release, label, flightIds: fl.map((f) => f.id), flights, dutyId: d.id, legality: d.legality,
    detail: `${route} · report ${hhmm(d.report)}, release ${hhmm(d.release)} · ${fdp}${d.augment ? ` · augmented +${d.augment}` : ''}${d.legality !== 'legal' ? ` · ${d.legality}` : ''}\n${legs}`,
  };
}

/** Tickets on airlines and rides on our own empty legs that carry the crew member. */
function travelBlocks(g: GameState, c: CrewMember, from: Minute, to: Minute): CalBlock[] {
  const out: CalBlock[] = [];
  for (const f of deadheadFlights(g)) {
    if (f.status === 'cancelled' || f.sta <= from || f.std >= to || !f.crewIds.includes(c.id)) continue;
    const legs = commercialItinerary(g, f);
    const via = legs.map((l) => `${l.no} ${l.from}–${l.to} ${hhmm(l.dep)}–${hhmm(l.arr)} (${l.airline})`).join(' · ');
    out.push({
      kind: 'deadhead', start: f.std - BAL.deadheadCheckIn, end: f.sta, label: 'Deadhead', flightIds: [f.id], flights: [calFlight(g, f)],
      detail: `${f.from}–${f.to} as a passenger, check-in ${hhmm(f.std - BAL.deadheadCheckIn)}\n${via}`,
    });
  }
  for (const f of Object.values(g.flights)) {
    if (!f.riders?.includes(c.id) || f.status === 'cancelled' || f.sta <= from || f.std >= to) continue;
    const reg = f.aircraftId ? g.fleet[f.aircraftId]?.reg : undefined;
    out.push({
      kind: 'positioning', start: f.std - BAL.deadheadCheckIn, end: f.ata ?? f.sta, label: 'Positioning', flightIds: [f.id], flights: [calFlight(g, f)],
      detail: `Riding our ${FLIGHT_TYPE_LABEL[flightType(g, f)].toLowerCase()} leg ${f.no} ${f.from}–${f.to}${reg ? ` on ${reg}` : ''}, ${span(f.std, f.sta)}`,
    });
  }
  return out;
}

const overlaps = (a: { start: Minute; end: Minute }, b: { start: Minute; end: Minute }) => a.start < b.end && b.start < a.end;

/**
 * Everything that blocks crew member `crewId` in [from, to), by start: duties (legs typed Operating / Positioning /
 * Ferry), positioning rides on our aircraft, airline deadheads, rest after duties and travel, sick / joining /
 * training / leave windows and days off (base-local days with nothing else). Blocks don't overlap except that a
 * status window (sick, training…) can sit over planned work it is about to replace. Pure.
 */
export function crewCalendar(g: GameState, crewId: string, from: Minute, to: Minute): CalBlock[] {
  const c = g.crew[crewId];
  if (!c || to <= from) return [];
  const status = statusBlocks(g, c).filter((b) => overlaps(b, { start: from, end: to }));
  const work: CalBlock[] = rosterOf(g, crewId, from, to).map((d) => dutyBlock(g, d));
  // Past duties no longer in the plan (pruned trips) come from the log.
  for (const e of c.log) {
    if (e.end <= from || e.start >= to || e.sectors === 0) continue;
    const b = { start: e.start, end: e.end };
    if (work.some((w) => overlaps(w, b))) continue;
    work.push({ kind: 'duty', start: e.start, end: e.end, label: 'Duty', detail: `Flown: ${e.sectors} sector${e.sectors > 1 ? 's' : ''}, block ${fmtDuration(e.block, true)}, FDP ${fmtDuration(e.fdp, true)}` });
  }
  work.push(...travelBlocks(g, c, from, to));
  work.sort((a, b) => a.start - b.start);

  // Rest after each duty and journey (planned timeline), and the rest running now.
  const rest: CalBlock[] = [];
  const segs = segsOf(g, c);
  const addRest = (start: Minute, end: Minute, at: string) => {
    if (end <= start || end <= from || start >= to) return;
    const next = [...work, ...status].filter((w) => w.start >= start && w.start < end).reduce((m, w) => Math.min(m, w.start), end);
    if (next <= start) return;
    const away = at && at !== c.base;
    rest.push({ kind: 'rest', start, end: next, label: 'Rest', at: away ? at : undefined, detail: `Minimum rest until ${fmtDateTime(end)}${away ? ` at ${at}` : ''}` });
  };
  for (const s of segs) if (s.kind !== 'log' && s.rest > 0) addRest(s.end, s.end + s.rest, s.at);
  const lastLog = c.log.length ? c.log[c.log.length - 1] : undefined;
  if (c.status !== 'joining' && c.restUntil > g.now && lastLog && !rest.some((r) => r.start <= g.now && r.end > g.now)) addRest(lastLog.end, c.restUntil, c.loc);

  // Days off: base-local days with nothing on them (rest spilling into the morning is cut off the front).
  const busy = [...work, ...status];
  const off: CalBlock[] = [];
  const horizon = g.now + BAL.rosterHorizonDays * DAY;
  const off0 = offsetAt(c.base, from);
  for (let d = Math.floor((from + off0) / DAY) * DAY - off0; d < to; d += DAY) {
    const day = { start: d, end: d + DAY };
    if (busy.some((w) => overlaps(w, day))) continue;
    let start = Math.max(d, from);
    for (const r of rest) if (r.start <= start && r.end > start) start = r.end;
    const end = Math.min(d + DAY, to);
    if (end - start < 6 * 60) continue;
    const at = locAtTime(c, segs, start);
    const away = at !== c.base;
    const planned = d < horizon;
    off.push({
      kind: 'off', start, end, label: planned ? 'Day off' : 'Free', at: away ? at : undefined,
      detail: planned ? `Day off${away ? ` at ${at} (hotel)` : ' at home'}` : 'Not rostered yet (beyond the published roster)',
    });
  }
  const all = [...status, ...work, ...rest, ...off];
  return all.sort((a, b) => a.start - b.start || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

function locAtTime(c: CrewMember, segs: ReturnType<typeof segsOf>, t: Minute): string {
  let at = c.loc;
  for (const s of segs) {
    if (s.end > t) break;
    if (s.kind !== 'log' && s.at) at = s.at;
  }
  return at;
}

// ---------- header ----------

export interface CrewStatusView {
  /** Badge: 'Joining', 'Sick', 'Training', 'On duty', 'Resting', 'Available', 'Leave', 'Day off'. */
  label: string;
  tone: 'good' | 'warn' | 'bad' | 'info';
  /** Line with the right date: 'Joins 26 May 2027', 'Sick · back ~12 Mar', 'Training until 3 Apr 2027'… */
  text: string;
  /** When the state ends (null when open-ended). */
  until: Minute | null;
  /** A real rest after work (null while joining, sick, training or on leave: no fake "Rest until"). */
  restUntil: Minute | null;
  /** 'Joins' for crew still to join (with the future date), else 'Hired'. */
  startLabel: 'Joins' | 'Hired';
  startDate: Minute;
}

/** Crew card header: status with the right date, start date wording, and rest only when it is a rest. Pure. */
export function crewStatusView(g: GameState, crewId: string): CrewStatusView {
  const c = g.crew[crewId];
  if (!c) return { label: '—', tone: 'info', text: '', until: null, restUntil: null, startLabel: 'Hired', startDate: g.now };
  const joins = joinsAt(g, c);
  const startLabel: CrewStatusView['startLabel'] = joins !== null ? 'Joins' : 'Hired';
  const startDate = joins ?? Math.min(c.hired, g.now);
  const base = { startLabel, startDate };
  if (joins !== null) return { ...base, label: 'Joining', tone: 'warn', text: `Joins ${fmtDate(joins)}`, until: joins, restUntil: null };
  const now = g.now;
  const block = c.blocks?.find((b) => b.from <= now && b.to > now);
  const why = block?.why ?? (c.status === 'sick' || c.status === 'training' || c.status === 'leave' ? c.status : null);
  if (why === 'sick') {
    const to = block?.to ?? null;
    return { ...base, label: 'Sick', tone: 'bad', text: to ? `Sick · back ~${fmtDay(to)}` : 'Sick', until: to, restUntil: null };
  }
  if (why === 'training') {
    const to = block?.to ?? g.training.find((x) => x.crewId === c.id)?.end ?? null;
    return { ...base, label: 'Training', tone: 'info', text: to ? `${trainingWhat(g, c, now, now + 1)} until ${fmtDate(to)}` : 'Training', until: to, restUntil: null };
  }
  if (why === 'leave') return { ...base, label: 'Leave', tone: 'info', text: block ? `On leave until ${fmtDate(block.to)}` : 'On leave', until: block?.to ?? null, restUntil: null };
  const sickSoon = c.blocks?.find((b) => b.why === 'sick' && b.from > now && b.from < now + DAY);
  const duty = rosterOf(g, c.id, now, now + 1).find((d) => d.report <= now && d.release > now);
  if (c.status === 'onDuty' || duty) {
    const rel = duty?.release ?? null;
    return { ...base, label: 'On duty', tone: 'good', text: rel ? `On duty · release ${fmtTime(rel)}` : 'On duty', until: rel, restUntil: null };
  }
  const restUntil = c.restUntil > now ? c.restUntil : null;
  if (sickSoon) return { ...base, label: 'Sick', tone: 'bad', text: `Off sick from ${fmtDay(sickSoon.from)} · back ~${fmtDay(sickSoon.to)}`, until: sickSoon.to, restUntil };
  if (restUntil) return { ...base, label: 'Resting', tone: 'info', text: `Resting until ${fmtDateTime(restUntil)}${c.loc !== c.base ? ` at ${c.loc}` : ''}`, until: restUntil, restUntil };
  const next = rosterOf(g, c.id, now, now + BAL.rosterHorizonDays * DAY).find((d) => d.report > now);
  return { ...base, label: 'Available', tone: 'good', text: next ? `Next duty ${fmtDateTime(next.report)}` : `Available at ${c.loc}`, until: null, restUntil: null };
}
