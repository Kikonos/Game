// Auto-roster, change sync and disruption APIs (B2). DESIGN.md §4.2, §5.3.

import { BAL } from '../core/balance';
import { addDeadhead, flightsOf, removeFlights, retimeFlight, touchFlights } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { canFill, complement, typeOf } from '../core/perf';
import { DAY, fmtDateTime } from '../core/time';
import type { ActionResult, CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { acceptable, crewIssuesFor, mergeSegs, openDuties, otherTrip, planCrew, type CrewPlan } from './check';
import { deletePairing, dutyLegality, planAircraft, queueDuty, refreshPairing, setCrewOkHook, setCrewTrailOkHook, setReleaseHook, setRetickHook, splitPairing, syncDuty } from './duties';
import { crewName } from './generate';
import { evalSegs, levelOf, worst, type Seg } from './rules';
import { aboard, block28, crewCount, crewIx, ctxOf, dhBlock, dutySegs, locAt, noteRiders, passengers, planHome, planOut, segsOf, ticketPrice, touchCrew, typeIdOf } from './timeline';

export { buildDuties } from './duties';

export interface RosterResult {
  /** Slots filled. */
  assigned: number;
  /** Flights still missing crew. */
  uncovered: string[];
  deadheads: number;
  /** Ticket + hotel cost committed. */
  cost: number;
}

export const emptyResult = (): RosterResult => ({ assigned: 0, uncovered: [], deadheads: 0, cost: 0 });

const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'CSD', 'SCC', 'CC'];

/** On wet leases the client buys crew tickets and hotels (RESEARCH §2.2). */
export function clientPaysCrewTravel(g: GameState, p: Pairing | undefined): boolean {
  const c = p?.contractId ? g.contracts[p.contractId] : undefined;
  return c?.product.kind === 'wet';
}

// ---------- crew on pairings ----------

/** Operating crew on the pairing's flights still to fly. */
export function setFlightsCrew(g: GameState, p: Pairing): void {
  const ids = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
  for (const d of openDuties(g, p)) {
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled') {
        f.crewIds = [...ids];
        f.dutyId = d.id;
      }
    }
  }
}

/** Operating crew of a flight from its duty's pairing (written at off-blocks so arrivals move the right crew). */
export function boardCrew(g: GameState, f: Flight): void {
  if (f.kind === 'deadhead' || !f.dutyId) return;
  const d = g.duties[f.dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!p) return;
  const ids = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
  if (ids.join() !== f.crewIds.join()) f.crewIds = ids;
}

type TicketLike = { from: string; to: string; std: Minute; sta: Minute; rideId?: string };

/** Buys a ticket for a group and attaches it to a duty; cost posted to 'deadhead' unless the client pays. */
function buyTicket(g: GameState, p: Pairing, d: Duty, crewIds: string[], t: TicketLike, res: RosterResult): Flight {
  const ride = t.rideId ? g.flights[t.rideId] : undefined;
  if (ride && ride.status === 'scheduled') {
    ride.riders = [...new Set([...(ride.riders ?? []), ...crewIds])];
    noteRiders(g, ride);
    if (!d.deadheadIds.includes(ride.id)) d.deadheadIds.push(ride.id);
    touchFlights(g);
    return ride;
  }
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(t.from, t.to) * crewIds.length;
  const f = addDeadhead(g, { crewIds, from: t.from, to: t.to, std: t.std, sta: t.sta, cost, contractId: p.contractId });
  if (cost) post(g, 'deadhead', -cost);
  d.deadheadIds.push(f.id);
  res.deadheads++;
  res.cost += cost;
  return f;
}

/**
 * Takes a crew member off a ticket or a ride. True when the flight no longer carries any of our crew as
 * passengers (a commercial ticket left empty is cancelled; our own leg flies on without riders).
 */
function unboard(g: GameState, f: Flight, crewId: string): boolean {
  if (f.kind === 'deadhead') {
    f.crewIds = f.crewIds.filter((x) => x !== crewId);
    // An unused ticket is simply dropped (its cost is sunk): no cancelled tickets piling up in the save.
    if (!f.crewIds.length) removeFlights(g, [f.id]);
    else touchFlights(g);
    return !f.crewIds.length;
  }
  f.riders = (f.riders ?? []).filter((x) => x !== crewId);
  if (!f.riders.length) delete f.riders;
  touchFlights(g);
  return !f.riders;
}

/** Takes crew off tickets home their new trip makes unnecessary (CrewPlan.drop; a ticket left empty is cancelled). */
function dropPlanned(g: GameState, crewId: string, ids: string[]): void {
  const ix = crewIx(g);
  for (const fid of ids) {
    const f = g.flights[fid];
    if (!f || f.status !== 'scheduled' || !aboard(f, crewId)) continue;
    if (!unboard(g, f, crewId)) continue;
    const d = g.duties[ix.ticketDuty.get(fid) ?? ''];
    if (d) d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
  }
}

/** Groups the planned tickets of newly assigned crew (one ticket per group travelling together). */
export function buyTickets(g: GameState, p: Pairing, plans: Map<string, CrewPlan>, res: RosterResult): void {
  const duties = openDuties(g, p);
  for (const [id, plan] of plans) if (plan.drop) dropPlanned(g, id, plan.drop);
  if (!duties.length) return;
  const first = duties[0];
  const last = duties[duties.length - 1];
  const groups = new Map<string, { d: Duty; t: TicketLike; ids: string[] }>();
  for (const [id, plan] of plans) {
    for (const [t, d] of [[plan.out, first], [plan.home, last]] as const) {
      if (!t) continue;
      const k = `${d.id}:${t.from}:${t.to}:${t.std}:${t.rideId ?? ''}`;
      const gr = groups.get(k) ?? { d, t, ids: [] };
      gr.ids.push(id);
      groups.set(k, gr);
    }
  }
  for (const gr of groups.values()) buyTicket(g, p, gr.d, gr.ids, gr.t, res);
}

