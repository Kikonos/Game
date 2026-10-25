// Pricing per RESEARCH §4 (B1). DESIGN.md §5.1.3–5.1.4.

import { cabinPresets } from '../../data/cabins';
import { ACMI_TYPES, ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { distance } from '../core/geo';
import { planSector } from '../core/perf';
import { daysInMonth, monthKey, monthStart, toDate } from '../core/time';
import { hashUnit } from '../core/util';
import type { Archetype, GameState, Minute, MonthKey, Product, Requirements } from '../core/types';
import { segIndex } from '../ops/market';

export interface PriceInput {
  archetype: Archetype;
  typeId: string;
  /** Planned block hours (incl. positioning for charters) and the programme window. */
  estBH: number;
  start: Minute;
  end: Minute;
  /** Lead time from offer creation to start (minutes). */
  lead: number;
  // ---- B1 extras (optional) ----
  /** Archetype multiplier override (AOG cover rolls 1.3–2.0). */
  mult?: number;
  /** v0.6: client relation price premium (relation × BAL.morale.service.relationPremium, ±5% at ±100). */
  loyalty?: number;
  /** Charter pass-through: departures (all legs), revenue departures (catering), crew room-nights, crew person-days away. */
  departures?: number;
  revDepartures?: number;
  roomNights?: number;
  crewDays?: number;
  /** Crew positioning tickets expected (slip crews, crews home during long stays), $. */
  tickets?: number;
  /** Government payer: no deposit, invoiced on completion. */
  government?: boolean;
  /** Wet MGH per aircraft-month override (AOG cover: 8 BH/day). */
  mghPerMonth?: number;
  /** v0.9 jumbo loads: block hours whose fuel the client pays at cost after flying (not in the price). */
  fuelAtCostBH?: number;
  /** v0.8 a wet product on a legs pattern (Hajj, sub-charter in). */
  wet?: boolean;
}

/** Archetype multipliers on the reference type's ACMI rate (DESIGN §5.1.2, RESEARCH §3). */
export const ARCH_MULT: Partial<Record<Archetype, number>> = {
  seasonBase: 1.0, aogCover: 1.5, adhoc: 1.0, sports: 1.3, repatriation: 1.5, tourSeries: 1.0, troopRotation: 1.2,
  // v0.7: VIP work at +35% (BAL.premium.vip).
  vip: 1 + BAL.premium.vip,
  // v0.8 (UPDATE-0.8.md §2; RESEARCH §3): the builders may override (Hajj in June, presidential, sub-charter in).
  hajj: BAL.v08.arch.hajj[0], unRotation: BAL.v08.arch.un * (1 + BAL.v08.arch.unLong), deportation: BAL.v08.arch.deportation, evacuation: BAL.v08.arch.evacuation,
  medical: BAL.v08.arch.medical, musicTour: BAL.v08.arch.music, antarctic: BAL.v08.arch.antarctic, humanitarian: BAL.v08.arch.humanitarian,
  capacityLease: BAL.v08.arch.capacity, subcharterIn: BAL.v08.arch.subIn[0],
};

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const DAY = 1440;

export interface RateParts {
  season: number;
  lead: number;
  type: number;
  market: number;
  /** 1 + the parts. */
  m: number;
}

/** Rate modifiers: season of the start date, booking lead, unloved type, market index (RESEARCH §4.2). */
export function rateMultiplier(g: GameState, typeId: string, start: Minute, lead: number): RateParts {
  const d = toDate(start);
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const festive = (mo === 11 && day >= 15) || (mo === 0 && day <= 6);
  const season = mo >= 5 && mo <= 8 ? BAL.premium.peakSummer : (mo >= 10 || mo <= 2) && !festive ? BAL.premium.winter : 0;
  const leadP = lead < 72 * 60 ? BAL.premium.urgent : lead < 7 * DAY ? BAL.premium.short : 0;
  const t = ACMI_TYPES[typeId];
  // Market rates come from a mainstream reference type (referenceType skips unloved ones), so no old-type
  // discount here; an unloved type earns the same rate but costs less to lease.
  const type = 0;
  // v0.8 the segment index with today's demand shocks (ops/market.ts segIndex).
  const market = segIndex(g, t?.body === 'wide' ? 'wide' : 'narrow') - 1;
  return { season, lead: leadP, type, market, m: 1 + season + leadP + type + market };
}

export const isWetArchetype = (a: Archetype) => a === 'seasonBase' || a === 'aogCover' || a === 'capacityLease';

/** Asking product for an offer: wet (rate/MGH) for base patterns, charter (all-in price) otherwise. */
export function priceProduct(g: GameState, p: PriceInput): Product {
  const t = ACMI_TYPES[p.typeId];
  const R = t.rateBH;
  // Wet deals price the season at the middle of the term; charters at departure.
  const wetP = isWetArchetype(p.archetype) || !!p.wet;
  const { m } = rateMultiplier(g, p.typeId, wetP ? Math.round((p.start + p.end) / 2) : p.start, p.lead);
  const mult = (p.mult ?? ARCH_MULT[p.archetype] ?? 1) * (1 + (p.loyalty ?? 0));
  const wide = t.body === 'wide';
  if (wetP) {
    return {
      kind: 'wet',
      ratePerBH: roundTo(R * m * mult, 10),
      mghPerMonth: p.mghPerMonth ?? (wide ? BAL.mgh.wide : BAL.mgh.narrow),
      excessRate: BAL.excessRate,
      cycleFee: wide ? BAL.cycleFee.wide : BAL.cycleFee.narrow,
      positioningBillable: true,
    };
  }
  // Charter: ACMI-equivalent hours (incl. empty legs) at the rate, plus pass-through, plus margin (RESEARCH §4.4).
  const hotel = BAL.hotelPerNight[g.company.policies.hotelTier] ?? 140;
  const perDiem = (BAL.perDiem.CPT + BAL.perDiem.FO + 4 * BAL.perDiem.CC) / 6;
  const fac = Math.min(p.estBH, p.fuelAtCostBH ?? 0);
  const pass =
    (p.estBH - fac) * t.fuelTBH * g.market.fuelPrice +
    (p.departures ?? 2) * BAL.airportFees[wide ? 1 : 0] +
    (p.revDepartures ?? 1) * BAL.catering[wide ? 1 : 0] +
    (p.roomNights ?? 0) * hotel +
    (p.crewDays ?? 0) * perDiem +
    (p.tickets ?? 0);
  const price = roundTo((p.estBH * R * m * mult + pass) * BAL.charterMargin, 1000);
  const gov = !!p.government;
  return {
    kind: 'charter',
    price: Math.max(1000, price),
    depositPct: gov ? 0 : BAL.charterDeposit,
    balanceDaysBefore: gov ? 0 : BAL.charterBalanceDays + Math.floor(hashUnit(`${p.start}:${p.typeId}:${p.archetype}`) * 8),
    fuelEscalation: p.archetype === 'tourSeries',
    ...(fac > 0 ? { fuelAtCost: true as const } : {}),
  };
}

/**
 * Crew tickets a charter trip is expected to need: a slip crew when the day's flying from base and back can't fit
 * one 13 h duty (sent out and brought home), or the set flying home and back out during a stay of 4+ nights.
 */
export function tripTickets(home: string, farthest: string, crewN: number, dutyMin: number, spanMin: number): number {
  const nights = Math.floor(spanMin / DAY + 0.3);
  if (!(nights === 0 && dutyMin > 13 * 60) && nights < 4) return 0;
  const km = distance(home, farthest);
  const [a, b, c] = BAL.deadheadTicket;
  return crewN * 2 * (km < 1_500 ? a : km < 4_000 ? b : c);
}

/** Days of [start, end) inside month k (fractional). */
export function activeDays(start: Minute, end: Minute, k: MonthKey): number {
  return Math.max(0, Math.min(end, monthStart(k + 1)) - Math.max(start, monthStart(k))) / DAY;
}

/** Pro-rated MGH of one aircraft for month k. */
export function mghInMonth(mghPerMonth: number, start: Minute, end: Minute, k: MonthKey): number {
  return (mghPerMonth * activeDays(start, end, k)) / daysInMonth(k);
}

/** Total pro-rated MGH of one aircraft over the term. */
export function mghTotal(mghPerMonth: number, start: Minute, end: Minute): number {
  let s = 0;
  for (let k = monthKey(start); monthStart(k) < end; k++) s += mghInMonth(mghPerMonth, start, end, k);
  return s;
}

/** Offer/contract MGH text: 'MGH 244' (per month), or 'MGH ≈40 BH for the job' when the term (or Hajj phases) is under a month. */
export function mghLabel(product: Product, start: Minute, end: Minute, terms?: [Minute, Minute][]): string {
  if (product.kind !== 'wet') return '';
  const span = terms?.length ? terms.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) : end - start;
  if (span >= 28 * DAY) return `MGH ${product.mghPerMonth}`;
  const job = terms?.length ? terms.reduce((s, [a, b]) => s + mghTotal(product.mghPerMonth, a, b), 0) : mghTotal(product.mghPerMonth, start, end);
  return `MGH ≈${Math.round(job)} BH for the job`;
}

