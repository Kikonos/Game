// Offer generation per archetype and the offer lifecycle (B1). DESIGN.md §5.1.1–5.1.2.

import type { CabinLayout, RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { BROKERS } from '../../data/naming';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distance, distanceNm } from '../core/geo';
import { pushMessage } from '../core/messages';
import { requestPause } from '../core/pause';
import { complement, etopsNeeded, planSector, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, next, pick, range, weightedPick } from '../core/rng';
import { DAY, dayIndex, fmtDay, fmtTime, fromUTC, toDate, toLocal } from '../core/time';
import type {
  ApprovalId, Archetype, Client, ContractOffer, GameState, LegTemplate, Minute, OfferEffects, Product, Requirements, SchedulePattern, SimEvent,
} from '../core/types';
import { acceptOffer, askingPrice, closeOffer, setPrice } from './accept';
import { feasibility } from './feasibility';
import { clientPrefix, clientsOf, isGovernment, ministry } from './clients';
import * as F from './flavor';
import { anchorsOf, computeWaves, localToUTC, programmeOf, route, routeMinutes } from './plan';
import { defaultSeats, isWetArchetype, priceProduct, productValue, referenceType } from './pricing';

// ---------- process ----------

/** Seasonal demand by month, Jan–Dec (DESIGN §5.1.1). */
const SEASON_F = [0.7, 0.9, 1.1, 1.2, 1.1, 1.0, 1.0, 0.9, 0.9, 0.9, 0.8, 0.9];

/** Offer rate per day: BAL.offersPerWeek × fleetF × seasonF × repF. */
export function offerRate(g: GameState): number {
  const n = Object.values(g.fleet).filter((a) => a.status !== 'stored' && a.status !== 'leasedOut').length;
  const fleetF = 0.7 + 0.15 * n;
  const repF = 0.6 + (0.8 * g.company.reputation.reliable) / 100;
  return (BAL.offersPerWeek / 7) * fleetF * SEASON_F[toDate(g.now).getUTCMonth()] * repF;
}

/** Queues the next 'offer.spawn': gamma(2) gaps with the Poisson mean (steadier than exponential, same rate). */
export function scheduleNextOffer(g: GameState): void {
  const lambda = offerRate(g);
  const gapDays = -(Math.log(Math.max(1e-9, next(g))) + Math.log(Math.max(1e-9, next(g)))) / (2 * lambda);
  schedule(g, g.now + Math.max(30, Math.round(gapDays * DAY)), 'offer.spawn');
}

/** The three hand-shaped opening offers (DESIGN §5.1.1): AOG cover < 24 h, ad hoc in 3–5 days, an April season base. */
export function openingOffers(g: GameState): void {
  generateOffer(g, 'aogCover', { wide: false, window: false, start: g.now + int(g, 8, 20) * 60 });
  generateOffer(g, 'adhoc', { wide: false, window: false, start: g.now + int(g, 3, 5) * DAY + int(g, 0, 12) * 60, variant: 'group' });
  const y = toDate(g.now).getUTCFullYear();
  const april = fromUTC(y, 4, int(g, 1, 12));
  generateOffer(g, 'seasonBase', { wide: false, window: false, start: april > g.now + 14 * DAY ? april : g.now + 30 * DAY });
}

// ---------- idle windows (gap-fit offers) ----------

export interface IdleWindow {
  aircraftId: string;
  from: Minute;
  to: Minute;
  /** Where the aircraft is when the window opens, and the contract it just finished (follow-on work). */
  at: string;
  afterContract: string | null;
}

/** Free windows of at least `minDays` per fleet aircraft between its hard commitments (12 h margins). */
export function idleWindows(g: GameState, minDays = 2, horizonDays = 150): IdleWindow[] {
  const out: IdleWindow[] = [];
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'stored' || ac.status === 'leasedOut') continue;
    const nodes = anchorsOf(g, ac.id);
    let lastSta = -Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      lastSta = Math.max(lastSta, a.sta);
      const b = nodes[i + 1];
      if (b && b.std < lastSta) continue;
      const from = Math.max(g.now, lastSta) + (a.kind === 'start' ? 0 : 12 * 60);
      const to = b ? b.std - 12 * 60 : g.now + horizonDays * DAY;
      if (to - from >= minDays * DAY) out.push({ aircraftId: ac.id, from, to, at: a.to, afterContract: a.kind === 'start' ? null : a.contractId });
    }
  }
  return out;
}

// ---------- drafting ----------

export interface OfferOpts {
  /** Widebody (aspirational) or narrowbody job; default from the mix. */
  wide?: boolean;
  /** Fit to this idle window, or to none (false); default from the mix. */
  window?: IdleWindow | false;
  /** Overrides (tests, scripted events): client id, key airport (base hub / crisis / resort / away / mission), start, days, legs. */
  client?: string;
  airport?: string;
  start?: Minute;
  days?: number;
  dests?: string[];
  waves?: number;
  rotations?: number;
  variant?: 'group' | 'diaspora' | 'pilgrimage' | 'music' | 'oneway';
}

interface Ctx {
  g: GameState;
  wide: boolean;
  /** Aspirational job: may need approvals or types we don't have yet. */
  aspire: boolean;
  window?: IdleWindow;
  o: OfferOpts;
}

interface Draft {
  archetype: Archetype;
  client: Client;
  broker?: string;
  title: string;
  blurb: string;
  pattern: SchedulePattern;
  req: { minSeats: number; maxSeats?: number; layout?: CabinLayout; families?: RatingFamily[]; extraCabin: number; noTechStops?: boolean; approvals: ApprovalId[] };
  start: Minute;
  end: Minute;
  /** Minutes from now until the offer lapses (clamped before the start). */
  expiresIn: number;
  mult?: number;
  mghPerMonth?: number;
  effects: OfferEffects;
  risk: { disruption: number; politics: number; permit: number };
  dueDays?: number;
  pin?: string;
  hook?: string;
}

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;
const km = (a: string, b: string) => distance(a, b);
const r2 = (v: number) => Math.round(v * 100) / 100;
const listCities = (codes: string[]) => {
  const names = codes.map(city);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
};

