// Manual roster adjustment (roster view, BRIEF "Player decisions": the player adjusts the auto-roster with
// swaps and overrides, legality warnings shown). Crew sit on pairing slots (one complement flies the whole trip
// or tour), so a duty or flight id resolves to its pairing and a change applies to that pairing's duties still
// to fly. Manual assignments are locked: the rolling re-plan keeps them, flagged when illegal, never silently.

import { canFill, typeOf } from '../core/perf';
import { fmtDay, fmtTime } from '../core/time';
import type { ActionResult, CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { issueLevelFor, openDuties, planCrew } from './check';
import { crewName } from './generate';
import { rootReason, type Reason } from './reasons';
import { emptyResult, fillAll, placeCrew, recheckPairing, releaseCrew } from './roster';
import { levelOf, worst, type IssueCode } from './rules';
import { block28, locAt, segsOf, ticketPrice, touchCrew, typeIdOf, viaText } from './timeline';

const LEVEL_RANK: Record<Legality, number> = { legal: 0, tight: 1, illegal: 2 };
const hm = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;

/** A duty id, or a flight id resolved to the duty that operates it. */
export function dutyOf(g: GameState, dutyOrFlightId: string): Duty | undefined {
  const d = g.duties[dutyOrFlightId];
  if (d) return d;
  const f = g.flights[dutyOrFlightId];
  return f?.dutyId ? g.duties[f.dutyId] : undefined;
}

function ctxOfId(g: GameState, id: string): { d: Duty; p: Pairing } | null {
  const d = dutyOf(g, id);
  const p = d && g.pairings[d.pairingId];
  return d && p ? { d, p } : null;
}

/** The duty in progress right now (reported, not released): its crew can't be changed until release. */
function inProgress(g: GameState, p: Pairing): Duty | undefined {
  return openDuties(g, p).find((d) => d.report <= g.now && g.now < d.release);
}

// ---------- read APIs (pure) ----------

export interface RosterSlotView {
  index: number;
  role: Role;
  crewId: string | null;
  name: string | null;
  locked: boolean;
  extra: boolean;
  /** v0.6: seat above the legal minimum (crew-extra settings): optional, amber when empty. */
  above: boolean;
  /** This crew member's legality on the pairing (null when the seat is empty). */
  level: Legality | null;
}

export interface DutyCrewView {
  dutyId: string;
  pairingId: string;
  aircraftId: string | null;
  contractId: string | null;
  /** Trip (base → base) or deployment tour: a change applies to all of `dutyIds` still to fly. */
  kind: 'trip' | 'tour';
  dutyIds: string[];
  report: Minute;
  release: Minute;
  slots: RosterSlotView[];
  /** A duty of this pairing is under way: its crew can't be changed until it releases. */
  inProgress: boolean;
}

/** Who holds each seat of the duty's pairing (roster view, block sheet). Pure. */
export function dutyCrew(g: GameState, dutyOrFlightId: string): DutyCrewView | null {
  const x = ctxOfId(g, dutyOrFlightId);
  if (!x) return null;
  const { d, p } = x;
  const slots = p.slots.map((s, index): RosterSlotView => {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    let level: Legality | null = null;
    if (c && openDuties(g, p).length) {
      const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
      // As seen from this duty: a later duty's problem only warns (flightCrewStatus agrees).
      for (const i of plan.issues) if (i.code !== 'fdp') level = worst(level ?? 'legal', issueLevelFor(g, p, d, i));
      level ??= 'legal';
    }
    return { index, role: s.role, crewId: s.crewId, name: c ? crewName(c) : null, locked: !!s.locked, extra: !!s.extra, above: !!s.above, level };
  });
  return {
    dutyId: d.id, pairingId: p.id, aircraftId: p.aircraftId, contractId: p.contractId, kind: p.tour ? 'tour' : 'trip',
    dutyIds: [...p.dutyIds], report: d.report, release: d.release, slots, inProgress: !!inProgress(g, p),
  };
}

export interface DutyCandidate {
  crewId: string;
  name: string;
  /** The crew member's own role (a senior may fill a junior seat). */
  role: Role;
  /** v0.7.2 a captain listed for an FO/CRP seat ('Captain flying as FO' group, after the FOs). */
  asFo?: true;
  legal: boolean;
  level: Legality;
  /** Why not legal (or tight), short and player-facing; empty when clean. */
  reasons: string[];
  codes: IssueCode[];
  /** Where the crew member will be at report. */
  loc: string;
  /** Already on this pairing (in another seat or this one). */
  onPairing: boolean;
  /** Positioning ticket to the first departure ($, 0 on wet leases where the client pays). */
  ticket: number;
  block28dH: number;
  /** The planned trip out to the first departure, e.g. 'Deadhead LIS 09:00 → VNO 15:55 UTC (via FRA)' (none when there already). */
  travel?: string;
  /** v0.7.1: when that trip out lands (the ticket's arrival). */
  arrives?: Minute;
  /** v0.7.1: the one root reason when not clean (UPDATE-0.7.1.md §6). */
  reason?: Reason;
}

/**
 * Crew who could take a `role` seat on the duty's pairing, legal first (then tight, then illegal), then the
 * auto-roster's preference (cheapest positioning, fewest block hours). Only crew with the type rating whose role
 * can fill the seat are listed. Pure.
 */
export function dutyCandidates(g: GameState, dutyOrFlightId: string, role: Role): DutyCandidate[] {
  const x = ctxOfId(g, dutyOrFlightId);
  if (!x) return [];
  const { p } = x;
  const duties = openDuties(g, p);
  if (!duties.length) return [];
  const first = duties[0];
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  const family = typeOf(typeIdOf(g, p)).family;
  const wet = p.contractId ? g.contracts[p.contractId]?.product.kind === 'wet' : false;
  const on = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const out: (DutyCandidate & { score: number })[] = [];
  for (const c of Object.values(g.crew)) {
    if (!canFill(role, c.role) || !c.ratings.includes(family)) continue;
    const segs = segsOf(g, c, p.id);
    const plan = planCrew(g, c, p, segs, on.has(c.id));
    const issues = plan.issues.filter((i) => i.code !== 'fdp');
    const level = levelOf(issues);
    const loc = locAt(c, segs, first.report);
    const ticket = wet ? 0 : ticketPrice(loc, dep);
    const b28 = block28(segs, first.report) / 60;
    const reasons = [...new Set(issues.filter((i) => i.level !== 'legal').map((i) => i.text))];
    const o = plan.out;
    const lost = issues.some((i) => i.code === 'location' && i.level === 'illegal');
    // A ride on our own empty leg (planned, or already booked: a Flight that is not a commercial ticket).
    const ride = !!o && (!!o.rideId || ((o as Partial<Flight>).kind ?? 'deadhead') !== 'deadhead');
    const travel = o && !lost ? `${ride ? 'Rides our flight' : 'Deadhead'} ${o.from} ${fmtTime(o.std)} → ${o.to} ${fmtTime(o.sta)} UTC${ride ? '' : viaText(o.from, o.to, o.std, o.sta)}` : undefined;
    // v0.7.2 a captain for a first officer's seat: their own group 'Captain flying as FO', after the first officers
    // of the same legality (the UI groups by asFo).
    const asFo = c.role === 'CPT' && (role === 'FO' || role === 'CRP');
    if (c.role !== role) reasons.push(asFo ? 'Captain flying as FO' : `${c.role} in a ${role} seat`);
    out.push({
      crewId: c.id, name: crewName(c), role: c.role, ...(asFo ? { asFo: true as const } : {}), legal: level !== 'illegal', level, reasons, codes: [...new Set(issues.map((i) => i.code))],
      loc, onPairing: on.has(c.id), ticket, block28dH: Math.round(b28 * 10) / 10, travel, arrives: o && !lost ? o.sta : undefined,
      reason: level !== 'legal' ? rootReason(g, issues, c, p) ?? undefined : undefined,
      score: -ticket - 2 * b28 - (c.role !== role ? 50 : 0),
    });
  }
  out.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || Number(!!a.asFo) - Number(!!b.asFo) || Number(a.onPairing) - Number(b.onPairing) || b.score - a.score || (a.crewId < b.crewId ? -1 : 1));
  return out.map(({ score: _s, ...c }) => c);
}

