// v0.16 Finance (UPDATE-0.16.md §A; lane `finance`): the bank's benchmark, a revolving credit line with covenants,
// loans secured on owned aircraft, sale and leaseback with the operating lessors, invoice factoring, the client deposit
// as a negotiation lever and interest on spare cash. Money moves only through core/ledger.ts (interest and fees on the
// statement under 'interest', 'bankFees', 'interestIncome'; draws, repayments, advances and proceeds are cashOnly and
// recorded in g.treasury). Pure reads are listed in core/plumbing.test.ts.
//
// Realism notes: covenant waivers and margin ratchets are how banks really react before pulling a line; a frozen RCF
// with a repayment schedule is the "amend and extend" of a stressed borrower; lease rate factors of 0.75–1.1 % a month
// are what the big lessors quote for mid-life and older jets; receivables financing advances 90–95 % and keeps the rest
// until the debtor pays.

import { ageFactor } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { chance } from '../core/rng';
import { statsV016 } from '../core/stats016';
import { DAY, fmtDate, fmtDay, monthKey, monthStart, nextMonthStart, yearOf } from '../core/time';
import type { ActionResult, Aircraft, AircraftLoan, ContractOffer, CreditLine, GameState, Minute, MonthKey, Receivable, Treasury } from '../core/types';
import { clamp, hashUnit } from '../core/util';
import { cashForecast, daysOverdue, monthEndBill, type ForecastItem } from '../ops/finance';
import { usd } from '../ops/util';
import { covenantBreachCard, creditHeadroomCard, factorRecourseCard, loanDueCard } from '../problems/money';
import { postProblem } from '../problems';
import { lockOf } from '../scenario/rules';

const F = BAL.v016.finance;
const YEAR = 365 * DAY;
const MONTH = 30.44 * DAY;

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
  const t = treasury(g);
  if (t.credit) {
    t.credit.clean ??= 0;
    t.credit.repay ??= [];
  }
  for (const l of t.loans) l.missed ??= [];
  // A factored invoice that was paid while the list still names it (a written-off one stays until the bank has settled
  // it: dailyFactoring takes the advance back or books the bank's loss).
  t.factored = t.factored.filter((id) => {
    const r = g.finance.receivables.find((x) => x.id === id);
    return !!r && (r.paid === null || r.written) && !!r.factor && !r.factor.settled && !r.factor.boughtBack;
  });
}

/** '7.0 %' → '7 %', '2.5 %'. */
export const pct1 = (r: number): string => `${(r * 100).toFixed(1).replace(/\.0$/, '')} %`;

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

/** The market value of an airframe today: the type's used value × the age factor × the segment's index (the sale quote's basis). Pure. */
export function marketValueOf(g: GameState, ac: Pick<Aircraft, 'typeId' | 'builtYear'>): number {
  const t = typeOf(ac.typeId);
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  return t.valueUsed * ageFactor(age) * (t.body === 'wide' ? g.market.wideIndex : g.market.narrowIndex);
}

/** Drawn credit plus loan balances. Pure. */
export function totalDebt(g: GameState): number {
  const t = g.treasury;
  if (!t) return 0;
  return (t.credit?.drawn ?? 0) + t.loans.reduce((s, l) => s + l.balance, 0);
}

/** Net debt: drawn credit and loan balances less cash in hand. Pure. */
export const netDebt = (g: GameState): number => totalDebt(g) - Math.max(0, g.company.cash);

/**
 * EBITDA of the last 12 closed months: profit with interest and bank fees added back, aircraft purchases and sale
 * gains taken out (the leverage covenant's denominator). Pure.
 */
export function ebitda12(g: GameState): number {
  return g.finance.history.slice(-12).reduce((s, st) => {
    const l = st.lines;
    const profit = Object.values(l).reduce((p, v) => p + (v ?? 0), 0);
    return s + profit - (l.interest ?? 0) - (l.bankFees ?? 0) - (l.capex ?? 0) - (l.assetSale ?? 0);
  }, 0);
}

export interface CovenantCheck {
  liquidity: boolean;
  leverage: boolean;
  /** Cash plus undrawn credit, and next month's bill. */
  liquid: number;
  bill: number;
  netDebt: number;
  ebitda12: number;
  /** Net debt allowed by the leverage covenant. */
  debtCap: number;
}

/** The two covenants as the bank reads them today (§A.2). Pure. */
export function covenantCheck(g: GameState, k: MonthKey = monthKey(g.now)): CovenantCheck {
  const C = F.credit;
  const line = g.treasury?.credit;
  const undrawn = line && !line.frozen ? Math.max(0, line.limit - line.drawn) : 0;
  const liquid = g.company.cash + undrawn;
  const bill = monthEndBill(g, k + 1).total * C.liquidityMonths;
  const nd = netDebt(g);
  const e = ebitda12(g);
  const debtCap = Math.max(0, e) * C.leverage;
  return { liquidity: liquid >= bill, leverage: nd <= 0 || (e > 0 && nd <= debtCap), liquid, bill, netDebt: nd, ebitda12: e, debtCap };
}

export interface CreditView {
  line: CreditLine;
  /** Interest rate a year on the drawn balance now. */
  rate: number;
  undrawn: number;
  /** Plain lines for the card: rates, covenants, the next renewal. */
  lines: string[];
  /** Interest and the commitment fee this month so far. */
  accrued: number;
  status: 'open' | 'breach' | 'frozen' | 'closing';
  /** Repayments scheduled (frozen or re-sized). */
  repay: { at: Minute; amount: number }[];
  covenants: CovenantCheck;
}

/** The credit line for the Finance card; null when none is open. Pure. */
export function creditView(g: GameState): CreditView | null {
  const line = g.treasury?.credit;
  if (!line) return null;
  const rate = benchmarkRate(g) + line.margin;
  const undrawn = line.frozen ? 0 : Math.max(0, line.limit - line.drawn);
  const cov = covenantCheck(g);
  const lines: string[] = [
    `${pct1(rate)} a year on what is drawn (bank rate ${pct1(benchmarkRate(g))} + margin ${pct1(line.margin)}${line.stepUp ? ', stepped up after a breach' : ''}); ${pct1(F.credit.commitmentFee)} on the undrawn part`,
    `Covenant: cash + undrawn (${usd(cov.liquid)}) ≥ next month's bill (${usd(cov.bill)})${cov.liquidity ? '' : ' · broken'}`,
    `Covenant: net debt (${usd(cov.netDebt)}) ≤ ${F.credit.leverage} × yearly EBITDA (${usd(cov.debtCap)})${cov.leverage ? '' : ' · broken'}`,
  ];
  if (line.notRenewed) lines.push(`Not renewed: ${usd(line.drawn)} repaid on the bank's schedule, then closed`);
  else if (line.frozen) lines.push(`Frozen since ${fmtDay(line.frozen)}: no draws; the balance is repaid in ${F.credit.repayParts} parts at the next month ends`);
  else lines.push(`Renews ${fmtDate(line.renewsAt)}: the bank re-sizes the limit to your revenue and fleet`);
  const status = line.notRenewed ? 'closing' : line.frozen ? 'frozen' : line.breaches > 0 ? 'breach' : 'open';
  return { line, rate, undrawn, lines, accrued: line.accrued + line.accruedFee, status, repay: line.repay ?? [], covenants: cov };
}

