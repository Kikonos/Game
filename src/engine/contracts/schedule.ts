// Pattern → flights, positioning legs and rolling base schedules (B1). DESIGN.md §5.1.6–5.1.8.

import { BAL } from '../core/balance';
import { addFlight, flightsOf, liveFlightsOf, ownFlightNo, removeFlights, retimeFlight } from '../core/entities';
import { etopsCap, typeOf } from '../core/perf';
import { ticketBlock } from '../ops/commercial';
import { safetyTrip } from '../core/safety';
import { restedDeparture } from '../crew/duties';
import { curfewOk } from '../core/curfew';
import { DAY, dayStart } from '../core/time';
import type { Contract, Flight, GameState, Minute } from '../core/types';
import {
  anchorsOf, baseDayOf, baseDays, baseDayStart, baseFlightNo, chainBackward, chainForward, CHARTER_SLACK, DEPLOY_LEAD, flownRotations, gapMoves,
  isSoft, onwardPending, planLegs, route, type Anchor, type ChainLeg,
} from './plan';

const horizonEnd = (g: GameState) => dayStart(g.now) + BAL.scheduleHorizonDays * DAY;

/**
 * Creates the contract's flights on its aircraft: revenue legs (split by fuel stops, internal empty legs), then
 * positioning in/out through relinkPositioning; 'base' patterns only up to the rolling horizon. Returns created flights.
 */
export function generateFlights(g: GameState, c: Contract): Flight[] {
  const out: Flight[] = [];
  if (c.pattern.kind === 'legs') {
    const acId = c.aircraftIds[0];
    const ac = g.fleet[acId];
    if (!ac) return out;
    const prog = planLegs(c.pattern, ac.typeId, !!c.requirements.noTechStops);
    if (!prog.ok) return out;
    const nos = new Map<number, string>();
    for (const t of prog.trips) {
      for (const l of t.legs) {
        let no: string;
        if (l.kind === 'positioning') no = ownFlightNo(g);
        else {
          no = nos.get(l.tpl) ?? (c.pattern.legs[l.tpl].flightNo || ownFlightNo(g));
          nos.set(l.tpl, no);
        }
        out.push(addFlight(g, { no, aircraftId: acId, contractId: c.id, kind: l.kind, from: l.from, to: l.to, std: l.std, sta: l.sta, pax: l.kind === 'positioning' ? undefined : l.pax }));
      }
    }
    // Keep the flight numbers on the pattern so panels show them.
    nos.forEach((no, i) => (c.pattern.kind === 'legs' ? (c.pattern.legs[i].flightNo = no) : undefined));
  } else {
    out.push(...extendContract(g, c, horizonEnd(g)));
  }
  for (const id of c.aircraftIds) out.push(...relinkPositioning(g, id));
  return out;
}

/** When the aircraft could first operate from `at` given its commitments before `before`. */
function readyAt(g: GameState, aircraftId: string, at: string, before: Minute, excludeContract: string): Minute {
  const ac = g.fleet[aircraftId];
  const turn = typeOf(ac.typeId).turnMin;
  let prev: Anchor | null = null;
  for (const n of anchorsOf(g, aircraftId)) {
    if (n.contractId === excludeContract || n.std >= before) continue;
    if (!prev || n.sta > prev.sta) prev = n;
  }
  if (!prev) return g.now;
  const earliest = prev.kind === 'start' ? prev.sta + 60 : prev.sta + turn;
  if (prev.to === at) return earliest;
  const ch = chainForward(ac.typeId, prev.to, at, earliest, etopsCap(g.company.approvals, ac.typeId));
  return ch && ch.length ? ch[ch.length - 1].sta + turn : earliest;
}