export interface DutyLegalityWarning {
  level: Legality;
  text: string;
  code: IssueCode | 'missing' | 'extra' | 'extraEmpty';
  crewId?: string;
  /** v0.7.1: the crew member's one root reason (crew warnings). */
  reason?: Reason;
}

export interface DutyLegalityView {
  /** No hard limit broken and every seat of the complement filled. */
  legal: boolean;
  level: Legality;
  warnings: DutyLegalityWarning[];
}

/** Legality of a duty with its crew: FDP vs max (+ discretion), empty seats, every crew member's limits. Pure. */
export function dutyLegality(g: GameState, dutyOrFlightId: string): DutyLegalityView {
  const x = ctxOfId(g, dutyOrFlightId);
  if (!x) return { legal: false, level: 'illegal', warnings: [{ level: 'illegal', code: 'missing', text: 'No duty found' }] };
  const { d, p } = x;
  const warnings: DutyLegalityWarning[] = [];
  const max = d.maxFdp + (d.discretion ?? 0);
  if (d.legality !== 'legal') {
    warnings.push({ level: d.legality, code: 'fdp', text: `FDP ${hm(d.fdp)} ${d.legality === 'illegal' ? 'over' : 'close to'} the ${hm(max)} limit${d.discretion ? ' (with discretion)' : ''}` });
  }
  const missing = p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role);
  if (missing.length) warnings.push({ level: 'illegal', code: 'missing', text: `No ${seatWords(missing)} yet` });
  let level: Legality = worst(d.legality, missing.length ? 'illegal' : 'legal');
  // v0.6: optional seats above the legal minimum only warn when empty.
  const spare = p.slots.filter((s) => !s.crewId && s.above);
  if (spare.length && !d.done) {
    const cab = spare.filter((s) => s.role !== 'CRP').length;
    const pil = spare.length - cab;
    const parts = [cab ? `${cab} extra cabin seat${cab > 1 ? 's' : ''}` : '', pil ? 'the spare pilot seat' : ''].filter(Boolean).join(' and ');
    warnings.push({ level: 'tight', code: 'extraEmpty', text: `${parts[0].toUpperCase()}${parts.slice(1)} empty` });
    level = worst(level, 'tight');
  }
  if (!d.done) {
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (!c) continue;
      const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
      // Issues of this duty (rating and status sit on the first duty they hit); an earlier duty of the trip the crew
      // member can't fly breaks this one too, a later one only warns (the same reading as flightCrewStatus). Other
      // trips' issues are theirs; a loose ticket's (no duty) is no duty's.
      const mine = plan.issues.filter((i) => i.code !== 'fdp' && issueLevelFor(g, p, d, i) !== 'legal');
      const reason = mine.length ? rootReason(g, mine, c, p) ?? undefined : undefined;
      for (const i of plan.issues) {
        const lv = i.code === 'fdp' ? 'legal' : issueLevelFor(g, p, d, i);
        if (lv === 'legal') continue;
        const x = i.dutyId && i.dutyId !== d.id ? g.duties[i.dutyId] : undefined;
        const when = x ? ` (${x.report < d.report ? 'earlier' : 'later'} duty, ${fmtDay(x.report)})` : '';
        warnings.push({ level: lv, code: i.code, text: `${crewName(c)}: ${i.text}${when}`, crewId: c.id, reason });
        level = worst(level, lv);
      }
    }
  }
  warnings.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  return { legal: level !== 'illegal', level, warnings };
}

