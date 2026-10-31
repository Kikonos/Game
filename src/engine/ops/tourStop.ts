// v0.12.1 a world tour's stop closed by a world event (weather, unrest, an airspace closure): the card asks where the
// guests go instead. Fly to another stop of the tour's kind (the same dates), or skip it: stay longer at the stop
// before, or go straight on and stay longer at the next. Force majeure: the client pays the full tour, the legs keep
// their crew (the same flights, re-routed). Or the whole tour waits for the reopening, every stop keeping its nights.

import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { removeFlights, retimeFlight } from '../core/entities';
import { distance } from '../core/geo';
import { blockMinutes, etopsCap, planSector, runwayFit, withinEtops } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { ActionResult, Contract, Decision, Flight, GameState, Minute, WorldEvent } from '../core/types';
import { tourAlternates, tourSight } from '../contracts/missions';
import { ask } from './events';
import { closedAirport, closedUntil, startEvent, waitLegs } from './world';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/** The tour's revenue legs on its aircraft, by departure. */
function tourLegs(g: GameState, k: Contract): Flight[] {
  return Object.values(g.flights).filter((f) => f.contractId === k.id && f.aircraftId && (f.kind === 'revenue' || f.kind === 'techstop')).sort((a, b) => a.std - b.std);
}

/** A sector the aircraft flies non-stop, within our ETOPS approval, both runways usable. Pure. */
function flies(g: GameState, typeId: string, a: string, b: string): boolean {
  const sp = planSector(typeId, a, b);
  return sp.ok && !sp.techStops.length && withinEtops(typeId, a, b, etopsCap(g.company.approvals, typeId));
}

export interface TourStopPlan {
  stop: string;
  /** The leg into the closed stop and the leg out of it (single sectors, still to fly). */
  legIn: Flight;
  legOut: Flight;
  prev: string;
  next: string;
  /** Another stop with the same dates (null: none open, in reach and new to the tour). */
  alt: string | null;
  /** prev → next flies non-stop (the stop can be skipped). */
  skip: boolean;
}

/**
 * The closed stop of a world tour and its ways round: the legs either side (both still to fly, neither with a fuel
 * stop), the best other stop (the tour's own alternatives first, then a widebody field of its kind within 2,000 km of
 * it), and whether the stop can be skipped. Null when the closure does not hit a stop that way (the aircraft is
 * already there: the ordinary wait-or-cancel card applies). Pure.
 */
export function tourStopPlan(g: GameState, k: Contract, e: WorldEvent): TourStopPlan | null {
  const ac = g.fleet[k.aircraftIds[0]];
  if (!ac || k.pattern.kind !== 'legs') return null;
  const legs = tourLegs(g, k);
  for (let i = 0; i + 1 < legs.length; i++) {
    const legIn = legs[i];
    const legOut = legs[i + 1];
    const stop = legIn.to;
    if (legIn.status !== 'scheduled' || legOut.status !== 'scheduled' || legOut.from !== stop || legIn.kind !== 'revenue' || legOut.kind !== 'revenue') continue;
    if (closedAirport(g, stop, legIn.sta) !== e && closedAirport(g, stop, legOut.std) !== e) continue;
    const prev = legIn.from;
    const next = legOut.to;
    const t = ac.typeId;
    const visited = new Set(legs.flatMap((f) => [f.from, f.to]));
    const ok = (c: string) => {
      const a = AIRPORT_BY_CODE[c];
      return !!a && !a.enroute && !visited.has(c) && runwayFit(t, c) !== 'no' && !closedAirport(g, c, legIn.sta) && !closedAirport(g, c, legOut.std) && flies(g, t, prev, c) && flies(g, t, c, next);
    };
    const gateway = k.pattern.legs[0]?.from ?? '';
    let alt = tourAlternates(gateway, stop).find(ok) ?? null;
    if (!alt) {
      const near = AIRPORTS.filter((a) => a.size >= 2 && a.tour >= 0.6 && distance(stop, a.code) <= 2000 && ok(a.code)).sort((a, b) => distance(stop, a.code) - distance(stop, b.code));
      alt = near[0]?.code ?? null;
    }
    const skip = flies(g, t, prev, next) && !closedAirport(g, prev, legOut.std);
    return { stop, legIn, legOut, prev, next, alt, skip };
  }
  return null;
}

