// v0.19.2 custom routes (player request: "why can't I also build my own route to any destination I like?"). A market
// for any city pair, built from the airports' data (catchment, size, business and tourism pull), the ties between
// the two countries (data/routeTies.ts), the distance, the airlines that already fly it or connect it
// (data/carriers.ts through ops/commercial.ts), the region's season, cargo, the traffic-rights regime and the
// stations' costs (data/routes.ts stationFor). Pure and deterministic: the same pair gives the same market.
//
// The market is honest about what it does not know: its size is a model guess (shown as a wide range before any
// study), and every game hides its own real size for the pair (customTruth: a fixed, per-game factor, so ordering
// study after study never fishes up a better market). The study narrows the range as it does for the catalogue.
// Most random pairs come out thin or crowded; strong ones exist where people really are tied.

import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import type { CarrierKind } from '../../data/carriers';
import { CARRIERS, WORLD_HUBS } from '../../data/carriers';
import { COUNTRIES, countryName } from '../../data/countries';
import { CLOSED_COUNTRY, COUNTRY_RISK, EU_NEAR_OPEN, EU_OPEN, HARD_RIGHTS, TIE_HOTSPOTS, tieBetween } from '../../data/routeTies';
import { ROUTE_MARKETS, stationFor, type RouteCompetitor, type RouteMarket } from '../../data/routes';
import { BAL } from '../core/balance';
import { distance, distanceNm } from '../core/geo';
import { blockMinutes, etopsCap, maxSectorNm, runwayFit, typeOf, withinEtops } from '../core/perf';
import { gaussian } from '../core/rng';
import type { GameState } from '../core/types';
import { route as hopRoute } from '../contracts/plan';
import { carrierServes, countriesLinked, directCarriers } from '../ops/commercial';
import { netSide } from './side';
import type { RouteModel, Segment } from './types';

/** Custom market ids: 'X:LIS-JFK', with fuel stops 'X:LIS-JFK~PDL' (out) and '/KEF' (back when different). */
export const CUSTOM_PREFIX = 'X:';
/** The model's own uncertainty on a pair nobody researched (log-normal sigma of the hidden real size). */
export const CUSTOM_SIGMA = 0.3;
/** Extra study inaccuracy on an unresearched pair, by depth (added to the catalogue's accuracy). */
export const CUSTOM_STUDY_EXTRA: Record<'desk' | 'full' | 'survey', number> = { desk: 0.1, full: 0.05, survey: 0.02 };

export interface MarketDraft {
  from: string;
  to: string;
  /** Fuel stops out (in order) and back (in order; absent = the out stops reversed). */
  via?: string[];
  viaBack?: string[];
  /** v0.21 a stopover both ways where we sell seats (id 'X:LIS-LAX@JFK'); no fuel stops beside it. */
  stop?: string;
}

export const isCustomId = (id: string): boolean => id.startsWith(CUSTOM_PREFIX);

/** The draft of a custom id (null when it is not one). Pure. */
export function parseCustomId(id: string): MarketDraft | null {
  const st = /^X:([A-Z0-9]{3})-([A-Z0-9]{3})@([A-Z0-9]{3})$/.exec(id);
  if (st) return { from: st[1], to: st[2], via: [st[3]], viaBack: [st[3]], stop: st[3] };
  const x = /^X:([A-Z0-9]{3})-([A-Z0-9]{3})(?:~([A-Z0-9.]+))?(?:\/([A-Z0-9.]*))?$/.exec(id);
  if (!x) return null;
  const via = x[3] ? x[3].split('.') : [];
  return { from: x[1], to: x[2], via, ...(x[4] !== undefined ? { viaBack: x[4] ? x[4].split('.') : [] } : {}) };
}

/** The id of a draft. Pure. */
export function customId(d: MarketDraft): string {
  if (d.stop) return `${CUSTOM_PREFIX}${d.from}-${d.to}@${d.stop}`;
  const via = d.via ?? [];
  const back = d.viaBack ?? [...via].reverse();
  const same = back.join('.') === [...via].reverse().join('.');
  return `${CUSTOM_PREFIX}${d.from}-${d.to}${via.length ? `~${via.join('.')}` : ''}${same ? '' : `/${back.join('.')}`}`;
}