/** Base pattern: adds the rotations of every day starting before `until` (skips maintenance and clashes). */
function extendContract(g: GameState, c: Contract, until: Minute): Flight[] {
  const p = c.pattern;
  if (p.kind !== 'base' || c.generatedUntil >= p.to) return [];
  const out: Flight[] = [];
  const n = baseDays(p);
  const k0 = Math.max(0, baseDayOf(p, c.generatedUntil));
  let k1 = k0;
  while (k1 < n && baseDayStart(p, k1) < until) k1++;
  if (k1 === k0) return out;
  c.aircraftIds.forEach((acId, slot) => {
    const ac = g.fleet[acId];
    if (!ac) return;
    const turn = typeOf(ac.typeId).turnMin;
    const days = flownRotations(p, ac.typeId, slot);
    const maint = Object.values(g.maintenance).filter((m) => m.aircraftId === acId && (m.status === 'planned' || m.status === 'inWork'));
    const hard = flightsOf(g, acId).filter((f) => f.contractId !== c.id && f.status !== 'cancelled' && f.status !== 'done' && !isSoft(g, f));
    const first = c.generatedUntil <= p.from ? readyAt(g, acId, p.base, days.find((d) => d.length)?.[0].outStd ?? p.from, c.id) : -Infinity;
    for (let k = k0; k < k1; k++) {
      for (const r of days[k]) {
        if (r.outStd < Math.max(first, g.now + 30)) continue;
        const a = r.outStd - turn;
        const b = r.backSta + turn;
        if (maint.some((m) => m.start < b && m.end > a) || hard.some((f) => f.std < b && f.sta > a)) continue;
        out.push(addFlight(g, { no: baseFlightNo(p, r.destIdx, r.w, false), aircraftId: acId, contractId: c.id, kind: 'revenue', from: p.base, to: r.dest, std: r.outStd, sta: r.outSta }));
        out.push(addFlight(g, { no: baseFlightNo(p, r.destIdx, r.w, true), aircraftId: acId, contractId: c.id, kind: 'revenue', from: r.dest, to: p.base, std: r.backStd, sta: r.backSta }));
      }
    }
  });
  c.generatedUntil = k1 >= n ? p.to : baseDayStart(p, k1);
  return out;
}

/** Daily: roll 'base' patterns forward to the horizon (and stop at contract end); repair positioning. */
export function extendBaseSchedules(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    if ((c.status === 'signed' || c.status === 'active') && c.pattern.kind === 'base') extendContract(g, c, horizonEnd(g));
  }
  for (const id of Object.keys(g.fleet)) relinkPositioning(g, id);
}

/**
 * Adds empty positioning (billable on wet) or ferry legs so the aircraft is at `to` by `arriveBy` (lands a turn
 * before it): one leg, or several with fuel stops (A320 LIS→KBL via a stop). Departs as late as possible after its
 * previous commitment and replaces soft positioning legs in that gap; [] when already there; null when it can't fit.
 * Used by B1 and by B3 (maintenance ferries, AOG swaps).
 */
export function planPositioning(g: GameState, aircraftId: string, to: string, arriveBy: Minute, kind: 'positioning' | 'ferry', contractId: string | null): Flight[] | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const turn = typeOf(ac.typeId).turnMin;
  let prev: Anchor | null = null;
  for (const n of anchorsOf(g, aircraftId)) if (n.std < arriveBy && (!prev || n.sta > prev.sta)) prev = n;
  if (!prev) return null;
  if (prev.to === to) return [];
  const earliest = prev.kind === 'start' ? prev.sta : prev.sta + turn;
  const cap = etopsCap(g.company.approvals, ac.typeId);
  const chain = chainBackward(ac.typeId, prev.to, to, crewFree(g, aircraftId, prev.to, earliest), arriveBy - turn, cap) ?? chainBackward(ac.typeId, prev.to, to, earliest, arriveBy - turn, cap);
  if (!chain) return null;
  const stale = flightsOf(g, aircraftId).filter((f) => isSoft(g, f) && f.std >= prev!.std && f.std < arriveBy).map((f) => f.id);
  if (stale.length) removeFlights(g, stale);
  return chain.map((l) => addFlight(g, { no: ownFlightNo(g), aircraftId, contractId, kind, from: l.from, to: l.to, std: l.std, sta: l.sta }));
}

/**
 * Earliest departure of new empty legs from X. An aircraft idle at an outstation for a while has no crew aboard:
 * the legs leave no sooner than a ticket from base gets a crew there (same day when short, else the day before).
 * Right after landing the operating crew can still take it on.
 */
function crewFree(g: GameState, aircraftId: string, X: string, earliest: Minute): Minute {
  const home = g.company.homeBase;
  // A short ticket the same morning; a long one the day before, with minimum rest on arrival (FDP).
  const blk = X === home ? 0 : ticketBlock(home, X);
  const lead = X === home ? 120 : blk + (blk <= 180 ? 6 * 60 : 14 * 60);
  // v0.9.1: also when the earliest slot is still ahead but inside a ticket's reach (seed 5: an aircraft held at Goma by a
  // closure got its positioning out 6 h after the reopening, its crew already gone home: 18 red alerts in three days).
  if (earliest > g.now + lead) return earliest;
  const at = Math.max(earliest, g.now);
  let landed = -Infinity;
  for (const f of flightsOf(g, aircraftId)) {
    if (f.to !== X || f.status === 'cancelled') continue;
    const t = f.status === 'done' ? f.ata ?? f.sta : f.sta;
    if (t <= at) landed = Math.max(landed, t);
  }
  if (at - landed < 3 * 60) return earliest;
  return Math.max(earliest, Math.ceil((g.now + lead) / 5) * 5);
}

