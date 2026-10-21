// Commercial flights our crews deadhead on (v0.5.2, DESIGN §5.3 tickets). A ticket (Flight kind 'deadhead') is
// shown as the real airline's flight(s): carriers plausible for the route (hub and flag carriers of both ends,
// low-cost carriers point-to-point in their markets), invented IATA-coded flight numbers, one connection at a hub
// when nobody flies the pair. Everything is derived from the ticket (no RNG, nothing saved), so a reload shows the
// same flights. Crew planning times tickets with the same itinerary (ticketBlock).

import { AIRPORT_BY_CODE, type Airport } from '../../data/airports';
import { CARRIER_BY_IATA, CARRIERS, WORLD_HUBS, type Carrier } from '../../data/carriers';
import { deadheadFlights } from '../core/entities';
import { distance } from '../core/geo';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { Flight, GameState, Minute } from '../core/types';
import { hash } from '../core/util';

/** Minimum connection at a hub (minutes). */
export const CONNECT_MIN = 75;
/** Beyond this a narrowbody block time is no longer plausible (widebody speeds). */
const LONG_KM = 4_500;

/** Historic and language links that keep long-haul flag routes alive (Lisbon–Luanda, Paris–Dakar…). */
const LINKS: Record<string, string[]> = {
  PT: ['BR', 'AO', 'MZ', 'CV', 'ST', 'GW', 'US', 'CA', 'VE'],
  ES: ['MX', 'CO', 'PE', 'AR', 'CU', 'DO', 'EC', 'CL', 'UY', 'PA', 'GT', 'SV', 'CR', 'VE', 'BO', 'PY', 'US', 'GQ'],
  FR: ['SN', 'CI', 'ML', 'BF', 'NE', 'CM', 'MA', 'DZ', 'TN', 'MG', 'NC', 'MU', 'SC', 'TG', 'GN', 'MR', 'CD', 'DJ', 'US', 'CA', 'MX', 'BR', 'IN', 'CN', 'JP', 'AE', 'ZA'],
  GB: ['IN', 'PK', 'BD', 'LK', 'ZA', 'KE', 'NG', 'GH', 'US', 'CA', 'JM', 'BS', 'AE', 'QA', 'SG', 'HK', 'AU', 'MV', 'MU', 'SC', 'UG', 'TZ'],
  DE: ['US', 'CA', 'BR', 'IN', 'CN', 'JP', 'ZA', 'NA', 'TH', 'AE', 'MX', 'AR'],
  NL: ['AW', 'US', 'CA', 'ID', 'KE', 'NG', 'ZA', 'BR'],
  BE: ['CD', 'RW', 'UG', 'SN', 'CI', 'GH', 'US'],
  IT: ['US', 'BR', 'AR', 'JP'],
  TR: ['US', 'CA', 'BR', 'NG', 'ZA', 'SO', 'DJ', 'KE', 'ET', 'TZ', 'AF', 'TM', 'UZ', 'TJ', 'IN', 'JP', 'CN', 'KR', 'TH', 'ID', 'MY'],
  MA: ['SN', 'CI', 'ML', 'BF', 'NE', 'CM', 'GN', 'MR', 'TG', 'GA', 'NG', 'GH', 'US', 'CA', 'BR'],
  AE: ['US', 'GB', 'BR', 'ZA', 'KE', 'NG', 'IN', 'PK', 'AU', 'TH', 'CN', 'JP', 'MV', 'SC', 'MU', 'ET', 'TZ'],
  QA: ['US', 'GB', 'BR', 'ZA', 'KE', 'NG', 'IN', 'PK', 'AU', 'TH', 'CN', 'JP', 'MV', 'SC', 'ET', 'TZ', 'RW', 'UG'],
  ET: ['US', 'CA', 'BR', 'NG', 'GH', 'CI', 'SN', 'ZA', 'CN', 'IN', 'AE', 'KR', 'JP', 'TG', 'CM', 'CD', 'SS', 'SO', 'DJ', 'ML', 'BF'],
  US: ['GB', 'FR', 'DE', 'NL', 'IE', 'IT', 'ES', 'PT', 'IS', 'JP', 'KR', 'CN', 'IL', 'BR', 'AR', 'CO', 'MX', 'GH', 'NG', 'ZA'],
};
const linked = (a: string, b: string) => !!(LINKS[a]?.includes(b) || LINKS[b]?.includes(a));

export interface CommercialLeg {
  airline: string;
  iata: string;
  /** e.g. 'TP 1342'. */
  no: string;
  from: string;
  to: string;
  dep: Minute;
  arr: Minute;
}