/** The catalogue market of the same city pair, if any (the builder sends the player there: it is researched). */
export const catalogueOf = (from: string, to: string): RouteMarket | undefined => ROUTE_MARKETS.find((m) => m.from === from && m.to === to);

// ---------- the pieces of demand ----------

const usable = (a: Airport | undefined): a is Airport => !!a && !a.enroute && !a.ice;
const popOf = (a: Airport) => Math.max(0.02, a.pop);
const propOf = (country: string) => COUNTRIES[country]?.prop ?? 0.5;

/** An airport's weight inside its country for flows tied to `home` (bigger cities and hubs take more; hotspots). */
function weight(a: Airport, home: string): number {
  return Math.pow(popOf(a), 1.3) * a.size * (TIE_HOTSPOTS[home]?.[a.code] ?? 1);
}

const shareCache = new Map<string, number>();
/** An airport's share of its country's ties with `home`. Pure, cached. */
function shareIn(a: Airport, home: string): number {
  const key = `${a.code}:${home}`;
  const hit = shareCache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  for (const x of AIRPORTS) if (x.country === a.country && usable(x)) sum += weight(x, home);
  const v = sum > 0 ? weight(a, home) / sum : 0;
  shareCache.set(key, v);
  return v;
}

const countryPop = new Map<string, number>();
function popOfCountry(c: string): number {
  let v = countryPop.get(c);
  if (v === undefined) {
    v = 0;
    for (const x of AIRPORTS) if (x.country === c && usable(x)) v += popOf(x);
    countryPop.set(c, v);
  }
  return v;
}

/** Family, diaspora and old-link travellers a year between two airports (both ways). */
function linkFlow(A: Airport, B: Airport, km: number): number {
  if (A.country === B.country) {
    // Domestic: road and rail win close in; islands and remote cities depend on the air.
    const surface = km < 350 ? 0.15 : km < 700 ? 0.5 : 1;
    const island = km > 500 && Math.min(popOf(A), popOf(B)) < 0.5 ? 2.5 : 1;
    return 40_000 * Math.sqrt(popOf(A) * popOf(B)) * surface * island;
  }
  let tie = tieBetween(A.country, B.country);
  if (tie === undefined) tie = countriesLinked(A.country, B.country) ? 25_000 * Math.pow(popOfCountry(A.country) * popOfCountry(B.country), 0.4) : 0;
  return tie * shareIn(A, B.country) * shareIn(B, A.country);
}

/** Business travellers a year (both ways): business pull and size of both cities, fading with distance; trade
 *  follows ties (the same country or market, old links, people), so two unrelated far-apart cities do little. */
function bizFlow(A: Airport, B: Airport, km: number): number {
  const decay = Math.pow(1000 / Math.max(300, km), 0.8);
  const tied = A.country === B.country || (EU_OPEN.has(A.country) && EU_OPEN.has(B.country)) || countriesLinked(A.country, B.country) || !!tieBetween(A.country, B.country);
  const close = tied ? 1 : A.continent === B.continent ? 0.6 : 0;
  return 9_000 * A.biz * B.biz * Math.pow(A.size * B.size, 1.1) * Math.pow(popOf(A) * popOf(B), 0.25) * decay * (0.35 + 0.65 * close);
}

/** Holidaymakers a year one way: the origin's wealth and size, the destination's pull, fading with distance. */
function tourOneWay(A: Airport, B: Airport, km: number): number {
  const decay = km <= 1000 ? 1 : km <= 5000 ? Math.pow(1000 / km, 0.7) : Math.pow(0.2, 0.7) * Math.pow(5000 / km, 1.3);
  return 30_000 * propOf(A.country) * B.tour * B.tour * Math.pow(B.size, 0.7) * Math.sqrt(popOf(A)) * decay;
}

/** Everything else (other trips, a little of every kind): small, and smaller with distance. */
function otherFlow(A: Airport, B: Airport, km: number): number {
  return 1_500 * Math.sqrt(popOf(A) * popOf(B)) * Math.sqrt(propOf(A.country) * propOf(B.country)) * Math.pow(1000 / Math.max(500, km), 0.9);
}

const developing = (a: Airport) => a.continent === 'AF' || (a.continent === 'AS' && propOf(a.country) < 0.45) || propOf(a.country) < 0.3;

// ---------- seasons ----------

