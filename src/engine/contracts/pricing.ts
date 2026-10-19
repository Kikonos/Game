// Pricing per RESEARCH §4 (B1). DESIGN.md §5.1.3–5.1.4.

import { ACMI_TYPES, ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { planSector } from '../core/perf';
import { daysInMonth, monthKey, monthStart, toDate } from '../core/time';
import { hashUnit } from '../core/util';
import type { Archetype, GameState, Minute, MonthKey, Product, Requirements } from '../core/types';

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
  /** Charter pass-through: departures (all legs), revenue departures (catering), crew room-nights, crew person-days away. */
  departures?: number;
  revDepartures?: number;
  roomNights?: number;
  crewDays?: number;
  /** Government payer: no deposit, invoiced on completion. */
  government?: boolean;
  /** Wet MGH per aircraft-month override (AOG cover: 8 BH/day). */
  mghPerMonth?: number;
}

/** Archetype multipliers on the reference type's ACMI rate (DESIGN §5.1.2, RESEARCH §3). */
export const ARCH_MULT: Partial<Record<Archetype, number>> = {
  seasonBase: 1.0, aogCover: 1.5, adhoc: 1.0, sports: 1.3, repatriation: 1.5, tourSeries: 1.0, troopRotation: 1.2,
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
  const type = typeId === 'a343' || typeId === 'b752' ? BAL.premium.oldType : 0;
  const market = (t?.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex) - 1;
  return { season, lead: leadP, type, market, m: 1 + season + leadP + type + market };
}

export const isWetArchetype = (a: Archetype) => a === 'seasonBase' || a === 'aogCover' || a === 'capacityLease';

/** Asking product for an offer: wet (rate/MGH) for base patterns, charter (all-in price) otherwise. */
export function priceProduct(g: GameState, p: PriceInput): Product {
  const t = ACMI_TYPES[p.typeId];
  const R = t.rateBH;
  // Wet deals price the season at the middle of the term; charters at departure.
  const { m } = rateMultiplier(g, p.typeId, isWetArchetype(p.archetype) ? Math.round((p.start + p.end) / 2) : p.start, p.lead);
  const mult = p.mult ?? ARCH_MULT[p.archetype] ?? 1;
  const wide = t.body === 'wide';
  if (isWetArchetype(p.archetype)) {
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
  const pass =
    p.estBH * t.fuelTBH * g.market.fuelPrice +
    (p.departures ?? 2) * BAL.airportFees[wide ? 1 : 0] +
    (p.revDepartures ?? 1) * BAL.catering[wide ? 1 : 0] +
    (p.roomNights ?? 0) * hotel +
    (p.crewDays ?? 0) * perDiem;
  const price = roundTo((p.estBH * R * m * mult + pass) * BAL.charterMargin, 1000);
  const gov = !!p.government;
  return {
    kind: 'charter',
    price: Math.max(1000, price),
    depositPct: gov ? 0 : BAL.charterDeposit,
    balanceDaysBefore: gov ? 0 : BAL.charterBalanceDays + Math.floor(hashUnit(`${p.start}:${p.typeId}:${p.archetype}`) * 8),
    fuelEscalation: p.archetype === 'tourSeries',
  };
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

/** Contract value at a price for one aircraft (wet: MGH × rate + excess over it; charter: price; dry: rent). */
export function productValue(product: Product, estBH: number, start: Minute, end: Minute): number {
  if (product.kind === 'charter') return product.price;
  const months = Math.max(0, end - start) / (30.44 * DAY);
  if (product.kind === 'dry') return Math.round(product.rentPerMonth * months);
  const mgh = mghTotal(product.mghPerMonth, start, end);
  if (mgh <= 0) return Math.round(product.ratePerBH * estBH);
  const excess = Math.max(0, estBH - mgh);
  return Math.round(product.ratePerBH * mgh + product.excessRate * product.ratePerBH * excess);
}

/** Seats of a type's default cabin. */
export const defaultSeats = (typeId: string) => {
  const c = ACMI_TYPES[typeId].cabins[0];
  return c.j + c.w + c.y;
};

/**
 * Reference type (DESIGN §5.1.3): the cheapest available shortlist type with a cabin preset that meets the seat
 * range (and layout, family) and that can fly every sector (with fuel stops unless noTechStops / noStops).
 */
export function referenceType(req: Pick<Requirements, 'minSeats' | 'maxSeats' | 'layout' | 'families' | 'noTechStops'>, sectors: [string, string][], noStops = false): string | null {
  let best: { id: string; rate: number } | null = null;
  for (const t of ACMI_TYPES_LIST) {
    if (!t.available || t.ulr) continue;
    if (req.families?.length && !req.families.includes(t.family)) continue;
    const fits = t.cabins.some((c) => {
      const seats = c.j + c.w + c.y;
      return seats >= req.minSeats && (!req.maxSeats || seats <= req.maxSeats) && (!req.layout || c.layout === req.layout);
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
