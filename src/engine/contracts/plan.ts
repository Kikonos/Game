// Programme planning shared by feasibility (pure) and flight generation (B1). DESIGN.md §5.1.5–5.1.8.
// Legs patterns → trips of legs (fuel stops, internal empty legs, client times shifted later only);
// base patterns → daily waves with maintenance nights and monthly drops to targetBH;
// aircraft anchors (hard commitments) and empty-move chains between them.

import { dryAnchor } from '../ops/dryLease';
import type { ChainShape } from '../crew/duties';
import { liveFlightsOf } from '../core/entities';
import { BAL } from '../core/balance';
import { blockMinutes, etopsRoute, NO_STOP_COUNTRY, planSector, reportMinutes, TECH_STOP_MIN, typeOf, withinEtops } from '../core/perf';
import { DAY, dayIndex, dayStart, localOffset, monthKey, monthStart, toLocal } from '../core/time';
import { hash } from '../core/util';
import { curfewOk, curfewShift, shutLocal, zoneDiffs } from '../core/curfew';
import type { Contract, ContractOffer, Flight, GameState, LegTemplate, Minute, Requirements, SchedulePattern } from '../core/types';

export type BasePattern = Extract<SchedulePattern, { kind: 'base' }>;
export type LegsPattern = Extract<SchedulePattern, { kind: 'legs' }>;

/** Idle time at an outstation after which the aircraft goes home between trips. */
export const TRIP_GAP = 48 * 60;
/** Minimum time at home that makes a home hop worth it. */
const HOME_HOP_MIN = 12 * 60;
/** Moving on to another station: a wait this long is spent at home instead (shorter waits stay put). */
const AWAY_GAP = 5 * 24 * 60;
/** Positioning lead before a deployment (arrive the evening before) and extra slack before a charter. */
export const DEPLOY_LEAD = 12 * 60;
export const CHARTER_SLACK = 30;
/** A-check calendar interval (RESEARCH §5.7: 750 FH / 120 days on the A320 family). */
export const A_CHECK_DAYS = 120;
/** Soft positioning legs: scheduled empty legs further out than this can be re-planned. */
export const SOFT_AFTER = 60;

const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;

// ---------- empty moves ----------

export interface ChainLeg {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
}

type Hop = { from: string; to: string; block: number };
/** v0.11 chains re-routed to stay inside an ETOPS cap (their legs are timed as ferry days, with night stops). */
const rerouted = new WeakSet<object>();
export const isRerouted = (legs: readonly Hop[]) => rerouted.has(legs);

/**
 * Sector legs of an empty move (fuel stops included); [] when already there, null when there is no route.
 * v0.11 `cap` (etopsCap: the company's ETOPS approval and the type's capability; 0 = the 60-minute rule): a routing
 * that would leave a twin further from an adequate airport goes the long way round on fuel stops that keep every
 * leg inside it (Europe–Keflavík–Iqaluit–Halifax), or null when there is none (no 60-minute Pacific crossing).
 * Omitted: no cap (revenue planning and the quotes that do not move an aircraft).
 */
export function route(typeId: string, from: string, to: string, cap = Infinity): Hop[] | null {
  if (from === to) return [];
  const p = planSector(typeId, from, to);
  if (!p.ok) return null;
  if (cap === Infinity || p.legs.every((l) => withinEtops(typeId, l.from, l.to, cap))) return p.legs;
  const r = etopsRoute(typeId, from, to, cap, { maxBlock: BAL.delivery.dayBlockMax, noStop: NO_STOP_COUNTRY });
  if (r) rerouted.add(r);
  return r;
}

/** v0.11 why route() found nothing: 'etops' when only the ETOPS cap stands in the way. Pure. */
export function noRouteWhy(typeId: string, from: string, to: string, cap: number): 'etops' | 'range' {
  return planSector(typeId, from, to).ok && cap !== Infinity ? 'etops' : 'range';
}

export const routeMinutes = (legs: { block: number }[]) => legs.reduce((s, l) => s + l.block, 0) + Math.max(0, legs.length - 1) * TECH_STOP_MIN;

/** v0.11 first departure to last landing of an empty move: its night stops included when it is re-routed (ferry days). */
export function routeSpan(legs: Hop[], typeId: string, std = 0): number {
  if (!legs.length) return 0;
  if (!rerouted.has(legs)) return routeMinutes(legs);
  const d = ferryDays(legs, std, typeId);
  return d[d.length - 1].sta - d[0].std;
}

