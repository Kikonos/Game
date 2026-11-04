// v0.16 Finance (UPDATE-0.16.md §A; lane `finance`): the bank's benchmark, a revolving credit line with covenants,
// loans secured on owned aircraft, sale and leaseback with the operating lessors, invoice factoring, the client deposit
// as a negotiation lever and interest on spare cash. Money moves only through core/ledger.ts (interest and fees on the
// statement under 'interest', 'bankFees', 'interestIncome'; draws, repayments, advances and proceeds are cashOnly and
// recorded in g.treasury). Pure reads are listed in core/plumbing.test.ts.
//
// Step 0 (the shared skeleton): the record, its load defaults and the pure reads are real; every action answers "not
// yet" and the monthly / daily passes do nothing, so a game plays on exactly as before. The lane fills them in.

import { BAL } from '../core/balance';
import type { ActionResult, AircraftLoan, CreditLine, GameState, MonthKey, Treasury } from '../core/types';
import type { ForecastItem } from '../ops/finance';

const F = BAL.v016.finance;

/** The finance record (created empty on first use: older saves never had one). */
export function treasury(g: GameState): Treasury {
  const t = (g.treasury ??= { loans: [], mmAccrued: 0, factored: [], stats: { interest: 0, fees: 0, factored: 0, leasebacks: 0, loans: 0, drawnMax: 0 } });
  t.loans ??= [];
  t.factored ??= [];
  t.mmAccrued ??= 0;
  t.stats ??= { interest: 0, fees: 0, factored: 0, leasebacks: 0, loans: 0, drawnMax: 0 };
  return t;
}

/** Load (and new game): the record's defaults (SAVE_VERSION stays 1). */
export function loadTreasury(g: GameState): void {
  treasury(g);
}

/** The bank's benchmark rate a year (EURIBOR / SOFR-like), moved by the market phase (§A.1). Pure. */
export function benchmarkRate(g: GameState): number {
  const phase = g.market.cycle?.phase ?? 'steady';
  return Math.round((F.benchmark + (F.benchmarkByPhase[phase] ?? 0)) * 10_000) / 10_000;
}

/** Owned aircraft book value in the fleet (delivered or not). Pure. */
export function ownedBookValue(g: GameState): number {
  return Object.values(g.fleet).reduce((s, a) => s + (a.ownership.kind === 'owned' ? a.ownership.bookValue : 0), 0);
}

/** Average monthly revenue of the last `revenueWindow` closed months (0 with fewer than `minStatements`). Pure. */
export function averageRevenue(g: GameState): number {
  const C = F.credit;
  const hist = g.finance.history.slice(-C.revenueWindow);
  if (hist.length < C.minStatements) return 0;
  const rev = hist.reduce((s, st) => s + Object.entries(st.lines).reduce((r, [k, v]) => r + (k === 'acmiRevenue' || k === 'charterRevenue' || k === 'otherRevenue' || k === 'leaseIncome' ? v ?? 0 : 0), 0), 0);
  return rev / hist.length;
}

/** The limit the bank would set today (§A.2); 0 while there are too few statements. Pure. */
export function creditLimitFor(g: GameState): number {
  const C = F.credit;
  const avg = averageRevenue(g);
  if (!avg) return 0;
  let limit = Math.round((C.revenueMonths * avg + C.bookShare * ownedBookValue(g)) / C.roundTo) * C.roundTo;
  limit = Math.max(C.limit[0], Math.min(C.limit[1], limit));
  if ((g.company.standing ?? 0) === 0) limit = Math.min(limit, C.newcomerCap);
  return limit;
}

/** The margin over the benchmark by standing (§A.2). Pure. */
export const creditMargin = (g: GameState): number => F.credit.margin[(g.company.standing ?? 0) as 0 | 1 | 2];

export interface CreditView {
  line: CreditLine;
  /** Interest rate a year on the drawn balance now. */
  rate: number;
  undrawn: number;
  /** Plain lines for the card: covenants, fees, the next renewal. */
  lines: string[];
}

/** The credit line for the Finance card; null when none is open. Pure. */
export function creditView(g: GameState): CreditView | null {
  const line = g.treasury?.credit;
  if (!line) return null;
  return { line, rate: benchmarkRate(g) + line.margin, undrawn: Math.max(0, line.limit - line.drawn), lines: [] };
}