const live = (g: GameState, id: string | null) => !!id && (g.contracts[id]?.status === 'signed' || g.contracts[id]?.status === 'active');

/**
 * v0.12.1 the aircraft is on the ground at X after its last leg of a job whose later legs out of X were cancelled (a
 * crew shortage, a client's cancellation): nothing would take it home (CS-TTL sat at Port Sudan for a month). Pure.
 */
export function stranded(g: GameState, aircraftId: string, X: string): boolean {
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.kind !== 'deadhead' && (!last || f.std >= last.std)) last = f;
  if (!last || last.to !== X || !last.contractId) return false;
  const k = last.contractId;
  return flightsOf(g, aircraftId).some((f) => f.status === 'cancelled' && f.contractId === k && f.from === X && f.std >= last!.std);
}

/**
 * v0.12.1 after a curfew diversion to X (the leg on its way there, or landed in the last day), the earliest the empty
 * leg out can leave: when a rested crew can fly it, theirs after the minimum rest or one flown in, whichever is
 * sooner (seed 9: AWL200 CGN–DUS flown on 3 h of rest after the Düsseldorf curfew diversion). -Infinity otherwise. Pure.
 */
function restAfterCurfew(g: GameState, a: Anchor, aircraftId: string, X: string): Minute {
  let f: Flight | undefined = a.kind === 'flight' ? g.flights[a.id] : undefined;
  if (a.kind === 'start') for (const y of flightsOf(g, aircraftId)) if (y.status === 'done' && y.kind !== 'deadhead' && (!f || y.std >= f.std)) f = y;
  if (!f || f.to !== X || !f.div || f.ops !== 'curfew' || (f.ata !== undefined && g.now - f.ata >= DAY)) return -Infinity;
  const home = g.company.homeBase;
  const blk = X === home ? 0 : ticketBlock(home, X);
  const fresh = Math.ceil((g.now + (X === home ? 120 : blk + (blk <= 180 ? 6 * 60 : 14 * 60))) / 5) * 5;
  return Math.min(restedDeparture(g, f) ?? fresh, fresh);
}

/** v0.12.1 the aircraft is at X after a technical diversion that no onward leg carried on from (coach, rival, fix). Pure. */
function ownFaultAt(g: GameState, aircraftId: string, X: string): boolean {
  let last: Flight | undefined;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.kind !== 'deadhead' && (!last || f.std >= last.std)) last = f;
  return !!last && last.to === X && last.div?.cause === 'technical' && !last.contOf;
}

/** Positioning lead before a commitment: the evening before a deployment, a turn plus slack before a charter. */
function leadFor(g: GameState, b: Anchor, turn: number): number {
  const c = b.contractId ? g.contracts[b.contractId] : undefined;
  if (!c) return turn;
  return c.pattern.kind === 'base' ? DEPLOY_LEAD : turn + CHARTER_SLACK;
}

function chainOk(legs: Flight[], X: string, Y: string | null, earliest: Minute): boolean {
  if (!legs.length) return false;
  if (legs[0].from !== X || legs[0].std < earliest) return false;
  for (let i = 1; i < legs.length; i++) if (legs[i].from !== legs[i - 1].to || legs[i].std < legs[i - 1].sta) return false;
  // v0.12.1 an empty leg planned into a night curfew (an older plan) is planned again, clear of it (S1027: AMS–LHR at 04:50).
  if (legs.some((f) => !curfewOk(f.from, f.std) || !curfewOk(f.to, f.sta))) return false;
  return Y === null || legs[legs.length - 1].to === Y;
}

/** The airports an empty move from → to calls at (fuel stops included), or null without a route. */
function routePath(typeId: string, from: string, to: string, cap: number): string[] | null {
  const r = route(typeId, from, to, cap);
  return r ? [from, ...r.map((l) => l.to)] : null;
}

