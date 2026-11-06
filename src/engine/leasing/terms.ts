// v0.17 real lease terms (UPDATE-0.17.md §E; lane `supply`): one function prices every lease offer. Step 0: the legacy
// terms come back unchanged (makeOffer rolls them as v0.16 did and passes them through).

import { BAL } from '../core/balance';
import type { AgeBand, AircraftOffer, CreditGrade, GameState, LessorId, MonthKey, OfferSource } from '../core/types';

/** What makeOffer (and later the request, batch, short-term and new-build paths) asks a price for. */
export interface TermsDraft {
  offerId: string;
  typeId: string;
  kind: AircraftOffer['kind'];
  builtYear: number;
  newBuild: boolean;
  source?: OfferSource;
  lessorId?: LessorId;
  band?: AgeBand;
  /** The term asked for (a request), months. */
  monthsWanted?: number;
  grade?: CreditGrade;
  /** The legacy terms as rolled by makeOffer (step 0 returns them). */
  rentPerMonth: number;
  reservesPerFH: number;
  leaseMonths: number;
  deposit: number;
  price: number;
}

/** The terms written onto the offer (only the fields the quote sets). */
export interface TermsQuote {
  rentPerMonth: number;
  reservesPerFH: number;
  leaseMonths: number;
  deposit: number;
  price: number;
  depositMonths?: number;
  holding?: number;
  minFH?: number;
  halfLifeShare?: number;
  why?: { label: string; pct: number }[];
  transition?: number;
}

/** Prices a lease or sale offer (§E.1–§E.5). Step 0: the legacy terms of the draft. Pure (side streams only later). */
export function quoteTerms(g: GameState, d: TermsDraft): TermsQuote {
  void g;
  return { rentPerMonth: d.rentPerMonth, reservesPerFH: d.reservesPerFH, leaseMonths: d.leaseMonths, deposit: d.deposit, price: d.price };
}

/** The age band of an airframe aged `age` years (BAL.v017.terms.bands). Pure. */
export function bandOf(age: number, newBuild = false): AgeBand {
  if (newBuild) return 'new';
  const B = BAL.v017.terms.bands;
  if (age < B.young[1]) return 'young';
  if (age < B.mid[1]) return 'mid';
  return 'old';
}

/**
 * The extension rent factor for an extension offered now (§E.6), or null for the legacy BAL.leaseReturn.extend
 * factors. Step 0: null. Pure.
 */
export function extensionRentX(g: GameState, typeId: string, months: 12 | 36): number | null {
  void g;
  void typeId;
  void months;
  return null;
}

/** The minimum-hours reserves of month k not flown (§E.3), billed at the month end. Step 0: 0. Pure. */
export function minHoursBill(g: GameState, k: MonthKey): number {
  void g;
  void k;
  return 0;
}
