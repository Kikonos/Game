// v0.23.3 Position an aircraft (player request): from an idle stretch on the Schedule the player sends an aircraft
// empty to another airport. The move is a ferry of no job, planned by the schedule's own forward planner (contracts/
// schedule.ts openForward: the route with its fuel stops, crew-change night stops, curfews and closures; crewFree: the
// soonest a crew can be at the aircraft) and crewed by the roster like any other ferry. Its legs carry `pos`; once the
// last one lands the aircraft is `parked` there: the schedule plans its next empty legs from where it stands and never
// sends it home on its own (schedule.ts parkedAt). Money: nothing is charged at booking; fuel, fees and maintenance post
// as each leg lands and the pilots' tickets and hotels as the roster buys them, on the ledger's usual lines.
//
// The quote is worked out on a copy of the game (as the trip swap and the check move are): exactly what the booking
// does, with the crew the roster seats and what else changes. Pure.
//
// Not re-exported from ops/index: it settles the copy through sim.ts, which imports the ops module.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { addFlight, flightsOf, flightsRev, liveFlightsOf, ownFlightNo, removeFlights, touchFlights } from '../core/entities';
import { distanceNm } from '../core/geo';
import { pushMessage } from '../core/messages';
import { isolatePauses } from '../core/pause';
import { etopsCap, runwayFit, typeOf } from '../core/perf';
import { DAY, fmtDay, fmtTime } from '../core/time';
import type { ActionResult, Aircraft, Flight, GameState, Minute } from '../core/types';
import { anchorsOf, chainBackward, chainForward, noRouteWhy, route, sortedLegs, type Anchor, type ChainLeg } from '../contracts/plan';
import { crewFree, emptyDay, openForward, relinkPositioning } from '../contracts/schedule';
import { crewName, flightCrewStatus, rerosterFrom, rosterHorizon } from '../crew';
import { settle } from '../sim';
import { ferryCost, ferryCrewCost } from './delivery';
import { groundGaps, isGrounded } from './maintenance';
import { usd } from './util';

export interface PositionLeg { from: string; to: string; std: Minute; sta: Minute; block: number; /** A night stop (crew rest) after this leg. */ night: boolean }

export interface PositionCrew {
  /** 'later': beyond the published roster, crewed when that month's roster comes out. */
  level: 'ok' | 'tight' | 'missing' | 'illegal' | 'later';
  /** 'Capt A. Borg, FO M. Vella'. */
  names: string;
  /** One plain line for the sheet. */
  text: string;
}

export interface PositionQuote {
  ok: boolean;
  /** Why not, in a few plain words. */
  reason: string | null;
  from: string;
  to: string;
  legs: PositionLeg[];
  /** Fuel stops and night stops on the way. */
  stops: string[];
  /** The earliest departure (what `later` counts from), the departure and the landing quoted. */
  earliest: Minute | null;
  depart: Minute | null;
  arrive: Minute | null;
  /** Block minutes flown. */
  block: number;
  fuel: number;
  fees: number;
  /** The pilots' airline tickets, hotels and allowances (an estimate: the roster buys them). */
  crewCost: number;
  total: number;
  crew: PositionCrew | null;
  /** What it means for the rest of the schedule: the next work, empty legs that change. */
  notes: string[];
  /** Worked out on a copy (crew and schedule checked); false: route, times and money only. */
  full: boolean;
}

export interface PositionOpts {
  /** The idle stretch tapped: its start (the aircraft is free from then) and, when later than the earliest, the departure wanted. */
  from: Minute;
  later?: number;
  /** Route, times and money only (the shortlist): no copy of the game. */
  quick?: boolean;
}

const city = (code: string): string => AIRPORT_BY_CODE[code]?.city ?? code;
const when = (t: Minute): string => `${fmtDay(t)} ${fmtTime(t)}`;
const up5 = (t: Minute): Minute => Math.ceil(t / 5) * 5;

/** A flight this close that would lose its crew to the move refuses it; a later one is only said. */
const ROBBED_DAYS = 7;

/** Later departures tried when the roster has nobody for the first one (minutes after it). */
const RETRY = [6 * 60, 12 * 60, 24 * 60, 48 * 60];

interface Plan {
  ac: Aircraft;
  at: string;
  chain: ChainLeg[];
  earliest: Minute;
  /** The departure asked for (the chain leaves later when a night curfew is in the way). */
  asked: Minute;
  next: Anchor | null;
}