/** The loan on an aircraft, if any. Pure. */
export const loanOn = (g: GameState, aircraftId: string): AircraftLoan | undefined => g.treasury?.loans.find((l) => l.aircraftId === aircraftId && l.balance > 0);

// ---------- credit line ----------

/** Why the line cannot be opened now (plain), null when it can. Pure. */
export function creditOpenWhy(g: GameState): string | null {
  if (g.treasury?.credit) return 'A credit line is already open';
  // v0.15 Scenarios (Cash Crunch): the bank already carries the overdraft and no one else lends; a new line would sidestep the goal.
  if (g.scen?.noRescue) return 'The bank already carries our overdraft: no new line in this scenario';
  if (g.finance.history.length < F.credit.minStatements) return `The bank wants ${F.credit.minStatements} closed monthly statements first`;
  if (!creditLimitFor(g)) return 'No revenue on the statements yet: the bank sizes the line on revenue';
  if (g.company.cash < 0) return 'The bank will not open a line while cash is below zero';
  return null;
}

/** The arrangement fee on a limit. Pure. */
export const arrangementFee = (limit: number): number => Math.max(F.credit.arrangementMin, Math.round(limit * F.credit.arrangementFee));

export function openCreditLine(g: GameState): ActionResult {
  const why = creditOpenWhy(g);
  if (why) return { ok: false, error: why };
  const t = treasury(g);
  const limit = creditLimitFor(g);
  const fee = arrangementFee(limit);
  post(g, 'bankFees', -fee);
  t.stats.fees += fee;
  t.credit = { limit, drawn: 0, margin: creditMargin(g), openedAt: g.now, renewsAt: g.now + YEAR, accrued: 0, accruedFee: 0, breaches: 0, clean: 0, repay: [] };
  pushMessage(g, {
    tone: 'info', cat: 'finance', title: `Credit line opened: ${usd(limit)}`, cue: null,
    body: `The bank gives us a revolving line of ${usd(limit)} for a year. ${pct1(benchmarkRate(g) + t.credit.margin)} a year on what is drawn, ${pct1(F.credit.commitmentFee)} on the rest; arrangement fee ${usd(fee)}. Two covenants are checked at each month end: cash plus undrawn credit must cover next month's bill, and net debt must stay under ${F.credit.leverage} × yearly EBITDA.`,
  });
  return { ok: true, msg: `Credit line of ${usd(limit)} open; arrangement fee ${usd(fee)}` };
}

/** A draw rounded down to the bank's step. Pure. */
export const drawStepOf = (amount: number): number => Math.floor(amount / F.credit.drawStep) * F.credit.drawStep;

export function drawCredit(g: GameState, amount: number): ActionResult {
  const line = g.treasury?.credit;
  if (!line) return { ok: false, error: 'No credit line open' };
  if (line.frozen) return { ok: false, error: 'The bank froze the line: no draws until it is cured and renewed' };
  const undrawn = Math.max(0, line.limit - line.drawn);
  const a = Math.min(drawStepOf(amount), undrawn);
  if (a <= 0) return { ok: false, error: undrawn < F.credit.drawStep ? 'Nothing left to draw' : `Draw in steps of ${usd(F.credit.drawStep)}` };
  cashOnly(g, a);
  line.drawn += a;
  const t = treasury(g);
  t.stats.drawnMax = Math.max(t.stats.drawnMax, line.drawn);
  statsV016(g).draws++;
  return { ok: true, msg: `Drew ${usd(a)}; ${usd(line.drawn)} drawn, ${usd(line.limit - line.drawn)} left` };
}

export function repayCredit(g: GameState, amount: number): ActionResult {
  const line = g.treasury?.credit;
  if (!line) return { ok: false, error: 'No credit line open' };
  if (line.drawn <= 0) return { ok: false, error: 'Nothing is drawn' };
  const a = Math.min(Math.round(amount), line.drawn, Math.max(0, g.company.cash));
  if (a <= 0) return { ok: false, error: g.company.cash <= 0 ? 'No cash to repay with' : 'Enter an amount' };
  cashOnly(g, -a);
  line.drawn -= a;
  // The bank's schedule shrinks with what is repaid early.
  if (line.repay?.length) {
    let left = a;
    for (const r of line.repay) {
      const cut = Math.min(r.amount, left);
      r.amount -= cut;
      left -= cut;
    }
    line.repay = line.repay.filter((r) => r.amount > 0);
  }
  const drawn = line.drawn;
  if (line.notRenewed && line.drawn <= 0) closeLine(g, 'Repaid in full after the bank did not renew it.');
  return { ok: true, msg: `Repaid ${usd(a)}; ${usd(Math.max(0, drawn))} drawn` };
}

/** Closes a line with nothing drawn (the player's choice). */
export function closeCreditLine(g: GameState): ActionResult {
  const line = g.treasury?.credit;
  if (!line) return { ok: false, error: 'No credit line open' };
  if (line.drawn > 0) return { ok: false, error: `Repay the ${usd(line.drawn)} drawn first` };
  closeLine(g, 'Closed at our request.');
  return { ok: true, msg: 'Credit line closed' };
}

function closeLine(g: GameState, why: string): void {
  const t = treasury(g);
  const line = t.credit;
  if (!line) return;
  settleAccrued(g, line);
  t.credit = null;
  pushMessage(g, { tone: 'info', cat: 'finance', title: 'Credit line closed', body: `${why} Nothing is drawn.`, cue: 'message' });
}

/** Posts the interest and commitment fee accrued so far (month end, or when the line closes). */
function settleAccrued(g: GameState, line: CreditLine): void {
  const t = treasury(g);
  const i = Math.round(line.accrued), f = Math.round(line.accruedFee);
  if (i) post(g, 'interest', -i);
  if (f) post(g, 'bankFees', -f);
  t.stats.interest += i;
  t.stats.fees += f;
  line.accrued = 0;
  line.accruedFee = 0;
}

/** Schedules `amount` of the drawn balance for repayment in `parts` at the month ends after `from`. */
function scheduleRepay(line: CreditLine, from: Minute, amount: number, parts: number): void {
  line.repay ??= [];
  const each = Math.ceil(amount / parts / 1000) * 1000;
  let left = amount;
  let t = nextMonthStart(from);
  for (let i = 0; i < parts && left > 0; i++) {
    const a = i === parts - 1 ? left : Math.min(each, left);
    line.repay.push({ at: t, amount: a });
    left -= a;
    t = nextMonthStart(t);
  }
}