// ---------- actions ----------

export interface RosterOpts {
  /** Accept an illegal assignment (it stays flagged red) or leave a required seat empty. */
  force?: boolean;
}

/** v0.7.1 plain words for empty seats: ['CPT', 'FO', 'CC', 'CC'] → 'captain, first officer and 2 cabin crew'. */
const SEAT_WORD: Record<Role, [string, string]> = {
  CPT: ['captain', 'captains'], FO: ['first officer', 'first officers'], CRP: ['relief pilot', 'relief pilots'],
  PUR: ['purser', 'pursers'], CC: ['cabin crew', 'cabin crew'],
};
function seatWords(roles: Role[]): string {
  const parts = (Object.keys(SEAT_WORD) as Role[]).map((r) => {
    const n = roles.filter((x) => x === r).length;
    return n === 0 ? '' : n === 1 ? SEAT_WORD[r][0] : `${n} ${SEAT_WORD[r][1]}`;
  }).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
}

function issuesText(g: GameState, c: CrewMember, p: Pairing): { level: Legality; text: string } {
  const plan = planCrew(g, c, p, segsOf(g, c, p.id));
  const bad = plan.issues.filter((i) => i.code !== 'fdp' && i.level === 'illegal');
  return { level: levelOf(plan.issues.filter((i) => i.code !== 'fdp')), text: bad[0]?.text ?? '' };
}

