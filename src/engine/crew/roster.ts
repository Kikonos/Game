// Auto-roster, change sync and disruption APIs (B2). DESIGN.md §4.2, §5.3.

import { BAL } from '../core/balance';
import { addDeadhead, deadheadFlights, flightsOf, markFlightsChanged, removeFlights, retimeFlight, touchTickets } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { canFill, complement, typeOf } from '../core/perf';
import { DAY, fmtDateTime, monthKey } from '../core/time';
import type { ActionResult, CrewMember, Duty, Flight, GameState, Legality, Minute, Pairing, Role } from '../core/types';
import { acceptable, crewIds, crewIssuesFor, crewKey, mergeSegs, openDuties, otherTrip, overForAnyone, planCrew, type CrewPlan } from './check';
import { deletePairing, dutyLegality, planAircraft, queueDuty, refreshPairing, setCrewOkHook, setCrewTakeHook, setCrewTrailOkHook, setReleaseHook, setRetickHook, splitPairing, splitUnderWay, syncDuty } from './duties';
import { crewName } from './generate';
import { callIfOnStandby, dropStandby, standbyFor, callFromStandby } from './standby';
import { fitStandby, midnight, monthFloorIssue, offDaysHit, offMovable, offSwappable, takeOffDays, takesPublishedOff, v09Stats as v09StatsOf } from './dayPlan';
import { infoOf } from './outOfHours';
import { lateChange, moraleShock, nextReport } from './morale';
import { cabinFdpCap, DISCRETION, evalSegs, levelOf, LIMITS, minRest, mkSeg, recoveryAnchor, tzDeltaH, worst, type LegalityIssue, type Seg } from './rules';
import { cabinOwnReport, planRest, restCabinN, restLegs, restOf, restPlan } from './restPlan';
import { aboard, aboveEmpty, cabinEarly, block28, crewCount, crewIx, crewRev, requiredEmpty, ctxOf, dhBlock, droppableHome, dutySegs, extCutAt, locAt, noteRiders, outStillFits, passengers, planHome, planOut, posSeg, segsOf, segsTagOf, ticketPrice, touchCrew, typeIdOf, withoutTickets } from './timeline';

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

const SLOT_ORDER: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];

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
  // v0.7.1: a chartered jet already booked for these crew (planCrew used it as their ride out): nothing to buy.
  const booked = (t as Partial<Flight>).id ? g.flights[(t as Partial<Flight>).id!] : undefined;
  if (booked && booked.charter && booked.status === 'scheduled') {
    if (!d.deadheadIds.includes(booked.id)) d.deadheadIds.push(booked.id);
    return booked;
  }
  const ride = t.rideId ? g.flights[t.rideId] : undefined;
  if (ride && ride.status === 'scheduled') {
    ride.riders = [...new Set([...(ride.riders ?? []), ...crewIds])];
    noteRiders(g, ride);
    if (!d.deadheadIds.includes(ride.id)) d.deadheadIds.push(ride.id);
    touchTickets(g);
    return ride;
  }
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(t.from, t.to) * crewIds.length;
  const f = addDeadhead(g, { crewIds, from: t.from, to: t.to, std: t.std, sta: t.sta, cost, contractId: p.contractId });
  leaveAfterTicket(g, crewIds, t);
  if (cost) post(g, 'deadhead', -cost);
  d.deadheadIds.push(f.id);
  res.deadheads++;
  res.cost += cost;
  return f;
}

/** Local days a block covers (a day counts when the block holds 6 h of it: dayPlan's blockOn). */
function blockDays(base: string, from: Minute, to: Minute): number {
  let n = 0;
  for (let k = Math.floor(from / DAY) - 1; k <= Math.floor(to / DAY) + 1; k++) {
    const a = midnight(base, k);
    if (from < a + DAY - 6 * 60 && to > a + 6 * 60) n++;
  }
  return n;
}

/**
 * Crew-planning round (26 Oct 2026): annual leave (or a course) starts once the crew member is home. A ticket home
 * that lands after the start of a leave not yet begun (the rest after a late landing, or the 36 h recovery at the hotel,
 * comes first: positioning is duty) moves the start of that leave to the landing, the leave keeping its days (seeds
 * 2-5 and the player's save: crew flew home on a deadhead on the first morning of their leave).
 */
export function leaveAfterTicket(g: GameState, crewIds: Iterable<string>, t: { std: Minute; sta: Minute; to: string }): void {
  for (const id of crewIds) {
    const c = g.crew[id];
    // A leave not begun (or beginning this minute) that a ticket home lands inside. (A ticket on to a trip across the
    // start of a leave is the roster's to refuse, never a reason to move the leave.)
    const hit = (b: NonNullable<CrewMember['blocks']>[number]) =>
      (b.why === 'leave' || b.why === 'training') && b.from >= g.now && b.from < t.sta && b.to > t.sta && t.to === c.base;
    if (!c?.blocks?.some(hit)) continue;
    c.blocks = c.blocks.map((b) => {
      if (!hit(b)) return b;
      // Leftover-breach round: the block a resignation leaves behind (from the last day on) is the notice itself: it
      // ends when they land home (invariant seed 5: crew on notice, left at an outstation, flew home hours after it).
      if (c.notice && b.why === 'leave' && b.from === c.notice.leaves) {
        c.notice = { ...c.notice, leaves: t.sta };
        return { ...b, from: t.sta };
      }
      // (A course keeps its dates: only its start waits for them.)
      const days = blockDays(c.base, b.from, b.to);
      const x = { ...b, from: t.sta };
      if (b.why === 'leave') while (blockDays(c.base, x.from, x.to) < days) x.to += DAY;
      return x;
    });
    touchCrew(g);
  }
}

/** Every ticket still to fly, as above (a ticket moved by any other path; daily, after the stranded crew go home). */
export function leaveAfterTickets(g: GameState): void {
  for (const f of deadheadFlights(g)) if (f.status === 'scheduled' && f.crewIds.length && f.sta > g.now) leaveAfterTicket(g, f.crewIds, f);
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
    else touchTickets(g);
    return !f.crewIds.length;
  }
  f.riders = (f.riders ?? []).filter((x) => x !== crewId);
  if (!f.riders.length) delete f.riders;
  touchTickets(g);
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

/** v0.6: the crew member whose own absence (sickness, course, leaving) is being rostered around: no late-change hit. */
let ownRelease: string | null = null;