/** Daily: interest on the drawn balance and the commitment fee on the undrawn part, accrued (posted at month end). */
function accrueCredit(g: GameState, line: CreditLine): void {
  const rate = benchmarkRate(g) + line.margin;
  line.accrued += (line.drawn * rate) / 365;
  const undrawn = line.frozen ? 0 : Math.max(0, line.limit - line.drawn);
  line.accruedFee += (undrawn * F.credit.commitmentFee) / 365;
}

/** The yearly renewal (daily check): re-sized to the formula; a line still in breach at the anniversary is not renewed; one frozen but cured since is thawed. */
function renewCredit(g: GameState): void {
  const line = g.treasury?.credit;
  if (!line || g.now < line.renewsAt || line.notRenewed) return;
  const t = treasury(g);
  if (line.frozen && line.breaches > 0) {
    line.notRenewed = true;
    line.limit = line.drawn;
    if (!line.repay?.length && line.drawn > 0) scheduleRepay(line, g.now, line.drawn, F.credit.repayParts);
    pushMessage(g, {
      tone: 'bad', cat: 'finance', title: 'The bank did not renew the credit line', cue: 'latePayer',
      body: `It was frozen at the anniversary. ${line.drawn > 0 ? `The ${usd(line.drawn)} drawn is repaid at the next ${line.repay?.length ?? 0} month ends; then the line closes.` : 'Nothing is drawn: the line closes.'} A new line can be asked for once the statements look better.`,
    });
    if (line.drawn <= 0) closeLine(g, 'Not renewed by the bank.');
    return;
  }
  // v0.16 review: a line frozen in breach but cured since thaws at the anniversary, as the cure message promised (the
  // freeze's repayment schedule goes; what is drawn above the new limit is scheduled below as for any re-size).
  const thawed = !!line.frozen;
  if (thawed) {
    line.frozen = null;
    line.repay = [];
  }
  const limit = creditLimitFor(g) || line.limit;
  const margin = creditMargin(g) + (line.stepUp ? F.credit.stepUp : 0);
  const fee = arrangementFee(limit);
  post(g, 'bankFees', -fee);
  t.stats.fees += fee;
  const was = line.limit;
  line.limit = limit;
  line.margin = margin;
  line.renewsAt = g.now + YEAR;
  if (line.drawn > limit) scheduleRepay(line, g.now, line.drawn - limit, F.credit.repayParts);
  pushMessage(g, {
    tone: limit >= was ? 'info' : 'warn', cat: 'finance', title: `Credit line renewed: ${usd(limit)}`, cue: 'message',
    body: `${thawed ? 'The freeze is lifted: the covenants held again. ' : ''}${limit > was ? 'Up' : limit < was ? 'Down' : 'Unchanged'} from ${usd(was)}, sized on the last six months' revenue and the owned fleet. Margin ${pct1(margin)} over the bank rate; arrangement fee ${usd(fee)}.${line.drawn > limit ? ` ${usd(line.drawn - limit)} above the new limit is repaid at the next ${F.credit.repayParts} month ends.` : ''}`,
  });
}

/** Month end: the scheduled repayments due (frozen thirds, a re-sized limit), swept even below zero. */
function runRepaySchedule(g: GameState, line: CreditLine, end: Minute): void {
  if (!line.repay?.length) return;
  const due = line.repay.filter((r) => r.at <= end);
  if (!due.length) return;
  line.repay = line.repay.filter((r) => r.at > end);
  let total = 0;
  for (const r of due) {
    const a = Math.min(r.amount, line.drawn);
    if (a <= 0) continue;
    cashOnly(g, -a);
    line.drawn -= a;
    total += a;
  }
  if (total > 0) {
    const more = line.repay.reduce((s, r) => s + r.amount, 0);
    pushMessage(g, { tone: 'warn', cat: 'finance', title: `Credit line: ${usd(total)} repaid on the bank's schedule`, body: `${usd(line.drawn)} still drawn${more ? `; ${usd(more)} more at the next ${line.repay.length} month end${line.repay.length === 1 ? '' : 's'}` : ''}.`, cue: 'message' });
  }
  if (line.notRenewed && line.drawn <= 0) closeLine(g, 'Repaid in full after the bank did not renew it.');
}

/** Month end: the covenants and their consequences (§A.2). */
function checkCovenants(g: GameState, line: CreditLine, k: MonthKey): void {
  const C = F.credit;
  const t = treasury(g);
  const cov = covenantCheck(g, k);
  line.last = { t: g.now, liquidity: cov.liquidity, leverage: cov.leverage, netDebt: cov.netDebt, ebitda12: cov.ebitda12 };
  if (cov.liquidity && cov.leverage) {
    const wasBreach = line.breaches > 0;
    line.breaches = 0;
    line.clean = (line.clean ?? 0) + 1;
    if (line.stepUp && line.clean >= C.cleanMonths) {
      line.stepUp = false;
      line.margin = creditMargin(g);
      pushMessage(g, { tone: 'good', cat: 'finance', title: 'The bank drops the margin step-up', body: `${C.cleanMonths} clean month ends in a row: the margin goes back to ${pct1(line.margin)} over the bank rate.`, cue: 'message' });
    }
    if (wasBreach) pushMessage(g, { tone: 'good', cat: 'finance', title: 'Covenants cured', body: `Both covenants hold again at this month end.${line.frozen ? ' The line stays frozen until the renewal.' : ''}`, cue: 'message' });
    return;
  }
  line.breaches++;
  line.clean = 0;
  statsV016(g).breaches++;
  const which = !cov.liquidity && !cov.leverage ? 'both covenants' : !cov.liquidity ? 'the liquidity covenant' : 'the leverage covenant';
  if (line.breaches === 1) {
    const fee = Math.round(line.limit * C.waiverFee);
    post(g, 'bankFees', -fee);
    t.stats.fees += fee;
    const card = covenantBreachCard(g);
    if (card) postProblem(g, card, { cat: 'finance', tone: 'bad', cue: 'latePayer', tail: `Waiver fee ${usd(fee)} charged. Cure it by the next month end: a second month costs ${pct1(C.stepUp)} more margin, a third freezes the line.` });
    else pushMessage(g, { tone: 'bad', cat: 'finance', title: `The bank's covenant is broken (${which})`, body: `Waiver fee ${usd(fee)}. Cure it by the next month end.`, cue: 'latePayer' });
  } else if (line.breaches === 2 && !line.stepUp) {
    line.stepUp = true;
    line.margin += C.stepUp;
    pushMessage(g, { tone: 'bad', cat: 'finance', title: `Second month in breach: margin up ${pct1(C.stepUp)}`, body: `${which[0].toUpperCase()}${which.slice(1)} still broken. The line now costs ${pct1(benchmarkRate(g) + line.margin)} a year on what is drawn. A third month freezes it.`, cue: 'latePayer' });
  } else if (line.breaches >= C.freezeAfter && !line.frozen) {
    line.frozen = g.now;
    if (line.drawn > 0) scheduleRepay(line, g.now, line.drawn, C.repayParts);
    pushMessage(g, {
      tone: 'bad', cat: 'finance', title: 'The bank froze the credit line', cue: 'cashNegative',
      body: `Third month in breach (${which}). No more draws${line.drawn > 0 ? `; the ${usd(line.drawn)} drawn is taken back in ${C.repayParts} parts at the next month ends, even if that puts cash below zero` : ''}. The freeze lifts at the renewal if the covenants hold by then.`,
    });
  } else {
    pushMessage(g, { tone: 'bad', cat: 'finance', title: `Still in breach (${which})`, body: `Month ${line.breaches} in a row. Repay, chase receivables, sell an invoice or find work.`, cue: 'latePayer' });
  }
}

