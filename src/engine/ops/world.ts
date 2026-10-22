// v0.8 invented world events (UPDATE-0.8.md §5): coups, strikes, ash, disasters, airline failures, wars, airspace
// closures, unrest, engine crises and recessions in real places. They create urgent work, market shocks and fuel
// jumps, and risks: closed airports hold our flights (wait or cancel as force majeure), closed airspace reroutes
// overflights, and war-risk cover is paid per landing. Views are pure; generation and effects are action-side.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { TPL_BY_ID, WORLD_EVENT_TPLS, type WorldEventTpl } from '../../data/worldEvents';
import { inRing, WORLD_ZONES, ZONE_BY_ID, type WorldZone } from '../../data/worldZones';
import { BAL } from '../core/balance';
import { cancelFlight, nextId, removeFlights, retimeFlight } from '../core/entities';
import { distance, interpolateGC } from '../core/geo';
import { invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, next, pick, range, weightedPick, type RngHolder } from '../core/rng';
import { DAY, fmtDay, monthKey, toDate } from '../core/time';
import { hash, hashUnit } from '../core/util';
import type { ActionResult, Contract, Decision, Flight, GameState, Minute, SimEvent, WorldEvent, WorldEventKind } from '../core/types';
import { warRiskCost } from '../contracts/missionChecks';
import { eventOffer } from '../contracts/missions';
import { statsV08 } from '../contracts/relations';
import { ceaseRival, isActive } from '../contracts/rivals';
import { creditCancelledLeg, noteLostLegs } from '../contracts/billing';
import { addShock, setPhase } from './market';
import { ask } from './events';
import { moveFlight } from './flights';
import { subcharter, subcharterQuotes } from './subcharter';
import { contractOf, isRevenue } from './util';

export type { WorldEvent, WorldEventKind };

export interface WorldEventView {
  id: string; kind: WorldEventKind; title: string; body: string; place: string; at: string; country: string;
  start: Minute; end: Minute; active: boolean; effects: string[]; flights: string[]; offers: string[]; zoneId?: string; icon: string;
}

export interface ZoneView { id: string; eventId: string; name: string; ring: [number, number][]; style: 'closed' | 'warRisk' | 'ash'; label: string }

export const EVENT_ICON: Record<WorldEventKind, string> = {
  coup: 'shield', war: 'shield', unrest: 'shield', strike: 'hand', ash: 'cloud', disaster: 'wave', airlineFailure: 'tailDown', airspace: 'noEntry', engineCrisis: 'engine', recession: 'chartDown',
};

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/** Events (newest first). Pure. */
export const eventsOf = (g: GameState): WorldEvent[] => g.world?.events ?? [];
/** Active now: started, not ended. Pure. */
export const isLive = (g: GameState, e: WorldEvent) => !e.done && e.start <= g.now && g.now < e.end;

// ---------- geometry ----------

const crossCache = new Map<string, boolean>();

/** The great circle from → to passes through the zone (24 samples, endpoints excluded). Pure. */
export function crosses(zone: WorldZone, from: string, to: string): boolean {
  const key = `${zone.id}:${from}:${to}`;
  const hit = crossCache.get(key);
  if (hit !== undefined) return hit;
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  let out = false;
  if (A && B) {
    for (let i = 1; i < 24 && !out; i++) {
      const [lon, lat] = interpolateGC(A.lon, A.lat, B.lon, B.lat, i / 24);
      if (inRing(zone.ring, lon, lat)) out = true;
    }
  }
  crossCache.set(key, out);
  return out;
}

/** The airport lies inside the zone (its list or its outline). Pure. */
export function inZone(zone: WorldZone, code: string): boolean {
  if (zone.airports.includes(code)) return true;
  const a = AIRPORT_BY_CODE[code];
  return !!a && (zone.countries.includes(a.country) || inRing(zone.ring, a.lon, a.lat));
}

const warZoneMemo = new Map<string, boolean>();
/** Inside a zone insurers always list at level 3 (Yemen, Syria): no airline sends a leased jet there. Pure. */
export function inWarZone(code: string): boolean {
  let v = warZoneMemo.get(code);
  if (v === undefined) {
    v = WORLD_ZONES.some((z) => z.baseWarRisk === 3 && inZone(z, code));
    warZoneMemo.set(code, v);
  }
  return v;
}

/** War-risk level at an airport now: the live events' levels, else the zone's standing listing. Pure. */
export function warRiskAt(g: GameState, code: string): 0 | 1 | 2 | 3 {
  let lv = 0;
  for (const e of eventsOf(g)) {
    if (!isLive(g, e) || !e.warRisk || !e.zoneId) continue;
    const z = ZONE_BY_ID[e.zoneId];
    if (z && inZone(z, code)) lv = Math.max(lv, e.warRisk);
  }
  for (const z of WORLD_ZONES) if (z.baseWarRisk && inZone(z, code)) lv = Math.max(lv, z.baseWarRisk);
  return lv as 0 | 1 | 2 | 3;
}