/** Takes a crew member off a pairing: slot, flights still to fly and unused tickets (cancelled when empty). */
export function releaseCrew(g: GameState, p: Pairing, crewId: string): void {
  for (const s of p.slots) {
    if (s.crewId !== crewId) continue;
    s.crewId = null;
    delete s.locked;
  }
  // An extra seat exists only while someone holds it.
  if (p.slots.some((s) => s.extra && !s.crewId)) p.slots = p.slots.filter((s) => !(s.extra && !s.crewId));
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d || d.done) continue;
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled') f.crewIds = f.crewIds.filter((x) => x !== crewId);
    }
  }
  dropTickets(g, p, crewId);
  touchCrew(g);
  const c = g.crew[crewId];
  if (c && p.status === 'active') sendHome(g, c, p);
}

/**
 * A crewed duty moved: its tickets home leave check-in time after the new release, and tickets out still arriving
 * after the new report leave earlier when there is time (else the re-check flags the crew and they are re-planned).
 */
function retimeTickets(g: GameState, p: Pairing, d: Duty, moved: Set<string>): void {
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    if (!f || f.status !== 'scheduled' || f.kind !== 'deadhead') continue;
    let std = f.std;
    // Home tickets leave after report; tickets out leave before it.
    if (f.std > d.report) {
      if (f.from === d.restAt && f.std < d.release + 30) std = Math.ceil((d.release + 60) / 60) * 60;
    } else if (f.to === dep && f.sta > d.report && f.std > g.now) {
      const t = planOut(g, p, d, f.from);
      if (!t.rideId && t.std - BAL.deadheadCheckIn >= g.now) std = t.std;
    }
    if (std === f.std) continue;
    retimeFlight(g, f, std, std + f.block);
    for (const id of f.crewIds) moved.add(id);
  }
  touchCrew(g);
}

/** Crew whose duty or tickets moved: their next trip is re-checked (rest, location) and re-rostered when broken. */
function recheckLater(g: GameState, crewIds: Set<string>, after: Pairing): void {
  const acs = new Set<string>();
  const seen = new Set<Pairing>();
  for (const id of crewIds) {
    let next: Pairing | null = null;
    for (const q of crewIx(g).pairingsOf.get(id) ?? []) {
      if (q === after || q.start <= after.start || q.status !== 'planned' || !q.aircraftId || !inHorizon(g, q.start)) continue;
      if (!next || q.start < next.start) next = q;
    }
    if (!next || seen.has(next)) continue;
    seen.add(next);
    if (recheckPairing(g, next).level === 'illegal') acs.add(next.aircraftId!);
  }
  for (const ac of acs) if (g.company.policies.autoRoster) rerosterFrom(g, ac, g.now);
}

/** Crew whose whereabouts changed outside a trip (a ticket they never boarded): their next trip is re-checked. */
export function recheckNext(g: GameState, crewIds: string[]): void {
  const acs = new Set<string>();
  for (const id of crewIds) {
    let next: Pairing | null = null;
    for (const q of crewIx(g).pairingsOf.get(id) ?? []) {
      if (q.status !== 'planned' || !q.aircraftId || q.start < g.now) continue;
      if (!next || q.start < next.start) next = q;
    }
    if (next && recheckPairing(g, next).level === 'illegal' && inHorizon(g, next.start)) acs.add(next.aircraftId!);
  }
  if (g.company.policies.autoRoster) for (const ac of acs) rerosterFrom(g, ac, g.now);
}

/** Takes a crew member off the pairing's tickets not yet flown (a ticket left empty is cancelled). */
function dropTickets(g: GameState, p: Pairing, crewId: string): void {
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d || d.done) continue;
    for (const fid of [...d.deadheadIds]) {
      const f = g.flights[fid];
      if (!f || f.status !== 'scheduled' || !aboard(f, crewId)) continue;
      if (unboard(g, f, crewId)) d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
    }
  }
}

/**
 * Re-plans a crew member's positioning on p from where they really are (after a retime, or a duty added in front
 * of the trip, left the old tickets unworkable). True when the crew member is acceptable again with new tickets.
 */
function retick(g: GameState, p: Pairing, c: CrewMember): boolean {
  const plan = planCrew(g, c, p, segsOf(g, c, p.id));
  if (!acceptable(g, plan)) return false;
  dropTickets(g, p, c.id);
  buyTickets(g, p, new Map([[c.id, plan]]), emptyResult());
  touchCrew(g);
  return true;
}

/** A crew member left away from base without a plan gets a ticket home after rest. */
function sendHome(g: GameState, c: CrewMember, p?: Pairing): void {
  if (c.loc === c.base) return;
  const ix = crewIx(g);
  // A ticket from where they are (or one already under way) takes them on.
  if ((ix.tickets.get(c.id) ?? []).some((f) => f.status === 'scheduled' && (f.from === c.loc || f.std <= g.now))) return;
  if ((ix.pairingsOf.get(c.id) ?? []).some((x) => x.status === 'active' || (x.status === 'planned' && x.start < g.now + 3 * DAY))) return;
  const blk = dhBlock(c.loc, c.base);
  const std = Math.ceil((Math.max(g.now, c.restUntil) + 60) / 60) * 60;
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(c.loc, c.base);
  const contractId = p?.contractId ?? null;
  // Crew going home together share one booking (one flight per group, DESIGN §3.5).
  const group = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.from === c.loc && f.to === c.base && f.std === std && f.contractId === contractId && !ix.ticketDuty.has(f.id));
  if (group) {
    group.crewIds.push(c.id);
    group.cost = (group.cost ?? 0) + cost;
    touchFlights(g);
  } else addDeadhead(g, { crewIds: [c.id], from: c.loc, to: c.base, std, sta: std + blk, cost, contractId });
  if (cost) post(g, 'deadhead', -cost);
  touchCrew(g);
}