/** Times a chain from `std`; a re-routed one (with `typeId`) as ferry days with night stops (ferryDays). */
export function timeChain(legs: Hop[], std: Minute, typeId?: string): ChainLeg[] {
  if (typeId && rerouted.has(legs)) return ferryDays(legs, std, typeId).map((l) => ({ from: l.from, to: l.to, std: l.std, sta: l.sta }));
  let t = std;
  return legs.map((l) => {
    const leg = { from: l.from, to: l.to, std: t, sta: t + l.block };
    t = leg.sta + TECH_STOP_MIN;
    return leg;
  });
}

/**
 * v0.12.1 minutes a chain must move so that no leg leaves or lands inside a strict night curfew (core/curfew.ts):
 * < 0 earlier ('before': it lands before the curfew starts), > 0 later ('after': from the curfew's end); 0 when
 * clean. Pure.
 */
function curfewMove(legs: ChainLeg[], dir: 'before' | 'after'): number {
  for (const l of legs) {
    if (!curfewOk(l.from, l.std)) return curfewShift(l.from, l.std, dir) - l.std;
    if (!curfewOk(l.to, l.sta)) return curfewShift(l.to, l.sta, dir) - l.sta;
  }
  return 0;
}

/**
 * Empty move landing at `latest` (as late as possible), departing no earlier than `earliest`; null: no route or no time.
 * v0.12.1 never leaving or landing in a night curfew: moved earlier until it is clear (AWL200 CGN–DUS landed 05:20
 * local, its crew on 3 h rest; seed 2 legs into Heathrow at 00:45).
 */
export function chainBackward(typeId: string, from: string, to: string, earliest: Minute, latest: Minute, cap = Infinity): ChainLeg[] | null {
  const r = route(typeId, from, to, cap);
  if (!r) return null;
  if (!r.length) return [];
  let std = latest - routeMinutes(r);
  if (!rerouted.has(r)) {
    let legs = timeChain(r, std);
    for (let k = 0; k < 4; k++) {
      const d = curfewMove(legs, 'before');
      if (!d) break;
      std += d;
      legs = timeChain(r, std);
    }
    return std < earliest || curfewMove(legs, 'before') ? null : legs;
  }
  // Ferry days snap their night stops to local mornings: walk the start back until the chain lands in time.
  for (let k = 0; k < 8; k++) {
    if (std < earliest) return null;
    const legs = timeChain(r, std, typeId);
    const over = legs[legs.length - 1].sta - latest;
    if (over <= 0) return legs;
    std -= Math.max(5, over);
  }
  return null;
}

/** Empty move leaving at `earliest` (v0.12.1 or when the night curfews at either end allow: after them). */
export function chainForward(typeId: string, from: string, to: string, earliest: Minute, cap = Infinity): ChainLeg[] | null {
  const r = route(typeId, from, to, cap);
  if (!r) return null;
  let legs = timeChain(r, earliest, typeId);
  if (!rerouted.has(r) && legs.length) {
    for (let k = 0; k < 4; k++) {
      const d = curfewMove(legs, 'after');
      if (!d) break;
      legs = timeChain(r, legs[0].std + d, typeId);
    }
  }
  return legs;
}

// ---------- ferry days ----------

export interface DayLeg { from: string; to: string; std: Minute; sta: Minute; block: number; nightStopAfter: boolean }

/**
 * After a night stop at `at`: from release (landing + post-flight) at least the minimum rest away from base (the
 * day's duty, never under the 14 h night stop) to the next report, but not in the small hours (07:00 local instead).
 */
function nextDay(at: string, landed: Minute, day0: Minute, typeId?: string): Minute {
  const rm = typeId ? reportMinutes(typeId) : { report: 0, post: 0 };
  const release = landed + rm.post;
  const t = release + Math.max(BAL.delivery.nightStop, release - (day0 - rm.report)) + rm.report;
  const h = Math.floor((toLocal(at, t) - dayStart(toLocal(at, t))) / 60);
  if (h >= 7 && h < 22) return t;
  const local = toLocal(at, t);
  const d = dayStart(local) + 7 * 60 + (h >= 22 ? DAY : 0);
  return localToUTC(at, d);
}