/** UTC minute of a local time on the local date containing t. */
function atLocal(code: string, t: Minute, localMin: number): Minute {
  return localToUTC(code, dayIndex(toLocal(code, t)) * DAY + localMin);
}

/** A start time in [now + leadMin, now + leadMax] that leaves `dur` inside the idle window; null if none. */
function pickStart(ctx: Ctx, leadMin: number, leadMax: number, dur: number): Minute | null {
  const { g, window: w } = ctx;
  let lo = g.now + leadMin;
  let hi = g.now + leadMax;
  if (w) {
    lo = Math.max(lo, w.from);
    hi = Math.min(hi, w.to - dur);
  }
  if (hi < lo) return null;
  return Math.round(lo + next(g) * (hi - lo));
}

function pickN<T>(g: GameState, xs: T[], n: number, weight: (x: T) => number): T[] {
  const pool = [...xs];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const x = weightedPick(g, pool, weight);
    if (x === undefined) break;
    out.push(x);
    pool.splice(pool.indexOf(x), 1);
  }
  return out;
}

function airportsWithin(from: string, minKm: number, maxKm: number, pred: (a: Airport) => boolean): Airport[] {
  return AIRPORTS.filter((a) => a.code !== from && a.runwayM >= 2000 && pred(a) && km(from, a.code) >= minKm && km(from, a.code) <= maxKm);
}

/** Clients weighted towards the idle window's location (follow-on work) or our home base. */
function nearClient(ctx: Ctx, list: Client[]): Client | undefined {
  const at = ctx.window?.at ?? ctx.g.company.homeBase;
  if (ctx.o.client) return list.find((c) => c.id === ctx.o.client) ?? ctx.g.clients[ctx.o.client];
  return weightedPick(ctx.g, list, (c) => (km(c.base, at) < 1500 ? 4 : km(c.base, at) < 3500 ? 2 : 1));
}

function hookFor(ctx: Ctx): string | undefined {
  const w = ctx.window;
  if (!w) return undefined;
  const ac = ctx.g.fleet[w.aircraftId];
  if (w.afterContract && ctx.g.contracts[w.afterContract]) return `Follow-on: ${ac?.reg ?? 'an aircraft'} is free at ${w.at} from ${fmtDay(w.from)}`;
  return `Fits ${ac?.reg ?? 'an aircraft'}: free ${fmtDay(w.from)}${w.to - w.from < 120 * DAY ? `–${fmtDay(w.to)}` : ' onwards'}`;
}

const seatsText = (min: number, layout?: CabinLayout) => `${min}+ seats${layout === 'two-class' ? ', two-class cabin' : ''}`;

// ---------- archetypes ----------

function seasonBase(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const hubs = wide ? F.BASE_HUBS_WB : F.BASE_HUBS_NB;
  const cands = clientsOf(g, ['airline'], (c) => (o.airport ? c.base === o.airport : hubs.includes(c.base)) && !!AIRPORT_BY_CODE[c.base]);
  const client = nearClient(ctx, cands);
  if (!client) return null;
  const base = client.base;
  const days = o.days ?? int(g, 30, 92);
  let s = o.start ?? pickStart(ctx, 14 * DAY, 60 * DAY, (days + 1) * DAY);
  if (s === null) return null;
  // Season deals start on the 1st or the 15th when that still fits.
  if (o.start === undefined) {
    const d = toDate(s);
    const snap = d.getUTCDate() <= 15 ? fromUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 15) : fromUTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 1);
    if (!ctx.window || snap + days * DAY <= ctx.window.to) s = snap;
  }
  const from = atLocal(base, s, 0) < s - 12 * 60 ? atLocal(base, s + DAY, 0) : atLocal(base, s, 0);
  const to = localToUTC(base, (dayIndex(toLocal(base, from)) + days) * DAY);
  // Destinations: leisure airports 400–2,200 km (wider for northern hubs); long-haul cities for widebodies.
  let dests: string[] = o.dests ?? [];
  if (!dests.length) {
    const n = wide ? int(g, 2, 4) : int(g, 4, 8);
    let pool = wide
      ? airportsWithin(base, 2500, 6500, (a) => a.size >= 3)
      : airportsWithin(base, 400, 2200, (a) => a.tour >= 0.75);
    if (!wide && pool.length < 6) pool = airportsWithin(base, 400, 3200, (a) => a.tour >= 0.7);
    dests = pickN(g, pool, n, (a) => a.tour * (1 + a.size)).map((a) => a.code);
  }
  if (dests.length < (wide || o.dests ? 1 : 3)) return null;
  const minSeats = wide ? pick(g, [250, 260, 280]) : pick(g, [168, 174, 180]);
  const layout: CabinLayout | undefined = wide ? 'two-class' : chance(g, ctx.aspire ? 0.3 : 0.05) ? 'two-class' : chance(g, 0.85) ? 'all-economy' : undefined;
  const families: RatingFamily[] | undefined = !wide && chance(g, 0.25) ? [chance(g, ctx.aspire ? 0.5 : 0.88) ? 'A320' : 'B737'] : undefined;
  const req = { minSeats, layout, families, extraCabin: 0, approvals: [] as ApprovalId[] };
  const ref = referenceType(req, dests.flatMap((d) => [[base, d], [d, base]] as [string, string][]), true);
  if (!ref) return null;
  const waves = computeWaves(base, dests, ref, o.waves ?? (wide ? int(g, 1, 2) : int(g, 2, 3)));
  const mgh = wide ? BAL.mgh.wide : BAL.mgh.narrow;
  const targetBH = Math.round(mgh * range(g, ...BAL.targetOverMgh));
  const mo = toDate(from).getUTCMonth();
  const season = mo >= 2 && mo <= 8 ? 'Summer' : 'Winter';
  const fam = families ? `${families[0] === 'B737' ? '737' : 'A320'}-family aircraft` : wide ? 'a widebody' : 'an A320-size aircraft';
  return {
    archetype: 'seasonBase', client,
    title: wide ? `Long-haul base at ${city(base)}` : `${season} base at ${city(base)}`,
    blurb:
      `${client.name} wants ${fam} (${seatsText(minSeats, layout)}) based at ${base} from ${fmtDay(toLocal(base, from))} to ${fmtDay(toLocal(base, to - 1))}, ` +
      `flying to ${listCities(dests)}: ${waves.length} wave${waves.length > 1 ? 's' : ''} a day from 06:00 local and a maintenance night every 7 days. ` +
      `MGH ${mgh} BH a month; they plan about ${targetBH}. Crews live in ${city(base)} hotels at the client's cost.`,
    pattern: { kind: 'base', base, dests, from, to, targetBH, waves, prefix: clientPrefix(client.name), maintEvery: 7 },
    req, start: from, end: to,
    expiresIn: range(g, 3, 7) * DAY,
    effects: { reliable: 2 },
    risk: { disruption: 0.2, politics: 0, permit: client.payReliability < 0.8 ? 0.15 : 0 },
    hook: hookFor(ctx),
  };
}