function basicChecks(g: GameState, p: Pairing, c: CrewMember, role: Role): string | null {
  const t = typeOf(typeIdOf(g, p));
  if (!canFill(role, c.role)) return `A ${c.role} can't fill a ${role} seat`;
  if (!c.ratings.includes(t.family)) return `${crewName(c)} is not rated on ${t.short}`;
  if (!openDuties(g, p).length) return 'This trip has already flown';
  if (inProgress(g, p)) return 'A duty of this trip is under way; change the crew after it releases';
  return null;
}

/**
 * Puts a crew member on the duty's pairing in a `role` seat: an empty seat of that role first, else the seat
 * held by `replace` (that crew member is taken off), else an extra seat above the legal complement. Illegal
 * assignments are refused unless `force` (then kept and flagged red). The assignment is locked.
 */
export function assignCrew(g: GameState, dutyOrFlightId: string, crewId: string, role: Role, opts: RosterOpts & { replace?: string } = {}): ActionResult<{ pairingId: string; slot: number; level: Legality }> {
  const x = ctxOfId(g, dutyOrFlightId);
  if (!x) return { ok: false, error: 'Duty not found' };
  const { p } = x;
  const c = g.crew[crewId];
  if (!c) return { ok: false, error: 'Crew member not found' };
  const bad = basicChecks(g, p, c, role);
  if (bad) return { ok: false, error: bad };
  if (p.slots.some((s) => s.crewId === crewId)) return { ok: false, error: `${crewName(c)} is already on this trip` };
  let slot = -1;
  if (opts.replace) {
    slot = p.slots.findIndex((s) => s.crewId === opts.replace);
    if (slot < 0) return { ok: false, error: 'That crew member is not on this trip' };
    if (!canFill(p.slots[slot].role, c.role)) return { ok: false, error: `A ${c.role} can't fill a ${p.slots[slot].role} seat` };
  } else {
    slot = p.slots.findIndex((s) => !s.crewId && !s.above && s.role === role);
    if (slot < 0) slot = p.slots.findIndex((s) => !s.crewId && s.role === role);
  }
  const check = issuesText(g, c, p);
  if (check.level === 'illegal' && !opts.force) return { ok: false, error: `Illegal: ${check.text}` };
  if (slot < 0) {
    p.slots.push({ role, crewId: null, extra: true });
    slot = p.slots.length - 1;
  }
  placeCrew(g, p, slot, c);
  p.slots[slot].locked = true;
  touchCrew(g);
  const name = crewName(c);
  const msg = check.level === 'illegal' ? `${name} assigned, flagged illegal: ${check.text}` : check.level === 'tight' ? `${name} assigned (tight)` : `${name} assigned`;
  return { ok: true, msg, data: { pairingId: p.id, slot, level: check.level } };
}

/**
 * Takes a crew member off the duty's pairing (tickets cancelled, sent home when away). Leaving a required seat
 * empty is refused unless `force`; with the auto-roster policy the seat is refilled at once by someone else.
 */
export function unassignCrew(g: GameState, dutyOrFlightId: string, crewId: string, opts: RosterOpts = {}): ActionResult {
  const x = ctxOfId(g, dutyOrFlightId);
  if (!x) return { ok: false, error: 'Duty not found' };
  const { p } = x;
  const s = p.slots.find((y) => y.crewId === crewId);
  if (!s) return { ok: false, error: 'Not on this trip' };
  if (inProgress(g, p)) return { ok: false, error: 'A duty of this trip is under way; change the crew after it releases' };
  const optional = !!s.extra || !!s.above;
  if (!optional && !opts.force) return { ok: false, error: `The ${s.role} seat is required; assign a replacement or force it empty` };
  const before = new Set(p.slots.map((y) => y.crewId).filter((id): id is string => !!id));
  const role = s.role;
  releaseCrew(g, p, crewId);
  // A required seat is refilled now (auto-roster policy), by anyone but the crew member just taken off: the next
  // daily pass may be too late to position someone for an early report.
  let by: CrewMember | undefined;
  if (!optional && g.company.policies.autoRoster) {
    fillAll(g, [p], emptyResult(), new Set([crewId]));
    const filled = p.slots.find((y) => y.role === role && y.crewId && !before.has(y.crewId));
    by = filled ? g.crew[filled.crewId!] : undefined;
  }
  recheckPairing(g, p);
  touchCrew(g);
  const c = g.crew[crewId];
  const who = c ? crewName(c) : 'Crew member';
  if (optional) return { ok: true, msg: `${who} taken off` };
  return { ok: true, msg: by ? `${who} taken off; ${crewName(by)} takes the ${role} seat` : `${who} taken off; the ${role} seat is open` };
}