/**
 * Ferry days: ≤ 3 sectors and ≤ 10:00 of block plus fuel-stop turns, joined by night stops long enough for the
 * pilots' rest (with `typeId`: its report and post-flight times; see nextDay). Pure.
 */
export function ferryDays(legs: Hop[], first: Minute, typeId?: string): DayLeg[] {
  const D = BAL.delivery;
  const out: DayLeg[] = [];
  let t = first;
  let day0 = first;
  let n = 0;
  for (const h of legs) {
    if (n > 0 && (n + 1 > D.daySectorsMax || t + h.block - day0 > D.dayBlockMax)) {
      const last = out[out.length - 1];
      last.nightStopAfter = true;
      t = nextDay(last.to, last.sta, day0, typeId);
      day0 = t;
      n = 0;
    }
    out.push({ from: h.from, to: h.to, std: t, sta: t + h.block, block: h.block, nightStopAfter: false });
    n++;
    t = t + h.block + D.fuelStopTurn;
  }
  return out;
}

/**
 * The empty legs that link X (free from `earliest`) to Y (needed by `latest`): a direct chain, nothing when X = Y,
 * or (allowHop) a hop home and on to Y when the aircraft would otherwise idle ≥ AWAY_GAP at an outstation.
 * null: cannot make it.
 */
export function gapMoves(typeId: string, X: string, Y: string, earliest: Minute, latest: Minute, home: string, allowHop: boolean, cap = Infinity): ChainLeg[] | null {
  if (X !== Y) {
    // A long wait away from base is spent at home: back to base at once, then out to Y as late as possible.
    if (allowHop && X !== home && latest - earliest >= AWAY_GAP) {
      const out = chainForward(typeId, X, home, earliest, cap);
      if (out?.length && Y === home && out[out.length - 1].sta <= latest) return out;
      const back = Y === home ? null : chainBackward(typeId, home, Y, earliest, latest, cap);
      if (out?.length && back?.length && out[out.length - 1].sta + HOME_HOP_MIN <= back[0].std) return [...out, ...back];
    }
    return chainBackward(typeId, X, Y, earliest, latest, cap);
  }
  if (!allowHop || X === home || latest - earliest < TRIP_GAP) return [];
  const out = chainForward(typeId, X, home, earliest, cap);
  const back = chainBackward(typeId, home, Y, earliest, latest, cap);
  if (out && back && out.length && back.length && out[out.length - 1].sta + HOME_HOP_MIN <= back[0].std) return [...out, ...back];
  return [];
}

// ---------- anchors ----------

export interface Anchor {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  contractId: string | null;
  kind: 'start' | 'flight' | 'maint' | 'base';
  id: string;
}

export function isSoft(g: GameState, f: Flight): boolean {
  return f.kind === 'positioning' && f.status === 'scheduled' && f.std > g.now + SOFT_AFTER;
}

/**
 * v0.12.1 a diversion of this aircraft whose onward is not decided yet: turned for the alternate, or on the ground
 * there with the onward card open. Until it is, the aircraft's next move is unknown: the passengers may fly on in it
 * (no empty leg), go by coach (one empty leg after), or wait for the morning. Pure.
 */
export function onwardPending(g: GameState, aircraftId: string): boolean {
  for (const f of liveFlightsOf(g, aircraftId)) if (f.div && f.status === 'enroute' && !f.div.settled && !f.contOf) return true;
  return g.decisions.some((d) => {
    if (d.kind !== 'divertOnward') return false;
    const f = g.flights[String(d.data?.flightId)];
    return !!f?.div && f.aircraftId === aircraftId && !f.div.settled && !f.contOf;
  });
}

/**
 * Hard commitments of an aircraft from now on, by departure: scheduled or airborne legs except soft positioning,
 * planned or running maintenance, and the not-yet-generated tail of signed base contracts (virtual).
 * Leads with a 'start' node (where it is now) unless it is airborne.
 */