function aogCover(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  if (ctx.window && ctx.window.from > g.now + 20 * 60) return null;
  const at = ctx.window?.at ?? g.company.homeBase;
  const cands = clientsOf(g, ['airline'], (c) => !!AIRPORT_BY_CODE[c.base] && (o.airport ? c.base === o.airport : wide || km(c.base, at) < 3500));
  const client = nearClient(ctx, cands);
  if (!client) return null;
  const base = client.base;
  const start = o.start ?? g.now + int(g, 2, 24) * 60 + int(g, 0, 11) * 5;
  let days = o.days ?? int(g, 2, 10);
  if (ctx.window) days = Math.min(days, Math.floor((ctx.window.to - start) / DAY));
  if (days < 2) return null;
  const pool = wide ? airportsWithin(base, 2500, 7000, (a) => a.size >= 3) : airportsWithin(base, 400, 2500, (a) => a.size >= 2 && (a.tour >= 0.6 || a.size >= 3));
  const dests = o.dests ?? pickN(g, pool, wide ? int(g, 1, 2) : int(g, 2, 5), (a) => a.size + a.tour * 2).map((a) => a.code);
  if (!dests.length) return null;
  const minSeats = wide ? 250 : pick(g, [150, 165, 174]);
  const req = { minSeats, extraCabin: 0, approvals: [] as ApprovalId[] };
  const ref = referenceType(req, dests.flatMap((d) => [[base, d], [d, base]] as [string, string][]), true);
  if (!ref) return null;
  const waves = computeWaves(base, dests, ref, o.waves ?? (wide ? 1 : int(g, 2, 3)));
  const perDay = wide ? 10 : 8;
  const mghPerMonth = Math.round(perDay * 30.44);
  const end = start + days * DAY;
  const lead = start - g.now;
  return {
    archetype: 'aogCover', client,
    title: `AOG cover at ${city(base)}`,
    blurb:
      `${client.name} has an aircraft grounded at ${base} after ${pick(g, F.AOG_CAUSES)}. They need cover from ${fmtTime(start, base)} local ` +
      `${lead < 18 * 60 ? 'today' : 'tomorrow'} for ${days} days, flying their schedule to ${listCities(dests)}. Premium rate, MGH ${perDay} BH a day.`,
    pattern: { kind: 'base', base, dests, from: start, to: end, targetBH: Math.round(mghPerMonth * 1.08), waves, prefix: clientPrefix(client.name), maintEvery: 7 },
    req, start, end,
    expiresIn: Math.min(int(g, 3, 8) * 60, Math.max(60, lead - 90)),
    mult: 1.3 + 0.7 * Math.pow(next(g), 1.6),
    mghPerMonth,
    effects: { reliable: 2 },
    risk: { disruption: 0.4, politics: 0, permit: 0 },
    hook: hookFor(ctx),
  };
}

/** Round trip or one-way legs: out at a local slot, back `backDays` later at a local slot. */
function roundTrip(g: GameState, a: string, b: string, start: Minute, backDays: number | null, pax: number): LegTemplate[] {
  const out = atLocal(a, start, pick(g, F.DEP_SLOTS));
  const legs: LegTemplate[] = [{ from: a, to: b, dep: out, flightNo: '', pax }];
  if (backDays !== null) legs.push({ from: b, to: a, dep: atLocal(b, out + backDays * DAY, pick(g, F.DEP_SLOTS)), flightNo: '', pax });
  return legs;
}

