// v0.7.2.2 Check planning (player request): move a booked A-check, C-check or cabin refit along its aircraft's own
// timeline (Schedule: long-press the block and drag it sideways), and book a check or refit from an idle gap.
//
// The live drag uses checkMaintMove (pure, no copy: the interval usage then, flights in the way, the way there); the
// confirm quotes the move on a copy of the game (quoteMaintMove, as the trip swap does) so the ferries it lists are
// exactly what moveMaint does: the booking is cancelled and booked again at the new time through the usual helpers
// (scheduleCheck / bookCCheck / the refit rules), at the same price, its old ferries removed and new ones planned.
//
// Not re-exported from ops/index: it settles the copy through sim.ts, which imports the ops module.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { C_HUBS } from '../../data/mro';
import { BAL } from '../core/balance';
import { flightsOf, flightsRev } from '../core/entities';
import { pushMessage } from '../core/messages';
import { isolatePauses } from '../core/pause';
import { etopsCap, typeOf } from '../core/perf';
import { DAY, fmtDate, fmtDateTime, fmtDay, fmtDuration, fmtTime, fmtDayRange } from '../core/time';
import type { ActionResult, Aircraft, Flight, GameState, MaintenanceEvent, Minute } from '../core/types';
import { anchorsOf, route, routeSpan, type Anchor } from '../contracts/plan';
import { settle } from '../sim';
import { refitQuote, restRefitQuote, restSeatsQuote } from './cabin';
import { bookCCheck, cCheckOptions, cCheckSlots } from './cHub';
import { maintWord } from './util';
import { cancelCheck, checkAirportOk, checkStatus, checkUsedAt, durationOf, groundGaps, relinkCheckFerries, scheduleCheck } from './maintenance';

/** Drag positions snap to this (minutes). */
export const MOVE_SNAP = 30;
/** Usage colours: green up to WARN_AT, amber to 100%, red beyond (not allowed). */
export const WARN_AT = 0.9;

export type UsageLevel = 'good' | 'warn' | 'bad';
export const usageLevel = (used: number): UsageLevel => (used > 1 ? 'bad' : used > WARN_AT ? 'warn' : 'good');

export { maintWord };
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const when = (t: Minute) => `${fmtDay(t)} ${fmtTime(t)}`;

/** Whether a booking can be dragged at all (planned A/C-check or refit, not started); the plain reason if not. Pure. */
export function movableMaint(g: GameState, maintId: string): { ok: boolean; reason: string | null } {
  const m = g.maintenance[maintId];
  if (!m) return { ok: false, reason: 'Not found' };
  if (m.kind !== 'A' && m.kind !== 'C' && m.kind !== 'refit') return { ok: false, reason: m.kind === 'paint' ? 'Client paint is part of the contract: it moves with the contract only' : m.kind === 'AOG' ? 'An AOG repair can’t move' : 'This hangar visit can’t move' };
  if (m.status === 'inWork') return { ok: false, reason: `The ${maintWord(m)} is in work: it can’t move now` };
  if (m.status !== 'planned') return { ok: false, reason: `This ${maintWord(m)} is ${m.status}` };
  const firstFerry = (m.ferryIds ?? []).map((id) => g.flights[id]).find((f) => f && f.status !== 'scheduled' && f.status !== 'cancelled');
  if (firstFerry) return { ok: false, reason: `The ferry to it has left: the ${maintWord(m)} can’t move now` };
  if (m.start <= g.now + 60) return { ok: false, reason: `The ${maintWord(m)} starts within the hour: too late to move it` };
  return { ok: true, reason: null };
}

export interface MaintMoveCheck {
  ok: boolean;
  /** Why not (plain words). */
  reason: string | null;
  maintId: string;
  /** 'A-check', 'C-check', 'cabin refit'. */
  what: string;
  start: Minute;
  end: Minute;
  /** Where it is done. */
  at: string;
  /** Share of the check interval used by the new start (A/C only). */
  used: number | null;
  level: UsageLevel | null;
  /** The aircraft must fly in from here first (null: it is there already). */
  ferryFrom: string | null;
  /** 'A-check at 82% used' / 'C-check: 91% of interval used by then' / 'Out of service 7 days'. */
  usageText: string;
}