/** Contract value at a price for one aircraft (wet: MGH × rate + excess over it; charter: price; dry: rent). v0.8: MGH over `terms` only when given (Hajj phases). */
export function productValue(product: Product, estBH: number, start: Minute, end: Minute, terms?: [Minute, Minute][]): number {
  if (product.kind === 'charter') return product.price;
  const months = Math.max(0, end - start) / (30.44 * DAY);
  if (product.kind === 'dry') return Math.round(product.rentPerMonth * months);
  const mgh = terms?.length ? terms.reduce((s, [a, b]) => s + mghTotal(product.mghPerMonth, a, b), 0) : mghTotal(product.mghPerMonth, start, end);
  if (mgh <= 0) return Math.round(product.ratePerBH * estBH);
  const excess = Math.max(0, estBH - mgh);
  return Math.round(product.ratePerBH * mgh + product.excessRate * product.ratePerBH * excess);
}

/** Seats of a type's default cabin. */
export const defaultSeats = (typeId: string) => {
  const c = ACMI_TYPES[typeId].cabins[0];
  return c.j + c.w + c.y;
};

/** v0.10 rare old types (a few dozen built or left): work is never sized or priced off them. */
const RARE = new Set(['b753', 'a342', 'a345', 'a346']);
/** Old types the market prices off only when nothing mainstream fits (RESEARCH §4.2: unloved types). */
const UNLOVED = new Set(['a343', 'b752', ...RARE]);