const norm = (v: number[]) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return v.map((x) => Math.round((x / m) * 100) / 100);
};
/** Winter sun (the Canaries, Cabo Verde, the Caribbean, the Red Sea, Thailand). */
const WINTER_SUN = [1.25, 1.2, 1.15, 1.05, 0.7, 0.7, 1.0, 1.15, 0.8, 0.85, 1.0, 1.3];
/** Summer holidays (the Mediterranean, northern cities). */
const SUMMER = [0.55, 0.6, 0.75, 0.95, 1.1, 1.3, 1.5, 1.55, 1.2, 0.95, 0.65, 0.7];
/** Southern-hemisphere summer. */
const SOUTH = [1.35, 1.2, 1.0, 0.85, 0.7, 0.7, 0.9, 0.85, 0.85, 1.0, 1.1, 1.4];
/** Business: quiet in August and at Christmas. */
const BUSINESS = [0.9, 1.0, 1.05, 1.05, 1.05, 1.0, 0.85, 0.75, 1.05, 1.1, 1.05, 0.9];

function holidayCurve(B: Airport, A: Airport): number[] {
  if (B.lat < -20) return SOUTH;
  if (Math.abs(B.lat) < 30 && A.lat > 34) return WINTER_SUN;
  return SUMMER;
}

// ---------- rivals ----------

const KIND_W: Record<CarrierKind, number> = { network: 1, regional: 0.8, lcc: 1.3 };

/** Nonstop rivals, their weekly flights shared out of what the market can fill; and up to three one-stop rivals. */
function rivals(A: Airport, B: Airport, km: number, od: number): RouteCompetitor[] {
  const wide = km > 4_500;
  const seats = wide ? 260 : 170;
  const out: RouteCompetitor[] = [];
  const direct = directCarriers(A.code, B.code);
  if (direct.length) {
    const ws = direct.map((c) => KIND_W[c.kind] * (c.kind !== 'lcc' && (c.hubs.includes(A.code) || c.hubs.includes(B.code)) ? 2.5 : 1));
    const wsum = ws.reduce((s, x) => s + x, 0);
    // What the pair can fill, plus the connecting passengers a hub carrier puts on it.
    const perWeek = (od * 1.3) / (104 * seats * 0.8);
    const hours = blockMinutes(wide ? 'a333' : 'a320ceo', A.code, B.code) / 60;
    direct.forEach((c, i) => {
      const f = Math.max(wide ? 1 : 2, Math.round((perWeek * ws[i]) / wsum));
      const own = c.hubs.includes(A.code) || c.hubs.includes(B.code);
      out.push({ name: c.name, perWeek: f, stops: 0, hours: Math.round(hours * 10) / 10, fareX: c.kind === 'lcc' ? 0.75 : own ? 1.05 : 1.0, seats: c.kind === 'lcc' ? 186 : seats });
    });
  }
  // One-stop rivals: an airline's own hub on the way (detour ≤ 1.5, ≤ 1.35 on short pairs).
  const cands: { c: string; via: string; hours: number }[] = [];
  const maxDetour = km < 2_000 ? 1.35 : 1.5;
  for (const c of CARRIERS) {
    if (c.kind === 'lcc') continue;
    for (const h of c.hubs) {
      if (h === A.code || h === B.code || !AIRPORT_BY_CODE[h]) continue;
      const d1 = distance(A.code, h);
      const d2 = distance(h, B.code);
      if ((d1 + d2) / Math.max(1, km) > maxDetour) continue;
      if (!carrierServes(c, A.code, h) || !carrierServes(c, h, B.code)) continue;
      const t1 = blockMinutes(d1 > 4_500 ? 'a333' : 'a320ceo', A.code, h);
      const t2 = blockMinutes(d2 > 4_500 ? 'a333' : 'a320ceo', h, B.code);
      cands.push({ c: c.name, via: h, hours: (t1 + t2) / 60 + 1.6 });
    }
  }
  cands.sort((p, q) => p.hours - q.hours || (p.c < q.c ? -1 : 1));
  const seen = new Set(out.map((x) => x.name));
  for (const x of cands) {
    if (seen.has(x.c) || out.filter((o) => o.stops === 1).length >= 3) continue;
    seen.add(x.c);
    out.push({ name: `${x.c} via ${AIRPORT_BY_CODE[x.via].city}`, perWeek: 7, stops: 1, hours: Math.round(x.hours * 10) / 10, fareX: km > 3_000 ? 0.8 : 0.9, seats: km > 3_000 ? 20 : 30, via: x.via });
  }
  if (!out.length) {
    // Nobody in our airline list links it: travellers still connect at the nearest big hub on the way, slowly.
    let best: { h: string; d: number } | null = null;
    for (const h of WORLD_HUBS) {
      if (h === A.code || h === B.code || !AIRPORT_BY_CODE[h]) continue;
      const d = distance(A.code, h) + distance(h, B.code);
      if (d / Math.max(1, km) <= 2 && (!best || d < best.d)) best = { h, d };
    }
    if (best) {
      const t = blockMinutes(km > 4_500 ? 'a333' : 'a320ceo', A.code, best.h) + blockMinutes(km > 4_500 ? 'a333' : 'a320ceo', best.h, B.code);
      out.push({ name: `Connections via ${AIRPORT_BY_CODE[best.h].city}`, perWeek: B.size <= 1 ? 3 : 7, stops: 1, hours: Math.round((t / 60 + 3) * 10) / 10, fareX: 0.85, seats: 15, via: best.h });
    }
  }
  return out;
}