/**
 * Daily: crewed trips and tours with a duty reporting in the next week are re-checked (a ticket moved, a crew
 * member stranded elsewhere, a recovery or rest a delay ate); broken ones are re-rostered while there is still
 * time to position someone (a tour under way is split before the duty its crew can't fly).
 */
export function recheckSoon(g: GameState): void {
  const acs = new Set<string>();
  for (const p of Object.values(g.pairings)) {
    if (!p.aircraftId || crewCount(p) === 0) continue;
    if (p.status === 'planned') {
      if (p.start < g.now || p.start > g.now + 7 * DAY) continue;
    } else if (p.status === 'active') {
      const next = openDuties(g, p).find((d) => d.report > g.now);
      if (!next || next.report > g.now + 7 * DAY) continue;
    } else continue;
    if (recheckPairing(g, p).level === 'illegal') acs.add(p.aircraftId);
  }
  for (const ac of acs) rerosterFrom(g, ac, g.now);
}

/**
 * After a duty is logged (actual times can differ from the plan): the crew's trip and their next trips are
 * re-checked at once, and an aircraft whose crew can no longer fly a later duty is re-rostered.
 */
export function recheckAfterRelease(g: GameState, p: Pairing): void {
  const acs = new Set<string>();
  const ids = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
  if (openDuties(g, p).length && p.aircraftId && recheckPairing(g, p).level === 'illegal' && p.illegalFrom !== undefined) acs.add(p.aircraftId);
  for (const ac of laterBroken(g, ids, p)) acs.add(ac);
  if (g.company.policies.autoRoster) for (const ac of acs) rerosterFrom(g, ac, g.now);
}

/** Daily: crew left away from base with no trip ahead and no ticket go home (after a split or a dissolved trip). */
export function sendStrandedHome(g: GameState): void {
  const away = Object.values(g.crew).filter((c) => c.loc !== c.base && c.status !== 'onDuty');
  if (!away.length) return;
  const riding = new Set<string>();
  for (const f of Object.values(g.flights)) if (f.status === 'enroute') for (const id of passengers(f)) riding.add(id);
  for (const c of away) if (!riding.has(c.id)) sendHome(g, c);
}

/** Removes a duty from its pairing; its tickets move to the pairing's new first/last duty. */
function detachDuty(g: GameState, p: Pairing, d: Duty): void {
  p.dutyIds = p.dutyIds.filter((x) => x !== d.id);
  const rest = openDuties(g, p);
  for (const fid of d.deadheadIds) {
    const f = g.flights[fid];
    if (!f) continue;
    // The trip's last duty went: before anyone reported its tickets go too; under way the crew keep their
    // ticket home (loose, it still shapes their timeline).
    if (!rest.length) {
      if (p.status === 'planned' && f.status === 'scheduled' && f.std > g.now) removeFlights(g, [f.id]);
      continue;
    }
    const target = f.sta <= d.report ? rest[0] : rest[rest.length - 1];
    target.deadheadIds.push(fid);
  }
  for (const fid of d.flightIds) {
    const f = g.flights[fid];
    if (f && f.dutyId === d.id) {
      f.dutyId = null;
      if (f.status === 'scheduled') f.crewIds = [];
    }
  }
  delete g.duties[d.id];
  touchCrew(g);
}

function dissolve(g: GameState, p: Pairing): void {
  for (const s of p.slots) if (s.crewId) releaseCrew(g, p, s.crewId);
  deletePairing(g, p);
  touchCrew(g);
}

/**
 * Worst of the duty limits and every assigned crew member's legality (stored on the pairing, with `illegalFrom`:
 * the report of the first duty a crew member can't fly). `priorOnly` ignores the crew's later planned work (their
 * log stays), so a conflict frees the crew from the later pairing (re-roster order).
 */
export function recheckPairing(g: GameState, p: Pairing, priorOnly = false): { level: Legality; illegal: string[]; from: Map<string, Minute> } {
  let level: Legality = 'legal';
  const open = openDuties(g, p);
  for (const d of open) level = worst(level, d.legality);
  const illegal: string[] = [];
  /** Per illegal crew member: report of the first duty they can't fly. */
  const from = new Map<string, Minute>();
  const own = new Set(p.dutyIds);
  let first = Infinity;
  for (const s of p.slots) {
    if (!s.crewId) continue;
    const c = g.crew[s.crewId];
    if (!c) continue;
    const base = segsOf(g, c, p.id);
    const plan = planCrew(g, c, p, priorOnly ? base.filter((x) => x.kind === 'log' || x.start < p.start) : base, true);
    // This pairing's own issues (a later trip's problem is flagged on that trip when it is checked; a loose
    // ticket's, without a duty, is no trip's).
    const mine = plan.issues.filter((i) => i.code !== 'fdp' && !!i.dutyId && own.has(i.dutyId));
    const crewLevel = levelOf(mine);
    if (crewLevel === 'illegal') {
      let t = Infinity;
      for (const i of mine) if (i.level === 'illegal') t = Math.min(t, g.duties[i.dutyId!]?.report ?? open[0]?.report ?? 0);
      from.set(c.id, t);
      illegal.push(c.id);
      first = Math.min(first, t);
    }
    level = worst(level, crewLevel);
  }
  p.legality = level;
  if (first < Infinity) p.illegalFrom = first;
  else delete p.illegalFrom;
  return { level, illegal, from };
}

/** Pairings of the crew's later trips (after p) that are now illegal for them; their aircraft need a re-roster. */
function laterBroken(g: GameState, crewIds: string[], p: Pairing): Set<string> {
  const acs = new Set<string>();
  const seen = new Set<Pairing>();
  for (const id of crewIds) {
    for (const q of crewIx(g).pairingsOf.get(id) ?? []) {
      if (q === p || seen.has(q) || q.start <= p.start || q.status !== 'planned' || !q.aircraftId) continue;
      seen.add(q);
      if (recheckPairing(g, q).level === 'illegal') acs.add(q.aircraftId);
    }
  }
  return acs;
}