/** The last hard commitment of the aircraft before t, leaving out this booking and its own ferries. */
function before(g: GameState, ac: Aircraft, m: MaintenanceEvent, t: Minute): { at: string; free: Minute; what: string | null } {
  const own = new Set([...(m.ferryIds ?? []), ...(m.homeIds ?? [])]);
  let prev: Anchor | null = null;
  for (const a of anchorsOf(g, ac.id)) {
    if ((a.kind === 'maint' && a.id === m.id) || (a.kind === 'flight' && own.has(a.id))) continue;
    if (a.std < t && (!prev || a.sta > prev.sta)) prev = a;
  }
  if (!prev) return { at: ac.at, free: g.now, what: null };
  const f = prev.kind === 'flight' ? g.flights[prev.id] : undefined;
  return { at: prev.to, free: prev.sta, what: f ? `${f.no} ${f.from}–${f.to}` : null };
}

/**
 * The live check while dragging a booking to start at `start` on its own row: the interval usage then, flights or
 * other hangar visits in the way (ferry out and, for a hub C-check, the ferry home included), the base programme,
 * the way there in time. The same rules the booking helpers apply; the confirm quotes it in full. Pure.
 */
export function checkMaintMove(g: GameState, maintId: string, start: Minute): MaintMoveCheck {
  const m = g.maintenance[maintId];
  const ac = m ? g.fleet[m.aircraftId] : undefined;
  const dur = m ? m.end - m.start : 0;
  start = Math.round(start / MOVE_SNAP) * MOVE_SNAP;
  const base: MaintMoveCheck = {
    ok: false, reason: null, maintId, what: m ? maintWord(m) : '', start, end: start + dur, at: m?.kind === 'refit' && g.company.homeBase ? g.company.homeBase : m?.at ?? '', used: null, level: null, ferryFrom: null, usageText: '',
  };
  if (!m || !ac) return { ...base, reason: 'Not found' };
  const mv = movableMaint(g, maintId);
  if (!mv.ok) return { ...base, reason: mv.reason };
  const q = base;
  const no = (reason: string) => ({ ...q, ok: false, reason });
  if (m.kind === 'A' || m.kind === 'C') {
    const u = checkUsedAt(g, ac, m.kind, start);
    q.used = u.used;
    q.level = usageLevel(u.used);
    q.usageText = m.kind === 'A' ? `A-check at ${Math.round(u.used * 100)}% used` : `C-check: ${Math.round(u.used * 100)}% of interval used by then`;
  } else q.usageText = `Out of service ${Math.round(dur / DAY)} day${Math.round(dur / DAY) === 1 ? '' : 's'}`;
  if (start === m.start) return no('That is where it is now');
  const t = typeOf(ac.typeId);
  const turn = t.turnMin;
  const lead = m.kind === 'C' && m.hub ? BAL.ferryLeadMin : 60;
  if (start < g.now + lead) return no(`Too soon: the hangar needs ${fmtDuration(lead)} notice`);
  if (q.used !== null && q.used > 1) return no(`Overdue by then (${Math.round(q.used * 100)}% used): not allowed`);
  // The way there.
  const prev = before(g, ac, m, start);
  const cap = etopsCap(g.company.approvals, ac.typeId);
  const r = route(ac.typeId, prev.at, q.at, cap);
  if (!r) return no(`No ferry route from ${prev.at} to ${q.at}`);
  const ferryMin = r.length ? routeSpan(r, ac.typeId) : 0;
  // Shown: where its planned flying (empty legs included) leaves it; the relink brings it home when it can.
  const own0 = new Set([...(m.ferryIds ?? []), ...(m.homeIds ?? [])]);
  let last: Flight | null = null;
  for (const f of flightsOf(g, ac.id)) if ((f.status === 'scheduled' || f.status === 'enroute') && !own0.has(f.id) && f.sta <= start && (!last || f.sta > last.sta)) last = f;
  const there = last ? last.to : ac.at;
  if (there !== q.at) q.ferryFrom = there;
  // A hub C-check flies home a while after the check ends.
  const homeR = m.kind === 'C' && m.hub ? route(ac.typeId, q.at, g.company.homeBase, cap) : [];
  const homeMin = homeR && homeR.length ? BAL.v072.cHub.homeAfterMin + routeSpan(homeR, ac.typeId) : 0;
  const busyFrom = start - (ferryMin ? ferryMin + turn : 0) - 30;
  const busyTo = start + dur + 30 + homeMin;
  const own = new Set([...(m.ferryIds ?? []), ...(m.homeIds ?? [])]);
  for (const f of flightsOf(g, ac.id)) {
    if ((f.status !== 'scheduled' && f.status !== 'enroute') || f.kind === 'positioning' || f.kind === 'deadhead' || own.has(f.id)) continue;
    if (f.std < busyTo && (f.eta ?? f.sta) > busyFrom) return no(`${ac.reg} is flying ${f.from}–${f.to} ${when(f.std)} then`);
  }
  for (const o of Object.values(g.maintenance)) {
    if (o.id === m.id || o.aircraftId !== ac.id || (o.status !== 'planned' && o.status !== 'inWork')) continue;
    if (o.start < busyTo && o.end > busyFrom) return no(`It would overlap the ${maintWord(o)} ${fmtDayRange(o.start, o.end)}`);
  }
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || c.pattern.kind !== 'base' || !c.aircraftIds.includes(ac.id) || c.generatedUntil >= c.pattern.to) continue;
    if (Math.max(c.generatedUntil, c.pattern.from) < busyTo && c.pattern.to > busyFrom) return no(`${ac.reg} is on ${c.title} then`);
  }
  if (prev.free > busyFrom + 30) return no(`${ac.reg} isn't free until ${when(prev.free)}${prev.what ? ` (${prev.what})` : ''}`);
  if (ferryMin && prev.free + turn > start - ferryMin - turn) return no(`${ac.reg} can't be at ${q.at} by then: it is at ${prev.at} until ${when(prev.free)}`);
  return { ...q, ok: true, reason: null };
}

