// v0.8 invented world events (UPDATE-0.8.md §5): coups, strikes, ash, disasters, airline failures, wars, airspace
// closures, unrest, engine crises and recessions in real places. They create urgent work, market shocks and fuel
// jumps, and risks: closed airports hold our flights (wait or cancel as force majeure), closed airspace reroutes
// overflights, and war-risk cover is paid per landing. Views are pure; generation and effects are action-side.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { inRing, WORLD_ZONES, ZONE_BY_ID, type WorldZone } from '../../data/worldZones';
import { interpolateGC } from '../core/geo';
import type { Flight, GameState, Minute, WorldEvent, WorldEventKind } from '../core/types';

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

/** The live event closing this airport at t (its airspace or the airport itself). Pure. */
export function closedAirport(g: GameState, code: string, t: Minute = g.now): WorldEvent | null {
  for (const e of eventsOf(g)) {
    if (e.done || t < e.start || t >= e.end) continue;
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
    const touch = (code: string) => (e.airportClosedUntil && code === e.at) || (e.closed && z && inZone(z, code));
    if (touch(f.from) || touch(f.to)) held.push(f);
    else if (e.closed && z && crosses(z, f.from, f.to)) over.push(f);
  }
  return { held, over };
}

/** Starts a world event now (kind or template; random otherwise); its id ('' when none). Dev/test helper. */
export function devWorldEvent(_g: GameState, _kind?: WorldEventKind, _tpl?: string): string {
  return '';
}