/** A routing for a city pair: carriers per leg (equivalent alternatives; one is picked per day) and via hub. */
interface Routing {
  legs: { from: string; to: string; carriers: Carrier[]; block: number }[];
  total: number;
}

const legBlock = (a: string, b: string) => blockMinutes(distance(a, b) > LONG_KM ? 'a333' : 'a320ceo', a, b);

/** Global connectors: long-haul to any big airport (Gulf carriers, Turkish, Ethiopian). */
const SUPER = new Set(['EK', 'QR', 'EY', 'TK', 'ET']);
/** Source markets whose low-cost carriers fly the long leisure sectors (UK to Sharm, Germany to Antalya…). */
const SUN_SOURCE = new Set(['GB', 'IE', 'DE', 'NL', 'BE', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'HU']);
/** Longest low-cost sector (narrowbody point-to-point). */
const LCC_KM = 3_600;

/** Does low-cost carrier c fly base → other? Point-to-point from one of its bases into its markets. */
function lccLeg(c: Carrier, base: Airport, other: Airport, km: number): boolean {
  if (!c.hubs.includes(base.code) || !(c.markets ?? []).includes(other.country)) return false;
  if (c.avoid?.includes(other.code) && !c.hubs.includes(other.code)) return false;
  if (other.size < 3 && other.tour < 0.8 && !c.hubs.includes(other.code)) return false;
  // Domestic only at home (or between two of its own bases).
  if (base.country === other.country && base.country !== c.country && !c.hubs.includes(other.code)) return false;
  // Long leisure sectors only from the northern source markets.
  if (km > 3_000 && other.biz < 0.2 && !SUN_SOURCE.has(base.country)) return false;
  return true;
}

/** Does carrier c plausibly fly a ↔ b nonstop? */
function serves(c: Carrier, a: Airport, b: Airport, km: number): boolean {
  if (c.maxKm !== undefined && km > c.maxKm) return false;
  if (c.kind === 'lcc') return km <= (c.maxKm ?? LCC_KM) && (lccLeg(c, a, b, km) || lccLeg(c, b, a, km));
  if (c.avoid?.includes(a.code) || c.avoid?.includes(b.code)) return false;
  const ha = c.hubs.includes(a.code);
  const hb = c.hubs.includes(b.code);
  const home = [c.country, ...(c.markets ?? [])];
  if (!ha && !hb) {
    // Domestic point-to-point on the national network.
    return c.kind === 'network' && home.includes(a.country) && home.includes(b.country) && km <= 5_000 && Math.max(a.size, b.size) >= 2;
  }
  if (ha && hb) return true;
  const other = ha ? b : a;
  const hub = ha ? a : b;
  if (c.reach && !home.includes(other.country) && !c.reach.includes(other.country)) return false;
  const link = linked(c.country, other.country) || home.includes(other.country);
  if (SUPER.has(c.iata) && km <= LONG_KM) return true;
  if (km <= 2_500) return link || other.size >= 3 || (other.size >= 2 && other.biz >= 0.2);
  // Medium haul: a real city at the far end (beach-only airports are the charter and low-cost carriers' job).
  if (km <= (c.kind === 'regional' ? 3_500 : LONG_KM)) return link || (other.size >= 4 && other.biz >= 0.3) || (other.size >= 3 && other.biz >= 0.5);
  if (c.kind === 'regional' || km > 14_500) return false;
  if (SUPER.has(c.iata)) return other.size >= 4 || (link && other.size >= 2);
  return (other.size >= 5 && hub.size >= 4) || (link && other.size >= 2);
}

function directCarriers(from: string, to: string): Carrier[] {
  const a = AIRPORT_BY_CODE[from];
  const b = AIRPORT_BY_CODE[to];
  if (!a || !b) return [];
  const km = distance(from, to);
  return CARRIERS.filter((c) => serves(c, a, b, km));
}

const routings = new Map<string, Routing>();

