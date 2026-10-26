// v0.11 Operations — live disruptions (UPDATE 1, roadmap-v011.md). Each is a decision card in the existing queue
// (ops/events.ts ask: the pacing budget, the clock pause, the default at expiry), raised at most one at a time and
// only as often as the event director allows: optional ones (an ATC slot, a slow turnaround, weather diversions) in
// busy spells only; emergencies (medical, bird strike, a technical diversion, a crew member sick away) in any spell,
// rarely in a quiet one. A consequence that must be handled (a curfew about to be missed) is handled by operations
// with its default when no card may be raised (one Inbox note). Every roll is on a side stream (seed, kind, leg), so
// the main random sequence is untouched. Money goes through the ledger ('disruption'); crew limits stay with the crew
// engine (holds at the gate run through fdpOver / crewProblem; continuation legs are crewed by the roster).

import { AIRPORTS, AIRPORT_BY_CODE } from '../../data/airports';
import { CTOT_CAUSES, CURFEWS, DISRUPT, ISLAND, MAINLAND_EU, MEDICAL_EVENTS, TECH_CAUSES, TURN_CAUSES, WEATHER_CAUSES } from '../../data/opsData';
import { addFlight, flightsOf, markFlightsChanged, nextId, touchFlights } from '../core/entities';
import { haversine, interpolateGC } from '../core/geo';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { blockMinutes, runwayFit, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { hashUnit } from '../core/util';
import { divPos } from '../core/query';
import { DAY, dayStart, fmtDuration, fmtTime, localMinuteOfDay, yearOf } from '../core/time';
import type { ActionResult, Aircraft, Decision, DecisionOption, DisruptCause, DisruptKind, Flight, GameState, MaintenanceEvent, Minute, OpsState, SimEvent } from '../core/types';
import { bumpClient } from '../contracts/relations';
import { applyCrewFix, crewControl, flightCrewStatus, removeCrew } from '../crew';
import { crewName } from '../crew/generate';
import { emergencyFactor, OPS_LIVE, optionalFactor } from './director';
import { delayChain, moveFlight, pickRival, rivalFactor, subcharterCost, subcharterLegs, unitOf, cancelLegs } from './flights';
import { aogDecision, ask, autoDecide } from './events';
import { engineersAt } from './maintenance';
import { bumpReliable, contractOf, isRevenue, turnOf, usd } from './util';

// ---------- rates (per leg; yearly ≈ rate × ~2,000 legs for a three-aircraft fleet) ----------
// The ATC slot and the slow turnaround are not extra delays: they are the existing operational delay roll (ops/flights.ts
// rollDelay: 12 % of departures, 'ATC slot', 'Late ground handling', 'Catering', 'Fuelling') turned into a card when it
// is long enough to matter and the director allows a card; otherwise the delay simply happens as before.

/** The slow-turn causes of the delay roll, in plain words. */
const TURN_OF: Record<string, string> = { 'Late ground handling': 'Baggage loaders short-staffed', Catering: 'Catering truck late', Fuelling: 'Fuel bowser held up' };

export const RATES = {
  /** Weather at the destination closing it for a while (diversion), per revenue leg. */
  weather: 0.0008,
  /** In-flight medical event serious enough to ask (1 in ~600 flights has one; ~7 % divert). */
  medical: 0.0006,
  /** Precautionary technical diversion, per leg (× the aircraft's age factor). */
  technical: 0.00025,
  /** Reported bird strike per landing (FAA: ~13 per 10,000 movements; we ask on those needing an inspection). */
  birdStrike: 0.0012,
  /** A crew member sick at the hotel away from base, per duty reporting away. */
  sickAway: 0.003,
};

/** Decision kinds of this module (one open at a time). */
export const DISRUPT_KINDS = new Set(['ctot', 'turnaround', 'curfew', 'diversion', 'medical', 'divertOnward', 'birdStrike', 'sickAway']);
/** The emergencies (2 HI); the rest are 1 HI. */
export const EMERGENCY_KINDS = new Set(['diversion', 'medical', 'sickAway']);

// ---------- state ----------

export function opsState(g: GameState): OpsState {
  return (g.opsx ??= { counts: {}, ramp: [], audit: { next: g.started + 330 * DAY, findings: [], history: [], suspended: null }, pending: {} });
}

/** Counts one event of a kind in the calendar year. */
export function countOps(g: GameState, kind: string, n = 1): void {
  const y = yearOf(g.now);
  const c = (opsState(g).counts[y] ??= {});
  c[kind] = (c[kind] ?? 0) + n;
}

/** Side stream roll in [0, 1): the same leg always rolls the same. */
const roll = (g: GameState, key: string) => hashUnit(`${g.seed}:ops:${key}`);
const pickOf = <T>(g: GameState, key: string, xs: readonly T[]): T => xs[Math.floor(roll(g, key) * xs.length) % xs.length];
const span = (g: GameState, key: string, [lo, hi]: [number, number]) => Math.round(lo + roll(g, key) * (hi - lo));
const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const wide = (ac: Aircraft) => (typeOf(ac.typeId).body === 'wide' ? 1 : 0);
const hm = (min: number) => fmtDuration(Math.max(0, Math.round(min)));
/** Passengers on a leg: the booked count, else (ACMI: the client's load) about 85 % of the seats. */
const paxOf = (g: GameState, f: Flight) => f.pax ?? Math.round((f.aircraftId ? g.fleet[f.aircraftId]?.cabin.total ?? 0 : 0) * 0.85);
const ROLE_WORD: Record<string, string> = { CPT: 'captain', FO: 'first officer', CRP: 'relief pilot', PUR: 'purser', CC: 'cabin crew member' };
const isCharter = (g: GameState, f: Flight) => contractOf(g, f)?.product.kind === 'charter' || !f.contractId;

/** One disruption card open already (the queue: never two at once). */
export const disruptionOpen = (g: GameState) => g.decisions.some((d) => DISRUPT_KINDS.has(d.kind));

/**
 * Posts a disruption card through the pacing budget; with one already open, in a quiet spell (`optional`) or over
 * the budget, operations apply the default and say so in the Inbox.
 */
export function raise(g: GameState, d: Omit<Decision, 'id' | 't'>, opts: { optional: boolean }): Decision | null {
  countOps(g, d.kind);
  if (forcing) return ask(g, d, true);
  if (disruptionOpen(g) || (opts.optional && optionalFactor(g) === 0)) {
    autoDecide(g, d, 'Operations handled it');
    return null;
  }
  return ask(g, d);
}

/** Dev and tests: the next card is raised whatever the dice, the director and the queue say. */
let forcing = false;
const hit = (g: GameState, key: string, p: number) => forcing || roll(g, key) < p;

/** The card's four lines ride in the decision's data (problems/ops.ts builds the ProblemCard). */
function cardData(what: string, why: string, hurt: string, money: number, pax: number, delayMin: number): Record<string, string | number> {
  return { what, why, hurt, money: Math.round(money), pax, delayMin: Math.round(delayMin) };
}

// ---------- curfews ----------

/** True when a landing at `code` at `t` falls in its night curfew (`delayed` legs may use the grace). Pure. */
export function inCurfew(code: string, t: Minute, delayed = true): boolean {
  const c = CURFEWS[code];
  if (!c) return false;
  const m = localMinuteOfDay(code, t);
  const from = c.from + (delayed ? c.grace : 0);
  const inside = (x: number, a: number, b: number) => (a <= b ? x >= a && x < b : x >= a || x < b);
  return inside(m, from % 1440, c.to);
}

/** When a curfew at `code` that covers `t` ends (UTC). */
export function curfewEnd(code: string, t: Minute): Minute {
  const c = CURFEWS[code];
  if (!c) return t;
  let x = t;
  for (let i = 0; i < 48 && inCurfew(code, x, false); i++) x += 30;
  return x + 15;
}

// ---------- positions and alternates ----------

/** [lon, lat] of an airborne leg at t (diverted legs turn at div.at from the planned track). Pure. */
export function legPos(f: Flight, t: Minute): [number, number] {
  if (f.div) return divPos(f, t);
  const off = f.atd ?? f.std;
  const A = AIRPORT_BY_CODE[f.from];
  const B = AIRPORT_BY_CODE[f.to];
  const on = f.ata ?? f.eta ?? f.sta;
  return interpolateGC(A.lon, A.lat, B.lon, B.lat, Math.min(1, Math.max(0, (t - off) / Math.max(1, on - off))));
}

export interface AltOption {
  code: string;
  km: number;
  /** Minutes from now to on-blocks there. */
  min: number;
  runwayM: number;
  station: 'ours' | 'full' | 'adhoc';
  curfew: boolean;
  /** Road km to the planned destination (coach). */
  roadKm: number;
}

/** Up to `n` alternates around `near` for this aircraft, open at their arrival, best first. Pure. */
export function alternates(g: GameState, ac: Aircraft, near: [number, number], dest: string, maxKm: number, n = 3, exclude: string[] = [], from: [number, number] = near): AltOption[] {
  const t = typeOf(ac.typeId);
  const kmPerMin = (t.cruiseKt * 1.852) / 60;
  const D = AIRPORT_BY_CODE[dest];
  const out: (AltOption & { score: number })[] = [];
  for (let pass = 0; pass < 2 && out.length < n; pass++) {
    const lim = maxKm * (pass + 1);
    out.length = 0;
    for (const a of AIRPORTS) {
      if (a.code === dest || a.ice || a.size < 2 || exclude.includes(a.code) || runwayFit(ac.typeId, a.code) !== 'ok') continue;
      if (haversine(near[1], near[0], a.lat, a.lon) > lim) continue;
      const km = haversine(from[1], from[0], a.lat, a.lon);
      const min = Math.round(km / kmPerMin + 18);
      const curfew = inCurfew(a.code, g.now + min);
      if (curfew) continue;
      const station = engineersAt(g, ac.id, a.code) ? 'ours' : a.size >= 3 ? 'full' : 'adhoc';
      const road = D ? roadKm(a.code, dest) : Infinity;
      out.push({ code: a.code, km: Math.round(km), min, runwayM: a.runwayM, station, curfew, roadKm: road, score: km + (station === 'ours' ? -150 : station === 'full' ? 0 : 120) - a.size * 10 + (road <= 450 ? 0 : 90) });
    }
  }
  return out.sort((a, b) => a.score - b.score).slice(0, n).map(({ score: _s, ...x }) => x);
}

/**
 * Road km from a to b for a coach, or Infinity across the sea (islands, Great Britain and Ireland, another continent):
 * the same island, the same country, or both in mainland Europe. Pure.
 */
export function roadKm(a: string, b: string): number {
  const A = AIRPORT_BY_CODE[a];
  const B = AIRPORT_BY_CODE[b];
  if (!A || !B) return Infinity;
  const ia = ISLAND[a];
  const ib = ISLAND[b];
  const ok = ia || ib ? ia === ib : A.country === B.country || (MAINLAND_EU.has(A.country) && MAINLAND_EU.has(B.country));
  return ok ? Math.round(haversine(A.lat, A.lon, B.lat, B.lon) * 1.25) : Infinity;
}

/** Alternate option chips: time, runway, handling, road to the destination. */
function altChips(o: AltOption, dest: string): string[] {
  return [
    `${hm(o.min)} away`,
    `Runway ${(o.runwayM / 1000).toFixed(1)} km`,
    o.station === 'ours' ? 'Our station' : o.station === 'full' ? 'Full handling' : 'Handling ad hoc',
    o.roadKm <= 450 ? `Coach to ${city(dest)} ~${hm((o.roadKm / 70) * 60 + 30)}` : o.roadKm === Infinity ? 'No road: across the sea' : 'Too far by road',
  ];
}

const altLabel = (o: AltOption) => `Divert to ${city(o.code)} (${o.code})`;

// ---------- money helpers ----------

/** EU261 Art. 7 band for a sector (per passenger). */
export function eu261(from: string, to: string): number {
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  const km = A && B ? haversine(A.lat, A.lon, B.lat, B.lon) : 0;
  return km <= 1500 ? DISRUPT.eu261[0] : km <= 3500 ? DISRUPT.eu261[1] : DISRUPT.eu261[2];
}

/** Handling at an alternate: ours (contracted at our stations) / a full-service handler / ad hoc. */
const handlingAt = (ac: Aircraft, station: AltOption['station']) => Math.round(DISRUPT.handling[wide(ac)] * (station === 'adhoc' ? DISRUPT.adHocFactor : station === 'ours' ? 0.6 : 1));
const coachCost = (pax: number, km: number) => Math.ceil(Math.max(1, pax) / 50) * Math.round((DISRUPT.coachPer100km * Math.max(100, km)) / 100);
const hotelCost = (pax: number) => pax * (DISRUPT.hotelPax + 2 * DISRUPT.mealPax);
const crewOn = (f: Flight) => Math.max(2, f.crewIds.length);

// ---------- 1. departure slot (CTOT) ----------

/**
 * At the gate (first attempt): an ATC slot. Wait for it, file a longer route around the regulated sector (a better
 * slot, more fuel), or ask the client to move the day's later legs (no recovery cancels; relation −1).
 */
function ctotCard(g: GameState, f: Flight, ac: Aircraft, slot?: number): boolean {
  const key = `ctot:${f.id}:${f.std}`;
  if (slot === undefined && !forcing) return false;
  const cause = pickOf(g, `${key}:c`, CTOT_CAUSES);
  const wait = slot ?? 5 * Math.round(span(g, `${key}:m`, [40, 150]) / 5);
  const better = Math.max(10, 5 * Math.round((wait * 0.35) / 5));
  const extraBlock = span(g, `${key}:x`, [12, 25]);
  const t = typeOf(ac.typeId);
  const fuel = Math.round((extraBlock / 60) * t.fuelTBH * g.market.fuelPrice);
  const charter = isCharter(g, f);
  const later = flightsOf(g, ac.id).filter((x) => x.status === 'scheduled' && x !== f && x.std < f.std + DAY && x.std > f.std);
  const fdp = fdpNote(g, f, wait);
  const opts: DecisionOption[] = [
    { id: 'wait', label: 'Wait for the slot', desc: `Off blocks about ${fmtTime(g.now + wait)} UTC. ATC delays are not our fault: no penalty.`, chips: [`${hm(wait)} late`, ...(later.length ? [`${later.length} later leg${later.length > 1 ? 's' : ''} move`] : []), ...(fdp ? [fdp] : [])] },
    { id: 'reroute', label: 'File a longer route', desc: `A routing around the busy sector gets a slot in ${hm(better)}; ${extraBlock} min more flying.`, tone: 'good', chips: [`${hm(better)} late`, `${extraBlock} min more flying`, charter ? usd(-fuel) : 'Client pays the fuel'] },
  ];
  if (later.length) opts.push({ id: 'client', label: 'Ask the client to move later legs', desc: 'They agree to the later times: no recovery cancels today, but they notice.', chips: [`${hm(wait)} late`, 'Relation −1'] });
  raise(g, {
    kind: 'ctot', title: `${f.no}: ATC slot ${hm(wait)} late`,
    body: `${cause}. Eurocontrol gave ${f.no} ${f.from}–${f.to} a departure slot (CTOT) ${hm(wait)} after its time.`,
    options: opts, defaultOption: wait > 90 ? 'reroute' : 'wait', expires: g.now + 20, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, wait, better, extraBlock, fuel, cause, ...cardData(`${f.no} has an ATC slot ${hm(wait)} late`, `${cause}: Eurocontrol holds the flight on the ground until its slot.`, `${paxOf(g, f)} passengers ${hm(wait)} late${later.length ? `, ${later.length} later legs` : ''}; no penalty (ATC)`, charter ? 0 : 0, paxOf(g, f), wait) },
  }, { optional: true });
  f.ops = 'ctot';
  return true;
}

