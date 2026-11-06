// v0.17 real lease terms (UPDATE-0.17.md §E; lane `supply`): one function prices every lease offer (lessor calls,
// proposals, failure batches, short-term subleases, new-build slots) and the sales of batches and exotics.
// - Rent starts from the type's reference rent at that age (rentForAge on RENT_V017) and takes the factors lessors
//   apply to a lease rate: term, our credit, the market's tightness, the demand index, a little noise, the source.
// - Deposit months by our lessor rating (+1 new build, −1 batch, short-term 1), a holding deposit of one month.
// - Reserves by age (share of maintBH) with minimum hours a month, +3 % a year; return conditions by age.
// An offer without `source` (a legacy offer, or the v0.16 market with BAL.v017.on false) keeps the terms rolled for it.

import { ageFactor, floorRent, RENT_V017, rentForAge, type AcmiType } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { range } from '../core/rng';
import { DAY, monthKey, monthStart, yearOf } from '../core/time';
import type { AgeBand, AircraftOffer, CreditGrade, GameState, LessorId, MonthKey, OfferSource } from '../core/types';
import { clamp } from '../core/util';
import { segIndex, shortName } from '../ops/market';
import { lessorRating } from './credit';
import { isExotic } from './exotic';
import { leasingSide } from './side';
import { tightNow, tightWord } from './tightness';

const T = () => BAL.v017.terms;

/** What makeOffer (and the request, batch, short-term and new-build paths) asks a price for. */
export interface TermsDraft {
  offerId: string;
  typeId: string;
  kind: AircraftOffer['kind'];
  builtYear: number;
  newBuild: boolean;
  source?: OfferSource;
  lessorId?: LessorId;
  band?: AgeBand;
  /** The term asked for (a request), months. A short-term sublease's months are taken as they are. */
  monthsWanted?: number;
  grade?: CreditGrade;
  /** A deposit agreed outside the grade (the post-filing widebody lessor's 1 month). */
  depositMonths?: number;
  /** The legacy terms as rolled by makeOffer (an offer without a source keeps them). */
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
  band?: AgeBand;
  grade?: CreditGrade;
  exoticSecurity?: number;
  reservesDeposit?: number;
}

/** The type with the v0.17 reference rents (RENT_V017) when the v0.17 market is on. Pure. */
export function refType(t: AcmiType): AcmiType {
  const r = BAL.v017.on ? RENT_V017[t.id] : undefined;
  return r ? { ...t, rentMonth: r.rentMonth ?? t.rentMonth, rentNew: r.rentNew ?? t.rentNew } : t;
}

/** The age band of an airframe aged `age` years (BAL.v017.terms.bands). Pure. */
export function bandOf(age: number, newBuild = false): AgeBand {
  if (newBuild) return 'new';
  const B = T().bands;
  if (age < B.young[1]) return 'young';
  if (age < B.mid[1]) return 'mid';
  return 'old';
}

export const BAND_WORD: Record<AgeBand, string> = { new: 'New', young: 'Young', mid: 'Mid-life', old: 'Old' };

/** Our lessor rating for pricing: the daily cache when lane deals has it, else read now. Pure. */
export function gradeNow(g: GameState): { grade: CreditGrade; score: number } {
  const c = g.leasing?.credit;
  if (c && c.at > g.now - DAY) return { grade: c.grade, score: c.score };
  const r = lessorRating(g);
  return { grade: r.grade, score: r.score };
}

/** Deposit months for a grade (§C.2; D: 5, or 7 below a score of 25). Pure. */
export function gradeDepositMonths(grade: CreditGrade, score: number): number {
  const D = BAL.v017.credit.deposit;
  if (grade === 'D') return score < D.DlowBelow ? D.Dlow : D.D;
  return D[grade];
}

/** The term factor of a lease of `months` (§E.1: short leases cost more). Pure. */
export function termFactor(months: number): number {
  for (const [lim, pct] of T().term) if (months <= lim) return pct;
  return 0;
}