/**
 * Reference type (DESIGN §5.1.3): the cheapest available shortlist type with a cabin preset that meets the seat
 * range (and layout, family, body) and that can fly every sector (with fuel stops unless noTechStops / noStops).
 * Unloved old types (A340-300, 757-200) only when no mainstream type fits.
 */
type RefReq = Pick<Requirements, 'minSeats'> & Partial<Pick<Requirements, 'maxSeats' | 'layout' | 'families' | 'noTechStops' | 'layouts' | 'minPremium' | 'body'>>;

/** The most seats a narrowbody cabin preset has (the 757-200's 235Y). */
const NB_MAX_SEATS = Math.max(...ACMI_TYPES_LIST.filter((t) => t.body === 'narrow' && t.available && !RARE.has(t.id)).flatMap((t) => t.cabins.map((c) => c.j + c.w + c.y)));

/** v0.9 §Y.2: jumbo loads start at 420 passengers; a jumbo type seats 450 or more (777-300ER, 747-400, A380). */
export const JUMBO_SEATS = 420;
export const isJumboType = (typeId: string): boolean => (ACMI_TYPES[typeId]?.cabins ?? []).some((c) => c.j + c.w + c.y >= 450);

/** v0.8 fix pack: a widebody job: the client asks for one, or no narrowbody cabin seats it. Pure. */
export const isWideJob = (req: Pick<Requirements, 'minSeats' | 'body'>): boolean => (req.body ? req.body === 'wide' : req.minSeats > NB_MAX_SEATS);

export function referenceType(req: RefReq, sectors: [string, string][], noStops = false, ulr = false): string | null {
  return refPass(req, sectors, noStops, false, ulr) ?? refPass(req, sectors, noStops, true, ulr);
}

function refPass(req: RefReq, sectors: [string, string][], noStops: boolean, unloved: boolean, ulr: boolean): string | null {
  let best: { id: string; rate: number } | null = null;
  // v0.7: accepted layouts (VIP presets when the work wants one) and premium seats.
  const layouts = req.layouts ?? (req.layout ? [req.layout] : null);
  for (const t of ACMI_TYPES_LIST) {
    if (!t.available || (t.ulr && !ulr) || UNLOVED.has(t.id) !== unloved) continue;
    if (req.families?.length && !req.families.includes(t.family)) continue;
    // v0.8 fix pack: the body the client asks for (a widebody base, Hajj, Antarctica).
    if (req.body && req.body !== t.body) continue;
    // v0.9 jumbo loads (420+ passengers) price on a 400-seat type (777-300ER, 747-400), never a 440-seat A330 squeeze.
    if (req.minSeats >= JUMBO_SEATS && !isJumboType(t.id)) continue;
    const fits = (layouts?.includes('vip') ? cabinPresets(t.id) : t.cabins).some((c) => {
      const seats = c.j + c.w + c.y;
      return seats >= req.minSeats && (!req.maxSeats || seats <= req.maxSeats) && (!layouts || layouts.includes(c.layout)) && (!req.minPremium || c.j + c.w >= req.minPremium);
    });
    if (!fits) continue;
    const flies = sectors.every(([a, b]) => {
      const sp = planSector(t.id, a, b);
      return sp.ok && (!(noStops || req.noTechStops) || !sp.techStops.length);
    });
    if (!flies) continue;
    if (!best || t.rateBH < best.rate) best = { id: t.id, rate: t.rateBH };
  }
  return best?.id ?? null;
}