/** A crew note for a hold of `min` at the gate: within the duty / commander's discretion / a fresh crew. Pure. */
function fdpNote(g: GameState, f: Flight, min: number): string | null {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d) return null;
  const last = g.flights[d.flightIds[d.flightIds.length - 1]];
  if (!last) return null;
  const end = Math.max(g.now, d.report) + min + Math.max(f.block, last.sta - f.std);
  const fdp = end - d.report;
  if (fdp <= d.maxFdp) return null;
  return fdp <= d.maxFdp + 120 ? "Crew: commander's discretion" : 'Crew out of hours: a fresh crew';
}

function resolveCtot(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  if (!f || f.status !== 'scheduled') return { ok: true, msg: 'The flight has gone' };
  const wait = Number(d.data?.wait ?? 60);
  const reason = `ATC slot: ${String(d.data?.cause ?? 'flow control')}`;
  if (opt === 'reroute') {
    const better = Number(d.data?.better ?? 20);
    if (isCharter(g, f)) post(g, 'fuel', -Number(d.data?.fuel ?? 0));
    delayChain(g, f, g.now + better, reason);
    return { ok: true, msg: `${f.no} files a longer route, off blocks ${fmtTime(g.now + better)} UTC` };
  }
  if (opt === 'client') {
    const later = flightsOf(g, f.aircraftId!).filter((x) => x.status === 'scheduled' && x.std >= f.std && x.std < f.std + DAY);
    for (const x of later) x.lateOk = Math.max(x.lateOk ?? 0, wait + (x.std - (x.schedStd ?? x.std)));
    bumpClient(g, contractOf(g, f)?.clientId, -1, `Asked to move ${f.no} and the later legs`);
    delayChain(g, f, g.now + wait, reason, false);
    return { ok: true, msg: `The client moved today's later legs; ${f.no} waits for its slot` };
  }
  delayChain(g, f, g.now + wait, reason);
  return { ok: true, msg: `${f.no} waits for its slot, off blocks ${fmtTime(g.now + wait)} UTC` };
}

