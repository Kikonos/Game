// Offer generation per archetype and the offer lifecycle (B1). DESIGN.md §5.1.1–5.1.2.

import type { CabinLayout, RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { BROKERS } from '../../data/naming';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distance, distanceNm } from '../core/geo';
import { pushMessage } from '../core/messages';
import { cardMeta, offerFitCard } from '../problems';
import { requestPause } from '../core/pause';
import { blockMinutes, complement, etopsNeeded, planSector, typeOf } from '../core/perf';
import { dutyNeed } from '../crew/duties';
import { bunksFor, seatRest } from '../crew/restPlan';
import { schedule } from '../core/queue';
import { chance, int, next, pick, range, weightedPick } from '../core/rng';
import { DAY, dayIndex, fmtDay, fmtTime, fromUTC, localMinuteOfDay, toDate, toLocal } from '../core/time';
import { clamp } from '../core/util';
import type {
  AcRest, ApprovalId, Archetype, Client, ContractOffer, GameState, LegTemplate, Minute, OfferEffects, PaintKind, Product, Requirements, SchedulePattern, SimEvent,
} from '../core/types';
import { acceptOffer, closeOffer, setPrice } from './accept';
import { answerBy, counterBase, counterOdds, halfwayPrice, leftOf } from './counter';
import { feasibility, ulrNeed, type UlrNeed } from './feasibility';
import { adhocGroupClients, clientPrefix, clientsOf, isBigClub, isCruiseLine, isDiaspora, isGovernment, isMarineCrewing, isPilgrim, ministry, rivalFor } from './clients';
import * as F from './flavor';
import { paintTermsText, rollPaint, sideRng } from './paintTerms';
import { cabinTermsText, rollCabin } from './cabinTerms';
import { anchorsOf, computeWaves, localToUTC, programmeOf, route, routeMinutes, type ChainShape } from './plan';
import { ARCH_MULT, defaultSeats, isWetArchetype, priceProduct, productValue, referenceType, tripTickets } from './pricing';

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

/** Queues the next 'offer.spawn': gamma(3) gaps with the Poisson mean (steadier than exponential, same rate). */
export function scheduleNextOffer(g: GameState): void {
  const lambda = offerRate(g);
  let sum = 0;
  for (let i = 0; i < 3; i++) sum -= Math.log(Math.max(1e-9, next(g)));
  const gapDays = sum / (3 * lambda);
  schedule(g, g.now + Math.max(30, Math.round(gapDays * DAY)), 'offer.spawn');
}