const samePath = (a: string[], b: string[] | null) => !!b && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * v0.7.2.2 (player bug: a moved trip left its ferries on the old aircraft): a continuous chain is only kept when it
 * is a move the planner itself would make between X and Y (Y null: the end of the schedule): the direct route (its
 * fuel stops), or, where a hop home is allowed, out home and back on. A loop that leaves and comes back to the same
 * airport for nothing (LIS–MAN–LIS around a trip that went to another aircraft) or detours through a station no
 * commitment needs any more is an orphan: it is removed and the gap re-planned.
 */
function chainSane(typeId: string, legs: Flight[], X: string, Y: string | null, home: string, allowHop: boolean, cap: number): boolean {
  const path = [legs[0].from, ...legs.map((f) => f.to)];
  // End of the schedule: only the way home is ever planned.
  if (Y === null) return X !== home && samePath(path, routePath(typeId, X, home, cap));
  if (X !== Y && samePath(path, routePath(typeId, X, Y, cap))) return true;
  if (!allowHop || X === home || Y === home) return false;
  const k = path.indexOf(home);
  return k > 0 && samePath(path.slice(0, k + 1), routePath(typeId, X, home, cap)) && samePath(path.slice(k), routePath(typeId, home, Y, cap));
}

/**
 * Keeps exactly one empty-leg chain between consecutive commitments at different airports (DESIGN §5.1.6): soft
 * positioning legs that no longer link their neighbours are removed and re-planned (as late as possible; late
 * if they can't make it); after a contract's last leg the aircraft goes home; a long idle stay at an outstation
 * becomes a hop home and back. Returns the legs it created.
 */
