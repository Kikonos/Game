// v0.6 roster board (UPDATE-0.6.md §F1): crew × day rows for a crew-control grid, the verdict for every row
// while a duty is dragged (pure: a duty-scope verdict is taken on a copy with the duty split off, as the move will
// do), and the move/swap action behind a drop. A move is the existing manual assignment (assignCrew / swapCrew):
// locked, legality-checked, forced when red; it is tried on a copy first, so a refused move changes nothing.

import type { RatingFamily } from '../../data/acmiTypes';
import { canFill, typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { ActionResult, CrewMember, CrewStatus, Duty, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { crewCalendar, type CalBlock } from './calendar';
import { openDuties, planCrew } from './check';
import { familyLabel } from './conversion';
import { splitPairing } from './duties';
import { levelOf, minRest, offsetAt, type Seg } from './rules';
import { assignCrew, swapCrew } from './rosterActions';
import { placeCrew, setFlightsCrew } from './roster';
import { crewIx, segsOf, ticketPrice, touchCrew, typeIdOf } from './timeline';

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
  /**
   * Player-facing one-liner: 'Legal · ticket $250', 'Rest 9:10 < 10:00 before NB2341', 'Not rated A330', 'Busy: 2 trips';
   * with the source's side appended when the move changes their next trip (' · Martins: DH FCO–BER $600').
   */
  reason: string;
  ticket: number;
  lateChange: boolean;
  /** v0.6: what the move leaves the source crew member (their next trip): '' when nothing changes. */
  source?: string;
  sourceLevel?: Legality;
}

const LATE_H = 72;

/** The duty in progress right now (reported, not released): a trip under way can't change until it releases. */
const underWay = (g: GameState, p: Pairing) => openDuties(g, p).some((d) => d.report <= g.now && g.now < d.release);

// ---------- rows ----------

/** v0.7 C2: one cached row per crew member (key: their own revision and the window; valid until its next time boundary). */
const rowCache = new WeakMap<GameState, Map<string, { key: string; row: BoardRow; at: Minute; until: Minute }>>();

/**
 * When a row built now goes stale with nothing else changing: the next start or end of one of its blocks or legs
 * (a duty under way, a rest ending, a leg landing), the end of the rest running now, the next base-local midnight
 * (day-off labels, the published horizon); a hire still joining moves with the clock (hourly).
 */
function rowUntil(g: GameState, c: CrewMember, blocks: BoardBlock[]): Minute {
  const off = offsetAt(c.base, g.now);
  let t = Math.floor((g.now + off) / DAY + 1) * DAY - off;
  const at = (x: Minute | undefined) => {
    if (x !== undefined && x > g.now && x < t) t = x;
  };
  at(c.restUntil);
  if (c.status === 'joining') at(g.now + 60);
  for (const b of blocks) {
    at(b.start);
    at(b.end);
    for (const f of b.flights ?? []) {
      at(f.std);
      at(f.sta);
    }
  }
  return t;
}

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
 * v0.7 C2: a crew member's own revision: what their row is built from (trips, duties and their sync state, tickets
 * and rides, status, blocks, log, rest, morale). Cheap next to building the row.
 */
function crewKey(g: GameState, c: CrewMember): string {
  let k = `${c.status}|${c.loc}|${Math.round(c.morale)}|${c.restUntil}|${c.notice?.leaves ?? ''}|${c.ratings.join(',')}|${c.blocks?.length ?? 0}:${c.blocks?.[0]?.from ?? ''}|${c.log.length}:${c.log[c.log.length - 1]?.end ?? ''}`;
  const ix = crewIx(g);
  for (const p of ix.pairingsOf.get(c.id) ?? []) {
    k += `|${p.id}:${p.status}:${p.slots.find((s) => s.crewId === c.id)?.locked ? 'L' : ''}`;
    for (const did of p.dutyIds) {
      const d = g.duties[did];
      if (d) k += `,${d.id}:${d.ev}:${d.flightsEv}:${d.report}:${d.release}:${d.legality}:${d.done ? 1 : 0}`;
    }
  }
  for (const f of ix.tickets.get(c.id) ?? []) k += `|${f.id}:${f.std}:${f.sta}:${f.status}:${f.ev}`;
  return k;
}