/** The three hand-shaped opening offers (DESIGN §5.1.1): AOG cover < 24 h, ad hoc in 3–5 days, an April season base. */
export function openingOffers(g: GameState): void {
  // Each opener must be flyable by the starting fleet (one that isn't is re-drawn, up to 4 times).
  const opener = (make: () => ContractOffer | null) => {
    for (let i = 0; i < 4; i++) {
      const o = make();
      if (!o || Object.keys(g.fleet).some((id) => feasibility(g, o.id, id, { quick: true }).level !== 'no')) return;
      delete g.offers[o.id];
    }
  };
  opener(() => generateOffer(g, 'aogCover', { wide: false, window: false, start: g.now + int(g, 8, 20) * 60 }));
  opener(() => generateOffer(g, 'adhoc', { wide: false, window: false, start: g.now + int(g, 3, 5) * DAY + int(g, 0, 12) * 60, variant: 'group' }));
  const y = toDate(g.now).getUTCFullYear();
  const april = fromUTC(y, 4, int(g, 1, 12));
  opener(() => generateOffer(g, 'seasonBase', { wide: false, window: false, start: april > g.now + 14 * DAY ? april : g.now + 30 * DAY }));
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
  /** v0.5.1 client paint: false = never; true = roll as usual; a kind = force a request of that kind (tests, dev helper). */
  paint?: boolean | { kind: PaintKind; required?: boolean };
  /** v0.7.4 client cabin: false = never; a layout = force a request for it (tests, dev helper). */
  cabin?: false | { layout: CabinLayout; required?: boolean; share?: number; revert?: boolean };
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
  req: { minSeats: number; maxSeats?: number; layout?: CabinLayout; families?: RatingFamily[]; extraCabin: number; noTechStops?: boolean; approvals: ApprovalId[]; /** v0.7 */ layouts?: CabinLayout[]; minPremium?: number };
  start: Minute;
  end: Minute;
  /** Minutes from now until the offer lapses (clamped before the start). */
  expiresIn: number;
  /** v0.5.1: OfferOpts.paint passed through. */
  paint?: OfferOpts['paint'];
  /** v0.7.4: OfferOpts.cabin passed through. */
  cabin?: OfferOpts['cabin'];
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

/** 'today', 'tomorrow' or the date, in the airport's local calendar. */
function whenDay(code: string, now: Minute, t: Minute): string {
  const d = dayIndex(toLocal(code, t)) - dayIndex(toLocal(code, now));
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${fmtDay(toLocal(code, t))}`;
}

/** Whole days of the idle window left after `from` (Infinity without a window). */
const roomDays = (ctx: Ctx, from: Minute) => (ctx.window ? Math.floor((ctx.window.to - from) / DAY) : Infinity);

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

/**
 * Clients weighted towards the idle window's location (follow-on work) or our home base, and (v0.6) by how
 * satisfied they are with us: × (1 + relation/100), a soured client still calls now and then.
 */
function nearClient(ctx: Ctx, list: Client[]): Client | undefined {
  const at = ctx.window?.at ?? ctx.g.company.homeBase;
  if (ctx.o.client) return list.find((c) => c.id === ctx.o.client) ?? ctx.g.clients[ctx.o.client];
  const rel = (c: Client) => Math.max(0.2, 1 + (ctx.g.clients[c.id]?.relation ?? c.relation ?? 0) / 100);
  return weightedPick(ctx.g, list, (c) => (km(c.base, at) < 1500 ? 4 : km(c.base, at) < 3500 ? 2 : 1) * rel(c));
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
  // v0.5.1: a few season deals are long (4–8 months, planned a month or more ahead); most clients want them in their colours.
  // Rolled on a side stream (seed + time + id counter) so the main RNG sequence is unchanged by v0.5.1.
  const long = !o.days && (o.start === undefined || o.start - g.now >= 30 * DAY) && chance(sideRng(g, `long:${g.seq}:${g.now}`), BAL.paint.longBaseShare);
  let days = o.days ?? (long ? int(g, 120, 240) : int(g, 30, 92));
  // Gap-fit: shorten the season to the idle window (but never under a month).
  if (!o.days && ctx.window) days = Math.min(days, roomDays(ctx, Math.max(ctx.window.from, g.now + 14 * DAY)) - 2);
  if (days < 30) return null;
  // Long-haul bases are planned months ahead (time to lease a widebody and hire rated crew).
  let s = o.start ?? (wide ? pickStart(ctx, 75 * DAY, 150 * DAY, (days + 1) * DAY) : pickStart(ctx, long ? 30 * DAY : 14 * DAY, long ? 90 * DAY : 60 * DAY, (days + 1) * DAY));
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
    // One airport per city (no "Paris and Paris").
    const byCity = new Map<string, Airport>();
    for (const a of pool) if (!byCity.has(a.city) || byCity.get(a.city)!.size < a.size) byCity.set(a.city, a);
    dests = pickN(g, [...byCity.values()], n, (a) => a.tour * (1 + a.size)).map((a) => a.code);
  }
  if (dests.length < (wide || o.dests ? 1 : 3)) return null;
  const minSeats = wide ? pick(g, [250, 260, 280]) : pick(g, [168, 174, 180]);
  const layout: CabinLayout | undefined = wide ? 'two-class' : chance(g, ctx.aspire ? 0.3 : 0.05) ? 'two-class' : chance(g, 0.85) ? 'all-economy' : undefined;
  const families: RatingFamily[] | undefined = !wide && chance(g, 0.25) ? [chance(g, ctx.aspire ? 0.5 : 0.88) ? 'A320' : 'B737'] : undefined;
  // v0.7: season bases take the everyday cabins (no VIP); widebodies two- or three-class.
  const layouts: CabinLayout[] = wide ? ['two-class', 'three-class'] : layout ? [layout] : ['all-economy', 'two-class'];
  const req = { minSeats, layout, layouts, families, extraCabin: 0, approvals: [] as ApprovalId[] };
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
    title: titleFor(ctx, 'seasonBase', client, { from: base, to: base, n: days, wide, start: from }, wide ? `Long-haul base at ${city(base)}` : days >= 120 ? `Long-term base at ${city(base)}` : `${season} base at ${city(base)}`),
    blurb:
      `${client.name} wants ${fam} (${seatsText(minSeats, layout)}) based at ${base} from ${fmtDay(toLocal(base, from))} to ${fmtDay(toLocal(base, to - 1))}, ` +
      `flying to ${listCities(dests)}: ${waves.length} wave${waves.length > 1 ? 's' : ''} a day from 06:00 local and a maintenance night every 7 days. ` +
      `MGH ${mgh} BH a month; they plan about ${targetBH}. ${base === g.company.homeBase ? 'Crews fly from home; no hotels needed.' : `Crews live in ${city(base)} hotels at the client's cost.`}`,
    pattern: { kind: 'base', base, dests, from, to, targetBH, waves, prefix: clientPrefix(client.name), maintEvery: 7 },
    req, start: from, end: to,
    expiresIn: range(g, 4, 8) * DAY,
    // Four months and more: half the long-term discount (RESEARCH §4.2; multi-year deals get all of it).
    mult: days >= 120 ? 1 + BAL.premium.longTerm / 2 : undefined,
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
  let start = o.start ?? Math.ceil((g.now + int(g, 2, 24) * 60) / 60) * 60;
  if (o.start === undefined) {
    // Cover starts with the client's first bank: never between 22:00 and 05:00 local.
    const lm = localMinuteOfDay(base, start);
    if (lm >= 22 * 60) start = atLocal(base, start + DAY, 5 * 60);
    else if (lm < 5 * 60) start = atLocal(base, start, 5 * 60);
  }
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
    title: titleFor(ctx, 'aogCover', client, { from: base, to: base, n: days, wide, start, type: typeOf(ref).short }, `AOG cover at ${city(base)}`),
    blurb:
      `${client.name} has an aircraft grounded at ${base} after ${pick(g, F.AOG_CAUSES)}. They need cover from ${fmtTime(start, base)} local ` +
      `${whenDay(base, g.now, start)} for ${days} days, flying their schedule to ${listCities(dests)}. Premium rate, MGH ${perDay} BH a day; ` +
      `positioning is billable, so the sooner we're there the better.`,
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
  const s = o.start ?? pickStart(ctx, 3 * DAY, 30 * DAY, 2 * DAY);
  // Days the aircraft can stay away inside the idle window (round trips shrink to fit, else go one way).
  const maxBack = Math.min(7, roomDays(ctx, s ?? 0) - 1);
  if (s === null) return null;
  if (variant === 'diaspora') {
    client = nearClient(ctx, clientsOf(g, ['agency', 'tourOperator'], (c) => isDiaspora(c) && !!AIRPORT_BY_CODE[c.base]));
    if (!client) return null;
    const dz = F.DIASPORA_BY_CLIENT[client.name];
    const home = client.base;
    const dest = o.airport ?? pick(g, (dz?.dests ?? F.DIASPORA).filter((c) => AIRPORT_BY_CODE[c] && c !== home));
    const back = Math.min(int(g, 4, 7), maxBack);
    if (!dest || back < 2) return null;
    legs = roundTrip(g, home, dest, s, back, pax);
    title = `Diaspora charter ${home}–${dest}`;
    blurb = pick(g, F.DIASPORA_BLURBS)({ client: client.name, dest: city(dest), reason: pick(g, dz?.reasons ?? F.DIASPORA_REASONS), day: fmtDay(legs[0].dep), back });
  } else if (variant === 'pilgrimage') {
    client = nearClient(ctx, clientsOf(g, ['agency'], (c) => isPilgrim(c) && !!AIRPORT_BY_CODE[c.base]));
    if (!client) return null;
    // The operator flies its own pilgrims from home to a shrine (Fátima via Lisbon, Lourdes, Medjugorje via Split).
    const from = o.airport ?? client.base;
    const shrine = pick(g, F.SHRINES.filter((x) => AIRPORT_BY_CODE[x.code] && x.code !== from && km(from, x.code) > 400));
    const back = Math.min(int(g, 3, 5), maxBack);
    if (!shrine || back < 2) return null;
    legs = roundTrip(g, from, shrine.code, s, back, pax);
    title = `Pilgrimage ${city(from)}–${shrine.place}`;
    blurb = `${client.name} is bringing a parish group from ${city(from)} to ${shrine.place}, ${shrine.note}. Out ${fmtDay(legs[0].dep)}, home ${back} days later.`;
  } else if (variant === 'music') {
    client = nearClient(ctx, clientsOf(g, ['music']));
    if (!client || maxBack < 7) return null;
    // European leg of the tour (no US domestic cabotage): from a hub near home, hopping between big European cities.
    const eu = (a: Airport) => a.continent === 'EU' && a.size >= 3;
    const startAp = AIRPORT_BY_CODE[client.base]?.continent === 'EU' ? client.base : pick(g, ['LHR', 'AMS', 'CDG', 'FRA', 'MAD'].filter((c) => AIRPORT_BY_CODE[c]));
    const pts = [startAp];
    for (let i = 0; i < 3; i++) {
      const nx = weightedPick(g, airportsWithin(pts[i], 400, 2200, (a) => eu(a) && !pts.includes(a.code) && a.city !== city(pts[i])), (a) => a.size);
      if (!nx) return null;
      pts.push(nx.code);
    }
    pax = int(g, 90, 140);
    let t = atLocal(pts[0], s, pick(g, F.DEP_SLOTS.slice(3)));
    legs = [];
    for (let i = 0; i < 3; i++) {
      legs.push({ from: pts[i], to: pts[i + 1], dep: t, flightNo: '', pax });
      t = atLocal(pts[i + 1], t + int(g, 2, 3) * DAY, pick(g, F.DEP_SLOTS.slice(4)));
    }
    title = `Tour hops for ${client.name.replace(/"/g, '')}`.replace('Tour hops for The', 'Tour hops for the');
    blurb = `${client.name}: band, crew and 14 tonnes of kit hopping ${listCities(pts)} over a week, one-way legs the morning after each show. Expect late load-outs and a picky rider.`;
  } else if (variant === 'oneway') {
    client = nearClient(ctx, clientsOf(g, ['agency'], (c) => isMarineCrewing(c) && !!AIRPORT_BY_CODE[c.base]));
    if (!client) return null;
    if (isCruiseLine(client)) {
      const ports = ['BCN', 'PMI', 'VCE', 'ATH', 'LPA', 'FNC', 'MLA', 'NAP', 'CPH', 'SOU', 'MRS', 'CIV', 'LIS'].filter((c) => AIRPORT_BY_CODE[c]);
      const dest = o.airport ?? pick(g, ports);
      const from = pick(g, ports.filter((c) => c !== dest));
      legs = roundTrip(g, from, dest, s, null, pax);
      title = `Cruise crew change ${city(from)}–${city(dest)}`;
      blurb = `${client.name} swaps ${pax} crew of a cruise ship: they board in ${city(from)} and must meet the ship in ${city(dest)} on ${fmtDay(legs[0].dep)}. One way; the aircraft comes back empty. The ship sails without them if we're late.`;
    } else {
      // Ship managers: seafarers for several cargo and tanker ships calling at one port.
      const port = (o.airport && F.SHIP_PORTS.find((x) => x.code === o.airport)) || pick(g, F.SHIP_PORTS.filter((x) => AIRPORT_BY_CODE[x.code]));
      const from = pick(g, F.SEAFARER_HUBS.filter((c) => AIRPORT_BY_CODE[c] && c !== port.code && km(c, port.code) > 400 && (wide || km(c, port.code) < 4000)));
      if (!from) return null;
      pax = int(g, 60, 120);
      legs = roundTrip(g, from, port.code, s, null, pax);
      title = `Crew change ${city(from)}–${port.port}`;
      blurb = `${client.name} has crew changes for ${int(g, 2, 5)} vessels calling at ${port.port}: ${pax} seafarers fly ${city(from)}–${city(port.code)} on ${fmtDay(legs[0].dep)} to sign on. One way; the relieved crews go home on scheduled flights and we come back empty. Ships pay port time by the hour, so nobody waits for us.`;
    }
  } else {
    // Groups fit their clients (film crews for BBC Studios, never a trade fair for F1) and their aircraft size.
    const groups = F.ADHOC_GROUPS.filter((x) => (!wide || x.wide !== false) && adhocGroupClients(g, x).length);
    if (!groups.length) return null;
    const group = pick(g, groups);
    client = nearClient(ctx, adhocGroupClients(g, group));
    if (!client) return null;
    if (group.pax && !wide) pax = int(g, ...group.pax);
    const pool = wide
      ? airportsWithin(client.base, 5000, 9000, (a) => a.tour >= 0.7 && F.groupDestOk(group, a))
      : airportsWithin(client.base, 600, 3500, (a) => (a.tour >= 0.6 || a.size >= 4 || !!group.dests) && F.groupDestOk(group, a));
    const dest = o.airport ?? weightedPick(g, pool, (a) => a.tour + a.size / 5)?.code;
    if (!dest) return null;
    const oneWay = chance(g, 0.2) || maxBack < 1;
    const back = Math.max(1, Math.min(int(g, ...(group.back ?? [2, 6])), maxBack));
    legs = roundTrip(g, client.base, dest, s, oneWay ? null : back, pax);
    const what = group.what.replace(/^an? /, '');
    title = `${what[0].toUpperCase()}${what.slice(1)} to ${city(dest)}`;
    blurb = pick(g, F.ADHOC_BLURBS)({ client: client.name, what: group.what, pax, from: client.base, to: dest, day: fmtDay(legs[0].dep), back: oneWay ? null : back });
  }
  const broker = chance(g, 0.45) ? pick(g, BROKERS) : undefined;
  const last = legs[legs.length - 1];
  // v0.7: pilgrimages fill every seat (all-economy, NB 180+ / WB 300+).
  const pilgrim = variant === 'pilgrimage';
  return {
    archetype: 'adhoc', client, broker, title, blurb,
    pattern: { kind: 'legs', legs },
    req: pilgrim
      ? { minSeats: wide ? 300 : 180, layouts: ['all-economy'], extraCabin: 0, approvals: [] }
      : { minSeats: Math.ceil(pax / 10) * 10 - (wide ? 0 : 5), extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 6 * 60,
    expiresIn: range(g, 2.5, 5) * DAY,
    effects: {},
    risk: { disruption: 0.15, politics: 0, permit: 0 },
    hook: hookFor(ctx),
  };
}

/**
 * v0.7 (§F7.3): 55% of sports work wants a premium cabin (two-class, three-class or VIP; NB 12+ / WB 20+ premium
 * seats) at +10%; with ETOPS 240 held or pending, 30% of widebody tours become nonstop ultra-long-range trips.
 */
function sports(ctx: Ctx): Draft | null {
  const d = sportsBase(ctx);
  if (!d) return null;
  const r = sideRng(ctx.g, `prem:${ctx.g.seq}:${ctx.g.now}`);
  if (chance(r, 0.55)) {
    d.req.layouts = ['two-class', 'three-class', 'vip'];
    d.req.minPremium = ctx.wide ? 20 : 12;
    d.mult = (d.mult ?? ARCH_MULT.sports ?? 1) * 1.1;
    d.blurb = `${d.blurb} They want a premium cabin (${d.req.minPremium}+ business seats).`;
  }
  if (ctx.wide) prestige(ctx, d, r);
  return d;
}

/**
 * A nonstop ultra-long-range destination 7,000–8,500 nm from `home` (big cities only) that a crew can legally fly out
 * at `out` and back `backDays` later at 22:00 local (ulrNeed), or null when none qualifies from there.
 */
function ulrDest(g: GameState, home: string, out: Minute, backDays: number): { code: string; back: Minute; need: UlrNeed } | null {
  const pool: { code: string; back: Minute; need: UlrNeed }[] = [];
  for (const a of AIRPORTS) {
    if (a.size < 4 || AIRPORT_BY_CODE[a.code].runwayM < 3000) continue;
    const nm = distanceNm(home, a.code);
    if (nm < 7000 || nm > 8500) continue;
    const back = atLocal(a.code, out + backDays * DAY, 22 * 60);
    const need = ulrNeed(g, home, a.code, out, back);
    if (need) pool.push({ code: a.code, back, need });
  }
  return pool.length ? pick(sideRng(g, `ulr:${g.seq}:${home}`), pool) : null;
}

/** ULR prestige (§F7.4): with ETOPS 240 held or pending, 30% of widebody VIP and sports trips fly nonstop beyond 7,000 nm. */
function prestige(ctx: Ctx, d: Draft, r: { rng: number }): void {
  const { g } = ctx;
  const etops240 = g.company.approvals.includes('etops240') || g.company.pendingApprovals.some((p) => p.id === 'etops240');
  if (!etops240 || d.pattern.kind !== 'legs' || !chance(r, 0.3)) return;
  const legs = d.pattern.legs;
  const home = legs[0].from;
  const backDays = Math.max(3, Math.round((legs[legs.length - 1].dep - legs[0].dep) / DAY));
  const out = legs[0].dep;
  // v0.7.3 only destinations a crew can legally fly (EASA: 18:00 at most, 4 pilots, bunks for both crews).
  const pickd = ulrDest(g, home, out, backDays);
  if (!pickd) return;
  const far = pickd.code;
  d.pattern = { kind: 'legs', legs: [{ from: home, to: far, dep: out, flightNo: '', pax: legs[0].pax }, { from: far, to: home, dep: pickd.back, flightNo: '', pax: legs[0].pax }] };
  d.req.noTechStops = true;
  d.req.approvals = [...new Set([...d.req.approvals, 'ulr' as ApprovalId])];
  d.mult = (d.mult ?? ARCH_MULT[d.archetype] ?? 1) * 1.25;
  d.title = `Nonstop to ${city(far)}`;
  const pilots = pickd.need.need.mode === 'aug1' ? 'three pilots' : 'four pilots';
  d.blurb = `${d.blurb} Prestige long haul: nonstop ${home}–${far} and back (${Math.round(distanceNm(home, far)).toLocaleString('en-US')} nm), ${pilots} with bunks for pilots and cabin crew, ultra-long-range approval required.`;
  d.end = d.pattern.legs[1].dep + 18 * 60;
  d.pin = far;
}

function sportsBase(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  // Only big clubs fly widebody pre-season tours.
  const client = nearClient(ctx, clientsOf(g, ['sports'], (c) => !!AIRPORT_BY_CODE[c.base] && (!wide || isBigClub(c))));
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
      start: legs[0].dep, end: legs[1].dep + 12 * 60, expiresIn: range(g, 3, 6) * DAY, effects: { morale: 2 },
      risk: { disruption: 0.2, politics: 0, permit: 0 }, hook: hookFor(ctx),
    };
  }
  // League games stay in the country; cup ties and European nights go abroad.
  const ctry = AIRPORT_BY_CODE[home]?.country;
  const domestic = airportsWithin(home, 250, 3500, (a) => a.country === ctry && a.size >= 2 && a.runwayM >= 2400);
  const abroad = airportsWithin(home, 500, 3500, (a) => a.country !== ctry && a.continent === 'EU' && a.size >= 3 && a.runwayM >= 2400);
  const league = domestic.length >= trips && chance(g, season ? 0.8 : 0.55);
  const aways = o.airport ? [o.airport] : pickN(g, league ? domestic : abroad, trips, (a) => a.size).map((a) => a.code);
  if (aways.length < trips) return null;
  const titles = league ? F.SPORT_TITLES_HOME.filter((t) => !t.startsWith('Short') || km(home, aways[0]) < 700) : F.SPORT_TITLES_ABROAD;
  for (let i = 0; i < trips; i++) {
    const match = s + DAY + i * every * DAY;
    legs.push({ from: home, to: aways[i], dep: atLocal(home, match - DAY, int(g, 22, 32) * 30), flightNo: '', pax });
    legs.push({ from: aways[i], to: home, dep: atLocal(aways[i], match, 23 * 60), flightNo: '', pax });
  }
  const last = legs[legs.length - 1];
  return {
    archetype: 'sports', client,
    title: season ? `${league ? 'League' : 'European'} away package: ${trips} trips` : `${pick(g, titles)} ${city(aways[0])}`,
    blurb: season
      ? `${client.name} want one operator for their next ${trips} away games (${listCities(aways)}), roughly every ${every} days. Out the day before, back after the match at 23:00 local. Two extra cabin crew.`
      : `${client.name} play in ${city(aways[0])} on ${fmtDay(legs[1].dep)}. Out the day before, back straight after the match at 23:00 local; extra time can push it. Two extra cabin crew for the team service.`,
    pattern: { kind: 'legs', legs },
    req: { minSeats: Math.max(120, Math.ceil(pax / 10) * 10), extraCabin: 2, approvals: [] },
    start: legs[0].dep, end: last.dep + 6 * 60,
    expiresIn: range(g, 3, 6) * DAY,
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
    title: titleFor(ctx, 'repatriation', client, { from: crisis, to: home, n, start: legs[0].dep }, n > 1 ? `Repatriation airlift from ${city(crisis)}` : `Repatriation from ${city(crisis)}`),
    blurb:
      `${city(crisis)}: ${pick(g, F.crisisLines(crisis))}. The ${client.name} needs ${n === 1 ? 'a flight' : `${n} flights`} ${crisis}–${home} for about ${pax} citizens, ` +
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

/** v0.7.2 F4: a flavoured title for the draft's archetype (side RNG: the offer stream is unchanged), never the client's last. */
function titleFor(ctx: Ctx, arch: string, client: Client, x: Omit<F.TitleCtx, 'client' | 'brand' | 'fromCity' | 'toCity' | 'season' | 'month'> & { start: Minute }, fallback: string): string {
  const { g } = ctx;
  const tc: F.TitleCtx = {
    ...x, client: client.name, brand: F.brandOf(client.name), fromCity: city(x.from), toCity: city(x.to), season: F.seasonOf(x.start, x.to), month: F.monthOf(x.start),
    nation: x.nation ?? F.NATIONS[client.country],
  };
  return F.pickTitle(sideRng(g, `title:${g.seq}:${g.now}:${arch}`), F.TITLES[arch], tc, g.clients[client.id]?.lastTitle, fallback);
}

function tourSeries(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  const ops = clientsOf(g, ['tourOperator'], (c) => !!AIRPORT_BY_CODE[c.base]);
  let client = nearClient(ctx, ops);
  if (!client) return null;
  // v0.7.2 widebody programmes go to tour operators that fly long-haul (side RNG: the offer stream is unchanged).
  if (wide && !o.client && !F.longHaulBrand(client.name)) {
    const lh = ops.filter((c) => F.longHaulBrand(c.name));
    if (lh.length) client = pick(sideRng(g, `lh:${g.seq}:${g.now}`), lh);
  }
  const base = client.base;
  const resorts = (wide ? F.RESORTS_WB : F.RESORTS_NB).filter((c) => {
    if (!AIRPORT_BY_CODE[c] || c === base) return false;
    const d = km(base, c);
    return wide ? d > 5000 : d > 700 && d < 4300;
  });
  let resort = o.airport ?? pick(g, resorts);
  if (!resort) return null;
  let n = o.rotations ?? int(g, 4, 12);
  if (!o.rotations && ctx.window) n = Math.min(n, Math.floor(roomDays(ctx, Math.max(ctx.window.from, g.now + 30 * DAY)) / 7));
  if (n < 3) return null;
  const s = o.start ?? pickStart(ctx, 30 * DAY, 120 * DAY, n * 7 * DAY);
  if (s === null) return null;
  // v0.7.2 winter programmes sometimes go to the snow (side RNG: the offer stream is unchanged).
  const mo = toDate(s).getUTCMonth();
  if (!o.airport && !wide && (mo === 11 || mo <= 2)) {
    const r = sideRng(g, `ski:${g.seq}:${g.now}`);
    const ski = F.RESORTS_SKI.filter((c) => AIRPORT_BY_CODE[c] && c !== base && km(base, c) > 500 && km(base, c) < 2500);
    if (ski.length && chance(r, 0.35)) resort = pick(r, ski);
  }
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
    title: titleFor(ctx, 'tourSeries', client, { from: base, to: resort, n, wide, start: legs[0].dep }, `${client.name} series ${base}–${resort}`),
    blurb: pick(g, F.TOUR_SERIES_BLURBS)({ client: client.name, n, wd, first: fmtDay(legs[0].dep), last: fmtDay(last.dep), out: fmtTime(legs[0].dep, base) }),
    pattern: { kind: 'legs', legs },
    req: { minSeats: wide ? 250 : Math.min(180, Math.ceil(pax / 10) * 10), extraCabin: 0, approvals: [], noTechStops: true },
    start: legs[0].dep, end: last.dep + block,
    expiresIn: range(g, 4, 8) * DAY,
    effects: {},
    risk: { disruption: 0.1, politics: 0, permit: 0 },
    pin: resort,
    hook: hookFor(ctx),
  };
}

function troopRotation(ctx: Ctx): Draft | null {
  const { g, wide, o } = ctx;
  // v0.5.1: some rotations fly peacekeepers for the UN (they may want UN titles on the aircraft).
  const un = !o.client && chance(sideRng(g, `un:${g.seq}:${g.now}`), 0.3) ? Object.values(g.clients).find((c) => /^UN Department of Peace/.test(c.name)) : undefined;
  const client = (o.client && g.clients[o.client]) || un || ministry(g, 'Defence');
  if (!client) return null;
  const home = g.company.homeBase;
  const mission = o.airport ?? pick(g, F.MISSION_AIRPORTS.filter((c) => AIRPORT_BY_CODE[c] && c !== home));
  const n = o.rotations ?? int(g, 2, 4);
  let spanDays = o.days ?? int(g, 30, 90);
  if (!o.days && ctx.window) spanDays = Math.min(spanDays, roomDays(ctx, Math.max(ctx.window.from, g.now + 30 * DAY)) - 2);
  if (spanDays < 14) return null;
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
  // v0.7.2 the UN names only its own missions; a ministry flies to any (a national contingent).
  const ms = F.MISSION_NAMES[mission] && (!un || F.MISSION_NAMES[mission].org === 'UN') ? F.MISSION_NAMES[mission] : undefined;
  return {
    archetype: 'troopRotation', client,
    title: titleFor(ctx, un ? 'unRotation' : 'troopRotation', client, { from: home, to: mission, n, start: legs[0].dep, event: ms?.name, pk: ms?.pk }, un ? `UN rotation to ${city(mission)}` : `Troop rotation to ${city(mission)}`),
    blurb: `${client.name}: ${n} rotations ${home}–${mission} ${pick(g, F.MISSIONS)}, every ${step || 1} days or so from ${fmtDay(legs[0].dep)}. Night-stop at ${mission}, security-vetted crew, payment in arrears.`,
    pattern: { kind: 'legs', legs },
    // v0.7: max seats (NB 174+ / WB 300+); the UN wants all-economy.
    req: { minSeats: wide ? 300 : 174, ...(un ? { layouts: ['all-economy'] as CabinLayout[] } : {}), extraCabin: 0, approvals: [] },
    start: legs[0].dep, end: last.dep + 8 * 60,
    expiresIn: range(g, 5, 10) * DAY,
    effects: { morale: 2, clean: -1 },
    risk: { disruption: 0.3, politics: 0.4, permit: r2(range(g, 0.3, 0.8)) },
    dueDays: 45,
    pin: mission,
    hook: hookFor(ctx),
  };
}

const VIP_KINDS = [['government', 0.4], ['corporate', 0.4], ['music', 0.2]] as const;

/**
 * v0.7 VIP work (§F7.4): a head-of-state or ministerial delegation, a corporate client or a music act; 1–3 round
 * trips over 2–10 days, 60–140 passengers, 2–4 extra cabin crew. A VIP cabin (corporate: VIP, two- or three-class
 * with 24+ premium seats), +35%. Narrowbody within 3,000 km; widebody long haul when aspirational or unlocked.
 */
function vip(ctx: Ctx): Draft | null {
  const { g, o } = ctx;
  const wideOk = ctx.aspire || g.company.approvals.includes('widebody') || g.company.pendingApprovals.some((p) => p.id === 'widebody');
  const wide = ctx.wide && wideOk;
  const kind = weightedPick(g, VIP_KINDS, ([, w]) => w)![0];
  const client = nearClient(ctx, clientsOf(g, [kind], (c) => !!AIRPORT_BY_CODE[c.base]));
  if (!client) return null;
  const home = client.base;
  const n = int(g, 1, 3);
  const span = Math.max(n * 2, int(g, 2, 10));
  const s = o.start ?? pickStart(ctx, 5 * DAY, 45 * DAY, span * DAY);
  if (s === null) return null;
  const pool = wide ? airportsWithin(home, 4500, 9000, (a) => a.size >= 4) : airportsWithin(home, 500, 3000, (a) => a.size >= 3 && a.runwayM >= 2200);
  const dests = o.dests ?? pickN(g, pool, n, (a) => a.size + a.biz * 3).map((a) => a.code);
  if (dests.length < n) return null;
  const pax = wide ? int(g, 80, 140) : int(g, 60, 110);
  const legs: LegTemplate[] = [];
  const per = Math.floor(span / n);
  for (let i = 0; i < n; i++) legs.push(...roundTrip(g, home, dests[i], s + i * per * DAY, Math.max(1, per - 1), pax));
  const last = legs[legs.length - 1];
  const gov = kind === 'government';
  const corporate = kind === 'corporate';
  const what = gov ? pick(g, ['a head-of-state delegation', 'a ministerial delegation', 'a state visit']) : corporate ? pick(g, ['a board roadshow', 'an investor roadshow', 'a leadership offsite']) : 'the band, crew and guests';
  const d: Draft = {
    archetype: 'vip', client,
    title: gov ? `State visit${n > 1 ? 's' : ''}: ${listCities(dests)}` : corporate ? `Roadshow: ${listCities(dests)}` : `VIP tour flights: ${listCities(dests)}`,
    blurb: `${client.name}: ${what} of ${pax}, ${n === 1 ? `a round trip to ${city(dests[0])}` : `${n} round trips (${listCities(dests)})`} from ${fmtDay(legs[0].dep)}. ${gov || !corporate ? 'A VIP cabin' : 'A VIP or business-heavy cabin (24+ premium seats)'}, ${pick(g, ['silver service', 'a chef on board', 'discreet handling'])}, extra cabin crew.`,
    pattern: { kind: 'legs', legs },
    req: corporate
      ? { minSeats: Math.ceil(pax / 10) * 10 - 10, layouts: ['vip', 'two-class', 'three-class'], minPremium: 24, extraCabin: int(g, 2, 4), approvals: [] }
      : { minSeats: Math.ceil(pax / 10) * 10 - 10, layouts: ['vip'], extraCabin: int(g, 2, 4), approvals: [] },
    start: legs[0].dep, end: last.dep + 8 * 60,
    expiresIn: range(g, 3, 7) * DAY,
    effects: { clean: 1, reliable: 1 },
    risk: { disruption: 0.15, politics: gov ? 0.2 : 0, permit: gov ? 0.1 : 0 },
    dueDays: gov ? 30 : undefined,
    hook: hookFor(ctx),
  };
  if (wide) prestige(ctx, d, sideRng(g, `vipulr:${g.seq}:${g.now}`));
  return d;
}

const BUILDERS: Partial<Record<Archetype, (ctx: Ctx) => Draft | null>> = { seasonBase, aogCover, adhoc, sports, repatriation, tourSeries, troopRotation, vip };

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
    // v0.7: VIP work, twice as often once we fly a VIP cabin.
    ['vip', Object.values(g.fleet).some((a) => a.cabin.layout === 'vip') ? 0.08 : 0.04],
  ];
}