/**
 * Last line before a duty (2 h before report, and at the gate): no crew member may fly it over a limit. Crew with
 * a crew-level issue are re-rostered (their later trips give way first, then this aircraft is re-planned); anyone
 * still illegal comes off the duty (the trip is split there) and the seat is refilled, else it stays empty and
 * ops raise the crew-short decision at departure. True when the duty's crew is clean.
 */
export function guardDuty(g: GameState, dutyId: string): boolean {
  let d = g.duties[dutyId];
  if (!d || d.done) return true;
  const found = crewIssuesFor(g, d);
  if (!found.length) return true;
  const p0 = g.pairings[d.pairingId];
  const acs = laterBroken(g, found.map((b) => b.crewId), p0);
  if (p0.aircraftId) acs.add(p0.aircraftId);
  for (const ac of acs) rerosterFrom(g, ac, g.now);
  d = g.duties[dutyId];
  let short = 0;
  if (d && !d.done && g.pairings[d.pairingId]) {
    const bad = crewIssuesFor(g, d);
    if (bad.length) {
      const p = g.pairings[d.pairingId];
      const q = openDuties(g, p)[0] === d ? p : splitPairing(g, p, d.report) ?? p;
      for (const b of bad) releaseCrew(g, q, b.crewId);
      if (q !== p) setFlightsCrew(g, p);
      fillAll(g, [q], emptyResult(), new Set(bad.map((b) => b.crewId)));
      setFlightsCrew(g, q);
      recheckPairing(g, q);
    }
    short = g.pairings[d.pairingId]?.slots.filter((s) => !s.crewId).length ?? 0;
  }
  const off = found.filter((b) => !(d && g.pairings[d.pairingId]?.slots.some((s) => s.crewId === b.crewId)));
  if (off.length) {
    const fid = (d ?? g.duties[dutyId])?.flightIds[0];
    const f = fid ? g.flights[fid] : undefined;
    const what = f ? `${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}` : 'the duty';
    pushMessage(g, {
      tone: short ? 'warn' : 'info', cat: 'crew',
      title: `${off.length === 1 ? 'Crew member' : `${off.length} crew`} taken off ${f?.no ?? 'a duty'}`,
      body: `${off.map((b) => crewName(g.crew[b.crewId])).join(', ')}: ${off[0].issue.text}. ${short ? `No legal replacement for ${short} seat${short > 1 ? 's' : ''} on ${what} yet.` : `Replaced on ${what}.`}`,
      ref: f ? { kind: 'flight', id: f.id } : undefined,
    });
  }
  if (short) requestPause('crewShortage');
  touchCrew(g);
  return !d || (!short && !crewIssuesFor(g, d).length);
}

// ---------- auto-roster ----------

const copySeg = (x: Seg): Seg => ({
  kind: x.kind, start: x.start, end: x.end, fdp: x.fdp, maxFdp: x.maxFdp, block: x.block, sectors: x.sectors, aug: x.aug,
  disruptive: x.disruptive, rest: x.rest, at: x.at, from: x.from, dutyId: x.dutyId, fresh: false,
});

/** Cheap pre-check: a planned seg overlaps [from, to) or its rest runs past `from` (certainly illegal). */
function busyAt(segs: Seg[], from: Minute, to: Minute): boolean {
  let lo = 0;
  let hi = segs.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (segs[m].start < to) lo = m + 1;
    else hi = m;
  }
  for (let k = lo - 1; k >= 0 && k >= lo - 4; k--) {
    const s = segs[k];
    if (s.kind === 'log') break;
    if (s.end + s.rest > from) return true;
  }
  return false;
}

/** Per-run cache of crew timelines (updated as slots are filled; no index churn inside the loop). */
class Ctx {
  segs = new Map<string, Seg[]>();
  crew: CrewMember[];
  /** Position of each crew id in string order (numeric tie-break). */
  rank = new Map<string, number>();
  constructor(readonly g: GameState) {
    this.crew = Object.values(g.crew);
    this.crew.map((c) => c.id).sort().forEach((id, i) => this.rank.set(id, i));
  }
  of(c: CrewMember): Seg[] {
    let s = this.segs.get(c.id);
    if (!s) this.segs.set(c.id, (s = segsOf(this.g, c)));
    return s;
  }
  add(c: CrewMember, segs: Seg[]): void {
    this.segs.set(c.id, mergeSegs(this.of(c), segs.map((x) => copySeg(x))));
  }
  /** Pairing spans filled in this run (the crew index is rebuilt only after the run). */
  spans = new Map<string, [Minute, Minute][]>();
  onTrip(id: string, from: Minute, to: Minute): boolean {
    return (this.spans.get(id) ?? []).some(([a, b]) => a < to && b > from);
  }
  take(id: string, from: Minute, to: Minute): void {
    const l = this.spans.get(id);
    if (l) l.push([from, to]);
    else this.spans.set(id, [[from, to]]);
  }
}

/** Crew who flew the aircraft's or contract's previous pairing (crew family bonus). */
function previousCrew(g: GameState, p: Pairing): Set<string> {
  let best: Pairing | null = null;
  for (const q of crewIx(g).byAircraft.get(p.aircraftId ?? '') ?? []) {
    if (q.id === p.id || q.start >= p.start || crewCount(q) === 0) continue;
    if (!best || q.start > best.start) best = q;
  }
  return new Set(best ? best.slots.filter((s) => s.crewId).map((s) => s.crewId!) : []);
}