/** The live event closing this airport at t (its airspace or the airport itself); never `exempt` (the event whose own work it is: an evacuation or relief permit). Pure. */
export function closedAirport(g: GameState, code: string, t: Minute = g.now, exempt?: string): WorldEvent | null {
  for (const e of eventsOf(g)) {
    if (e.done || t < e.start || t >= e.end || e.id === exempt) continue;
    if (e.airportClosedUntil && e.at === code && t < e.airportClosedUntil) return e;
    if (e.closed && e.zoneId && ZONE_BY_ID[e.zoneId] && inZone(ZONE_BY_ID[e.zoneId], code)) return e;
  }
  return null;
}

// ---------- views ----------

function effectsOf(g: GameState, e: WorldEvent): string[] {
  const out: string[] = [];
  const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
  if (e.closed && z) out.push(`${z.adj} airspace closed: flights into it wait, flights over it fly about ${z.detourMin} min longer`);
  if (e.airportClosedUntil && e.airportClosedUntil > g.now) out.push(`${city(e.at)} airport closed`);
  if (e.warRisk) out.push(`War-risk cover level ${e.warRisk} at ${z ? z.name : city(e.at)} airports`);
  for (const s of g.market.shocks ?? []) if (s.eventId === e.id && s.until > g.now) out.push(`${s.delta > 0 ? '+' : '−'}${Math.round(Math.abs(s.delta) * 100)} % ${s.seg === 'all' ? '' : `${s.seg}body `}demand`.replace('  ', ' '));
  if (e.offerIds.length) out.push(`${e.offerIds.length} offer${e.offerIds.length === 1 ? '' : 's'} from it`);
  if (e.flightsHit) out.push(`${e.flightsHit} of our legs affected`);
  return out;
}

function viewOf(g: GameState, e: WorldEvent): WorldEventView {
  const flights = Object.values(g.flights).filter((f) => f.status === 'scheduled' && (f.closedBy === e.id || flightZone(g, f.id)?.eventId === e.id)).map((f) => f.id);
  return {
    id: e.id, kind: e.kind, title: e.title, body: e.body, place: `${city(e.at)}${AIRPORT_BY_CODE[e.at] ? `, ${e.country}` : ''}`, at: e.at, country: e.country,
    start: e.start, end: e.end, active: isLive(g, e), effects: effectsOf(g, e), flights,
    offers: e.offerIds.filter((id) => g.offers[id] && (g.offers[id].status === 'open' || g.offers[id].status === 'countered')),
    ...(e.zoneId ? { zoneId: e.zoneId } : {}), icon: EVENT_ICON[e.kind],
  };
}

/** World events, newest first (active only with opts.active). Pure. */
export function worldEvents(g: GameState, opts: { active?: boolean } = {}): WorldEventView[] {
  return eventsOf(g).filter((e) => !opts.active || isLive(g, e)).sort((a, b) => b.start - a.start).map((e) => viewOf(g, e));
}

/** One event. Pure. */
export function worldEvent(g: GameState, eventId: string): WorldEventView | null {
  const e = eventsOf(g).find((x) => x.id === eventId);
  return e ? viewOf(g, e) : null;
}

const zoneMemo = new WeakMap<GameState, { key: string; out: ZoneView[] }>();

/** Shaded zones of live events (closed / war risk / ash); the same array while nothing changes (MAP memo). Pure. */
export function worldZones(g: GameState): ZoneView[] {
  const live = eventsOf(g).filter((e) => isLive(g, e) && e.zoneId && ZONE_BY_ID[e.zoneId] && (e.closed || e.warRisk || e.kind === 'ash'));
  const key = live.map((e) => `${e.id}:${e.closed ? 1 : 0}:${e.warRisk ?? 0}`).join('|');
  const hit = zoneMemo.get(g);
  if (hit && hit.key === key) return hit.out;
  const out: ZoneView[] = live.map((e) => {
    const z = ZONE_BY_ID[e.zoneId!];
    const style: ZoneView['style'] = e.kind === 'ash' ? 'ash' : e.closed ? 'closed' : 'warRisk';
    return { id: z.id, eventId: e.id, name: z.name, ring: z.ring, style, label: `${style === 'warRisk' ? 'War risk' : style === 'ash' ? 'Ash' : 'Closed'} · ${z.name}` };
  });
  zoneMemo.set(g, { key, out });
  return out;
}

/** One pin per live event at its airport. Pure. */
export function worldEventPins(g: GameState): { eventId: string; at: string; kind: WorldEventKind; title: string }[] {
  return eventsOf(g).filter((e) => isLive(g, e) && AIRPORT_BY_CODE[e.at]).map((e) => ({ eventId: e.id, at: e.at, kind: e.kind, title: e.title }));
}

/** How a world event touches one of our flights: held by a closure, rerouted, or paying war-risk cover. Pure. */
export function flightZone(g: GameState, flightId: string): { eventId: string; effect: 'held' | 'detour' | 'warRisk'; text: string } | null {
  const f = g.flights[flightId];
  if (!f || f.kind === 'deadhead') return null;
  if (f.closedBy) {
    const e = eventsOf(g).find((x) => x.id === f.closedBy);
    if (e && !e.done) return { eventId: e.id, effect: 'held', text: `Held: ${e.title}` };
  }
  for (const e of eventsOf(g)) {
    if (e.done || e.end <= f.std || e.start > f.sta) continue;
    const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
    if (e.closed && z && f.detour && crosses(z, f.from, f.to)) return { eventId: e.id, effect: 'detour', text: `Rerouted around ${z.name}: +${f.detour} min` };
    if (e.warRisk && z && (inZone(z, f.to) || inZone(z, f.from))) return { eventId: e.id, effect: 'warRisk', text: `War-risk cover at ${city(inZone(z, f.to) ? f.to : f.from)} (level ${e.warRisk})` };
  }
  return null;
}