/** Per archetype: lead from now to start [min, max] and the room it needs inside a window, in days. */
const WINDOW_FIT: Partial<Record<Archetype, [number, number, number]>> = {
  seasonBase: [14, 60, 32], aogCover: [0.08, 1, 2], repatriation: [1, 3, 2], adhoc: [3, 30, 2], sports: [7, 60, 2.5], troopRotation: [30, 90, 16], tourSeries: [30, 120, 21],
  vip: [5, 45, 3],
};

/** Archetypes that can live inside an idle window (its start reachable within the lead, enough room after it). */
function fitsWindow(a: Archetype, w: IdleWindow, now: Minute): boolean {
  const f = WINDOW_FIT[a];
  if (!f) return false;
  const from = Math.max(w.from, now + f[0] * DAY);
  return from <= now + f[1] * DAY && (w.to - from) / DAY >= f[2];
}

// ---------- finalise ----------

function finalize(g: GameState, d: Draft, aspire: boolean): ContractOffer | null {
  const home = g.company.homeBase;
  // One live request per client and kind of job.
  if (Object.values(g.offers).some((x) => x.clientId === d.client.id && x.archetype === d.archetype && (x.status === 'open' || x.status === 'countered'))) return null;
  const p = d.pattern;
  const sectors: [string, string][] = p.kind === 'base' ? p.dests.flatMap((x) => [[p.base, x], [x, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
  const ref = referenceType(d.req, sectors, p.kind === 'base', d.req.approvals.includes('ulr'));
  if (!ref) return null;
  const airports = [...new Set(sectors.flat())];
  const requirements: Requirements = {
    minSeats: d.req.minSeats, maxSeats: d.req.maxSeats, layout: d.req.layout, body: typeOf(ref).body, families: d.req.families,
    ...(d.req.layouts ? { layouts: d.req.layouts } : {}), ...(d.req.minPremium ? { minPremium: d.req.minPremium } : {}),
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
  // Everyday work must also be flyable without ETOPS on a type we operate (its own fuel-stop routing).
  const fleetTypes = [...new Set(Object.values(g.fleet).map((a) => a.typeId))];
  if (!aspire && fleetTypes.length && fleetTypes.every((ft) => sectors.some(([a, b]) => planSector(ft, a, b).legs.some((l) => etopsNeeded(ft, l.from, l.to) > etopsHeld)))) return null;
  // Estimates on the reference type: revenue hours plus empty legs from and back to our home base.
  let emptyMin = prog.emptyMin;
  let deps = prog.trips.reduce((s, t) => s + t.legs.length, 0) || (prog.base?.rotations ?? 0) * 2;
  const revDeps = prog.trips.reduce((s, t) => s + t.legs.filter((l) => l.kind !== 'positioning').length, 0);
  const { aug, extraCabin: restCabin } = chainAugment(g, ref, prog.chains);
  const crewN = complement(ref, defaultSeats(ref), { extraCabin: d.req.extraCabin, augment: aug, restCabin }).length;
  let roomNights = 0;
  let crewDays = 0;
  let tickets = 0;
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
    const far = t.legs.reduce((m, l) => (distanceNm(home, l.to) > distanceNm(home, m) ? l.to : m), t.from);
    tickets += tripTickets(home, far, crewN, span + 90, span);
  }
  const revBH = prog.revenueMin / 60;
  const wet = isWetArchetype(d.archetype);
  const gov = isGovernment(d.client);
  const product: Product = priceProduct(g, {
    archetype: d.archetype, typeId: ref, estBH: wet ? revBH : revBH + emptyMin / 60, start: d.start, end: d.end, lead: d.start - g.now,
    mult: d.mult, departures: deps, revDepartures: revDeps, roomNights, crewDays, tickets, government: gov, mghPerMonth: d.mghPerMonth,
    loyalty: clamp(g.clients[d.client.id]?.relation ?? d.client.relation ?? 0, -100, 100) * BAL.morale.service.relationPremium,
  });
  // v0.7.3 heavy crews cost more: a wet rate +3 % when the longest chain needs 3 pilots on the type it was sized
  // for, +6 % for 4 (that type's usual rest facilities).
  if (product.kind === 'wet' && aug) product.ratePerBH = Math.round(product.ratePerBH * (1 + (BAL.v073.augRate[aug] ?? 0)));
  // ... and the extra cabin crew its rest plan adds are billed like client-requested ones (RESEARCH §4.3).
  if (product.kind === 'wet' && restCabin) product.ratePerBH += BAL.crewExtra.paidPerBH * restCabin;
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
  // v0.5.1: the client may want the aircraft in its colours for the term.
  const paint = d.paint === false ? undefined : rollPaint(g, o, d.paint === true ? undefined : d.paint);
  if (paint) {
    o.paint = paint;
    o.blurb = `${o.blurb} ${paintTermsText(paint)}`;
  }
  // v0.7.4: long work may come with a cabin the client wants (a quick reconfiguration at their expense).
  const cabin = d.cabin === false ? undefined : rollCabin(g, o, ref, d.cabin);
  if (cabin) {
    o.cabin = cabin;
    o.blurb = `${o.blurb} ${cabinTermsText(cabin, ref)}`;
  }
  // v0.6: some clients pay for extra cabin crew above their requirement: long sectors on ad hoc, tour series and
  // troop rotations, VIP, season bases and long wet leases ($75 per crew member per block hour, as a rate uplift or,
  // on a charter, over its billable hours including positioning). Sports require theirs (priced in).
  const X = BAL.crewExtra;
  const longSector = sectors.some(([a, b]) => blockMinutes(ref, a, b) >= X.longBlockMin);
  const a = d.archetype;
  const pc = a === 'sports' ? X.paidChanceSports
    : a === 'vip' ? X.paidChanceVip
    : longSector && (a === 'adhoc' || a === 'tourSeries' || a === 'troopRotation') ? X.paidChanceLong
    : product.kind === 'wet' && (a === 'seasonBase' || a === 'capacityLease') && d.end - d.start >= X.wetMinDays * DAY ? X.paidChanceWet : 0;
  const basis = product.kind === 'wet' ? product.ratePerBH : product.kind === 'charter' ? product.price / Math.max(1, revBH + emptyMin / 60) : 0;
  if (pc > 0 && basis > 0 && chance(sideRng(g, `xc:${o.id}`), pc)) {
    const n = wide ? 2 : 1;
    requirements.extraCabinPaid = { n, pct: Math.round(((X.paidPerBH * n) / basis) * 10_000) / 10_000, perBH: X.paidPerBH };
    o.blurb = `${o.blurb} The client pays $${X.paidPerBH} a block hour for each extra cabin crew member (${n} wanted).`;
  }
  // v0.7.2 F4: never the same title twice in a row for a client (builders without a pool: the month appended).
  const cl = g.clients[o.clientId];
  if (cl) {
    if (cl.lastTitle === o.title) o.title = `${o.title} (${F.monthOf(o.start)})`;
    cl.lastTitle = o.title;
  }
  g.offers[o.id] = o;
  schedule(g, o.expires, 'offer.expire', o.id);
  // Urgent work we could actually fly stops the clock (setting) and gets an inbox line; the rest just pins the map.
  if (urgency === 'urgent' && Object.keys(g.fleet).some((id) => feasibility(g, o.id, id, { quick: true }).level !== 'no')) {
    requestPause('urgentOffer');
    pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Urgent: ${o.title}`, body: `${d.client.name} needs an answer by ${fmtDay(o.expires)} ${fmtTime(o.expires)} UTC.`, ref: { kind: 'offer', id: o.id }, ...cardMeta(offerFitCard(g, o.id)), hurt: { money: o.estValue, pax: 0, delayMin: 0, level: 'high' } });
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
  let mode = roll < BAL.gapFitShare ? 'gap' : roll < 1 - BAL.aspirationalShare ? 'fleet' : 'aspire';
  const fleet = Object.values(g.fleet);
  const wideShare = fleet.length ? fleet.filter((a) => typeOf(a.typeId).body === 'wide').length / fleet.length : 0;
  // At most two ladder jobs on the market at once, so the board stays mostly workable.
  if (mode === 'aspire' && wideShare < 1 && Object.values(g.offers).filter((x) => x.status === 'open' && x.requirements.body === 'wide').length >= 2) mode = 'fleet';
  const wide = opts.wide ?? (mode === 'aspire' ? wideShare < 1 : chance(g, wideShare));
  let window: IdleWindow | undefined;
  if (opts.window) window = opts.window;
  else if (opts.window === undefined && mode === 'gap') {
    const ws = idleWindows(g).filter((w) => !archetype || fitsWindow(archetype, w, g.now));
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
    if (d && opts.paint !== undefined) d.paint = opts.paint;
    if (d && opts.cabin !== undefined) d.cabin = opts.cabin;
    const o = d && finalize(g, d, ctx.aspire);
    if (o) {
      // v0.6: the last gap-fit offer (the quiet-week floor looks at it).
      if (ctx.window) g.stats.lastGapOfferAt = g.now;
      return o;
    }
  }
  return null;
}

// ---------- lifecycle ----------

/** 'offer.spawn': generate an offer, schedule the next spawn. */
export function onOfferSpawn(g: GameState, _ev: SimEvent): void {
  if (!generateOffer(g)) generateOffer(g);
  scheduleNextOffer(g);
}

/** Who took a lost offer: a rival whose fleet fits it, near the job (clients.ts rivalFor). */
function rivalName(g: GameState, o: ContractOffer): string {
  return rivalFor(g, o)?.name ?? 'a rival operator';
}

/** 'offer.expire': open offers lapse; most go to a rival (named in the missed list). Countered offers wait for the reply. */
export function onOfferExpire(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  if (!o || o.status !== 'open' || g.now < o.expires) return;
  const lost = chance(g, 0.7);
  closeOffer(g, o, lost ? 'lost' : 'expired', lost ? rivalName(g, o) : undefined);
}

/**
 * 'offer.reply' (v0.5.2): the client answers a counter before the offer lapses: accept (signs on the chosen
 * aircraft), meet halfway (the midpoint becomes the price on the table) or refuse (the asking price stands). The
 * expiry clock paused while the counter was pending resumes with the time that was left.
 */
export function onOfferReply(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  if (!o || o.status !== 'countered' || !o.counter || o.counter.result) return;
  const k = o.counter;
  const client = g.clients[o.clientId]?.name ?? 'The client';
  // The paused clock resumes with the time that was left, but never past the job's first departure (answerBy).
  // False when no workable time is left: the client takes a rival and the offer closes.
  const reopen = (): boolean => {
    o.status = 'open';
    o.expires = Math.min(g.now + leftOf(o), answerBy(g, o, k.aircraftIds ?? [], k.paint !== false));
    if (o.expires > g.now + 10) {
      schedule(g, o.expires, 'offer.expire', o.id);
      return true;
    }
    closeOffer(g, o, 'lost', rivalName(g, o));
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${client} went elsewhere: ${o.title}`, body: `They wouldn't take our counter and the job couldn't wait any longer. ${o.lostTo} is flying it.`, ref: { kind: 'offer', id: o.id } });
    return false;
  };
  // v0.5.1: a counter without the client's paint. Required: half the time they walk; else they want a cut on top.
  const noPaint = !!o.paint && k.paint === false;
  if (noPaint && o.paint!.required && chance(g, BAL.paint.walkAway)) {
    k.result = 'refused';
    closeOffer(g, o, 'lost', rivalName(g, o));
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${client} walked away`, body: `They wanted their colours on the aircraft for ${o.title}. ${o.lostTo} took the job.`, ref: { kind: 'offer', id: o.id } });
    return;
  }
  const asking = counterBase(o);
  const odds = counterOdds(o, k.price / asking, !noPaint);
  const r = next(g);
  if (r < odds.accept) {
    k.result = 'accepted';
    setPrice(o, noPaint && o.paint!.required ? k.price * (1 - o.paint!.declinePct) : k.price);
    o.status = 'open';
    o.expires = Math.max(o.expires, g.now + 1);
    const res = acceptOffer(g, o.id, k.aircraftIds ?? [], { paint: !noPaint, priced: true });
    if (res.ok) {
      pushMessage(g, { tone: 'good', cat: 'commercial', title: `Counter accepted: ${o.title}`, body: `${client} agreed to ${fmtPrice(o.product)}${noPaint ? ', without their colours on the aircraft' : ''}. The contract is signed.`, ref: { kind: 'contract', id: res.data!.contractId } });
    } else {
      closeOffer(g, o, 'lost', rivalName(g, o));
      pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Deal fell through: ${o.title}`, body: `${client} accepted, but we can no longer fly it (${res.error}). ${o.lostTo} stepped in.`, ref: { kind: 'offer', id: o.id } });
    }
    return;
  }
  if (!reopen()) {
    k.result = 'refused';
    return;
  }
  const until = `${fmtDay(o.expires)} ${fmtTime(o.expires)} UTC`;
  if (r < odds.accept + odds.halfway) {
    k.result = 'halfway';
    const was = fmtPrice(o.product);
    k.offer = halfwayPrice(o.product, asking, k.price);
    setPrice(o, k.offer);
    pushMessage(g, {
      tone: 'warn', cat: 'commercial', title: `${client} met us halfway: ${o.title}`,
      body: `They won't go to our counter but offer ${fmtPrice(o.product)} (they asked ${was}). Accept by ${until}, or let it go.`,
      ref: { kind: 'offer', id: o.id }, problem: { kind: 'counterExpiry', ref: { kind: 'offer', id: o.id } }, hurt: { money: o.estValue, pax: 0, delayMin: 0, level: 'high' },
    });
    if (o.urgency === 'urgent') requestPause('urgentOffer');
    return;
  }
  k.result = 'refused';
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `Counter refused: ${o.title}`, body: `${client} won't move. The asking price of ${fmtPrice(o.product)} stands until ${until}.`, ref: { kind: 'offer', id: o.id } });
  if (o.urgency === 'urgent') requestPause('urgentOffer');
}

