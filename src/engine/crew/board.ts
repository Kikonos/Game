// v0.6 roster board (UPDATE-0.6.md §F1): crew × day rows for a crew-control grid, the verdict for every row
// while a duty is dragged (pure: nothing is split or planned for real), and the move/swap action behind a drop.
// A move is the existing manual assignment (assignCrew / swapCrew): locked, legality-checked, forced when red.

import type { RatingFamily } from '../../data/acmiTypes';
import { flightsRev } from '../core/entities';
import { canFill, typeOf } from '../core/perf';
import type { ActionResult, CrewMember, CrewStatus, Duty, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { crewCalendar, type CalBlock } from './calendar';
import { openDuties, planCrew } from './check';
import { familyLabel } from './conversion';
import { splitPairing } from './duties';
import { levelOf, minRest, type Seg } from './rules';
import { assignCrew, swapCrew } from './rosterActions';
import { setFlightsCrew } from './roster';
import { crewIx, crewRev, segsOf, ticketPrice, touchCrew, typeIdOf } from './timeline';

export type MoveScope = 'duty' | 'trip';

export interface BoardBlock extends CalBlock {
  pairingId?: string;
  locked?: boolean;
  /** A duty the player can drag (not flown, not under way). */
  movable: boolean;
}

export interface BoardRow {
  crewId: string;
  name: string;
  role: Role;
  base: string;
  families: RatingFamily[];
  morale: number;
  leaves: Minute | null;
  status: CrewStatus;
  blocks: BoardBlock[];
}

export interface DropTarget {
  crewId: string;
  level: Legality | 'ineligible';
  kind: 'assign' | 'swap' | 'none';
  /** The target's work that would come back to the source crew member (swap). */
  swapDutyId?: string;
  /** Player-facing one-liner: 'Legal · ticket $250', 'Rest 9:10 < 10:00 before NB2341', 'Not rated A330', 'Busy: 2 trips'. */
  reason: string;
  ticket: number;
  lateChange: boolean;
}

const LATE_H = 72;

/** The duty in progress right now (reported, not released): a trip under way can't change until it releases. */
const underWay = (g: GameState, p: Pairing) => openDuties(g, p).some((d) => d.report <= g.now && g.now < d.release);

// ---------- rows ----------

interface RowCache {
  key: string;
  rows: Map<string, BoardRow>;
}
const rowCache = new WeakMap<GameState, RowCache>();

function row(g: GameState, c: CrewMember, from: Minute, to: Minute): BoardRow {
  const blocks: BoardBlock[] = crewCalendar(g, c.id, from, to).map((b) => {
    if (b.kind !== 'duty' || !b.dutyId) return { ...b, movable: false };
    const d = g.duties[b.dutyId];
    const p = d ? g.pairings[d.pairingId] : undefined;
    if (!d || !p) return { ...b, movable: false };
    const seat = p.slots.find((s) => s.crewId === c.id);
    return { ...b, pairingId: p.id, locked: !!seat?.locked, movable: !d.done && d.report > g.now && !!seat && !underWay(g, p) };
  });
  return {
    crewId: c.id, name: `${c.last}, ${c.first.charAt(0)}.`, role: c.role, base: c.base, families: [...c.ratings], morale: Math.round(c.morale),
    leaves: c.notice?.leaves ?? null, status: c.status, blocks,
  };
}

/**
 * Rows for the given crew over [from, to): the crew calendar's blocks (same kinds, labels and details) with the
 * duty's pairing, lock and whether it can be dragged. Pure; rows are cached per roster/flight revision, clock and
 * window, so scrolling re-reads only the rows that came into view.
 */
export function rosterBoard(g: GameState, from: Minute, to: Minute, crewIds: string[]): BoardRow[] {
  const key = `${crewRev(g)}:${flightsRev(g)}:${g.now}:${from}:${to}`;
  let cache = rowCache.get(g);
  if (!cache || cache.key !== key) rowCache.set(g, (cache = { key, rows: new Map() }));
  const out: BoardRow[] = [];
  for (const id of crewIds) {
    const c = g.crew[id];
    if (!c) continue;
    let r = cache.rows.get(id);
    if (!r) cache.rows.set(id, (r = row(g, c, from, to)));
    out.push(r);
  }
  return out;
}

// ---------- drop targets ----------

/** The work being moved: the whole trip still to fly, or one duty seen as a trip of its own (not split for real). */
function movedView(p: Pairing, d: Duty, scope: MoveScope): Pairing {
  if (scope === 'trip') return p;
  return { ...p, dutyIds: [d.id], start: d.report, end: d.release };
}

/** A crew member's work overlapping [from, to): trips (trip scope) or single duties (duty scope). */
function overlapping(g: GameState, c: CrewMember, from: Minute, to: Minute, scope: MoveScope): { p: Pairing; d: Duty }[] {
  const out: { p: Pairing; d: Duty }[] = [];
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (q.status === 'done' || q.status === 'broken') continue;
    const hit = openDuties(g, q).filter((x) => x.release > from && x.report < to);
    if (!hit.length) continue;
    if (scope === 'trip') out.push({ p: q, d: hit[0] });
    else for (const x of hit) out.push({ p: q, d: x });
  }
  return out;
}