// ---------- rights ----------

/** How hard the traffic rights are for a newcomer based at A (0 open skies … 0.7). */
function rightsHardness(A: Airport, B: Airport): number {
  if (A.country === B.country) return 0;
  const euA = EU_OPEN.has(A.country);
  const euB = EU_OPEN.has(B.country);
  if (euA && euB) return 0;
  const other = euA ? B.country : euB ? A.country : B.country;
  if ((euA || euB) && EU_NEAR_OPEN.has(other)) return 0.1;
  const hard = Math.max(HARD_RIGHTS[A.country] ?? 0, HARD_RIGHTS[B.country] ?? 0);
  if (hard) return hard;
  if (countriesLinked(A.country, B.country) || tieBetween(A.country, B.country)) return 0.2;
  return A.continent === B.continent ? 0.25 : 0.35;
}

// ---------- the market ----------

export interface CustomFacts {
  /** Travellers a year by kind (both ways), before the real size is known. */
  links: number;
  biz: number;
  tour: number;
  other: number;
  od: number;
  km: number;
}

const factsCache = new Map<string, CustomFacts>();

/** The demand pieces of a city pair. Pure, cached. */
export function customFacts(from: string, to: string): CustomFacts | null {
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[to];
  if (!usable(A) || !usable(B) || from === to) return null;
  const key = `${from}-${to}`;
  const hit = factsCache.get(key);
  if (hit) return hit;
  const km = distance(from, to);
  const links = linkFlow(A, B, km);
  const biz = bizFlow(A, B, km);
  const tour = tourOneWay(A, B, km) + tourOneWay(B, A, km);
  const other = otherFlow(A, B, km);
  const f: CustomFacts = { links, biz, tour, other, od: Math.round((links + biz + tour + other) / 100) * 100, km };
  factsCache.set(key, f);
  return f;
}

const marketCache = new Map<string, RouteMarket>();

/**
 * The market of a city pair with its fuel stops (pure, cached by id): size, segments, season, rivals, fares, cargo,
 * timetable, rights, risk. Null when an airport has no market (an en-route field, the ice).
 */