/** Takes a crew member off a pairing: slot, flights still to fly and unused tickets (cancelled when empty). */
export function releaseCrew(g: GameState, p: Pairing, crewId: string): void {
  if (crewId !== ownRelease && p.slots.some((s) => s.crewId === crewId)) lateChange(g, crewId, nextReport(g, p));
  for (const s of p.slots) {
    if (s.crewId !== crewId) continue;
    s.crewId = null;
    delete s.locked;
    delete s.from;
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
      else if (f.from === d.restAt && f.std - d.release >= 600) {
        // v0.5.2: a ticket home after rest (planHome) leaves once the rest is over again: a later release
        // would otherwise put its check-in inside the rest and the whole crew off the duty at the gate.
        const rest = minRest({ dutyMin: d.release - d.report + cabinEarly(g, p), atHome: false, augmented: d.augment > 0, tzShift: tzDeltaH(f.to, f.from, d.release), extended: !!d.ext });
        const need = Math.ceil((d.release + rest + BAL.deadheadCheckIn) / 60) * 60;
        if (f.std < need) std = need;
      }
    } else if (f.to === dep && f.std > g.now && (f.sta > d.report || !outStillFits(g, p, d, f.from, f.std, f.block))) {
      // Too late for the report, or (v0.11 debug: the duty moved later) so early that the wait at the gate takes the
      // ticket and the duty past one FDP: re-planned.
      const t = planOut(g, p, d, f.from);
      // (A re-plan for the FDP only when the new ticket fits: else the booked one stays and the 2 h check decides.)
      if (!t.rideId && t.std - BAL.deadheadCheckIn >= g.now && (f.sta > d.report || outStillFits(g, p, d, f.from, t.std, t.sta - t.std))) std = t.std;
    }
    if (std === f.std) continue;
    retimeFlight(g, f, std, std + f.block);
    leaveAfterTicket(g, f.crewIds, f);
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
export function recheckNext(g: GameState, crewIds: string[], also?: Pairing): void {
  const acs = new Set<string>();
  for (const id of crewIds) {
    let next: Pairing | null = null;
    for (const q of crewIx(g).pairingsOf.get(id) ?? []) {
      if (q.status !== 'planned' || !q.aircraftId || q.start < g.now) continue;
      if (!next || q.start < next.start) next = q;
    }
    if (next && recheckPairing(g, next).level === 'illegal' && inHorizon(g, next.start)) acs.add(next.aircraftId!);
  }
  // v0.10.1 the trip the missed ticket was taking them to, even one already started or reporting (BLU511): its first
  // leg still to fly is re-crewed or re-ticketed now, not found out at the gate.
  const d0 = also ? openDuties(g, also)[0] : undefined;
  if (also?.aircraftId && d0 && g.flights[d0.flightIds[0]]?.status === 'scheduled' && recheckPairing(g, also).level === 'illegal') acs.add(also.aircraftId);
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
function sendHome(g: GameState, c: CrewMember, p?: Pairing, force = false): void {
  if (c.loc === c.base) return;
  const ix = crewIx(g);
  // A ticket from where they are (or one already under way) takes them on.
  if (!force && (ix.tickets.get(c.id) ?? []).some((f) => f.status === 'scheduled' && (f.from === c.loc || f.std <= g.now))) return;
  if (!force && (ix.pairingsOf.get(c.id) ?? []).some((x) => x.status === 'active' || (x.status === 'planned' && x.start < g.now + 3 * DAY))) return;
  const blk = dhBlock(c.loc, c.base);
  const segs = segsOf(g, c);
  const ctx = ctxOf(g, c);
  const ci = BAL.deadheadCheckIn;
  // Checked in once rested: after the last duty (restUntil) and (v0.11 debug) after a standby already begun, whose
  // rest restUntil does not hold (a hotel standby until 15:00 had its crew checking in for the ticket home 9 h later).
  let ready = Math.max(g.now, c.restUntil);
  for (const x of segs) if (x.kind !== 'log' && x.start < g.now) ready = Math.max(ready, x.end + x.rest);
  let std = Math.ceil((ready + ci) / 60) * 60;
  // Crew-planning round: positioning is duty (ORO.FTL.210): a ticket home that would run past the 7, 14 or 28-day duty
  // limit waits at the hotel until it fits. (Bot seed 5: an FO sent home before his leave after six long days in Riyadh;
  // the 01:00 flight home made it 65:31 of duty in 7 days.)
  const cumOk = (t: Minute) =>
    !evalSegs(ctx, [...segs.filter((x) => x.start < t - ci), posSeg({ from: c.loc, to: c.base, std: t, sta: t + blk }, c, true)])
      .some((i) => i.level === 'illegal' && (i.code === 'duty7d' || i.code === 'duty14d' || i.code === 'duty28d'));
  if (!cumOk(std)) {
    for (let t = std + 60; t < std + 4 * DAY; t += 60) {
      if (!cumOk(t)) continue;
      std = t;
      break;
    }
  }
  // v0.9 fix: a ticket home landing past the 168 h since the last recovery rest (positioning is duty) waits for that
  // recovery at the hotel first (36 h with 2 local nights, 60 h after 4 disruptive duties: ORO.FTL.235(d)).
  if (std + blk > recoveryAnchor(ctx, segs, std - ci) + LIMITS.recoveryEvery) {
    for (let t = std; t < std + 4 * DAY; t += 60) {
      if (recoveryAnchor(ctx, segs, t - ci) < t - ci) continue;
      std = t;
      break;
    }
  }
  const cost = clientPaysCrewTravel(g, p) ? 0 : ticketPrice(c.loc, c.base);
  const contractId = p?.contractId ?? null;
  // Crew going home together share one booking (one flight per group, DESIGN §3.5).
  const group = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.from === c.loc && f.to === c.base && f.std === std && f.contractId === contractId && !ix.ticketDuty.has(f.id));
  if (group) {
    group.crewIds.push(c.id);
    group.cost = (group.cost ?? 0) + cost;
    touchTickets(g);
  } else addDeadhead(g, { crewIds: [c.id], from: c.loc, to: c.base, std, sta: std + blk, cost, contractId });
  leaveAfterTicket(g, [c.id], { std, sta: std + blk, to: c.base });
  if (cost) post(g, 'deadhead', -cost);
  touchCrew(g);
  // Leftover-breach round: standby planned where the ticket takes them away from (a hotel standby at the outstation),
  // or too soon after it for the rest it needs, is re-fitted: dropped, or kept as reserve when that is legal. Invariant
  // seed 1: cabin crew sent home MAD → LIS at 02:00 kept their hotel standby at Madrid from 04:00 (0:50 after landing).
  fitStandby(g, [c.id]);
}

/**
 * v0.9.1 (§R.19): a stand-alone ticket (no duty holds it: a sub-charter or cancellation took the trip's last duty, the
 * crew keep their ticket home) counts on the 168 h like any positioning, and nothing re-checked it: seed 2's crew sat
 * 23 h at the hotel after their last duty and the ticket home landed 171 h after their last recovery rest. One that
 * would land past it (with RECOVERY_KEEP_POS in hand) is moved: to the first seat once the crew's rest is over when that
 * lands in time, else after the recovery rest at the hotel (as sendHome plans one). `only`: these crew members.
 */
export function rebookLooseTickets(g: GameState, only?: Set<string>): void {
  const ci = BAL.deadheadCheckIn;
  const ix = crewIx(g);
  for (const f of [...deadheadFlights(g)]) {
    if (f.status !== 'scheduled' || f.std - ci <= g.now || ix.ticketDuty.has(f.id)) continue;
    const moves = new Map<number, string[]>();
    for (const cid of f.crewIds) {
      const c = g.crew[cid];
      if (!c || (only && !only.has(cid))) continue;
      // Standby not started yet gives way (it is re-fitted after the rebooking).
      const segs = segsOf(g, c).filter((x) => x.ticketId !== f.id && !(x.kind === 'sby' && x.start > g.now));
      const ctx = ctxOf(g, c);
      const blk = f.sta - f.std;
      const fits = (std: Minute) => std + blk + RECOVERY_KEEP_POS <= recoveryAnchor(ctx, segs, std - ci) + LIMITS.recoveryEvery;
      if (fits(f.std)) continue;
      let std = Math.ceil((Math.max(g.now + ci, c.restUntil) + 60) / 60) * 60;
      if (std >= f.std || !fits(std)) {
        std = 0;
        for (let t = f.std; t < f.std + 4 * DAY; t += 60) {
          if (recoveryAnchor(ctx, segs, t - ci) < t - ci) continue;
          std = t;
          break;
        }
      }
      if (std) moves.set(std, [...(moves.get(std) ?? []), cid]);
    }
    for (const [std, ids] of moves) {
      const { from, to, contractId } = f;
      const blk = f.sta - f.std;
      const each = (f.cost ?? 0) / Math.max(1, f.crewIds.length);
      for (const cid of ids) unboard(g, f, cid);
      addDeadhead(g, { crewIds: ids, from, to, std, sta: std + blk, cost: Math.round(each * ids.length), contractId });
      leaveAfterTicket(g, ids, { std, sta: std + blk, to });
      if (each) post(g, 'deadhead', -Math.round(each * ids.length));
      touchCrew(g);
      fitStandby(g, ids);
    }
  }
}
/** v0.9.1: what a moved ticket keeps in hand on the 168 h (rules.ts RECOVERY_KEEP: a delay on the day). */
const RECOVERY_KEEP_POS = 60;

/**
 * Daily: crewed trips and tours with a duty reporting in the next week are re-checked (a ticket moved, a crew
 * member stranded elsewhere, a recovery or rest a delay ate); broken ones are re-rostered while there is still
 * time to position someone (a tour under way is split before the duty its crew can't fly).
 */
export function recheckSoon(g: GameState): void {
  rebookLooseTickets(g);
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
  rebookHomeForRecovery(g, p);
  const acs = new Set<string>();
  const ids = p.slots.filter((s) => s.crewId).map((s) => s.crewId!);
  // Crew-planning round: released away from base with a leave starting within two days and nothing taking them home
  // first: home now, after their rest (the leave then starts when they land). Invariant seed 1: a duty ended in
  // Düsseldorf at 16:30, leave began at 23:00 with the captain still there, and he flew home on its second day.
  for (const id of ids) {
    const c = g.crew[id];
    if (c && c.loc !== c.base && leaveAway(g, c)) {
      sendHome(g, c, p, true);
      recheckNext(g, [c.id]);
    }
  }
  rebookLooseTickets(g, new Set(ids));
  if (openDuties(g, p).length && p.aircraftId && recheckPairing(g, p).level === 'illegal' && p.illegalFrom !== undefined) acs.add(p.aircraftId);
  for (const ac of laterBroken(g, ids, p)) acs.add(ac);
  if (g.company.policies.autoRoster) for (const ac of acs) rerosterFrom(g, ac, g.now);
}

/**
 * v0.9 round 3: a duty released late can leave the ticket after it past the 168 h: the free time before the ticket is
 * no longer a recovery rest (60 h after 4 disruptive duties: 59 h 40 m after a 70 min delay, ORO.FTL.235(d)), and a
 * loose ticket is no duty's to re-plan, so it was flown (bot seeds 7 and 9: 217–218 h between recovery rests). The
 * crew aboard wait for that recovery at the hotel and the ticket is rebooked after it, as sendHome plans one.
 */
function rebookHomeForRecovery(g: GameState, p: Pairing): void {
  const ci = BAL.deadheadCheckIn;
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d?.done || d.release < g.now - 12 * 60) continue;
    for (const fid of [...d.deadheadIds]) {
      const f = g.flights[fid];
      if (!f || f.kind !== 'deadhead' || f.status !== 'scheduled' || f.std < d.release || f.std - ci <= g.now) continue;
      const late: string[] = [];
      let std = f.std;
      for (const cid of f.crewIds) {
        const c = g.crew[cid];
        if (!c) continue;
        // Standby not started yet gives way (it is re-fitted after the rebooking).
        const segs = segsOf(g, c).filter((x) => x.ticketId !== f.id && !(x.kind === 'sby' && x.start > g.now));
        const ctx = ctxOf(g, c);
        if (f.sta <= recoveryAnchor(ctx, segs, f.std - ci) + LIMITS.recoveryEvery) continue;
        for (let t = f.std; t < f.std + 4 * DAY; t += 60) {
          if (recoveryAnchor(ctx, segs, t - ci) < t - ci) continue;
          std = Math.max(std, t);
          late.push(cid);
          break;
        }
      }
      if (!late.length || std === f.std) continue;
      for (const cid of late) unboard(g, f, cid);
      if (!g.flights[fid]) d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
      buyTicket(g, p, d, late, { from: f.from, to: f.to, std, sta: std + (f.sta - f.std) }, emptyResult());
      touchCrew(g);
      fitStandby(g, late);
    }
  }
}

/** A ticket checking in at most this long after release takes the crew straight on (part of the duty, no rest). */
const STRAIGHT_ON = 3 * 60;

/**
 * Crew-planning round (26 Oct 2026): the duty was released later than planned (its last leg landed late). Its tickets
 * after it are re-read against the real release, as crew control would: a ticket straight on that the crew can no
 * longer check in for, or one booked for after the rest that now leaves before that rest is over (positioning is
 * duty: ORO.FTL.235 rest comes first), is rebooked onto the first seat that works: straight on when the duty still
 * allows it (planHome), else once the rest is over. Commander's discretion never shortens that rest. (Player's save:
 * crew landed late at Rhodes and their ticket home left 9:16 later, 10:00 due; seed 1, 9:19 at Riga.)
 * Called at release, before the duty is logged, so the log and the rest read the ticket the crew will really take.
 */