// ---------- 2. turnaround ----------

/**
 * A tight turn runs late (cleaning, catering, fuel, boarding). Mostly automatic: a short slip is just taken. A card
 * only when it matters (≥ 25 min, or a penalty, a crew limit or a curfew in reach): pay extra handling or accept it.
 */
/** The turn into f was within 20 min of the type's minimum. Pure. */
function tightTurn(g: GameState, f: Flight, ac: Aircraft): boolean {
  const prev = flightsOf(g, ac.id).filter((x) => x.status === 'done' && x.to === f.from && x.ata !== undefined).at(-1);
  return !!prev?.ata && f.std + f.delay - (prev.ata + turnOf(ac)) <= 20;
}

function turnCard(g: GameState, f: Flight, ac: Aircraft, slow?: { min: number; reason: string }): boolean {
  if (!isRevenue(f) || (!slow && !forcing)) return false;
  const key = `turn:${f.id}:${f.std}`;
  const cause = slow ? (TURN_OF[slow.reason] ?? slow.reason) : pickOf(g, `${key}:c`, TURN_CAUSES);
  const late = slow?.min ?? span(g, `${key}:m`, [15, 45]);
  const cost = DISRUPT.rushTurn[wide(ac)];
  const c = contractOf(g, f);
  const penalty = !!c && ((c.product.kind === 'charter' && late >= 60) || c.requirements.standards === 'vip');
  const fdp = fdpNote(g, f, late);
  const curfew = inCurfew(f.to, g.now + late + f.block) && !inCurfew(f.to, g.now + f.block);
  const matters = late >= 25 || penalty || !!fdp || curfew;
  if (!forcing && (!matters || optionalFactor(g) === 0 || disruptionOpen(g))) return false;
  f.ops = 'turnaround';
  raise(g, {
    kind: 'turnaround', title: `${f.no}: turnaround running ${late} min late`,
    body: `${cause} at ${city(f.from)}. ${ac.reg} turned in ${turnOf(ac)} minutes, the type's minimum.`,
    options: [
      { id: 'pay', label: 'Pay for extra handling', desc: 'A second team and a priority fuel truck: off blocks almost on time.', tone: 'good', chips: [usd(-cost), '5 min late'] },
      { id: 'accept', label: 'Accept the delay', desc: 'The later legs move with it.', chips: [`${late} min late`, ...(fdp ? [fdp] : []), ...(curfew ? [`Curfew at ${f.to}`] : []), ...(penalty ? ['Delay penalty'] : [])] },
    ],
    defaultOption: penalty || curfew || fdp || late >= 35 ? 'pay' : 'accept', expires: g.now + 15, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, late, cost, cause, ...cardData(`${f.no} turnaround is ${late} min late`, `${cause}: the turn was already at the ${typeOf(ac.typeId).short}'s minimum.`, `${paxOf(g, f)} passengers ${late} min late${penalty ? ', delay penalty' : ''}`, penalty ? (c?.penalties.perDelay ?? 0) : 0, paxOf(g, f), late) },
  }, { optional: true });
  return true;
}

function resolveTurn(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  if (!f || f.status !== 'scheduled') return { ok: true, msg: 'The flight has gone' };
  const cause = String(d.data?.cause ?? 'Handling').toLowerCase();
  if (opt === 'pay') {
    post(g, 'disruption', -Number(d.data?.cost ?? 0));
    delayChain(g, f, g.now + 5, `Late ground handling: ${cause}`);
    return { ok: true, msg: `Extra handling for ${f.no}: off blocks in 5 minutes` };
  }
  delayChain(g, f, g.now + Number(d.data?.late ?? 20), `Late ground handling: ${cause}`);
  return { ok: true, msg: `${f.no} leaves ${d.data?.late} min late` };
}

// ---------- 3. curfew ----------

/** The best open airport near a curfew airport for this aircraft at `t` (not curfewed). */
function curfewAlt(g: GameState, ac: Aircraft, code: string, t: Minute): AltOption | null {
  const A = AIRPORT_BY_CODE[code];
  if (!A) return null;
  return alternates(g, ac, [A.lon, A.lat], code, 250, 4).find((o) => !inCurfew(o.code, t) && o.roadKm <= 450) ?? null;
}

/**
 * At the gate: this leg would now land in its destination's night curfew (and was planned before it). Rush (only
 * when the turn is what made it late and rushing saves enough), land at a nearby open airport and coach the
 * passengers, night-stop here and fly at the curfew's end, or cancel.
 */
function curfewCard(g: GameState, f: Flight, ac: Aircraft): boolean {
  if ((!CURFEWS[f.to] && !forcing) || f.ops === 'curfew' || f.div || !isRevenue(f)) return false;
  const eta = g.now + f.block;
  const planned = f.schedStd !== undefined ? f.schedStd + f.block : f.sta;
  if (!forcing && (!inCurfew(f.to, eta, true) || inCurfew(f.to, planned, false))) return false;
  f.ops = 'curfew';
  const end = curfewEnd(f.to, eta);
  const alt = curfewAlt(g, ac, f.to, g.now + f.block + 20);
  const pax = paxOf(g, f);
  const charter = isCharter(g, f);
  const rush = span(g, `cur:${f.id}:r`, DISRUPT.rushSaves);
  const rushOk = !inCurfew(f.to, eta - rush, true);
  const night = end - f.block;
  const opts: DecisionOption[] = [];
  if (rushOk) opts.push({ id: 'rush', label: 'Rush it out now', desc: `Priority handling and a quick boarding gain ${rush} min: lands before the curfew.`, tone: 'good', chips: [usd(-DISRUPT.rushTurn[wide(ac)] * 1.5), 'Lands in time'] });
  if (alt) {
    const bus = coachCost(pax, alt.roadKm);
    opts.push({ id: 'divert', label: `Land at ${city(alt.code)} instead`, desc: `${alt.code} is open; passengers go on by coach (${alt.roadKm} km). The aircraft repositions in the morning.`, chips: [charter ? usd(-(bus + handlingAt(ac, alt.station))) : 'Client pays the coaches', `Coach ~${hm((alt.roadKm / 70) * 60 + 30)}`, 'Relation −1'] });
  }
  opts.push({ id: 'night', label: 'Night-stop, fly at first light', desc: `Hotels here for passengers and crew; off blocks ${fmtTime(night)} UTC to land as ${f.to} opens.`, chips: [charter ? usd(-(hotelCost(pax) + crewOn(f) * DISRUPT.crewRoom)) : usd(-crewOn(f) * DISRUPT.crewRoom), `${hm(night - g.now)} late`, 'Relation −1'] });
  opts.push({ id: 'cancel', label: 'Cancel the leg', desc: 'Compensation to the client and a reliability hit.', tone: 'bad', chips: ['Reliability −3'] });
  const def = rushOk ? 'rush' : alt ? 'divert' : 'night';
  raise(g, {
    kind: 'curfew', title: `${f.no} would land in the ${f.to} curfew`,
    body: `${CURFEWS[f.to]?.note ?? 'Night curfew'}. Leaving now, ${f.no} lands about ${fmtTime(eta)} UTC.`,
    options: opts, defaultOption: def, expires: g.now + 20, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, alt: alt?.code ?? '', roadKm: alt?.roadKm ?? 0, station: alt?.station ?? 'adhoc', night, rush, ...cardData(`${f.no} would land after ${city(f.to)} closes for the night`, `Delays today pushed its arrival into the night curfew (${(CURFEWS[f.to]?.note ?? 'night curfew').toLowerCase()}).`, `${pax} passengers: a coach, a night stop or a cancellation`, 0, pax, 60) },
  }, { optional: false });
  return true;
}