/**
 * Load (v0.5.1 saves): a pending counter gets the paused clock's time left, and an urgent one still a day away
 * is answered within 3 h like a new one (before the job's first departure). The old reply event is then a no-op.
 */
export function loadCounters(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    const k = o.counter;
    if (o.status !== 'countered' || !k || k.result) continue;
    k.left ??= Math.max(60, o.expires - k.at);
    if (o.urgency !== 'urgent' || k.replyAt - g.now <= 180) continue;
    k.replyAt = g.now + Math.min(180, Math.max(15, answerBy(g, o, k.aircraftIds ?? [], k.paint !== false) - 60 - g.now));
    schedule(g, k.replyAt, 'offer.reply', o.id);
  }
}

export function fmtPrice(p: Product): string {
  if (p.kind === 'wet') return `$${p.ratePerBH.toLocaleString('en-US')}/BH`;
  if (p.kind === 'charter') return `$${p.price.toLocaleString('en-US')}`;
  return `$${p.rentPerMonth.toLocaleString('en-US')}/month`;
}

/** Daily: drop closed offers after 14 days (the "missed" list keeps them that long); the quiet-week floor. */
export function dailyOffers(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    if (o.status === 'open' || o.status === 'countered') continue;
    o.closedAt ??= g.now;
    if (g.now - o.closedAt > 14 * DAY) delete g.offers[o.id];
  }
  // v0.7: a failed company is offered nothing new.
  if (PACING.quietFloor && !g.gameOver) quietWeekOffer(g);
}