/** Fills a pairing's empty slots with the best-scoring legal crew (DESIGN §5.3 steps 1–4, 6). */
function fillPairing(g: GameState, ctx: Ctx, p: Pairing, res: RosterResult, exclude?: Set<string>): void {
  const duties = openDuties(g, p);
  if (!duties.length) return;
  const first = duties[0];
  const spanTo = duties[duties.length - 1].release;
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  const family = typeOf(typeIdOf(g, p)).family;
  const contract = p.contractId ? g.contracts[p.contractId] : undefined;
  const unpleasant = (contract?.effects.morale ?? 0) < 0;
  const prev = previousCrew(g, p);
  const hadCrew = crewCount(p) > 0;
  const inP = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const order = p.slots.map((_, i) => i).filter((i) => !p.slots[i].crewId);
  order.sort((a, b) => SLOT_ORDER.indexOf(p.slots[a].role) - SLOT_ORDER.indexOf(p.slots[b].role) || a - b);
  const plans = new Map<string, CrewPlan>();
  // Slot-independent part of the score, once per pairing (crew in p are skipped below).
  const fitRoles = new Set<Role>();
  for (const r of SLOT_ORDER) for (const i of order) if (canFill(p.slots[i].role, r)) fitRoles.add(r);
  const price = new Map<string, number>();
  const pool: { c: CrewMember; score: number; rank: number }[] = [];
  for (const c of ctx.crew) {
    if (!fitRoles.has(c.role) || !c.ratings.includes(family) || inP.has(c.id) || exclude?.has(c.id)) continue;
    const segs = ctx.of(c);
    if (busyAt(segs, first.report, first.release)) continue;
    const loc = locAt(c, segs, first.report);
    let tp = price.get(loc);
    if (tp === undefined) price.set(loc, (tp = ticketPrice(loc, dep)));
    let score = -tp - 2 * (block28(segs, first.report) / 60);
    if (prev.has(c.id)) score += 30;
    if (unpleasant) score -= (70 - c.morale) / 2;
    pool.push({ c, score, rank: ctx.rank.get(c.id)! });
  }
  pool.sort((a, b) => b.score - a.score || a.rank - b.rank);
  // Per slot, candidates in score order: the same-role stream merged lazily with the overqualified one (−50).
  // A crew member's plan does not depend on the slot, so one refused is not re-planned for the next slot.
  const refused = new Set<string>();
  const skip = (x: (typeof pool)[number]) => inP.has(x.c.id) || refused.has(x.c.id);
  for (const si of order) {
    const slot = p.slots[si];
    const role = slot.role;
    let i = 0;
    let j = 0;
    for (;;) {
      while (i < pool.length && (pool[i].c.role !== role || skip(pool[i]))) i++;
      while (j < pool.length && (pool[j].c.role === role || !canFill(role, pool[j].c.role) || skip(pool[j]))) j++;
      if (i >= pool.length && j >= pool.length) break;
      let x;
      if (j >= pool.length) x = pool[i++];
      else if (i >= pool.length) x = pool[j++];
      else {
        const a = pool[i];
        const o = pool[j];
        const so = o.score - 50;
        if (a.score > so || (a.score === so && a.rank < o.rank)) x = pool[i++];
        else x = pool[j++];
      }
      const c = x.c;
      if (ctx.onTrip(c.id, first.report, spanTo)) {
        refused.add(c.id);
        continue;
      }
      const plan = planCrew(g, c, p, ctx.of(c), false, BAL.rosterSlack);
      if (!acceptable(g, plan)) {
        refused.add(c.id);
        continue;
      }
      slot.crewId = c.id;
      inP.add(c.id);
      plans.set(c.id, plan);
      if (plan.drop) ctx.segs.set(c.id, ctx.of(c).filter((x) => !x.ticketId || !plan.drop!.includes(x.ticketId)));
      ctx.add(c, plan.segs);
      ctx.take(c.id, first.report, spanTo);
      res.assigned++;
      break;
    }
  }
  if (!plans.size) return;
  buyTickets(g, p, plans, res);
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of duties) queueDuty(g, d);
  let level: Legality = 'legal';
  for (const d of duties) level = worst(level, d.legality);
  for (const plan of plans.values()) level = worst(level, levelOf(plan.issues.filter((i) => i.code !== 'fdp')));
  p.legality = hadCrew ? worst(level, p.legality) : level;
  if (!hadCrew) delete p.illegalFrom;
}

/** Flights of pairings with empty slots (still to fly, std in [from, to)). */
function uncoveredOf(g: GameState, ps: Pairing[], from: Minute, to: Minute): string[] {
  const out: string[] = [];
  for (const p of ps) {
    if (!g.pairings[p.id] || !p.slots.some((s) => !s.crewId)) continue;
    for (const d of openDuties(g, p)) for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled' && f.std >= from && f.std < to) out.push(fid);
    }
  }
  return out;
}

/** Uncovered flights departing within 48 h: one message per batch and a crewShortage pause (warned once per flight, saved). */
function warnShort(g: GameState, ids: string[]): void {
  const soon = ids.filter((id) => {
    const f = g.flights[id];
    return !!f && !f.crewWarned && f.std < g.now + 2 * DAY;
  });
  if (!soon.length) return;
  for (const id of soon) g.flights[id].crewWarned = true;
  const fl = soon.map((id) => g.flights[id]).sort((a, b) => a.std - b.std);
  const f = fl[0];
  pushMessage(g, {
    tone: 'warn', cat: 'crew',
    title: fl.length === 1 ? `No crew for ${f.no}` : `No crew for ${fl.length} flights`,
    body: `${f.no} ${f.from}–${f.to} departs ${fmtDateTime(f.std)}${fl.length > 1 ? ` (and ${fl.length - 1} more)` : ''}. Hire, deadhead or allow tight duties.`,
    ref: { kind: 'flight', id: f.id },
  });
  requestPause('crewShortage');
}

export function fillAll(g: GameState, ps: Pairing[], res: RosterResult, exclude?: Set<string>): void {
  if (!ps.length) return;
  crewIx(g);
  const ctx = new Ctx(g);
  for (const p of ps) if (g.pairings[p.id]) fillPairing(g, ctx, p, res, exclude);
  touchCrew(g);
}