export function rebookAfterLateRelease(g: GameState, p: Pairing, d: Duty): void {
  const ci = BAL.deadheadCheckIn;
  for (const fid of [...d.deadheadIds]) {
    const f = g.flights[fid];
    // (One that left already, its crew still on duty, was never boarded: rebooked too.)
    if (!f || f.kind !== 'deadhead' || f.status !== 'scheduled' || f.std <= d.report || f.from !== d.restAt) continue;
    const wait = f.std - ci - d.release;
    if (wait >= 0 && wait <= STRAIGHT_ON) continue;
    const ends = new Map<string, Minute>();
    for (const cid of f.crewIds) {
      const c = g.crew[cid];
      if (!c) continue;
      let out: Flight | null = null;
      for (const oid of d.deadheadIds) {
        const o = g.flights[oid];
        if (o && o.status !== 'cancelled' && o.sta <= d.report && aboard(o, cid)) out = o;
      }
      const seg = dutySegs(g, c, p, d, out, null).find((x) => x.kind === 'duty');
      // (A planned extension's rest: +2 h after when the crew member took +2 h before, as the release logs it.)
      const end = Math.max(c.restUntil, seg ? seg.end + seg.rest - (d.ext ? extCutAt(c, seg.start) : 0) : d.release);
      if (wait < 0 || f.std - ci < end) ends.set(cid, end);
    }
    if (!ends.size) continue;
    const blk = f.sta - f.std;
    // Straight on again only for crew who missed a ticket straight on; one booked for after the rest stays after it.
    const t = wait < 0 ? planHome(d, f.to, cabinEarly(g, p, d)) : null;
    const straight = t && t.std - ci - d.release <= STRAIGHT_ON ? t.std : null;
    const groups = new Map<Minute, string[]>();
    for (const [cid, end] of ends) {
      const std = straight ?? Math.ceil((end + ci) / 60) * 60;
      groups.set(std, [...(groups.get(std) ?? []), cid]);
    }
    for (const [std, ids] of groups) {
      if (std === f.std) continue;
      for (const cid of ids) unboard(g, f, cid);
      if (!g.flights[fid]) d.deadheadIds = d.deadheadIds.filter((x) => x !== fid);
      buyTicket(g, p, d, ids, { from: f.from, to: f.to, std, sta: std + blk }, emptyResult());
      fitStandby(g, ids);
    }
    touchCrew(g);
  }
}

/** Longest stay at an outstation between two trips that beats flying home and straight back out. */
const STAY_MAX = 30 * 60;

/**
 * Daily (v0.5.2): crew holding a ticket home from X and a ticket straight back out to X for their next trip,
 * reporting within STAY_MAX of the release, stay at the hotel instead (DESIGN §5.3): both tickets are dropped
 * (bought ones are sunk) when the hotel nights cost less than the two tickets and the timeline stays as legal.
 * Not around a tour (its crews rotate through base). Returns the crew who stayed.
 */
export function stayOn(g: GameState): string[] {
  const night = BAL.hotelPerNight[g.company.policies.hotelTier] ?? BAL.hotelPerNight[4];
  const live = (id: string | undefined) => {
    const f = id ? g.flights[id] : undefined;
    return !!f && f.kind === 'deadhead' && f.status === 'scheduled' && f.std - BAL.deadheadCheckIn > g.now;
  };
  const tour = (x: Seg | undefined) => !!x?.dutyId && !!g.pairings[g.duties[x.dutyId]?.pairingId ?? '']?.tour;
  const ticketed = new Set<string>();
  for (const f of deadheadFlights(g)) if (live(f.id)) for (const id of f.crewIds) ticketed.add(id);
  const stayed: string[] = [];
  for (const c of Object.values(g.crew)) {
    if (!ticketed.has(c.id)) continue;
    const all = segsOf(g, c);
    const segs = all.filter((x) => x.kind !== 'log');
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i];
      // The ticket home: merged into the duty, or a positioning seg right after it.
      let home: string | undefined;
      let from = 0;
      let st = '';
      let prev: Seg | undefined;
      if (a.kind === 'duty' && a.home?.id && a.at === c.base) [home, from, st, prev] = [a.home.id, a.home.release, a.home.from, a];
      else if (a.kind === 'pos' && a.ticketId && a.at === c.base && segs[i - 1]?.kind === 'duty') [home, from, st, prev] = [a.ticketId, segs[i - 1].end, a.from ?? '', segs[i - 1]];
      if (!home || !live(home) || !st || st === c.base || tour(prev)) continue;
      // The ticket back out: merged into the next duty, or a positioning seg right before it.
      const b = segs[i + 1];
      let out: string | undefined;
      let to = 0;
      let next: Seg | undefined;
      if (b?.kind === 'duty' && b.out?.id && b.out.to === st) [out, to, next] = [b.out.id, b.out.start, b];
      else if (b?.kind === 'pos' && b.ticketId && b.at === st && segs[i + 2]?.kind === 'duty') [out, to, next] = [b.ticketId, segs[i + 2].start, segs[i + 2]];
      if (!out || !live(out) || tour(next) || to <= from || to - from > STAY_MAX) continue;
      if (Math.ceil((to - from) / DAY) * night >= ticketPrice(st, c.base) + ticketPrice(c.base, st)) continue;
      const ctx = ctxOf(g, c);
      const bad = (s: Seg[]) => evalSegs(ctx, s).filter((x) => x.level === 'illegal').length;
      if (bad(withoutTickets(all, [home, out])) > bad(all)) continue;
      dropPlanned(g, c.id, [home, out]);
      stayed.push(c.id);
      break;
    }
  }
  if (stayed.length) touchCrew(g);
  return stayed;
}

/** Daily: crew left away from base with no trip ahead and no ticket go home (after a split or a dissolved trip). */
export function sendStrandedHome(g: GameState): void {
  const away = Object.values(g.crew).filter((c) => c.loc !== c.base && c.status !== 'onDuty');
  if (!away.length) return;
  const riding = new Set<string>();
  for (const f of Object.values(g.flights)) if (f.status === 'enroute') for (const id of passengers(f)) riding.add(id);
  for (const c of away) {
    if (riding.has(c.id)) continue;
    if (leaveAway(g, c)) {
      // Crew-planning round: leave starts at home. Crew left at an outstation with no work before their leave (a trip
      // that ended there, a later trip from there planned across the leave) go home first; the trip after the leave
      // is re-planned from home. (Seed 3: an FO sat out a ten-day leave in Hamburg and flew home in the middle of it.)
      sendHome(g, c, undefined, true);
      recheckNext(g, [c.id]);
    } else sendHome(g, c);
  }
}

/**
 * Leftover-breach round, hourly: crew away whose leave (or course, or last day) starts within the next 3 hours with no
 * work before it and no way home yet go home now (the leave then starts when they land). The daily run's check can come
 * too early (a duty before the leave, re-planned away later that night) and the next one too late.
 */
export function homeBeforeLeave(g: GameState): void {
  let riding: Set<string> | null = null;
  for (const c of Object.values(g.crew)) {
    if (c.loc === c.base || c.status === 'onDuty' || !c.blocks?.some((b) => (b.why === 'leave' || b.why === 'training') && b.from >= g.now && b.from <= g.now + 3 * 60)) continue;
    if (!riding) {
      riding = new Set<string>();
      for (const f of Object.values(g.flights)) if (f.status === 'enroute') for (const id of passengers(f)) riding.add(id);
    }
    if (riding.has(c.id) || !leaveAway(g, c)) continue;
    sendHome(g, c, undefined, true);
    recheckNext(g, [c.id]);
  }
}

/**
 * Away from base, a leave (or a course) starting within two days, no work before it and no ticket home landing in time.
 * Leftover-breach round: a notice ending within two days counts too (home by the last day; its block is a 'leave'); and
 * a leave starting this very minute (the run at its start: the leave then starts on landing). Invariant seed 1: the day
 * before, a duty at Prague held a cabin crew member there; re-planned away at 02:30, the next run found her leave begun
 * and a ticket out of Prague for a trip after it kept her there for 5 days of it.
 */
function leaveAway(g: GameState, c: CrewMember): boolean {
  const b = c.blocks?.find((x) => (x.why === 'leave' || x.why === 'training') && x.from >= g.now && x.from < g.now + 2 * DAY);
  if (!b) return false;
  for (const x of segsOf(g, c)) {
    if (x.kind === 'log' || x.end <= g.now || x.start >= b.from) continue;
    if (x.kind === 'duty' || (x.kind === 'pos' && x.at === c.base)) return false;
  }
  return true;
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
  // Leftover-breach round: the trip's last open duty gone with every other one flown: the trip is over (as when its last
  // duty releases), so leaving the company later never finds it 'active' with them in a seat (widebody bot seed 1: a
  // tour's last duty re-planned away after its last release kept the tour active and its seats held a week on).
  if (p.status === 'active' && p.dutyIds.length && p.dutyIds.every((id) => !g.duties[id] || g.duties[id].done)) p.status = 'done';
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
export function recheckPairing(g: GameState, p: Pairing, priorOnly = false): { level: Legality; illegal: string[]; from: Map<string, Minute>; issue: Map<string, LegalityIssue> } {
  let level: Legality = 'legal';
  const open = openDuties(g, p);
  for (const d of open) level = worst(level, d.legality);
  const illegal: string[] = [];
  /** Per illegal crew member: report of the first duty they can't fly, and the issue there. */
  const from = new Map<string, Minute>();
  const issue = new Map<string, LegalityIssue>();
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
      for (const i of mine) {
        if (i.level !== 'illegal') continue;
        const r = g.duties[i.dutyId!]?.report ?? open[0]?.report ?? 0;
        if (r < t || !issue.has(c.id)) issue.set(c.id, i);
        t = Math.min(t, r);
      }
      from.set(c.id, t);
      illegal.push(c.id);
      first = Math.min(first, t);
    }
    level = worst(level, crewLevel);
  }
  p.legality = level;
  if (first < Infinity) p.illegalFrom = first;
  else delete p.illegalFrom;
  return { level, illegal, from, issue };
}

/**
 * v0.9 crew out of hours (UPDATE-0.9.md §T.2): an empty seat of p remembers who reached which limit until it is
 * refilled (fillPairing clears it). Nothing for an issue that is no limit (place, rating, status).
 */