export interface MaintMoveLeg { from: string; to: string; std: Minute; sta: Minute; added: boolean }

export interface MaintMoveQuote extends MaintMoveCheck {
  /** Empty legs of the aircraft added or no longer needed by the move. */
  legs: MaintMoveLeg[];
  /** Plain sentences for the confirm. */
  notes: string[];
  cost: number;
  full: boolean;
}

/** Cancels the booking and books it again at `start` (same airport, same work, same price). Returns the new id. */
function applyMove(h: GameState, m0: MaintenanceEvent, start: Minute): ActionResult<{ maintId: string }> {
  const ac = h.fleet[m0.aircraftId];
  const m = h.maintenance[m0.id];
  if (!ac || !m) return { ok: false, error: 'Not found' };
  const keep = { ...m, refit: m.refit ? { ...m.refit, cabin: { ...m.refit.cabin } } : undefined };
  const c = cancelCheck(h, m.id);
  if (!c.ok) return c;
  let r: ActionResult<{ maintId: string }>;
  // v0.7.3 a crew rest compartment fitted with a C-check moves with it (same extra days and price).
  const cFit = keep.kind === 'C' && (keep.restFit === 'fcrc' || keep.restFit === 'overhead') ? keep.restFit : undefined;
  if (keep.kind === 'A' || keep.kind === 'C') {
    // A hub C-check is booked again at the same MRO hub (ferries out and home); any other check at the same airport
    // ('moved': an older booking stays valid where it was).
    r = keep.kind === 'C' && keep.hub ? bookCCheck(h, ac.id, keep.hub.code, start, { quiet: true, restFit: cFit }) : scheduleCheck(h, ac.id, keep.kind, start, keep.at, { moved: true });
    if (r.ok && cFit && !keep.hub) {
      const nm = h.maintenance[r.data!.maintId];
      nm.end = nm.start + (keep.end - keep.start);
      nm.restFit = cFit;
    }
  } else {
    const home = h.company.homeBase;
    const days = Math.round((keep.end - keep.start) / DAY);
    const rest = keep.refit?.restSeats;
    // v0.7.3 the refit as booked: a crew rest refit (its option, cabin and price), v0.7.2 rest seats, or a new cabin.
    const q = keep.restFit
      ? restRefitQuote(h, ac.id, keep.restFit, start)
      : rest !== undefined ? restSeatsQuote(h, ac.id, rest > 0, start) : refitQuote(h, ac.id, keep.refit?.cabin.label ?? '', home, start);
    if (!q.ok) return { ok: false, error: q.why ?? 'No hangar slot then' };
    r = scheduleCheck(h, ac.id, 'refit', start, home, { refit: { cabin: keep.refit?.cabin ?? ac.cabin, days, cost: keep.cost, ...(rest !== undefined ? { restSeats: rest } : {}) } });
    if (r.ok && keep.restFit) h.maintenance[r.data!.maintId].restFit = keep.restFit;
  }
  if (!r.ok) return r;
  const n = h.maintenance[r.data!.maintId];
  // The same price (a hub's level, the refit agreed) and the original booking date.
  n.cost = keep.cost;
  n.booked = keep.booked ?? n.booked;
  relinkCheckFerries(h, ac.id);
  settle(h);
  return r;
}