/** 'EW6045 on 12 Mar', 'the A-check on 3 Jun'. */
function anchorText(g: GameState, b: Anchor): string {
  if (b.kind === 'maint') {
    const m = g.maintenance[b.id];
    const what = !m ? 'maintenance' : m.kind === 'A' || m.kind === 'C' ? `the ${m.kind}-check` : m.kind === 'refit' ? 'the cabin refit' : m.kind === 'paint' ? 'the paint shop' : m.kind === 'return' ? 'the lease return' : 'maintenance';
    return `${what} at ${b.from} on ${fmtDay(b.std)}`;
  }
  if (b.kind === 'base') return `${g.contracts[b.id]?.title ?? 'the contract'} at ${b.from} from ${fmtDay(b.std)}`;
  const f = g.flights[b.id];
  return `${f?.no ?? 'the flight'} ${b.from}–${b.to} on ${fmtDay(b.std)}`;
}

const none = (from: string, to: string, reason: string): PositionQuote => ({
  ok: false, reason, from, to, legs: [], stops: [], earliest: null, depart: null, arrive: null, block: 0, fuel: 0, fees: 0, crewCost: 0, total: 0, crew: null, notes: [], full: false,
});

/** The idle stretch of the aircraft at or after `from`: where it stands and from when it can leave (a turn after landing). Pure. */
function idleAt(g: GameState, ac: Aircraft, from: Minute): { at: string; free: Minute; to: Minute } | null {
  const t0 = Math.max(from, g.now);
  const gp = groundGaps(g, ac, t0, t0 + 400 * DAY).find((x) => x.to > t0);
  if (!gp || gp.from > t0 + 60) return null;
  let landed = -Infinity;
  for (const f of flightsOf(g, ac.id)) {
    if (f.to !== gp.at || f.status === 'cancelled' || f.kind === 'deadhead') continue;
    const t = f.status === 'done' ? f.ata ?? f.sta : f.eta ?? f.sta;
    if (t <= gp.from + 1) landed = Math.max(landed, t);
  }
  return { at: gp.at, free: Math.max(gp.from, landed + typeOf(ac.typeId).turnMin), to: gp.to };
}

/** The route, the times and what stands in the way, without a copy of the game: a Plan, or the reason. Pure. */
function planOf(g: GameState, aircraftId: string, to: string, opts: PositionOpts, depart?: Minute): Plan | string {
  const ac = g.fleet[aircraftId];
  if (!ac) return 'Aircraft not found';
  if (!AIRPORT_BY_CODE[to]) return 'Unknown airport';
  if (ac.status === 'delivering') return `${ac.reg} is not delivered yet`;
  if (ac.status === 'stored' || ac.status === 'leasedOut') return `${ac.reg} is not flying for us now`;
  if (ac.returning || ac.sale) return `${ac.reg} is leaving the fleet`;
  if (ac.delivery && ac.delivery.arrived === undefined) return `${ac.reg} is still on its delivery`;
  if (isGrounded(g, ac)) return `${ac.reg} is grounded: a check is overdue`;
  const idle = idleAt(g, ac, opts.from);
  if (!idle) return `${ac.reg} is busy then`;
  const X = idle.at;
  if (X === to) return `${ac.reg} is already at ${city(to)}`;
  const t = typeOf(ac.typeId);
  if (runwayFit(ac.typeId, to) === 'no') return `The runway at ${city(to)} is too short for the ${t.short}`;
  const cap = etopsCap(g.company.approvals, ac.typeId);
  const day = emptyDay(g, aircraftId);
  if (!route(ac.typeId, X, to, cap, day)) {
    return noRouteWhy(ac.typeId, X, to, cap) === 'etops' ? `No way to ${city(to)} inside our ETOPS approval` : `${city(to)} is out of range for the ${t.short}, even with fuel stops`;
  }
  // The soonest a crew can be at the aircraft (schedule.ts crewFree: two hours at base, an airline ticket's lead away).
  const earliest = up5(crewFree(g, aircraftId, X, up5(idle.free)));
  const from = Math.max(earliest, depart ?? earliest + Math.max(0, opts.later ?? 0));
  const chain = openForward(g, ac.typeId, X, to, from, cap, null, day);
  if (!chain?.length) {
    return chainForward(ac.typeId, X, to, from, cap, day)?.length ? `${city(to)} or a stop on the way is closed then` : `No way to ${city(to)}`;
  }
  // What it must be back for: the next work after the idle stretch.
  const next = anchorsOf(g, aircraftId).find((b) => b.kind !== 'start' && b.std >= idle.free - t.turnMin && b.sta > g.now) ?? null;
  const arr = chain[chain.length - 1].sta;
  if (next) {
    const latest = next.std - t.turnMin;
    const fits = next.from === to ? arr <= latest : !!chainBackward(ac.typeId, to, next.from, arr + t.turnMin, latest, cap, day)?.length;
    if (!fits) return next.from === X ? `Not back at ${X} in time for ${anchorText(g, next)}` : `Too late at ${next.from} for ${anchorText(g, next)}`;
  }
  return { ac, at: X, chain, earliest, asked: from, next };
}