export function anchorsOf(g: GameState, aircraftId: string): Anchor[] {
  const ac = g.fleet[aircraftId];
  const out: Anchor[] = [];
  // v0.12.1 the last generated landing of each contract on this aircraft (its base tail starts after it).
  const lastOn = new Map<string, Minute>();
  for (const f of liveFlightsOf(g, aircraftId)) {
    if (f.contractId && f.kind === 'revenue') lastOn.set(f.contractId, Math.max(lastOn.get(f.contractId) ?? -Infinity, f.sta));
    if (isSoft(g, f)) continue;
    out.push({ from: f.from, to: f.to, std: f.std, sta: f.status === 'enroute' ? (f.eta ?? f.sta) : f.sta, contractId: f.contractId, kind: 'flight', id: f.id });
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== aircraftId || (m.status !== 'planned' && m.status !== 'inWork') || m.end <= g.now) continue;
    out.push({ from: m.at, to: m.at, std: m.start, sta: m.end, contractId: null, kind: 'maint', id: m.id });
  }
  let dryHere = false;
  for (const c of Object.values(g.contracts)) {
    if ((c.status !== 'signed' && c.status !== 'active') || !c.aircraftIds.includes(aircraftId)) continue;
    if (c.dry) dryHere = true;
    if (c.pattern.kind !== 'base') continue;
    const p = c.pattern;
    if (c.generatedUntil >= p.to || !ac) continue;
    const slot = c.aircraftIds.indexOf(aircraftId);
    // v0.12.1 not before the last generated rotation is home: generatedUntil is local midnight, an evening wave lands
    // after it (seed 9: EW6045 LIS–DUS 23:30–02:10 and a twin empty LIS–DUS planned beside it).
    const std = Math.max(c.generatedUntil, (lastOn.get(c.id) ?? -Infinity) + typeOf(ac.typeId).turnMin, firstDeparture(p, ac.typeId, slot) ?? p.from);
    out.push({ from: p.base, to: p.base, std, sta: Math.max(std, lastArrival(p, ac.typeId, slot) ?? p.to), contractId: c.id, kind: 'base', id: c.id });
  }
  // v0.8 a dry lease out holds the aircraft at the lessee's base between its two ferries.
  const dry = dryHere ? dryAnchor(g, aircraftId) : null;
  if (dry) out.push({ ...dry, kind: 'base', id: dry.contractId });
  out.sort((a, b) => a.std - b.std || a.sta - b.sta);
  if (ac && !ac.flightId) {
    // v0.7: a delivered aircraft abroad is busy with its acceptance until the delivery ferry leaves (never hopped home).
    let ready = Math.max(g.now, ac.deliveredAt);
    if (ac.delivery && ac.delivery.arrived === undefined) {
      for (const id of ac.delivery.ferryIds) {
        const f = g.flights[id];
        if (f?.status === 'scheduled' && f.from === ac.at) ready = Math.max(ready, f.std - typeOf(ac.typeId).turnMin);
      }
    }
    out.unshift({ from: ac.at, to: ac.at, std: g.now, sta: ready, contractId: null, kind: 'start', id: '' });
  }
  return out;
}

// ---------- legs patterns ----------

export interface PlanLeg {
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
  kind: 'revenue' | 'techstop' | 'positioning';
  /** Index of the client leg template (−1 for internal empty legs). */
  tpl: number;
  pax?: number;
}

export interface Trip {
  legs: PlanLeg[];
  from: string;
  to: string;
  std: Minute;
  sta: Minute;
}

export interface Programme {
  ok: boolean;
  /** Why it cannot be flown on this type ('KBL–LIS: runway'). */
  reason?: string;
  trips: Trip[];
  techStops: string[];
  /** Largest later-shift applied to a client time (minutes). */
  shiftMin: number;
  /** Planned revenue block minutes and internal empty-leg minutes. */
  revenueMin: number;
  emptyMin: number;
  /** Longest sector chain (block + stops) for crew duty checks. */
  longestChainMin: number;
  /** Airports used (runway checks) and revenue sectors (range/ETOPS checks). */
  airports: string[];
  sectors: [string, string][];
  /** Base patterns: days and rotations. */
  base?: { days: number; rotations: number };
  /** v0.7.3 the 5 longest operated chains (legs without a night-stop gap), distinct by shape (crew/duties.ts dutyNeed). */
  chains: ChainShape[];
}


/** A gap this long between legs is a night stop (10 h rest away plus report and post-flight). */
const CHAIN_GAP = 11 * 60;

export type { ChainShape };