function adhoc(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const variant = o.variant ?? weightedPick(g, ['group', 'diaspora', 'pilgrimage', 'music', 'oneway'] as const, (v) =>
    ({ group: 0.45, diaspora: 0.15, pilgrimage: 0.12, music: 0.1, oneway: 0.18 })[v])!;
  let client: Client | undefined;
  let legs: LegTemplate[] = [];
  let title = '';
  let blurb = '';
  let pax = wide ? int(g, 255, 300) : int(g, 120, 178);
  const dur = 8 * DAY;
  const s = o.start ?? pickStart(ctx, 3 * DAY, 30 * DAY, dur);
  if (s === null) return null;
  if (variant === 'diaspora') {
    client = clientsOf(g, ['agency'], (c) => c.name === 'Lusofonia Viagens')[0];
    const dest = o.airport ?? pick(g, F.DIASPORA.filter((c) => AIRPORT_BY_CODE[c]));
    if (!client) return null;
    const back = int(g, 4, 7);
    legs = roundTrip(g, client.base, dest, s, back, pax);
    title = `Diaspora charter ${client.base}–${dest}`;
    blurb = `${client.name} has a full load of families flying home to ${city(dest)} for a festival, with heavy bags. Out ${fmtDay(legs[0].dep)}, back ${back} days later.`;
  } else if (variant === 'pilgrimage') {
    client = clientsOf(g, ['agency'], (c) => c.name === 'Peregrinos de Fátima')[0];
    if (!client) return null;
    const origins = ['WAW', 'KRK', 'DUB', 'MXP', 'BUD', 'VIE', 'MUC', 'LYS', 'BRU'].filter((c) => AIRPORT_BY_CODE[c]);
    const from = o.airport ?? pick(g, origins);
    const back = int(g, 3, 5);
    legs = roundTrip(g, from, 'LIS', s, back, pax);
    title = `Pilgrimage ${from}–Lisbon`;
    blurb = `${client.name} is bringing a parish group from ${city(from)} to Fátima, with wheelchairs and elderly passengers. Out ${fmtDay(legs[0].dep)}, home ${back} days later.`;
  } else if (variant === 'music') {
    client = nearClient(ctx, clientsOf(g, ['music']));
    if (!client) return null;
    const stops = pickN(g, airportsWithin(client.base, 300, 2600, (a) => a.size >= 3), 3, (a) => a.size);
    if (stops.length < 3) return null;
    pax = int(g, 90, 140);
    let t = atLocal(client.base, s, pick(g, F.DEP_SLOTS.slice(3)));
    const pts = [client.base, ...stops.map((a) => a.code)];
    legs = [];
    for (let i = 0; i < 3; i++) {
      legs.push({ from: pts[i], to: pts[i + 1], dep: t, flightNo: '', pax });
      t = atLocal(pts[i + 1], t + int(g, 2, 3) * DAY, pick(g, F.DEP_SLOTS.slice(4)));
    }
    title = `Tour hops for ${client.name.replace(/"/g, '')}`.replace('Tour hops for The', 'Tour hops for the');
    blurb = `${client.name}: band, crew and kit hopping ${listCities(pts)} over a week, one-way legs after each show. Expect late finishes.`;
  } else if (variant === 'oneway') {
    client = nearClient(ctx, clientsOf(g, ['agency', 'tourOperator'], (c) => !isGovernment(c) && !!AIRPORT_BY_CODE[c.base]));
    if (!client) return null;
    const ports = ['BCN', 'PMI', 'VCE', 'ATH', 'LPA', 'FNC', 'MLA', 'NAP', 'CPH', 'SOU', 'MRS'].filter((c) => AIRPORT_BY_CODE[c] && c !== client!.base);
    const dest = o.airport ?? pick(g, ports);
    legs = roundTrip(g, client.base, dest, s, null, pax);
    title = `Cruise crew change to ${city(dest)}`;
    blurb = `${client.name} needs ${pax} cruise-ship crew flown ${client.base}–${dest} one way on ${fmtDay(legs[0].dep)} to meet the ship. The aircraft comes back empty.`;
  } else {
    const group = pick(g, F.ADHOC_GROUPS);
    client = nearClient(ctx, clientsOf(g, group.kinds, (c) => !isGovernment(c) && !!AIRPORT_BY_CODE[c.base]));
    if (!client) return null;
    const pool = wide
      ? airportsWithin(client.base, 5000, 9000, (a) => a.tour >= 0.7)
      : airportsWithin(client.base, 600, 3500, (a) => a.tour >= 0.6 || a.size >= 4);
    const dest = o.airport ?? weightedPick(g, pool, (a) => a.tour + a.size / 5)?.code;
    if (!dest) return null;
    const oneWay = chance(g, 0.2);
    const back = int(g, 2, 6);
    legs = roundTrip(g, client.base, dest, s, oneWay ? null : back, pax);
    const what = group.what.replace(/^an? /, '');
    title = `${what[0].toUpperCase()}${what.slice(1)} to ${city(dest)}`;
    blurb = `${client.name} has ${group.what} of ${pax} to fly ${client.base}–${dest} on ${fmtDay(legs[0].dep)}${oneWay ? ', one way (we come back empty)' : `, back ${back} days later`}. All-in price: we buy the fuel and pay the fees.`;
  }
  const broker = chance(g, 0.45) ? pick(g, BROKERS) : undefined;
  const last = legs[legs.length - 1];
  return {
    archetype: 'adhoc', client, broker, title, blurb: broker ? `Via ${broker}: ${blurb}` : blurb,
    pattern: { kind: 'legs', legs },
    req: { minSeats: Math.ceil(pax / 10) * 10 - (wide ? 0 : 5), extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 6 * 60,
    expiresIn: range(g, 2, 4) * DAY,
    effects: {},
    risk: { disruption: 0.15, politics: 0, permit: 0 },
    hook: hookFor(ctx),
  };
}

function sports(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const client = nearClient(ctx, clientsOf(g, ['sports'], (c) => !!AIRPORT_BY_CODE[c.base]));
  if (!client) return null;
  const home = client.base;
  const season = !wide && chance(g, 0.25);
  const trips = season ? int(g, 3, 8) : 1;
  const every = season ? int(g, 7, 14) : 0;
  const span = (trips - 1) * every * DAY + 2 * DAY;
  const s = o.start ?? pickStart(ctx, 7 * DAY, 60 * DAY, span);
  if (s === null) return null;
  const legs: LegTemplate[] = [];
  const pax = wide ? int(g, 250, 290) : int(g, 105, 150);
  if (wide) {
    const pool = F.TOUR_CITIES.filter((c) => AIRPORT_BY_CODE[c] && km(home, c) > 4500);
    const far = o.airport ?? (pool.length ? pick(g, pool) : undefined);
    if (!far) return null;
    const back = int(g, 8, 12);
    legs.push(...roundTrip(g, home, far, s, back, pax));
    return {
      archetype: 'sports', client, title: `Pre-season tour to ${city(far)}`,
      blurb: `${client.name} take the squad, sponsors and a fan club to ${city(far)} for a ${back}-day pre-season tour. Branded headrests and a nutritionist menu; two extra cabin crew.`,
      pattern: { kind: 'legs', legs }, req: { minSeats: 250, extraCabin: 2, approvals: [] },
      start: legs[0].dep, end: legs[1].dep + 12 * 60, expiresIn: range(g, 2, 5) * DAY, effects: { morale: 2 },
      risk: { disruption: 0.2, politics: 0, permit: 0 }, hook: hookFor(ctx),
    };
  }
  const pool = airportsWithin(home, 500, 3500, (a) => a.size >= 3 && a.runwayM >= 2400);
  const aways = o.airport ? [o.airport] : pickN(g, pool, trips, (a) => a.size).map((a) => a.code);
  if (aways.length < trips) return null;
  for (let i = 0; i < trips; i++) {
    const match = s + DAY + i * every * DAY;
    legs.push({ from: home, to: aways[i], dep: atLocal(home, match - DAY, int(g, 22, 32) * 30), flightNo: '', pax });
    legs.push({ from: aways[i], to: home, dep: atLocal(aways[i], match, 23 * 60), flightNo: '', pax });
  }
  const last = legs[legs.length - 1];
  return {
    archetype: 'sports', client,
    title: season ? `Away-day package: ${trips} trips` : `${pick(g, F.SPORT_TITLES)} ${city(aways[0])}`,
    blurb: season
      ? `${client.name} want one operator for their next ${trips} away games (${listCities(aways)}), roughly every ${every} days. Out the day before, back after the match at 23:00 local. Two extra cabin crew.`
      : `${client.name} play in ${city(aways[0])} on ${fmtDay(legs[1].dep)}. Out the day before, back straight after the match at 23:00 local; extra time can push it. Two extra cabin crew for the team service.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: Math.max(120, Math.ceil(pax / 10) * 10), extraCabin: 2, approvals: [] },
    start: legs[0].dep, end: last.dep + 6 * 60,
    expiresIn: range(g, 2, 5) * DAY,
    effects: { morale: 2 },
    risk: { disruption: 0.25, politics: 0, permit: 0 },
    hook: hookFor(ctx),
  };
}

function repatriation(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  if (ctx.window && ctx.window.from > g.now + 60 * 60) return null;
  const client = (o.client && g.clients[o.client]) || ministry(g, 'Foreign Affairs');
  if (!client) return null;
  const home = g.company.homeBase;
  const crisis = o.airport ?? pick(g, F.CRISIS_AIRPORTS.filter((c) => AIRPORT_BY_CODE[c] && c !== home));
  const n = o.rotations ?? (wide ? int(g, 1, 2) : int(g, 1, 3));
  const est = route(wide ? 'b763' : 'a320ceo', crisis, home) ?? route('a333', crisis, home);
  const chain = est ? routeMinutes(est) : 10 * 60;
  const lead = o.start !== undefined ? o.start - g.now : int(g, 24, 72) * 60;
  const pax = wide ? int(g, 250, 290) : int(g, 140, 175);
  const legs: LegTemplate[] = [];
  let dep = atLocal(crisis, g.now + lead, int(g, 16, 28) * 30);
  if (dep < g.now + 20 * 60) dep += DAY;
  for (let i = 0; i < n; i++) {
    legs.push({ from: crisis, to: home, dep, flightNo: '', pax });
    dep += Math.ceil((2 * chain + 2 * 60 + 180) / 15) * 15;
  }
  const last = legs[legs.length - 1];
  const start = legs[0].dep;
  return {
    archetype: 'repatriation', client,
    title: n > 1 ? `Repatriation airlift from ${city(crisis)}` : `Repatriation from ${city(crisis)}`,
    blurb:
      `${pick(g, F.CRISES)} in ${city(crisis)}. The ${client.name} needs ${n === 1 ? 'a flight' : `${n} flights`} ${crisis}–${home} for about ${pax} citizens, ` +
      `first departure ${fmtDay(start)} ${fmtTime(start, crisis)} local. Permits are filed but may slip; payment after the job, governments pay late.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: wide ? 250 : 150, extraCabin: 0, approvals: [] },
    start, end: last.dep + chain,
    expiresIn: Math.min(int(g, 4, 12) * 60, Math.max(90, start - g.now - 6 * 60)),
    effects: { clean: 2, reliable: 1, morale: 6 },
    risk: { disruption: 0.5, politics: 0.5, permit: r2(range(g, 0.3, 0.8)) },
    dueDays: 30,
    pin: crisis,
    hook: hookFor(ctx),
  };
}

