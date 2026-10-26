// Offer generation per archetype and the offer lifecycle (B1). DESIGN.md §5.1.1–5.1.2.

import { v09Stats } from '../crew/dayPlan';
import { ACMI_TYPES_LIST, type CabinLayout, type RatingFamily } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { AIRLINE_FAMILIES, AIRLINE_MARKETS, BROKERS } from '../../data/naming';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { distance, distanceNm } from '../core/geo';
import { cue } from '../core/cues';
import { pushMessage } from '../core/messages';
import { cardMeta, offerFitCard } from '../problems';
import { requestPause } from '../core/pause';
import { blockMinutes, complement, etopsNeeded, planSector, typeOf } from '../core/perf';
import { dutyNeed } from '../crew/duties';
import { bunksFor, seatRest } from '../crew/restPlan';
import { bestSlip, slipCost, type SlipPlan } from '../crew/slip';
import { cabinPresets } from '../../data/cabins';
import { schedule } from '../core/queue';
import { chance, int, next, pick, range, weightedPick } from '../core/rng';
import { DAY, dayIndex, fmtDay, fmtTime, fromUTC, localMinuteOfDay, toDate, toLocal } from '../core/time';
import type {
  AcRest, ApprovalId, Archetype, Client, ContractOffer, GameState, LegTemplate, Minute, OfferEffects, PaintKind, Product, Requirements, SchedulePattern, SimEvent,
} from '../core/types';
import { acceptOffer, closeOffer, setPrice } from './accept';
import { isCallOffer } from './call';
import { answerBy, counterBase, counterOdds, halfwayPrice, leftOf } from './counter';
import { crewChains, feasibility, ulrNeed, type UlrNeed } from './feasibility';
import { adhocGroupClients, clientPrefix, clientsOf, isBigClub, isCruiseLine, isDiaspora, isGovernment, isMarineCrewing, isPilgrim, ministry, rivalFor } from './clients';
import * as F from './flavor';
import { paintTermsText, rollPaint, sideRng } from './paintTerms';
import { cabinTarget, cabinTermsText, rollCabin } from './cabinTerms';
import { anchorsOf, computeWaves, localToUTC, maxPax, programmeOf, route, routeMinutes, seatNeed, type ChainShape } from './plan';
export { maxPax, seatNeed };
import { ARCH_MULT, defaultSeats, isJumboType, isWetArchetype, isWideJob, priceProduct, productValue, referenceType, tripTickets } from './pricing';
import { LEVEL_PERKS, levelOf, standingRate } from './relations';
import { rivalTakes, rollRivalBid } from './rivals';
import { inWarZone, warRiskLandings } from '../ops/world';
import { demandFactor } from '../ops/market';
import { afterOfferDays, isQuiet } from '../ops/director';
import { clientCrewOnCabin, fuelFactor, MISSION_BUILDERS, missionWeights, presidential, rollClientCabin, WINDOW_FIT_V08 } from './missions';

// ---------- process ----------

/** Seasonal demand by month, Jan–Dec (DESIGN §5.1.1). */
const SEASON_F = [0.7, 0.9, 1.1, 1.2, 1.1, 1.0, 1.0, 0.9, 0.9, 0.9, 0.8, 0.9];

/** Offer rate per day: BAL.offersPerWeek × fleetF × seasonF × repF. */
export function offerRate(g: GameState): number {
  const n = Object.values(g.fleet).filter((a) => a.status !== 'stored' && a.status !== 'leasedOut').length;
  const fleetF = 0.7 + 0.15 * n;
  const repF = 0.6 + (0.8 * g.company.reputation.reliable) / 100;
  // v0.8 market cycle: volume × (fleet-weighted segment index)² (slump ≈ 0.67, boom ≈ 1.32).
  return (BAL.offersPerWeek / 7) * fleetF * SEASON_F[toDate(g.now).getUTCMonth()] * repF * demandFactor(g);
}

/** Queues the next 'offer.spawn': gamma(3) gaps with the Poisson mean (steadier than exponential, same rate). */
export function scheduleNextOffer(g: GameState): void {
  const lambda = offerRate(g);
  let sum = 0;
  for (let i = 0; i < 3; i++) sum -= Math.log(Math.max(1e-9, next(g)));
  const gapDays = sum / (3 * lambda);
  // v0.11 the event director: the gap is laid over busy (a wave) and quiet (a trickle) spells; the year's volume holds.
  schedule(g, Math.max(g.now + 30, afterOfferDays(g, g.now, gapDays)), 'offer.spawn');
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
  /** v0.8: evacuation staging hub; the world event; the rival hiring us and its end client; the contract repeated. */
  staging?: string;
  eventId?: string;
  rival?: string;
  endClient?: string;
  repeatOf?: string;
  /** v0.7.4 client cabin: false = never; a layout = force a request for it (tests, dev helper). */
  cabin?: false | { layout: CabinLayout; required?: boolean; share?: number; revert?: boolean };
}

export interface Ctx {
  g: GameState;
  wide: boolean;
  /** Aspirational job: may need approvals or types we don't have yet. */
  aspire: boolean;
  window?: IdleWindow;
  o: OfferOpts;
}

export interface Draft {
  archetype: Archetype;
  client: Client;
  broker?: string;
  title: string;
  blurb: string;
  pattern: SchedulePattern;
  req: {
    minSeats: number; maxSeats?: number; layout?: CabinLayout; families?: RatingFamily[]; extraCabin: number; noTechStops?: boolean; approvals: ApprovalId[]; /** v0.7 */ layouts?: CabinLayout[]; minPremium?: number;
  } & Partial<Pick<Requirements, 'clientCabin' | 'roundTrip' | 'stretchers' | 'extraPilot' | 'standards' | 'body'>>;
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
  /** v0.8: wet product on a legs pattern (Hajj, sub-charter in); a ready product (dry lease); MGH terms; repeat; event. */
  wet?: boolean;
  product?: Product;
  terms?: [Minute, Minute][];
  repeatOf?: string;
  eventId?: string;
  dryFor?: string;
  /** v0.8 pass-through cost added to a charter price (war-risk cover per landing). */
  passThrough?: number;
  /** v0.8 extra BH-equivalents priced in (music tours: days held away). */
  extraBH?: number;
  /** v0.9 §Y.2 a jumbo load (420–480 passengers, all economy). */
  jumbo?: boolean;
}

export const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;
export const km = (a: string, b: string) => distance(a, b);
export const r2 = (v: number) => Math.round(v * 100) / 100;
export const listCities = (codes: string[]) => {
  const names = codes.map(city);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
};

/** UTC minute of a local time on the local date containing t. */
export function atLocal(code: string, t: Minute, localMin: number): Minute {
  return localToUTC(code, dayIndex(toLocal(code, t)) * DAY + localMin);
}