// ---------- aircraft loans ----------

const BANKS = ['BNP Paribas', 'Crédit Agricole CIB', 'Société Générale', 'Deutsche Bank', 'MUFG', 'Citi', 'Santander', 'Natixis', 'ING'];

export interface LoanQuote {
  aircraftId: string; bank: string; value: number; principal: number; years: number; rate: number; instalment: number; fee: number;
  /** Total interest over the term. */
  interest: number;
  /** The terms the bank offers for this airframe (years). */
  terms: number[];
  /** Why not (plain), null when possible. */
  why: string | null;
}

/** The monthly annuity for `principal` at `rate` a year over `months`. Pure. */
export function annuity(principal: number, rate: number, months: number): number {
  const r = rate / 12;
  if (r <= 0) return Math.round(principal / months);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/** The loan terms (years) an airframe can carry: the aircraft stays ≤ maxAgeAtEnd at the end. Pure. */
export function loanTermsFor(g: GameState, ac: Pick<Aircraft, 'builtYear'>): number[] {
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  return F.loan.terms.filter((y) => age + y <= F.loan.maxAgeAtEnd);
}

/** A loan quote on an owned aircraft for a term (§A.3); `why` says what stands in the way. Pure. */
export function loanQuote(g: GameState, aircraftId: string, years: number): LoanQuote | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const L = F.loan;
  const value = marketValueOf(g, ac);
  const principal = Math.max(0, Math.floor((value * L.ltv) / 10_000) * 10_000);
  const rate = Math.round((benchmarkRate(g) + L.margin) * 10_000) / 10_000;
  const terms = loanTermsFor(g, ac);
  const y = terms.includes(years) ? years : terms[terms.length - 1] ?? years;
  const months = y * 12;
  const instalment = annuity(principal, rate, months);
  const bank = BANKS[Math.floor(hashUnit(`bank:${ac.id}`) * BANKS.length)];
  const q: LoanQuote = { aircraftId, bank, value, principal, years: y, rate, instalment, fee: Math.round(principal * L.arrangementFee), interest: instalment * months - principal, terms, why: null };
  const lk = lockOf(g, 'fleet');
  if (ac.ownership.kind !== 'owned') q.why = 'Only an aircraft we own can be borrowed against';
  else if (ac.status === 'delivering') q.why = `${ac.reg} has not been delivered yet`;
  else if (ac.sale) q.why = `${ac.reg} is sold to ${ac.sale.buyer}: hands over ${fmtDay(ac.sale.closes)}`;
  else if (ac.status === 'stored' || ac.status === 'leasedOut') q.why = `${ac.reg} is not on the AOC`;
  else if (loanOn(g, aircraftId)) q.why = `${ac.reg} already carries a loan: repay it first`;
  else if (g.scen?.noSale) q.why = 'The bank already holds it as security for the overdraft';
  else if (lk) q.why = lk;
  else if (!terms.length) q.why = `Too old: the bank wants the aircraft under ${L.maxAgeAtEnd} at the end of the term`;
  else if (principal < L.minLoan) q.why = `Worth too little: ${Math.round(L.ltv * 100)} % of ${usd(value)} is under the bank's ${usd(L.minLoan)} minimum`;
  return q;
}

export function takeLoan(g: GameState, aircraftId: string, years: number): ActionResult {
  const q = loanQuote(g, aircraftId, years);
  if (!q) return { ok: false, error: 'Aircraft not found' };
  if (q.why) return { ok: false, error: q.why };
  if (!q.terms.includes(years)) return { ok: false, error: `Terms offered: ${q.terms.join(', ')} years` };
  const ac = g.fleet[aircraftId];
  const t = treasury(g);
  cashOnly(g, q.principal);
  post(g, 'bankFees', -q.fee);
  t.stats.fees += q.fee;
  t.stats.loans++;
  statsV016(g).loans++;
  const loan: AircraftLoan = {
    id: nextId(g, 'ln'), aircraftId, bank: q.bank, principal: q.principal, balance: q.principal, rate: q.rate, months: years * 12, instalment: q.instalment,
    start: g.now, nextDue: nextMonthStart(g.now), paid: 0, missed: [],
  };
  t.loans.push(loan);
  pushMessage(g, {
    tone: 'info', cat: 'finance', title: `Loan on ${ac.reg}: ${usd(q.principal)} from ${q.bank}`, cue: null, ref: { kind: 'aircraft', id: ac.id },
    body: `${years} years at ${pct1(q.rate)} fixed: ${usd(q.instalment)} a month from ${fmtDay(loan.nextDue)}, ${usd(q.interest)} interest over the term; arrangement fee ${usd(q.fee)}. ${ac.reg} cannot be sold until the loan is repaid (${Math.round(F.loan.earlyFee * 100)} % early repayment fee, ${Math.round(F.loan.earlyFeeLate * 100)} % after half the term).`,
  });
  return { ok: true, msg: `${usd(q.principal)} in from ${q.bank}; ${usd(q.instalment)} a month for ${years} years` };
}

/** The early repayment cost of a loan today: balance plus the fee. Pure. */
export function loanPayoff(g: GameState, loanId: string): { balance: number; fee: number; total: number } | null {
  const l = g.treasury?.loans.find((x) => x.id === loanId);
  if (!l) return null;
  const fee = l.calledAt ? 0 : Math.round(l.balance * (l.paid >= l.months / 2 ? F.loan.earlyFeeLate : F.loan.earlyFee));
  return { balance: l.balance, fee, total: l.balance + fee };
}

export function repayLoan(g: GameState, loanId: string): ActionResult {
  const t = treasury(g);
  const l = t.loans.find((x) => x.id === loanId);
  if (!l) return { ok: false, error: 'Loan not found' };
  const p = loanPayoff(g, loanId)!;
  if (g.company.cash < p.total) return { ok: false, error: `Repaying takes ${usd(p.total)}; cash is ${usd(g.company.cash)}` };
  payOffLoan(g, l, p.fee, 'repaid early');
  return { ok: true, msg: `Loan repaid: ${usd(p.balance)}${p.fee ? ` plus ${usd(p.fee)} early repayment fee` : ''}` };
}