function tourSeries(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const client = nearClient(ctx, clientsOf(g, ['tourOperator'], (c) => !!AIRPORT_BY_CODE[c.base] && c.base !== 'CPT'));
  if (!client) return null;
  const base = client.base;
  const resorts = (wide ? F.RESORTS_WB : F.RESORTS_NB).filter((c) => {
    if (!AIRPORT_BY_CODE[c] || c === base) return false;
    const d = km(base, c);
    return wide ? d > 5000 : d > 700 && d < 4300;
  });
  const resort = o.airport ?? pick(g, resorts);
  if (!resort) return null;
  const n = o.rotations ?? int(g, 4, 12);
  const s = o.start ?? pickStart(ctx, 30 * DAY, 120 * DAY, n * 7 * DAY);
  if (s === null) return null;
  const est = planSector(wide ? 'b763' : 'a320ceo', base, resort);
  const block = est.ok ? est.legs.reduce((x, l) => x + l.block, 0) : 4 * 60;
  const pax = wide ? int(g, 260, 300) : int(g, 165, 180);
  const outLocal = int(g, 12, 20) * 30;
  const legs: LegTemplate[] = [];
  for (let i = 0; i < n; i++) {
    const out = atLocal(base, s + i * 7 * DAY, outLocal);
    legs.push({ from: base, to: resort, dep: out, flightNo: '', pax });
    legs.push({ from: resort, to: base, dep: out + Math.ceil((block + (wide ? 90 : 60)) / 5) * 5, flightNo: '', pax });
  }
  const wd = F.WEEKDAYS[toDate(toLocal(base, legs[0].dep)).getUTCDay()];
  const last = legs[legs.length - 1];
  return {
    archetype: 'tourSeries', client,
    title: `${wd} series ${base}–${resort}`,
    blurb: `${client.name}: ${n} weekly rotations every ${wd}, ${fmtDay(legs[0].dep)}–${fmtDay(last.dep)}. Out at ${fmtTime(legs[0].dep, base)} local, back the same day; no fuel stops. Paid per rotation with a fuel-escalation clause.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: wide ? 250 : Math.min(180, Math.ceil(pax / 10) * 10), extraCabin: 0, approvals: [], noTechStops: true },
    start: legs[0].dep, end: last.dep + block,
    expiresIn: range(g, 3, 7) * DAY,
    effects: {},
    risk: { disruption: 0.1, politics: 0, permit: 0 },
    pin: resort,
    hook: hookFor(ctx),
  };
}

function troopRotation(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const client = (o.client && g.clients[o.client]) || ministry(g, 'Defence');
  if (!client) return null;
  const home = g.company.homeBase;
  const mission = o.airport ?? pick(g, F.MISSION_AIRPORTS.filter((c) => AIRPORT_BY_CODE[c] && c !== home));
  const n = o.rotations ?? int(g, 2, 4);
  const spanDays = o.days ?? int(g, 30, 90);
  const s = o.start ?? pickStart(ctx, 30 * DAY, 90 * DAY, spanDays * DAY);
  if (s === null) return null;
  const pax = wide ? int(g, 250, 280) : int(g, 150, 170);
  const legs: LegTemplate[] = [];
  const step = n > 1 ? Math.floor(spanDays / (n - 1)) : 0;
  for (let i = 0; i < n; i++) {
    const out = atLocal(home, s + i * step * DAY, 8 * 60);
    legs.push({ from: home, to: mission, dep: out, flightNo: '', pax });
    legs.push({ from: mission, to: home, dep: atLocal(mission, out + DAY, 9 * 60), flightNo: '', pax });
  }
  const last = legs[legs.length - 1];
  return {
    archetype: 'troopRotation', client,
    title: `Troop rotation to ${city(mission)}`,
    blurb: `${client.name}: ${n} rotations ${home}–${mission} ${pick(g, F.MISSIONS)}, every ${step || 1} days or so from ${fmtDay(legs[0].dep)}. Night-stop at ${mission}, security-vetted crew, payment in arrears.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: wide ? 250 : 150, extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 8 * 60,
    expiresIn: range(g, 5, 10) * DAY,
    effects: { morale: 2, clean: -1 },
    risk: { disruption: 0.3, politics: 0.4, permit: r2(range(g, 0.3, 0.8)) },
    dueDays: 45,
    pin: mission,
    hook: hookFor(ctx),
  };
}