const memo = new WeakMap<GameState, Map<string, MaintMoveQuote>>();
const sig = (f: Flight) => `${f.from}|${f.to}|${f.std}|${f.sta}|${f.kind}`;

/**
 * What moving the booking to `start` does, previewed on a copy (exactly what moveMaint does): ok or the plain reason,
 * the usage then, the ferries added and no longer needed, notes for the confirm. Pure (memoized per state).
 */
export function quoteMaintMove(g: GameState, maintId: string, start: Minute): MaintMoveQuote {
  let c = memo.get(g);
  if (!c) memo.set(g, (c = new Map()));
  const key = `${maintId}@${start}:${flightsRev(g)}:${g.seq}:${g.now}`;
  const hit = c.get(key);
  if (hit) return hit;
  const q0 = checkMaintMove(g, maintId, start);
  const m = g.maintenance[maintId];
  const ac = m ? g.fleet[m.aircraftId] : undefined;
  const q: MaintMoveQuote = { ...q0, legs: [], notes: [], cost: m?.cost ?? 0, full: false };
  if (!q0.ok || !m || !ac) {
    c.set(key, q);
    return q;
  }
  const h = structuredClone(g);
  let r: ActionResult<{ maintId: string }>;
  try {
    r = isolatePauses(() => applyMove(h, m, q0.start));
  } catch (e) {
    r = { ok: false, error: `The move could not be planned (${e instanceof Error ? e.message : String(e)})` };
  }
  if (!r.ok) {
    const out = { ...q, ok: false, reason: r.error };
    c.set(key, out);
    return out;
  }
  q.full = true;
  const n = h.maintenance[r.data!.maintId];
  q.start = n.start;
  q.end = n.end;
  // Its other flying stays as it is (only empty legs change).
  const hard = (st: GameState) => flightsOf(st, ac.id).filter((f) => f.status === 'scheduled' && f.kind !== 'positioning' && f.kind !== 'ferry');
  const hs = new Set(hard(h).map(sig));
  const lost = hard(g).find((f) => !hs.has(sig(f)));
  if (lost) {
    const out = { ...q, ok: false, reason: `${lost.no} ${lost.from}–${lost.to} ${when(lost.std)} would have to move` };
    c.set(key, out);
    return out;
  }
  const empty = (st: GameState) => flightsOf(st, ac.id).filter((f) => f.status === 'scheduled' && (f.kind === 'positioning' || f.kind === 'ferry'));
  const gS = new Set(empty(g).map(sig));
  const hS = new Set(empty(h).map(sig));
  q.legs = [
    ...empty(h).filter((f) => !gS.has(sig(f))).map((f) => ({ from: f.from, to: f.to, std: f.std, sta: f.sta, added: true })),
    ...empty(g).filter((f) => !hS.has(sig(f))).map((f) => ({ from: f.from, to: f.to, std: f.std, sta: f.sta, added: false })),
  ].sort((a, b) => Number(b.added) - Number(a.added) || a.std - b.std);
  if ((m.kind === 'A' || m.kind === 'C') && h.fleet[ac.id]) {
    const u = checkUsedAt(h, h.fleet[ac.id], m.kind, n.start);
    q.used = u.used;
    q.level = usageLevel(u.used);
    q.usageText = m.kind === 'A' ? `A-check at ${Math.round(u.used * 100)}% used` : `C-check: ${Math.round(u.used * 100)}% of interval used by then`;
  }
  const notes: string[] = [];
  const ferryIn = (n.ferryIds ?? []).map((id) => h.flights[id]).filter((f): f is Flight => !!f);
  const where = n.hub ? `${n.hub.name}, ${city(n.at)}` : n.kind === 'refit' ? `our hangar at ${city(n.at)}` : city(n.at);
  notes.push(ferryIn.length ? `${ac.reg} must be at ${n.at} by then: ferry ${ferryIn.map((f) => `${f.from}–${f.to}`).join(', ')} ${when(ferryIn[0].std)}.` : `${ac.reg} is already at ${n.at} then: no ferry needed.`);
  const home = (n.homeIds ?? []).map((id) => h.flights[id]).filter((f): f is Flight => !!f);
  if (home.length) notes.push(`Ferry home ${home[0].from}–${home[home.length - 1].to} ${when(home[0].std)}.`);
  const gone = q.legs.filter((l) => !l.added);
  if (gone.length) notes.push(`No longer needed: ${gone.map((l) => `${l.from}–${l.to} ${fmtDay(l.std)}`).join(', ')}.`);
  notes.push(`${cap(maintWord(m))}${m.kind === 'C' && n.restFit ? ` with the ${n.restFit === 'fcrc' ? 'flight crew rest compartment' : 'overhead crew rest'}` : ''} at ${where}: ${fmtDateTime(n.start)} – ${fmtDateTime(n.end)} UTC, same price.`);
  q.notes = notes;
  c.set(key, q);
  return q;
}