/** v0.6 pacing switches (tests compare against the v0.5.2 offer flow). */
export const PACING = { quietFloor: true };

/**
 * v0.6 quiet-week floor (UPDATE-0.6.md §C2): one gap-fit offer when none came for a while, an aircraft has an idle
 * window within 45 days and few offers are open. Steadier, not more (offersPerWeek is lower). v0.7 (§C4): looser,
 * BAL.quietFloor (5 days, 2-day windows, fewer than 5 open).
 */
export function quietWeekOffer(g: GameState): ContractOffer | null {
  const Q = BAL.quietFloor;
  const last = g.stats.lastGapOfferAt ?? g.started;
  if (g.now - last < Q.days * DAY) return null;
  if (Object.values(g.offers).filter((o) => o.status === 'open').length >= Q.maxOpen) return null;
  const ws = idleWindows(g, Q.idleDays, 45).filter((w) => w.from < g.now + 45 * DAY);
  if (!ws.length) return null;
  const w = weightedPick(g, ws, (x) => Math.sqrt((x.to - x.from) / DAY))!;
  const o = generateOffer(g, undefined, { window: w });
  // Tried today either way (a fleet with nothing that fits waits another 6 days).
  g.stats.lastGapOfferAt = g.now;
  return o;
}

/**
 * v0.7.3 what the worst chain of a programme needs on a type with its usual facilities (bunks where most airframes
 * have them, else curtained business seats), read like the roster does (C7: Table 2 at each chain's report time
 * and sectors, then split / planned extension, then 3 or 4 pilots with the rest plan): the extra pilots (0 when
 * no in-flight rest is needed) and the extra cabin crew the rest plan adds. Pure.
 */
