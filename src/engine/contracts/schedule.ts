// Pattern → flights, positioning legs and rolling base schedules (B1). DESIGN.md §5.1.6–5.1.8.

import { BAL } from '../core/balance';
import { addFlight, flightsOf, ownFlightNo, removeFlights } from '../core/entities';
import { blockMinutes, typeOf } from '../core/perf';
import { DAY, dayStart } from '../core/time';
import type { Contract, Flight, GameState, Minute } from '../core/types';
import {
  anchorsOf, baseDayOf, baseDays, baseDayStart, baseFlightNo, chainBackward, chainForward, CHARTER_SLACK, DEPLOY_LEAD, flownRotations, gapMoves,
  isSoft, planLegs, type Anchor, type ChainLeg,
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
  const ch = chainForward(ac.typeId, prev.to, at, earliest);
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
  const chain = chainBackward(ac.typeId, prev.to, to, crewFree(g, aircraftId, prev.to, earliest), arriveBy - turn) ?? chainBackward(ac.typeId, prev.to, to, earliest, arriveBy - turn);
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
  if (earliest > g.now) return earliest;
  let landed = -Infinity;
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'done' && f.to === X) landed = Math.max(landed, f.ata ?? f.sta);
  if (g.now - landed < 3 * 60) return earliest;
  const home = g.company.homeBase;
  // A short ticket the same morning; a long one the day before, with minimum rest on arrival (FDP).
  const blk = X === home ? 0 : blockMinutes('a320ceo', home, X);
  const lead = X === home ? 120 : blk + (blk <= 180 ? 6 * 60 : 14 * 60);
  return Math.ceil((g.now + lead) / 5) * 5;
}

const live = (g: GameState, id: string | null) => !!id && (g.contracts[id]?.status === 'signed' || g.contracts[id]?.status === 'active');

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
  return Y === null || legs[legs.length - 1].to === Y;
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
  const typeId = ac.typeId;
  const turn = typeOf(typeId).turnMin;
  const home = g.company.homeBase;
  const nodes = anchorsOf(g, aircraftId);
  if (!nodes.length) return [];
  const soft = flightsOf(g, aircraftId).filter((f) => isSoft(g, f));
  // Gaps between non-overlapping nodes.
  const gaps: { a: Anchor; b: Anchor | null; legs: Flight[] }[] = [];
  let cur = nodes[0];
  for (let i = 1; i < nodes.length; i++) {
    const b = nodes[i];
    if (b.std < cur.sta) {
      if (b.sta > cur.sta) cur = b;
      continue;
    }
    gaps.push({ a: cur, b, legs: [] });
    cur = b;
  }
  gaps.push({ a: cur, b: null, legs: [] });
  for (const f of soft) (gaps.find((x) => x.b && f.std < x.b.std) ?? gaps[gaps.length - 1]).legs.push(f);
  const created: Flight[] = [];
  const remove: string[] = [];
  const add = (chain: ChainLeg[], contractId: string | null) => {
    for (const l of chain) created.push(addFlight(g, { no: ownFlightNo(g), aircraftId, contractId, kind: 'positioning', from: l.from, to: l.to, std: l.std, sta: l.sta }));
  };
  for (const { a, b, legs } of gaps) {
    legs.sort((x, y) => x.std - y.std);
    const X = a.to;
    const earliest = a.kind === 'start' ? a.sta : a.sta + turn;
    if (!b) {
      // End gap: after a live contract's last leg, go home.
      const wantHome = live(g, a.contractId) && X !== home && a.kind !== 'maint';
      if (legs.length ? chainOk(legs, X, null, earliest) : !wantHome) continue;
      remove.push(...legs.map((f) => f.id));
      if (wantHome) {
        const ch = chainForward(typeId, X, home, crewFree(g, aircraftId, X, earliest));
        if (ch) add(ch, a.contractId);
      }
      continue;
    }
    const Y = b.from;
    const sameBase = !!a.contractId && a.contractId === b.contractId && g.contracts[a.contractId]?.pattern.kind === 'base';
    const allowHop = a.kind !== 'maint' && b.kind !== 'maint' && !sameBase;
    const latest = b.std - turn;
    const hop = X === Y ? gapMoves(typeId, X, Y, crewFree(g, aircraftId, X, earliest), latest, home, allowHop) : null;
    if (X === Y && !legs.length && !hop?.length) continue;
    if (legs.length && chainOk(legs, X, Y, earliest)) continue;
    remove.push(...legs.map((f) => f.id));
    const inId = live(g, b.contractId) ? b.contractId : live(g, a.contractId) ? a.contractId : null;
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
    const via = allowHop && X !== home ? gapMoves(typeId, X, Y, from, b.std - leadFor(g, b, turn), home, true) : null;
    if (via?.some((l) => l.to === home)) {
      const k = via.findIndex((l) => l.to === home) + 1;
      add(via.slice(0, k), live(g, a.contractId) ? a.contractId : null);
      add(via.slice(k), inId);
      continue;
    }
    const ch =
      chainBackward(typeId, X, Y, from, b.std - leadFor(g, b, turn)) ??
      chainBackward(typeId, X, Y, from, latest) ??
      chainBackward(typeId, X, Y, earliest, b.std - leadFor(g, b, turn)) ??
      chainBackward(typeId, X, Y, earliest, latest) ??
      chainForward(typeId, X, Y, earliest);
    if (ch) add(ch, inId);
  }
  if (remove.length) removeFlights(g, remove);
  return created;
}