/** The legs with their night stops marked (a stop longer than a fuel stop: the crew rest there). */
function legsOf(chain: { from: string; to: string; std: Minute; sta: Minute }[]): PositionLeg[] {
  return chain.map((l, i) => ({ from: l.from, to: l.to, std: l.std, sta: l.sta, block: l.sta - l.std, night: i < chain.length - 1 && chain[i + 1].std - l.sta > 4 * 60 }));
}

/** The quote's route, times and money (the ferry cost model: delivery.ts ferryCost and ferryCrewCost). */
function baseQuote(g: GameState, p: Plan, to: string): PositionQuote {
  const legs = legsOf(p.chain);
  const home = g.company.homeBase;
  const { fuel, fees } = ferryCost(p.ac.typeId, legs, g.market.fuelPrice);
  const days = legs.map((l) => ({ ...l, nightStopAfter: l.night }));
  // Two pilots: tickets out to an aircraft away from base and hotels on the way, tickets home from where they leave it.
  const oneWay = days.slice(0, 1).map((l) => ({ ...l, nightStopAfter: false }));
  const crewCost = ferryCrewCost(g, home, p.at, days) + (to === home ? 0 : ferryCrewCost(g, home, to, p.at === home ? days : oneWay));
  const notes: string[] = [];
  if (legs[0].std > p.asked + 5) notes.push('Leaves later to stay clear of a night curfew.');
  return {
    ok: true, reason: null, from: p.at, to, legs, stops: legs.slice(0, -1).map((l) => l.to), earliest: p.earliest, depart: legs[0].std, arrive: legs[legs.length - 1].sta,
    block: legs.reduce((s, l) => s + l.block, 0), fuel, fees, crewCost, total: fuel + fees + crewCost, crew: null, notes, full: false,
  };
}

/** Books the move's legs, re-plans the aircraft's empty legs from where it will stand and crews them. Returns the legs. */
function apply(h: GameState, aircraftId: string, to: string, chain: ChainLeg[]): Flight[] {
  const id = `pos${h.seq + 1}`;
  const legs = chain.map((l) => {
    const f = addFlight(h, { no: ownFlightNo(h), aircraftId, contractId: null, kind: 'ferry', from: l.from, to: l.to, std: l.std, sta: l.sta });
    f.pos = { id, to };
    return f;
  });
  touchFlights(h);
  relinkPositioning(h, aircraftId);
  // Crew the move now (a crew may have to travel for it), not at its departure.
  rerosterFrom(h, aircraftId, h.now);
  return legs;
}

const sig = (f: Flight) => `${f.id}|${f.from}|${f.to}|${f.std}|${f.sta}|${f.status}`;
/** Scheduled flights short of crew inside the roster (this move's own legs aside). */
function shortOf(g: GameState, until: Minute, but: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead' || f.std > until || but.has(f.id)) continue;
    const s = flightCrewStatus(g, f.id, { live: false });
    if (s.level === 'missing' || s.level === 'illegal') out.add(f.id);
  }
  return out;
}

type Try = { q: PositionQuote; retry: Minute | null };