function resolveCurfew(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has gone' };
  const pax = paxOf(g, f);
  const charter = isCharter(g, f);
  const c = contractOf(g, f);
  switch (opt) {
    case 'rush':
      post(g, 'disruption', -Math.round(DISRUPT.rushTurn[wide(ac)] * 1.5));
      if (f.delay > 0) delayChain(g, f, g.now + 5, f.delayReason ?? 'Late ground handling');
      return { ok: true, msg: `${f.no} rushed out` };
    case 'divert': {
      const alt = String(d.data?.alt ?? '');
      if (!alt || !AIRPORT_BY_CODE[alt]) return { ok: false, error: 'No open airport nearby' };
      const to0 = f.to;
      rerouteLeg(g, f, alt, 'weather');
      f.div = { to0, at: g.now, eta0: f.sta, cause: 'weather' };
      const bus = coachCost(pax, Number(d.data?.roadKm ?? 100));
      if (charter) post(g, 'disruption', -(bus + handlingAt(ac, (String(d.data?.station) as AltOption['station']) || 'adhoc')));
      bumpClient(g, c?.clientId, -1, `${f.no} landed at ${alt} for the ${to0} curfew`);
      countOps(g, 'curfewDivert');
      return { ok: true, msg: `${f.no} lands at ${city(alt)}; coaches to ${city(to0)}` };
    }
    case 'night': {
      const night = Math.max(g.now + 60, f.std + f.delay + 30, Number(d.data?.night ?? g.now + 8 * 60));
      if (charter) post(g, 'disruption', -hotelCost(pax));
      post(g, 'hotels', -crewOn(f) * DISRUPT.crewRoom);
      f.lateOk = Math.max(f.lateOk ?? 0, night - (f.schedStd ?? f.std));
      moveFlight(g, f, night, `Night stop: ${f.to} curfew`);
      bumpClient(g, c?.clientId, -1, `${f.no} night-stopped for the ${f.to} curfew`);
      return { ok: true, msg: `${f.no} night-stops, off blocks ${fmtTime(night)} UTC` };
    }
    case 'cancel': {
      const n = cancelLegs(g, [f], `Curfew at ${f.to}`, 3);
      return { ok: true, msg: `${f.no} cancelled, ${usd(n)} compensation` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

/** A scheduled leg flies to another airport (pre-departure): block, sta and events follow; crew duties re-sync. */
function rerouteLeg(g: GameState, f: Flight, to: string, _why: DisruptCause): void {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return;
  const b = blockMinutes(ac.typeId, f.from, to);
  markFlightsChanged(g, ac.id, f.std);
  f.to = to;
  f.block = b;
  f.sta = f.std + b;
  f.ev++;
  schedule(g, Math.max(g.now, f.std + f.delay), 'flight.dep', f.id, f.ev);
  touchFlights(g);
}

// ---------- 4. diversions en route (weather, medical, technical) ----------

/** At off-blocks: a weather closure, a medical event or a technical fault later in the flight (queued as 'ops.event'). */
export function rollEnRoute(g: GameState, f: Flight, ac: Aircraft): void {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt || !isRevenue(f) || f.div || f.contOf || f.ops) return;
  const key = `air:${f.id}:${f.std}`;
  const em = emergencyFactor(g);
  const age = 1 + Math.max(0, yearOf(g.now) - ac.builtYear) / 15;
  const pW = RATES.weather * optionalFactor(g);
  const pM = RATES.medical * em * Math.max(0.5, paxOf(g, f) / 180);
  const pT = RATES.technical * em * age;
  const r = roll(g, key);
  let kind: DisruptCause | null = null;
  if (r < pW) kind = 'weather';
  else if (r < pW + pM) kind = 'medical';
  else if (r < pW + pM + pT) kind = 'technical';
  if (!kind) return;
  const eta = f.eta ?? f.sta;
  const at = kind === 'weather' ? Math.max(g.now + 20, eta - 25) : g.now + Math.round((eta - g.now) * (0.2 + 0.6 * roll(g, `${key}:t`)));
  const id = nextId(g, 'op');
  opsState(g).pending[id] = { kind: kind === 'medical' ? 'medical' : 'diversion', flightId: f.id, t: at, cause: kind };
  f.ops = kind === 'medical' ? 'medical' : 'diversion';
  schedule(g, at, 'ops.event', id);
}

/** 'ops.event': a timed disruption fires (mid-flight card, a sick call at the hotel). */
export function onOpsEvent(g: GameState, ev: SimEvent): void {
  const st = opsState(g);
  const p = st.pending[ev.id];
  if (!p) return;
  delete st.pending[ev.id];
  if (p.kind === 'sickCall') return sickCall(g, p.dutyId ?? '');
  const f = p.flightId ? g.flights[p.flightId] : undefined;
  if (!f || f.status !== 'enroute' || f.div) return;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return;
  const cause: DisruptCause = p.cause ?? (p.kind === 'medical' ? 'medical' : 'weather');
  if (cause === 'medical') medicalCard(g, f, ac);
  else diversionCard(g, f, ac, cause);
}

function diversionCard(g: GameState, f: Flight, ac: Aircraft, cause: 'weather' | 'technical'): void {
  const key = `div:${f.id}`;
  const P = legPos(f, g.now);
  const D = AIRPORT_BY_CODE[f.to];
  // Weather: alternates around the closed destination (the flight plan's alternates); technical: the nearest suitable.
  const alts = cause === 'weather' ? alternates(g, ac, [D.lon, D.lat], f.to, 350, 3, [], P) : alternates(g, ac, P, f.to, 600, 3);
  if (cause === 'technical' && haversine(P[1], P[0], AIRPORT_BY_CODE[f.from].lat, AIRPORT_BY_CODE[f.from].lon) < 500 && !alts.some((a) => a.code === f.from)) {
    const A = AIRPORT_BY_CODE[f.from];
    const km = Math.round(haversine(P[1], P[0], A.lat, A.lon));
    alts.unshift({ code: f.from, km, min: Math.round(km / ((typeOf(ac.typeId).cruiseKt * 1.852) / 60) + 18), runwayM: A.runwayM, station: engineersAt(g, ac.id, f.from) ? 'ours' : A.size >= 3 ? 'full' : 'adhoc', curfew: false, roadKm: roadKm(f.from, f.to) });
    alts.length = Math.min(alts.length, 3);
  }
  if (!alts.length) return;
  const what = cause === 'weather' ? pickOf(g, `${key}:w`, WEATHER_CAUSES) : pickOf(g, `${key}:t`, TECH_CAUSES);
  const pax = paxOf(g, f);
  const opts: DecisionOption[] = alts.map((o) => ({ id: `alt:${o.code}`, label: o.code === f.from ? `Return to ${city(o.code)} (${o.code})` : altLabel(o), desc: `${AIRPORT_BY_CODE[o.code]?.name ?? o.code}: ${o.station === 'ours' ? 'our engineers and handling' : o.station === 'full' ? 'a full-service handler, hotels nearby' : 'handling at short notice, dearer'}.`, tone: o.station === 'adhoc' ? 'warn' : 'good', chips: altChips(o, f.to) }));
  if (cause === 'weather') opts.unshift({ id: 'hold', label: 'Hold for 30 minutes', desc: 'Circle and wait for the weather to lift; fuel for about 40 minutes of holding. If it does not, divert to the first alternate.', tone: 'warn', chips: ['Half the time it clears', '30 min more'] });
  raise(g, {
    kind: 'diversion', title: cause === 'weather' ? `${f.no}: ${city(f.to)} closed by weather` : `${f.no}: technical problem en route`,
    body: cause === 'weather' ? `${what} at ${city(f.to)}. ${ac.reg} must hold or divert.` : `${what} on ${ac.reg}. The captain wants to land at the nearest suitable airport.`,
    options: opts, defaultOption: opts.find((o) => o.id.startsWith('alt:'))!.id, expires: g.now + 15, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, cause, what, ...cardData(cause === 'weather' ? `${f.no} cannot land at ${city(f.to)}` : `${f.no} has a technical problem in flight`, cause === 'weather' ? `${what}; the destination is below the landing limits.` : `${what}; the checklist says land at the nearest suitable airport.`, `${pax} passengers to look after${cause === 'technical' && isCharter(g, f) ? ', compensation if over 3 h late (EU261)' : ''}`, 0, pax, 120) },
  }, { optional: cause === 'weather' });
}

function medicalCard(g: GameState, f: Flight, ac: Aircraft): void {
  const key = `med:${f.id}`;
  const ev = pickOf(g, `${key}:e`, MEDICAL_EVENTS);
  const P = legPos(f, g.now);
  const left = Math.max(5, (f.eta ?? f.sta) - g.now);
  const alts = alternates(g, ac, P, f.to, 500, 3).filter((o) => o.min < left - 10);
  const opts: DecisionOption[] = [];
  opts.push({ id: 'continue', label: `Continue to ${city(f.to)}`, desc: `${hm(left)} to go; an ambulance meets the aircraft.`, tone: left <= 50 ? 'good' : 'warn', chips: [`${hm(left)} to go`, left > 60 && ev.severe ? 'Risk to the passenger' : 'No extra cost'] });
  for (const o of alts) opts.push({ id: `alt:${o.code}`, label: altLabel(o), desc: `${AIRPORT_BY_CODE[o.code]?.name ?? o.code}: paramedics meet the aircraft; about ${DISRUPT.medicalGround} min on the ground, then on to ${city(f.to)}.`, tone: 'good', chips: altChips(o, f.to) });
  const best = alts[0];
  const def = !best || left <= 50 || !ev.severe ? 'continue' : `alt:${best.code}`;
  raise(g, {
    kind: 'medical', title: `${f.no}: medical emergency on board`,
    body: `${ev.what}. The purser called for a doctor; the captain is talking to the medical service on the ground.`,
    options: opts, defaultOption: def, expires: g.now + 10, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, severe: ev.severe, what: ev.what, ...cardData(`A passenger on ${f.no} needs a hospital`, `${ev.what}.`, ev.severe ? 'A life may depend on it; a diversion costs time and money, never a penalty' : 'Probably stable; the doctor on board is helping', 0, paxOf(g, f), ev.severe ? 90 : 0) },
  }, { optional: false });
}

/** Turns an airborne leg to `alt` now (the map turns it from where it is). */
export function divertNow(g: GameState, f: Flight, alt: string, cause: DisruptCause): void {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac || f.status !== 'enroute') return;
  const P = legPos(f, g.now);
  const A = AIRPORT_BY_CODE[alt];
  const km = haversine(P[1], P[0], A.lat, A.lon);
  const min = Math.round(km / ((typeOf(ac.typeId).cruiseKt * 1.852) / 60) + 18);
  const eta0 = f.eta ?? f.sta;
  markFlightsChanged(g, ac.id, f.std);
  f.div = { to0: f.to, at: g.now, eta0, cause };
  f.to = alt;
  f.eta = g.now + min;
  f.sta = f.eta;
  f.block = f.sta - f.std;
  f.ev++;
  schedule(g, f.eta, 'flight.arr', f.id, f.ev);
  touchFlights(g);
  countOps(g, cause === 'medical' ? 'medicalDivert' : cause === 'technical' ? 'techDivert' : 'weatherDivert');
  pushMessage(g, {
    tone: 'warn', cat: 'ops', title: `${f.no} diverting to ${city(alt)}`, cue: null,
    body: `${ac.reg} turned for ${alt} (planned ${f.div.to0}); on blocks about ${fmtTime(f.eta)} UTC.`, ref: { kind: 'flight', id: f.id },
  });
}