/** The term a lessor offers for a band: the request's, moved into the band (§E.4); or one rolled in it (6-month steps). */
export function termFor(band: AgeBand, wanted: number | undefined, roll: () => number): number {
  const [lo, hi] = T().termsByBand[band];
  // Always rolled, so the stream's later rolls (the noise) do not depend on whether a term was asked.
  const x = roll();
  if (wanted !== undefined) return Math.round(clamp(wanted, lo, hi));
  return Math.round(lo / 6 + x * (hi / 6 - lo / 6)) * 6;
}

/** The reserves share of maintBH by age at signing (§E.3). Pure. */
export function reserveShare(band: AgeBand, age: number): number {
  const R = T().reserveShare;
  if (band === 'old' && age >= T().veryOldFrom) return R.veryOld;
  return R[band];
}

const pctText = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`;

/** 'Mid-life A320ceo $220K · 36 months +4 % · normal market −1 % · rating C +5 %' (§E.1). Pure. */
export function whyText(why: { label: string; pct: number }[] | undefined): string {
  if (!why?.length) return '';
  return why.map((w, i) => (i === 0 ? w.label : `${w.label} ${pctText(w.pct)}`)).join(' · ');
}

/**
 * Prices a lease or a sale offer (§E.1–§E.5, §I.2, §J.2–§J.3, §T). Deterministic on the side stream
 * `terms:<offerId>`. An offer without a source (legacy) or the v0.16 market: the draft's terms unchanged. Pure.
 */
export function quoteTerms(g: GameState, d: TermsDraft): TermsQuote {
  const legacy: TermsQuote = { rentPerMonth: d.rentPerMonth, reservesPerFH: d.reservesPerFH, leaseMonths: d.leaseMonths, deposit: d.deposit, price: d.price };
  if (!BAL.v017.on || !d.source) return legacy;
  const t = typeOf(d.typeId);
  const rt = refType(t);
  const r = leasingSide(g, `terms:${d.offerId}`);
  const age = Math.max(0, yearOf(g.now) - d.builtYear);
  const band = d.band ?? bandOf(age, d.newBuild);
  const { grade, score } = d.grade ? { grade: d.grade, score: d.grade === 'D' ? gradeNow(g).score : 50 } : gradeNow(g);
  const idx = segIndex(g, t.body);
  const tight = tightNow(g, t.id);
  const X = BAL.v017.exotic;
  const exotic = isExotic(t.id);
  // ---- Sales: a batch's administrator sells under value, a retiring airline or a storage owner sells an exotic.
  if (d.kind === 'buy') {
    let price = d.price;
    const why: { label: string; pct: number }[] = [];
    if (d.source === 'batch') {
      const disc = range(r, BAL.v017.batch.buyDiscount[0], BAL.v017.batch.buyDiscount[1]);
      price = Math.round((d.price * (1 - disc)) / 10_000) * 10_000;
      why.push({ label: `Sold by the administrator ${usdK(price)}`, pct: 0 }, { label: 'under value', pct: -disc });
    } else if (exotic) {
      const x = range(r, X.sale.priceX[0], X.sale.priceX[1]);
      price = Math.round((t.valueUsed * ageFactor(age) * x * idx) / 10_000) * 10_000;
      why.push({ label: `${BAND_WORD[band]} ${shortName(t)} ${usdK(price)}`, pct: 0 }, { label: 'against its used value', pct: x - 1 });
    }
    return { ...legacy, rentPerMonth: 0, reservesPerFH: 0, leaseMonths: 0, price, deposit: price, band, grade, why, transition: transitionCost(g, t, d.source) };
  }
  // ---- Leases.
  const spot = d.source === 'spot';
  const months = spot ? Math.round(d.monthsWanted ?? 6) : d.newBuild ? termFor('new', d.monthsWanted ?? undefined, () => range(r, 0, 1)) : termFor(band, d.monthsWanted, () => range(r, 0, 1));
  const why: { label: string; pct: number }[] = [];
  let base: number;
  let f = 1;
  if (d.newBuild) {
    const nb = BAL.v017.newBuild.rentX;
    base = (rt.rentNew ?? rt.rentMonth) * range(r, nb[0], nb[1]);
    why.push({ label: `New ${shortName(t)} ${usdK(base)}`, pct: 0 });
  } else if (spot) {
    base = rentForAge(rt, 12);
    why.push({ label: `Mid-life ${shortName(t)} ${usdK(base)}`, pct: 0 });
  } else {
    base = rentForAge(rt, age);
    why.push({ label: `${BAND_WORD[band]} ${shortName(t)} ${usdK(base)}`, pct: 0 });
  }
  if (spot) {
    const p = range(r, BAL.v017.terms.spot[0], BAL.v017.terms.spot[1]);
    f *= 1 + p;
    why.push({ label: `${months}-month sublease`, pct: p });
  } else {
    const tf = termFactor(months);
    f *= 1 + tf;
    if (tf) why.push({ label: `${months} months`, pct: tf });
    const cf = T().credit[grade] ?? 0;
    f *= 1 + cf;
    if (cf) why.push({ label: `rating ${grade}`, pct: cf });
  }
  const tightF = T().tight * (tight - 0.5);
  const marketF = (1 + tightF) * idx - 1;
  f *= (1 + tightF) * idx;
  why.push({ label: `${tightWord(tight).toLowerCase()} market`, pct: marketF });
  // The noise is rolled before the source's factor, so a batch airframe is 8–15 % under the same airframe's call quote.
  const noise = range(r, T().noise[0], T().noise[1]);
  if (d.source === 'batch') {
    const b = range(r, T().batch[0], T().batch[1]);
    f *= 1 + b;
    why.push({ label: 'failure batch', pct: b });
  }
  const rent = floorRent(t, Math.round((base * f * noise) / 1000) * 1000);
  // Deposit months (§E.2): the grade's, +1 new build, −1 batch (min 1); short-term 1 (2 at D); an agreed one kept.
  let dm = gradeDepositMonths(grade, score);
  if (d.newBuild) dm += BAL.v017.newBuild.extraDepositMonths;
  if (d.source === 'batch') dm = Math.max(1, dm - BAL.v017.batch.depositLess);
  if (spot) dm = grade === 'D' ? BAL.v017.spot.depositMonthsD : BAL.v017.spot.depositMonths;
  if (d.depositMonths !== undefined) dm = d.depositMonths;
  // §T an exotic below the lessors' grade: big security (more deposit, reserves up front).
  const RANK = { A: 0, B: 1, C: 2, D: 3 } as const;
  const security = exotic && !spot && RANK[grade] > RANK[X.minGrade as CreditGrade] ? X.securityMonths : 0;
  const deposit = (dm + security) * rent;
  // Reserves (§E.3): by age, ±5 %; short-term at the mid rate with no minimum hours.
  const share = spot ? T().reserveShare.mid : d.newBuild ? T().reserveShare.new : reserveShare(band, age);
  const reservesPerFH = Math.round((t.maintBH * share * range(r, 1 - T().reserveNoise, 1 + T().reserveNoise)) / 10) * 10;
  const minFH = spot ? undefined : t.body === 'wide' ? T().minFH.wide : T().minFH.narrow;
  const resMonths = spot ? 0 : grade === 'D' ? T().reservesDepositMonthsD : security ? X.reservesDepositMonths : 0;
  const reservesDeposit = resMonths && minFH ? Math.round((resMonths * minFH * reservesPerFH) / 1000) * 1000 : 0;
  const halfLifeShare = spot ? 0 : T().halfLife[d.newBuild ? 'new' : band];
  return {
    rentPerMonth: rent, reservesPerFH, leaseMonths: months, deposit, price: 0,
    depositMonths: dm + security, holding: Math.min(deposit, BAL.v017.deal.holdingMonths * rent),
    ...(minFH ? { minFH } : {}), halfLifeShare, why, transition: transitionCost(g, t, d.source), band: d.newBuild ? 'new' : band, grade,
    ...(security ? { exoticSecurity: security * rent } : {}),
    ...(reservesDeposit ? { reservesDeposit } : {}),
  };
}

const usdK = (x: number) => (x >= 1_000_000 ? `$${(Math.round(x / 10_000) / 100).toFixed(2).replace(/\.?0+$/, '')}M` : `$${Math.round(x / 1000)}K`);

/** The transition cost at signing (§G.3): × 1.5 for the first aircraft of a family new to the AOC; short-term half. Pure. */
export function transitionCost(g: GameState, t: AcmiType, source?: OfferSource): number {
  const C = BAL.v017.induction.cost;
  let c = t.body === 'wide' ? C.wide : C.narrow;
  const fams = g.company.aocFamilies;
  if (fams && !fams.includes(t.family)) c *= C.newFamilyX;
  if (source === 'spot') c *= 0.5;
  return Math.round(c / 1000) * 1000;
}

/**
 * The extension rent factor for an extension offered now (§E.6): 12 months `clamp(1 + 0.12 × (tightNow − 0.5),
 * 0.95, 1.06)`, 36 months 0.04 less. Null with the v0.17 market off (the legacy BAL.leaseReturn.extend factors). Pure.
 */
export function extensionRentX(g: GameState, typeId: string, months: 12 | 36): number | null {
  if (!BAL.v017.on || !g.leasing) return null;
  const E = T().extend;
  const x = clamp(1 + E.perTight * (tightNow(g, typeId) - 0.5), E.clamp[0], E.clamp[1]);
  return Math.round((months === 36 ? x + E.long : x) * 1000) / 1000;
}

/** Block hours flown by an aircraft between two day indexes (bhDays, the last 90 days). Pure. */
function hoursFlown(ac: { bhDays?: [number, number][] }, fromDay: number, toDay: number): number {
  let m = 0;
  for (const [d, min] of ac.bhDays ?? []) if (d >= fromDay && d < toDay) m += min;
  return m / 60;
}

/**
 * Minimum-hours reserves of month k (§E.3): for each lease signed in v0.17 with `minFH`, the hours under the minimum
 * (pro rata from the handover and to the lease end) × the reserves rate. A month still running counts the hours flown
 * so far and the last 30 days' pace for the rest. An aircraft leased out counts as flown (its lessee's hours). Pure.
 */
export function minHoursBill(g: GameState, k: MonthKey): number {
  return minHoursLines(g, k).reduce((s, x) => s + x.amount, 0);
}

/** The minimum-hours lines of month k: per aircraft, the unflown hours and the amount. Pure. */
export function minHoursLines(g: GameState, k: MonthKey): { aircraftId: string; reg: string; hours: number; amount: number }[] {
  const out: { aircraftId: string; reg: string; hours: number; amount: number }[] = [];
  if (!BAL.v017.on) return out;
  const a = monthStart(k);
  const b = monthStart(k + 1);
  const today = Math.floor(g.now / DAY);
  for (const ac of Object.values(g.fleet)) {
    const own = ac.ownership;
    if (own.kind !== 'dryLeaseIn' || !own.minFH || ac.status === 'leasedOut') continue;
    const from = Math.max(a, own.leaseStart);
    const to = Math.min(b, own.leaseEnd);
    if (to <= from) continue;
    const need = (own.minFH * (to - from)) / (b - a);
    const d0 = Math.floor(from / DAY);
    const d1 = Math.ceil(to / DAY);
    let flown = hoursFlown(ac, d0, Math.min(d1, today));
    if (d1 > today) {
      const pace = hoursFlown(ac, today - 30, today) / 30;
      flown += pace * (d1 - Math.max(today, d0));
    }
    const hours = Math.max(0, Math.round(need - flown));
    if (hours <= 0) continue;
    out.push({ aircraftId: ac.id, reg: ac.reg, hours, amount: Math.round(hours * own.reservesPerFH) });
  }
  return out;
}

/** The month (key) whose minimum hours are billed at the month end now running (ops/market.ts refreshMarket). */
export const closingMonth = (g: GameState): MonthKey => g.finance.current.month ?? monthKey(g.now - DAY);