/**
 * Greedy auto-roster: rebuild open pairings of the aircraft, then fill every open slot of pairings starting in
 * [from, to) (default: now → roster horizon; a tour is filled as a whole) with the best-scoring legal crew
 * member; tickets position crew (one per group).
 */
export function autoRoster(g: GameState, opts: { from?: Minute; to?: Minute; aircraftIds?: string[] } = {}): RosterResult {
  const res = emptyResult();
  const from = Math.max(opts.from ?? g.now, g.now);
  const to = opts.to ?? g.now + BAL.rosterHorizonDays * DAY;
  const acs = opts.aircraftIds ?? Object.keys(g.fleet);
  for (const id of acs) planAircraft(g, id, from);
  const sel = new Set(acs);
  const open = Object.values(g.pairings)
    .filter((p) => p.aircraftId && sel.has(p.aircraftId) && (p.status === 'planned' || p.status === 'active') && p.start < to && p.end > from && p.slots.some((s) => !s.crewId))
    .sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  fillAll(g, open, res);
  res.uncovered = uncoveredOf(g, open, from, to);
  warnShort(g, res.uncovered);
  return res;
}

// ---------- change sync ----------

const inHorizon = (g: GameState, t: Minute) => t < g.now + BAL.rosterHorizonDays * DAY;

/**
 * Cheap re-sync after another module changed an aircraft's flights from t (retime, cancel, removal, reassign,
 * sub-charter); called from crew's settle hook. Drops foreign flights from duties, re-measures changed duties
 * (ev++, re-queued), re-checks crew; illegal or uncovered work inside the roster horizon goes through rerosterFrom.
 */
export function onFlightsChanged(g: GameState, aircraftId: string, t: Minute): void {
  let reroster = false;
  let changed = false;
  const later: [Pairing, Set<string>][] = [];
  for (const p of [...(crewIx(g).byAircraft.get(aircraftId) ?? [])]) {
    if (p.status === 'done' || p.status === 'broken' || p.end < t - DAY || !g.pairings[p.id]) continue;
    let pChanged = false;
    for (const did of [...p.dutyIds]) {
      const d = g.duties[did];
      if (!d || d.done) continue;
      const keep: string[] = [];
      let ev = 0;
      for (const fid of d.flightIds) {
        const f = g.flights[fid];
        if (f && f.status !== 'cancelled' && f.aircraftId === aircraftId) {
          keep.push(fid);
          ev += f.ev;
        } else if (f && f.dutyId === d.id) {
          f.dutyId = null;
          if (f.status === 'scheduled' || f.status === 'cancelled') f.crewIds = [];
        }
      }
      if (keep.length === d.flightIds.length && ev === d.flightsEv) continue;
      pChanged = true;
      if (!keep.length) {
        detachDuty(g, p, d);
        continue;
      }
      d.flightIds = keep;
      syncDuty(g, d, p);
      if (crewCount(p) > 0) {
        queueDuty(g, d);
        const moved = new Set<string>();
        retimeTickets(g, p, d, moved);
        if (moved.size) later.push([p, moved]);
      }
    }
    if (!pChanged) continue;
    changed = true;
    // The crew's next trips are re-checked too: a later release eats their rest, a dropped leg leaves them elsewhere.
    if (crewCount(p) > 0) later.push([p, new Set(p.slots.filter((x) => x.crewId).map((x) => x.crewId!))]);
    if (!p.dutyIds.length) {
      dissolve(g, p);
      continue;
    }
    for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
    setFlightsCrew(g, p);
    touchCrew(g);
    if (crewCount(p) > 0 && recheckPairing(g, p).level === 'illegal' && inHorizon(g, p.start)) reroster = true;
    if (p.slots.some((s) => !s.crewId) && inHorizon(g, p.start)) reroster = true;
  }
  touchCrew(g);
  for (const [p, ids] of later) recheckLater(g, ids, p);
  // Flights new to this aircraft (or dropped from a duty) still to fly.
  const own = new Set<string>();
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) for (const did of p.dutyIds) for (const fid of g.duties[did]?.flightIds ?? []) own.add(fid);
  const free = flightsOf(g, aircraftId).some((f) => f.status === 'scheduled' && f.aircraftId === aircraftId && f.std >= g.now && !own.has(f.id));
  if (!reroster && !free && !changed) return;
  if (g.company.policies.autoRoster && (reroster || free)) rerosterFrom(g, aircraftId, Math.max(g.now, t));
  else if (free) planAircraft(g, aircraftId, g.now);
}

/**
 * Re-plans an aircraft from t: duties that broke their FDP limit are re-cut (tours and single-duty trips),
 * crew who became illegal are freed, then the auto-roster refills (crew already at the station score best).
 */