/** Moves the booking to `start` as quoted (one message); refused with the quote's reason when it can't. */
export function moveMaint(g: GameState, maintId: string, start: Minute): ActionResult<{ maintId: string }> {
  const q = quoteMaintMove(g, maintId, start);
  if (!q.ok) return { ok: false, error: q.reason ?? 'It can’t move there' };
  const m = g.maintenance[maintId];
  const ac = g.fleet[m.aircraftId];
  const r = applyMove(g, m, q.start);
  if (!r.ok) return r;
  const n = g.maintenance[r.data!.maintId];
  const text = `${cap(maintWord(m))} for ${ac.reg} moved to ${fmtDateTime(n.start)} – ${fmtDateTime(n.end)} UTC at ${city(n.at)}`;
  pushMessage(g, { tone: 'info', cat: 'tech', title: `${cap(maintWord(m))} moved: ${ac.reg}`, body: `${text}.${q.used !== null ? ` ${Math.round(q.used * 100)}% of the interval used by then.` : ''}${q.notes[0] && q.ferryFrom ? ` ${q.notes[0]}` : ''}`, ref: { kind: 'maint', id: n.id } });
  return { ok: true, msg: text, data: { maintId: n.id } };
}

// ---------- booking from an idle gap ----------

export interface GapOption {
  ok: boolean;
  why: string | null;
  /** Suggested start inside the gap, and where. */
  start: Minute | null;
  at: string | null;
  /** C-check: the hub picked. */
  hub?: string;
  /** Usage if done at the gap's start (A/C). */
  used: number | null;
  level: UsageLevel | null;
  /** Next due date now (A/C). */
  due: Minute | null;
  /** 'A-check 64% used then · next due 12 Nov'. */
  text: string;
  /** The gap really ends sooner: 'CS-TGO flies Long-term base at Dublin again from 21 Oct'. */
  until?: string | null;
}

const up30 = (t: Minute) => Math.ceil(t / 30) * 30;