/** Clears a loan's balance (cashOnly) with a fee (bankFees) and drops it from the list. */
function payOffLoan(g: GameState, l: AircraftLoan, fee: number, how: string): void {
  const t = treasury(g);
  cashOnly(g, -l.balance);
  if (fee) {
    post(g, 'bankFees', -fee);
    t.stats.fees += fee;
  }
  const reg = g.fleet[l.aircraftId]?.reg ?? 'the aircraft';
  pushMessage(g, { tone: 'good', cat: 'finance', title: `Loan on ${reg} ${how}`, body: `${usd(l.balance)} paid to ${l.bank}${fee ? ` with a ${usd(fee)} fee` : ''}. ${reg} is free of charge again.`, cue: 'message', ref: { kind: 'aircraft', id: l.aircraftId } });
  l.balance = 0;
  t.loans = t.loans.filter((x) => x.id !== l.id);
  t.repaid = (t.repaid ?? 0) + 1;
}

/** Repays the loan on an aircraft out of a sale's or leaseback's proceeds (ops/sale.ts onSaleClose, sellAndLeaseBack). Returns what it took. */
export function repayLoanFromProceeds(g: GameState, aircraftId: string): number {
  const l = loanOn(g, aircraftId);
  if (!l) return 0;
  const p = loanPayoff(g, l.id)!;
  payOffLoan(g, l, p.fee, 'repaid from the sale');
  return p.total;
}

/** Month end: each loan's instalment due (interest on the statement, principal as a balance-sheet move); misses and the call. */
function runLoans(g: GameState, end: Minute): void {
  const t = treasury(g);
  for (const l of [...t.loans]) {
    if (l.balance <= 0 || l.calledDue || l.nextDue > end) continue;
    const reg = g.fleet[l.aircraftId]?.reg ?? 'the aircraft';
    const interest = Math.round((l.balance * l.rate) / 12);
    const principal = Math.min(l.balance, l.instalment - interest);
    const short = g.company.cash < interest + principal;
    post(g, 'interest', -interest);
    cashOnly(g, -principal);
    t.stats.interest += interest;
    l.balance -= principal;
    l.paid++;
    l.nextDue = nextMonthStart(l.nextDue);
    delete l.warnedAt;
    if (short) {
      const late = Math.round(l.instalment * F.loan.lateFee);
      post(g, 'bankFees', -late);
      t.stats.fees += late;
      l.missed.push(g.now);
      const recent = l.missed.filter((m) => g.now - m <= YEAR).length;
      if (recent >= F.loan.callAfterMissed && l.balance > 0) {
        l.calledAt = g.now;
        l.calledDue = g.now + F.loan.callDays * DAY;
        pushMessage(g, {
          tone: 'bad', cat: 'finance', title: `${l.bank} calls the loan on ${reg}`, cue: 'cashNegative', ref: { kind: 'aircraft', id: l.aircraftId },
          body: `Two instalments missed in a year. The whole balance of ${usd(l.balance)} is due on ${fmtDay(l.calledDue)}; the bank takes it then, whatever the cash. Sell or lease back ${reg}, draw on the credit line or find the money.`,
        });
      } else {
        pushMessage(g, { tone: 'warn', cat: 'finance', title: `Loan instalment on ${reg} paid late`, cue: 'latePayer', ref: { kind: 'aircraft', id: l.aircraftId }, body: `Cash was short on the day: the ${usd(l.instalment)} was still taken plus a ${usd(late)} late fee. A second miss within a year and the bank calls the loan.` });
      }
    }
    if (l.balance <= 0) {
      t.loans = t.loans.filter((x) => x.id !== l.id);
      t.repaid = (t.repaid ?? 0) + 1;
      pushMessage(g, { tone: 'good', cat: 'finance', title: `Loan on ${reg} paid off`, body: `The last instalment went to ${l.bank}. ${reg} is free of charge again.`, cue: 'message', ref: { kind: 'aircraft', id: l.aircraftId } });
    }
  }
}

/** Daily: a called loan's balance taken on its day; the loanDue card ahead of an instalment the forecast cannot pay. */
function dailyLoans(g: GameState): void {
  const t = treasury(g);
  for (const l of [...t.loans]) {
    if (l.calledDue && g.now >= l.calledDue) {
      const reg = g.fleet[l.aircraftId]?.reg ?? 'the aircraft';
      const bal = l.balance;
      cashOnly(g, -bal);
      l.balance = 0;
      t.loans = t.loans.filter((x) => x.id !== l.id);
      t.repaid = (t.repaid ?? 0) + 1;
      pushMessage(g, { tone: 'bad', cat: 'finance', title: `${l.bank} took ${usd(bal)} for the loan on ${reg}`, body: `The called loan was due today. Cash is ${usd(g.company.cash)}.`, cue: 'latePayer', ref: { kind: 'aircraft', id: l.aircraftId } });
      continue;
    }
    const due = l.calledDue ?? l.nextDue;
    if (l.warnedAt === due || due - g.now > F.loan.warnDays * DAY) continue;
    const card = loanDueCard(g, l.id);
    if (!card) continue;
    l.warnedAt = due;
    postProblem(g, card, { cat: 'finance', cue: 'notice' });
  }
}

// ---------- sale and leaseback ----------

export interface LeasebackQuote {
  aircraftId: string; lessor: string; price: number; years: number; rentPerMonth: number; reservesPerFH: number; deposit: number; bookValue: number; gain: number;
  /** A loan repaid from the proceeds (balance plus its early repayment fee). */
  loanRepaid: number;
  /** Cash in at signing: price less the deposit and the loan. */
  cashIn: number;
  /** The lease rate factor a month, and the terms offered (years). */
  lrf: number;
  terms: number[];
  /** Rent over the whole term. */
  totalRent: number;
  why: string | null;
}

/** The leaseback terms (years) an airframe can carry (≤ maxAgeAtEnd at the end). Pure. */
export function leasebackTermsFor(g: GameState, ac: Pick<Aircraft, 'builtYear'>): number[] {
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  return F.leaseback.terms.filter((y) => age + y <= F.leaseback.maxAgeAtEnd);
}