export function rerosterFrom(g: GameState, aircraftId: string, t: Minute): RosterResult {
  for (const p of [...(crewIx(g).byAircraft.get(aircraftId) ?? [])]) {
    if (!g.pairings[p.id] || p.status === 'done' || p.status === 'broken' || p.end < t) continue;
    if (p.tour || p.dutyIds.length === 1) {
      for (const d of openDuties(g, p)) {
        if (d.legality === 'illegal' && d.report > g.now && d.report >= t && !d.discretion) detachDuty(g, p, d);
      }
      if (!p.dutyIds.length) {
        dissolve(g, p);
        continue;
      }
      if (!openDuties(g, p).length) continue;
      for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
    }
    if (crewCount(p) === 0) continue;
    const firstOpen = openDuties(g, p)[0];
    if (!firstOpen) {
      recheckPairing(g, p);
      continue;
    }
    // Under way (the first open duty has reported): its crew stay on it (the gate check guards that duty).
    const under = firstOpen.report <= g.now;
    if (under && !p.tour && g.flights[firstOpen.flightIds[0]]?.status === 'scheduled') {
      // Reported but not yet off blocks: crew who are not at the departure airport are replaced.
      for (const s of [...p.slots]) {
        const c = s.crewId && !s.locked ? g.crew[s.crewId] : undefined;
        if (!c) continue;
        const plan = planCrew(g, c, p, segsOf(g, c, p.id), true);
        if (plan.issues.some((i) => i.code === 'location' && i.level === 'illegal' && i.dutyId === firstOpen.id)) releaseCrew(g, p, c.id);
      }
      setFlightsCrew(g, p);
    }
    // Manual (locked) assignments survive the re-plan; they stay flagged on the pairing.
    // Crew who only need new tickets are re-ticketed rather than replaced. Crew who can't fly a later duty
    // keep the earlier ones: the trip is split there and only the later part is re-crewed.
    const rc = recheckPairing(g, p, true);
    const out = rc.illegal.filter((id) => !p.slots.some((s) => s.crewId === id && s.locked) && (under || !(g.crew[id] && retick(g, p, g.crew[id]))));
    const cut = Math.min(...out.map((id) => rc.from.get(id) ?? 0));
    const q = out.length && cut > firstOpen.report && cut < Infinity ? splitPairing(g, p, cut) : null;
    for (const id of out) {
      if (q && (rc.from.get(id) ?? 0) >= cut) releaseCrew(g, q, id);
      else if (!under) releaseCrew(g, p, id);
    }
    setFlightsCrew(g, p);
    if (q) setFlightsCrew(g, q);
  }
  touchCrew(g);
  const res = autoRoster(g, { from: t, aircraftIds: [aircraftId] });
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) if (p.status !== 'done' && p.end >= t && crewCount(p) > 0) recheckPairing(g, p);
  return res;
}

// Crew a split part no longer seats leave its flights and tickets as well.
setReleaseHook(releaseCrew);

// Crewed tours accept a new duty only if every crew member stays legal.
setCrewOkHook((g, p, d) => {
  for (const s of p.slots) {
    if (!s.crewId) continue;
    const c = g.crew[s.crewId];
    if (!c) continue;
    if (otherTrip(g, c, p, d.report, d.release, false)) return false;
    // The tour's own tickets are re-planned around its new ends (retick), so they are left out here.
    const own: Seg[] = [];
    for (const x of openDuties(g, p)) own.push(...dutySegs(g, c, p, x, null, null));
    const segs = mergeSegs(mergeSegs(segsOf(g, c, p.id), own), dutySegs(g, c, p, d, null, null, true));
    if (evalSegs({ ...ctxOf(g, c), slack: BAL.rosterSlack }, segs).some((i) => i.level === 'illegal' && i.code !== 'fdp')) return false;
  }
  return true;
});

// A tour that grew keeps its crew: their tickets are re-planned around the new first/last duty (under way, only
// the tickets home move).
setRetickHook((g, p) => {
  const first = openDuties(g, p)[0];
  if (first && first.report <= g.now) rehome(g, p);
  else {
    for (const s of p.slots) {
      const c = s.crewId ? g.crew[s.crewId] : undefined;
      if (c) retick(g, p, c);
    }
  }
  setFlightsCrew(g, p);
});

// A crewed duty may take on the empty legs that follow it when every crew member stays legal with a new ticket home.
setCrewTrailOkHook((g, p, c) => {
  const duties = openDuties(g, p);
  if (!duties.length) return false;
  const last = duties[duties.length - 1];
  let out: Flight | null = null;
  for (const fid of duties[0].deadheadIds) {
    const f = g.flights[fid];
    if (f && f.status !== 'cancelled' && aboard(f, c.id) && f.sta <= duties[0].report) out = f;
  }
  const home = last.restAt !== c.base ? planHome(last, c.base) : null;
  const own: Seg[] = [];
  for (const d of duties) own.push(...dutySegs(g, c, p, d, d === duties[0] ? out : null, d === last ? home : null, true));
  return !evalSegs({ ...ctxOf(g, c), slack: BAL.rosterSlack }, mergeSegs(segsOf(g, c, p.id), own)).some((i) => i.level === 'illegal' && i.code !== 'fdp');
});

/** A trip under way whose end moved: the crew's tickets home are re-planned from its new last duty (one per group). */
function rehome(g: GameState, p: Pairing): void {
  const duties = openDuties(g, p);
  if (!duties.length) return;
  const last = duties[duties.length - 1];
  const plans = new Map<string, CrewPlan>();
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    for (const d of duties) {
      for (const fid of [...d.deadheadIds]) {
        const f = g.flights[fid];
        if (!f || f.status !== 'scheduled' || f.std <= g.now || f.sta <= duties[0].report || !aboard(f, c.id)) continue;
        if (unboard(g, f, c.id)) d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
      }
    }
    if (last.restAt !== c.base) plans.set(c.id, { level: 'legal', issues: [], out: null, home: planHome(last, c.base), segs: [] });
  }
  buyTickets(g, p, plans, emptyResult());
  touchCrew(g);
}

// ---------- disruption APIs ----------

/** Commander's discretion (B3 crewShort decision): maxFdp +2:00 (+3:00 augmented), crew.discretion++, morale −3. */
export function applyDiscretion(g: GameState, dutyId: string): ActionResult {
  const d = g.duties[dutyId];
  const p = d && g.pairings[d.pairingId];
  if (!d || !p) return { ok: false, error: 'Duty not found' };
  if (d.done) return { ok: false, error: 'Duty already flown' };
  if (d.discretion) return { ok: false, error: 'Discretion already used on this duty' };
  d.discretion = d.augment > 0 ? 180 : 120;
  d.legality = dutyLegality(d);
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    c.discretion++;
    c.morale = Math.max(0, c.morale - 3);
    c.fatigue = Math.min(100, c.fatigue + 10);
  }
  if (p.slots.some((s) => !s.crewId)) fillAll(g, [p], emptyResult());
  recheckPairing(g, p);
  touchCrew(g);
  const lim = d.maxFdp + d.discretion;
  return { ok: true, msg: d.legality === 'illegal' ? 'Discretion is not enough for this duty' : `Commander's discretion: FDP limit ${Math.floor(lim / 60)}:${String(lim % 60).padStart(2, '0')}` };
}