/** One departure tried on a copy: the quote, or (the roster has nobody then) the next departure worth a try. */
function tryAt(g: GameState, p: Plan, to: string): Try {
  const q = baseQuote(g, p, to);
  const h = structuredClone(g);
  let legs: Flight[];
  try {
    legs = isolatePauses(() => {
      const out = apply(h, p.ac.id, to, p.chain);
      settle(h);
      return out;
    });
  } catch (e) {
    return { q: { ...q, ok: false, reason: `The move could not be planned (${e instanceof Error ? e.message : String(e)})` }, retry: null };
  }
  const ids = new Set(legs.map((f) => f.id));
  const mine = legs.map((f) => h.flights[f.id]).filter((f): f is Flight => !!f && f.status === 'scheduled');
  const no = (reason: string, retry: Minute | null = null): Try => ({ q: { ...q, ok: false, reason, full: true }, retry });
  if (mine.length !== legs.length) return no('No crew can fly it then', p.chain[0].std + RETRY[0]);
  // The roster moved it to when a crew can fly it: that is the departure to quote.
  if (mine[0].std !== p.chain[0].std) return no('No crew can fly it then', mine[0].std);
  // Its other flying stays as it is: only empty legs with no fixed slot change.
  const hard = (st: GameState) => flightsOf(st, p.ac.id).filter((f) => (f.status === 'scheduled' || f.status === 'enroute') && f.kind !== 'positioning' && !ids.has(f.id));
  const after = new Set(hard(h).map(sig));
  const lost = hard(g).find((f) => !after.has(sig(f)));
  if (lost) return no(`${lost.no} ${lost.from}–${lost.to} on ${fmtDay(lost.std)} would have to move`);
  // The next work is still reached on time.
  const turn = typeOf(p.ac.typeId).turnMin;
  const soft = (st: GameState) => liveFlightsOf(st, p.ac.id).filter((f) => f.kind === 'positioning' && f.status === 'scheduled');
  if (p.next && p.next.from !== to) {
    const last = soft(h).filter((f) => f.to === p.next!.from && f.std >= mine[mine.length - 1].sta).pop();
    if (!last || last.sta > p.next.std - turn) return no(`Too late at ${p.next.from} for ${anchorText(g, p.next)}`);
  }
  // Crew: who the roster seats, and whether the day is legal.
  const horizon = rosterHorizon(g);
  const seated = new Set<string>();
  let level: PositionCrew['level'] = 'ok';
  let missing: string[] = [];
  for (const f of mine) {
    if (f.std > horizon && !f.dutyId) {
      if (level === 'ok') level = 'later';
      continue;
    }
    const s = flightCrewStatus(h, f.id, { live: false });
    for (const c of f.crewIds) seated.add(c);
    if (s.level === 'illegal') level = 'illegal';
    else if (s.level === 'missing' && level !== 'illegal') {
      level = 'missing';
      missing = s.missing;
    } else if (s.level === 'tight' && (level === 'ok' || level === 'later')) level = 'tight';
  }
  const names = [...seated].map((id) => h.crew[id]).filter((c) => !!c && (c.role === 'CPT' || c.role === 'FO')).sort((a, b) => (a.role === 'CPT' ? 0 : 1) - (b.role === 'CPT' ? 0 : 1)).map((c) => `${c.role === 'CPT' ? 'Capt' : c.role} ${crewName(c)}`).join(', ');
  const crew: PositionCrew = {
    level, names,
    text: level === 'later' ? 'Crewed when that month\'s roster comes out' : level === 'missing' ? `No ${missing.includes('CPT') && missing.includes('FO') ? 'pilots' : missing.includes('CPT') ? 'captain' : 'first officer'} free then` : level === 'illegal' ? 'Over the crew\'s duty limits' : `${names || 'Two pilots'} · ${level === 'tight' ? 'legal, tight' : 'legal'}`,
  };
  if (level === 'missing' || level === 'illegal') return { q: { ...q, ok: false, reason: level === 'missing' ? 'No crew can fly it then' : 'No crew can fly it legally then', crew, full: true }, retry: p.chain[0].std + RETRY[0] };
  // Nobody else's flight loses its crew to it: refused when that flight leaves within a week, said when it is later
  // (the roster has time to find it another crew).
  const was = shortOf(g, horizon, ids);
  const robbed = [...shortOf(h, horizon, ids)].map((id) => h.flights[id]).filter((f) => !was.has(f.id) && !!g.flights[f.id]).sort((a, b) => a.std - b.std)[0];
  if (robbed && robbed.std < g.now + ROBBED_DAYS * DAY) return no(`It would take the crew of ${robbed.no} on ${fmtDay(robbed.std)}`, p.chain[0].std + RETRY[0]);
  const notes = [...q.notes];
  if (robbed) notes.push(`${robbed.no} on ${fmtDay(robbed.std)} will need another crew.`);
  const gS = new Set(soft(g).map((f) => `${f.from}|${f.to}|${f.std}`));
  const hS = new Set(soft(h).map((f) => `${f.from}|${f.to}|${f.std}`));
  const gone = soft(g).filter((f) => !hS.has(`${f.from}|${f.to}|${f.std}`));
  const added = soft(h).filter((f) => !gS.has(`${f.from}|${f.to}|${f.std}`));
  // The schedule's new empty legs on to the next work are crewed too (uncrewed they would wait, and the work with them).
  const stuck = added.find((f) => f.std <= horizon && ['missing', 'illegal'].includes(flightCrewStatus(h, f.id, { live: false }).level));
  if (stuck && p.next) return no(`No crew to fly on to ${p.next.from} in time for ${anchorText(g, p.next)}`);
  if (added.length) notes.push(`Then ${added.map((f) => `${f.from}–${f.to}`).join(', ')} on ${fmtDay(added[0].std)}${p.next ? ` for ${anchorText(g, p.next)}` : ''}.`);
  else if (p.next) notes.push(`Next: ${anchorText(g, p.next)}.`);
  else if (to !== g.company.homeBase) notes.push(`${p.ac.reg} stays at ${city(to)} until it has work.`);
  if (gone.length) notes.push(`No longer flown: ${gone.map((f) => `${f.from}–${f.to} ${fmtDay(f.std)}`).join(', ')}.`);
  const out = legsOf(mine);
  return { q: { ...q, legs: out, depart: out[0].std, arrive: out[out.length - 1].sta, crew, notes, full: true }, retry: null };
}