/** A sale-and-leaseback quote (§A.4); `why` says what stands in the way. Pure. */
export function leasebackQuote(g: GameState, aircraftId: string, years: number): LeasebackQuote | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const B = F.leaseback;
  const t = typeOf(ac.typeId);
  const age = Math.max(0, yearOf(g.now) - ac.builtYear);
  const value = marketValueOf(g, ac);
  const share = (g.company.standing ?? 0) === 0 ? B.priceShareNewcomer : B.priceShare;
  const price = Math.round((value * share) / B.roundTo) * B.roundTo;
  const terms = leasebackTermsFor(g, ac);
  const y = terms.includes(years) ? years : terms[terms.length - 1] ?? years;
  const lrf = clamp(B.lrf.base + B.lrf.perAgeYear * Math.max(0, age - B.lrf.ageFrom), B.lrf.clamp[0], B.lrf.clamp[1]);
  const rentPerMonth = Math.round((price * lrf) / 1000) * 1000;
  const reservesPerFH = Math.round((t.maintBH * 0.42) / 10) * 10;
  const deposit = B.depositMonths * rentPerMonth;
  const lessor = B.lessors[Math.floor(hashUnit(`lessor:${ac.id}`) * B.lessors.length)];
  const bookValue = ac.ownership.kind === 'owned' ? ac.ownership.bookValue : 0;
  const loan = loanOn(g, aircraftId);
  const loanRepaid = loan ? loanPayoff(g, loan.id)!.total : 0;
  const q: LeasebackQuote = {
    aircraftId, lessor, price, years: y, rentPerMonth, reservesPerFH, deposit, bookValue, gain: price - bookValue, loanRepaid, cashIn: price - deposit - loanRepaid,
    lrf, terms, totalRent: rentPerMonth * y * 12, why: null,
  };
  const lk = lockOf(g, 'fleet');
  if (ac.ownership.kind !== 'owned') q.why = 'Only an aircraft we own can be sold and leased back';
  else if (ac.status === 'delivering') q.why = `${ac.reg} has not been delivered yet`;
  else if (ac.sale) q.why = `${ac.reg} is already sold to ${ac.sale.buyer}`;
  else if (ac.status === 'stored' || ac.status === 'leasedOut') q.why = `${ac.reg} is not on the AOC`;
  else if (g.scen?.noSale) q.why = 'The bank holds it as security for the overdraft: it cannot be sold now';
  else if (lk) q.why = lk;
  else if (!terms.length) q.why = `Too old: the lessors want the aircraft under ${B.maxAgeAtEnd} at the end of the lease`;
  else if (q.cashIn <= 0) q.why = `The price (${usd(price)}) does not cover the loan (${usd(loanRepaid)}) and the deposit (${usd(deposit)})`;
  return q;
}

export function sellAndLeaseBack(g: GameState, aircraftId: string, years: number): ActionResult {
  const q = leasebackQuote(g, aircraftId, years);
  if (!q) return { ok: false, error: 'Aircraft not found' };
  if (q.why) return { ok: false, error: q.why };
  if (!q.terms.includes(years)) return { ok: false, error: `Terms offered: ${q.terms.join(', ')} years` };
  const ac = g.fleet[aircraftId];
  const t = treasury(g);
  const book = q.bookValue;
  // Cash moves by exactly the price; the statement shows the gain or loss over book value (as ops/sale.ts closes a sale).
  cashOnly(g, book);
  post(g, 'assetSale', q.price - book);
  repayLoanFromProceeds(g, aircraftId);
  cashOnly(g, -q.deposit);
  const wide = typeOf(ac.typeId).body === 'wide';
  const leaseEnd = g.now + Math.round(years * 12 * MONTH);
  ac.ownership = {
    kind: 'dryLeaseIn', lessor: q.lessor, rentPerMonth: q.rentPerMonth, reservesPerFH: q.reservesPerFH, leaseStart: g.now, leaseEnd, deposit: q.deposit,
    returnSite: g.company.homeBase, deliveredLayout: ac.cabin.layout, index: wide ? g.market.wideIndex : g.market.narrowIndex,
    // No rent before today: this month is billed from the signing (ops/finance rentOver reads prevRent).
    prevRent: { until: g.now, rent: 0 }, leaseback: true,
  };
  t.stats.leasebacks++;
  statsV016(g).leasebacks++;
  const gain = q.price - book;
  pushMessage(g, {
    tone: 'good', cat: 'finance', title: `${ac.reg} sold to ${q.lessor} and leased back`, cue: null, ref: { kind: 'aircraft', id: ac.id },
    body: `${usd(q.price)} in (a ${usd(Math.abs(gain))} ${gain >= 0 ? 'gain over' : 'loss against'} book value)${q.loanRepaid ? `, ${usd(q.loanRepaid)} of it clears the loan` : ''}; deposit ${usd(q.deposit)} out. ${ac.reg} stays in the fleet with its crews, contracts and livery as a ${years}-year lease: ${usd(q.rentPerMonth)} a month from today, ${usd(q.reservesPerFH)} reserves per flight hour, back to ${q.lessor} by ${fmtDate(leaseEnd)} in half-life condition.`,
  });
  return { ok: true, msg: `${usd(q.cashIn)} in; ${ac.reg} leased back at ${usd(q.rentPerMonth)} a month for ${years} years` };
}

// ---------- factoring ----------

export interface FactorQuote {
  receivableId: string; amount: number;
  /** The bank's advance (95 % / 92 %), its fee taken out of it, what lands now (advance − fee) and the balance when the client pays (amount − advance). */
  advance: number; fee: number; now: number; balance: number; recourse: boolean; feePct: number;
  /** Days to the due date (negative: overdue). */
  days: number;
  why: string | null;
}

/** Factored invoices still open (against the bank's cap). Pure. */
export function factoredOutstanding(g: GameState): number {
  return g.finance.receivables.reduce((s, r) => s + (r.paid === null && r.factor && !r.factor.settled && !r.factor.boughtBack ? r.amount : 0), 0);
}

/** A factoring quote on an open receivable (§A.5); `why` says what stands in the way. Pure. */
export function factorQuote(g: GameState, receivableId: string, recourse: boolean): FactorQuote | null {
  const r = g.finance.receivables.find((x) => x.id === receivableId);
  if (!r) return null;
  const X = F.factoring;
  const days = Math.ceil((r.due - g.now) / DAY);
  const over = Math.max(0, daysOverdue(g, r));
  let pct = days >= 0 ? X.feeBase + X.feePerDay * days : X.overdueBase + X.overduePerDay * over;
  if (!recourse) pct += X.nonRecourse + (g.clients[r.clientId]?.kind === 'government' ? X.government : 0);
  pct = clamp(pct, X.feeClamp[0], X.feeClamp[1]);
  const advance = Math.round(r.amount * (recourse ? X.advance : X.advanceNonRecourse));
  const fee = Math.round(r.amount * pct);
  const q: FactorQuote = { receivableId, amount: r.amount, advance, fee, now: advance - fee, balance: Math.max(0, r.amount - advance), recourse, feePct: pct, days, why: null };
  if (r.paid !== null) q.why = 'Already paid';
  else if (r.written) q.why = 'Written off: nobody buys it';
  else if (r.factor || r.factored) q.why = 'Already sold to the bank';
  else if (r.amount < X.minAmount) q.why = `Under the bank's ${usd(X.minAmount)} minimum`;
  else if (days > X.maxDaysToDue) q.why = `Due in ${days} days: the bank buys invoices due within ${X.maxDaysToDue}`;
  else if (over > X.maxOverdueDays) q.why = `${over} days overdue: the bank buys invoices up to ${X.maxOverdueDays} days late`;
  else if (factoredOutstanding(g) + r.amount > X.totalCap) q.why = `The bank's cap of ${usd(X.totalCap)} in factored invoices would be passed`;
  return q;
}