function markOoh(g: GameState, p: Pairing, crewId: string, issue: LegalityIssue): void {
  const x = infoOf(g, crewId, issue);
  const role = g.crew[crewId]?.role;
  const slot = p.slots.find((z) => !z.crewId && !z.above && !z.ooh && z.role === role) ?? p.slots.find((z) => !z.crewId && !z.above && !z.ooh);
  if (slot && x) slot.ooh = { crewId, limit: x.limit, over: x.overMin, at: g.now };
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

/** Longest report slip for a crew still resting (ops move the legs; beyond it the seat is refilled or left short). */
const REST_SLIP = 3 * 60;

let restDelayHook: ((g: GameState, f: Flight, std: Minute) => boolean) | null = null;
/** Ops registers how a duty's first leg is delayed for crew rest (ops/flights.ts delayChain). */
export function setRestDelayHook(f: (g: GameState, f: Flight, std: Minute) => boolean): void {
  restDelayHook = f;
}

let closedWaitHook: ((g: GameState, flightId: string) => boolean) | null = null;
/**
 * v0.9.1 ops registers (ops/flights.ts): before the crew are called in, a first leg out of (or into) an airport still
 * closed at its departure moves to the reopening; true when it moved (the duty re-forms and re-queues its report).
 */
export function setClosedWaitHook(f: (g: GameState, flightId: string) => boolean): void {
  closedWaitHook = f;
}
export const closedWait = (g: GameState, flightId: string): boolean => !!closedWaitHook && closedWaitHook(g, flightId);

/**
 * A duty not yet reported whose full crew is held up only by rest still running (restUntil past the report, by
 * at most REST_SLIP): its first leg is delayed so the report falls when the rest ends, and the duty re-measured.
 * True when the legs moved.
 */
function slipForRest(g: GameState, d: Duty, ids: string[]): boolean {
  const p = g.pairings[d.pairingId];
  const f = g.flights[d.flightIds[0]];
  if (!restDelayHook || !p?.aircraftId || d.report <= g.now || !f || f.status !== 'scheduled' || requiredEmpty(p)) return false;
  let end = 0;
  for (const id of ids) {
    const c = g.crew[id];
    if (!c || c.status === 'onDuty' || c.restUntil <= d.report) return false;
    end = Math.max(end, c.restUntil);
  }
  const slip = Math.ceil((end - d.report) / 5) * 5;
  if (slip > REST_SLIP || !restDelayHook(g, f, f.std + slip)) return false;
  onFlightsChanged(g, p.aircraftId, g.now);
  return true;
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
  // v0.7.3 an augmented duty whose rest plan no longer works (the aircraft's facilities changed) is re-planned at the
  // next settle (onFlightsChanged → syncDuty → pickPlan), never flown as planned.
  const p00 = g.pairings[d.pairingId];
  if (d.augment > 0 && !d.legacyRest && d.report > g.now && p00?.aircraftId && restPlan(g, d.id)?.ok === false) {
    d.flightsEv = -1;
    markFlightsChanged(g, p00.aircraftId, d.report);
  }
  const found = crewIssuesFor(g, d);
  if (!found.length) return true;
  const p0 = g.pairings[d.pairingId];
  const acs = laterBroken(g, found.map((b) => b.crewId), p0);
  if (p0.aircraftId) acs.add(p0.aircraftId);
  for (const ac of acs) rerosterFrom(g, ac, g.now);
  d = g.duties[dutyId];
  let short = 0;
  if (d && !d.done && g.pairings[d.pairingId]) {
    let bad = crewIssuesFor(g, d);
    // v0.5.2: nobody to swap, but the crew are only short of rest (a late finish the day before): the duty
    // reports when their rest ends (its legs move up to REST_SLIP later) rather than flying uncovered.
    if (bad.length && slipForRest(g, d, bad.map((b) => b.crewId))) {
      d = g.duties[dutyId];
      bad = d && !d.done ? crewIssuesFor(g, d) : [];
    }
    if (d && bad.length) {
      const p = g.pairings[d.pairingId];
      const q = openDuties(g, p)[0] === d ? p : splitPairing(g, p, d.report) ?? p;
      for (const b of bad) releaseCrew(g, q, b.crewId);
      if (q !== p) setFlightsCrew(g, p);
      fillAll(g, [q], emptyResult(), new Set(bad.map((b) => b.crewId)));
      setFlightsCrew(g, q);
      recheckPairing(g, q);
    }
    short = g.pairings[d.pairingId]?.slots.filter((s) => !s.crewId && !s.above).length ?? 0;
    // v0.9 crew out of hours (UPDATE-0.9.md §T.2): an empty seat remembers who reached which limit until refilled.
    const q = g.pairings[d.pairingId];
    if (q && short) {
      for (const b of found) if (!q.slots.some((x) => x.crewId === b.crewId)) markOoh(g, q, b.crewId, b.issue);
    }
  }
  const off = found.filter((b) => !(d && g.pairings[d.pairingId]?.slots.some((s) => s.crewId === b.crewId)));
  // v0.9 round 4 (§T): taken off for a legal limit is crew out of hours (its own kind, icon and pause), not a shortage.
  const hours = off.some((b) => infoOf(g, b.crewId, b.issue) !== null);
  if (off.length) {
    const fid = (d ?? g.duties[dutyId])?.flightIds[0];
    const f = fid ? g.flights[fid] : undefined;
    const what = f ? `${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}` : 'the duty';
    const red = !!f && short > 0 && hours && f.std - g.now <= BAL.crewControl.redH * 60;
    pushMessage(g, {
      tone: short ? 'warn' : 'info', cat: 'crew', ...(red ? { topic: 'crewHours' as const } : {}),
      // The ladder's own red message carries the alarm; this one chimes as routine news.
      cue: 'message',
      title: `${off.length === 1 ? 'Crew member' : `${off.length} crew`} taken off ${f?.no ?? 'a duty'}`,
      body: `${off.map((b) => crewName(g.crew[b.crewId])).join(', ')}: ${off[0].issue.text}. ${short ? `No legal replacement for ${short} seat${short > 1 ? 's' : ''} on ${what} yet.` : `Replaced on ${what}.`}`,
      ref: f ? { kind: 'flight', id: f.id } : undefined,
      ...(short && f ? { problem: { kind: hours ? 'crewHours' as const : 'crewShort' as const, ref: { kind: 'flight' as const, id: f.id } }, hurt: { money: 0, pax: f.pax ?? 0, delayMin: 0, level: (f.pax ?? 0) >= BAL.crewControl.hurtLowPax ? 'high' as const : 'low' as const } } : {}),
    });
  }
  if (short) requestPause(hours ? 'crewHours' : 'crewShortage');
  touchCrew(g);
  return !d || (!short && !crewIssuesFor(g, d).length);
}

// ---------- auto-roster ----------

const copySeg = (x: Seg): Seg => mkSeg({
  kind: x.kind, start: x.start, end: x.end, fdp: x.fdp, maxFdp: x.maxFdp, block: x.block, sectors: x.sectors, aug: x.aug,
  disruptive: x.disruptive, rest: x.rest, at: x.at, from: x.from, dutyId: x.dutyId, fresh: false, home: x.home && { ...x.home }, out: x.out && { ...x.out },
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
    // v0.7.3 home standby is there to be used: the legality check reads it (a call-out, or replaced by the duty).
    if (s.kind === 'sby') continue;
    if (s.end + s.rest > from) return true;
  }
  return false;
}

/** v0.9 crew placed on new work in the current roster run (their future standby is re-fitted at its end). */
const placed = new Set<string>();

/** v0.9 the standby a crew plan's work (and its rest) clashes with gives way (crew/standby.ts dropStandby). */
function dropSbyFor(g: GameState, c: CrewMember, plan: CrewPlan): void {
  if (!plan.segs.length || !c.standby) return;
  placed.add(c.id);
  let from = Infinity;
  let until = -Infinity;
  for (const x of plan.segs) {
    from = Math.min(from, x.start);
    until = Math.max(until, x.end + x.rest);
  }
  dropStandby(g, c, from, until);
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

/** Distinct days with a duty (planned or flown) in the calendar month of t (UTC month: a planning weight). */
function monthDutyDays(segs: Seg[], t: Minute): number {
  const mk = monthKey(t);
  const days = new Set<number>();
  for (const s of segs) if ((s.kind === 'duty' || s.kind === 'log') && monthKey(s.start) === mk) days.add(Math.floor(s.start / DAY));
  return days.size;
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

/** v0.7.2 a captain in an FO or relief-pilot seat (the auto-roster's last resort). */
const asFo = (slot: Role, role: Role) => role === 'CPT' && (slot === 'FO' || slot === 'CRP');

/** Fills a pairing's empty slots with the best-scoring legal crew (DESIGN §5.3 steps 1–4, 6). */
/**
 * v0.9 fix: a plan refused only for days off not published yet that its month can spare (offMovable): the planner may
 * move them (the second choice, after crew who need no change). Every other issue must be acceptable as usual.
 * v0.9 round 3: a published day off too, for short-notice work, when the crew member agrees to swap it (offSwappable):
 * the last choice.
 */
function offFallback(g: GameState, c: CrewMember, plan: CrewPlan, base: Seg[]): boolean {
  if (!plan.issues.some((i) => i.code === 'daysOff')) return false;
  if (!acceptable(g, { ...plan, issues: plan.issues.filter((i) => i.code !== 'daysOff') })) return false;
  if (plan.issues.some((i) => i.code === 'daysOff' && i.level === 'illegal')) return false;
  const work = plan.segs.filter((x) => x.kind !== 'log');
  if (!work.length) return false;
  // v0.9 round 3: a published day off only by agreement (crew control's swap, crew/dayPlan.ts offSwappable).
  if (takesPublishedOff(g, c, work[0].start, work[work.length - 1].end)) return offSwappable(g, c, mergeSegs(base, plan.segs));
  return offMovable(g, c, mergeSegs(base, plan.segs));
}

/** Time from a trip's last release to home: none at base; away, a night's rest and the ticket. */
// Crew-planning round: the rest the last duty needs (its length, 14 h after an augmented day or across 4+ time zones),
// not a flat 10 h (a 12 h day's ticket home landed on the first morning of the leave).
const homeTravel = (d: Duty, base: string): number => (d.restAt === base ? 0
  : minRest({ dutyMin: d.release - d.report, atHome: false, augmented: d.augment > 0, tzShift: tzDeltaH(base, d.restAt, d.release), extended: !!d.ext }) + dhBlock(d.restAt, base) + 2 * 60);

function fillPairing(g: GameState, ctx: Ctx, p: Pairing, res: RosterResult, exclude?: Set<string>): void {
  const duties = openDuties(g, p);
  if (!duties.length) return;
  const first = duties[0];
  const spanTo = duties[duties.length - 1].release;
  const dep = g.flights[first.flightIds[0]]?.from ?? first.restAt;
  const family = typeOf(typeIdOf(g, p)).family;
  const contract = p.contractId ? g.contracts[p.contractId] : undefined;
  const unpleasant = (contract?.effects.morale ?? 0) < 0;
  // v0.8 deportation flights: crew whose morale is under 45 refuse them.
  const refuseBelow = contract?.archetype === 'deportation' ? BAL.v08.deport.refuseBelow : -1;
  const prev = previousCrew(g, p);
  const hadCrew = crewCount(p) > 0;
  promoteSpares(g, p);
  // v0.9 round 4 speed: a trip whose own duties break a cumulative window refuses everyone (no candidate planned).
  if (overForAnyone(g, duties)) return;
  const inP = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  // Seats above the legal minimum after every required one, and only before the trip starts (no one is
  // positioned out to an optional seat on a trip under way).
  const order = p.slots.map((_, i) => i).filter((i) => !p.slots[i].crewId && (!p.slots[i].above || p.status === 'planned'));
  order.sort((a, b) => Number(!!p.slots[a].above) - Number(!!p.slots[b].above) || SLOT_ORDER.indexOf(p.slots[a].role) - SLOT_ORDER.indexOf(p.slots[b].role) || a - b);
  const plans = new Map<string, CrewPlan>();
  // Slot-independent part of the score, once per pairing (crew in p are skipped below).
  const fitRoles = new Set<Role>();
  for (const r of SLOT_ORDER) for (const i of order) if (canFill(p.slots[i].role, r)) fitRoles.add(r);
  const price = new Map<string, number>();
  const pool: { c: CrewMember; score: number; rank: number }[] = [];
  for (const c of ctx.crew) {
    if (!fitRoles.has(c.role) || !c.ratings.includes(family) || inP.has(c.id) || exclude?.has(c.id) || c.morale < refuseBelow) continue;
    // v0.9 round 3 speed: crew planCrew would refuse at once (on leave, sick, in training or joining during the trip;
    // still resting at its report) are not planned at all: they were refused anyway, one full timeline check each.
    // Debug round (26 Oct 2026): until they are home again (a trip ending away: its rest and the ticket home), so leave
    // never starts on the deadhead home (seed 1: eighteen crew flew home on the first morning of their annual leave).
    const back = spanTo + homeTravel(duties[duties.length - 1], c.base);
    if (c.restUntil > first.report || c.blocks?.some((b) => b.from < back && b.to > first.report)) continue;
    // v0.5.2: crew still at the departure airport with a ticket home around this trip stay on instead
    // (planCrew drops that ticket): the pilots of a trip fly its trailing ferry.
    const all = ctx.of(c);
    const segs = p.tour ? all : withoutTickets(all, droppableHome(g, c, all, dep, first.report, spanTo));
    if (busyAt(segs, first.report, first.release)) continue;
    const loc = locAt(c, segs, first.report);
    let tp = price.get(loc);
    if (tp === undefined) price.set(loc, (tp = ticketPrice(loc, dep)));
    // v0.9 fix: flying shared out like a crew-planning department: the fewest duty days in the month first, then the
    // 28-day block (a crew member flying every day while another sits on standby would be noticed).
    let score = -tp - 2 * (block28(segs, first.report) / 60) - 12 * monthDutyDays(segs, first.report);
    if (prev.has(c.id)) score += 30;
    if (unpleasant) score -= (70 - c.morale) / 2;
    // v0.7.3 short notice: the day's standby crew are called first (crew control's order; no lost day off).
    if (c.standby && standbyFor(g, c, first.report)) score += 60;
    pool.push({ c, score, rank: ctx.rank.get(c.id)! });
  }
  pool.sort((a, b) => b.score - a.score || a.rank - b.rank);
  // Per slot, candidates in score order: the same-role stream merged lazily with the overqualified one (−50).
  // v0.7.2: captains for an FO/CRP seat form a third stream, used only once the other two are exhausted.
  // A crew member's plan does not depend on the slot, so one refused is not re-planned for the next slot.
  const refused = new Set<string>();
  const skip = (x: (typeof pool)[number]) => inP.has(x.c.id) || refused.has(x.c.id);
  // v0.9 fix: crew refused only for a day off not published yet (a day trip on it), kept in score order: when nobody
  // else can take the seat, the planner moves that day off within its month instead (no morale: crew never saw it).
  const offOnly: { c: CrewMember; plan: CrewPlan; swap: boolean }[] = [];
  const take = (c: CrewMember, plan: CrewPlan) => {
    inP.add(c.id);
    plans.set(c.id, plan);
    callIfOnStandby(g, c.id, openDuties(g, p)[0]?.report);
    dropSbyFor(g, c, plan);
    // v0.9 a tour's duties on planned days off: the planner moves them to the tour's free days (no morale).
    if (plan.issues.some((i) => i.code === 'daysOff')) takeOffDays(g, c, plan.segs, true);
    lateChange(g, c.id, nextReport(g, p));
    if (plan.drop) ctx.segs.set(c.id, ctx.of(c).filter((x) => !x.ticketId || !plan.drop!.includes(x.ticketId)));
    ctx.add(c, plan.segs);
    ctx.take(c.id, first.report, spanTo);
    res.assigned++;
  };
  for (const si of order) {
    const slot = p.slots[si];
    const role = slot.role;
    let i = 0;
    let j = 0;
    let k = 0;
    for (;;) {
      while (i < pool.length && (pool[i].c.role !== role || skip(pool[i]))) i++;
      while (j < pool.length && (pool[j].c.role === role || asFo(role, pool[j].c.role) || !canFill(role, pool[j].c.role) || skip(pool[j]))) j++;
      let x;
      if (i >= pool.length && j >= pool.length) {
        while (k < pool.length && (!asFo(role, pool[k].c.role) || skip(pool[k]))) k++;
        if (k >= pool.length) break;
        x = pool[k++];
      } else if (j >= pool.length) x = pool[i++];
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
        if (offFallback(g, c, plan, ctx.of(c))) {
          const work = plan.segs.filter((y) => y.kind !== 'log');
          offOnly.push({ c, plan, swap: takesPublishedOff(g, c, work[0].start, work[work.length - 1].end) });
        }
        continue;
      }
      slot.crewId = c.id;
      delete slot.ooh;
      take(c, plan);
      break;
    }
    if (slot.crewId) continue;
    // An unpublished day off moved (the crew never saw it) before a published one swapped by agreement (morale −3).
    const fits = (y: (typeof offOnly)[number]) => !inP.has(y.c.id) && (y.c.role === role || (canFill(role, y.c.role) && !asFo(role, y.c.role)));
    const alt = offOnly.find((y) => !y.swap && fits(y)) ?? offOnly.find(fits);
    if (!alt) continue;
    slot.crewId = alt.c.id;
    delete slot.ooh;
    take(alt.c, alt.plan);
  }
  if (!plans.size) return;
  buyTickets(g, p, plans, res);
  // The run's timelines learn the tickets home just bought, so a later trip from there can drop them (droppableHome).
  const lastD = duties[duties.length - 1];
  for (const [id, plan] of plans) {
    const h = plan.home;
    if (!h) continue;
    const f = h.rideId ? g.flights[h.rideId] : lastD.deadheadIds.map((x) => g.flights[x]).find((x) => x && x.from === h.from && x.to === h.to && x.std === h.std && x.crewIds.includes(id));
    if (!f) continue;
    for (const x of ctx.segs.get(id) ?? []) {
      if (x.kind === 'pos' && !x.ticketId && x.from === h.from && x.at === h.to && x.end === h.sta) x.ticketId = f.id;
      else if (x.kind === 'duty' && x.home && !x.home.id && x.home.from === h.from && x.home.std === h.std && x.at === h.to) x.home.id = f.id;
    }
  }
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of duties) queueDuty(g, d);
  let level: Legality = 'legal';
  for (const d of duties) level = worst(level, d.legality);
  for (const plan of plans.values()) level = worst(level, levelOf(plan.issues.filter((i) => i.code !== 'fdp')));
  p.legality = hadCrew ? worst(level, p.legality) : level;
  if (!hadCrew) delete p.illegalFrom;
}

/**
 * v0.6 on-board spare: a required seat left empty (sickness, removal, resignation) is taken by a crew member on an
 * optional seat above the minimum who can fill the role: no ticket, no positioning. Their optional seat stays empty.
 */
export function promoteSpares(g: GameState, p: Pairing): number {
  let n = 0;
  for (const s of p.slots) {
    if (s.crewId || s.above || s.extra) continue;
    const spare = p.slots.find((x) => x.above && x.crewId && g.crew[x.crewId] && canFill(s.role, g.crew[x.crewId].role));
    if (!spare) continue;
    s.crewId = spare.crewId;
    if (spare.locked) s.locked = true;
    spare.crewId = null;
    delete spare.locked;
    n++;
  }
  if (n) {
    g.stats.sparesCovered = (g.stats.sparesCovered ?? 0) + n;
    touchCrew(g);
  }
  return n;
}

/**
 * v0.6 at the gate (a duty's first leg): crew on optional seats above the minimum who are not at the departure
 * airport or are over a limit stay behind; their seat goes empty and never holds the departure. True when anyone
 * was taken off.
 */
export function dropStraySpares(g: GameState, f: Flight): boolean {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d && d.flightIds[0] === f.id ? g.pairings[d.pairingId] : undefined;
  if (!d || !p || !p.slots.some((s) => s.above && s.crewId)) return false;
  const bad = new Set(crewIssuesFor(g, d).map((x) => x.crewId));
  let n = 0;
  for (const s of [...p.slots]) {
    if (!s.above || !s.crewId) continue;
    const c = g.crew[s.crewId];
    if (c && c.loc === f.from && !bad.has(c.id)) continue;
    releaseCrew(g, p, s.crewId);
    n++;
  }
  if (n) setFlightsCrew(g, p);
  return n > 0;
}

/** Flights of pairings with an empty required seat (still to fly, std in [from, to)). */
function uncoveredOf(g: GameState, ps: Pairing[], from: Minute, to: Minute): string[] {
  const out: string[] = [];
  for (const p of ps) {
    if (!g.pairings[p.id] || !requiredEmpty(p)) continue;
    for (const d of openDuties(g, p)) for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (f && f.status === 'scheduled' && f.std >= from && f.std < to) out.push(fid);
    }
  }
  return out;
}