export function chainAugment(g: GameState, typeId: string, chains: ChainShape[]): { aug: 0 | 1 | 2; extraCabin: number } {
  const t = typeOf(typeId);
  // Narrowbody work is sized to fit without in-flight rest (their curtained economy seats are a fallback, not priced).
  if (!chains.length || t.body !== 'wide') return { aug: 0, extraCabin: 0 };
  // v0.7.4 bunks (pilots and cabin crew together) where most airframes have them, else the curtained seats of the
  // type's usual cabin (business seats, or economy seats on an all-economy narrowbody).
  const rest: AcRest = t.rest.bunkShare >= 0.5 ? bunksFor(typeId) : seatRest(typeId, t.cabins[0]);
  // Priced as if the company held the augmented crew approval (the client pays for the crew the job needs).
  const gx: GameState = g.company.approvals.includes('augmented') ? g : { ...g, company: { ...g.company, approvals: [...g.company.approvals, 'augmented'] } };
  let aug: 0 | 1 | 2 = 0;
  let extraCabin = 0;
  for (const c of chains.slice(0, 5)) {
    const n = dutyNeed(gx, typeId, rest, c);
    const a: 0 | 1 | 2 = n.mode === 'aug1' ? 1 : n.mode === 'aug2' || n.mode === 'none' ? 2 : 0;
    if (a > aug) aug = a;
    if (a && n.plan?.ok) extraCabin = Math.max(extraCabin, n.plan.extraCabin);
  }
  return { aug, extraCabin };
}