export function customMarket(d: MarketDraft): RouteMarket | null {
  const id = customId(d);
  const hit = marketCache.get(id);
  if (hit) return hit;
  if (d.stop) {
    const sm = stopoverMarket(d.from, d.to, d.stop);
    if (sm) {
      if (marketCache.size > 400) marketCache.clear();
      marketCache.set(id, sm);
    }
    return sm;
  }
  const f = customFacts(d.from, d.to);
  if (!f) return null;
  const A = AIRPORT_BY_CODE[d.from];
  const B = AIRPORT_BY_CODE[d.to];
  const { km, od } = f;
  const total = Math.max(1, f.links + f.biz + f.tour + f.other);
  const dev = developing(B) || developing(A);
  // Segments: diaspora and family visits, students, government and aid, business, holidays.
  const seg: Partial<Record<Segment, number>> = {};
  seg.vfr = (f.links * 0.85 + f.other * 0.5) / total;
  seg.students = (f.links * (dev ? 0.1 : 0.05)) / total;
  seg.gov = 0.03 + (dev ? 0.04 : 0);
  seg.ngo = dev && B.size <= 2 ? 0.06 : 0;
  seg.biz = (f.biz + f.other * 0.3) / total;
  seg.tourism = (f.tour + f.other * 0.2) / total;
  const sum = Object.values(seg).reduce((s, x) => s + (x ?? 0), 0);
  for (const k of Object.keys(seg) as Segment[]) {
    const v = Math.round(((seg[k] ?? 0) / sum) * 100) / 100;
    if (v > 0) seg[k] = v;
    else delete seg[k];
  }
  const vfr = seg.vfr ?? 0;
  const tourS = seg.tourism ?? 0;
  const bizS = seg.biz ?? 0;
  // Season: each segment's curve, weighted.
  const hol = holidayCurve(B, A);
  const holBack = holidayCurve(A, B);
  const D = BAL.v019.demand;
  const mix = (curves: [number, number[]][]) => norm(Array.from({ length: 12 }, (_, i) => curves.reduce((s, [w, c]) => s + w * c[i], 0)));
  const rest = Math.max(0, 1 - vfr - tourS - bizS);
  const season = mix([[vfr + rest, D.season], [tourS, hol], [bizS, BUSINESS]]);
  const seasonBack = mix([[vfr + rest, D.seasonBack], [tourS, holBack === SUMMER ? hol : holBack], [bizS, BUSINESS]]);
  const competitors = rivals(A, B, km, od);
  const nonstop = competitors.filter((c) => c.stops === 0);
  const f0 = nonstop.reduce((s, c) => s + c.perWeek, 0);
  // Fares (published, one way, as the catalogue's): by distance, the competition, the travellers' mix.
  let yx = nonstop.length ? 1 / (1 + 0.006 * f0) : 1.2;
  if (nonstop.some((c) => c.fareX < 0.8)) yx *= 0.78;
  yx *= 1 + 0.4 * (bizS - 0.15);
  yx *= 1 - 0.2 * tourS;
  if (km > 7_000 && od < 20_000) yx *= 1.15;
  const mid = (110 + 0.09 * km) * yx;
  const r10 = (v: number) => Math.max(10, Math.round(v / 10) * 10);
  const fareY: [number, number] = [r10(mid * 0.6), r10(mid * 1.4)];
  const fareJ: [number, number] = [r10(fareY[0] * 2.9), r10(fareY[1] * 2.4)];
  const south = Math.round((10 * Math.sqrt(od) * (dev ? 1.5 : 1)) / 100) * 100;
  const euCargo = stationFor(d.to).euCargo;
  const north = euCargo ? Math.round((south * (Math.abs(B.lat) < 25 ? 0.45 : 0.3)) / 100) * 100 : 0;
  const cargo: RouteMarket['cargo'] = { south, north, mail: Math.min(400, Math.round((100 + od / 500) / 50) * 50) };
  if (dev && B.size <= 2) cargo.ngo = 300;
  if (euCargo && Math.abs(B.lat) < 25 && B.continent !== 'EU') cargo.perish = Math.round((south * 0.15) / 50) * 50;
  // Timetable: a day turn up to 5½ h, else a night there (westbound across the Atlantic: out at noon, back at night).
  const blk = blockMinutes('b763', d.from, d.to);
  const west = ((A.lon - B.lon + 540) % 360) - 180 > 40;
  const day = tourS >= 0.45 ? 5 : bizS >= 0.35 ? 0 : 4;
  const timetable: RouteMarket['timetable'] = blk <= 330
    ? { pattern: 'weekly', day, out: tourS >= 0.45 ? 600 : 420, back: 0, nights: 0 }
    : west ? { pattern: 'weekly', day, out: 690, back: 1_290, nights: 1 } : { pattern: 'weekly', day, out: 1_320, back: 1_320, nights: 1 };
  const hard = rightsHardness(A, B);
  const risk = COUNTRY_RISK[B.country];
  const models: RouteModel[] = tourS >= 0.45 && A.continent === 'EU' && km <= 6_500 ? ['own', 'tour'] : ['own'];
  const closed = CLOSED_COUNTRY[B.country] ?? CLOSED_COUNTRY[A.country] ?? [...(d.via ?? []), ...(d.viaBack ?? [])].map((s) => CLOSED_COUNTRY[AIRPORT_BY_CODE[s]?.country ?? '']).find(Boolean);
  const via = d.via?.length ? [...d.via] : undefined;
  const viaBack = d.viaBack ? (d.viaBack.length ? [...d.viaBack] : undefined) : via ? [...via].reverse() : undefined;
  const m: RouteMarket = {
    id, from: d.from, to: d.to, city: B.city, country: countryName(B.country), ...(via ? { via } : {}), ...(viaBack ? { viaBack } : {}),
    models, model: 'own', odPerYear: od, outShare: 0.5,
    growth: ({ AF: 0.04, AS: 0.04, ME: 0.035, SA: 0.03 } as Record<string, number>)[B.continent] ?? 0.025,
    season, seasonBack, segments: seg, competitors, fareY, fareJ, cargo,
    ancillary: Math.round(15 + 15 * vfr), bagShare: Math.round((0.1 + 0.35 * vfr) * 100) / 100, timetable,
    navPerSector: Math.round(Math.max(600, km * 0.85) / 100) * 100, ...(risk ? { risk: { ...risk } } : {}),
    rights: hard <= 0.1 ? 'open' : 'bilateral', eu261: km <= 3_500 ? 'mid' : 'long', blurb: blurbOf(f, nonstop, competitors, vfr, tourS, bizS),
    custom: true, rightsHard: hard, ...(closed ? { closed } : {}),
  };
  if (marketCache.size > 400) marketCache.clear();
  marketCache.set(id, m);
  return m;
}