function resolveDiversion(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  if (!f || f.status !== 'enroute') return { ok: true, msg: 'The flight has landed' };
  const cause = String(d.data?.cause ?? 'weather') as DisruptCause;
  if (opt === 'hold') {
    const clears = roll(g, `hold:${f.id}`) < 0.5;
    const ev = (f.eta ?? f.sta) + 30;
    f.eta = Math.max(ev, g.now + 30);
    f.sta = Math.max(f.sta, f.eta);
    f.ev++;
    schedule(g, f.eta, 'flight.arr', f.id, f.ev);
    touchFlights(g);
    if (clears) return { ok: true, msg: `The weather lifted: ${f.no} lands at ${city(f.to)} 30 min late` };
    const first = d.options.find((o) => o.id.startsWith('alt:'));
    if (first) divertNow(g, f, first.id.slice(4), cause);
    return { ok: true, msg: `It did not clear: ${f.no} diverts after holding` };
  }
  if (!opt.startsWith('alt:')) return { ok: false, error: 'Unknown option' };
  divertNow(g, f, opt.slice(4), cause);
  if (cause === 'technical') bumpReliable(g, -0.5);
  return { ok: true, msg: `${f.no} diverts to ${city(opt.slice(4))}` };
}

function resolveMedical(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  if (!f || f.status !== 'enroute') return { ok: true, msg: 'The flight has landed' };
  const severe = !!d.data?.severe;
  const c = contractOf(g, f);
  if (opt === 'continue') {
    const left = (f.eta ?? f.sta) - g.now;
    // A severe case far from the destination: the outcome is worse more often (press, clean name, the client).
    const bad = severe && left > 60 && roll(g, `medbad:${f.id}`) < 0.35;
    if (bad) {
      const r = g.company.reputation;
      r.clean = Math.max(0, r.clean - 3);
      bumpClient(g, c?.clientId, -3, `A passenger on ${f.no} was not diverted for`);
      countOps(g, 'medicalBad');
      pushMessage(g, { tone: 'bad', cat: 'ops', title: `${f.no}: the passenger was in a bad way on arrival`, body: `The flight continued ${hm(left)} to ${city(f.to)}. The papers ask why it did not divert. Clean name −3, client relation −3.`, ref: { kind: 'flight', id: f.id }, problem: { kind: 'disruption', ref: { kind: 'flight', id: f.id } }, hurt: { money: 0, pax: 1, delayMin: 0, level: 'high' } });
    }
    return { ok: true, msg: `${f.no} continues to ${city(f.to)}` };
  }
  if (!opt.startsWith('alt:')) return { ok: false, error: 'Unknown option' };
  divertNow(g, f, opt.slice(4), 'medical');
  if (severe) {
    const r = g.company.reputation;
    r.clean = Math.min(100, r.clean + 1);
    bumpClient(g, c?.clientId, 1, `${f.no} diverted for a sick passenger`);
  }
  return { ok: true, msg: `${f.no} diverts to ${city(opt.slice(4))} for the passenger` };
}