/** Legs cut into chains at night-stop gaps (and after any arrival at `cut`, a crew-change station). */
export function chainsOf(legs: { std: Minute; sta: Minute; from: string; to: string }[], cut?: string): ChainShape[] {
  const all: ChainShape[] = [];
  let cur: ChainShape | null = null;
  let last: { sta: Minute; to: string } | null = null;
  for (const l of [...legs].sort((a, b) => a.std - b.std)) {
    if (!cur || !last || l.std - last.sta >= CHAIN_GAP || (cut && last.to === cut)) {
      cur = { from: l.from, std: l.std, legs: [] };
      all.push(cur);
    }
    cur.legs.push({ std: l.std, sta: l.sta, from: l.from, to: l.to });
    last = l;
  }
  return all;
}

/** The `n` longest chains, distinct by shape (start time of day, departure and leg offsets). */
export function longestChains(chains: ChainShape[], n = 5): ChainShape[] {
  const span = (c: ChainShape) => c.legs[c.legs.length - 1].sta - c.std;
  const seen = new Set<string>();
  const out: ChainShape[] = [];
  for (const c of [...chains].filter((x) => x.legs.length).sort((a, b) => span(b) - span(a) || a.std - b.std)) {
    const key = `${c.from}@${c.std % 1440}:${c.legs.map((l) => `${l.std - c.std}-${l.sta - c.std}`).join()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/** Legs pattern on a type: fuel stops, turn minima (shift later, never earlier), internal empty legs, trips split by ≥ TRIP_GAP. */
export function planLegs(p: LegsPattern, typeId: string, noTechStops = false): Programme {
  const t = typeOf(typeId);
  const res: Programme = { ok: true, trips: [], techStops: [], shiftMin: 0, revenueMin: 0, emptyMin: 0, longestChainMin: 0, airports: [], sectors: [], chains: [] };
  const tpls = p.legs.map((l, i) => ({ l, i })).sort((a, b) => a.l.dep - b.l.dep);
  let trip: Trip | null = null;
  let last: PlanLeg | null = null;
  const ap = new Set<string>();
  for (const { l, i } of tpls) {
    ap.add(l.from);
    ap.add(l.to);
    res.sectors.push([l.from, l.to]);
    const sp = planSector(typeId, l.from, l.to);
    if (!sp.ok) return { ...res, ok: false, reason: `${l.from}–${l.to}: ${sp.reason === 'runway' ? 'runway' : 'range'}` };
    if (noTechStops && sp.techStops.length) return { ...res, ok: false, reason: `${l.from}–${l.to}: no fuel stops allowed` };
    let std = l.dep;
    if (last && trip) {
      const gap = l.dep - last.sta;
      if (gap >= TRIP_GAP) {
        res.trips.push(trip);
        trip = null;
      } else if (last.to !== l.from) {
        const r = route(typeId, last.to, l.from);
        if (!r) return { ...res, ok: false, reason: `${last.to}–${l.from}: no empty-leg route` };
        const dur = routeMinutes(r);
        const dep = Math.max(last.sta + t.turnMin, l.dep - t.turnMin - dur);
        for (const c of timeChain(r, dep)) {
          trip.legs.push({ ...c, kind: 'positioning', tpl: -1 });
          res.emptyMin += c.sta - c.std;
          ap.add(c.to);
        }
        last = trip.legs[trip.legs.length - 1];
        std = Math.max(std, last.sta + t.turnMin);
      } else {
        std = Math.max(std, last.sta + t.turnMin);
      }
    }
    res.shiftMin = Math.max(res.shiftMin, std - l.dep);
    if (!trip) trip = { legs: [], from: l.from, to: l.to, std, sta: std };
    let tt = std;
    for (let k = 0; k < sp.legs.length; k++) {
      const s = sp.legs[k];
      const leg: PlanLeg = { from: s.from, to: s.to, std: tt, sta: tt + s.block, kind: k === 0 ? 'revenue' : 'techstop', tpl: i, pax: l.pax };
      trip.legs.push(leg);
      res.revenueMin += s.block;
      tt = leg.sta + TECH_STOP_MIN;
      last = leg;
    }
    for (const s of sp.techStops) {
      ap.add(s);
      if (!res.techStops.includes(s)) res.techStops.push(s);
    }
    res.longestChainMin = Math.max(res.longestChainMin, tt - TECH_STOP_MIN - std);
  }
  if (trip) res.trips.push(trip);
  for (const tr of res.trips) {
    tr.from = tr.legs[0].from;
    tr.to = tr.legs[tr.legs.length - 1].to;
    tr.std = tr.legs[0].std;
    tr.sta = tr.legs[tr.legs.length - 1].sta;
  }
  res.airports = [...ap];
  // v0.7.3 crew chains: each sector with its fuel stops (a longer day can always be cut there with a slip crew).
  const sectorChains: ChainShape[] = [];
  for (const l of res.trips.flatMap((tr) => tr.legs)) {
    const last = sectorChains[sectorChains.length - 1];
    if (l.kind === 'techstop' && last) last.legs.push({ std: l.std, sta: l.sta, from: l.from, to: l.to });
    else sectorChains.push({ from: l.from, std: l.std, legs: [{ std: l.std, sta: l.sta, from: l.from, to: l.to }] });
  }
  res.chains = longestChains(sectorChains);
  return res;
}

// ---------- base patterns ----------

/** UTC minute of a local wall-clock minute at an airport. */
export function localToUTC(code: string, local: Minute): Minute {
  const guess = local - localOffset(code, local);
  return local - localOffset(code, guess);
}

/**
 * Wave departure times (local minutes): 06:00, then each next wave after the longest rotation plus a turn,
 * while it leaves by 21:00 local; at most maxWaves (DESIGN §5.1.6). v0.12.1 (A7) no wave leaves, lands, turns or
 * lands back inside a night curfew (strict, at the base and every destination, in every season): a wave that would
 * moves later; when the day then holds fewer waves than without curfews, it may start earlier (not before 05:00
 * or the base's curfew end) to win one back; a wave that still does not fit is dropped. HAM–PMI on an A320: 06:00,
 * 12:30 (a 19:00 third would land back after HAM's 23:00 night ban, as real Hamburg programmes fly two).
 */
export function computeWaves(base: string, dests: string[], typeId: string, maxWaves: number): number[] {
  const turn = typeOf(typeId).turnMin;
  const legs = dests.map((d) => ({ d, out: blockMinutes(typeId, base, d), back: blockMinutes(typeId, d, base), z: zoneDiffs(base, d) }));
  const rot = Math.max(...legs.map((l) => l.out + turn + l.back));
  const clear = (w: number) => !shutLocal(base, w) && legs.every((l) => !shutLocal(base, w + l.out + turn + l.back) && l.z.every((z) => !shutLocal(l.d, w + z + l.out) && !shutLocal(l.d, w + z + l.out + turn)));
  const day = (first: number) => {
    const waves: number[] = [];
    for (let t = first; waves.length < maxWaves && t <= 21 * 60; ) {
      if (!clear(t)) t += 5;
      else {
        waves.push(t);
        t = roundUp5(t + rot + turn);
      }
    }
    return waves;
  };
  // The day as it was without curfews: an earlier start only wins back a wave a curfew took, never one more.
  let plain = 1;
  for (let t = 360; plain < maxWaves && roundUp5(t + rot + turn) <= 21 * 60; plain++) t = roundUp5(t + rot + turn);
  let best = day(360);
  for (let first = 355; best.length < plain && first >= 300 && !shutLocal(base, first); first -= 5) {
    const w = day(first);
    if (w.length > best.length) best = w;
  }
  return best;
}

export interface Rotation {
  k: number;
  w: number;
  dest: string;
  destIdx: number;
  outStd: Minute;
  outSta: Minute;
  backStd: Minute;
  backSta: Minute;
}

const day0 = (p: BasePattern) => dayIndex(toLocal(p.base, p.from));
export const baseDays = (p: BasePattern) => Math.max(0, dayIndex(toLocal(p.base, p.to - 1)) - day0(p) + 1);
/** Day index (0-based, local days at the base) of a UTC minute. */
export const baseDayOf = (p: BasePattern, t: Minute) => dayIndex(toLocal(p.base, t)) - day0(p);
/** UTC minute of local midnight starting day k. */
export const baseDayStart = (p: BasePattern, k: number) => localToUTC(p.base, (day0(p) + k) * DAY);

/** All wave rotations of day k (before maintenance nights and drops); rotations outside [from, to) are dropped. */
export function dayRotations(p: BasePattern, typeId: string, k: number, slot: number): Rotation[] {
  const turn = typeOf(typeId).turnMin;
  const W = p.waves.length;
  const lm = (day0(p) + k) * DAY;
  const out: Rotation[] = [];
  let prevBack = -Infinity;
  for (let w = 0; w < W; w++) {
    const destIdx = (k * W + w + slot) % p.dests.length;
    const dest = p.dests[destIdx];
    const outStd = Math.max(localToUTC(p.base, lm + p.waves[w]), prevBack + turn);
    const outSta = outStd + blockMinutes(typeId, p.base, dest);
    const backStd = outSta + turn;
    const backSta = backStd + blockMinutes(typeId, dest, p.base);
    prevBack = backSta;
    if (outStd >= p.from && outStd < p.to) out.push({ k, w, dest, destIdx, outStd, outSta, backStd, backSta });
  }
  return out;
}

const flownCache = new WeakMap<BasePattern, Map<string, Rotation[][]>>();

/**
 * Rotations actually flown per day: maintenance night every maintEvery days (last wave, or the last two when one
 * still leaves less than an A-check + 2 h on the ground), then per calendar month n = round((F − T)/r) rotations
 * dropped evenly, last waves first, never on the first or last day (DESIGN §5.1.6). Cached per pattern object.
 */
export function flownRotations(p: BasePattern, typeId: string, slot = 0): Rotation[][] {
  let byKey = flownCache.get(p);
  if (!byKey) flownCache.set(p, (byKey = new Map()));
  const key = `${typeId}|${slot}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  const t = typeOf(typeId);
  const n = baseDays(p);
  const days: Rotation[][] = [];
  for (let k = 0; k < n; k++) days.push(dayRotations(p, typeId, k, slot));
  const minGround = t.aCheckHours * 60 + 120;
  if (p.maintEvery > 0) {
    for (let k = p.maintEvery - 1; k < n; k += p.maintEvery) {
      const d = days[k];
      if (!d.length) continue;
      d.pop();
      const nextFirst = days[k + 1]?.[0]?.outStd ?? baseDayStart(p, k + 1) + p.waves[0];
      if (d.length && nextFirst - d[d.length - 1].backSta < minGround) d.pop();
    }
  }
  // Monthly drops to targetBH (pro-rated).
  const months = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const m = monthKey(baseDayStart(p, k) + 12 * 60);
    const list = months.get(m) ?? [];
    list.push(k);
    months.set(m, list);
  }
  const rotMin = (r: Rotation) => r.outSta - r.outStd + (r.backSta - r.backStd);
  for (const [m, ks] of months) {
    const ms = monthStart(m);
    const me = monthStart(m + 1);
    const active = Math.max(0, Math.min(p.to, me) - Math.max(p.from, ms));
    const T = (p.targetBH * 60 * active) / (me - ms);
    let F = 0;
    let cnt = 0;
    for (const k of ks) for (const r of days[k]) {
      F += rotMin(r);
      cnt++;
    }
    if (!cnt) continue;
    const r = F / cnt;
    const eligible = ks.filter((k) => k !== 0 && k !== n - 1 && days[k].length);
    if (!eligible.length) continue;
    let drop = Math.max(0, Math.round((F - T) / r));
    drop = Math.min(drop, eligible.reduce((s, k) => s + days[k].length, 0));
    const E = eligible.length;
    eligible.forEach((k, j) => {
      const d = Math.floor(((j + 1) * drop) / E) - Math.floor((j * drop) / E);
      if (d > 0) days[k].splice(Math.max(0, days[k].length - d));
    });
  }
  byKey.set(key, days);
  return days;
}