const nightsAt = (from: Minute, to: Minute) => Math.max(0, Math.round((to - from) / DAY));

/**
 * The card for a world tour whose next stop a closure shuts (world.ts applyClosure); true when it was asked (or one
 * is open already), false when the stop cannot be flown round (the ordinary wait-or-cancel card applies).
 */
export function tourStopAsk(g: GameState, e: WorldEvent, k: Contract): boolean {
  if (g.decisions.some((d) => d.kind === 'tourStop' && d.data?.contractId === k.id && d.data?.eventId === e.id)) return true;
  const p = tourStopPlan(g, k, e);
  if (!p) return false;
  const { stop, legIn, legOut, prev, next, alt, skip } = p;
  const sight = tourSight(stop);
  const options: Decision['options'] = [];
  if (alt) {
    options.push({
      id: 'alternate', label: `Fly to ${city(alt)} instead`, tone: 'good',
      desc: `${legIn.no} ${prev}–${alt} and ${legOut.no} ${alt}–${next}, same dates: the guests see ${tourSight(alt)}.`,
      chips: ['No penalty', 'Same crew'],
    });
  }
  if (skip) {
    const more = nightsAt(legIn.std, legOut.std);
    options.push({
      id: 'stayPrev', label: `Stay longer at ${city(prev)}`,
      desc: `One leg ${prev}–${next} on ${fmtDay(legOut.std)}: ${more} more night${more === 1 ? '' : 's'} at ${city(prev)}.`,
      chips: ['No penalty', `${sight} missed`],
    });
    options.push({
      id: 'goOn', label: `Go on to ${city(next)}`,
      desc: `One leg ${prev}–${next} on ${fmtDay(legIn.std)}: ${nightsAt(legIn.std, legOut.std)} more nights at ${city(next)}.`,
      chips: ['No penalty', `${sight} missed`],
    });
  }
  const until = closedUntil(e);
  // The whole tour waits for the reopening: every leg from this one moves by the same days (world.ts waitLegs).
  const wait = Math.max(0, Math.ceil((until + 3 * 60 - legIn.std) / DAY));
  options.push({
    id: 'wait', label: wait ? `Wait: the tour runs ${wait} day${wait === 1 ? '' : 's'} late` : 'Wait for the reopening', tone: options.length ? 'warn' : undefined,
    desc: `The rest of the tour moves ${wait ? `${wait} day${wait === 1 ? '' : 's'}` : 'a few hours'} later, every stop keeps its nights; the guests get home late.`,
    chips: ['No penalty', 'Late'],
  });
  const what = `${city(stop)} is closed: the tour can't land there`;
  const why = `${e.title}, until about ${fmtDay(until)}. ${k.title} is due there ${fmtDay(legIn.sta)} to ${fmtDay(legOut.std)}.`;
  const hurt = `Not much if we change the plan: force majeure, the client pays the full tour; the guests miss ${sight}.`;
  ask(g, {
    kind: 'tourStop', title: `${k.title}: ${city(stop)} is closed`,
    body: `${why} ${alt ? `${city(alt)} is open and in reach.` : 'No other stop near it is open.'}`,
    options, defaultOption: options[0].id, expires: Math.max(g.now + 60, Math.min(g.now + DAY, legIn.std - 6 * 60)),
    ref: { kind: 'contract', id: k.id },
    data: { contractId: k.id, eventId: e.id, flightId: legIn.id, outId: legOut.id, stop, ...(alt ? { alt } : {}), what, why, hurt, money: 0, pax: 0, delayMin: 0 },
  }, true);
  return true;
}

/** Re-routes one leg in place (its crew and duty stay: the roster re-measures the day) and its pattern template. */
function reroute(g: GameState, k: Contract, f: Flight, from: string, to: string, std: Minute): void {
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const t = ac?.typeId ?? 'a333';
  const tpl = k.pattern.kind === 'legs' ? k.pattern.legs.find((l) => l.flightNo === f.no && l.from === f.from && l.to === f.to) : undefined;
  f.from = from;
  f.to = to;
  delete f.closedBy;
  retimeFlight(g, f, std, std + blockMinutes(t, from, to));
  if (tpl) Object.assign(tpl, { from, to, dep: std });
}