/**
 * Rows for the given crew over [from, to): the crew calendar's blocks (same kinds, labels and details) with the
 * duty's pairing, lock and whether it can be dragged. Pure. v0.7 C2: an unchanged crew member returns the same
 * row object (identity), keyed by their own revision, the window and the clock's hour, so a running clock or a
 * change to someone else re-renders nothing.
 */
export function rosterBoard(g: GameState, from: Minute, to: Minute, crewIds: string[]): BoardRow[] {
  let cache = rowCache.get(g);
  if (!cache) rowCache.set(g, (cache = new Map()));
  const out: BoardRow[] = [];
  for (const id of crewIds) {
    const c = g.crew[id];
    if (!c) continue;
    const key = `${crewKey(g, c)}#${from}:${to}`;
    let hit = cache.get(id);
    if (!hit || hit.key !== key || g.now >= hit.until || g.now < hit.at) {
      const r = row(g, c, from, to);
      cache.set(id, (hit = { key, row: r, at: g.now, until: rowUntil(g, c, r.blocks) }));
    }
    out.push(hit.row);
  }
  return out;
}

// ---------- drop targets ----------

/** The work being moved: the whole trip still to fly, or one duty (split off into a trip of its own). */
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
  /** What the move leaves the source's next trip (the same for every target: taken once). */
  src?: { level: Legality; text: string; ticket: number };
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

/** A crew member's next trip after `t` still to fly (not the moved work), if any. */
function nextTrip(g: GameState, c: CrewMember, t: Minute, skip: Set<string>): Pairing | undefined {
  let best: Pairing | undefined;
  for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
    if (skip.has(q.id) || q.status === 'done' || q.status === 'broken' || underWay(g, q)) continue;
    const open = openDuties(g, q);
    if (!open.length || open[0].report < t) continue;
    if (!best || open[0].report < openDuties(g, best)[0].report) best = q;
  }
  return best;
}

/**
 * What giving up `moved` (duty ids) does to crew member c's next trip (the rest of a split trip, or the next one):
 * re-planned from where they will be, a positioning ticket or an illegal reason. '' when nothing changes.
 */
function leftBehind(g: GameState, c: CrewMember, moved: string[], after: Minute, leaving: string): { level: Legality; text: string; ticket: number } {
  const q = nextTrip(g, c, after, new Set([leaving]));
  if (!q) return { level: 'legal', text: '', ticket: 0 };
  const segs = segsOf(g, c, q.id).filter((s) => !s.dutyId || !moved.includes(s.dutyId));
  const now = planCrew(g, c, q, segsOf(g, c, q.id), true);
  const plan = planCrew(g, c, q, segs, false, 0, leaving);
  // Only what the move causes: an issue the next trip already had is that trip's, not this drop's.
  const had0 = new Set(now.issues.map((i) => `${i.code}:${i.text}`));
  const issues = plan.issues.filter((i) => i.code !== 'fdp' && !had0.has(`${i.code}:${i.text}`));
  const level = levelOf(issues);
  const bad = issues.find((i) => i.level === 'illegal') ?? issues.find((i) => i.level === 'tight');
  const who = c.last;
  if (bad) return { level, text: `${who}: ${bad.text}`, ticket: 0 };
  // Positioning the next trip did not need before.
  const had = now.issues.every((i) => i.code !== 'location') && !!now.out;
  const wet = q.contractId ? g.contracts[q.contractId]?.product.kind === 'wet' : false;
  if (plan.out && !(had && now.out && now.out.from === plan.out.from)) {
    const ticket = wet || plan.out.rideId ? 0 : ticketPrice(plan.out.from, plan.out.to);
    return { level, text: `${who}: DH ${plan.out.from}–${plan.out.to}${ticket ? ` $${ticket.toLocaleString('en-US')}` : ''}`, ticket };
  }
  return { level, text: '', ticket: 0 };
}