export function firstDeparture(p: BasePattern, typeId: string, slot = 0): Minute | null {
  for (const d of flownRotations(p, typeId, slot)) if (d.length) return d[0].outStd;
  return null;
}

export function lastArrival(p: BasePattern, typeId: string, slot = 0): Minute | null {
  const days = flownRotations(p, typeId, slot);
  for (let k = days.length - 1; k >= 0; k--) if (days[k].length) return days[k][days[k].length - 1].backSta;
  return null;
}

/** Client flight number for a base rotation leg (deterministic per destination and wave). */
export function baseFlightNo(p: BasePattern, destIdx: number, w: number, back: boolean): string {
  const n = 1000 * (1 + (hash(p.prefix) % 8)) + ((destIdx * 20 + w * 2) % 1000) + (back ? 1 : 0);
  return `${p.prefix}${n}`;
}

/** Base pattern summary on a type (no legs materialised): window, block minutes, sectors, airports. */
export function planBase(p: BasePattern, typeId: string, slot = 0): Programme {
  const days = flownRotations(p, typeId, slot);
  let revenueMin = 0;
  let rotations = 0;
  for (const d of days) for (const r of d) {
    revenueMin += r.outSta - r.outStd + (r.backSta - r.backStd);
    rotations++;
  }
  const res: Programme = {
    ok: true, trips: [], techStops: [], shiftMin: 0, revenueMin, emptyMin: 0, longestChainMin: 0,
    airports: [p.base, ...p.dests], sectors: p.dests.flatMap((d) => [[p.base, d], [d, p.base]] as [string, string][]), base: { days: days.length, rotations }, chains: [],
  };
  // v0.7.3 crew chains: each sector of a rotation (the roster can always slip a crew at the far end).
  const rots: ChainShape[] = [];
  for (const d of days) for (const r of d) rots.push({ from: p.base, std: r.outStd, legs: [{ std: r.outStd, sta: r.outSta, from: p.base, to: r.dest }] }, { from: r.dest, std: r.backStd, legs: [{ std: r.backStd, sta: r.backSta, from: r.dest, to: p.base }] });
  res.chains = longestChains(rots);
  for (const [a, b] of res.sectors) {
    const sp = planSector(typeId, a, b);
    if (!sp.ok) return { ...res, ok: false, reason: `${a}–${b}: ${sp.reason === 'runway' ? 'runway' : 'range'}` };
    if (sp.techStops.length) return { ...res, ok: false, reason: `${a}–${b}: needs a fuel stop (a base rotation can't)` };
    res.longestChainMin = Math.max(res.longestChainMin, sp.legs[0].block);
  }
  const first = firstDeparture(p, typeId, slot);
  const last = lastArrival(p, typeId, slot);
  if (first === null || last === null) return { ...res, ok: false, reason: 'no rotations in the window' };
  res.trips.push({ legs: [], from: p.base, to: p.base, std: first, sta: last });
  return res;
}