/** Drops a leg the tour no longer flies (its template too): never flown, never counted as cancelled. */
function dropLeg(g: GameState, k: Contract, f: Flight): void {
  if (k.pattern.kind === 'legs') k.pattern.legs = k.pattern.legs.filter((l) => !(l.flightNo === f.no && l.from === f.from && l.to === f.to));
  removeFlights(g, [f.id]);
}

/**
 * Resolver of 'tourStop': fly the other stop, or skip it staying longer at the stop before (one leg at the later time)
 * or at the next (one leg at the earlier time). The price is kept: what the tour plans to fly is what it earns.
 */
export function resolveTourStop(g: GameState, d: Decision, opt: string): ActionResult {
  const k = g.contracts[String(d.data?.contractId ?? '')];
  const legIn = g.flights[String(d.data?.flightId ?? '')];
  const legOut = g.flights[String(d.data?.outId ?? '')];
  if (!k || !legIn || !legOut || legIn.status !== 'scheduled' || legOut.status !== 'scheduled') return { ok: true, msg: 'Nothing left to change' };
  const prev = legIn.from;
  const next = legOut.to;
  const before = (legIn.block ?? 0) + (legOut.block ?? 0);
  let msg: string;
  if (opt === 'alternate' && d.data?.alt) {
    const alt = String(d.data.alt);
    reroute(g, k, legIn, prev, alt, legIn.std);
    reroute(g, k, legOut, alt, next, legOut.std);
    msg = `${legIn.no} now flies ${prev}–${alt}, ${legOut.no} ${alt}–${next}`;
  } else if (opt === 'stayPrev' || opt === 'goOn') {
    const std = opt === 'stayPrev' ? legOut.std : legIn.std;
    dropLeg(g, k, legOut);
    reroute(g, k, legIn, prev, next, std);
    msg = `${legIn.no} flies ${prev}–${next} on ${fmtDay(std)}`;
  } else if (opt === 'wait') {
    const e = (g.world?.events ?? []).find((x) => x.id === String(d.data?.eventId ?? ''));
    if (!e) return { ok: true, msg: 'It has reopened' };
    legIn.closedBy = e.id;
    const n = waitLegs(g, k, e);
    return { ok: true, msg: n ? `The tour waits: ${n} legs moved` : 'Nothing had to move' };
  } else return { ok: false, error: 'Unknown option' };
  // Force majeure: the client pays the whole tour, so the plan's revenue minutes follow the new legs.
  const after = opt === 'alternate' ? legIn.block + legOut.block : legIn.block;
  if (k.planRevMin !== undefined) k.planRevMin = Math.max(1, k.planRevMin - before + after);
  return { ok: true, msg };
}

/**
 * A storm closing the next stop of the first world tour under way (or signed) for five days, and the card it raises;
 * the decision id ('' when there is no tour, or nothing to ask). Dev/test helper.
 */
export function devTourStopClosed(g: GameState): string {
  const k = Object.values(g.contracts).find((c) => c.archetype === 'worldTour' && (c.status === 'active' || c.status === 'signed'));
  if (!k) return '';
  const next = tourLegs(g, k).find((f, i, all) => f.status === 'scheduled' && i + 1 < all.length && all[i + 1].from === f.to);
  if (!next) return '';
  const at = AIRPORT_BY_CODE[next.to];
  startEvent(g, { id: 'devTourStorm', kind: 'disaster', at: next.to, country: at?.country ?? '', airportDays: [5, 5], days: [5, 5], work: [], title: `Storm closes ${at?.city ?? next.to} airport`, body: 'Gales over the island: the airport is closed until about {until}.', reopen: `${at?.city ?? next.to} has reopened` });
  return g.decisions.find((d) => d.kind === 'tourStop' && d.data?.contractId === k.id)?.id ?? '';
}