/** On blocks at an alternate: the onward card (fly on today, coach, hotel and fly in the morning). */
export function onDivertedArrival(g: GameState, f: Flight): void {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac || !f.div || f.to === f.div.to0) return;
  const to0 = f.div.to0;
  const cause = f.div.cause;
  const alt = f.to;
  const pax = Math.max(0, paxOf(g, f) - (cause === 'medical' ? 2 : 0));
  const charter = isCharter(g, f);
  const t = typeOf(ac.typeId);
  const block = blockMinutes(ac.typeId, alt, to0);
  const road = roadKm(alt, to0);
  const station: AltOption['station'] = engineersAt(g, ac.id, alt) ? 'ours' : AIRPORT_BY_CODE[alt].size >= 3 ? 'full' : 'adhoc';
  // Our costs at the alternate now: handling and the extra fuel (charters; ACMI clients pay fuel and handling).
  if (charter) {
    const extra = Math.max(0, (f.ata ?? g.now) - (f.div.eta0 ?? g.now)) + 30;
    post(g, 'disruption', -handlingAt(ac, station));
    post(g, 'fuel', -Math.round((extra / 60) * t.fuelTBH * g.market.fuelPrice));
  }
  if (cause === 'medical') post(g, 'disruption', -1_500);
  const ground = cause === 'medical' ? DISRUPT.medicalGround : cause === 'weather' ? span(g, `wx:${f.id}`, [60, 180]) : 0;
  // Technical: the aircraft stays for an inspection and a fix by a local contractor.
  let fixEnd = g.now;
  if (cause === 'technical') {
    const hrs = span(g, `fix:${f.id}`, [4, 20]);
    fixEnd = lineMx(g, ac, alt, hrs * 60, Math.round(span(g, `fixc:${f.id}`, [6_000, 25_000]) / 100) * 100, `Inspection after ${String(f.delayReason ?? 'a technical diversion').toLowerCase()}`);
  }
  const fdpLeft = crewLeft(g, f);
  const sameCrew = fdpLeft !== null && fdpLeft >= ground + block + 30;
  const flyAt = Math.max(g.now + Math.max(45, ground), fixEnd + 30);
  const morning = Math.max(g.now + 12 * 60, fixEnd + 30);
  const next = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.from === to0 && x.std >= (f.schedStd ?? f.std));
  const opts: DecisionOption[] = [];
  if (cause !== 'technical' || fixEnd < g.now + 6 * 60) {
    opts.push({ id: 'flyOn', label: `Fly on to ${city(to0)} ${cause === 'technical' ? 'after the fix' : 'today'}`, desc: `Refuel, ${cause === 'weather' ? 'wait for the weather to lift' : cause === 'medical' ? 'hand the patient to the ambulance' : 'fix it'}, then ${hm(block)} to ${to0}.`, tone: 'good', chips: [`Off ${fmtTime(flyAt)} UTC`, sameCrew ? 'Same crew, within their day' : 'Crew out of hours: a fresh crew', charter ? usd(-(2 * DISRUPT.mealPax * pax)) : 'Client pays fuel'] });
  }
  if (road <= 450) opts.push({ id: 'bus', label: 'Coach the passengers', desc: `${Math.ceil(Math.max(1, pax) / 50)} coaches, ${road} km to ${city(to0)}. The aircraft repositions empty.`, chips: [charter ? usd(-coachCost(pax, road)) : 'Client pays the coaches', `~${hm((road / 70) * 60 + 45)} by road`, 'Relation −1'] });
  opts.push({ id: 'hotel', label: 'Hotels tonight, fly in the morning', desc: `Passengers and crew to hotels in ${city(alt)}; the crew get their legal rest, then fly to ${to0}.`, chips: [charter ? usd(-(hotelCost(pax) + crewOn(f) * DISRUPT.crewRoom)) : usd(-crewOn(f) * DISRUPT.crewRoom), `Off ${fmtTime(morning)} UTC`, 'Relation −1'] });
  if (cause === 'technical') opts.push({ id: 'subcharter', label: 'A rival flies the passengers on', desc: 'Another operator sends an aircraft; our aircraft stays for the fix.', tone: 'warn', chips: [usd(-subcharterCost(g, [f], 1.3)), 'Fast'] });
  const def = opts[0].id === 'flyOn' && sameCrew ? 'flyOn' : road <= 300 ? 'bus' : 'hotel';
  const late = Math.max(0, flyAt + block - (f.div.eta0 ?? f.sta));
  raise(g, {
    kind: 'divertOnward', title: `${f.no} on the ground at ${city(alt)}`,
    body: `${pax} passengers for ${city(to0)}${next ? `; ${next.no} from ${to0} is due ${fmtTime(next.std)} UTC` : ''}.`,
    options: opts, defaultOption: def, expires: g.now + 30, ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, to0, alt, cause, pax, roadKm: Number.isFinite(road) ? road : 0, flyAt, morning, block, ...cardData(`${pax} passengers are in ${city(alt)}, not ${city(to0)}`, cause === 'weather' ? 'The weather closed the destination.' : cause === 'medical' ? 'We landed for a sick passenger.' : 'A technical problem made us land.', `${pax} passengers at least ${hm(late)} late${cause === 'technical' && isCharter(g, f) ? '; EU261 compensation over 3 h' : ''}`, 0, pax, late) },
  }, { optional: false });
}

/** FDP minutes left for the crew of f's duty at now (null: no duty). Pure. */
function crewLeft(g: GameState, f: Flight): number | null {
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (!d) return null;
  return d.maxFdp + 60 - (g.now - d.report);
}

/** An unplanned line maintenance event at `at` (inspection, a fix); the aircraft is unavailable until it ends. */
export function lineMx(g: GameState, ac: Aircraft, at: string, min: number, cost: number, cause: string, cat: 'disruption' | 'maintenance' = 'disruption'): Minute {
  const m: MaintenanceEvent = { id: nextId(g, 'mx'), aircraftId: ac.id, kind: 'line', at, start: g.now, end: g.now + min, cost: 0, status: 'inWork', planned: false, cause, ev: 0 };
  g.maintenance[m.id] = m;
  if (cost) post(g, cat, -cost);
  ac.status = 'maintenance';
  ac.maintId = m.id;
  schedule(g, m.end, 'maint.end', m.id, m.ev);
  touchFlights(g);
  return m.end;
}