const memo = new WeakMap<GameState, Map<string, PositionQuote>>();

/**
 * What positioning the aircraft to `to` from its idle stretch at `opts.from` would be: the route the schedule's ferry
 * planner flies (fuel and night stops), departure (the earliest a crew can fly it, or `opts.later` minutes after that)
 * and landing, block time, fuel, fees and crew travel, the crew the roster seats and whether their day is legal, and
 * what it changes after; or the plain reason it can't be done. Worked out on a copy. Pure (memoized per state).
 */
export function quotePosition(g: GameState, aircraftId: string, to: string, opts: PositionOpts): PositionQuote {
  let c = memo.get(g);
  if (!c) memo.set(g, (c = new Map()));
  const key = `${aircraftId}>${to}@${opts.from}+${opts.later ?? 0}:${opts.quick ? 'q' : 'f'}:${flightsRev(g)}:${g.seq}:${g.now}`;
  const hit = c.get(key);
  if (hit) return hit;
  const done = (q: PositionQuote) => {
    c!.set(key, q);
    return q;
  };
  const from = idleAt(g, g.fleet[aircraftId] ?? ({} as Aircraft), opts.from)?.at ?? g.fleet[aircraftId]?.at ?? '';
  let p = g.fleet[aircraftId] ? planOf(g, aircraftId, to, opts) : 'Aircraft not found';
  if (typeof p === 'string') return done(none(from, to, p));
  if (opts.quick) return done(baseQuote(g, p, to));
  let last: PositionQuote | null = null;
  const tried = new Set<Minute>();
  for (let i = 0; i <= RETRY.length; i++) {
    tried.add(p.chain[0].std);
    const r = tryAt(g, p, to);
    if (r.q.ok || r.retry === null) return done(r.q);
    last ??= r.q;
    // A later departure: when the roster itself would fly it, else the next step of the ladder.
    let at = r.retry;
    if (tried.has(at) || at <= p.chain[0].std) at = p.chain[0].std + RETRY[Math.min(i, RETRY.length - 1)];
    const np: Plan | string = planOf(g, aircraftId, to, opts, at);
    // Later it no longer fits before the next work: the first reason stands.
    if (typeof np === 'string') break;
    if (tried.has(np.chain[0].std)) break;
    p = np;
  }
  return done(last ?? none(from, to, 'No crew can fly it then'));
}