/** The pair's routing: nonstop when someone flies it, else one connection at the best hub. Pure, cached. */
function routing(from: string, to: string): Routing {
  const key = `${from}>${to}`;
  const hit = routings.get(key);
  if (hit) return hit;
  let r: Routing;
  const direct = directCarriers(from, to);
  if (direct.length || from === to || !AIRPORT_BY_CODE[from] || !AIRPORT_BY_CODE[to]) {
    const b = from === to ? 0 : legBlock(from, to);
    r = { legs: [{ from, to, carriers: direct, block: b }], total: b };
  } else {
    const ca = AIRPORT_BY_CODE[from].country;
    const cb = AIRPORT_BY_CODE[to].country;
    const flagHubs = CARRIERS.filter((c) => c.kind !== 'lcc' && (c.country === ca || c.country === cb)).flatMap((c) => c.hubs);
    let best: { score: number; h: string; c1: Carrier[]; c2: Carrier[] } | null = null;
    for (const h of [...new Set([...flagHubs, ...WORLD_HUBS])]) {
      if (h === from || h === to || !AIRPORT_BY_CODE[h]) continue;
      const c1 = directCarriers(from, h);
      const c2 = directCarriers(h, to);
      if (!c1.length || !c2.length) continue;
      const same = c1.some((c) => c2.includes(c));
      // Shortest way round; one airline through its own hub beats a self-made connection, and on long thin
      // routes the big connectors (Istanbul, the Gulf, Addis) beat a smaller hub that happens to be on the way.
      const km = distance(from, h) + distance(h, to);
      const superHub = km > 3_000 && c1.some((c) => SUPER.has(c.iata) && c.hubs.includes(h) && c2.includes(c));
      const score = km - (same ? 400 : 0) - (flagHubs.includes(h) ? 150 : 0) - (superHub ? 700 : 0);
      if (!best || score < best.score || (score === best.score && h < best.h)) best = { score, h, c1, c2 };
    }
    if (best) {
      // Through an airline's own hub its passengers stay on that airline.
      const own = best.c1.filter((c) => best!.c2.includes(c) && c.hubs.includes(best!.h));
      const c1 = own.length ? own : best.c1;
      const c2 = own.length ? own : best.c2;
      const b1 = legBlock(from, best.h);
      const b2 = legBlock(best.h, to);
      r = { legs: [{ from, to: best.h, carriers: c1, block: b1 }, { from: best.h, to, carriers: c2, block: b2 }], total: b1 + CONNECT_MIN + b2 };
    } else {
      const b = legBlock(from, to);
      r = { legs: [{ from, to, carriers: [], block: b }], total: b };
    }
  }
  routings.set(key, r);
  return r;
}

/** Ticket door-to-door minutes (sum of legs plus the connection): crew planning books tickets this long. Pure. */
export function ticketBlock(from: string, to: string): number {
  return routing(from, to).total;
}

/** Departure bank (3-hour UTC slot): each daily rotation of a route is its own flight. */
const bankOf = (t: Minute) => Math.floor((((t % DAY) + DAY) % DAY) / 180);

/**
 * A flight number for the airline on this leg: stable per route and departure bank (the same slot keeps its
 * number every day), even outbound and odd back (by airport order); long-haul low numbers.
 */
function flightNo(c: Carrier, from: string, to: string, dep: Minute): string {
  const pair = from < to ? `${from}${to}` : `${to}${from}`;
  const h = hash(`${c.iata}:${pair}:${bankOf(dep)}`);
  const long = distance(from, to) > LONG_KM;
  const span = long ? 190 : c.kind === 'lcc' ? 4400 : 500;
  const lo = long ? 10 : c.kind === 'lcc' ? 1100 : 1000;
  const even = lo + 2 * (h % span);
  return `${c.iata} ${from < to ? even : even + 1}`;
}

/** Fallback when no carrier is listed for a leg: the biggest network carrier of either country, else a world hub airline. */
function fallbackCarrier(from: string, to: string): Carrier {
  const ca = AIRPORT_BY_CODE[from]?.country;
  const cb = AIRPORT_BY_CODE[to]?.country;
  return CARRIERS.find((c) => c.kind === 'network' && c.country === ca) ?? CARRIERS.find((c) => c.kind === 'network' && c.country === cb) ?? CARRIER_BY_IATA.TK;
}

/** The flag or hub carriers of either end (network and regional airlines based there). */
const homeOf = (c: Carrier, a: string, b: string) => c.kind !== 'lcc' && (c.hubs.includes(a) || c.hubs.includes(b));

/**
 * The carrier of one departure (`slot` = day and bank): the flag/hub carriers of either end take about 60% of
 * the departures (more when they are most of the field), the rest is shared evenly. Pure.
 */
function pickCarrier(cs: Carrier[], from: string, to: string, slot: string): Carrier {
  if (!cs.length) return fallbackCarrier(from, to);
  const h = hash(`${from}${to}${slot}`);
  const home = cs.filter((c) => homeOf(c, from, to));
  if (home.length && home.length < cs.length && h % 100 < 60) return home[Math.floor(h / 100) % home.length];
  return cs[Math.floor(h / 100) % cs.length];
}

/**
 * The airline flights of a ticket from → to departing at std (arriving at sta): each leg's carrier is picked per
 * day among those flying it, so the same ticket always shows the same flights. Legs are fitted into [std, sta]
 * (older tickets were booked with nonstop times). Pure.
 */