/** The loan on an aircraft, if any. Pure. */
export const loanOn = (g: GameState, aircraftId: string): AircraftLoan | undefined => g.treasury?.loans.find((l) => l.aircraftId === aircraftId && l.balance > 0);

/** Drawn credit plus loan balances. Pure. */
export function totalDebt(g: GameState): number {
  const t = g.treasury;
  if (!t) return 0;
  return (t.credit?.drawn ?? 0) + t.loans.reduce((s, l) => s + l.balance, 0);
}

const notYet = (): ActionResult => ({ ok: false, error: 'Not available yet' });

// ---------- credit line ----------

export function openCreditLine(_g: GameState): ActionResult {
  return notYet();
}
export function drawCredit(_g: GameState, _amount: number): ActionResult {
  return notYet();
}
export function repayCredit(_g: GameState, _amount: number): ActionResult {
  return notYet();
}

// ---------- aircraft loans ----------

export interface LoanQuote {
  aircraftId: string; bank: string; value: number; principal: number; years: number; rate: number; instalment: number; fee: number;
  /** Why not (plain), null when possible. */
  why: string | null;
}

/** A loan quote on an owned aircraft for a term (§A.3); null when the aircraft cannot be borrowed against. Pure. */
export function loanQuote(_g: GameState, _aircraftId: string, _years: number): LoanQuote | null {
  return null;
}
export function takeLoan(_g: GameState, _aircraftId: string, _years: number): ActionResult {
  return notYet();
}
export function repayLoan(_g: GameState, _loanId: string): ActionResult {
  return notYet();
}

// ---------- sale and leaseback ----------

export interface LeasebackQuote {
  aircraftId: string; lessor: string; price: number; years: number; rentPerMonth: number; reservesPerFH: number; deposit: number; bookValue: number; gain: number;
  /** A loan repaid from the proceeds. */
  loanRepaid: number;
  why: string | null;
}

/** A sale-and-leaseback quote (§A.4); null when not possible. Pure. */
export function leasebackQuote(_g: GameState, _aircraftId: string, _years: number): LeasebackQuote | null {
  return null;
}
export function sellAndLeaseBack(_g: GameState, _aircraftId: string, _years: number): ActionResult {
  return notYet();
}

// ---------- factoring ----------

export interface FactorQuote {
  receivableId: string; amount: number; advance: number; fee: number; balance: number; recourse: boolean; feePct: number;
  why: string | null;
}

/** A factoring quote on an open receivable (§A.5); null when not eligible. Pure. */
export function factorQuote(_g: GameState, _receivableId: string, _recourse: boolean): FactorQuote | null {
  return null;
}
export function factorInvoice(_g: GameState, _receivableId: string, _recourse: boolean): ActionResult {
  return notYet();
}

// ---------- client deposits ----------

/** The deposit a client of this kind expects on a charter (§A.6). Step 0: today's flat share for everyone but a government. */
export function depositNorm(g: GameState, clientId: string): number {
  const c = g.clients[clientId];
  return c?.kind === 'government' ? 0 : BAL.charterDeposit;
}

export interface DepositEffect {
  /** Acceptance chance change (points, −0.12 = 12 points lower) and the client's floor change. */
  acceptDelta: number;
  floorDelta: number;
  /** 'Lower chance they accept: −12 points' / 'Usual for a tour operator'. */
  text: string;
}

/** What asking `pct` deposit does to the client's answer (§A.6). Step 0: nothing. Pure. */
export function depositEffect(_g: GameState, _offerId: string, _pct: number): DepositEffect {
  return { acceptDelta: 0, floorDelta: 0, text: '' };
}

// ---------- passes ----------

/** Daily: the cards (loan due, headroom, factoring buy-back ahead). Step 0: nothing. */
export function dailyTreasury(_g: GameState): void {}

/** Month end (before the statement closes): interest and fees, covenants, loan instalments, the money market. Step 0: nothing. */
export function monthlyTreasury(_g: GameState, _k: MonthKey): void {}

/** The forecast's financing items: loan instalments, credit repayments, factored balances due. Step 0: none. Pure. */
export function treasuryForecastItems(_g: GameState, _days: number): ForecastItem[] {
  return [];
}