export function factorInvoice(g: GameState, receivableId: string, recourse: boolean): ActionResult {
  const q = factorQuote(g, receivableId, recourse);
  if (!q) return { ok: false, error: 'Invoice not found' };
  if (q.why) return { ok: false, error: q.why };
  const r = g.finance.receivables.find((x) => x.id === receivableId)!;
  const t = treasury(g);
  cashOnly(g, q.advance);
  post(g, 'bankFees', -q.fee);
  t.stats.fees += q.fee;
  t.stats.factored += r.amount;
  statsV016(g).factored++;
  r.factor = { advance: q.advance, fee: q.fee, recourse, at: g.now };
  r.factored = true;
  t.factored.push(r.id);
  const name = g.clients[r.clientId]?.name ?? 'The client';
  pushMessage(g, {
    tone: 'info', cat: 'finance', title: `Invoice sold: ${usd(q.now)} in`, cue: null, ref: { kind: 'receivable', id: r.id },
    body: `${name}'s ${usd(r.amount)} for ${r.desc}, ${recourse ? 'with' : 'without'} recourse: ${usd(q.advance)} advanced less a ${usd(q.fee)} fee (${(q.feePct * 100).toFixed(1)} %), so ${usd(q.now)} in now; the last ${usd(q.balance)} when ${name} pays the bank.${recourse ? ` If they have not paid ${F.factoring.buyBackDays} days past due we buy it back.` : ' If they never pay, that is the bank\'s loss.'}`,
  });
  return { ok: true, msg: `${usd(q.now)} in now; ${usd(q.balance)} when ${name} pays` };
}

/** ops/finance.ts onPayment: what reaches us when a receivable is paid (the balance of a factored one: the amount less the bank's advance; its fee came out of the advance). Pure. */
export function paidToUs(r: Receivable): number {
  if (!r.factor || r.factor.boughtBack) return r.amount;
  return Math.max(0, r.amount - r.factor.advance);
}

/** ops/finance.ts onPayment: a factored invoice the client paid is settled with the bank. */
export function settleFactored(g: GameState, r: Receivable): void {
  if (!r.factor || r.factor.settled || r.factor.boughtBack) return;
  r.factor.settled = g.now;
  const t = treasury(g);
  t.factored = t.factored.filter((id) => id !== r.id);
}

/** Daily: recourse buy-backs (90 days past due, or the client collapsed), non-recourse write-offs settled, the warning card. */
function dailyFactoring(g: GameState): void {
  const t = treasury(g);
  if (!t.factored.length) return;
  for (const id of [...t.factored]) {
    const r = g.finance.receivables.find((x) => x.id === id);
    // v0.16 review: an administration writes the invoice off and marks it paid at once (commercial/crises.ts); the bank
    // still has to settle it with us below, so a written-off one is not dropped here.
    if (!r || (r.paid !== null && !r.written) || !r.factor || r.factor.settled || r.factor.boughtBack) {
      t.factored = t.factored.filter((x) => x !== id);
      continue;
    }
    const name = g.clients[r.clientId]?.name ?? 'The client';
    const over = daysOverdue(g, r);
    if (!r.factor.recourse) {
      if (r.written) {
        r.factor.settled = g.now;
        t.factored = t.factored.filter((x) => x !== id);
        pushMessage(g, { tone: 'info', cat: 'finance', title: `${name}'s invoice is the bank's loss`, body: `Sold without recourse: the ${usd(r.amount)} they will never pay is the bank's problem, not ours.`, cue: 'message', ref: { kind: 'receivable', id: r.id } });
      }
      continue;
    }
    if (r.written || over >= F.factoring.buyBackDays) {
      cashOnly(g, -r.factor.advance);
      r.factor.boughtBack = g.now;
      r.factored = false;
      t.factored = t.factored.filter((x) => x !== id);
      pushMessage(g, {
        tone: 'bad', cat: 'finance', title: `Invoice bought back: ${usd(r.factor.advance)} out`, cue: 'latePayer', ref: { kind: 'receivable', id: r.id },
        body: r.written ? `${name} collapsed and the invoice was sold with recourse: the bank hands it back and takes its ${usd(r.factor.advance)} advance.` : `${name} has not paid ${over} days past due. Sold with recourse, the ${usd(r.amount)} invoice is ours again and the bank takes back its ${usd(r.factor.advance)} advance; the fee stays with them.`,
      });
      continue;
    }
    if (over >= F.factoring.warnDays && !g.messages.some((m) => m.problem?.kind === 'factorRecourse' && m.ref?.id === r.id)) {
      const card = factorRecourseCard(g, r.id);
      if (card) postProblem(g, card, { cat: 'finance', cue: 'notice' });
    }
  }
}

// ---------- client deposits ----------

/** The deposit a client of this kind expects on a charter (§A.6): the kind's norm, 10 points less for a level 3–4 client, 0 for a government. Pure. */
export function depositNorm(g: GameState, clientId: string): number {
  const c = g.clients[clientId];
  if (!c) return BAL.charterDeposit;
  if (c.kind === 'government') return 0;
  const D = F.deposit;
  let norm = D.norm[c.kind] ?? BAL.charterDeposit;
  if ((c.prestige ?? 2) >= 3) norm = Math.max(0, norm - D.prestigeLess);
  return Math.round(norm * 100) / 100;
}

export interface DepositEffect {
  /** Acceptance chance change (points, −0.12 = 12 points lower) and the client's floor change. */
  acceptDelta: number;
  floorDelta: number;
  /** 'Lower chance they accept: −12 points' / 'Usual for a tour operator'. */
  text: string;
  /** The client's norm. */
  norm: number;
}

const KIND_WORD: Record<string, string> = {
  airline: 'an airline', tourOperator: 'a tour operator', government: 'a government', agency: 'an agency', sports: 'a sports club', music: 'a tour promoter', corporate: 'a company', broker: 'a broker', operator: 'an operator',
};