/** Flights a live closure touches (from/to inside) or that overfly it. Pure. */
export function closureHits(g: GameState, e: WorldEvent): { held: Flight[]; over: Flight[] } {
  const held: Flight[] = [];
  const over: Flight[] = [];
  const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead' || f.std >= e.end + 1440) continue;
    // The event's own work (evacuation, relief) flies under a permit.
    if (f.contractId && g.contracts[f.contractId]?.eventId === e.id) continue;
    const touch = (code: string) => (e.airportClosedUntil && code === e.at) || (e.closed && z && inZone(z, code));
    if (touch(f.from) || touch(f.to)) held.push(f);
    else if (e.closed && z && crosses(z, f.from, f.to)) over.push(f);
  }
  return { held, over };
}

// ---------- generation (§5.2) ----------

const W = () => BAL.v08.world;
const side = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:world:${key}`) | 0 });
const homeCountry = (g: GameState) => AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';

/** Templates that may start now: not our home country's airspace, an airline failure never on a client we fly for. */
function allowed(g: GameState, t: WorldEventTpl): boolean {
  const z = t.zoneId ? ZONE_BY_ID[t.zoneId] : undefined;
  if (t.closeP && z && (z.countries.includes(homeCountry(g)) || inZone(z, g.company.homeBase))) return false;
  if (t.airportDays && t.at === g.company.homeBase) return false;
  if (!AIRPORT_BY_CODE[t.at]) return false;
  if (t.months && !t.months.includes(toDate(g.now).getUTCMonth())) return false;
  if (eventsOf(g).some((e) => isLive(g, e) && e.tpl === t.id)) return false;
  if (t.kind === 'airlineFailure') {
    if (t.entity === '{rival}') return g.rivals.filter(isActive).length > 8;
    const cl = Object.values(g.clients).find((c) => c.name === t.entity);
    if (cl && Object.values(g.contracts).some((k) => k.clientId === cl.id && (k.status === 'active' || k.status === 'signed'))) return false;
  }
  return true;
}

/**
 * How close a template is to our flying: 1 when its zone, focus airport or strike countries touch (or its zone is
 * overflown by) our scheduled legs in the next 30 days, 0.5 when its focus is within 2,500 km of home, else 0. Pure.
 */
function relevance(g: GameState): (t: WorldEventTpl) => number {
  const airports = new Set<string>();
  const countries = new Set<string>();
  const sectors = new Map<string, [string, string]>();
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.std > g.now + 30 * DAY) continue;
    for (const c of [f.from, f.to]) {
      airports.add(c);
      const k = AIRPORT_BY_CODE[c]?.country;
      if (k) countries.add(k);
    }
    sectors.set(`${f.from}-${f.to}`, [f.from, f.to]);
  }
  const home = g.company.homeBase;
  const memo = new Map<string, number>();
  const zoneHit = new Map<string, boolean>();
  const touches = (z: WorldZone) => {
    let v = zoneHit.get(z.id);
    if (v === undefined) {
      v = [...airports].some((c) => inZone(z, c)) || [...sectors.values()].some(([a, b]) => crosses(z, a, b));
      zoneHit.set(z.id, v);
    }
    return v;
  };
  return (t) => {
    let v = memo.get(t.id);
    if (v !== undefined) return v;
    const z = t.zoneId ? ZONE_BY_ID[t.zoneId] : undefined;
    v = airports.has(t.at) || t.delayCountries?.some((c) => countries.has(c)) || (z && touches(z)) ? 1
      : AIRPORT_BY_CODE[t.at] && AIRPORT_BY_CODE[home] && distance(t.at, home) <= 2500 ? 0.5 : 0;
    memo.set(t.id, v);
    return v;
  };
}

/** Daily (§5.2): about two events a month, at most three live, the same kind 20 days apart, crises and recessions rare. */
export function dailyWorld(g: GameState): void {
  const w = (g.world ??= { events: [] });
  // Work still to come from live events, 0–48 h after they start.
  for (const e of w.events) if (isLive(g, e) && e.workLeft?.length && g.now - e.start <= 2 * DAY) makeWork(g, e, 1);
  // Closures keep catching new flights; war-risk cover can be withdrawn 48 h before; courts stop deportation flights.
  for (const e of w.events) if (isLive(g, e)) applyClosure(g, e, false);
  uninsurableChecks(g);
  injunctions(g);
  const live = w.events.filter((e) => isLive(g, e));
  const r = side(g, `d${Math.floor(g.now / DAY)}`);
  if (g.gameOver || live.length >= W().maxActive || !chance(r, W().perDay)) return;
  const last = (w.lastKind ??= {});
  const kinds = Object.entries(W().weights).filter(([k]) => {
    const t0 = last[k as WorldEventKind];
    if (t0 !== undefined && g.now - t0 < W().sameKindDays * DAY) return false;
    if (k === 'engineCrisis' && t0 !== undefined && g.now - t0 < 365 * DAY) return false;
    if (k === 'recession' && t0 !== undefined && g.now - t0 < 730 * DAY) return false;
    // A new game starts steady for at least 9 months (§4.2): no recession before then.
    if (k === 'recession' && g.now - g.started < 270 * DAY) return false;
    return WORLD_EVENT_TPLS.some((t) => t.kind === k && allowed(g, t));
  });
  // v0.8 events near our own flying are likelier (§5.2: about one a quarter should touch our legs).
  const rel = relevance(g);
  const relOf = (k: string) => Math.max(0, ...WORLD_EVENT_TPLS.filter((t) => t.kind === k && allowed(g, t)).map(rel));
  const kind = weightedPick(r, kinds, ([k, x]) => x * (1 + 3 * relOf(k)))?.[0] as WorldEventKind | undefined;
  if (!kind) return;
  const tpl = weightedPick(r, WORLD_EVENT_TPLS.filter((t) => t.kind === kind && allowed(g, t)), (t) => 1 + 5 * rel(t));
  if (tpl) startEvent(g, tpl, r);
}

/** Starts an event from a template now: closure, war risk, market shock, fuel jump, rival ceasing, work, one message. */
export function startEvent(g: GameState, t: WorldEventTpl, r: RngHolder = side(g, `s${g.now}:${t.id}`)): WorldEvent {
  const w = (g.world ??= { events: [] });
  const D = t.days ?? W().days[t.kind] ?? [3, 10];
  const days = t.kind === 'recession' ? int(r, 6, 12) * 30 : int(r, D[0], D[1]);
  const rival = t.entity === '{rival}' ? weightedPick(r, g.rivals.filter((x) => isActive(x) && x.personality !== 'big'), (x) => (x.personality === 'cheap' ? 3 : 1)) : undefined;
  const fill = (s: string) => s.replace(/\{rival\}/g, rival?.name ?? 'A rival').replace(/\{until\}/g, fmtDay(g.now + days * DAY));
  // The closure is rolled first so the text never promises one that didn't happen.
  const closed = !!(t.zoneId && t.closeP && chance(r, t.closeP));
  const text = !closed && t.open ? t.open : t;
  const at = rival?.base ?? t.at;
  const e: WorldEvent = {
    id: nextId(g, 'we'), kind: t.kind, tpl: t.id, title: fill(text.title), body: fill(text.body), country: rival ? AIRPORT_BY_CODE[at]?.country ?? t.country : t.country, at,
    start: g.now, end: g.now + days * DAY, offerIds: [], flightsHit: 0, ev: 0,
    ...(t.zoneId ? { zoneId: t.zoneId } : {}),
    ...(closed ? { closed: true } : {}),
    ...(t.warRisk ? { warRisk: t.warRisk } : {}),
    ...(t.airportDays ? { airportClosedUntil: g.now + int(r, t.airportDays[0], t.airportDays[1]) * DAY } : {}),
    ...(rival ? { rivalId: rival.id, entity: rival.name } : t.entity ? { entity: t.entity } : {}),
    workLeft: t.work.slice(0, Math.max(1, Math.min(t.work.length, int(r, 1, 3)))),
  };
  w.events.push(e);
  if (w.events.length > 40) w.events.splice(0, w.events.length - 40);
  (w.lastKind ??= {})[t.kind] = g.now;
  statsV08(g).worldEvents++;
  // Market: a demand shock, a fuel jump, a recession's slump.
  if (t.shock) addShock(g, { seg: t.shock.seg, delta: t.shock.delta, until: e.end, text: fill(t.shock.text), eventId: e.id });
  if (t.kind === 'airlineFailure' && !t.shock) addShock(g, { seg: 'narrow', delta: 0.08, until: g.now + 60 * DAY, text: e.title, eventId: e.id });
  if (t.fuel) g.market.fuelPrice = Math.round(g.market.fuelPrice * (1 + range(r, t.fuel[0], t.fuel[1])));
  if (t.kind === 'recession') setPhase(g, 'slump', Math.round(days / 30));
  if (rival) ceaseRival(g, rival.id);
  if (e.zoneId === 'iran' || e.kind === 'war') g.market.fuelPrice = Math.min(1250, g.market.fuelPrice);
  pushMessage(g, {
    tone: e.closed || e.kind === 'war' || e.kind === 'coup' ? 'warn' : 'info', cat: e.kind === 'airlineFailure' || e.kind === 'recession' || e.kind === 'engineCrisis' ? 'commercial' : 'ops',
    title: e.title, body: e.body, ref: { kind: 'event', id: e.id }, topic: 'world',
  });
  applyClosure(g, e, true);
  makeWork(g, e, 1);
  schedule(g, e.end, 'world.end', e.id, e.ev ?? 0);
  return e;
}

/** Creates up to n of the event's remaining offers (evacuation, repatriation, relief, medical, ACMI cover). */
function makeWork(g: GameState, e: WorldEvent, n: number): void {
  const t = TPL_BY_ID[e.tpl];
  for (let i = 0; i < n && e.workLeft?.length; i++) {
    const kind = e.workLeft.shift()! as Parameters<typeof eventOffer>[1];
    const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
    const pair = z?.staging?.find(([a, b]) => AIRPORT_BY_CODE[a] && AIRPORT_BY_CODE[b]);
    const cover = (t?.coverFor ?? []).map((name) => Object.values(g.clients).find((c) => c.name === name)).find((c) => !!c);
    // A failed airline's or rival's work goes to the airlines nearest its base (its own market).
    const rivalClients = (e.rivalId || e.kind === 'airlineFailure') && AIRPORT_BY_CODE[e.at]
      ? Object.values(g.clients).filter((c) => c.kind === 'airline' && !c.rivalId && AIRPORT_BY_CODE[c.base]).sort((a, b) => distance(a.base, e.at) - distance(b.base, e.at) || a.id.localeCompare(b.id)).slice(0, 3)
      : [];
    // The work is drawn from the event's own stream: an event never shifts the game's main random sequence.
    const main = g.rng;
    g.rng = hash(`${g.seed}:work:${e.id}:${e.offerIds.length}:${kind}`) | 0;
    let o: ReturnType<typeof eventOffer> = null;
    try {
      const client = cover?.id ?? (rivalClients.length ? pick(g, rivalClients).id : undefined);
      const at = kind === 'evacuation' && pair ? pair[0] : e.at;
      o = eventOffer(g, kind, at, e.id, { staging: pair?.[1], client, sar: e.kind === 'disaster' });
    } finally {
      g.rng = main;
    }
    if (o) e.offerIds.push(o.id);
  }
}

/** 'world.end': a closure may run on (30 %, once, 2–5 days); else the event ends and closed airspace reopens. */
export function onWorldEnd(g: GameState, ev: SimEvent): void {
  const e = eventsOf(g).find((x) => x.id === ev.id);
  if (!e || e.done || (e.ev ?? 0) !== ev.v || g.now < e.end) return;
  const r = side(g, `x:${e.id}`);
  if (e.closed && !e.extended && chance(r, W().extend)) {
    e.extended = true;
    e.end += int(r, 2, 5) * DAY;
    e.ev = (e.ev ?? 0) + 1;
    schedule(g, e.end, 'world.end', e.id, e.ev);
    pushMessage(g, { tone: 'warn', cat: 'ops', title: `${e.title}: closed until ${fmtDay(e.end)}`, body: 'The closure has been extended. Flights waiting for it move again.', ref: { kind: 'event', id: e.id }, topic: 'world' });
    applyClosure(g, e, false, true);
    return;
  }
  e.done = true;
  for (const f of Object.values(g.flights)) if (f.closedBy === e.id) delete f.closedBy;
  const t = TPL_BY_ID[e.tpl];
  if (e.closed || e.airportClosedUntil) {
    pushMessage(g, { tone: 'good', cat: 'ops', title: t?.reopen ?? `${AIRPORT_BY_CODE[e.at]?.city ?? e.at} has reopened`, body: 'Flights there run normally again.', ref: { kind: 'event', id: e.id }, topic: 'world' });
  }
}

// ---------- closures and reroutes (§5.4) ----------

/** Legs of one contract (or the aircraft's own legs) that touch the event's closed airports or fly over it. */
function applyClosure(g: GameState, e: WorldEvent, first: boolean, again = false): void {
  if (!e.closed && !(e.airportClosedUntil && e.airportClosedUntil > g.now)) return;
  const { held, over } = closureHits(g, e);
  const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
  const v8 = statsV08(g);
  // Overflights: rerouted once, + the zone's detour.
  let rerouted = 0;
  for (const f of over) {
    if (f.detour || !z) continue;
    f.detour = z.detourMin;
    retimeFlight(g, f, f.std, f.sta + z.detourMin);
    rerouted++;
  }
  v8.legsRerouted += rerouted;
  e.rerouted = (e.rerouted ?? 0) + rerouted;
  // Held legs, per contract: a base programme drops the waves (force majeure); a trip waits (default) or cancels.
  const fresh = held.filter((f) => f.closedBy !== e.id || again);
  const byContract = new Map<string, Flight[]>();
  for (const f of fresh) {
    f.closedBy = e.id;
    const key = f.contractId ?? `ac:${f.aircraftId}`;
    (byContract.get(key) ?? byContract.set(key, []).get(key)!).push(f);
  }
  if (fresh.length) {
    if (!again) e.flightsHit += fresh.length;
    v8.closuresHit++;
  }
  for (const [key, legs] of byContract) {
    const k = key.startsWith('ac:') ? undefined : g.contracts[key];
    const until = closedUntil(e);
    if (k?.pattern.kind === 'base' || !k) {
      const n = cancelForceMajeure(g, legs.filter((f) => f.std < until), `Closed: ${e.title}`);
      if (n) pushMessage(g, { tone: 'warn', cat: 'ops', title: `${n} leg${n > 1 ? 's' : ''} dropped: ${e.title}`, body: `Force majeure: no penalty and no reputation lost. ${k ? `${k.title} flies again after the reopening.` : ''}`.trim(), ref: { kind: 'event', id: e.id }, topic: 'world' });
      continue;
    }
    if (again) {
      waitLegs(g, k, e);
      continue;
    }
    // Legs of a programme the player was already asked about for this closure join that question or follow its
    // answer (no new question every day).
    if (g.decisions.some((d) => d.kind === 'airspace' && d.data?.eventId === e.id && d.data?.contractId === k.id)) continue;
    const prior = Object.values(g.flights).filter((f) => f.contractId === k.id && f.closedBy === e.id && !legs.includes(f));
    if (prior.some((f) => f.status === 'scheduled')) {
      waitLegs(g, k, e);
      continue;
    }
    if (prior.some((f) => f.status === 'cancelled')) {
      cancelForceMajeure(g, legs, `Cancelled: ${e.title}`);
      continue;
    }
    ask(g, {
      kind: 'airspace', title: `${e.title}: ${legs.length} leg${legs.length > 1 ? 's' : ''} of ${k.title}`,
      body: `${legs.map((f) => `${f.no} ${f.from}–${f.to}`).slice(0, 3).join(', ')} cannot fly while it is closed (until about ${fmtDay(until)}). Force majeure: no penalty either way.`,
      options: [
        { id: 'wait', label: 'Wait for the reopening', desc: `The legs move to ${fmtDay(until)} 3 h after it reopens; later legs follow.`, chips: ['No penalty', 'Late'] },
        { id: 'cancel', label: 'Cancel these legs', desc: 'Force majeure: no compensation, the hours come off the month; no reputation lost.', tone: 'warn', chips: ['No penalty', `${legs.length} legs`] },
      ],
      defaultOption: 'wait', expires: g.now + 12 * 60, ref: { kind: 'event', id: e.id }, data: { eventId: e.id, contractId: k.id },
    }, true);
  }
  if (first && (rerouted || fresh.length) && z) {
    const n = fresh.length;
    pushMessage(g, {
      tone: 'warn', cat: 'ops', title: `${z.adj} airspace closed`,
      body: `${rerouted ? `${rerouted} of our legs rerouted around it, +${z.detourMin} min each. ` : ''}${n ? `${n} leg${n > 1 ? 's' : ''} into it wait for the reopening.` : ''}`.trim(),
      ref: { kind: 'event', id: e.id }, problem: { kind: 'airspaceClosed', ref: { kind: 'event', id: e.id } }, topic: 'world',
    });
  }
}

/** When flights may use the closed airport again. */
const closedUntil = (e: WorldEvent) => (e.closed ? e.end : Math.min(e.end, e.airportClosedUntil ?? e.end));

/**
 * Wait: the contract's held legs move to 3 h after the reopening, their spacing kept; its later legs on that aircraft
 * move only as far as the turn needs (a long programme is not pushed back by the whole closure).
 */
function waitLegs(g: GameState, k: Contract, e: WorldEvent): number {
  const until = closedUntil(e) + 3 * 60;
  const held = Object.values(g.flights).filter((f) => f.contractId === k.id && f.status === 'scheduled' && f.closedBy === e.id && f.std < until).sort((a, b) => a.std - b.std);
  if (!held.length) return 0;
  const shift = until - held[0].std;
  if (shift <= 0) return 0;
  const ids = new Set(held.map((f) => f.id));
  const later = Object.values(g.flights).filter((f) => f.contractId === k.id && f.status === 'scheduled' && f.aircraftId && f.std >= held[0].std && !ids.has(f.id)).sort((a, b) => a.std - b.std);
  let moved = 0;
  for (const f of held) {
    moveFlight(g, f, f.std + shift, `Waiting: ${e.title}`);
    moved++;
  }
  const turn = (f: Flight) => (f.aircraftId && g.fleet[f.aircraftId] ? typeOf(g.fleet[f.aircraftId].typeId).turnMin : 45);
  let ready = held[held.length - 1].sta + turn(held[held.length - 1]);
  for (const f of later) {
    if (f.std >= ready) break;
    moveFlight(g, f, ready, `Waiting: ${e.title}`);
    ready = f.sta + turn(f);
    moved++;
  }
  return moved;
}

/** Resolver of 'airspace' decisions: wait (retime) or cancel as force majeure. */
export function resolveAirspace(g: GameState, d: Decision, opt: string): ActionResult {
  const e = eventsOf(g).find((x) => x.id === String(d.data?.eventId ?? ''));
  const k = g.contracts[String(d.data?.contractId ?? '')];
  if (!e || !k) return { ok: true };
  if (opt === 'wait') return { ok: true, msg: `${waitLegs(g, k, e)} legs moved to after the reopening` };
  if (opt === 'cancel') {
    const legs = Object.values(g.flights).filter((f) => f.contractId === k.id && f.status === 'scheduled' && f.closedBy === e.id);
    return { ok: true, msg: `${cancelForceMajeure(g, legs, `Cancelled: ${e.title}`)} legs cancelled (force majeure)` };
  }
  return { ok: false, error: 'Unknown option' };
}

/**
 * Force majeure (§5.4): legs cancelled for a world event or a client's own change: no compensation, the block minutes
 * come off the month's MGH (lostMin), no relation or reliability change. Positioning legs are removed. Returns the
 * revenue legs cancelled.
 */
export function cancelForceMajeure(g: GameState, legs: Flight[], reason: string): number {
  const live = legs.filter((f) => f.status === 'scheduled');
  noteLostLegs(g, live);
  let n = 0;
  const empty: string[] = [];
  for (const f of live) {
    if (f.kind === 'positioning') {
      empty.push(f.id);
      continue;
    }
    cancelFlight(g, f, reason);
    if (isRevenue(f)) n++;
  }
  if (empty.length) removeFlights(g, empty);
  statsV08(g).legsFm += n;
  return n;
}

/** An air traffic controllers' strike on this leg's countries: minutes late and the reason, else null. Pure. */
export function strikeDelay(g: GameState, f: Flight): { min: number; reason: string; eventId: string } | null {
  const cs = [AIRPORT_BY_CODE[f.from]?.country, AIRPORT_BY_CODE[f.to]?.country];
  for (const e of eventsOf(g)) {
    const t = TPL_BY_ID[e.tpl];
    if (!isLive(g, e) || !t?.delayCountries || !t.delayMin || !cs.some((c) => c && t.delayCountries!.includes(c))) continue;
    const k = 0.5 + hashUnit(`${g.seed}:atc:${f.id}`);
    return { min: Math.round((t.delayMin * k) / 5) * 5, reason: `${t.delayWhat ?? 'ATC strike'}: ${e.title.replace(/ \(.*\)$/, '')}`, eventId: e.id };
  }
  return null;
}

/** Departure check (ops flights.ts): a leg to or from a closed airport does not leave; true when held. */
export function closedAtDeparture(g: GameState, f: Flight): WorldEvent | null {
  const own = f.contractId ? g.contracts[f.contractId]?.eventId : undefined;
  return closedAirport(g, f.from, g.now, own) ?? closedAirport(g, f.to, g.now, own);
}

// ---------- war-risk cover (§5.4) ----------

/** At departure: the landing's war-risk cover (warRisk ledger); a wet client is re-billed the same amount. */
export function payWarRisk(g: GameState, f: Flight): void {
  if (f.kind === 'deadhead' || !f.aircraftId) return;
  const lv = warRiskAt(g, f.to);
  if (!lv) return;
  const ac = g.fleet[f.aircraftId];
  const cost = warRiskCost(lv, typeOf(ac?.typeId ?? 'a320ceo').body === 'wide');
  if (!cost) return;
  post(g, 'warRisk', -cost);
  f.warRisk = cost;
  statsV08(g).warRiskPaid += cost;
  const c = contractOf(g, f);
  if (c?.product.kind === 'wet') invoice(g, { clientId: c.clientId, contractId: c.id, desc: `War-risk cover ${f.no} to ${AIRPORT_BY_CODE[f.to]?.city ?? f.to}`, amount: cost, cat: 'otherRevenue', dueDays: c.payment.dueDays });
}

/** Charter pricing: war-risk cover for the landings at listed airports (offers built while the risk exists). Pure. */
export function warRiskLandings(g: GameState, legs: { to: string }[], wide: boolean): number {
  let s = 0;
  for (const l of legs) s += warRiskCost(warRiskAt(g, l.to), wide);
  return s;
}

/** Daily: legs into level-3 war risk 24–48 h out: 10 % lose cover (decision); 'wait' legs try again (50 %). */
function uninsurableChecks(g: GameState): void {
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead' || f.uninsured === 'ok' || f.uninsured === 'asked') continue;
    if (f.std < g.now + 24 * 60 || f.std > g.now + 48 * 60 || warRiskAt(g, f.to) < 3) continue;
    if (f.uninsured === 'wait') {
      if (chance(side(g, `ins:${f.id}:${Math.floor(g.now / DAY)}`), 0.5)) {
        f.uninsured = 'ok';
        pushMessage(g, { tone: 'good', cat: 'ops', title: `War-risk cover back for ${f.no}`, body: `The insurer covers ${AIRPORT_BY_CODE[f.to]?.city ?? f.to} again; ${f.no} flies as planned.`, ref: { kind: 'flight', id: f.id }, topic: 'world' });
        continue;
      }
    } else if (hashUnit(`${g.seed}:unins:${f.id}`) >= W().uninsurable) {
      f.uninsured = 'ok';
      continue;
    }
    f.uninsured = 'asked';
    const city = AIRPORT_BY_CODE[f.to]?.city ?? f.to;
    ask(g, {
      kind: 'uninsurable', title: `No war-risk cover for ${f.to} on ${fmtDay(f.std)}`,
      body: `Insurers withdrew cover for ${city} 48 h before ${f.no}. Without it the flight cannot legally operate.`,
      options: [
        { id: 'wait', label: 'Wait a day', desc: 'Half the time the insurer comes back; the flight moves a day.', chips: ['+24 h'] },
        { id: 'cancel', label: 'Cancel', desc: 'Force majeure: no penalty, no reputation lost.', tone: 'warn', chips: ['No penalty'] },
        { id: 'rival', label: 'Hand to a rival with cover', desc: 'A rescue or government-work operator flies it for us at its price.', tone: 'warn', chips: ['Rival price'] },
      ],
      defaultOption: 'cancel', expires: g.now + 12 * 60, ref: { kind: 'flight', id: f.id }, data: { flightId: f.id },
    }, true);
  }
}

/** The leg and the one that brings the aircraft back out of the war-risk airport. */
function unitInto(g: GameState, f: Flight): Flight[] {
  const back = Object.values(g.flights).filter((x) => x.aircraftId === f.aircraftId && x.status === 'scheduled' && x.from === f.to && x.std >= f.sta).sort((a, b) => a.std - b.std)[0];
  return back ? [f, back] : [f];
}

/** Resolver of 'uninsurable' decisions. */
export function resolveUninsurable(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId ?? '')];
  if (!f || f.status !== 'scheduled') return { ok: true };
  const legs = unitInto(g, f);
  if (opt === 'wait') {
    f.uninsured = 'wait';
    for (const x of [...legs].reverse()) moveFlight(g, x, x.std + DAY, 'Waiting for war-risk cover');
    return { ok: true, msg: `${f.no} moved a day` };
  }
  if (opt === 'rival') {
    const q = subcharterQuotes(g, legs.map((x) => x.id)).find((x) => x.available && (x.style === 'rescue' || x.style === 'military'));
    if (!q) return { ok: false, error: 'No rival with cover can take it' };
    const r = subcharter(g, legs.map((x) => x.id), undefined, q.rivalId);
    return r.ok ? { ok: true, msg: r.msg } : r;
  }
  if (opt === 'cancel') return { ok: true, msg: `${cancelForceMajeure(g, legs, 'No war-risk cover')} legs cancelled (force majeure)` };
  return { ok: false, error: 'Unknown option' };
}

// ---------- deportation injunctions, Antarctic whiteouts ----------

/** Daily (§2.4): a court stops 12 % of deportation flights 2–26 h before departure; the client still pays. */
function injunctions(g: GameState): void {
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || !isRevenue(f) || (f.pax ?? 0) <= 0 || f.std > g.now + 26 * 60 || f.std < g.now + 2 * 60) continue;
    const c = contractOf(g, f);
    if (c?.archetype !== 'deportation' || hashUnit(`${g.seed}:inj:${f.id}`) >= W().injunction) continue;
    creditCancelledLeg(g, f);
    cancelFlight(g, f, 'Court injunction');
    statsV08(g).injunctions++;
    pushMessage(g, {
      tone: 'info', cat: 'ops', title: `High Court injunction: ${f.no} to ${AIRPORT_BY_CODE[f.to]?.city ?? f.to} will not fly`,
      body: `A judge has stopped the flight. ${g.clients[c.clientId]?.name ?? 'The client'} still pays for it; the crew's duty is cancelled.`, ref: { kind: 'flight', id: f.id },
    });
  }
}