const route = (g: GameState, d: Duty) => {
  const fl = d.flightIds.map((id) => g.flights[id]).filter((f) => !!f && f.status !== 'cancelled');
  if (!fl.length) return d.restAt;
  return `${fl[0].no} ${[fl[0].from, ...fl.map((f) => f.to)].join('–')}`;
};

const legalText = (ticket: number) => `Legal · ${ticket ? `ticket $${ticket.toLocaleString('en-US')}` : 'no ticket'}`;
const worse = (a: Legality, b: Legality): Legality => (a === 'illegal' || b === 'illegal' ? 'illegal' : a === 'tight' || b === 'tight' ? 'tight' : 'legal');

/** The verdict for c. `isolateSwap` splits the target's overlapping duty off first (duty scope, on a copy). */
function verdict(g: GameState, x: Ctx, c: CrewMember, scope: MoveScope, isolateSwap?: (d: Duty) => Pairing): DropTarget {
  const base = { crewId: c.id, ticket: 0, lateChange: x.late };
  const no = (reason: string): DropTarget => ({ ...base, level: 'ineligible', kind: 'none', reason });
  if (c.id === x.from.id) return no('Holds this duty');
  if (!canFill(x.role, c.role)) return no(`A ${c.role} can't fill a ${x.role} seat`);
  if (!c.ratings.includes(x.family)) return no(`Not rated ${familyLabel(x.family)}`);
  if (c.status === 'joining') return no('Not joined yet');
  if (x.p.slots.some((s) => s.crewId === c.id)) return no('Already on this trip');
  const busy = overlapping(g, c, x.win[0], x.win[1], scope);
  if (busy.length >= 2) return no(`Busy: ${busy.length} ${scope === 'trip' ? 'trips' : 'duties'}`);
  const movedIds = x.view.dutyIds;
  if (!busy.length) {
    const v = planLevel(g, c, x.view, null, []);
    const src = (x.src ??= leftBehind(g, x.from, movedIds, x.last.release, x.p.id));
    const level = worse(v.level, src.level);
    const own = v.level === 'legal' ? legalText(v.ticket) : v.level === 'tight' ? `Tight: ${v.text}` : v.text;
    const reason = v.level === 'legal' && src.level === 'illegal' ? src.text : `${own}${src.text ? ` · ${src.text}` : ''}`;
    return { ...base, level, kind: 'assign', ticket: v.ticket + src.ticket, reason, source: src.text, sourceLevel: src.level };
  }
  // Swap: the target's overlapping work goes to the source crew member.
  let { p: q, d: e } = busy[0];
  if (underWay(g, q) || e.report <= g.now) return no('On a trip under way');
  if (scope === 'duty' && isolateSwap) q = isolateSwap(e);
  const seatB = q.slots.find((s) => s.crewId === c.id);
  if (!seatB) return no(`Not needed on ${route(g, e)}`);
  const fam = typeOf(typeIdOf(g, q)).family;
  if (!canFill(seatB.role, x.from.role) || !x.from.ratings.includes(fam)) return { ...base, level: 'ineligible', kind: 'none', swapDutyId: e.id, reason: `Swap: ${x.from.last} can't take ${route(g, e)}` };
  const qView = movedView(q, e, scope);
  const a = planLevel(g, c, x.view, qView, qView.dutyIds);
  const b = planLevel(g, x.from, qView, x.view, x.view.dutyIds);
  const level = worse(a.level, b.level);
  const why = a.level !== 'legal' ? a.text : b.level !== 'legal' ? `${x.from.last}: ${b.text}` : '';
  const reason = level === 'legal' ? `Swap with ${route(g, e)} (both legal)` : `Swap with ${route(g, e)}: ${why}`;
  return { ...base, level, kind: 'swap', swapDutyId: e.id, ticket: a.ticket + b.ticket, reason, lateChange: x.late || e.report - g.now < LATE_H * 60 };
}

/** A copy for dry runs (its runtime indexes are its own). */
const copyOf = (g: GameState): GameState => structuredClone(g);

/** True when the duty already is a trip of its own (nothing to split). */
const alone = (g: GameState, d: Duty) => openDuties(g, g.pairings[d.pairingId]).length === 1;