interface Ctx {
  p: Pairing;
  d: Duty;
  view: Pairing;
  from: CrewMember;
  role: Role;
  family: RatingFamily;
  first: Duty;
  last: Duty;
  win: [Minute, Minute];
  wet: boolean;
  late: boolean;
}

function ctxOf(g: GameState, dutyId: string, fromCrewId: string, scope: MoveScope): Ctx | string {
  const d = g.duties[dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  const from = g.crew[fromCrewId];
  if (!d || !p) return 'Duty not found';
  if (!from) return 'Crew member not found';
  const seat = p.slots.find((s) => s.crewId === fromCrewId);
  if (!seat) return 'Not on this duty';
  if (d.done || d.report <= g.now) return 'Already flown or under way';
  if (underWay(g, p)) return 'A duty of this trip is under way';
  const view = movedView(p, d, scope);
  const open = openDuties(g, view);
  if (!open.length) return 'Nothing left to fly';
  const first = open[0];
  const last = open[open.length - 1];
  const rest = minRest({ dutyMin: last.release - last.report, atHome: false, augmented: last.augment > 0, tzShift: 0 });
  return {
    p, d, view, from, role: seat.role, family: typeOf(typeIdOf(g, p)).family, first, last, win: [first.report - 12 * 60, last.release + rest],
    wet: p.contractId ? g.contracts[p.contractId]?.product.kind === 'wet' : false, late: first.report - g.now < LATE_H * 60,
  };
}

/** Legality of crew member c taking `to` (leaving `leaving`, whose duties `drop` come off their timeline). */
function planLevel(g: GameState, c: CrewMember, to: Pairing, leaving: Pairing | null, drop: string[]): { level: Legality; text: string; ticket: number; wet: boolean } {
  let segs: Seg[] = segsOf(g, c, leaving && leaving.dutyIds.length === drop.length ? leaving.id : undefined);
  if (drop.length) segs = segs.filter((s) => !s.dutyId || !drop.includes(s.dutyId));
  const plan = planCrew(g, c, to, segs, false, 0, leaving?.id);
  const issues = plan.issues.filter((i) => i.code !== 'fdp');
  const level = levelOf(issues);
  const bad = issues.find((i) => i.level === 'illegal') ?? issues.find((i) => i.level === 'tight');
  const wet = to.contractId ? g.contracts[to.contractId]?.product.kind === 'wet' : false;
  const ticket = wet || !plan.out || plan.out.rideId ? 0 : ticketPrice(plan.out.from, plan.out.to);
  return { level, text: bad?.text ?? '', ticket, wet };
}

const route = (g: GameState, d: Duty) => {
  const fl = d.flightIds.map((id) => g.flights[id]).filter((f) => !!f && f.status !== 'cancelled');
  if (!fl.length) return d.restAt;
  return `${fl[0].no} ${[fl[0].from, ...fl.map((f) => f.to)].join('–')}`;
};

const legalText = (ticket: number) => `Legal · ${ticket ? `ticket $${ticket.toLocaleString('en-US')}` : 'no ticket'}`;

function verdict(g: GameState, x: Ctx, c: CrewMember, scope: MoveScope): DropTarget {
  const base = { crewId: c.id, ticket: 0, lateChange: x.late };
  const no = (reason: string): DropTarget => ({ ...base, level: 'ineligible', kind: 'none', reason });
  if (c.id === x.from.id) return no('Holds this duty');
  if (!canFill(x.role, c.role)) return no(`A ${c.role} can't fill a ${x.role} seat`);
  if (!c.ratings.includes(x.family)) return no(`Not rated ${familyLabel(x.family)}`);
  if (c.status === 'joining') return no('Not joined yet');
  if (x.p.slots.some((s) => s.crewId === c.id)) return no('Already on this trip');
  const busy = overlapping(g, c, x.win[0], x.win[1], scope);
  if (busy.length >= 2) return no(`Busy: ${busy.length} ${scope === 'trip' ? 'trips' : 'duties'}`);
  if (!busy.length) {
    const v = planLevel(g, c, x.view, null, []);
    return { ...base, level: v.level, kind: 'assign', ticket: v.ticket, reason: v.level === 'legal' ? legalText(v.ticket) : v.level === 'tight' ? `Tight: ${v.text}` : v.text };
  }
  // Swap: the target's overlapping work goes to the source crew member.
  const { p: q, d: e } = busy[0];
  if (underWay(g, q) || e.report <= g.now) return no('On a trip under way');
  const seatB = q.slots.find((s) => s.crewId === c.id)!;
  const fam = typeOf(typeIdOf(g, q)).family;
  if (!canFill(seatB.role, x.from.role) || !x.from.ratings.includes(fam)) return { ...base, level: 'ineligible', kind: 'none', swapDutyId: e.id, reason: `Swap: ${x.from.last} can't take ${route(g, e)}` };
  const qView = movedView(q, e, scope);
  const a = planLevel(g, c, x.view, qView, qView.dutyIds);
  const b = planLevel(g, x.from, qView, x.view, x.view.dutyIds);
  const level: Legality = a.level === 'illegal' || b.level === 'illegal' ? 'illegal' : a.level === 'tight' || b.level === 'tight' ? 'tight' : 'legal';
  const why = a.level !== 'legal' ? a.text : b.level !== 'legal' ? `${x.from.last}: ${b.text}` : '';
  const reason = level === 'legal' ? `Swap with ${route(g, e)} (both legal)` : `Swap with ${route(g, e)}: ${why}`;
  return { ...base, level, kind: 'swap', swapDutyId: e.id, ticket: a.ticket + b.ticket, reason, lateChange: x.late || e.report - g.now < LATE_H * 60 };
}

/**
 * Verdict for every crew member (keyed by id) for dragging dutyId off fromCrewId: assign (green / amber / red with
 * the reason), swap with exactly one overlapping trip or duty, or ineligible (rating, rank, under way, busy).
 * Pure; one plan per eligible row.
 */
export function dropTargets(g: GameState, dutyId: string, fromCrewId: string, scope: MoveScope): Record<string, DropTarget> {
  const out: Record<string, DropTarget> = {};
  const x = ctxOf(g, dutyId, fromCrewId, scope);
  for (const c of Object.values(g.crew)) {
    out[c.id] = typeof x === 'string' ? { crewId: c.id, level: 'ineligible', kind: 'none', reason: x, ticket: 0, lateChange: false } : verdict(g, x, c, scope);
  }
  return out;
}

// ---------- the move ----------

/**
 * Isolates duty d into a pairing of its own (split at its report and at the next duty's): the other parts keep
 * their crew, seats, locks and tour. Returns d's pairing.
 */
function isolate(g: GameState, d: Duty): Pairing {
  let p = g.pairings[d.pairingId];
  const before = openDuties(g, p);
  if (before[0] && before[0].id !== d.id) {
    const q = splitPairing(g, p, d.report);
    if (q) {
      setFlightsCrew(g, p);
      p = q;
    }
  }
  const rest = openDuties(g, p);
  const next = rest[rest.indexOf(d) + 1];
  if (next && splitPairing(g, p, next.report)) setFlightsCrew(g, p);
  setFlightsCrew(g, p);
  touchCrew(g);
  return g.pairings[d.pairingId];
}

/**
 * Moves a duty (scope 'duty') or the rest of its trip (scope 'trip') from one crew member to another: an assign
 * when the target is free then, a swap when they hold exactly one overlapping trip or duty. Illegal moves are
 * refused unless forced (kept and flagged red). Moved seats are locked; late changes cost both crew morale.
 */
export function moveDuty(
  g: GameState, dutyId: string, fromCrewId: string, toCrewId: string, scope: MoveScope, opts: { force?: boolean } = {},
): ActionResult<{ level: Legality; swapped: boolean }> {
  const x = ctxOf(g, dutyId, fromCrewId, scope);
  if (typeof x === 'string') return { ok: false, error: x };
  const c = g.crew[toCrewId];
  if (!c) return { ok: false, error: 'Crew member not found' };
  const v = verdict(g, x, c, scope);
  if (v.level === 'ineligible') return { ok: false, error: v.reason };
  if (v.level === 'illegal' && !opts.force) return { ok: false, error: `Illegal: ${v.reason}` };
  const force = v.level === 'illegal';
  const dA = scope === 'duty' ? isolate(g, x.d) : x.p;
  const idA = scope === 'duty' ? x.d.id : openDuties(g, dA)[0].id;
  if (v.kind === 'assign') {
    const r = assignCrew(g, idA, toCrewId, dA.slots.find((s) => s.crewId === fromCrewId)!.role, { replace: fromCrewId, force });
    if (!r.ok) return r;
    return { ok: true, msg: r.msg, data: { level: r.data!.level, swapped: false } };
  }
  const e = g.duties[v.swapDutyId!];
  const dB = scope === 'duty' ? isolate(g, e) : g.pairings[e.pairingId];
  const idB = scope === 'duty' ? e.id : openDuties(g, dB)[0].id;
  const r = swapCrew(g, idA, fromCrewId, idB, toCrewId, { force });
  if (!r.ok) return r;
  const level: Legality = r.data!.levelA === 'illegal' || r.data!.levelB === 'illegal' ? 'illegal' : r.data!.levelA === 'tight' || r.data!.levelB === 'tight' ? 'tight' : 'legal';
  return { ok: true, msg: r.msg, data: { level, swapped: true } };
}