function blurbOf(f: CustomFacts, nonstop: RouteCompetitor[], all: RouteCompetitor[], vfr: number, tour: number, biz: number): string {
  const kind = vfr >= 0.5 ? 'Family and diaspora travel' : tour >= 0.5 ? 'A holiday market' : biz >= 0.4 ? 'Mostly business travel' : 'Mixed travel';
  const rival = nonstop.length
    ? `${nonstop.slice(0, 2).map((c) => c.name).join(' and ')}${nonstop.length > 2 ? ` and ${nonstop.length - 2} more` : ''} ${nonstop.length === 1 ? 'flies' : 'fly'} it nonstop`
    : all.length ? `no nonstop today; people connect via ${all.filter((c) => c.via).slice(0, 2).map((c) => AIRPORT_BY_CODE[c.via!].city).join(' or ')}` : 'no airline links it today';
  const thin = f.od < 8_000 ? ' Very few people travel between these cities.' : '';
  return `${kind}; ${rival}.${thin}`;
}

// ---------- v0.21 stopover (tag) routes ----------

/** A leg's market for a stopover: the catalogue's when researched (its fare multiple kept), else the model's. */
function legMarket(from: string, to: string): RouteMarket | null {
  const cat = catalogueOf(from, to);
  if (cat) return cat;
  return customMarket({ from, to });
}

/**
 * v0.21 how likely B–C local sales are on a stopover A–B–C (fifth freedom: a third country's traffic on our flight).
 * Inside the EU's single market: free. B and C in the same country: domestic flying (cabotage), never. B in our own
 * country: our own rights (third and fourth freedom), as a route of its own. Else both states must agree: often
 * refused or capped, harder where the rights regime is hard. Pure.
 */
export function fifthOdds(from: string, stop: string, to: string): { full: number; limited: number; why: string } {
  const A = AIRPORT_BY_CODE[from];
  const B = AIRPORT_BY_CODE[stop];
  const C = AIRPORT_BY_CODE[to];
  if (!A || !B || !C) return { full: 0, limited: 0, why: 'Unknown airport.' };
  const S = BAL.v019.stop;
  const eu = (c: string) => EU_OPEN.has(c);
  if (eu(A.country) && eu(B.country) && eu(C.country)) return { full: 1, limited: 0, why: `Inside the EU: we may sell ${B.city}–${C.city} seats freely.` };
  if (B.country === C.country) return { full: 0, limited: 0, why: `${B.city}–${C.city} is domestic flying inside ${countryName(B.country)} (cabotage): a foreign airline may not sell it. ${B.city} is a stop for our own ${A.city} passengers only.` };
  if (B.country === A.country) return { full: 0.9, limited: 0.05, why: `${B.city} is in our own country: ${B.city}–${C.city} needs only the usual rights, as a route of its own.` };
  const hard = Math.max(rightsHardness(B, C), HARD_RIGHTS[B.country] ?? 0, HARD_RIGHTS[C.country] ?? 0);
  const full = Math.max(S.fifthMin, Math.min(S.fifthBase, S.fifthBase - S.fifthHardX * hard + (eu(B.country) ? 0.1 : 0)));
  const limited = Math.min(1 - full, S.fifthLimited);
  return {
    full: Math.round(full * 100) / 100, limited: Math.round(limited * 100) / 100,
    why: `Selling ${B.city}–${C.city} seats is fifth-freedom traffic: ${countryName(B.country)} and ${countryName(C.country)} must both agree. Often refused or capped${hard >= 0.3 ? ', and these are hard countries for rights' : ''}.`,
  };
}