/**
 * Verdict for every crew member (keyed by id) for dragging dutyId off fromCrewId: assign (green / amber / red with
 * the reason, and what it leaves the source's next trip), swap with exactly one overlapping trip or duty, or
 * ineligible (rating, rank, under way, busy). Pure: a duty-scope verdict is taken on a copy where the duty (and
 * each swap partner's duty) is split off first, exactly as the move does it.
 */
export function dropTargets(g: GameState, dutyId: string, fromCrewId: string, scope: MoveScope): Record<string, DropTarget> {
  const out: Record<string, DropTarget> = {};
  let h = g;
  let x = ctxOf(g, dutyId, fromCrewId, scope);
  let iso: ((d: Duty) => Pairing) | undefined;
  if (typeof x !== 'string' && scope === 'duty') {
    h = copyOf(g);
    if (!alone(h, h.duties[dutyId])) isolate(h, h.duties[dutyId]);
    x = ctxOf(h, dutyId, fromCrewId, scope);
    const hh = h;
    iso = (d: Duty) => hh.pairings[d.pairingId];
  }
  // Swaps whose partner duty must be split are judged on their own copy (a split can release crew, so the copies
  // can't be shared); the rest on h.
  const later: string[] = [];
  for (const c of Object.values(g.crew)) {
    const hc = h.crew[c.id];
    if (typeof x === 'string' || !hc) {
      out[c.id] = { crewId: c.id, level: 'ineligible', kind: 'none', reason: typeof x === 'string' ? x : 'Crew member not found', ticket: 0, lateChange: false };
      continue;
    }
    if (iso) {
      const busy = overlapping(h, hc, x.win[0], x.win[1], scope);
      if (busy.length === 1 && !alone(h, busy[0].d) && hc.id !== x.from.id && canFill(x.role, hc.role) && hc.ratings.includes(x.family)) {
        later.push(c.id);
        continue;
      }
    }
    out[c.id] = verdict(h, x, hc, scope, iso);
  }
  for (const id of later) {
    const hh = copyOf(h);
    const xx = ctxOf(hh, dutyId, fromCrewId, scope);
    out[id] = typeof xx === 'string' ? { crewId: id, level: 'ineligible', kind: 'none', reason: xx, ticket: 0, lateChange: false } : verdict(hh, xx, hh.crew[id], scope, (d: Duty) => (alone(hh, d) ? hh.pairings[d.pairingId] : isolate(hh, d).mid));
  }
  return out;
}

// ---------- the move ----------

/**
 * Isolates duty d into a pairing of its own (split at its report and at the next duty's): the other parts keep
 * their crew, seats, locks and tour. Returns d's pairing.
 */
function isolate(g: GameState, d: Duty): { mid: Pairing } {
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
  if (next) {
    const q = splitPairing(g, p, next.report);
    if (q) setFlightsCrew(g, q);
  }
  setFlightsCrew(g, p);
  touchCrew(g);
  return { mid: g.pairings[d.pairingId] };
}

/** Re-plans c on their next trip after t when the move left them unable to reach it (positioning from where they are). */
function replanNext(g: GameState, c: CrewMember | undefined, t: Minute, skip: Set<string>): void {
  if (!c) return;
  const q = nextTrip(g, c, t, skip);
  if (!q) return;
  const plan = planCrew(g, c, q, segsOf(g, c, q.id), true);
  if (!plan.issues.some((i) => i.code === 'location')) return;
  const slot = q.slots.findIndex((s) => s.crewId === c.id);
  if (slot < 0) return;
  const locked = q.slots[slot].locked;
  placeCrew(g, q, slot, c);
  if (locked) q.slots[slot].locked = true;
}

type MoveResult = ActionResult<{ level: Legality; swapped: boolean }>;