/** Books the move as quoted (one message); refused with the quote's reason when it can't be done. */
export function positionAircraft(g: GameState, aircraftId: string, to: string, opts: Omit<PositionOpts, 'quick'>): ActionResult<{ flightIds: string[] }> {
  const q = quotePosition(g, aircraftId, to, opts);
  if (!q.ok || q.depart === null) return { ok: false, error: q.reason ?? 'It can’t be positioned there' };
  const p = planOf(g, aircraftId, to, opts, q.depart);
  if (typeof p === 'string') return { ok: false, error: p };
  const legs = apply(g, aircraftId, to, p.chain);
  const path = [legs[0].from, ...legs.map((f) => f.to)].join('–');
  const text = `${p.ac.reg} positions ${path}: leaves ${when(legs[0].std)}, lands ${when(legs[legs.length - 1].sta)} UTC`;
  pushMessage(g, { tone: 'info', cat: 'ops', title: `Positioning booked: ${p.ac.reg} to ${city(to)}`, body: `${text}. About ${usd(q.total)} in fuel, fees and crew travel.`, ref: { kind: 'flight', id: legs[0].id } });
  return { ok: true, msg: `${p.ac.reg} positions to ${city(to)} ${fmtDay(legs[0].std)}`, data: { flightIds: legs.map((f) => f.id) } };
}

/** The legs of the move `flightId` belongs to that have not left yet. Pure. */
export function positionLegs(g: GameState, flightId: string): Flight[] {
  const f = g.flights[flightId];
  if (!f?.pos || !f.aircraftId) return [];
  return flightsOf(g, f.aircraftId).filter((x) => x.pos?.id === f.pos!.id && x.status === 'scheduled');
}

/** Cancels a move the player booked, before it leaves (a move under way: the legs still to fly). The schedule and the roster re-plan. */
export function cancelPosition(g: GameState, flightId: string): ActionResult {
  const f = g.flights[flightId];
  if (!f?.pos || !f.aircraftId) return { ok: false, error: 'Not a positioning flight' };
  const legs = positionLegs(g, flightId);
  if (!legs.length) return { ok: false, error: f.status === 'enroute' ? 'It has already left' : 'Nothing left to cancel' };
  const acId = f.aircraftId;
  removeFlights(g, legs.map((x) => x.id));
  touchFlights(g);
  relinkPositioning(g, acId);
  rerosterFrom(g, acId, g.now);
  return { ok: true, msg: 'Positioning cancelled' };
}

export interface PositionTarget { code: string; /** 'Home base', 'Next job', 'Crew base', 'Offer'. */ tag: string; /** The job or offer it is for. */ hint?: string }

/**
 * Where an idle aircraft is most likely wanted, in order: home base, where its next job starts, the bases our crews
 * are stationed at, where our other signed work starts, then the open offers that start nearest. Pure.
 */
export function positionTargets(g: GameState, aircraftId: string, from: Minute, max = 8): PositionTarget[] {
  const ac = g.fleet[aircraftId];
  if (!ac) return [];
  const at = idleAt(g, ac, from)?.at ?? ac.at;
  const out: PositionTarget[] = [];
  const add = (code: string | undefined, tag: string, hint?: string) => {
    if (!code || code === at || !AIRPORT_BY_CODE[code] || out.some((x) => x.code === code) || runwayFit(ac.typeId, code) === 'no') return;
    out.push({ code, tag, ...(hint ? { hint } : {}) });
  };
  add(g.company.homeBase, 'Home base');
  const t0 = Math.max(from, g.now);
  const next = anchorsOf(g, aircraftId).find((b) => b.kind !== 'start' && b.std >= t0 && b.contractId);
  if (next) add(next.from, 'Next job', g.contracts[next.contractId!]?.title);
  for (const d of Object.values(g.deployments).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))) if (d.end > t0) add(d.base, 'Crew base', g.contracts[d.contractId]?.title);
  const origin = (k: { pattern: GameState['contracts'][string]['pattern'] }) => (k.pattern.kind === 'base' ? k.pattern.base : sortedLegs(k.pattern.legs)[0]?.from);
  for (const k of Object.values(g.contracts).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))) {
    if ((k.status === 'signed' || k.status === 'active') && k.end > t0 && !k.dry) add(origin(k), 'Contract', k.title);
  }
  const offers = Object.values(g.offers)
    .filter((o) => o.status === 'open' && o.expires > g.now && o.start > t0)
    .map((o) => ({ o, code: origin(o) }))
    .filter((x): x is { o: typeof x.o; code: string } => !!x.code && !!AIRPORT_BY_CODE[x.code])
    .sort((a, b) => distanceNm(at, a.code) - distanceNm(at, b.code) || a.o.start - b.o.start || (a.o.id < b.o.id ? -1 : 1));
  for (const x of offers) {
    if (out.length >= max) break;
    add(x.code, 'Offer', x.o.title);
  }
  return out.slice(0, max);
}