/**
 * v0.21 the market of a stopover route A–B–C: the A–C through travellers (the catalogue's researched market when
 * there is one, its fares at their realised level) with the stop at B both ways, the two legs' local markets and the
 * odds of B–C rights. Own brand only. Null when a piece has no market. Pure.
 */
function stopoverMarket(from: string, to: string, stop: string): RouteMarket | null {
  const B = AIRPORT_BY_CODE[stop];
  if (!usable(B) || stop === from || stop === to) return null;
  const cat = catalogueOf(from, to);
  const base = cat ?? customMarket({ from, to });
  const ab = legMarket(from, stop);
  const bc = legMarket(stop, to);
  if (!base || !ab || !bc) return null;
  const fx = cat ? BAL.v019.fares.marketX[cat.id] ?? 1 : 1;
  const r10 = (v: number) => Math.max(10, Math.round(v / 10) * 10);
  const A = AIRPORT_BY_CODE[from];
  const C = AIRPORT_BY_CODE[to];
  const hard = Math.max(base.rightsHard ?? (cat ? (cat.rights === 'open' ? 0 : 0.2) : 0), ab.rightsHard ?? 0);
  const odds = fifthOdds(from, stop, to);
  const strip = (x: RouteMarket): RouteMarket => {
    const { stopover: _s, partner: _p, ...rest } = x;
    void _s; void _p;
    return { ...rest, models: ['own'], model: 'own' };
  };
  const closed = base.closed ?? ab.closed ?? bc.closed ?? CLOSED_COUNTRY[B.country];
  const { partner: _p, stopover: _s, ...b0 } = base;
  void _p; void _s;
  const m: RouteMarket = {
    ...structuredClone(b0),
    id: customId({ from, to, stop }), via: [stop], viaBack: [stop], models: ['own'], model: 'own',
    fareY: [r10(base.fareY[0] * fx), r10(base.fareY[1] * fx)], fareJ: [r10(base.fareJ[0] * fx), r10(base.fareJ[1] * fx)],
    rights: 'bilateral', custom: true, rightsHard: hard, ...(closed ? { closed } : {}),
    blurb: `A stopover at ${B.city}: ${A?.city ?? from}–${C?.city ?? to} passengers stay on; ${A?.city ?? from}–${B.city} passengers get off and on there${odds.full + odds.limited > 0 ? `; ${B.city}–${C?.city ?? to} seats need fifth-freedom rights` : ''}.`,
    stopover: { at: stop, ab: strip(ab), bc: strip(bc), fifth: odds },
  };
  return m;
}

/** The size range shown before a study (travellers a year, P10–P90 of the model's guess). Pure. */
export function customRange(m: RouteMarket): { lo: number; mid: number; hi: number } {
  const r = (v: number) => (v >= 10_000 ? Math.round(v / 1_000) * 1_000 : Math.round(v / 100) * 100);
  return { lo: r(m.odPerYear * Math.exp(-1.28 * CUSTOM_SIGMA)), mid: r(m.odPerYear), hi: r(m.odPerYear * Math.exp(1.28 * CUSTOM_SIGMA)) };
}

/**
 * The real size of a custom pair in this game against the model's guess: fixed per game and pair (a new study of the
 * same pair finds the same market), log-normal around 1. Hidden from the player.
 */