/** Replaces one slot's crew member: the given one, or the best legal candidate (deadhead included). */
export function replaceCrew(g: GameState, pairingId: string, slot: number, crewId?: string): ActionResult<{ crewId: string }> {
  const p = g.pairings[pairingId];
  if (!p || !p.slots[slot]) return { ok: false, error: 'Slot not found' };
  if (crewId) {
    const c = g.crew[crewId];
    if (!c) return { ok: false, error: 'Crew member not found' };
    if (!openDuties(g, p).length) return { ok: false, error: 'Trip already flown' };
    placeCrew(g, p, slot, c);
    return { ok: true, msg: `${c.first} ${c.last} takes the ${p.slots[slot].role} seat`, data: { crewId } };
  }
  const cur = p.slots[slot].crewId;
  if (p.slots[slot].extra) {
    if (cur) releaseCrew(g, p, cur);
    recheckPairing(g, p);
    return { ok: false, error: 'Extra seat removed' };
  }
  if (cur) releaseCrew(g, p, cur);
  fillAll(g, [p], emptyResult(), cur ? new Set([cur]) : undefined);
  const now = p.slots[slot].crewId;
  recheckPairing(g, p);
  touchCrew(g);
  if (!now) return { ok: false, error: 'No legal crew member can reach this duty' };
  const c = g.crew[now];
  return { ok: true, msg: `${c.first} ${c.last} takes the ${p.slots[slot].role} seat`, data: { crewId: now } };
}

/** Takes a crew member off every slot overlapping [from, to) (sickness, leave) and re-rosters those pairings. */
export function removeCrew(g: GameState, crewId: string, from: Minute, to: Minute): RosterResult {
  const res = emptyResult();
  const c = g.crew[crewId];
  if (!c) return res;
  c.blocks ??= [];
  if (!c.blocks.some((b) => b.from <= from && b.to >= to)) c.blocks.push({ from, to, why: 'leave' });
  const hit: Pairing[] = [];
  for (const p of (crewIx(g).pairingsOf.get(crewId) ?? []).filter((x) => x.status !== 'done' && x.status !== 'broken' && x.start < to && x.end > from)) {
    // Duties before `from` keep the crew member: the trip is split and only the later part is re-crewed.
    const q = openDuties(g, p).some((d) => d.report < from) ? splitPairing(g, p, from) : null;
    hit.push(q ?? p);
  }
  for (const p of hit) releaseCrew(g, p, crewId);
  if (c.loc !== c.base) sendHome(g, c, hit[0]);
  fillAll(g, hit, res, new Set([crewId]));
  for (const p of hit) if (g.pairings[p.id]) recheckPairing(g, p);
  res.uncovered = uncoveredOf(g, hit, g.now, Infinity);
  return res;
}

/**
 * Puts crew member c into slot `slot` of p (the current holder is released first): tickets, operating crew on
 * the flights, duty events, legality. No checks: callers validate (rosterActions.ts, replaceCrew).
 */
export function placeCrew(g: GameState, p: Pairing, slot: number, c: CrewMember): CrewPlan {
  const cur = p.slots[slot].crewId;
  if (cur) releaseCrew(g, p, cur);
  const hadCrew = crewCount(p) > 0;
  const plan = planCrew(g, c, p, segsOf(g, c, p.id));
  p.slots[slot].crewId = c.id;
  buyTickets(g, p, new Map([[c.id, plan]]), emptyResult());
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of openDuties(g, p)) queueDuty(g, d);
  touchCrew(g);
  recheckPairing(g, p);
  return plan;
}

// ---------- read APIs ----------

/** A crew member's duties overlapping [from, to), in time order. */
export function rosterOf(g: GameState, crewId: string, from: Minute, to: Minute): Duty[] {
  const out: Duty[] = [];
  for (const p of crewIx(g).pairingsOf.get(crewId) ?? []) {
    if (p.end < from || p.start >= to) continue;
    for (const id of p.dutyIds) {
      const d = g.duties[id];
      if (d && d.release > from && d.report < to) out.push(d);
    }
  }
  return out.sort((a, b) => a.report - b.report);
}

export interface FlightCrewStatus {
  level: 'ok' | 'tight' | 'missing' | 'illegal';
  missing: Role[];
}

/** Crew coverage of a flight (Schedule and map panels colour by this). */
export function flightCrewStatus(g: GameState, flightId: string): FlightCrewStatus {
  const f = g.flights[flightId];
  if (!f || !f.aircraftId || f.kind === 'deadhead' || f.status === 'cancelled') return { level: 'ok', missing: [] };
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) {
    if (f.status !== 'scheduled') return { level: 'ok', missing: [] };
    const ac = g.fleet[f.aircraftId];
    return { level: 'missing', missing: ac ? complement(ac.typeId, ac.cabin.total, { extraCabin: g.company.policies.extraCabin }) : [] };
  }
  const missing = p.slots.filter((s) => !s.crewId).map((s) => s.role);
  if (d.legality === 'illegal') return { level: 'illegal', missing };
  if (missing.length) return { level: 'missing', missing };
  if (p.legality === 'illegal') {
    // A crew member who can't fly a later duty of the trip only warns on the earlier ones (the roster takes them
    // off from that duty); another duty's FDP is that duty's problem. Old saves without the mark: whole trip.
    const from = p.illegalFrom ?? (p.dutyIds.some((id) => g.duties[id]?.legality === 'illegal' && !g.duties[id].done) ? Infinity : -Infinity);
    return { level: d.report >= from ? 'illegal' : 'tight', missing };
  }
  return { level: d.legality === 'tight' || p.legality === 'tight' ? 'tight' : 'ok', missing };
}