/** 'today', 'tomorrow' or the date, in the airport's local calendar. */
export function whenDay(code: string, now: Minute, t: Minute): string {
  const d = dayIndex(toLocal(code, t)) - dayIndex(toLocal(code, now));
  return d === 0 ? 'today' : d === 1 ? 'tomorrow' : `on ${fmtDay(toLocal(code, t))}`;
}

/** Whole days of the idle window left after `from` (Infinity without a window). */
export const roomDays = (ctx: Ctx, from: Minute) => (ctx.window ? Math.floor((ctx.window.to - from) / DAY) : Infinity);

/** A start time in [now + leadMin, now + leadMax] that leaves `dur` inside the idle window; null if none. */
export function pickStart(ctx: Ctx, leadMin: number, leadMax: number, dur: number): Minute | null {
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

export function pickN<T>(g: GameState, xs: T[], n: number, weight: (x: T) => number): T[] {
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

export function airportsWithin(from: string, minKm: number, maxKm: number, pred: (a: Airport) => boolean): Airport[] {
  return AIRPORTS.filter((a) => a.code !== from && a.runwayM >= 2000 && pred(a) && km(from, a.code) >= minKm && km(from, a.code) <= maxKm);
}

/** v0.8 a destination an airline client would really send our aircraft to: never a war zone, inside its market when listed. Pure. */
export function inMarket(client: Client, a: Airport): boolean {
  if (inWarZone(a.code)) return false;
  const m = AIRLINE_MARKETS[client.name];
  return !m || m.includes(a.country);
}

/**
 * Clients weighted towards the idle window's location (follow-on work) or our home base, and (v0.6) by how
 * satisfied they are with us: × (1 + relation/100), a soured client still calls now and then.
 */
export function nearClient(ctx: Ctx, list: Client[]): Client | undefined {
  const at = ctx.window?.at ?? ctx.g.company.homeBase;
  if (ctx.o.client) return list.find((c) => c.id === ctx.o.client) ?? ctx.g.clients[ctx.o.client];
  return weightedPick(ctx.g, list, (c) => (km(c.base, at) < 1500 ? 4 : km(c.base, at) < 3500 ? 2 : 1) * clientWeight(ctx.g, c));
}

/**
 * v0.8 how often a client calls (§1.3, §1.4, §1.6): its level (Unhappy ×0.3 … Partner ×2.2), our clean record
 * (× 1 − cleanSensitivity × (60 − clean)/60 below 60) and, for a Newcomer, demanding clients (slow payers ×1.5).
 */
export function clientWeight(g: GameState, c: Client): number {
  const cur = g.clients[c.id] ?? c;
  const lv = LEVEL_PERKS[levelOf(g, cur)].offers;
  const clean = g.company.reputation.clean;
  const cf = Math.max(0.05, 1 - (cur.cleanSensitivity * Math.max(0, 60 - clean)) / 60);
  const dem = (g.company.standing ?? 0) === 0 && cur.payReliability < 0.8 ? BAL.v08.standing.demandingPay : 1;
  return lv * cf * dem;
}

/** v0.8 company standing: 0 Newcomer, 1 Established, 2 Respected. */
export const standingOf = (g: GameState) => g.company.standing ?? 0;

/**
 * v0.8 fix pack (newcomer noise): a Newcomer with no widebody in the fleet and no Widebody operations (held or
 * pending) sees few jobs it can never fly: a widebody job, or one needing an approval it neither holds nor has filed,
 * comes at BAL.v08.standing.newcomerReach of its odds (finalize); its Hajj airlifts leave from origins a narrowbody
 * reaches. Pure.
 */
export function newcomerNarrow(g: GameState): boolean {
  const co = g.company;
  return standingOf(g) === 0 && !Object.values(g.fleet).some((a) => typeOf(a.typeId).body === 'wide') && !co.approvals.includes('widebody') && !co.pendingApprovals.some((p) => p.id === 'widebody');
}
/** v0.8 the client's level perks. */
export const perks = (g: GameState, c: Client) => LEVEL_PERKS[levelOf(g, g.clients[c.id] ?? c)];

export function hookFor(ctx: Ctx): string | undefined {
  const w = ctx.window;
  if (!w) return undefined;
  const ac = ctx.g.fleet[w.aircraftId];
  if (w.afterContract && ctx.g.contracts[w.afterContract]) return `Follow-on: ${ac?.reg ?? 'an aircraft'} is free at ${w.at} from ${fmtDay(w.from)}`;
  return `Fits ${ac?.reg ?? 'an aircraft'}: free ${fmtDay(w.from)}${w.to - w.from < 120 * DAY ? `–${fmtDay(w.to)}` : ' onwards'}`;
}

const seatsText = (min: number, layout?: CabinLayout) => `${min}+ seats${layout === 'two-class' ? ', two-class cabin' : ''}`;

/** v0.8 fix pack: legs with a sector no narrowbody flies nonstop: long haul, so the client wants a widebody. Pure. */
export function needsWide(legs: { from: string; to: string }[]): boolean {
  const nb = ACMI_TYPES_LIST.filter((t) => t.available && t.body === 'narrow');
  return legs.some((l) => !nb.some((t) => {
    const sp = planSector(t.id, l.from, l.to);
    return sp.ok && !sp.techStops.length;
  }));
}

/**
 * v0.8 fix pack: can a crew legally fly every chain of the programme on this type (incl. fuel stops; a crew change at
 * the home base, as feasibility reads the chains), with the best
 * rest the type can carry (bunks for both crews on a widebody that has or can get them, else its curtained seats)
 * and an augmented crew? False when a day runs past what any crew may fly (FDP_CAP, 18 h even with 4 pilots in bunks)
 * or past the type's rest. Pure.
 */
export function crewCanFly(g: GameState, typeId: string, chains: ChainShape[]): boolean {
  const { gx, rest } = bestCrewing(g, typeId);
  // As feasibility reads them: cut at the home base (a crew change there) and at night stops. v0.9 §W a crew change at
  // a fuel stop (one per sector) counts as a valid plan.
  return crewChains(g, chains).every((c) => dutyNeed(gx, typeId, rest, c).mode !== 'none' || !!bestSlip(gx, typeId, rest, c));
}

/** The best rest a type can carry and the augmented approval assumed (offer generation's view). */
function bestCrewing(g: GameState, typeId: string): { gx: GameState; rest: AcRest } {
  const t = typeOf(typeId);
  const j = Math.max(...cabinPresets(typeId).map((c) => c.j));
  const rest: AcRest = t.body === 'wide' && (t.rest.bunkShare > 0 || t.rest.mro) ? bunksFor(typeId) : seatRest(typeId, { j });
  const gx: GameState = g.company.approvals.includes('augmented') ? g : { ...g, company: { ...g.company, approvals: [...g.company.approvals, 'augmented'] } };
  return { gx, rest };
}

/** v0.9 §W the crew changes at fuel stops a programme needs on a type (one per slipping chain). Pure. */
export function programmeSlips(g: GameState, typeId: string, chains: ChainShape[]): SlipPlan[] {
  const { gx, rest } = bestCrewing(g, typeId);
  const out: SlipPlan[] = [];
  for (const c of chains.flatMap((x) => crewChains(g, [x]))) {
    if (dutyNeed(gx, typeId, rest, c).mode !== 'none') continue;
    const sp = bestSlip(gx, typeId, rest, c);
    if (sp) out.push(sp);
  }
  return out;
}

/**
 * v0.9 fix: the crew changes the fleet would make on this programme: the first fleet type (most seats first) that seats
 * it, reaches it and can crew it, with that type's own fuel stops; null when no fleet type can (the reference shows).
 */
function fleetSlips(g: GameState, pattern: ContractOffer['pattern'], requirements: Requirements, ref: string): SlipPlan[] | null {
  const types = [...new Set(Object.values(g.fleet).filter((a) => a.status !== 'stored').map((a) => a.typeId))];
  const seats = (t: string) => Math.max(...cabinPresets(t).map((c) => c.j + c.w + c.y));
  types.sort((a, b) => Number(b === ref) - Number(a === ref) || seats(b) - seats(a) || (a < b ? -1 : 1));
  for (const t of types) {
    if (seats(t) < requirements.minSeats) continue;
    const pr = t === ref ? null : programmeOf({ pattern, requirements }, t);
    if (pr && !pr.ok) continue;
    const chains = pr ? pr.chains : programmeOf({ pattern, requirements }, ref).chains;
    if (!crewCanFly(g, t, chains)) continue;
    return programmeSlips(g, t, chains);
  }
  return null;
}

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
  // v0.8 a Newcomer gets 30–45-day bases (never the long variant); a Respected company twice as many long ones;
  // Trusted and Partner clients book longer (× 1.25 / 1.5, capped by the window).
  const st = standingOf(g);
  const longShare = st === 0 ? 0 : st === 2 ? BAL.paint.longBaseShare * 2 : BAL.paint.longBaseShare;
  const long = !o.days && (o.start === undefined || o.start - g.now >= 30 * DAY) && chance(sideRng(g, `long:${g.seq}:${g.now}`), longShare);
  let days = o.days ?? (long ? int(g, 120, 240) : int(g, 30, 92));
  if (!o.days && st === 0) days = int(sideRng(g, `nb:${g.seq}:${g.now}`), BAL.v08.standing.newcomerBaseDays[0], BAL.v08.standing.newcomerBaseDays[1]);
  else if (!o.days && !long) days = Math.round(days * perks(g, client).length);
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
    // v0.8 network airlines with a listed market fly their own cities (size, not sun); never a war zone.
    const net = !!AIRLINE_MARKETS[client.name];
    const ok = (a: Airport) => inMarket(client, a);
    let pool = wide
      ? airportsWithin(base, 2500, 6500, (a) => a.size >= 3 && ok(a))
      : net ? airportsWithin(base, 400, 3200, (a) => a.size >= 3 && ok(a)) : airportsWithin(base, 400, 2200, (a) => a.tour >= 0.75 && ok(a));
    if (!wide && pool.length < 6) pool = airportsWithin(base, 400, 3200, (a) => (net ? a.size >= 2 : a.tour >= 0.7) && ok(a));
    // One airport per city (no "Paris and Paris").
    const byCity = new Map<string, Airport>();
    for (const a of pool) if (!byCity.has(a.city) || byCity.get(a.city)!.size < a.size) byCity.set(a.city, a);
    dests = pickN(g, [...byCity.values()], n, (a) => a.tour * (1 + a.size)).map((a) => a.code);
  }
  if (dests.length < (wide || o.dests ? 1 : 3)) return null;
  const minSeats = wide ? pick(g, [250, 260, 280]) : pick(g, [168, 174, 180]);
  const layout: CabinLayout | undefined = wide ? 'two-class' : chance(g, ctx.aspire ? 0.3 : 0.05) ? 'two-class' : chance(g, 0.85) ? 'all-economy' : undefined;
  let families: RatingFamily[] | undefined = !wide && chance(g, 0.25) ? [chance(g, ctx.aspire ? 0.5 : 0.88) ? 'A320' : 'B737'] : undefined;
  // v0.8 crew commonality means the client's own family (Croatia Airlines never asks for a 737).
  const own: RatingFamily[] | undefined = AIRLINE_FAMILIES[client.name]?.filter((f) => f === 'A320' || f === 'B737');
  if (families && own) families = own.includes(families[0]) ? families : own.length ? [own[0]] : undefined;
  // v0.7: season bases take the everyday cabins (no VIP); widebodies two- or three-class.
  const layouts: CabinLayout[] = wide ? ['two-class', 'three-class'] : layout ? [layout] : ['all-economy', 'two-class'];
  // v0.8 fix pack: a widebody base asks for a widebody (the blurb says so; feasibility checks it).
  const req = { minSeats, layout, layouts, families, extraCabin: 0, approvals: [] as ApprovalId[], ...(wide ? { body: 'wide' as const } : {}) };
  const ref = referenceType(req, dests.flatMap((d) => [[base, d], [d, base]] as [string, string][]), true);
  if (!ref) return null;
  let waves = computeWaves(base, dests, ref, o.waves ?? (wide ? int(g, 1, 2) : int(g, 2, 3)));
  // v0.8 a Newcomer's MGH is lower (160 NB / 200 WB); Trusted / Partner clients guarantee 10 / 15 % more.
  const S8 = BAL.v08.standing;
  const mgh = st === 0 ? S8.newcomerMgh[wide ? 1 : 0] : Math.round((wide ? BAL.mgh.wide : BAL.mgh.narrow) * (1 + perks(g, client).mgh));
  const targetBH = Math.round(mgh * range(g, ...BAL.targetOverMgh));
  // v0.8 odd hours for a Newcomer (40 %): a first wave at 05:00–05:30 and a last one at 23:00–23:45 local.
  const odd = st === 0 && !o.waves && chance(sideRng(g, `odd:${g.seq}:${g.now}`), S8.oddHours);
  if (odd) waves = oddWaves(g, base, dests, ref, waves);
  const mo = toDate(from).getUTCMonth();
  const season = mo >= 2 && mo <= 8 ? 'Summer' : 'Winter';
  const fam = families ? `${families[0] === 'B737' ? '737' : 'A320'}-family aircraft` : wide ? 'a widebody' : 'an A320-size aircraft';
  return {
    archetype: 'seasonBase', client,
    title: titleFor(ctx, 'seasonBase', client, { from: base, to: base, n: days, wide, start: from }, wide ? `Long-haul base at ${city(base)}` : days >= 120 ? `Long-term base at ${city(base)}` : `${season} base at ${city(base)}`),
    blurb:
      `${client.name} wants ${fam} (${seatsText(minSeats, layout)}) based at ${base} from ${fmtDay(toLocal(base, from))} to ${fmtDay(toLocal(base, to - 1))}, ` +
      `flying to ${listCities(dests)}: ${waves.length} wave${waves.length > 1 ? 's' : ''} a day from ${hhmm(waves[0])} local${odd ? ` (the last at ${hhmm(waves[waves.length - 1])}: the slots nobody else wants)` : ''} and a maintenance night every 7 days. ` +
      `MGH ${mgh} BH a month; they plan about ${targetBH}. ${base === g.company.homeBase ? 'Crews fly from home; no hotels needed.' : `Crews live in ${city(base)} hotels at the client's cost.`}`,
    pattern: { kind: 'base', base, dests, from, to, targetBH, waves, prefix: clientPrefix(client.name), maintEvery: 7 },
    req, start: from, end: to,
    expiresIn: range(g, 4, 8) * DAY,
    // Four months and more: half the long-term discount (RESEARCH §4.2; multi-year deals get all of it).
    mult: days >= 120 ? 1 + BAL.premium.longTerm / 2 : undefined,
    mghPerMonth: mgh,
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
  const net = !!AIRLINE_MARKETS[client.name];
  const pool = wide
    ? airportsWithin(base, 2500, 7000, (a) => a.size >= 3 && inMarket(client, a))
    : airportsWithin(base, 400, net ? 3200 : 2500, (a) => a.size >= 2 && (net ? a.size >= 3 : a.tour >= 0.6 || a.size >= 3) && inMarket(client, a));
  // v0.8 a Newcomer flies the unloved routes (small airports first).
  const unloved = standingOf(g) === 0;
  const dests = o.dests ?? pickN(g, pool, wide ? int(g, 1, 2) : int(g, 2, 5), (a) => (unloved ? 6 - a.size : a.size) + a.tour * 2).map((a) => a.code);
  if (!dests.length) return null;
  const minSeats = wide ? 250 : pick(g, [150, 165, 174]);
  const req = { minSeats, extraCabin: 0, approvals: [] as ApprovalId[], ...(wide ? { body: 'wide' as const } : {}) };
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

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** v0.8 odd-hour waves (§1.6): the first at 05:00–05:30, the rest spaced as usual, a last one at 23:00–23:45 when it fits. */
function oddWaves(g: GameState, base: string, dests: string[], ref: string, waves: number[]): number[] {
  const r = sideRng(g, `oddw:${g.seq}:${g.now}`);
  const shift = 360 - (300 + 5 * int(r, 0, 6));
  const out = waves.map((w) => w - shift);
  const turn = typeOf(ref).turnMin;
  const rot = Math.max(...dests.map((d) => blockMinutes(ref, base, d) + turn + blockMinutes(ref, d, base)));
  const late = 1380 + 5 * int(r, 0, 9);
  // The late rotation must be back and turned before the next morning's first wave.
  if (out[out.length - 1] + rot + turn <= late && late + rot + turn <= out[0] + 1440) out.push(late);
  return out;
}

/** Round trip or one-way legs: out at a local slot, back `backDays` later at a local slot. */
export function roundTrip(g: GameState, a: string, b: string, start: Minute, backDays: number | null, pax: number): LegTemplate[] {
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
    // v0.7: pilgrimages fill every seat of an all-economy cabin (v0.8 fix pack: the passengers are those seats).
    pax = wide ? 300 : 180;
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
    const dest = o.airport ?? weightedPick(g, pool, (a) => a.tour + (standingOf(g) === 0 ? (6 - a.size) / 5 : a.size / 5))?.code;
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
  // v0.7: pilgrimages fill every seat (all-economy, NB 180 / WB 300). v0.8 fix pack: seats = passengers.
  const pilgrim = variant === 'pilgrimage';
  return {
    archetype: 'adhoc', client, broker, title, blurb,
    pattern: { kind: 'legs', legs },
    req: pilgrim ? { minSeats: pax, layouts: ['all-economy'], extraCabin: 0, approvals: [] } : { minSeats: pax, extraCabin: 0, approvals: [] },
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
  // v0.8 pre-release: seats = passengers, so a widebody load is drawn where the seat ask was before the fix pack (250):
  // 240–265, within a two-class 767-300 (267) and every A330/A340, not 260–300 (most no longer fit the first widebody).
  const pax = wide ? int(g, 240, 265) : int(g, 105, 150);
  if (wide) {
    const pool = F.TOUR_CITIES.filter((c) => AIRPORT_BY_CODE[c] && km(home, c) > 4500);
    const far = o.airport ?? (pool.length ? pick(g, pool) : undefined);
    if (!far) return null;
    const back = int(g, 8, 12);
    legs.push(...roundTrip(g, home, far, s, back, pax));
    return {
      archetype: 'sports', client, title: `Pre-season tour to ${city(far)}`,
      blurb: `${client.name} take the squad, sponsors and a fan club to ${city(far)} for a ${back}-day pre-season tour. Branded headrests and a nutritionist menu; two extra cabin crew.`,
      pattern: { kind: 'legs', legs }, req: { minSeats: pax, extraCabin: 2, approvals: [] },
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
    req: { minSeats: pax, extraCabin: 2, approvals: [] },
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
  const lead = o.start !== undefined ? o.start - g.now : int(g, 24, 72) * 60;
  // v0.8 pre-release: seats = passengers, so a widebody load is drawn where the seat ask was before the fix pack (250):
  // 240–265, within a two-class 767-300 (267) and every A330/A340, not 260–300 (most no longer fit the first widebody).
  const pax = wide ? int(g, 240, 265) : int(g, 140, 175);
  // v0.8 fix pack: the real chain on the type the job is priced on (fuel stops included); no type reaches: no offer.
  const ref = referenceType({ minSeats: pax }, [[crisis, home]]);
  const est = ref ? route(ref, crisis, home) : null;
  if (!ref || !est || !est.length) return null;
  const chain = routeMinutes(est);
  const legs: LegTemplate[] = [];
  let dep = atLocal(crisis, g.now + lead, int(g, 16, 28) * 30);
  if (dep < g.now + 20 * 60) dep += DAY;
  // One aircraft flies them all: home with the evacuees, back empty, two turns and an hour or two of slack.
  const turn = typeOf(ref).turnMin;
  for (let i = 0; i < n; i++) {
    legs.push({ from: crisis, to: home, dep, flightNo: '', pax });
    dep += Math.ceil((2 * chain + 2 * turn + 120) / 15) * 15;
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
    req: { minSeats: pax, extraCabin: 0, approvals: [] },
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
export function titleFor(ctx: Ctx, arch: string, client: Client, x: Omit<F.TitleCtx, 'client' | 'brand' | 'fromCity' | 'toCity' | 'season' | 'month'> & { start: Minute }, fallback: string): string {
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
  // v0.8 pre-release: seats = passengers, so a widebody load is drawn where the seat ask was before the fix pack (250):
  // 240–265, within a two-class 767-300 (267) and every A330/A340, not 260–300 (most no longer fit the first widebody).
  const pax = wide ? int(g, 240, 265) : int(g, 165, 180);
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
    req: { minSeats: pax, extraCabin: 0, approvals: [], noTechStops: true },
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
  // v0.8: the UN only charters audited operators (Established and IOSA held or under way, as unRotation).
  const unOk = standingOf(g) >= 1 && [...g.company.approvals, ...g.company.pendingApprovals.map((p) => p.id)].includes('iosa');
  const un = !o.client && chance(sideRng(g, `un:${g.seq}:${g.now}`), 0.3) && unOk ? Object.values(g.clients).find((c) => /^UN Department of Peace/.test(c.name)) : undefined;
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
    // v0.8 fix pack: seats = passengers (the contingent); the UN wants all-economy.
    req: { minSeats: pax, ...(un ? { layouts: ['all-economy'] as CabinLayout[] } : {}), extraCabin: 0, approvals: [] },
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
  // v0.8 a Respected company: half the government VIP work is presidential (§2.3).
  if (!o.client && standingOf(g) === 2 && chance(sideRng(g, `pres:${g.seq}:${g.now}`), 0.5)) {
    const p = presidential(ctx);
    if (p) return p;
  }
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
    // v0.8 fix pack: long-haul VIP work wants a widebody (never an A320 with two fuel stops).
    req: {
      ...(corporate ? { minSeats: pax, layouts: ['vip', 'two-class', 'three-class'] as CabinLayout[], minPremium: 24 } : { minSeats: pax, layouts: ['vip'] as CabinLayout[] }),
      extraCabin: int(g, 2, 4), approvals: [], ...(wide && needsWide(legs) ? { body: 'wide' as const } : {}),
    },
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
/** v0.8 builder of an archetype (the missions are looked up at call time: missions.ts imports this module). */
const builderOf = (a: Archetype) => BUILDERS[a] ?? MISSION_BUILDERS[a];
/** v0.8 the season-base builder (capacity leases reuse it). */
export const seasonBaseDraft = (ctx: Ctx) => seasonBase(ctx);

/** Archetype weights for the current month (season bases before summer, sports outside June–July…). */
function weights(g: GameState): [Archetype, number][] {
  const mo = toDate(g.now).getUTCMonth();
  const list: [Archetype, number][] = [
    ['seasonBase', mo <= 4 ? 0.24 : mo === 5 ? 0.12 : mo <= 7 ? 0.08 : 0.14],
    ['aogCover', mo >= 5 && mo <= 8 ? 0.17 : 0.13],
    ['adhoc', 0.25],
    ['sports', mo === 5 || mo === 6 ? 0.04 : 0.11],
    ['repatriation', 0.06],
    ['tourSeries', (mo >= 1 && mo <= 5) || mo === 8 || mo === 9 ? 0.13 : 0.08],
    ['troopRotation', 0.06],
    // v0.7: VIP work, twice as often once we fly a VIP cabin. v0.8: not for a Newcomer.
    ['vip', standingOf(g) === 0 ? 0 : Object.values(g.fleet).some((a) => a.cabin.layout === 'vip') ? 0.08 : 0.04],
  ];
  // v0.8 more contract types (missions.ts); fuel over $900/t: charter clients wait (× 0.85).
  return [...list.map(([a, w]): [Archetype, number] => [a, w * fuelFactor(g, a)]), ...missionWeights(g)];
}

/** Per archetype: lead from now to start [min, max] and the room it needs inside a window, in days. */
const WINDOW_FIT: Partial<Record<Archetype, [number, number, number]>> = {
  seasonBase: [14, 60, 32], aogCover: [0.08, 1, 2], repatriation: [1, 3, 2], adhoc: [3, 30, 2], sports: [7, 60, 2.5], troopRotation: [30, 90, 16], tourSeries: [30, 120, 21],
  vip: [5, 45, 3],
};

/** Archetypes that can live inside an idle window (its start reachable within the lead, enough room after it). */
function fitsWindow(a: Archetype, w: IdleWindow, now: Minute): boolean {
  const f = WINDOW_FIT[a] ?? WINDOW_FIT_V08[a];
  if (!f) return false;
  const from = Math.max(w.from, now + f[0] * DAY);
  return from <= now + f[1] * DAY && (w.to - from) / DAY >= f[2];
}

// ---------- finalise ----------

/** v0.8 fix pack: finalize dropped a draft no crew may fly, or one a Newcomer can never fly (generateOffer picks again). */
let fixDropped = false;

/** Archetypes whose full widebody loads can be jumbo loads (§Y.2). */
const JUMBO_ARCH = new Set<Archetype>(['hajj', 'troopRotation', 'unRotation', 'evacuation', 'repatriation', 'sports', 'adhoc']);

/**
 * §Y.2: 20 % of the widebody legs offers of these kinds (35 % with a 747 of ours idle over the job; none when nobody,
 * we or a rival, flies a 400-seat type) become jumbo loads: 420–480 passengers on each loaded leg, all economy, on a
 * side stream (the offer stream is unchanged otherwise). Ad hoc only for pilgrims (all-economy requests).
 */
let jumboForced = false;
/** Dev/test (devJumbo): every eligible widebody draft becomes a jumbo load while on. */
export function forceJumbo(on: boolean): void {
  jumboForced = on;
}

function jumboLoad(g: GameState, d: Draft): void {
  const p = d.pattern;
  if (d.product || d.jumbo || p.kind !== 'legs' || !JUMBO_ARCH.has(d.archetype) || d.req.families?.length || d.req.stretchers) return;
  if (d.archetype === 'adhoc' && !d.req.layouts?.includes('all-economy')) return;
  if (d.req.minPremium || (d.req.layouts && !d.req.layouts.includes('all-economy')) || (d.req.layout && d.req.layout !== 'all-economy')) return;
  const pax = Math.max(0, ...p.legs.map((l) => l.pax ?? 0));
  if (pax < 220 && d.req.body !== 'wide') return;
  const J = BAL.v09.jumbo;
  const ours = Object.values(g.fleet).filter((a) => isJumboType(a.typeId));
  if (!ours.length && !g.rivals.some((r) => r.fleet.some((x) => x.count > 0 && isJumboType(x.typeId)))) return;
  const idle747 = ours.some((a) => a.typeId === 'b744' && idleWindows(g).some((w) => w.aircraftId === a.id && w.from <= d.start && w.to >= d.end));
  const r = sideRng(g, `jumbo:${d.archetype}:${d.client.id}:${d.start}`);
  if (!jumboForced) {
    if (!chance(r, idle747 ? J.shareIdle : J.share)) return;
    const v = v09Stats(g);
    if ((v.offersWide ?? 0) >= 20 && (v.offersJumbo ?? 0) + 1 > (idle747 ? J.capShareIdle : J.capShare) * ((v.offersWide ?? 0) + 1)) return;
  }
  // v0.9 fix: never more passengers than our biggest jumbo seats (a 747-400 comes 24J/426Y: 450), so a load we are
  // offered is one we can fly as configured.
  const cap = Math.max(0, ...ours.map((a) => a.cabin.total));
  const n = Math.min(int(r, J.pax[0], J.pax[1]), cap >= J.pax[0] ? cap : Infinity);
  const loaded = p.legs.filter((l) => (l.pax ?? 0) > 0).length;
  for (const l of p.legs) if ((l.pax ?? 0) > 0) l.pax = n;
  // Seats = passengers (v0.8): the blurb's head counts follow the load: per leg ('about 243 citizens') and totals
  // ('3 shuttles … about 750 citizens').
  if (pax > 0) {
    for (let m = loaded; m >= 2; m--) d.blurb = d.blurb.replace(new RegExp(`\\b${pax * m}(?= [a-z])`, 'g'), String(n * m));
    d.blurb = d.blurb.replace(new RegExp(`\\b${pax}(?= [a-z])`, 'g'), String(n));
  }
  d.req.minSeats = n;
  // v0.9 fix: a full load takes any cabin with the seats (business seats sold as economy), not only all-economy.
  delete d.req.layouts;
  delete d.req.layout;
  delete d.req.maxSeats;
  d.req.body = 'wide';
  d.jumbo = true;
}

/**
 * v0.9.1 a big full job (Hajj, troops, a UN or national contingent, an evacuation, a repatriation, a full widebody
 * charter: 250+ passengers on a widebody) bills the fuel at cost after flying, as the jumbo loads do: the client pays
 * the burn of the aircraft that carries its load, so an old 747 can take the work an A330 is priced for without
 * flying its extra fuel at a loss. Everything else keeps the fuel in the price.
 */
function bigFull(d: Draft): boolean {
  if (!JUMBO_ARCH.has(d.archetype) || d.pattern.kind !== 'legs' || !isWideJob(d.req)) return false;
  return Math.max(0, ...d.pattern.legs.map((l) => l.pax ?? 0)) >= 250;
}

function finalize(g: GameState, d: Draft, aspire: boolean): ContractOffer | null {
  const home = g.company.homeBase;
  // One live request per client and kind of job.
  if (Object.values(g.offers).some((x) => x.clientId === d.client.id && x.archetype === d.archetype && (x.status === 'open' || x.status === 'countered'))) return null;
  const p = d.pattern;
  // v0.9 §Y.2 some full widebody loads are jumbo loads (420–480 passengers, all economy).
  jumboLoad(g, d);
  // v0.8 fix pack: seats = passengers on every legs job (whatever the builder rounded), stretchers the only extra.
  d.req.minSeats = seatNeed(p, d.req.stretchers, d.req.minSeats);
  const sectors: [string, string][] = p.kind === 'base' ? p.dests.flatMap((x) => [[p.base, x], [x, p.base]] as [string, string][]) : p.legs.map((l) => [l.from, l.to]);
  const ref = referenceType(d.req, sectors, p.kind === 'base', d.req.approvals.includes('ulr'));
  if (!ref) return null;
  const airports = [...new Set(sectors.flat())];
  const requirements: Requirements = {
    // v0.8 fix pack: `body` only when the client asks for one (a widebody base, Hajj, Antarctica); seats decide the rest.
    minSeats: d.req.minSeats, maxSeats: d.req.maxSeats, layout: d.req.layout, families: d.req.families,
    ...(d.req.layouts ? { layouts: d.req.layouts } : {}), ...(d.req.minPremium ? { minPremium: d.req.minPremium } : {}),
    longestSectorNm: Math.round(Math.max(...sectors.map(([a, b]) => distanceNm(a, b)))),
    minRunwayM: Math.min(...airports.map((c) => AIRPORT_BY_CODE[c]?.runwayM ?? 0)),
    etops: 0, approvals: d.req.approvals, extraCabin: d.req.extraCabin, noTechStops: d.req.noTechStops,
    // v0.8 mission requirements.
    ...(d.req.roundTrip ? { roundTrip: true } : {}), ...(d.req.stretchers ? { stretchers: d.req.stretchers } : {}),
    ...(d.req.extraPilot ? { extraPilot: 1 as const } : {}), ...(d.req.standards ? { standards: d.req.standards } : {}),
    ...(d.req.clientCabin ? { clientCabin: d.req.clientCabin } : {}),
  };
  if (d.req.body) requirements.body = d.req.body;
  // v0.8 fix pack (newcomer noise): a Newcomer without a widebody sees only a few jobs it can never fly.
  if (newcomerNarrow(g) && !d.repeatOf && !d.eventId && (isWideJob(requirements) || requirements.approvals.some((a) => !g.company.approvals.includes(a) && !g.company.pendingApprovals.some((p) => p.id === a)))
    && !chance(sideRng(g, `reach:${g.seq}:${g.now}:${d.archetype}`), BAL.v08.standing.newcomerReach)) {
    fixDropped = true;
    return null;
  }
  const prog = programmeOf({ pattern: p, requirements }, ref);
  if (!prog.ok) return null;
  // v0.8 fix pack (v0.7.3 ulrDest for every kind of work): never a programme whose day no crew may fly on its own type.
  if (!crewCanFly(g, ref, prog.chains)) {
    fixDropped = true;
    return null;
  }
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
  // v0.9 §W crew changes at fuel stops: tickets in and out, the hotel and the extra crew-days, priced in.
  const slips = programmeSlips(g, ref, prog.chains);
  for (const sp of slips) {
    tickets += sp.tickets;
    roomNights += sp.hotelNights;
    crewDays += sp.crewN;
  }
  const revBH = prog.revenueMin / 60;
  const wet = isWetArchetype(d.archetype) || !!d.wet;
  const gov = isGovernment(d.client);
  // v0.8 the client's level (Unhappy −5 % … Partner +15 %) and our standing (Newcomer −8 %, Respected +4 %).
  // v0.8 a charter built while war risk is listed prices the cover in (per landing at a war-risk airport).
  if (!wet && d.archetype !== 'evacuation' && p.kind === 'legs') d.passThrough = (d.passThrough ?? 0) + warRiskLandings(g, p.legs, typeOf(ref).body === 'wide');
  const levelPct = d.product ? 0 : perks(g, d.client).rate;
  const standingPct = d.product ? 0 : standingRate(g);
  const product: Product = d.product ?? priceProduct(g, {
    archetype: d.archetype, typeId: ref, estBH: wet ? revBH : revBH + emptyMin / 60 + (d.extraBH ?? 0), start: d.start, end: d.end, lead: d.start - g.now,
    mult: d.mult, departures: deps, revDepartures: revDeps, roomNights, crewDays, tickets: tickets + (d.passThrough ?? 0), government: gov, mghPerMonth: d.mghPerMonth,
    loyalty: (1 + levelPct) * (1 + standingPct) - 1, wet: d.wet, ...((d.jumbo || bigFull(d)) && !wet ? { fuelAtCostBH: revBH } : {}),
  });
  // v0.7.3 heavy crews cost more: a wet rate +3 % when the longest chain needs 3 pilots on the type it was sized
  // for, +6 % for 4 (that type's usual rest facilities).
  if (product.kind === 'wet' && aug) product.ratePerBH = Math.round(product.ratePerBH * (1 + (BAL.v073.augRate[aug] ?? 0)));
  // ... and the extra cabin crew its rest plan adds are billed like client-requested ones (RESEARCH §4.3).
  if (product.kind === 'wet' && restCabin) product.ratePerBH += BAL.crewExtra.paidPerBH * restCabin;
  // v0.8 mixed crew (§7): the client provides some cabin crew; −$75 per client crew member per block hour.
  const clientCabin = requirements.clientCabin ?? (product.kind === 'wet' ? rollClientCabin(g, d, ref, requirements) : undefined);
  if (clientCabin && product.kind === 'wet') {
    requirements.clientCabin = clientCabin;
    product.ratePerBH = Math.max(1000, product.ratePerBH - BAL.v08.mixedCrew.perCabinBH * clientCabin.n);
  }
  const lead = d.start - g.now;
  const urgency = lead < 72 * 60 ? 'urgent' : lead < 7 * DAY ? 'short' : 'normal';
  const maxExp = urgency === 'urgent' ? lead - 60 : lead - 12 * 60;
  // v0.8 first refusal (Trusted / Partner clients): the offer lasts 48 h longer (never past the job).
  const firstRefusal = perks(g, d.client).first && d.archetype !== 'subcharterIn' && d.archetype !== 'dryLeaseOut';
  const ask = d.expiresIn + (firstRefusal ? BAL.v08.firstRefusalH * 60 : 0);
  const expiresIn = Math.max(urgency === 'urgent' ? 60 : Math.min(2 * DAY, maxExp), Math.min(ask, maxExp));
  const wide = typeOf(ref).body === 'wide';
  const firstAway = p.kind === 'base' ? p.base : p.legs.flatMap((l) => [l.from, l.to]).find((c) => c !== home) ?? p.legs[0].to;
  const o: ContractOffer = {
    id: nextId(g, 'o'),
    archetype: d.archetype, clientId: d.client.id, broker: d.broker, title: d.title, blurb: d.blurb,
    product, requirements, pattern: p, start: d.start, end: d.end, created: g.now, expires: g.now + Math.round(expiresIn), urgency,
    // v0.8 a Newcomer's clients are demanding (delay compensation × 1.5).
    penalties: { cancelScale: BAL.cancelScale.map(([a, b]) => [a, b] as [number, number]), perDelay: Math.round(BAL.perDelay[wide ? 1 : 0] * (standingOf(g) === 0 ? BAL.v08.standing.demandingDelay : 1)), perCancelledLeg: BAL.perCancelledLeg[wide ? 1 : 0] },
    payment: product.kind === 'dry'
      ? { basis: 'advance', dueDays: 5, depositPct: 0 }
      : wet
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
    ...(levelPct ? { levelPct } : {}), ...(standingPct ? { standingPct } : {}), ...(firstRefusal ? { firstRefusal: true } : {}),
    ...(d.repeatOf ? { repeatOf: d.repeatOf } : {}), ...(d.eventId ? { eventId: d.eventId } : {}), ...(d.dryFor ? { dryFor: d.dryFor } : {}),
  };
  if (d.terms) o.terms = d.terms;
  if (d.jumbo) o.jumbo = true;
  if (isWideJob(requirements)) {
    const v = v09Stats(g);
    v.offersWide = (v.offersWide ?? 0) + 1;
    if (d.jumbo) v.offersJumbo = (v.offersJumbo ?? 0) + 1;
  }
  // The chip names the stops of the type that will fly it: a fleet type that can (seats, range, crew), else the reference.
  const shown = fleetSlips(g, p, requirements, ref) ?? slips;
  if (shown.length) o.slip = { at: [...new Set(shown.map((x) => x.at))], cost: shown.reduce((n, x) => n + slipCost(x), 0) };
  // v0.8 Trusted / Partner clients pay sooner.
  o.payment.dueDays = Math.max(0, o.payment.dueDays - perks(g, d.client).payDays);
  o.estValue = productValue(product, revBH, d.start, d.end, d.terms);
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
    // v0.8 mixed crew on the client's cabin: their crew counted on its seats, the rate cut following.
    const cc0 = requirements.clientCabin;
    const to = cabinTarget(ref, cabin.layout);
    if (cc0 && to && product.kind === 'wet') {
      const cc = clientCrewOnCabin(ref, cc0, to.j + to.w + to.y);
      if (cc.n !== cc0.n || cc.of !== cc0.of) {
        requirements.clientCabin = cc;
        product.ratePerBH = Math.max(1000, product.ratePerBH - BAL.v08.mixedCrew.perCabinBH * (cc.n - cc0.n));
        o.estValue = productValue(product, revBH, d.start, d.end, d.terms);
      }
    }
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
  // v0.9 (§V.2) titles never carry the client's name (it is shown on its own).
  o.title = F.clientless(o.title, d.client.name);
  // v0.7.2 F4: never the same title twice in a row for a client (builders without a pool: the month appended).
  const cl = g.clients[o.clientId];
  if (cl) {
    if (cl.lastTitle === o.title) o.title = `${o.title} (${F.monthOf(o.start)})`;
    cl.lastTitle = o.title;
  }
  g.offers[o.id] = o;
  schedule(g, o.expires, 'offer.expire', o.id);
  // v0.8 a rival may be quoting for the same job (a hidden, timed bid).
  rollRivalBid(g, o);

  // Urgent work we could actually fly stops the clock (setting) and gets an inbox line; the rest just pins the map.
  if (urgency === 'urgent' && Object.keys(g.fleet).some((id) => feasibility(g, o.id, id, { quick: true }).level !== 'no')) {
    requestPause('urgentOffer');
    // v0.10.2 urgent and high-paying: the client phones (the call pop-up and its ring are the note; the Inbox keeps it)
    const call = isCallOffer(g, o);
    if (call) o.call = true;
    pushMessage(g, {
      tone: 'warn', cat: 'commercial', title: call ? `Phone call: ${o.title}` : `Urgent: ${o.title}`, body: `${d.client.name} needs an answer by ${fmtDay(o.expires)} ${fmtTime(o.expires)} UTC.`,
      ref: { kind: 'offer', id: o.id }, ...cardMeta(offerFitCard(g, o.id)), hurt: { money: o.estValue, pax: 0, delayMin: 0, level: 'high' }, cue: call ? 'offerCall' : offerCue(o),
    });
  } else cue(offerCue(o), { title: `New offer: ${o.title}`, body: `${d.client.name}. Answer by ${fmtDay(o.expires)}.`, tone: 'info', ref: { kind: 'offer', id: o.id } });
  return o;
}

/** §S.3: an urgent evacuation or repatriation request is its own (triple) cue; any other new offer the two-tone. */
const offerCue = (o: ContractOffer) => (o.urgency === 'urgent' && (o.archetype === 'evacuation' || o.archetype === 'repatriation') ? 'evacuation' as const : 'offerNew' as const);

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
  if (mode === 'aspire' && wideShare < 1 && Object.values(g.offers).filter((x) => x.status === 'open' && isWideJob(x.requirements)).length >= 2) mode = 'fleet';
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
  fixDropped = false;
  for (let i = 0; i < tries.length; i++) {
    const build = builderOf(tries[i]);
    if (!build) continue;
    // Last attempt drops the window so a forced archetype still appears.
    const ctx: Ctx = { g, wide, aspire: opts.wide ?? mode === 'aspire', window: i === tries.length - 1 && !opts.window ? undefined : window, o: opts };
    const d = build(ctx);
    if (d && opts.paint !== undefined) d.paint = opts.paint;
    if (d && opts.repeatOf) d.repeatOf = opts.repeatOf;
    if (d && opts.eventId) d.eventId = opts.eventId;
    if (d && opts.cabin !== undefined) d.cabin = opts.cabin;
    const o = d && finalize(g, d, ctx.aspire);
    if (o) {
      // v0.6: the last gap-fit offer (the quiet-week floor looks at it).
      if (ctx.window) g.stats.lastGapOfferAt = g.now;
      return o;
    }
    // v0.8 fix pack: drafts dropped as impossible (or never flyable by a Newcomer) don't thin the market: two more picks.
    if (i === tries.length - 1 && tries.length === 3 && !archetype && fixDropped) {
      const ws = weights(g);
      for (let k = 0; k < 2 && ws.length; k++) tries.push(weightedPick(g, ws, ([, w]) => w)![0]);
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

/** Runtime only: the hour last checked and the offers already chimed per game (a reload chimes none it found lapsing). */
const lapseHour = new WeakMap<GameState, number>();
const lapsed = new WeakMap<GameState, Set<string>>();

/** §S.3 `offerLapsing`: once per offer the player opened, when it has under 6 h left. Checked hourly from settle. */
export function lapseCues(g: GameState): void {
  const h = Math.floor(g.now / 60);
  if (lapseHour.get(g) === h) return;
  lapseHour.set(g, h);
  const first = !lapsed.has(g);
  const s = lapsed.get(g) ?? new Set<string>();
  lapsed.set(g, s);
  for (const o of Object.values(g.offers)) {
    if (!o.seen || (o.status !== 'open' && o.status !== 'countered') || o.expires <= g.now || o.expires - g.now >= 6 * 60 || s.has(o.id)) continue;
    s.add(o.id);
    if (!first) cue('offerLapsing', { title: `Offer lapsing soon: ${o.title}`, body: `It closes at ${fmtTime(o.expires)} UTC.`, tone: 'warn', ref: { kind: 'offer', id: o.id } });
  }
}

/** 'offer.expire': open offers lapse; most go to a rival (named in the missed list). Countered offers wait for the reply. */
export function onOfferExpire(g: GameState, ev: SimEvent): void {
  const o = g.offers[ev.id];
  if (!o || o.status !== 'open' || g.now < o.expires) return;
  // v0.8 a rival bid due at or after expiry takes it now; first refusal: only 30 % go to a rival.
  const b = o.rivalBid;
  const bidder = b && !o.firstRefusal ? g.rivals.find((r) => r.id === b.rivalId && (r.status ?? 'active') === 'active') : undefined;
  if (bidder && b) return rivalTakes(g, o, bidder, b.why);
  const lost = chance(g, o.firstRefusal ? BAL.v08.firstRefusalLost : 0.7);
  closeOffer(g, o, lost ? 'lost' : 'expired', lost ? rivalName(g, o) : undefined);
  // The missed list always says why: here we simply let the offer lapse.
  if (lost) o.lostWhy = 'took it when our offer lapsed without an answer';
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
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${client} went elsewhere: ${o.title}`, body: `They wouldn't take our counter and the job couldn't wait any longer. ${o.lostTo} is flying it.`, ref: { kind: 'offer', id: o.id }, cue: 'counterReply' });
    return false;
  };
  // v0.5.1: a counter without the client's paint. Required: half the time they walk; else they want a cut on top.
  const noPaint = !!o.paint && k.paint === false;
  if (noPaint && o.paint!.required && chance(g, BAL.paint.walkAway)) {
    k.result = 'refused';
    closeOffer(g, o, 'lost', rivalName(g, o));
    pushMessage(g, { tone: 'info', cat: 'commercial', title: `${client} walked away`, body: `They wanted their colours on the aircraft for ${o.title}. ${o.lostTo} took the job.`, ref: { kind: 'offer', id: o.id }, cue: 'counterReply' });
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
      pushMessage(g, { tone: 'good', cat: 'commercial', title: `Counter accepted: ${o.title}`, body: `${client} agreed to ${fmtPrice(o.product)}${noPaint ? ', without their colours on the aircraft' : ''}. The contract is signed.`, ref: { kind: 'contract', id: res.data!.contractId }, cue: 'counterReply' });
    } else {
      closeOffer(g, o, 'lost', rivalName(g, o));
      pushMessage(g, { tone: 'warn', cat: 'commercial', title: `Deal fell through: ${o.title}`, body: `${client} accepted, but we can no longer fly it (${res.error}). ${o.lostTo} stepped in.`, ref: { kind: 'offer', id: o.id }, cue: 'counterReply' });
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
      ref: { kind: 'offer', id: o.id }, problem: { kind: 'counterExpiry', ref: { kind: 'offer', id: o.id } }, hurt: { money: o.estValue, pax: 0, delayMin: 0, level: 'high' }, cue: 'counterReply',
    });
    if (o.urgency === 'urgent') requestPause('urgentOffer');
    return;
  }
  k.result = 'refused';
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `Counter refused: ${o.title}`, body: `${client} won't move. The asking price of ${fmtPrice(o.product)} stands until ${until}.`, ref: { kind: 'offer', id: o.id }, cue: 'counterReply' });
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
  if (p.kind === 'charter') return `$${p.price.toLocaleString('en-US')}${p.fuelAtCost ? ' plus fuel at cost' : ''}`;
  return `$${p.rentPerMonth.toLocaleString('en-US')}/month`;
}

/** Daily: drop closed offers after 14 days (the "missed" list keeps them that long); the quiet-week floor. */
export function dailyOffers(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    if (o.status === 'open' || o.status === 'countered') continue;
    o.closedAt ??= g.now;
    if (g.now - o.closedAt > 14 * DAY) delete g.offers[o.id];
  }
  // v0.7: a failed company is offered nothing new. v0.11: the floor tops up in busy spells only (quiet days stay quiet).
  if (PACING.quietFloor && !g.gameOver && !isQuiet(g)) quietWeekOffer(g);
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


/** v0.9 dev helpers: a draft finalised into an open offer (no market filters beyond the programme's own). */
export const finalizeDraft = (g: GameState, d: Draft): ContractOffer | null => finalize(g, d, true);