export function customTruth(g: GameState, m: Pick<RouteMarket, 'from' | 'to'>): number {
  const x = Math.exp(gaussian(netSide(g, `custom:${m.from}-${m.to}`)) * CUSTOM_SIGMA);
  return Math.max(0.35, Math.min(2.6, x));
}

// ---------- building a route: bases, fuel stops, fit ----------

/** Where we can fly scheduled routes from: the home base, the crew bases, and the catalogue's origins at home. */
export function routeBases(g: GameState): string[] {
  const home = g.company.homeBase;
  const out = new Set<string>([home]);
  const hc = AIRPORT_BY_CODE[home]?.country;
  for (const c of Object.values(g.crew)) if (c.base && AIRPORT_BY_CODE[c.base]) out.add(c.base);
  for (const m of ROUTE_MARKETS) if (AIRPORT_BY_CODE[m.from]?.country === hc) out.add(m.from);
  return [home, ...[...out].filter((x) => x !== home).sort()];
}

/** Why a type cannot fly a market's chain as drafted (runway, range), or null. ETOPS beyond `cap` too when given. Pure. */
export function chainProblem(m: Pick<RouteMarket, 'from' | 'to' | 'via' | 'viaBack'>, typeId: string, cap?: number): string | null {
  const t = typeOf(typeId);
  if (!t) return 'Unknown aircraft type.';
  const out = [m.from, ...(m.via ?? []), m.to];
  const back = [m.to, ...(m.viaBack ?? [...(m.via ?? [])].reverse()), m.from];
  for (const c of [out, back]) {
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1];
      const b = c[i];
      for (const x of [a, b]) if (runwayFit(typeId, x) === 'no') return `The runway at ${AIRPORT_BY_CODE[x]?.city ?? x} is too short for the ${t.short}.`;
      if (distanceNm(a, b) > maxSectorNm(typeId, a, b)) return `${a}–${b} is beyond the ${t.short}'s range with a full load: add a fuel stop.`;
      if (cap !== undefined && cap !== Infinity && !withinEtops(typeId, a, b, cap)) return `${a}–${b} needs an ETOPS approval we do not hold for the ${t.short}: add a stop or get the approval.`;
    }
  }
  return null;
}

/**
 * The fuel stops a type needs on a pair, within our ETOPS approval (none when it flies it nonstop); the way back is
 * planned on its own (a short runway at the far end can need a stop only one way). Null with the reason when it
 * cannot fly the pair at all.
 */
export function suggestStops(g: GameState, typeId: string, from: string, to: string): { via: string[]; viaBack: string[] } | { why: string } {
  const t = typeOf(typeId);
  if (!t) return { why: 'Unknown aircraft type.' };
  for (const x of [from, to]) if (runwayFit(typeId, x) === 'no') return { why: `The runway at ${AIRPORT_BY_CODE[x]?.city ?? x} is too short for the ${t.short}.` };
  const cap = etopsCap(g.company.approvals, typeId);
  const out = hopRoute(typeId, from, to, cap);
  const back = hopRoute(typeId, to, from, cap);
  if (!out || !back) return { why: `No legal way for the ${t.short} between these airports, even with fuel stops.` };
  const stops = (legs: { to: string }[]) => legs.slice(0, -1).map((l) => l.to);
  return { via: stops(out), viaBack: stops(back) };
}

/** Why the pair cannot be studied at all (null: it can). Pure. */
export function customBlock(d: MarketDraft): string | null {
  const A = AIRPORT_BY_CODE[d.from];
  const B = AIRPORT_BY_CODE[d.to];
  if (!A || !B) return 'Pick an airport.';
  if (d.from === d.to) return 'Pick a different destination.';
  if (B.enroute || B.ice) return `${B.city} is a fuel stop, not a market.`;
  if (distance(d.from, d.to) < 250) return 'Too short for an airliner: road and rail win.';
  if (d.stop) {
    const S = AIRPORT_BY_CODE[d.stop];
    if (!S) return 'Pick a stop.';
    if (S.enroute || S.ice) return `${S.city} is a fuel stop, not a market: no passengers to sell there.`;
    if (distance(d.from, d.stop) < 250 || distance(d.stop, d.to) < 250) return `${S.city} is too close to one end for a stop with passengers.`;
  }
  const m = customMarket(d);
  if (!m) return 'No market there.';
  return m.closed ?? null;
}