export function itinerary(from: string, to: string, std: Minute, sta: Minute): CommercialLeg[] {
  const r = routing(from, to);
  const day = Math.floor(std / DAY);
  const pickC = (l: Routing['legs'][number], dep: Minute) => pickCarrier(l.carriers, l.from, l.to, `${day}:${bankOf(dep)}`);
  const window = Math.max(1, sta - std);
  if (r.legs.length === 1) {
    const c = pickC(r.legs[0], std);
    return [{ airline: c.name, iata: c.iata, no: flightNo(c, from, to, std), from, to, dep: std, arr: sta }];
  }
  const [l1, l2] = r.legs;
  // Fit both legs and the connection into the window (scaled when it is shorter than the routing).
  const k = Math.min(1, window / r.total);
  const b1 = Math.round(l1.block * k);
  const b2 = Math.round(l2.block * k);
  const c1 = pickC(l1, std);
  const c2 = l1.carriers.length && l2.carriers.includes(c1) ? c1 : pickC(l2, sta - b2);
  return [
    { airline: c1.name, iata: c1.iata, no: flightNo(c1, l1.from, l1.to, std), from: l1.from, to: l1.to, dep: std, arr: std + b1 },
    { airline: c2.name, iata: c2.iata, no: flightNo(c2, l2.from, l2.to, sta - b2), from: l2.from, to: l2.to, dep: sta - b2, arr: sta },
  ];
}

// ---------- read APIs (map, panels, crew calendar) ----------

export interface CommercialFlight {
  /** `${ticketId}:${legIndex}` (stable). */
  id: string;
  /** Our ticket (Flight kind 'deadhead'). */
  ticketId: string;
  leg: CommercialLeg;
  legIndex: number;
  legCount: number;
  /** Our crew on board. */
  crewIds: string[];
}

const legCache = new WeakMap<Flight, { k: string; legs: CommercialLeg[] }>();

/** The airline legs of one of our tickets (empty for anything else). Pure; cached per ticket and times. */
export function commercialItinerary(_g: GameState, f: Flight): CommercialLeg[] {
  if (f.kind !== 'deadhead') return [];
  const k = `${f.from}${f.to}${f.std}:${f.sta}`;
  const hit = legCache.get(f);
  if (hit && hit.k === k) return hit.legs;
  const legs = itinerary(f.from, f.to, f.std, f.sta);
  legCache.set(f, { k, legs });
  return legs;
}

const asFlights = (g: GameState, f: Flight, keep: (l: CommercialLeg) => boolean): CommercialFlight[] => {
  const legs = commercialItinerary(g, f);
  const out: CommercialFlight[] = [];
  legs.forEach((leg, i) => {
    if (keep(leg)) out.push({ id: `${f.id}:${i}`, ticketId: f.id, leg, legIndex: i, legCount: legs.length, crewIds: [...f.crewIds] });
  });
  return out;
};

const ticketsLive = (g: GameState): Flight[] => deadheadFlights(g).filter((f) => f.status !== 'cancelled' && f.crewIds.length > 0);

/** Airline legs carrying our crew that overlap [t0, t1), by departure. Pure. */
export function commercialFlightsBetween(g: GameState, t0: Minute, t1: Minute): CommercialFlight[] {
  const out: CommercialFlight[] = [];
  for (const f of ticketsLive(g)) if (f.std < t1 && f.sta > t0) out.push(...asFlights(g, f, (l) => l.dep < t1 && l.arr > t0));
  return out.sort((a, b) => a.leg.dep - b.leg.dep || (a.id < b.id ? -1 : 1));
}

/** Airline legs with our crew aboard in the air at t (dep ≤ t < arr; the map draws these). Pure. */
export function commercialFlightsAirborne(g: GameState, t: Minute): CommercialFlight[] {
  const out: CommercialFlight[] = [];
  for (const f of ticketsLive(g)) if (f.std <= t && f.sta > t) out.push(...asFlights(g, f, (l) => l.dep <= t && l.arr > t));
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 0–1 progress of an airline leg at t (clamped). */
export function commercialProgress(cf: CommercialFlight, t: Minute): number {
  const { dep, arr } = cf.leg;
  return arr > dep ? Math.min(1, Math.max(0, (t - dep) / (arr - dep))) : 1;
}

/** One-line itinerary, e.g. 'TP 1342 LIS–FRA · LH 1484 FRA–VNO'. */
export function itineraryText(legs: CommercialLeg[]): string {
  return legs.map((l) => `${l.no} ${l.from}–${l.to}`).join(' · ');
}