const BUILDERS: Partial<Record<Archetype, (ctx: Ctx) => Draft | null>> = { seasonBase, aogCover, adhoc, sports, repatriation, tourSeries, troopRotation };

/** Archetype weights for the current month (season bases before summer, sports outside June–July…). */
function weights(g: GameState): [Archetype, number][] {
  const mo = toDate(g.now).getUTCMonth();
  return [
    ['seasonBase', mo <= 4 ? 0.24 : mo === 5 ? 0.12 : mo <= 7 ? 0.08 : 0.14],
    ['aogCover', mo >= 5 && mo <= 8 ? 0.17 : 0.13],
    ['adhoc', 0.25],
    ['sports', mo === 5 || mo === 6 ? 0.04 : 0.11],
    ['repatriation', 0.06],
    ['tourSeries', (mo >= 1 && mo <= 5) || mo === 8 || mo === 9 ? 0.13 : 0.08],
    ['troopRotation', 0.06],
  ];
}

/** Archetypes that can live inside an idle window. */
function fitsWindow(a: Archetype, w: IdleWindow, now: Minute): boolean {
  const len = (w.to - w.from) / DAY;
  const lead = (w.from - now) / DAY;
  switch (a) {
    case 'seasonBase': return len >= 32 && lead <= 60;
    case 'aogCover': return lead <= 0.8 && len >= 2;
    case 'repatriation': return lead <= 2 && len >= 2;
    case 'adhoc': return len >= 2 && lead <= 30;
    case 'sports': return len >= 2.5 && lead <= 60;
    case 'troopRotation': return len >= 32 && lead <= 90;
    default: return false;
  }
}

// ---------- finalise ----------