/** Programme of an offer or contract on a type. */
export function programmeOf(src: Pick<ContractOffer | Contract, 'pattern' | 'requirements'>, typeId: string, slot = 0): Programme {
  return src.pattern.kind === 'base' ? planBase(src.pattern, typeId, slot) : planLegs(src.pattern, typeId, !!src.requirements.noTechStops);
}

/** Client legs sorted by departure (templates are stored in that order already). */
export function sortedLegs(legs: LegTemplate[]): LegTemplate[] {
  return [...legs].sort((a, b) => a.dep - b.dep);
}

// ---------- v0.8 fix pack: seats = passengers ----------

/** The most passengers on any leg of a legs pattern (0 for a base pattern: no passengers booked). Pure. */
export const maxPax = (p: SchedulePattern): number => (p.kind === 'legs' ? Math.max(0, ...p.legs.map((l) => l.pax ?? 0)) : 0);

/**
 * The seats a legs job needs: its most passengers on any leg, plus the only documented extra, six seats per stretcher
 * (medical). Base programmes (no passengers booked) keep their seat ask (`fallback`). Pure.
 */
export function seatNeed(p: SchedulePattern, stretchers = 0, fallback = 0): number {
  const pax = maxPax(p);
  return pax > 0 ? pax + 6 * stretchers : fallback;
}

/** '166 seats', '110 seats (62 passengers, 8 stretchers)'; a base programme '180+ seats'. Pure. */
export function seatNeedText(o: { pattern: SchedulePattern; requirements: Pick<Requirements, 'minSeats' | 'stretchers'> }): string {
  const pax = maxPax(o.pattern);
  const r = o.requirements;
  if (!pax) return `${r.minSeats}+ seats`;
  // Seats = passengers: no parenthesis repeating the number.
  if (r.minSeats === pax && !r.stretchers) return `${r.minSeats} seats`;
  return `${r.minSeats} seats (${pax} passenger${pax === 1 ? '' : 's'}${r.stretchers ? `, ${r.stretchers} stretcher${r.stretchers === 1 ? '' : 's'}` : ''})`;
}