export function relinkPositioning(g: GameState, aircraftId: string): Flight[] {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.status === 'stored' || ac.status === 'leasedOut') return [];
  // v0.12.1 nothing is planned while a diversion's onward is open (S1118 BLU1083: an empty AMS–AYT planned while its
  // passengers waited at Amsterdam for the card; seed 2: four LHR–LGW copies, one per relink): planned once, after it.
  if (onwardPending(g, aircraftId)) return [];
  const typeId = ac.typeId;
  const turn = typeOf(typeId).turnMin;
  const home = g.company.homeBase;
  // v0.11 empty legs stay inside our ETOPS approval and the type's capability (the 60-minute rule without one).
  const cap = etopsCap(g.company.approvals, typeId);
  const nodes = anchorsOf(g, aircraftId);
  if (!nodes.length) return [];
  const soft = liveFlightsOf(g, aircraftId).filter((f) => isSoft(g, f));
  // Gaps between non-overlapping nodes.
  type Gap = { a: Anchor; b: Anchor | null; legs: Flight[] };
  const gaps: Gap[] = [];
  let cur = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    const b = nodes[i];
    if (b.std < cur.sta) {
      // v0.12.1 a leg out of the maintenance airport that is not yet moved behind unplanned work (a ramp inspection,
      // an AOG) follows it, as recovery will move it: the gap after it starts where it lands (seed 9: CTA–DUS planned
      // empty beside EW6101 CTA–DUS, which the inspection had only delayed).
      if (cur.kind === 'maint' && b.kind === 'flight' && b.from === cur.to) {
        const std = Math.max(b.std, cur.sta);
        cur = { ...b, std, sta: std + (b.sta - b.std) };
        continue;
      }
      if (b.sta > cur.sta) cur = b;
      continue;
    }
    gaps.push({ a: cur, b, legs: [] });
    cur = b;
  }
  gaps.push({ a: cur, b: null, legs: [] });
  // A leg belongs to the gap it starts in; a late leg out of a gap's start airport (planned forward, after the
  // next commitment's first departure) still belongs to that gap, so a second pass keeps it (fixed point).
  // v0.8 fix pack: so do the later legs of a late chain with a fuel stop (LGW–KAN–LAD landing after the next
  // departure): read alone, KAN–LAD fell in another gap, the chain looked broken and was re-planned on every
  // settle, thousands of times (a player's aircraft back from an AOG; its crews ticketed each time).
  let prev = null as { f: Flight; gap: Gap } | null;
  for (const f of [...soft].sort((x, y) => x.std - y.std)) {
    let gap: Gap = gaps.find((x) => x.b && (f.std < x.b.std || (f.from === x.a.to && f.std < x.b.sta))) ?? gaps[gaps.length - 1];
    const pg: Gap | undefined = prev?.gap;
    if (prev && pg && pg !== gap && pg.b && prev.f.to === f.from && prev.f.to !== pg.b.from && f.std >= prev.f.sta && f.std < pg.b.sta + DAY) gap = pg;
    gap.legs.push(f);
    prev = { f, gap };
  }
  const created: Flight[] = [];
  const remove: string[] = [];
  // v0.9 round 3: the legs to create are collected first and matched against the legs the pass removes (below).
  const planned: { l: ChainLeg; contractId: string | null }[] = [];
  // v0.9 fix: a gap's new plan is set against the legs it replaces. Legs of the same route are kept and only retimed
  // (their crews and tickets stay: an inbound 13 min late re-made VCE–LIS 2 h before departure, crewless, a red
  // alarm); a plan identical to them is no change at all (a busy game re-planned LOS–TLS–STN on every settle).
  let pending: Flight[] = [];
  const add = (chain: ChainLeg[], contractId: string | null) => {
    const old = pending.splice(0, chain.length);
    const same = old.length === chain.length && old.every((f, i) => f.from === chain[i].from && f.to === chain[i].to && f.status === 'scheduled' && f.contractId === contractId);
    if (same) {
      old.forEach((f, i) => {
        if (f.std !== chain[i].std || f.sta !== chain[i].sta) retimeFlight(g, f, chain[i].std, chain[i].sta);
      });
      return;
    }
    remove.push(...old.map((f) => f.id));
    for (const l of chain) planned.push({ l, contractId });
  };
  const replacing = (legs: Flight[]) => {
    remove.push(...pending.map((f) => f.id));
    pending = [...legs];
  };
  for (const { a, b, legs } of gaps) {
    legs.sort((x, y) => x.std - y.std);
    const X = a.to;
    // Debug round (26 Oct 2026): an empty leg of this gap held at the gate for a crew (operations moved it to when one
    // can be there) keeps that wait: re-planned from earlier, it was retimed or replaced to leave at once, its departure
    // held it again, and so on at one minute (seed 1: LGW–LHR after a curfew diversion, 500 copies, the safety net).
    const held = legs.reduce((m, l) => ((l.crewTries ?? 0) > 0 && l.status === 'scheduled' ? Math.max(m, l.std) : m), -Infinity);
    const earliest = Math.max(a.kind === 'start' ? a.sta : a.sta + turn, held, restAfterCurfew(g, a, aircraftId, X));
    if (!b) {
      // End gap: after a live contract's last leg, go home. v0.12.1 also when the aircraft was stranded (the rest of
      // its job, the legs that would have taken it away, cancelled): one way home, at once (crewFree).
      const wantHome = (live(g, a.contractId) || (a.kind === 'start' && stranded(g, aircraftId, X))) && X !== home && a.kind !== 'maint';
      if (legs.length ? chainOk(legs, X, null, earliest) && chainSane(typeId, legs, X, null, home, false, cap) : !wantHome) continue;
      replacing(legs);
      if (wantHome) {
        const ch = chainForward(typeId, X, home, crewFree(g, aircraftId, X, earliest), cap);
        if (ch) add(ch, a.contractId);
      }
      continue;
    }
    const Y = b.from;
    const sameBase = !!a.contractId && a.contractId === b.contractId && g.contracts[a.contractId]?.pattern.kind === 'base';
    // v0.12.1 never a hop home and back before an empty move of its own (a ferry home held at X): the out-and-back
    // PZU–LIS–PZU planned around CS-TTL's ferry home (two planners each bringing the aircraft home).
    const emptyNext = b.kind === 'flight' && (g.flights[b.id]?.kind === 'ferry' || g.flights[b.id]?.kind === 'positioning');
    const allowHop = a.kind !== 'maint' && b.kind !== 'maint' && !sameBase && !emptyNext;
    const latest = b.std - turn;
    const hop = X === Y ? gapMoves(typeId, X, Y, crewFree(g, aircraftId, X, earliest), latest, home, allowHop, cap) : null;
    if (X === Y && !legs.length && !hop?.length) continue;
    if (legs.length && chainOk(legs, X, Y, earliest) && chainSane(typeId, legs, X, Y, home, allowHop, cap)) continue;
    replacing(legs);
    // v0.12.1 the empty leg out of an alternate after our own technical diversion is our cost: never billed to the
    // client as positioning (seed 9: airBaltic billed for four VAR–RIX legs after our fault at Riga).
    const inId = a.kind === 'start' && ownFaultAt(g, aircraftId, X) ? null : live(g, b.contractId) ? b.contractId : live(g, a.contractId) ? a.contractId : null;
    if (X === Y) {
      if (hop?.length) {
        const k = hop.findIndex((l) => l.to === home) + 1;
        add(hop.slice(0, k), live(g, a.contractId) ? a.contractId : null);
        add(hop.slice(k), inId);
      }
      continue;
    }
    // Leave room to crew it when the window allows; a tight window keeps the earliest slot.
    const from = crewFree(g, aircraftId, X, earliest);
    // A long wait at an outstation is spent at home (home, then on to Y), not parked away for weeks.
    const via = allowHop && X !== home ? gapMoves(typeId, X, Y, from, b.std - leadFor(g, b, turn), home, true, cap) : null;
    if (via?.some((l) => l.to === home)) {
      const k = via.findIndex((l) => l.to === home) + 1;
      add(via.slice(0, k), live(g, a.contractId) ? a.contractId : null);
      add(via.slice(k), inId);
      continue;
    }
    const ch =
      chainBackward(typeId, X, Y, from, b.std - leadFor(g, b, turn), cap) ??
      chainBackward(typeId, X, Y, from, latest, cap) ??
      chainBackward(typeId, X, Y, earliest, b.std - leadFor(g, b, turn), cap) ??
      chainBackward(typeId, X, Y, earliest, latest, cap) ??
      // Debug round (26 Oct 2026): already late for Y, the move leaves when a crew can be at X, not at once: planned at
      // `earliest` with nobody there, its departure re-rostered, the gap re-planned the same leg anew at the same
      // minute, a fresh red alarm and pause each time, and the clock never moved on (seed 3: an A320 back from an AOG
      // at Riyadh, 26 Oct; in the game the Play button paused again at once, for ever).
      chainForward(typeId, X, Y, from, cap);
    if (ch) add(ch, inId);
  }
  replacing([]);
  // v0.9 round 3: a pass whose plan is exactly the legs it removes (route, times and contract, as a multiset) changes
  // nothing: it is a no-op, not a loop. Overlapping empty legs (GRU–LIS beside LIS–GRU on one aircraft, a late leg
  // that falls in the next gap) are matched position by position above and missed; every settle then made copies and
  // the safety net threw them away and reported a loop ("CS-DVJ re-planned 2 empty leg(s) unchanged", 98 times).
  if (planned.length && planned.length === remove.length) {
    const key = (from: string, to: string, std: Minute, sta: Minute, k: string | null) => `${from}-${to}@${std}-${sta}:${k ?? ''}`;
    const was = remove.map((id) => g.flights[id]).filter((f) => f?.status === 'scheduled').map((f) => key(f.from, f.to, f.std, f.sta, f.contractId)).sort().join(' ');
    if (was === planned.map(({ l, contractId }) => key(l.from, l.to, l.std, l.sta, contractId)).sort().join(' ')) return [];
  }
  // v0.12.1 never a second copy of an empty leg the aircraft keeps (seed 2: a hard LHR–LGW within the hour fell inside
  // the gap before it, the gap read empty and planned it again, AWL374–377 in one minute, each a crew alarm).
  const gone = new Set(remove);
  const kept = liveFlightsOf(g, aircraftId).filter((f) => f.kind === 'positioning' && f.status === 'scheduled' && !gone.has(f.id));
  for (const { l, contractId } of planned) {
    if (kept.some((f) => f.from === l.from && f.to === l.to && f.contractId === contractId && Math.abs(f.std - l.std) <= turn)) continue;
    created.push(addFlight(g, { no: ownFlightNo(g), aircraftId, contractId, kind: 'positioning', from: l.from, to: l.to, std: l.std, sta: l.sta }));
  }
  // v0.8 pre-release safety net: a pass that only swaps legs for the very same legs (route, times, contract) would
  // do it again on the next settle, and the next: the fix pack's fuel-stop chain was re-planned that way on every
  // settle until the game froze. Keep the legs (and their crews), drop the copies and report the loop.
  if (remove.length && created.length === remove.length) {
    const sig = (f: Flight) => `${f.from}-${f.to}@${f.std}-${f.sta}:${f.contractId ?? ''}`;
    const was = remove.map((id) => sig(g.flights[id])).sort().join(' ');
    if (was === created.map(sig).sort().join(' ')) {
      // The copies never reached a roster: gone without a re-sync (their queued departures find no flight).
      for (const f of created) delete g.flights[f.id];
      safetyTrip('relinkPositioning', `${ac.reg} re-planned ${created.length} empty leg(s) unchanged at ${g.now} (${was})`);
      return [];
    }
  }
  if (remove.length) removeFlights(g, remove);
  return created;
}