/** What asking `pct` deposit does to the client's answer (§A.6). Pure. */
export function depositEffect(g: GameState, offerId: string, pct: number): DepositEffect {
  const o = g.offers[offerId];
  const norm = o ? depositNorm(g, o.clientId) : BAL.charterDeposit;
  const D = F.deposit;
  const steps = Math.round((pct - norm) * 10);
  const who = KIND_WORD[g.clients[o?.clientId ?? '']?.kind ?? ''] ?? 'this client';
  if (steps > 0) {
    const d = D.abovePer10 * steps;
    return { acceptDelta: d, floorDelta: 0, norm, text: `Lower chance they accept: ${Math.round(d * 100)} points. ${Math.round(norm * 100)} % is usual for ${who}.` };
  }
  if (steps < 0) {
    const d = D.belowPer10 * -steps;
    return { acceptDelta: d, floorDelta: D.belowFloorPer10 * -steps, norm, text: `Better chance they accept: +${Math.round(d * 100)} points, and they go a little further on price. ${Math.round(norm * 100)} % is usual for ${who}.` };
  }
  return { acceptDelta: 0, floorDelta: 0, norm, text: norm > 0 ? `Usual for ${who}.` : `${who[0].toUpperCase()}${who.slice(1)} pays after the job: no deposit is usual.` };
}

/**
 * contracts/accept.ts: the deposit a plain accept signs with. Above the norm the client may insist on the norm instead
 * ("20 % is what we do"): a 25 % chance per 10 points above (engine RNG). Returns the share signed.
 */
export function depositSigned(g: GameState, o: ContractOffer, pct: number): number {
  const norm = depositNorm(g, o.clientId);
  const steps = Math.round((pct - norm) * 10);
  if (steps <= 0) return pct;
  if (!chance(g, Math.min(0.95, F.deposit.aboveSignAtNorm * steps))) return pct;
  const name = g.clients[o.clientId]?.name ?? 'The client';
  pushMessage(g, { tone: 'info', cat: 'commercial', title: `${name} signs at a ${Math.round(norm * 100)} % deposit`, body: `We asked ${Math.round(pct * 100)} %. "${norm > 0 ? `${Math.round(norm * 100)} % is what we do` : 'We pay after the job'}", they said, and signed ${o.title} at that.`, cue: null, ref: { kind: 'offer', id: o.id } });
  return norm;
}

// ---------- money market ----------

/** The rate spare cash earns a year: the bank rate less the spread, at least the floor. Pure. */
export const moneyMarketRate = (g: GameState): number => Math.max(F.moneyMarket.floor, benchmarkRate(g) - F.moneyMarket.spread);

/** Cash above the operating float earning interest today. Pure. */
export const moneyMarketBalance = (g: GameState): number => Math.max(0, g.company.cash - F.moneyMarket.float);

function accrueMoneyMarket(g: GameState): void {
  const bal = moneyMarketBalance(g);
  if (bal <= 0) return;
  treasury(g).mmAccrued += (bal * moneyMarketRate(g)) / 365;
}

// ---------- passes ----------

/** Daily: accruals (interest, fees, money market), the renewal, called loans, buy-backs and the cards. */
export function dailyTreasury(g: GameState): void {
  const t = treasury(g);
  if (t.credit) {
    accrueCredit(g, t.credit);
    renewCredit(g);
  }
  accrueMoneyMarket(g);
  dailyLoans(g);
  dailyFactoring(g);
  // Little headroom left (cash plus undrawn under one month's bill), once a fortnight at most, never below zero (the cash card).
  if (t.credit && !t.credit.notRenewed && g.company.cash >= 0 && g.now - (t.headroomAt ?? -Infinity) >= 14 * DAY) {
    const card = creditHeadroomCard(g);
    if (card) {
      t.headroomAt = g.now;
      postProblem(g, card, { cat: 'finance', cue: 'notice' });
    }
  }
}

/** Month end (before the statement closes): interest and fees, the money market, loan instalments, the repayment schedule, the covenants. */
export function monthlyTreasury(g: GameState, k: MonthKey): void {
  const t = treasury(g);
  const end = monthStart(k + 1);
  if (t.credit) settleAccrued(g, t.credit);
  const mm = Math.round(t.mmAccrued);
  if (mm) post(g, 'interestIncome', mm);
  t.mmAccrued = 0;
  runLoans(g, end);
  if (t.credit) {
    runRepaySchedule(g, t.credit, end);
    // A line the bank did not renew is only being repaid: no covenant chase on top.
    if (t.credit && !t.credit.notRenewed) checkCovenants(g, t.credit, k);
  }
}

/** The forecast's financing items: loan instalments and calls, credit repayments, interest and fees at month ends, interest on cash. Pure. */
export function treasuryForecastItems(g: GameState, days: number): ForecastItem[] {
  const t = g.treasury;
  if (!t) return [];
  const out: ForecastItem[] = [];
  const end = g.now + days * DAY;
  for (const l of t.loans ?? []) {
    if (l.balance <= 0) continue;
    if (l.calledDue) {
      if (l.calledDue <= end) out.push({ t: l.calledDue, amount: -l.balance, what: `the called loan on ${g.fleet[l.aircraftId]?.reg ?? 'an aircraft'}` });
      continue;
    }
    let bal = l.balance;
    for (let d = l.nextDue; d <= end && bal > 0; d = nextMonthStart(d)) {
      const interest = Math.round((bal * l.rate) / 12);
      const principal = Math.min(bal, l.instalment - interest);
      out.push({ t: d, amount: -(interest + principal), what: 'loan instalments' });
      bal -= principal;
    }
  }
  const line = t.credit;
  if (line) {
    for (const r of line.repay ?? []) if (r.at <= end) out.push({ t: r.at, amount: -r.amount, what: 'credit line repayments' });
    // Interest and the commitment fee: what is accrued plus the days to each month end at today's balance.
    const rate = benchmarkRate(g) + line.margin;
    const undrawn = line.frozen ? 0 : Math.max(0, line.limit - line.drawn);
    const perDay = (line.drawn * rate + undrawn * F.credit.commitmentFee) / 365;
    let acc = line.accrued + line.accruedFee;
    let from = g.now;
    for (let m = nextMonthStart(g.now); m <= end; m = nextMonthStart(m)) {
      acc += (perDay * (m - from)) / DAY;
      if (Math.round(acc) > 0) out.push({ t: m, amount: -Math.round(acc), what: 'credit line interest and fees' });
      acc = 0;
      from = m;
    }
  }
  const mmBal = moneyMarketBalance(g);
  if (mmBal > 0 || (t.mmAccrued ?? 0) > 0) {
    const perDay = (mmBal * moneyMarketRate(g)) / 365;
    let acc = t.mmAccrued ?? 0;
    let from = g.now;
    for (let m = nextMonthStart(g.now); m <= end; m = nextMonthStart(m)) {
      acc += (perDay * (m - from)) / DAY;
      if (Math.round(acc) > 0) out.push({ t: m, amount: Math.round(acc), what: 'interest on cash' });
      acc = 0;
      from = m;
    }
  }
  return out;
}

/** The cash low between now and `at` (the loanDue card; problems/money.ts). Pure. */
export function cashLowBefore(g: GameState, at: Minute): number {
  const days = Math.max(1, Math.ceil((at - g.now) / DAY));
  return cashForecast(g, days).reduce((m, p) => Math.min(m, p.cash), g.company.cash);
}