let shortHook: ((g: GameState) => void) | null = null;
/** v0.7.1: crew/control.ts registers the warning ladder (amber ≤ 48 h message, red ≤ 12 h + pause). */
export function setShortHook(f: (g: GameState) => void): void {
  shortHook = f;
}

/**
 * Uncovered flights departing within 48 h: the v0.7.1 ladder (escalateShortages) marks and messages them; without
 * it (tests of the roster alone) the old one message per batch and a crewShortage pause.
 */
function warnShort(g: GameState, ids: string[]): void {
  if (shortHook) return shortHook(g);
  const soon = ids.filter((id) => {
    const f = g.flights[id];
    return !!f && !f.crewAlert && !f.crewWarned && f.std < g.now + 2 * DAY;
  });
  if (!soon.length) return;
  for (const id of soon) g.flights[id].crewAlert = 'amber';
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
  placed.clear();
  const before = res.assigned;
  for (const p of ps) {
    if (!g.pairings[p.id]) continue;
    fillPairing(g, ctx, p, res, exclude);
    // v0.5.2: a tour seat nobody can take from its first duty (a sickness, a crew just off another tour) is
    // filled from the first later duty someone can: the tour is split there, so only the gap goes uncovered.
    let q: Pairing | null = p;
    for (let n = 0; q && n < 3; n++) {
      q = q.tour ? splitTourGap(g, ctx, q, exclude) : null;
      if (q) fillPairing(g, ctx, q, res, exclude);
    }
  }
  // v0.9 round 4 speed: the seats filled are the run's own change to the index (splits and spares bump it themselves).
  if (res.assigned !== before) touchCrew(g);
  if (placed.size) {
    fitStandby(g, [...placed]);
    placed.clear();
  }
}