/**
 * Swaps two crew members between two pairings (crewA leaves dutyA's pairing for crewB's seat on dutyB's, and the
 * other way round). Refused when either side would be illegal unless `force`. Both seats are locked.
 */
export function swapCrew(g: GameState, dutyA: string, crewA: string, dutyB: string, crewB: string, opts: RosterOpts = {}): ActionResult<{ levelA: Legality; levelB: Legality }> {
  const a = ctxOfId(g, dutyA);
  const b = ctxOfId(g, dutyB);
  if (!a || !b) return { ok: false, error: 'Duty not found' };
  const ca = g.crew[crewA];
  const cb = g.crew[crewB];
  if (!ca || !cb) return { ok: false, error: 'Crew member not found' };
  if (a.p.id === b.p.id) return { ok: false, error: 'Both are on the same trip' };
  const ia = a.p.slots.findIndex((s) => s.crewId === crewA);
  const ib = b.p.slots.findIndex((s) => s.crewId === crewB);
  if (ia < 0 || ib < 0) return { ok: false, error: 'Crew member not on that trip' };
  if (a.p.slots.some((s) => s.crewId === crewB) || b.p.slots.some((s) => s.crewId === crewA)) return { ok: false, error: 'One of them is already on the other trip' };
  const badB = basicChecks(g, a.p, cb, a.p.slots[ia].role);
  if (badB) return { ok: false, error: badB };
  const badA = basicChecks(g, b.p, ca, b.p.slots[ib].role);
  if (badA) return { ok: false, error: badA };
  // Each side's timeline without both pairings (the swap removes them from their own).
  const lvl = (c: CrewMember, to: Pairing, from: Pairing) => {
    const segs = segsOf(g, c, from.id).filter((s) => !s.dutyId || !to.dutyIds.includes(s.dutyId));
    const plan = planCrew(g, c, to, segs, false, 0, from.id);
    const issues = plan.issues.filter((i) => i.code !== 'fdp');
    return { level: levelOf(issues), text: issues.find((i) => i.level === 'illegal')?.text ?? '' };
  };
  const la = lvl(ca, b.p, a.p);
  const lb = lvl(cb, a.p, b.p);
  if (!opts.force && (la.level === 'illegal' || lb.level === 'illegal')) {
    return { ok: false, error: `Illegal: ${la.level === 'illegal' ? `${crewName(ca)}: ${la.text}` : `${crewName(cb)}: ${lb.text}`}` };
  }
  const seatA = { ...a.p.slots[ia] };
  const seatB = { ...b.p.slots[ib] };
  releaseCrew(g, a.p, crewA);
  releaseCrew(g, b.p, crewB);
  // releaseCrew drops an emptied extra seat; it is re-added for the incoming crew member.
  const seat = (p: Pairing, i: number, was: { role: Role; extra?: boolean }) => {
    if (!was.extra && p.slots[i] && !p.slots[i].crewId && p.slots[i].role === was.role) return i;
    p.slots.push(was.extra ? { role: was.role, crewId: null, extra: true } : { role: was.role, crewId: null });
    return p.slots.length - 1;
  };
  const sa = seat(a.p, ia, seatA);
  const sb = seat(b.p, ib, seatB);
  placeCrew(g, a.p, sa, cb);
  placeCrew(g, b.p, sb, ca);
  a.p.slots[sa].locked = true;
  b.p.slots[sb].locked = true;
  touchCrew(g);
  return { ok: true, msg: `Swapped ${crewName(ca)} and ${crewName(cb)}`, data: { levelA: la.level, levelB: lb.level } };
}

/** Releases the lock on a manual assignment, so the rolling re-plan may change that seat again. */
export function unlockCrew(g: GameState, dutyOrFlightId: string, crewId: string): ActionResult {
  const x = ctxOfId(g, dutyOrFlightId);
  const s = x?.p.slots.find((y) => y.crewId === crewId);
  if (!x || !s) return { ok: false, error: 'Not on this trip' };
  delete s.locked;
  touchCrew(g);
  return { ok: true };
}