function resolveOnward(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || !f.div) return { ok: true };
  const to0 = String(d.data?.to0);
  const alt = String(d.data?.alt);
  const pax = Number(d.data?.pax ?? 0);
  const charter = isCharter(g, f);
  const c = contractOf(g, f);
  const cause = String(d.data?.cause) as DisruptCause;
  const block = Number(d.data?.block ?? blockMinutes(ac.typeId, alt, to0));
  const cont = (std: Minute) => {
    const x = addFlight(g, { no: f.no, aircraftId: ac.id, contractId: f.contractId, kind: 'revenue', from: alt, to: to0, std, sta: std + block, pax });
    x.contOf = f.id;
    f.contOf = x.id;
    x.lateOk = Math.max(0, std - (f.schedStd ?? f.std));
    // The aircraft's later legs from the planned destination follow (turn minima kept, the usual recovery).
    const next = flightsOf(g, ac.id).find((y) => y.status === 'scheduled' && y !== x && y.from === to0 && y.std >= f.std);
    if (next && next.std < x.sta + turnOf(ac)) delayChain(g, next, x.sta + turnOf(ac), cause === 'technical' ? 'Technical: diversion' : cause === 'medical' ? 'Medical diversion' : 'Weather: diversion', cause === 'technical');
    return x;
  };
  const comp = () => {
    // EU261: a technical diversion is ours (not extraordinary; C-549/07): 3 h+ late on a charter we operate.
    if (cause !== 'technical') return 0;
    const v = pax * eu261(f.from, to0);
    if (charter) post(g, 'penalties', -v);
    else bumpClient(g, c?.clientId, -2, `${f.no}: their passengers' compensation after our technical diversion`);
    return charter ? v : 0;
  };
  switch (opt) {
    case 'flyOn': {
      const at = Number(d.data?.flyAt ?? g.now + 60);
      if (charter) post(g, 'disruption', -2 * DISRUPT.mealPax * pax);
      const x = cont(at);
      if (at + block - (f.div.eta0 ?? f.sta) >= 180) comp();
      bumpClient(g, c?.clientId, 1, `${f.no} flew on to ${to0} the same day`);
      return { ok: true, msg: `${x.no} flies on ${alt}–${to0} at ${fmtTime(at)} UTC` };
    }
    case 'bus': {
      const km = Number(d.data?.roadKm ?? 200);
      if (charter) post(g, 'disruption', -coachCost(pax, km));
      if ((km / 70) * 60 + 45 >= 180) comp();
      bumpClient(g, c?.clientId, -1, `${f.no}: passengers coached from ${alt}`);
      countOps(g, 'coach');
      return { ok: true, msg: `Coaches take the passengers to ${city(to0)}; ${ac.reg} repositions empty` };
    }
    case 'hotel': {
      const at = Number(d.data?.morning ?? g.now + 12 * 60);
      if (charter) post(g, 'disruption', -hotelCost(pax));
      post(g, 'hotels', -crewOn(f) * DISRUPT.crewRoom);
      cont(at);
      comp();
      bumpClient(g, c?.clientId, -1, `${f.no}: an overnight in ${alt}`);
      countOps(g, 'overnight');
      return { ok: true, msg: `Hotels in ${city(alt)}; ${f.no} flies on at ${fmtTime(at)} UTC` };
    }
    case 'subcharter': {
      const rival = pickRival(g, ac.typeId, [f]);
      const cost = subcharterCost(g, [f], 1.3 * rivalFactor(g, rival));
      post(g, 'subcharter', -cost);
      bumpClient(g, c?.clientId, -1, `${f.no}: passengers flown on by ${g.rivals.find((r) => r.id === rival)?.name ?? 'a rival'}`);
      return { ok: true, msg: `${g.rivals.find((r) => r.id === rival)?.name ?? 'A rival'} flies the passengers on` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- 5. bird strike ----------

/** On blocks: a reported bird strike; the aircraft needs an inspection before its next flight. */
export function rollBirdStrike(g: GameState, f: Flight, ac: Aircraft): void {
  if (f.kind === 'deadhead' || ((!OPS_LIVE.on || !OPS_LIVE.disrupt) && !forcing)) return;
  const key = `bird:${f.id}:${f.std}`;
  if (!hit(g, key, RATES.birdStrike * emergencyFactor(g))) return;
  const at = f.to;
  const own = engineersAt(g, ac.id, at);
  const ownMin = own ? span(g, `${key}:o`, [90, 150]) : span(g, `${key}:o`, DISRUPT.birdOwn.min);
  const localMin = span(g, `${key}:l`, DISRUPT.birdLocal.min);
  const next = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.from === at);
  const morning = dayStart(g.now) + DAY + 6 * 60;
  const opts: DecisionOption[] = [
    { id: 'own', label: own ? 'Our engineers inspect it' : 'Fly our engineer in', desc: own ? 'Our line engineers here do the inspection.' : 'Our licensed engineer comes on the next airline flight.', tone: own ? 'good' : undefined, chips: [own ? usd(-800) : usd(-DISRUPT.birdOwn.cost), `Ready in ~${hm(ownMin)}`] },
    { id: 'local', label: 'Use a local contractor', desc: 'A licensed engineer from the airport\'s maintenance company signs it off.', chips: [usd(-DISRUPT.birdLocal.cost), `Ready in ~${hm(localMin)}`] },
  ];
  if (!own) opts.push({ id: 'wait', label: 'Wait for the morning shift', desc: 'The local station\'s day shift inspects it at no extra charge; the aircraft waits.', chips: ['No extra cost', `Ready ~${fmtTime(morning + 90)} UTC`] });
  const def = own ? 'own' : next && next.std < g.now + ownMin ? 'local' : 'own';
  raise(g, {
    kind: 'birdStrike', title: `Bird strike: ${ac.reg} at ${city(at)}`,
    body: `${f.no} hit birds on the approach to ${at}. The crew wrote it up; it needs an inspection (engines, leading edges, radome) before the next flight.`,
    options: opts, defaultOption: def, expires: g.now + 30, ref: { kind: 'aircraft', id: ac.id },
    data: { aircraftId: ac.id, at, ownMin, localMin, own, morning, ...cardData(`${ac.reg} hit birds and needs an inspection`, 'A bird strike must be inspected before the next flight; usually nothing, sometimes a damaged fan blade.', next ? `${next.no} at ${fmtTime(next.std)} UTC waits for it` : 'Nothing waits for it yet', 0, next ? paxOf(g, next) : 0, Math.max(0, g.now + (def === 'local' ? localMin : ownMin) - (next?.std ?? Infinity))) },
  }, { optional: false });
}

function resolveBird(g: GameState, d: Decision, opt: string): ActionResult {
  const ac = g.fleet[String(d.data?.aircraftId)];
  if (!ac || ac.flightId || ac.status !== 'available') return { ok: true, msg: 'The aircraft has moved on' };
  const at = String(d.data?.at);
  const own = !!d.data?.own;
  let min = Number(d.data?.ownMin ?? 180);
  let cost = own ? 800 : DISRUPT.birdOwn.cost;
  if (opt === 'local') {
    min = Number(d.data?.localMin ?? 180);
    cost = DISRUPT.birdLocal.cost;
  } else if (opt === 'wait') {
    min = Math.max(60, Number(d.data?.morning ?? g.now) + 90 - g.now);
    cost = 0;
  }
  const end = lineMx(g, ac, at, min, cost, 'Bird strike inspection');
  // Damage found in about one inspection in eight (FAA: ~5–8 % of strikes damage the aircraft; we ask on reported ones).
  if (roll(g, `birddmg:${ac.id}:${d.t}`) < DISRUPT.birdDamage) {
    const m = g.maintenance[ac.maintId!];
    const hrs = span(g, `birdrep:${ac.id}:${d.t}`, DISRUPT.birdRepairH);
    m.kind = 'AOG';
    m.cause = 'Bird strike: fan blade damage';
    m.end = end + hrs * 60;
    m.cost = Math.round(span(g, `birdc:${ac.id}:${d.t}`, [15_000, 60_000]) / 100) * 100;
    m.ev++;
    ac.status = 'aog';
    schedule(g, m.end, 'maint.end', m.id, m.ev);
    countOps(g, 'birdDamage');
    const f = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.from === at);
    if (f) aogDecision(g, ac, f, m);
    return { ok: true, msg: `The inspection found a damaged fan blade: ${ac.reg} is AOG about ${hrs} h` };
  }
  const f = flightsOf(g, ac.id).find((x) => x.status === 'scheduled' && x.from === at);
  if (f && f.std < end + 20) delayChain(g, f, end + 20, 'Bird strike inspection', false);
  return { ok: true, msg: `${ac.reg} inspected by ${fmtTime(end)} UTC` };
}

// ---------- 6. crew member sick away from base ----------

/** Daily: duties reporting in the next day away from base may get a sick call at the hotel ~2.5 h before report. */
export function rollSickAway(g: GameState): void {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt) return;
  const em = emergencyFactor(g);
  const st = opsState(g);
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report < g.now + 3 * 60 || d.report >= g.now + DAY + 3 * 60) continue;
    const f = g.flights[d.flightIds[0]];
    if (!f || f.status !== 'scheduled' || !isRevenue(f) || f.from === g.company.homeBase) continue;
    if (roll(g, `sick:${d.id}:${d.report}`) >= RATES.sickAway * em) continue;
    if (Object.values(st.pending).some((p) => p.dutyId === d.id)) continue;
    const id = nextId(g, 'op');
    st.pending[id] = { kind: 'sickCall', dutyId: d.id, t: d.report - 150 };
    schedule(g, d.report - 150, 'ops.event', id);
  }
}

/** The sick call: a crew member at the hotel can't fly; standby / deadhead cover through Crew Control, or fly one short. */
function sickCall(g: GameState, dutyId: string): void {
  const d = g.duties[dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  const f = d ? g.flights[d.flightIds[0]] : undefined;
  if (!d || !p || !f || d.done || f.status !== 'scheduled' || d.report <= g.now) return;
  const slots = p.slots.filter((s) => s.crewId && !s.above && g.crew[s.crewId]?.loc === f.from && g.crew[s.crewId]?.status !== 'onDuty');
  if (!slots.length) return;
  const slot = pickOf(g, `sickwho:${d.id}`, slots);
  const c = g.crew[slot.crewId!];
  const days = 2 + Math.floor(roll(g, `sickdays:${c.id}:${d.id}`) * 3);
  const until = dayStart(g.now) + (days + 1) * DAY;
  c.blocks = [...(c.blocks ?? []), { from: g.now, to: until, why: 'sick' }];
  // Dev/tests (forcing): the seat is left empty so the card shows (the auto-roster would usually cover it).
  const auto = g.company.policies.autoRoster;
  if (forcing) g.company.policies.autoRoster = false;
  removeCrew(g, c.id, g.now, until);
  g.company.policies.autoRoster = auto;
  countOps(g, 'sickAway');
  const cs = flightCrewStatus(g, f.id, { live: false });
  if (cs.level !== 'missing') {
    pushMessage(g, { tone: 'info', cat: 'crew', title: `${crewName(c)} is sick in ${city(f.from)}`, body: `${crewName(c)} (${ROLE_WORD[slot.role]}) called in sick at the hotel. Crew control found cover for ${f.no}; they fly home when fit.`, ref: { kind: 'crew', id: c.id } });
    return;
  }
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!ac) return;
  const missing = cs.missing;
  const cabinOnly = missing.length === 1 && missing[0] === 'CC';
  const ccAboard = p.slots.filter((s) => s.crewId && (s.role === 'CC' || s.role === 'PUR')).length;
  const maxPax = ccAboard * 50;
  const offload = Math.max(0, paxOf(g, f) - maxPax);
  const view = crewControl(g, f.id, { previews: false, only: ['callIn', 'deadhead', 'jet', 'delay'], noCard: true });
  // Up to two ways to bring someone in: the cheapest that still leaves within 3 h, and the fastest (often a jet).
  const avail = view?.solutions.filter((s) => s.available) ?? [];
  const fastest = [...avail].sort((a, b) => (a.newDeparture ?? f.std) - (b.newDeparture ?? f.std) || a.cost - b.cost)[0];
  const cheap = avail.filter((s) => (s.newDeparture ?? f.std) <= f.std + 180).sort((a, b) => a.cost - b.cost)[0];
  const sols = [cheap ?? fastest, fastest].filter((x, i, a): x is NonNullable<typeof x> => !!x && a.indexOf(x) === i);
  const sol = sols[0];
  const opts: DecisionOption[] = [];
  if (cabinOnly) opts.push({ id: 'minCrew', label: 'Fly one cabin crew short', desc: `Allowed when unforeseen (ORO.CC.100): at most 50 passengers per cabin crew member, ${maxPax} today; a report goes to the authority.`, tone: offload ? 'warn' : 'good', chips: [offload ? `${offload} passengers offloaded` : 'No one offloaded', !offload ? 'On time' : isCharter(g, f) ? usd(-offload * (eu261(f.from, f.to) + 150)) : 'Client rebooks them: relation −2', 'Report filed'] });
  for (const x of sols) opts.push({ id: `fix:${x.id}`, label: x.id === 'callIn' ? 'Call in standby crew' : x.id === 'jet' ? 'Charter a jet with a replacement' : x.id === 'delay' ? 'Wait for a replacement' : 'Fly a replacement in', desc: x.desc, tone: 'good', chips: x.chips.slice(0, 3) });
  opts.push({ id: 'crewControl', label: 'Let crew control sort it', desc: 'The flight waits at the gate and Crew Control shows every way to fix it.', chips: ['Decide at the gate'] });
  opts.push({ id: 'subcharter', label: 'Sub-charter the trip', desc: 'A rival flies these legs; we still bill the client.', tone: 'warn', chips: [usd(-subcharterCost(g, unitOf(g, ac, f), 1.5))] });
  const def = cabinOnly && !offload ? 'minCrew' : sol ? `fix:${sol.id}` : 'crewControl';
  raise(g, {
    kind: 'sickAway', title: `${crewName(c)} called in sick in ${city(f.from)}`,
    body: `${crewName(c)} (${ROLE_WORD[slot.role]}) can't fly ${f.no} ${f.from}–${f.to} at ${fmtTime(f.std)} UTC: sick at the hotel for about ${days} days.`,
    options: opts, defaultOption: def, expires: Math.max(g.now + 30, Math.min(f.std - 30, g.now + 90)), ref: { kind: 'flight', id: f.id },
    data: { flightId: f.id, crewId: c.id, offload, fix: sol?.id ?? '', ...cardData(`${f.no} is one ${ROLE_WORD[slot.role]} short in ${city(f.from)}`, `${crewName(c)} is sick at the hotel, away from base.`, `${paxOf(g, f)} passengers at ${fmtTime(f.std)} UTC`, 0, paxOf(g, f), 0) },
  }, { optional: false });
}