/**
 * v0.9 round 4 fix r2 speed: splitTourGap's probe for "the tour from duty k on" is the same object each time it is
 * asked in a step (planCrew's memo keys on the pairing's identity), so a tour nobody can crew, re-rostered at every
 * ladder tick and every Crew Control look, costs its probes once per state revision instead of every time (a
 * shortage-heavy game spent minutes in them). The slots are the live pairing's; the duties and start fix the probe.
 */
const probes = new WeakMap<Pairing, Map<string, Pairing>>();
function probeOf(p: Pairing, duties: Duty[], start: Minute): Pairing {
  let m = probes.get(p);
  if (!m) probes.set(p, (m = new Map()));
  const key = duties.map((x) => x.id).join(',');
  let probe = m.get(key);
  if (!probe) {
    if (m.size >= 16) m.clear();
    m.set(key, (probe = { ...p, dutyIds: duties.map((x) => x.id), start }));
  }
  probe.slots = p.slots;
  return probe;
}

/**
 * A tour with an empty seat: the first later duty (after the first open one) from which a legal crew member
 * could take that seat for the rest of the tour; the tour is split there and the later part returned (null:
 * no seat open, or nobody fits any later part).
 */
function splitTourGap(g: GameState, ctx: Ctx, p: Pairing, exclude?: Set<string>): Pairing | null {
  const open = openDuties(g, p);
  const roles = [...new Set(p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role))];
  if (!roles.length || open.length < 2) return null;
  const family = typeOf(typeIdOf(g, p)).family;
  const inP = new Set(p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
  const end = open[open.length - 1].release;
  const pool = ctx.crew.filter((c) => !inP.has(c.id) && !exclude?.has(c.id) && c.ratings.includes(family) && roles.some((r) => canFill(r, c.role)));
  const horizon = g.now + BAL.rosterHorizonDays * DAY;
  for (let k = 1; k < open.length; k++) {
    const d = open[k];
    if (d.report > horizon) return null;
    // v0.9 round 4 speed: a later part that breaks a cumulative window on its own refuses everyone.
    if (overForAnyone(g, open.slice(k))) continue;
    const probe = probeOf(p, open.slice(k), d.report);
    for (const c of pool) {
      // v0.9 round 3 speed: as in fillPairing, crew planCrew refuses at once are not planned.
      if (c.restUntil > d.report || c.blocks?.some((b) => b.from < end && b.to > d.report)) continue;
      if (ctx.onTrip(c.id, d.report, end) || busyAt(ctx.of(c), d.report, d.release)) continue;
      if (acceptable(g, planCrew(g, c, probe, ctx.of(c), false, BAL.rosterSlack))) return splitPairing(g, p, d.report);
    }
  }
  return null;
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
    .filter((p) => p.aircraftId && sel.has(p.aircraftId) && (p.status === 'planned' || p.status === 'active') && p.start < to && p.end > from && (requiredEmpty(p) || (p.status === 'planned' && aboveEmpty(p))))
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
  const loose = new Set<string>();
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
      // Leftover-breach round: legs no longer flown in the duty's order, or no longer joined airport to airport (a leg
      // retimed ahead of the one before it), make no day of work: before any of them flies the duty goes and the legs
      // are planned afresh. Invariant seed 1: a Heathrow–Innsbruck leg slipped to 21:20 and the return to 15:20; the
      // duty kept both, its first listed leg was not the first flown, and its crew 'flew' out of Innsbruck from
      // Heathrow (the gate checks the crew's place at a duty's first leg).
      const legs = keep.map((id) => g.flights[id]);
      if (legs.length > 1 && legs.every((f) => f.status === 'scheduled') && legs.some((f, i) => i > 0 && (f.std < legs[i - 1].sta || f.from !== legs[i - 1].to))) {
        for (const f of legs) if (f.dutyId === d.id) {
          f.dutyId = null;
          f.crewIds = [];
        }
        detachDuty(g, p, d);
        if (!openDuties(g, p).length) for (const x of p.slots) if (x.crewId) loose.add(x.crewId);
        reroster = true;
        continue;
      }
      if (!keep.length) {
        detachDuty(g, p, d);
        if (!openDuties(g, p).length) for (const x of p.slots) if (x.crewId) loose.add(x.crewId);
        continue;
      }
      d.flightIds = keep;
      syncDuty(g, d, p);
      // A leg under way now leaving a night-stop later: the duty ends at the last landing (hotel, then a new duty).
      const d2 = splitUnderWay(g, p, d);
      if (crewCount(p) > 0) {
        queueDuty(g, d);
        const moved = new Set<string>();
        retimeTickets(g, p, d, moved);
        if (d2) retimeTickets(g, p, d2, moved);
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
    if (requiredEmpty(p) && inHorizon(g, p.start)) reroster = true;
  }
  touchCrew(g);
  for (const [p, ids] of later) recheckLater(g, ids, p);
  // v0.9.1: a trip's last duty gone under way leaves its crew a stand-alone ticket home to re-check.
  if (loose.size) rebookLooseTickets(g, loose);
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
  // v0.9 round 5 speed (§R.19): what each crewed trip's check read, as checked below; after the fill, a trip whose
  // seats, duties and crew timelines are as they were keeps that check (the fill of one seat bumped the revision
  // and had every crewed trip of the aircraft planned again: a sixth of all re-checks). The check's own result is kept
  // with it and written back: a prior-only check in between (fillPairing, splitPairing) rewrites p.legality.
  const checked = new Map<Pairing, { sig: unknown[]; level: Legality; from: Minute | undefined }>();
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
      const sig = checkSig(g, p);
      recheckPairing(g, p);
      checked.set(p, { sig, level: p.legality, from: p.illegalFrom });
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
    // v0.9 round 4 fix r2 (speed, §R.17.7): the full check first (the step's cached plans: recheckSoon, the ladder);
    // only a trip with an illegal crew member needs the prior-only view (a filtered base, never cached), which flags
    // the same crew or, through a loose ticket it leaves out, one the full view rightly clears.
    const sig = checkSig(g, p);
    const full = recheckPairing(g, p);
    const fullFrom = p.illegalFrom;
    const rc = full.illegal.length ? recheckPairing(g, p, true) : full;
    const locked = (id: string) => p.slots.some((s) => s.crewId === id && s.locked);
    // Crew-planning round: a locked crew member (Crew Control's pick, the player's) who is only somewhere else is
    // re-ticketed too: kept on the trip but never left there (bot seed 5: a captain swapped onto a Warsaw tour stayed in
    // Lisbon for 12 days, one red alarm a day and every leg 4–12 h late).
    if (!under) for (const id of rc.illegal) if (locked(id) && g.crew[id]) retick(g, p, g.crew[id]);
    const out = rc.illegal.filter((id) => !locked(id) && (under || !(g.crew[id] && retick(g, p, g.crew[id]))));
    const cut = Math.min(...out.map((id) => rc.from.get(id) ?? 0));
    const q = out.length && cut > firstOpen.report && cut < Infinity ? splitPairing(g, p, cut) : null;
    // Round 4 fix r2 (§R.16.6): the days-off floor is one duty's problem (its eve becomes the day off), so that duty
    // alone is split off and re-crewed; the crew keep the rest of the trip. The empty seat says who and why (§T.2).
    const eve = !!q && out.every((id) => rc.from.get(id) === cut && rc.issue.get(id)?.code === 'daysOff');
    if (eve) {
      const next = openDuties(g, q)[1];
      if (next) splitPairing(g, q, next.report);
    }
    // Crew-planning round: a crew member taken off a trip within 4 days of it by a delay or change (rest, the day's
    // length, where they are, a limit) is noted on its first leg: a shortage that follows reads as a late change.
    for (const id of out) {
      const code = rc.issue.get(id)?.code;
      const f0 = g.flights[firstOpen.flightIds[0]];
      if (f0 && firstOpen.report - g.now < 4 * DAY && code && code !== 'daysOff' && code !== 'status') f0.crewLost = { crewId: id, why: 'change', t: g.now };
    }
    for (const id of out) {
      if (q && (rc.from.get(id) ?? 0) >= cut) {
        releaseCrew(g, q, id);
        if (eve) markOoh(g, q, id, rc.issue.get(id)!);
      } else if (!under) releaseCrew(g, p, id);
    }
    setFlightsCrew(g, p);
    if (q) setFlightsCrew(g, q);
    if (!out.length) checked.set(p, { sig, level: full.level, from: fullFrom });
  }
  // v0.9 round 4 speed: no revision bump of its own (every change above makes one): a re-roster that changes nothing
  // leaves the step's cached plans standing for the re-checks below.
  const res = autoRoster(g, { from: t, aircraftIds: [aircraftId] });
  for (const p of crewIx(g).byAircraft.get(aircraftId) ?? []) {
    if (p.status === 'done' || p.end < t || crewCount(p) === 0) continue;
    const was = checked.get(p);
    if (was && sameSig(was.sig, checkSig(g, p))) {
      p.legality = was.level;
      if (was.from === undefined) delete p.illegalFrom;
      else p.illegalFrom = was.from;
      continue;
    }
    recheckPairing(g, p);
  }
  return res;
}