function applyMove(g: GameState, dutyId: string, fromCrewId: string, toCrewId: string, scope: MoveScope, force: boolean): MoveResult {
  if (scope === 'duty' && g.duties[dutyId] && !alone(g, g.duties[dutyId]) && typeof ctxOf(g, dutyId, fromCrewId, scope) !== 'string') isolate(g, g.duties[dutyId]);
  const x = ctxOf(g, dutyId, fromCrewId, scope);
  if (typeof x === 'string') return { ok: false, error: x };
  const c = g.crew[toCrewId];
  if (!c) return { ok: false, error: 'Crew member not found' };
  const iso = scope === 'duty' ? (d: Duty) => (alone(g, d) ? g.pairings[d.pairingId] : isolate(g, d).mid) : undefined;
  const v = verdict(g, x, c, scope, iso);
  if (v.level === 'ineligible') return { ok: false, error: v.reason };
  if (v.level === 'illegal' && !force) return { ok: false, error: `Illegal: ${v.reason}` };
  const forced = v.level === 'illegal';
  const dA = scope === 'duty' ? g.pairings[x.d.pairingId] : x.p;
  const idA = scope === 'duty' ? x.d.id : openDuties(g, dA)[0]?.id;
  const seatA = dA.slots.find((s) => s.crewId === fromCrewId);
  if (!idA || !seatA) return { ok: false, error: 'Not on this duty' };
  const after = x.last.release;
  let level: Legality;
  let msg: string | undefined;
  if (v.kind === 'assign') {
    const r = assignCrew(g, idA, toCrewId, seatA.role, { replace: fromCrewId, force: forced });
    if (!r.ok) return r;
    level = r.data!.level;
    msg = r.msg;
    replanNext(g, x.from, after, new Set([dA.id]));
  } else {
    const e = g.duties[v.swapDutyId ?? ''];
    if (!e) return { ok: false, error: 'Duty not found' };
    const dB = g.pairings[e.pairingId];
    const idB = scope === 'duty' ? e.id : openDuties(g, dB)[0]?.id;
    if (!idB) return { ok: false, error: 'Nothing left to fly' };
    const r = swapCrew(g, idA, fromCrewId, idB, toCrewId, { force: forced });
    if (!r.ok) return r;
    level = worse(r.data!.levelA, r.data!.levelB);
    msg = r.msg;
    const lastB = openDuties(g, dB);
    replanNext(g, x.from, lastB.length ? lastB[lastB.length - 1].release : after, new Set([dA.id, dB.id]));
    replanNext(g, c, after, new Set([dA.id, dB.id]));
  }
  // A move the verdict called legal must leave the moved crew legal on the moved work (else the dry run refuses it).
  if (!forced) {
    const pB = v.kind === 'swap' ? g.pairings[g.duties[v.swapDutyId!].pairingId] : undefined;
    for (const [who, p] of [[c, dA], [x.from, pB]] as const) {
      if (!p) continue;
      const bad = planCrew(g, who, p, segsOf(g, who, p.id), true).issues.find((i) => i.code !== 'fdp' && i.level === 'illegal' && !!i.dutyId && p.dutyIds.includes(i.dutyId));
      if (bad) return { ok: false, error: `Illegal after the move: ${who.last}: ${bad.text}` };
    }
  }
  return { ok: true, msg, data: { level: forced ? 'illegal' : level, swapped: v.kind === 'swap' } };
}

/**
 * Moves a duty (scope 'duty') or the rest of its trip (scope 'trip') from one crew member to another: an assign
 * when the target is free then, a swap when they hold exactly one overlapping trip or duty. Illegal moves are
 * refused unless forced (kept and flagged red). Moved seats are locked; late changes cost both crew morale; the
 * source (and a swap partner) are re-planned onto their next trip from where the move leaves them.
 * All or nothing: the move is tried on a copy first and only then made, so a refused move changes nothing.
 */
export function moveDuty(g: GameState, dutyId: string, fromCrewId: string, toCrewId: string, scope: MoveScope, opts: { force?: boolean } = {}): MoveResult {
  const force = !!opts.force;
  let dry: MoveResult;
  try {
    dry = applyMove(copyOf(g), dutyId, fromCrewId, toCrewId, scope, force);
  } catch (e) {
    return { ok: false, error: `Not possible: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!dry.ok) return dry;
  return applyMove(g, dutyId, fromCrewId, toCrewId, scope, force);
}