function resolveSickAway(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId)];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac || f.status !== 'scheduled') return { ok: true, msg: 'The flight has gone' };
  switch (opt) {
    case 'minCrew': {
      const dd = f.dutyId ? g.duties[f.dutyId] : undefined;
      const p = dd ? g.pairings[dd.pairingId] : undefined;
      const s = p?.slots.find((x) => !x.crewId && !x.above && x.role === 'CC');
      if (!s) return { ok: false, error: 'The seat is filled already' };
      s.above = true;
      f.reducedCabin = 1;
      const off = Number(d.data?.offload ?? 0);
      if (off > 0) {
        f.pax = paxOf(g, f) - off;
        if (isCharter(g, f)) post(g, 'penalties', -off * (eu261(f.from, f.to) + 150));
        else bumpClient(g, contractOf(g, f)?.clientId, -2, `${f.no}: ${off} passengers offloaded, one cabin crew short`);
      }
      (opsState(g).reducedReports ??= []).push(g.now);
      countOps(g, 'reducedCabin');
      return { ok: true, msg: `${f.no} flies with one cabin crew short${off ? `, ${off} passengers offloaded` : ''}; report filed` };
    }
    case 'replace':
    case 'fix:callIn': case 'fix:deadhead': case 'fix:jet': case 'fix:delay': {
      const fix = (opt.startsWith('fix:') ? opt.slice(4) : String(d.data?.fix || 'deadhead')) as 'callIn' | 'deadhead' | 'jet' | 'delay';
      const r = applyCrewFix(g, f.id, fix, { confirmed: true });
      return r.ok ? { ok: true, msg: r.msg } : r;
    }
    case 'crewControl':
      return { ok: true, msg: 'Crew control will raise it at the gate' };
    case 'subcharter': {
      const legs = unitOf(g, ac, f);
      const rival = pickRival(g, ac.typeId, legs);
      const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, 1.5 * rivalFactor(g, rival)));
      return { ok: true, msg: `${g.rivals.find((r) => r.id === rival)?.name ?? 'A rival'} flies ${n} leg${n === 1 ? '' : 's'}` };
    }
  }
  return { ok: false, error: 'Unknown option' };
}

// ---------- hooks ----------

/**
 * At the gate, before the random delay roll (first attempt): an ATC slot or a slow turn (one card per leg). A curfew
 * is checked at every attempt. True: the departure was handled here (held, delayed, moved).
 */
export function atGate(g: GameState, f: Flight, ac: Aircraft): boolean {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt) return false;
  if (g.decisions.some((d) => DISRUPT_KINDS.has(d.kind) && d.data?.flightId === f.id)) {
    f.delay += 10;
    schedule(g, g.now + 10, 'flight.dep', f.id, f.ev);
    return true;
  }
  if (curfewCard(g, f, ac)) {
    f.delay += 10;
    schedule(g, g.now + 10, 'flight.dep', f.id, f.ev);
    return true;
  }
  return false;
}

/**
 * The gate's operational delay roll came up (ops/flights.ts rollDelay): an ATC slot of 30 min or more, or a slow
 * turn of 20 min or more after a tight turn, becomes a card in a busy spell (one card at a time). True: a card was
 * raised (or applied) and the departure is handled; false: the delay applies as before.
 */
export function delayCard(g: GameState, f: Flight, ac: Aircraft, d: { min: number; reason: string }): boolean {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt || !isRevenue(f) || f.ops || optionalFactor(g) === 0 || disruptionOpen(g)) return false;
  let raised = false;
  if (d.reason === 'ATC slot' && d.min >= 30) raised = ctotCard(g, f, ac, Math.max(30, 5 * Math.round(d.min / 5)));
  else if (TURN_OF[d.reason] && d.min >= 20 && tightTurn(g, f, ac)) raised = turnCard(g, f, ac, d);
  if (!raised) return false;
  if (g.decisions.some((x) => x.data?.flightId === f.id) && f.status === 'scheduled') {
    f.delay += 10;
    schedule(g, g.now + 10, 'flight.dep', f.id, f.ev);
  }
  return true;
}

/** A diversion or medical card still open when the leg would land: it holds (circles) 10 minutes more. */
export function holdingForDecision(g: GameState, f: Flight): boolean {
  if (!g.decisions.some((d) => (d.kind === 'diversion' || d.kind === 'medical') && d.data?.flightId === f.id)) return false;
  f.eta = g.now + 10;
  f.sta = Math.max(f.sta, f.eta);
  f.ev++;
  schedule(g, f.eta, 'flight.arr', f.id, f.ev);
  touchFlights(g);
  return true;
}

export const DISRUPT_RESOLVERS: Record<string, (g: GameState, d: Decision, opt: string) => ActionResult> = {
  ctot: resolveCtot,
  turnaround: resolveTurn,
  curfew: resolveCurfew,
  diversion: resolveDiversion,
  medical: resolveMedical,
  divertOnward: resolveOnward,
  birdStrike: resolveBird,
  sickAway: resolveSickAway,
};

/** Dev/test: raise one disruption now on a flight (whatever the dice and the director); true when a card is open. */
export function devDisruption(g: GameState, kind: DisruptKind | 'onward' | 'technical', flightId: string): boolean {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac) return false;
  const n = g.decisions.length;
  forcing = true;
  try {
    switch (kind) {
      case 'diversion': if (f.status === 'enroute') diversionCard(g, f, ac, 'weather'); break;
      case 'technical': if (f.status === 'enroute') diversionCard(g, f, ac, 'technical'); break;
      case 'medical': if (f.status === 'enroute') medicalCard(g, f, ac); break;
      case 'birdStrike': rollBirdStrike(g, f, ac); break;
      case 'curfew': curfewCard(g, f, ac); break;
      case 'ctot': ctotCard(g, f, ac); break;
      case 'turnaround': turnCard(g, f, ac); break;
      case 'sickAway': { const d = f.dutyId ? g.duties[f.dutyId] : undefined; if (d) sickCall(g, d.id); break; }
      case 'onward': onDivertedArrival(g, f); break;
    }
  } finally {
    forcing = false;
  }
  return g.decisions.length > n;
}