/**
 * What recheckPairing reads of a crewed trip, in the same minute (a superset; compared value by value, objects by
 * identity): the trip (status, times, base, aircraft and its rest classes, tour, seats and when each joined), each duty
 * (every field dutySegs keys on, each leg's and each ticket's times, status, version and who is aboard), each crew
 * member's state (check.ts crewKey and crewIds, the inputs of planCrew's own memo), their timeline entry without the
 * trip (timeline.ts segsOf: their own work, tickets, log and standby; an untagged list never matches) and their other
 * trips' spans (otherTrip). Taken just before the check, so a change made after it fails the comparison. Pure.
 */
function checkSig(g: GameState, p: Pairing): unknown[] {
  const rest = p.aircraftId ? g.fleet[p.aircraftId]?.rest : undefined;
  const s: unknown[] = [p.status, p.start, p.end, p.base, p.aircraftId, !!p.tour, rest?.fc?.cls, rest?.cc?.cls, p.dutyIds.length, p.slots.length];
  for (const x of p.slots) s.push(x.crewId, x.from, !!x.locked, !!x.above, x.role);
  const crew: CrewMember[] = [];
  for (const x of p.slots) if (x.crewId && g.crew[x.crewId]) crew.push(g.crew[x.crewId]);
  for (const id of p.dutyIds) {
    const d = g.duties[id];
    if (!d) {
      s.push('-');
      continue;
    }
    s.push(d.id, d.done, d.ev, d.flightsEv, d.report, d.release, d.fdp, d.maxFdp, d.discretion, d.legality, d.restAt, d.ext, d.split, d.augment, d.sectors, d.cabinEarly, d.flightIds.length, d.deadheadIds.length);
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      s.push(f, f?.status, f?.ev, f?.std, f?.sta, f?.from, f?.to);
    }
    for (const fid of d.deadheadIds) {
      const f = g.flights[fid];
      s.push(f, f?.status, f?.ev, f?.std, f?.sta, f?.from, f?.to);
      if (f) for (const c of crew) s.push(aboard(f, c.id));
    }
  }
  for (const c of crew) {
    s.push(c, crewKey(g, c), segsTagOf(segsOf(g, c, p.id)) ?? {});
    for (const v of crewIds(g, c)) s.push(v);
    for (const q of crewIx(g).pairingsOf.get(c.id) ?? []) {
      if (q === p) continue;
      const open = openDuties(g, q);
      s.push(q.id, q.status, q.start, !!q.tour, open.length, open[0]?.report, open[open.length - 1]?.release);
    }
  }
  return s;
}

function sameSig(a: unknown[], b: unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Crew a split part no longer seats leave its flights and tickets as well.
setReleaseHook(releaseCrew);

// Crewed tours accept a new duty only if every crew member stays legal (0 no, 2 yes, 1 with a day off moved).
setCrewOkHook((g, p, d) => {
  const moves: CrewMember[] = [];
  for (const s of p.slots) {
    if (!s.crewId) continue;
    const c = g.crew[s.crewId];
    if (!c) continue;
    if (otherTrip(g, c, p, d.report, d.release, false)) return 0;
    // v0.9 round 5: never onto leave, sickness, training or a joining period (a tour that grew onto a crew member's
    // leave was found only by the daily re-check: the seat went red at an outstation with nobody to reach it). A
    // block between two duties of the tour is the re-check's (check.ts statusIssues): the tour splits at the first
    // duty after it and that part is re-crewed; the duties before it fly.
    if (c.blocks?.some((b) => b.from < d.release && b.to > d.report)) return 0;
    // v0.9 never onto a planned day off; a tour moves them to its free days (the planner's own re-plan, no morale).
    // Round 4: the move is made by the take hook, only for the set the chainer picks (a set with no change first).
    if (offDaysHit(c, d.report, d.release).length) {
      if (!p.tour) return 0;
      moves.push(c);
    }
    // The tour's own tickets are re-planned around its new ends (retick), so they are left out here.
    const own: Seg[] = [];
    for (const x of openDuties(g, p)) own.push(...dutySegs(g, c, p, x, null, null));
    const base = mergeSegs(segsOf(g, c, p.id), own);
    const fresh = dutySegs(g, c, p, d, null, null, true);
    const segs = mergeSegs(base, fresh);
    if (evalSegs({ ...ctxOf(g, c), slack: BAL.rosterSlack }, segs).some((i) => i.level === 'illegal' && i.code !== 'fdp')) return 0;
    // v0.9 fix: never below a month's 7 days off, and a day off it lands on only moves when its month has room.
    if (monthFloorIssue(g, c, base, fresh) || (moves.includes(c) && !offMovable(g, c, segs, true))) return 0;
  }
  return moves.length ? 1 : 2;
});
setCrewTakeHook((g, p, d) => {
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c || !offDaysHit(c, d.report, d.release).length) continue;
    takeOffDays(g, c, dutySegs(g, c, p, d, null, null, true).filter((x) => x.kind === 'duty'), true);
  }
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
  // v0.9 the tour's new duties ignored its crew's future standby (rules.ts standbyView): fit it again.
  fitStandby(g, p.slots.filter((s) => s.crewId).map((s) => s.crewId!));
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
  const home = last.restAt !== c.base ? planHome(last, c.base, cabinEarly(g, p)) : null;
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
    if (last.restAt !== c.base) plans.set(c.id, { level: 'legal', issues: [], out: null, home: planHome(last, c.base, cabinEarly(g, p)), segs: [] });
  }
  buyTickets(g, p, plans, emptyResult());
  touchCrew(g);
}

// ---------- disruption APIs ----------

/** v0.7.3 why commander's discretion is not available before report (ORO.FTL.205(f): unforeseen, at or after report). */
export const DISCRETION_BEFORE_REPORT = 'Only after the crew has reported. For a planned day: a fresh crew, a delay or more pilots';

/** v0.9 the FDP the duty was planned at when the crew reported (old saves: report to the last scheduled arrival). */
export function plannedFdpOf(g: GameState, d: Duty): number {
  if (d.plannedFdp !== undefined) return d.plannedFdp;
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  return last ? last.sta - d.report : d.fdp;
}

/**
 * v0.9 commander's discretion is never planned (UPDATE-0.9.md §U.3; ORO.FTL.205(f)): offered only once the crew has
 * reported, every seat filled, not used yet, the day legal when they reported (the overrun is unforeseen) and the
 * overrun within what discretion adds. `fdp`: the projected FDP (default the duty's). `addMin`: what it would add. Pure.
 */
export function discretionCheck(g: GameState, dutyId: string, fdp?: number, opts: { cabinOver?: number } = {}): { ok: boolean; why: string; addMin: number } {
  const d = g.duties[dutyId];
  const p = d && g.pairings[d.pairingId];
  if (!d || !p || d.done) return { ok: false, why: 'No duty to extend', addMin: 0 };
  const no = (why: string) => ({ ok: false, why, addMin: 0 });
  if (d.report > g.now) return no(DISCRETION_BEFORE_REPORT);
  if (requiredEmpty(p)) return no("Seats are empty: discretion doesn't crew a flight");
  if (d.discretion) return no('Already used on this duty');
  if (plannedFdpOf(g, d) > d.maxFdp) return no("The day was already too long when they reported: that's planning, not an emergency");
  const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  // v0.9 round 4 (§Y.1 step 2): a hold at the gate that only breaks the cabin crew's rest plan (the pilots are within
  // their limit): the commander extends the cabin crew's day by the hold, within the 2 h / 3 h allowance and never past
  // the CS FTL.1.205(c)(3) cap of their rest class.
  if (opts.cabinOver !== undefined) {
    const over = opts.cabinOver;
    if (over <= 0) return no('The day is within its limit');
    const rest = restOf(g, p.aircraftId ?? null);
    const room = rest.cc ? cabinFdpCap(rest.cc.cls) - (d.cabinEarly ?? 0) - d.fdp : Infinity;
    const full = d.augment > 0 ? DISCRETION.augmented : DISCRETION.basic;
    const add = Math.max(0, Math.min(full, room));
    // Round 4: the refusal names the limit that bites (the rest-class table, when it caps the 2 h / 3 h).
    if (over > add) return no(add ? (add < full ? `Over by ${hm(over)}: the cabin crew's rest class allows only +${hm(add)}` : `Over by ${hm(over)}: more than discretion allows`) : `Over by ${hm(over)}: the cabin crew's rest class allows no longer day`);
    // Round 4: the whole allowance is stored (ORO.FTL.205(f)(1)(i): one increase), so a second hold inside it is still covered.
    return { ok: true, why: '', addMin: add };
  }
  const full = d.augment > 0 ? DISCRETION.augmented : DISCRETION.basic;
  const up = discretionMax(g, d);
  const add = d.ext && d.basicFdp ? Math.max(0, Math.min(up, d.basicFdp + up - d.maxFdp)) : up;
  const over = (fdp ?? d.fdp) - d.maxFdp;
  if (over <= 0) return no('The day is within its limit');
  if (over > add) {
    const h = hm(over);
    // Round 4: on an augmented day the cabin crew's rest class (or the cruise's rest room) may cap the 3 h: say so.
    return no(add ? (d.augment > 0 && up < full ? `Over by ${h}: the cabin crew's rest class allows only +${hm(add)}` : `Over by ${h}: more than discretion allows`) : d.augment > 0 ? `Over by ${h}: the cabin crew's rest does not allow a longer day` : `Over by ${h}: discretion adds nothing on a planned extension`);
  }
  return { ok: true, why: '', addMin: add };
}