function finalize(g: GameState, d: Draft, aspire: boolean): ContractOffer | null {
  const home = g.company.homeBase;
  const p = d.pattern;
  const sectors: [string, string][] = p.kind === 'base' ? p.dests.flatMap((x) => [[p.base, x], [x, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
  const ref = referenceType(d.req, sectors, p.kind === 'base');
  if (!ref) return null;
  const airports = [...new Set(sectors.flat())];
  const requirements: Requirements = {
    minSeats: d.req.minSeats, maxSeats: d.req.maxSeats, layout: d.req.layout, body: typeOf(ref).body, families: d.req.families,
    longestSectorNm: Math.round(Math.max(...sectors.map(([a, b]) => distanceNm(a, b)))),
    minRunwayM: Math.min(...airports.map((c) => AIRPORT_BY_CODE[c]?.runwayM ?? 0)),
    etops: 0, approvals: d.req.approvals, extraCabin: d.req.extraCabin, noTechStops: d.req.noTechStops,
  };
  const prog = programmeOf({ pattern: p, requirements }, ref);
  if (!prog.ok) return null;
  for (const [a, b] of sectors) for (const l of planSector(ref, a, b).legs) requirements.etops = Math.max(requirements.etops, etopsNeeded(ref, l.from, l.to));
  // Everyday work stays within the ETOPS approval we hold; aspirational jobs show the ladder.
  const etopsHeld = g.company.approvals.includes('etops240') ? 240 : g.company.approvals.includes('etops180') ? 180 : g.company.approvals.includes('etops120') ? 120 : 0;
  if (!aspire && requirements.etops > etopsHeld) return null;
  // Estimates on the reference type: revenue hours plus empty legs from and back to our home base.
  let emptyMin = prog.emptyMin;
  let deps = prog.trips.reduce((s, t) => s + t.legs.length, 0) || (prog.base?.rotations ?? 0) * 2;
  const revDeps = prog.trips.reduce((s, t) => s + t.legs.filter((l) => l.kind !== 'positioning').length, 0);
  const crewN = complement(ref, defaultSeats(ref), { extraCabin: d.req.extraCabin }).length;
  let roomNights = 0;
  let crewDays = 0;
  for (const t of prog.trips) {
    let span = t.sta - t.std;
    for (const [a, b] of [[home, t.from], [t.to, home]]) {
      const r = route(ref, a, b);
      if (!r || !r.length) continue;
      emptyMin += r.reduce((s, l) => s + l.block, 0);
      span += routeMinutes(r) + 60;
      deps += r.length;
    }
    const nights = Math.floor(span / DAY + 0.3);
    roomNights += crewN * nights;
    crewDays += crewN * Math.max(1, Math.ceil(span / DAY));
  }
  const revBH = prog.revenueMin / 60;
  const wet = isWetArchetype(d.archetype);
  const gov = isGovernment(d.client);
  const product: Product = priceProduct(g, {
    archetype: d.archetype, typeId: ref, estBH: wet ? revBH : revBH + emptyMin / 60, start: d.start, end: d.end, lead: d.start - g.now,
    mult: d.mult, departures: deps, revDepartures: revDeps, roomNights, crewDays, government: gov, mghPerMonth: d.mghPerMonth,
  });
  const lead = d.start - g.now;
  const urgency = lead < 72 * 60 ? 'urgent' : lead < 7 * DAY ? 'short' : 'normal';
  const maxExp = urgency === 'urgent' ? lead - 60 : lead - 12 * 60;
  const expiresIn = Math.max(urgency === 'urgent' ? 60 : Math.min(2 * DAY, maxExp), Math.min(d.expiresIn, maxExp));
  const wide = typeOf(ref).body === 'wide';
  const firstAway = p.kind === 'base' ? p.base : p.legs.flatMap((l) => [l.from, l.to]).find((c) => c !== home) ?? p.legs[0].to;
  const o: ContractOffer = {
    id: nextId(g, 'o'),
    archetype: d.archetype, clientId: d.client.id, broker: d.broker, title: d.title, blurb: d.blurb,
    product, requirements, pattern: p, start: d.start, end: d.end, created: g.now, expires: g.now + Math.round(expiresIn), urgency,
    penalties: { cancelScale: BAL.cancelScale.map(([a, b]) => [a, b] as [number, number]), perDelay: BAL.perDelay[wide ? 1 : 0], perCancelledLeg: BAL.perCancelledLeg[wide ? 1 : 0] },
    payment: wet
      ? { basis: 'arrears', dueDays: gov ? 30 : 7, depositPct: 0 }
      : gov ? { basis: 'arrears', dueDays: d.dueDays ?? 30, depositPct: 0 } : { basis: 'onCompletion', dueDays: 7, depositPct: product.kind === 'charter' ? product.depositPct : 0 },
    effects: d.effects,
    risk: { payment: r2(1 - d.client.payReliability), ...d.risk },
    estBH: Math.round(revBH * 10) / 10,
    estValue: 0,
    floor: r2(range(g, ...BAL.counterFloor)),
    status: 'open',
    pin: d.pin ?? firstAway,
    hook: d.hook,
  };
  o.estValue = productValue(product, revBH, d.start, d.end);
  g.offers[o.id] = o;
  schedule(g, o.expires, 'offer.expire', o.id);
  // Urgent work we could actually fly stops the clock (setting) and gets an inbox line; the rest just pins the map.
  if (urgency === 'urgent' && Object.keys(g.fleet).some((id) => feasibility(g, o.id, id).level !== 'no')) {
    requestPause('urgentOffer');
    pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Urgent: ${o.title}`, body: `${d.client.name} needs an answer by ${fmtDay(o.expires)} ${fmtTime(o.expires)} UTC.`, ref: { kind: 'offer', id: o.id } });
  }
  return o;
}

/**
 * Builds one offer of the given (or a weighted random) archetype with a fictional client, pattern, requirements,
 * price and expiry; adds it to g.offers and queues 'offer.expire'. About half are fitted to a real idle window of a
 * fleet aircraft, ~18% are aspirational (bigger type). Returns null when no sensible offer could be built.
 */
export function generateOffer(g: GameState, archetype?: Archetype, opts: OfferOpts = {}): ContractOffer | null {
  const roll = next(g);
  const mode = roll < BAL.gapFitShare ? 'gap' : roll < 1 - BAL.aspirationalShare ? 'fleet' : 'aspire';
  const fleet = Object.values(g.fleet);
  const wideShare = fleet.length ? fleet.filter((a) => typeOf(a.typeId).body === 'wide').length / fleet.length : 0;
  const wide = opts.wide ?? (mode === 'aspire' ? wideShare < 1 : chance(g, wideShare));
  let window: IdleWindow | undefined;
  if (opts.window) window = opts.window;
  else if (opts.window === undefined && mode === 'gap') {
    const ws = idleWindows(g);
    window = ws.length ? weightedPick(g, ws, (w) => Math.sqrt((w.to - w.from) / DAY)) : undefined;
  }
  const tries: Archetype[] = [];
  if (archetype) tries.push(archetype, archetype, archetype);
  else {
    const ws = weights(g).filter(([a]) => !window || fitsWindow(a, window, g.now));
    for (let i = 0; i < 3 && ws.length; i++) {
      const a = weightedPick(g, ws, ([, w]) => w)![0];
      tries.push(a);
    }
  }
  for (let i = 0; i < tries.length; i++) {
    const build = BUILDERS[tries[i]];
    if (!build) continue;
    // Last attempt drops the window so a forced archetype still appears.
    const ctx: Ctx = { g, wide, aspire: opts.wide ?? mode === 'aspire', window: i === tries.length - 1 && !opts.window ? undefined : window, o: opts };
    const d = build(ctx);
    const o = d && finalize(g, d, ctx.aspire);
    if (o) return o;
  }
  return null;
}

// ---------- lifecycle ----------

/** 'offer.spawn': generate an offer, schedule the next spawn. */
export function onOfferSpawn(g: GameState, _ev: SimEvent): void {
  if (!generateOffer(g)) generateOffer(g);
  scheduleNextOffer(g);
}

function rivalName(g: GameState): string {
  return g.rivals.length ? pick(g, g.rivals).name : 'a rival operator';
}

/** 'offer.expire': open offers lapse; most go to a rival (named in the missed list). Countered offers wait for the reply. */
export function onOfferExpire(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  if (!o || o.status !== 'open' || g.now < o.expires) return;
  const lost = chance(g, 0.7);
  closeOffer(g, o, lost ? 'lost' : 'expired', lost ? rivalName(g) : undefined);
}

/** 'offer.reply': the client answers a counter: accept at the countered price (signs on the chosen aircraft) or refuse. */
export function onOfferReply(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  if (!o || o.status !== 'countered' || !o.counter || o.counter.result) return;
  const client = g.clients[o.clientId]?.name ?? 'The client';
  const late = g.now > o.expires;
  if (late && chance(g, 0.25)) {
    o.counter.result = 'refused';
    closeOffer(g, o, 'lost', rivalName(g));
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `Lost: ${o.title}`, body: `While we haggled, ${o.lostTo} took it.`, ref: { kind: 'offer', id: o.id } });
    return;
  }
  const asking = askingPrice(o);
  const ratio = o.counter.price / asking;
  const p = ratio <= 1 ? 1 : ratio > o.floor ? 0 : 1 - (0.5 * (ratio - 1)) / (o.floor - 1);
  if (chance(g, p)) {
    o.counter.result = 'accepted';
    setPrice(o, o.counter.price);
    o.status = 'open';
    const res = acceptOffer(g, o.id, o.counter.aircraftIds ?? []);
    if (res.ok) {
      pushMessage(g, { tone: 'good', cat: 'commercial', title: `Counter accepted: ${o.title}`, body: `${client} agreed to ${fmtPrice(o.product)}. The contract is signed.`, ref: { kind: 'contract', id: res.data!.contractId } });
    } else {
      closeOffer(g, o, 'lost', rivalName(g));
      pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Deal fell through: ${o.title}`, body: `${client} accepted, but we can no longer fly it (${res.error}). ${o.lostTo} stepped in.`, ref: { kind: 'offer', id: o.id } });
    }
    return;
  }
  o.counter.result = 'refused';
  if (late) {
    closeOffer(g, o, 'lost', rivalName(g));
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `Counter refused: ${o.title}`, body: `${client} said no and gave it to ${o.lostTo}.`, ref: { kind: 'offer', id: o.id } });
  } else {
    o.status = 'open';
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `Counter refused: ${o.title}`, body: `${client} won't move. The asking price stands until ${fmtDay(o.expires)} ${fmtTime(o.expires)} UTC.`, ref: { kind: 'offer', id: o.id } });
  }
}

export function fmtPrice(p: Product): string {
  if (p.kind === 'wet') return `$${p.ratePerBH.toLocaleString('en-US')}/BH`;
  if (p.kind === 'charter') return `$${p.price.toLocaleString('en-US')}`;
  return `$${p.rentPerMonth.toLocaleString('en-US')}/month`;
}

/** Daily: drop closed offers after 14 days (the "missed" list keeps them that long). */
export function dailyOffers(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    if (o.status === 'open' || o.status === 'countered') continue;
    o.closedAt ??= g.now;
    if (g.now - o.closedAt > 14 * DAY) delete g.offers[o.id];
  }
}