/**
 * At departure (§2.8): a leg to the ice turns back at the point of no return in 12 % of departures: we pay the
 * fuel of the turn-back (55 % of the out-and-back block), the rotation moves a day; the client is not upset.
 * True when it turned back (the leg did not leave).
 */
export function whiteout(g: GameState, f: Flight): boolean {
  if (!isRevenue(f) || !AIRPORT_BY_CODE[f.to]?.ice || !f.aircraftId) return false;
  const c = contractOf(g, f);
  if (c?.archetype !== 'antarctic' || hashUnit(`${g.seed}:wo:${f.id}:${f.std}`) >= W().whiteout) return false;
  const ac = g.fleet[f.aircraftId];
  const t = typeOf(ac.typeId);
  const block = Math.round(f.block * 2 * 0.55);
  post(g, 'fuel', -Math.round((block / 60) * t.fuelTBH * g.market.fuelPrice));
  statsV08(g).whiteouts++;
  const legs = unitInto(g, f);
  for (const x of [...legs].reverse()) moveFlight(g, x, x.std + DAY, 'Whiteout: turned back');
  const h = Math.floor(block / 120);
  const m = Math.round(block / 2) % 60;
  pushMessage(g, {
    tone: 'warn', cat: 'ops', title: `Whiteout at ${AIRPORT_BY_CODE[f.to]?.city ?? f.to}: ${ac.reg} turned back`,
    body: `${ac.reg} turned back at the point of no return, ${h}:${String(m).padStart(2, '0')} in. ${g.clients[c.clientId]?.name ?? 'The client'} moves the flight to tomorrow; weather is in the price, the fuel is ours.`,
    ref: { kind: 'flight', id: f.id },
  });
  return true;
}

// ---------- load and dev ----------

/** Load: the world block (none in older saves). */
export function loadWorld(g: GameState): void {
  g.world ??= { events: [] };
}

/** Starts a world event now (kind or template; random allowed otherwise); its id ('' when none). Dev/test helper. */
export function devWorldEvent(g: GameState, kind?: WorldEventKind, tpl?: string): string {
  const pool = WORLD_EVENT_TPLS.filter((t) => (tpl ? t.id === tpl : !kind || t.kind === kind));
  const list = pool.filter((t) => allowed(g, t));
  const t = (list.length ? list : pool)[0];
  if (!t) return '';
  return startEvent(g, t, side(g, `dev:${g.now}:${t.id}`)).id;
}

/** Month key helper for tests. */
export const monthOf = (t: Minute) => monthKey(t);
export const yearOf = (t: Minute) => toDate(t).getUTCFullYear();
export const rnd = (g: GameState) => next(g);