/**
 * Commander's discretion (ORO.FTL.205(f)): only once the crew have reported, for something unforeseen; up to 2 h
 * (3 h with an augmented crew) on the basic FDP after a planned extension (GM1 ORO.FTL.205(f)(1)(i)), else on the
 * duty's limit; crew.discretion++, morale −3.
 */
/**
 * v0.7.3 the most commander's discretion can add to a duty (ORO.FTL.205(f): 2 h, 3 h augmented). On an augmented
 * duty with cabin crew aboard it never takes their day past the CS FTL.1.205(c)(3) table for their rest class
 * (18:00 / 17:00 / 16:00), nor past a day whose cabin rest no longer fits the cruise (15 min steps). Pure.
 */
export function discretionMax(g: GameState, d: Duty): number {
  const up = d.augment > 0 ? DISCRETION.augmented : DISCRETION.basic;
  if (d.augment === 0) return up;
  const p = g.pairings[d.pairingId];
  const rest = restOf(g, p?.aircraftId ?? null);
  const n = restCabinN(g, d);
  if (!rest.cc || n === 0) return up;
  const early = d.cabinEarly ?? 0;
  // v0.9 round 4 (§Y.1): a cabin crew that joined at the gate has a shorter day than the pilots (their own report).
  const own = p ? cabinOwnReport(p, d) : 0;
  let x = Math.max(0, Math.min(up, cabinFdpCap(rest.cc.cls) - early - (d.maxFdp - own)));
  // ... nor past what the cabin crew aboard can rest for in this cruise (a longer day needs more rest each).
  const legs = restLegs(g, d);
  const fits = (m: number) => {
    const plan = planRest(legs, rest, d.augment as 1 | 2, d.maxFdp + m + early - own, n);
    return plan.ok && plan.extraCabin <= (d.restExtra ?? 0);
  };
  while (x > 0 && legs.length && !fits(x)) x = Math.max(0, x - 15);
  return x;
}

export function applyDiscretion(g: GameState, dutyId: string, fdp?: number, opts: { cabinOver?: number } = {}): ActionResult {
  const d = g.duties[dutyId];
  const p = d && g.pairings[d.pairingId];
  if (!d || !p) return { ok: false, error: 'Duty not found' };
  if (d.done) return { ok: false, error: 'Duty already flown' };
  // v0.9 only for the unforeseen, after report (§U.3).
  const chk = discretionCheck(g, dutyId, fdp, opts);
  const st = v09StatsOf(g);
  if (!chk.ok) {
    st.discretionRefused++;
    return { ok: false, error: chk.why };
  }
  d.discretion = chk.addMin;
  st.discretionUsed++;
  st.legalStreak = 0;
  if (plannedFdpOf(g, d) > d.maxFdp || d.report > g.now) st.discretionPlanned = (st.discretionPlanned ?? 0) + 1;
  d.legality = dutyLegality(d);
  for (const s of p.slots) {
    const c = s.crewId ? g.crew[s.crewId] : undefined;
    if (!c) continue;
    c.discretion++;
    moraleShock(g, c, 'discretion', -3);
    c.fatigue = Math.min(100, c.fatigue + 10);
  }
  if (requiredEmpty(p)) fillAll(g, [p], emptyResult());
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
  // v0.9 standby planned inside the block goes too (the day plan re-picks cover for those days).
  dropStandby(g, c, from, to);
  const hit: Pairing[] = [];
  for (const p of (crewIx(g).pairingsOf.get(crewId) ?? []).filter((x) => x.status !== 'done' && x.status !== 'broken' && x.start < to && x.end > from)) {
    // Duties before `from` keep the crew member: the trip is split and only the later part is re-crewed.
    const q = openDuties(g, p).some((d) => d.report < from) ? splitPairing(g, p, from) : null;
    hit.push(q ?? p);
  }
  ownRelease = crewId;
  try {
    for (const p of hit) releaseCrew(g, p, crewId);
  } finally {
    ownRelease = null;
  }
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
  delete p.slots[slot].ooh;
  delete p.slots[slot].from;
  const od = openDuties(g, p);
  // Round 4 (§Y.1): a replacement at the gate (the duty has reported) placed inside a running window is a call-out now
  // (standbyFor would judge it against the duty's own report, already past, and the window would only be clipped).
  if (od.length && od[0].report <= g.now) callFromStandby(g, c.id);
  else callIfOnStandby(g, c.id, od[0]?.report);
  if (od.length) dropSbyFor(g, c, plan);
  // v0.9 a manual placement on a day off takes it (crew/dayPlan.ts: morale when published, the day re-planned).
  const offHit = od.length > 0 && plan.issues.some((i) => i.code === 'daysOff') && plan.segs.length > 0;
  // A published day off taken costs its own −6 (the confirm's number): no late-change shock on top.
  const brokeOff = offHit && takesPublishedOff(g, c, plan.segs[0].start, plan.segs[plan.segs.length - 1].end);
  if (offHit) takeOffDays(g, c, plan.segs);
  if (!brokeOff) lateChange(g, c.id, nextReport(g, p));
  buyTickets(g, p, new Map([[c.id, plan]]), emptyResult());
  setFlightsCrew(g, p);
  if (!hadCrew) for (const d of openDuties(g, p)) queueDuty(g, d);
  touchCrew(g);
  fitStandby(g, [c.id]);
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
export function flightCrewStatus(g: GameState, flightId: string, opts?: { live?: boolean }): FlightCrewStatus {
  const f = g.flights[flightId];
  if (!f || !f.aircraftId || f.kind === 'deadhead' || f.status === 'cancelled') return { level: 'ok', missing: [] };
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) {
    if (f.status !== 'scheduled') return { level: 'ok', missing: [] };
    const ac = g.fleet[f.aircraftId];
    return { level: 'missing', missing: ac ? complement(ac.typeId, ac.cabin.total, { extraCabin: contractExtraReq(g, f.contractId) }) : [] };
  }
  const missing = p.slots.filter((s) => !s.crewId && !s.above).map((s) => s.role);
  if (d.legality === 'illegal') return { level: 'illegal', missing };
  if (missing.length) return { level: 'missing', missing };
  // v0.9 round 4 (§Y.1): a rest plan that failed at the gate (cabin seats marked, crew still aboard) blocks the departure
  // like an illegal duty, so the ladder, the problems list, the strip, the pause badge and the map all see it.
  if (!d.done && d.report <= g.now && p.slots.some((s) => s.crewId && s.ooh?.limit === 'inflightRest')) return { level: 'illegal', missing };
  if (p.legality === 'illegal') {
    // A crew member who can't fly a later duty of the trip only warns on the earlier ones (the roster takes them
    // off from that duty); another duty's FDP is that duty's problem. Old saves without the mark: whole trip.
    const from = p.illegalFrom ?? (p.dutyIds.some((id) => g.duties[id]?.legality === 'illegal' && !g.duties[id].done) ? Infinity : -Infinity);
    if (d.report < from) return { level: 'tight', missing };
    // v0.6.3: the stored mark is set at roster events and can outlive the crew it was about (a seat refilled, a
    // partial re-roster); confirm it live, the same reading as the Adjust crew panel (dutyLegality).
    if (crewIssuesFor(g, d).length) return { level: 'illegal', missing };
  }
  // An empty seat above the legal minimum only warns (optional; never blocks the departure).
  if (d.legality === 'tight' || (!d.done && aboveEmpty(p))) return { level: 'tight', missing };
  // v0.6.4: a stored 'tight' can outlive the crew it was about too (fillPairing keeps the worse of old and new);
  // confirm it live (cached per crew change) so the amber dot agrees with the Adjust crew panel.
  // v0.7.3 callers that only ask 'missing or illegal?' (the hourly shortage ladder, the departure gate) skip it.
  return { level: p.legality === 'tight' && (opts?.live === false || liveCrewLevel(g, p) !== 'legal') ? 'tight' : 'ok', missing };
}

const liveLevels = new WeakMap<GameState, { rev: number; now: Minute; m: Map<string, Legality> }>();
/** Worst crew-level (non-FDP) issue of the pairing's assigned crew, checked live; cached until the crew change. */
function liveCrewLevel(g: GameState, p: Pairing): Legality {
  let c = liveLevels.get(g);
  const rev = crewRev(g);
  if (!c || c.rev !== rev || c.now !== g.now) liveLevels.set(g, (c = { rev, now: g.now, m: new Map() }));
  let lv = c.m.get(p.id);
  if (lv) return lv;
  lv = 'legal';
  if (openDuties(g, p).length) {
    for (const s of p.slots) {
      const cm = s.crewId ? g.crew[s.crewId] : undefined;
      if (!cm) continue;
      lv = worst(lv, levelOf(planCrew(g, cm, p, segsOf(g, cm, p.id), true).issues.filter((i) => i.code !== 'fdp')));
    }
  }
  c.m.set(p.id, lv);
  return lv;
}

const contractExtraReq = (g: GameState, contractId: string | null) => (contractId ? g.contracts[contractId]?.requirements.extraCabin ?? 0 : 0);