/**
 * An A- or C-check inside the idle gap [from, to) at `at`: the slot the Check dialog will offer (A: here when the
 * airport takes A-checks, else at home base after a ferry, back in time; C: the cheapest hub whose ferries and
 * check fit the gap), the interval usage at the gap's start and the next due date; refused (plain reason) when the
 * gap is too short or the aircraft can't get there. Pure.
 */
export function gapCheck(g: GameState, aircraftId: string, kind: 'A' | 'C', from: Minute, to: Minute, at: string): GapOption {
  const ac = g.fleet[aircraftId];
  const none: GapOption = { ok: false, why: 'Aircraft not found', start: null, at: null, used: null, level: null, due: null, text: '' };
  if (!ac) return none;
  const st = checkStatus(g, ac);
  const due = kind === 'A' ? st.aDue : st.cDue;
  const u = checkUsedAt(g, ac, kind, Math.max(from, g.now)).used;
  const out: GapOption = { ...none, why: null, used: u, level: usageLevel(u), due, text: `${kind}-check ${Math.round(u * 100)}% used then · next due ${due - g.now > 300 * DAY ? fmtDate(due) : fmtDay(due)}` };
  const no = (why: string) => ({ ...out, ok: false, why });
  if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return no(`${ac.reg} is not on the AOC`);
  if (u > 1) return no('Overdue by then: book it sooner');
  // The real free window from the gap's start: the Gantt's gap can run past the generated days of a base programme.
  const real = groundGaps(g, ac, from, to).find((x) => x.from <= from + 60);
  if (!real) return no(`${ac.reg} is busy then`);
  if (real.to < to) {
    const prog = Object.values(g.contracts).find((c) => (c.status === 'signed' || c.status === 'active') && c.pattern.kind === 'base' && c.aircraftIds.includes(ac.id) && c.generatedUntil < c.pattern.to && Math.max(c.generatedUntil, c.pattern.from) <= real.to + 60);
    to = real.to;
    out.until = prog ? `${ac.reg} flies ${prog.title} again from ${fmtDay(real.to)}` : null;
  }
  const t = typeOf(ac.typeId);
  const dur = durationOf(ac, kind);
  const home = g.company.homeBase;
  if (kind === 'A') {
    if (checkAirportOk(g, 'A', at, ac.id)) {
      const start = up30(Math.max(from, g.now + 60) + 30);
      if (start + dur + 60 > to) return no(out.until ? `${out.until}: no room for an A-check (${t.aCheckHours} h)` : `The gap is too short for an A-check (${t.aCheckHours} h)`);
      return { ...out, ok: true, start, at };
    }
    const r = route(ac.typeId, at, home, etopsCap(g.company.approvals, ac.typeId));
    if (!r) return no(`${ac.reg} can't reach ${home} from ${at}`);
    const fly = routeSpan(r, ac.typeId);
    const start = up30(Math.max(from, g.now + BAL.ferryLeadMin) + t.turnMin + fly + 30);
    if (start + dur + 60 + t.turnMin + fly > to) return no(`${ac.reg} can't get to ${home} and back in this gap (A-checks need ${home} or a major airport)`);
    return { ...out, ok: true, start, at: home };
  }
  let best: { start: Minute; hub: string; total: number } | null = null;
  let why: string | null = null;
  for (const hub of C_HUBS[t.family]) {
    const s = cCheckSlots(g, ac.id, hub.code, 1, undefined, from)[0];
    if (s === undefined || s >= to) continue;
    const o = cCheckOptions(g, ac.id, s).find((x) => x.hub.code === hub.code);
    if (!o) continue;
    const last = o.ferryHome[o.ferryHome.length - 1]?.sta ?? o.end;
    if (!o.ok || last > to) {
      why ??= o.why;
      continue;
    }
    if (!best || o.total < best.total) best = { start: s, hub: hub.code, total: o.total };
  }
  if (!best) return no(out.until ? `${out.until}: no room for a C-check (${t.cCheckDays} days plus the ferries)` : `The gap is too short for a C-check (${t.cCheckDays} days plus the ferries)${why && !/fit/.test(why) ? `: ${why}` : ''}`);
  return { ...out, ok: true, start: best.start, at: best.hub, hub: best.hub };
}
