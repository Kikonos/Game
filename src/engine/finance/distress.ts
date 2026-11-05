// v0.16.3 Distress finance: the ways out of debt, each with a price and a consequence (the player: "I'm currently in
// debt for a long time. I want more options to get out of it, with consequences, of course"). Everything moves through
// the ledger: deferred rent and pay stay on the statement as costs the month they fall due while the cash stays with us
// (a payable), repayments are balance-sheet moves swept at month ends, premiums, fees and discounts are posted under
// 'distress', and a restructuring's write-offs are a gain on the same line. Pure reads are listed in
// core/plumbing.test.ts. The secured credit line itself lives in finance/index.ts (borrowingBase, creditTerms).
//
// Realism notes: a lessor will defer two or three months' rent for a premium and a longer lease (it keeps the aircraft
// placed); MROs, handlers and fuel suppliers spread arrears over a few months for a fee before they put a customer on
// cash in advance; a distressed investor takes a stake and a board seat with quarterly targets; furloughs and salary
// deferrals buy months at the cost of morale and people; a Portuguese PER (Processo Especial de Revitalização) freezes
// claims under court protection for a plan the creditors vote on, with a haircut, and ends in recovery or liquidation.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { countryName } from '../../data/countries';
import { BAL } from '../core/balance';
import { nextId } from '../core/entities';
import { cashOnly, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { typeOf } from '../core/perf';
import { chance } from '../core/rng';
import { DAY, fmtDate, fmtDay, monthKey, monthStart, nextMonthStart } from '../core/time';
import type { ActionResult, CreditorGroup, Distress, GameState, Instalment, Minute, MonthKey, PaymentPlan, RentDeferral } from '../core/types';
import { clamp, hashUnit } from '../core/util';
import { cancelByClient } from '../contracts/accept';
import { crewName } from '../crew/generate';
import { moraleShock } from '../crew/morale';
import { removeCrew } from '../crew/roster';
import { rescueNeed, rescueStake } from '../ops/events';
import { cashForecast, daysOverdue, gameOver, monthEndBill, rentOf, type ForecastItem } from '../ops/finance';
import { earlyReturnQuote, returnEarly } from '../ops/leaseReturn';
import { saleQuote, sellAircraft } from '../ops/sale';
import { bumpRelation, bumpReliable, usd } from '../ops/util';
import { postProblem } from '../problems';
import { mkHurt, type ProblemCard } from '../problems/types';
import { factorQuote, marketValueOf, pct1, treasury } from './index';

const D = BAL.v0163;
const MONTH = 30.44 * DAY;

/** The distress record (created empty on first use: older saves never had one). */
export function distress(g: GameState): Distress {
  const t = treasury(g);
  const d = (t.distress ??= { rentDeferrals: [], plans: [], lessorBlock: {}, stats: { deferred: 0, premiums: 0, discounts: 0, furloughSaved: 0, writtenOff: 0 } });
  d.rentDeferrals ??= [];
  d.plans ??= [];
  d.lessorBlock ??= {};
  d.stats ??= { deferred: 0, premiums: 0, discounts: 0, furloughSaved: 0, writtenOff: 0 };
  return d;
}

/** Load (and new game): the record's defaults (SAVE_VERSION stays 1). */
export function loadDistress(g: GameState): void {
  distress(g);
}

/** Below zero, or any way out still running (the Finance panel shows while either holds). Pure. */
export function inDebt(g: GameState): boolean {
  return g.company.cash < 0 || (g.finance.negSince ?? null) !== null;
}

// ---------- the restructuring's reach (read by other modules) ----------

/** The plan period is running: claims frozen, the insolvency clock paused. Pure. */
export const perActive = (g: GameState): boolean => {
  const p = g.treasury?.distress?.per;
  return !!p && !p.exited && !p.failed && g.now < p.until;
};

/** The 'Restructuring' label (rate part, no deposits) stands. Pure. */
export const restructuringLabel = (g: GameState): boolean => {
  const p = g.treasury?.distress?.per;
  return !!p && !p.failed && g.now < p.labelUntil;
};

/** Why the bank lends nothing new (a restructuring within the year), else null. Pure. */
export function noCreditWhy(g: GameState): string | null {
  const p = g.treasury?.distress?.per;
  if (p && !p.failed && g.now < p.noCreditUntil) return `In restructuring: no new credit until ${fmtDay(p.noCreditUntil)}`;
  return null;
}

/** The rate part while labelled (−5 %), else 0. Pure. */
export const restructuringPct = (g: GameState): number => (restructuringLabel(g) ? D.per.ratePct : 0);

/** Deferrals outstanding (rent, plans, pay): what is still to be swept. Pure. */
export function deferredOutstanding(g: GameState): number {
  const d = g.treasury?.distress;
  if (!d) return 0;
  const sum = (xs: Instalment[]) => xs.reduce((s, x) => s + x.amount, 0);
  let out = 0;
  for (const r of d.rentDeferrals ?? []) if (!r.done) out += sum(r.repay) + Math.max(0, r.months - monthsDeferred(g, r)) * 0;
  for (const p of d.plans ?? []) if (!p.done) out += sum(p.repay);
  if (d.salaryDeferral && !d.salaryDeferral.done) out += sum(d.salaryDeferral.repay);
  return out;
}

const monthsDeferred = (g: GameState, r: RentDeferral): number => Math.max(0, Math.min(r.months, monthKey(g.now) - monthKey(r.from)));

/** Sweeps the instalments due by `end`: the amount out as a balance-sheet move, its fee part on the statement. Returns the total. */
function sweep(g: GameState, xs: Instalment[], end: Minute): { total: number; fee: number; left: Instalment[] } {
  let total = 0, fee = 0;
  const left: Instalment[] = [];
  for (const x of xs) {
    if (x.at > end) { left.push(x); continue; }
    const f = Math.min(x.fee, x.amount);
    cashOnly(g, -(x.amount - f));
    if (f) post(g, 'distress', -f);
    total += x.amount;
    fee += f;
  }
  return { total, fee, left };
}

/** `amount` (with `fee` inside it) in `parts` at the month ends from `from`, rounded to $1K. */
function instalments(from: Minute, amount: number, fee: number, parts: number): Instalment[] {
  const out: Instalment[] = [];
  let t = nextMonthStart(from);
  let left = amount, feeLeft = fee;
  const each = Math.ceil(amount / parts / 1000) * 1000;
  const eachFee = Math.round(fee / parts);
  for (let i = 0; i < parts && left > 0; i++) {
    const a = i === parts - 1 ? left : Math.min(each, left);
    const f = i === parts - 1 ? feeLeft : Math.min(eachFee, feeLeft);
    out.push({ at: t, amount: a, fee: f });
    left -= a;
    feeLeft -= f;
    t = nextMonthStart(t);
  }
  return out;
}

// ---------- 2. lessor rent deferral ----------

export interface RentDeferralQuote {
  aircraftId: string; lessor: string; rent: number; months: number; deferred: number; premium: number; extendMonths: number; newLeaseEnd: Minute;
  /** The repayments start at this month end. */
  repayFrom: Minute;
  why: string | null;
}

/** A lessor's deferral of the next `months` rents on a leased aircraft (§2). Pure. */
export function rentDeferralQuote(g: GameState, aircraftId: string, months: number): RentDeferralQuote | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  const R = D.rent;
  const m = R.months.includes(months) ? months : R.months[0];
  const own = ac.ownership;
  const lessor = own.kind === 'dryLeaseIn' ? own.lessor.replace(' (used sale)', '') : '';
  const rent = own.kind === 'dryLeaseIn' ? own.rentPerMonth : 0;
  const deferred = rent * m;
  const extendMonths = R.extendX * m;
  const q: RentDeferralQuote = {
    aircraftId, lessor, rent, months: m, deferred, premium: Math.round(deferred * R.premium), extendMonths,
    newLeaseEnd: own.kind === 'dryLeaseIn' ? own.leaseEnd + Math.round(extendMonths * MONTH) : 0, repayFrom: monthStart(monthKey(g.now) + m + 1), why: null,
  };
  const d = distress(g);
  const open = d.rentDeferrals.find((x) => x.aircraftId === aircraftId && !x.done);
  if (own.kind !== 'dryLeaseIn') q.why = 'Only a leased aircraft has rent to defer';
  else if (ac.status === 'delivering') q.why = `${ac.reg} has not been delivered yet`;
  else if (ac.returning || own.noticeGiven) q.why = `${ac.reg} is going back: ${lessor} wants its rent first`;
  else if (own.leaseEnd - g.now < (m + 1) * MONTH) q.why = `Under ${m + 1} months left on the lease: ${lessor} will not defer`;
  else if (open) q.why = `${lessor} already defers ${ac.reg}'s rent (${usd(open.repay.reduce((s, x) => s + x.amount, 0) || open.deferred)} to repay)`;
  else if (d.rentDeferrals.some((x) => x.lessor === lessor && x.defaulted && !x.done)) q.why = `${lessor} is still owed a missed repayment: no second deferral`;
  else if ((d.lessorBlock[lessor] ?? 0) > g.now) q.why = `${lessor} refuses after the missed repayment, until ${fmtDay(d.lessorBlock[lessor])}`;
  else if (perActive(g)) q.why = 'The plan freezes the lessors\' claims already';
  return q;
}

export function deferRent(g: GameState, aircraftId: string, months: number): ActionResult {
  const q = rentDeferralQuote(g, aircraftId, months);
  if (!q) return { ok: false, error: 'Aircraft not found' };
  if (q.why) return { ok: false, error: q.why };
  const ac = g.fleet[aircraftId];
  if (ac.ownership.kind !== 'dryLeaseIn') return { ok: false, error: q.why ?? 'Not leased' };
  const d = distress(g);
  // The extension: at today's rent (the lessor's price for the favour), from the old lease end.
  ac.ownership.leaseEnd = q.newLeaseEnd;
  const r: RentDeferral = { id: nextId(g, 'rd'), aircraftId, lessor: q.lessor, from: monthStart(monthKey(g.now)), months: q.months, deferred: 0, premium: D.rent.premium, repay: [], extendMonths: q.extendMonths, at: g.now };
  d.rentDeferrals.push(r);
  bumpReliable(g, D.rent.reliable);
  g.company.reputation.clean = clamp(g.company.reputation.clean + D.rent.clean, 0, 100);
  pushMessage(g, {
    tone: 'warn', cat: 'finance', title: `${q.lessor} defers ${ac.reg}'s rent for ${q.months} months`, cue: null, ref: { kind: 'aircraft', id: ac.id },
    body: `The next ${q.months} month-end rents (${usd(q.rent)} each) stay with us. From ${fmtDay(q.repayFrom)} we repay them plus ${Math.round(D.rent.premium * 100)} % (${usd(q.premium)}) over ${q.months} month ends, whatever the cash. The lease runs ${q.extendMonths} months longer, to ${fmtDate(q.newLeaseEnd)}. Lessors talk: reliability ${D.rent.reliable}.`,
  });
  return { ok: true, msg: `${usd(q.deferred)} of rent deferred; the lease runs to ${fmtDate(q.newLeaseEnd)}` };
}

/** Month end k: the rent of a deferred month stays with us (the statement still shows it); the repayments are built; due ones swept. */
function monthlyRent(g: GameState, k: MonthKey, end: Minute): void {
  const d = distress(g);
  for (const r of d.rentDeferrals) {
    if (r.done) continue;
    const ac = g.fleet[r.aircraftId];
    const idx = k - monthKey(r.from);
    if (idx >= 0 && idx < r.months) {
      const rent = ac ? Math.round(rentOf(g, ac, k)) : 0;
      if (rent > 0) {
        cashOnly(g, rent);
        r.deferred += rent;
        d.stats.deferred += rent;
      }
      if (idx === r.months - 1) {
        const premium = Math.round(r.deferred * r.premium);
        r.repay = instalments(end, r.deferred + premium, premium, r.months);
        d.stats.premiums += premium;
        pushMessage(g, { tone: 'info', cat: 'finance', title: `${r.lessor}: ${usd(r.deferred + premium)} of deferred rent to repay`, body: `${ac?.reg ?? 'The aircraft'}: ${usd(r.deferred)} deferred plus the ${usd(premium)} premium, ${r.repay.length} parts from ${fmtDay(r.repay[0]?.at ?? end)}.`, cue: 'message', ref: ac ? { kind: 'aircraft', id: ac.id } : undefined });
      }
      continue;
    }
    if (!r.repay.length) {
      if (idx >= r.months) r.done = g.now;
      continue;
    }
    const before = g.company.cash;
    const sw = sweep(g, r.repay, end);
    r.repay = sw.left;
    if (sw.total > 0) {
      if (before - sw.total < 0 && !r.defaulted) {
        r.defaulted = g.now;
        d.lessorBlock[r.lessor] = g.now + D.rent.blockDays * DAY;
        bumpReliable(g, D.rent.defaultReliable);
        pushMessage(g, { tone: 'bad', cat: 'finance', title: `${r.lessor} took ${usd(sw.total)} from an overdrawn account`, cue: 'latePayer', ref: ac ? { kind: 'aircraft', id: ac.id } : undefined, body: `The deferred rent on ${ac?.reg ?? 'the aircraft'} was due and cash was short. ${r.lessor} will not defer again for a year; reliability ${D.rent.defaultReliable}.` });
      } else {
        pushMessage(g, { tone: 'info', cat: 'finance', title: `Deferred rent repaid: ${usd(sw.total)} to ${r.lessor}`, body: `${ac?.reg ?? 'The aircraft'}${r.repay.length ? `; ${usd(r.repay.reduce((s, x) => s + x.amount, 0))} more at the next ${r.repay.length} month end${r.repay.length === 1 ? '' : 's'}` : ': the deferral is cleared'}.`, cue: 'message', ref: ac ? { kind: 'aircraft', id: ac.id } : undefined });
      }
    }
    if (!r.repay.length) r.done = g.now;
  }
}

// ---------- 3. creditor payment plans ----------

const GROUP_CATS: Record<CreditorGroup, readonly ('maintenance' | 'checks' | 'airportFees' | 'fuel')[]> = { mro: ['maintenance', 'checks'], handling: ['airportFees'], fuel: ['fuel'] };
const GROUP_NAME: Record<CreditorGroup, string> = { mro: 'Maintenance (MRO)', handling: 'Airports and handling', fuel: 'Fuel' };
const CREDITORS: Record<CreditorGroup, string[]> = {
  mro: ['Lufthansa Technik', 'TAP Maintenance & Engineering', 'Iberia Maintenance', 'SR Technics', 'AFI KLM E&M'],
  handling: ['Swissport', 'Menzies Aviation', 'dnata', 'Groundforce Portugal', 'Aviapartner'],
  fuel: ['World Fuel Services', 'Air BP', 'Shell Aviation', 'TotalEnergies Aviation', 'Galp'],
};

export const CREDITOR_GROUPS: CreditorGroup[] = ['mro', 'handling', 'fuel'];
export const creditorGroupName = (gp: CreditorGroup): string => GROUP_NAME[gp];

/** The last two months' bills of a creditor group (this month so far and the last closed one). Pure. */
export function groupBills(g: GameState, gp: CreditorGroup): number {
  const last = g.finance.history[g.finance.history.length - 1];
  let sum = 0;
  for (const cat of GROUP_CATS[gp]) sum += -(g.finance.current.lines[cat] ?? 0) - (last?.lines[cat] ?? 0);
  return Math.max(0, Math.round(sum));
}

export interface PlanQuote {
  group: CreditorGroup; creditor: string; bills: number; amount: number; fee: number; months: number; instalment: number;
  why: string | null;
}

/** A creditor's plan: `share` of the last two months' bills paid back over `months` for a fee (§3). Pure. */
export function planQuote(g: GameState, gp: CreditorGroup, months: number): PlanQuote {
  const P = D.plan;
  const m = P.months.includes(months) ? months : P.months[0];
  const bills = groupBills(g, gp);
  const amount = Math.floor((bills * P.share) / 10_000) * 10_000;
  const feePct = Math.max(P.feeMin, P.feePerMonth * m);
  const fee = Math.round(amount * feePct);
  const creditor = CREDITORS[gp][Math.floor(hashUnit(`${g.seed}:creditor:${gp}`) * CREDITORS[gp].length)];
  const q: PlanQuote = { group: gp, creditor, bills, amount, fee, months: m, instalment: Math.ceil((amount + fee) / m / 1000) * 1000, why: null };
  const d = distress(g);
  const bill = monthEndBill(g, monthKey(g.now)).total;
  if (d.plans.some((p) => p.group === gp && !p.done)) q.why = `${creditor} already runs a plan with us`;
  else if (amount < P.min) q.why = `Too little owed to ${creditor} lately (${usd(bills)}): a plan starts at ${usd(P.min)}`;
  else if (deferredOutstanding(g) + amount + fee > P.maxBillX * bill) q.why = `Too much is deferred already (${usd(deferredOutstanding(g))}): creditors stop at ${P.maxBillX} months' bills`;
  else if (perActive(g)) q.why = 'The plan freezes the creditors\' claims already';
  return q;
}

export function startPlan(g: GameState, gp: CreditorGroup, months: number): ActionResult {
  const q = planQuote(g, gp, months);
  if (q.why) return { ok: false, error: q.why };
  const d = distress(g);
  cashOnly(g, q.amount);
  d.stats.deferred += q.amount;
  d.stats.premiums += q.fee;
  const p: PaymentPlan = { id: nextId(g, 'pp'), group: gp, creditor: q.creditor, amount: q.amount, fee: q.fee, months: q.months, repay: instalments(g.now, q.amount + q.fee, q.fee, q.months), at: g.now, missed: 0 };
  d.plans.push(p);
  pushMessage(g, {
    tone: 'warn', cat: 'finance', title: `${q.creditor} spreads ${usd(q.amount)} over ${q.months} months`, cue: null, ref: { kind: 'debt', id: p.id },
    body: `${GROUP_NAME[gp]}: ${usd(q.amount)} of the last two months' bills stays with us and goes back in ${q.months} parts of about ${usd(q.instalment)} at the month ends, fee ${usd(q.fee)} included. Two parts taken from an overdrawn account and ${q.creditor} calls the rest at once with a ${Math.round(D.plan.callFee * 100)} % fee.`,
  });
  return { ok: true, msg: `${usd(q.amount)} spread over ${q.months} months with ${q.creditor}` };
}

function monthlyPlans(g: GameState, end: Minute): void {
  const d = distress(g);
  for (const p of d.plans) {
    if (p.done || !p.repay.length) { if (!p.done) p.done = g.now; continue; }
    const before = g.company.cash;
    const sw = sweep(g, p.repay, end);
    p.repay = sw.left;
    if (sw.total <= 0) continue;
    if (before - sw.total < 0) {
      p.missed++;
      if (p.missed >= D.plan.callAfterMissed && p.repay.length) {
        const rest = p.repay.reduce((s, x) => s + x.amount, 0);
        const fee = Math.round(rest * D.plan.callFee);
        const sw2 = sweep(g, p.repay.map((x) => ({ ...x, at: end })), end);
        post(g, 'distress', -fee);
        d.stats.premiums += fee;
        p.repay = [];
        pushMessage(g, { tone: 'bad', cat: 'finance', title: `${p.creditor} calls the plan: ${usd(sw2.total + fee)} taken`, cue: 'latePayer', ref: { kind: 'debt', id: p.id }, body: `Two parts came out of an overdrawn account, so the ${usd(rest)} left was taken at once with a ${usd(fee)} fee. ${p.creditor} wants cash in advance from now on.` });
      } else {
        pushMessage(g, { tone: 'warn', cat: 'finance', title: `${p.creditor} took ${usd(sw.total)} from an overdrawn account`, cue: 'latePayer', ref: { kind: 'debt', id: p.id }, body: `The plan's part was due and cash was short. ${p.missed === 1 ? 'A second time and the rest is called at once.' : ''}` });
      }
    } else {
      pushMessage(g, { tone: 'info', cat: 'finance', title: `Plan part paid: ${usd(sw.total)} to ${p.creditor}`, body: p.repay.length ? `${usd(p.repay.reduce((s, x) => s + x.amount, 0))} more at the next ${p.repay.length} month end${p.repay.length === 1 ? '' : 's'}.` : 'The plan is cleared.', cue: 'message', ref: { kind: 'debt', id: p.id } });
    }
    if (!p.repay.length) p.done = g.now;
  }
}

// ---------- 4. an investor sought ----------

export interface InvestorQuote {
  name: string; amount: number; stake: number; forcedStake: number; bill: number;
  /** Counts as the one rescue when signed below zero. */
  rescue: boolean;
  why: string | null;
}

/** The 3-month operating margin the board reads: profit over revenue of the last three closed months (−1 with no revenue). Pure. */
export function margin3(g: GameState): number {
  const hist = g.finance.history.slice(-3);
  let rev = 0, profit = 0;
  for (const st of hist) for (const [k, v] of Object.entries(st.lines)) {
    const x = v ?? 0;
    profit += x;
    if (k === 'acmiRevenue' || k === 'charterRevenue' || k === 'otherRevenue' || k === 'leaseIncome') rev += x;
  }
  return rev > 0 ? profit / rev : -1;
}

/** An investor's offer today (§4): the hole plus a month's bills, a stake a little under the forced rescue's. Pure. */
export function investorQuote(g: GameState): InvestorQuote {
  const I = D.investor;
  const bill = monthEndBill(g, monthKey(g.now)).total;
  const amount = Math.max(1_000_000, rescueNeed(g.company.cash, bill));
  const forcedStake = rescueStake(amount);
  const stake = Math.max(I.stakeMin, forcedStake - I.stakeLess);
  const name = I.names[Math.floor(hashUnit(`${g.seed}:investor`) * I.names.length)];
  const d = distress(g);
  const q: InvestorQuote = { name, amount, stake, forcedStake, bill, rescue: g.company.cash < 0, why: null };
  if (d.investor) q.why = `${d.investor.name} already holds ${d.investor.stake} % and a board seat`;
  else if (g.scen?.noRescue) q.why = 'No investor comes in this scenario';
  else if ((g.finance.rescues ?? 0) >= 1) q.why = 'The fund that rescued us holds its stake: nobody buys a second one';
  else if (g.decisions.some((x) => x.kind === 'rescue')) q.why = 'An investor\'s offer is already on the table (Inbox)';
  else if (!inDebt(g)) q.why = 'Investors come when cash is below zero';
  else if (d.investorRefusedAt !== undefined && g.now - d.investorRefusedAt < 60 * DAY) q.why = `The funds said no on ${fmtDay(d.investorRefusedAt)}: ask again in ${Math.ceil((d.investorRefusedAt + 60 * DAY - g.now) / DAY)} days`;
  else if (perActive(g)) q.why = 'No new equity while the plan runs';
  return q;
}

export function seekInvestor(g: GameState): ActionResult {
  const q = investorQuote(g);
  if (q.why) return { ok: false, error: q.why };
  const I = D.investor;
  const d = distress(g);
  // A fund says no to a company with a broken record (clean under 40): once, then 60 days of silence.
  if (g.company.reputation.clean < 40 && chance(g, 0.5)) {
    d.investorRefusedAt = g.now;
    pushMessage(g, { tone: 'warn', cat: 'finance', title: 'The funds pass', body: `${q.name} and two others looked at the books and the audit record (clean ${Math.round(g.company.reputation.clean)}) and passed. Ask again in 60 days.`, cue: 'message' });
    return { ok: true, msg: 'The funds passed this time' };
  }
  cashOnly(g, q.amount);
  const f = g.finance;
  if (q.rescue) {
    f.rescues = (f.rescues ?? 0) + 1;
    f.rescuedAt = g.now;
    f.negSince = null;
  }
  bumpReliable(g, I.reliable);
  g.company.reputation.clean = clamp(g.company.reputation.clean + I.clean, 0, 100);
  d.investor = { name: q.name, at: g.now, amount: q.amount, stake: q.stake, reviewAt: g.now + I.reviewDays * DAY, misses: 0, met: 0, forcedSales: 0 };
  pushMessage(g, {
    tone: 'warn', cat: 'finance', title: `${q.name} buys ${q.stake} % for ${usd(q.amount)}`, cue: 'cashNegative', ref: { kind: 'debt', id: 'investor' },
    body: `Cash now ${usd(g.company.cash)}. The fund takes a board seat and sets quarterly targets: cash above zero and an operating margin of at least ${Math.round(I.marginMin * 100)} % over the last three months, first reviewed ${fmtDay(d.investor.reviewAt)}. Two misses in a row and the board sells an aircraft; three and it replaces the management. Met ${I.metToRelease} quarters running, the board stands down.${q.rescue ? ' This was our one rescue: insolvent again for 30 days and the company fails.' : ''} The market notices: reliability ${I.reliable}.`,
  });
  return { ok: true, msg: `${usd(q.amount)} in from ${q.name} for ${q.stake} %` };
}

/** Daily: the board's quarterly review. */
function dailyInvestor(g: GameState): void {
  const d = distress(g);
  const inv = d.investor;
  if (!inv || inv.released || g.now < inv.reviewAt) return;
  const I = D.investor;
  inv.reviewAt = g.now + I.reviewDays * DAY;
  const m = margin3(g);
  const cashOk = g.company.cash >= 0;
  const marginOk = m >= I.marginMin;
  if (cashOk && marginOk) {
    inv.misses = 0;
    inv.met++;
    if (inv.met >= I.metToRelease) {
      inv.released = g.now;
      pushMessage(g, { tone: 'good', cat: 'finance', title: `${inv.name}'s board stands down`, body: `${I.metToRelease} quarters of targets met: the fund keeps its ${inv.stake} % as a silent partner. No more reviews.`, cue: 'message' });
    } else pushMessage(g, { tone: 'good', cat: 'finance', title: `Board review: targets met (${inv.met} of ${I.metToRelease})`, body: `Cash ${usd(g.company.cash)}, margin ${Math.round(m * 100)} % over three months. Next review ${fmtDay(inv.reviewAt)}.`, cue: 'message' });
    return;
  }
  inv.misses++;
  inv.met = 0;
  const which = !cashOk && !marginOk ? 'cash below zero and a negative margin' : !cashOk ? `cash below zero (${usd(g.company.cash)})` : `a margin of ${Math.round(m * 100)} % over three months`;
  if (inv.misses >= I.takeOverAt) {
    gameOver(g, `${inv.name} replaced the management after ${inv.misses} quarterly targets missed in a row (${which}).`);
    return;
  }
  if (inv.misses >= I.forceSaleAt) {
    const owned = Object.values(g.fleet).filter((a) => a.ownership.kind === 'owned' && !a.sale && a.status !== 'delivering').sort((a, b) => marketValueOf(g, b) - marketValueOf(g, a));
    const pick = owned.find((a) => saleQuote(g, a.id).ok);
    if (pick && sellAircraft(g, pick.id).ok) {
      inv.forcedSales++;
      pushMessage(g, { tone: 'bad', cat: 'finance', title: `The board forces the sale of ${pick.reg}`, cue: 'cashNegative', ref: { kind: 'aircraft', id: pick.id }, body: `Second quarter missed (${which}). ${inv.name} had ${pick.reg} sold; the price clears debt first. A third miss and the board replaces the management.` });
    } else pushMessage(g, { tone: 'bad', cat: 'finance', title: 'Board review: second miss', cue: 'cashNegative', body: `${which[0].toUpperCase()}${which.slice(1)}. Nothing owned to sell: a third miss and ${inv.name} replaces the management.` });
  } else {
    const card = boardTargetCard(g);
    if (card) postProblem(g, card, { cat: 'finance', tone: 'bad', cue: 'latePayer', tail: `Next review ${fmtDay(inv.reviewAt)}.` });
    else pushMessage(g, { tone: 'bad', cat: 'finance', title: 'Board review: targets missed', cue: 'latePayer', body: `${which[0].toUpperCase()}${which.slice(1)}. Next review ${fmtDay(inv.reviewAt)}; a second miss and the board sells an aircraft.` });
  }
}

// ---------- 5. cost cuts ----------

export interface FurloughQuote {
  share: number; weeks: number; crewIds: string[]; saved: number; from: Minute; until: Minute; total: number;
  why: string | null;
}

/** Furlough: the crew with the least work ahead, a share of each role, from the day after tomorrow (§5). Pure. */
export function furloughQuote(g: GameState, share: number, weeks: number): FurloughQuote {
  const F = D.furlough;
  const sh = F.shares.includes(share) ? share : F.shares[0];
  const w = F.weeks.includes(weeks) ? weeks : F.weeks[0];
  const from = Math.ceil((g.now + F.startDays * DAY) / DAY) * DAY;
  const until = from + w * 7 * DAY;
  // Work ahead per crew member: duties reporting inside the furlough.
  const work = new Map<string, number>();
  for (const p of Object.values(g.pairings)) {
    if (p.status === 'done' || p.status === 'broken' || p.end < from || p.start > until) continue;
    for (const s of p.slots) if (s.crewId) work.set(s.crewId, (work.get(s.crewId) ?? 0) + 1);
  }
  const d = distress(g);
  const already = new Set(d.furlough && g.now < d.furlough.until ? d.furlough.crewIds : []);
  const picked: string[] = [];
  const roles = new Map<string, typeof g.crew[string][]>();
  for (const c of Object.values(g.crew)) {
    if (c.status === 'joining' || c.notice || already.has(c.id)) continue;
    const xs = roles.get(c.role) ?? [];
    xs.push(c);
    roles.set(c.role, xs);
  }
  for (const xs of roles.values()) {
    xs.sort((a, b) => (work.get(a.id) ?? 0) - (work.get(b.id) ?? 0) || b.salary - a.salary);
    const n = Math.floor(xs.length * sh);
    for (const c of xs.slice(0, n)) picked.push(c.id);
  }
  const saved = Math.round(picked.reduce((s, id) => s + g.crew[id].salary, 0) * (1 + BAL.onCosts));
  const q: FurloughQuote = { share: sh, weeks: w, crewIds: picked, saved, from, until, total: Math.round((saved * w * 7) / 30.44), why: null };
  if (d.furlough && g.now < d.furlough.until) q.why = `${d.furlough.crewIds.length} crew are on furlough until ${fmtDay(d.furlough.until)} already`;
  else if (!picked.length) q.why = 'Too few crew to furlough a share of each role';
  return q;
}

export function furloughCrew(g: GameState, share: number, weeks: number): ActionResult {
  const q = furloughQuote(g, share, weeks);
  if (q.why) return { ok: false, error: q.why };
  const F = D.furlough;
  const d = distress(g);
  for (const id of q.crewIds) {
    const c = g.crew[id];
    (c.blocks ??= []).push({ from: q.from, to: q.until, why: 'leave', furlough: true });
    removeCrew(g, id, q.from, q.until);
    moraleShock(g, c, 'pay', F.morale);
  }
  for (const c of Object.values(g.crew)) if (!q.crewIds.includes(c.id) && c.status !== 'joining') moraleShock(g, c, 'pay', F.moraleOthers);
  d.furlough = { crewIds: q.crewIds, from: q.from, until: q.until, saved: q.saved, at: g.now };
  d.stats.furloughSaved += q.total;
  const names = q.crewIds.slice(0, 3).map((id) => crewName(g.crew[id])).join(', ');
  pushMessage(g, {
    tone: 'warn', cat: 'crew', title: `${q.crewIds.length} crew on unpaid leave for ${q.weeks} weeks`, cue: 'notice', ref: { kind: 'debt', id: 'furlough' },
    body: `${names}${q.crewIds.length > 3 ? ` and ${q.crewIds.length - 3} more` : ''} stay home from ${fmtDay(q.from)} to ${fmtDay(q.until - 1)} without pay: about ${usd(q.total)} saved. Their morale ${F.morale}, everyone else's ${F.moraleOthers}; expect resignations. Fewer crew can fly: check the roster.`,
  });
  return { ok: true, msg: `${q.crewIds.length} crew furloughed; about ${usd(q.total)} saved` };
}

export interface SalaryDeferralQuote { months: number; share: number; perMonth: number; total: number; repayFrom: Minute; why: string | null }

/** Salary deferral: a share of crew pay and all of the heads' pay held back for `months` month ends, repaid over two (§5). Pure. */
export function salaryDeferralQuote(g: GameState, months: number): SalaryDeferralQuote {
  const S = D.salary;
  const m = S.months.includes(months) ? months : S.months[0];
  const bill = monthEndBill(g, monthKey(g.now));
  const perMonth = Math.round(bill.salaries * S.share + bill.heads);
  const d = distress(g);
  const q: SalaryDeferralQuote = { months: m, share: S.share, perMonth, total: perMonth * m, repayFrom: monthStart(monthKey(g.now) + m + 1), why: null };
  if (d.salaryDeferral && !d.salaryDeferral.done) q.why = `Pay is deferred already (${usd(d.salaryDeferral.repay.reduce((s, x) => s + x.amount, 0) || d.salaryDeferral.deferred)} to repay)`;
  else if (perMonth < 20_000) q.why = 'Too small a payroll to make a difference';
  return q;
}

export function deferSalaries(g: GameState, months: number): ActionResult {
  const q = salaryDeferralQuote(g, months);
  if (q.why) return { ok: false, error: q.why };
  const d = distress(g);
  d.salaryDeferral = { monthsLeft: q.months, share: q.share, deferred: 0, repay: [], at: g.now };
  for (const c of Object.values(g.crew)) if (c.status !== 'joining') moraleShock(g, c, 'pay', D.salary.morale);
  pushMessage(g, {
    tone: 'warn', cat: 'crew', title: `Pay deferred for ${q.months} month${q.months === 1 ? '' : 's'}`, cue: 'notice', ref: { kind: 'debt', id: 'salary' },
    body: `${Math.round(q.share * 100)} % of crew pay and all of the department heads' pay (about ${usd(q.perMonth)} a month) stays with us at the next ${q.months} month end${q.months === 1 ? '' : 's'} and is paid back over the ${D.salary.repayMonths} after. Morale ${D.salary.morale} now and at each deferred month end.`,
  });
  return { ok: true, msg: `About ${usd(q.total)} of pay deferred` };
}

/** Pay not owed over month k because of furlough blocks (with on-costs), as the month-end bill and forecast count it. Pure. */
export function furloughSaving(g: GameState, k: MonthKey): number {
  const a = monthStart(k), b = monthStart(k + 1);
  let saved = 0;
  for (const c of Object.values(g.crew)) {
    if (c.status === 'joining' || !c.blocks?.length) continue;
    for (const x of c.blocks) {
      if (!x.furlough) continue;
      const o = Math.min(b, x.to) - Math.max(a, x.from, c.payFrom ?? a);
      if (o > 0) saved += c.salary * (o / (b - a));
    }
  }
  return Math.round(saved * (1 + BAL.onCosts));
}

/** Month end k: the furloughed crew's pay for the month comes back off the salaries line (the crew module pays them in full). */
function monthlyFurlough(g: GameState, k: MonthKey): void {
  const saved = furloughSaving(g, k);
  if (saved > 0) post(g, 'salaries', saved);
}

function monthlySalary(g: GameState, k: MonthKey, end: Minute): void {
  const d = distress(g);
  const sd = d.salaryDeferral;
  if (!sd || sd.done) return;
  if (sd.monthsLeft > 0) {
    const bill = monthEndBill(g, k);
    const amount = Math.round(bill.salaries * sd.share + bill.heads);
    cashOnly(g, amount);
    sd.deferred += amount;
    sd.monthsLeft--;
    d.stats.deferred += amount;
    for (const c of Object.values(g.crew)) if (c.status !== 'joining') moraleShock(g, c, 'pay', D.salary.morale);
    if (sd.monthsLeft === 0) {
      sd.repay = instalments(end, sd.deferred, 0, D.salary.repayMonths);
      pushMessage(g, { tone: 'info', cat: 'crew', title: `${usd(sd.deferred)} of deferred pay to repay`, body: `Paid back in ${sd.repay.length} parts from ${fmtDay(sd.repay[0]?.at ?? end)}.`, cue: 'message', ref: { kind: 'debt', id: 'salary' } });
    } else pushMessage(g, { tone: 'warn', cat: 'crew', title: `Pay deferred this month end: ${usd(amount)}`, body: `${sd.monthsLeft} more month end${sd.monthsLeft === 1 ? '' : 's'} to go. Morale ${D.salary.morale}.`, cue: 'message', ref: { kind: 'debt', id: 'salary' } });
    return;
  }
  const sw = sweep(g, sd.repay, end);
  sd.repay = sw.left;
  if (sw.total > 0) pushMessage(g, { tone: 'info', cat: 'crew', title: `Deferred pay repaid: ${usd(sw.total)}`, body: sd.repay.length ? `${usd(sd.repay.reduce((s, x) => s + x.amount, 0))} more at the next month end.` : 'The crew are paid up.', cue: 'message', ref: { kind: 'debt', id: 'salary' } });
  if (!sd.repay.length) sd.done = g.now;
}

/** Checks stretched towards the tolerance (never past it) for a while; the deferred-defects backlog grows. */
export function stretchChecksQuote(g: GameState): { days: number; until: Minute; why: string | null } {
  const d = distress(g);
  const until = g.now + D.checks.days * DAY;
  const q = { days: D.checks.days, until, why: null as string | null };
  if (d.checksUntil && g.now < d.checksUntil) q.why = `Checks are stretched until ${fmtDay(d.checksUntil)} already`;
  else if (!g.company.policies.autoMaintenance) q.why = 'Checks are planned by hand (Company › Policies): book them late yourself';
  return q;
}

export function stretchChecks(g: GameState): ActionResult {
  const q = stretchChecksQuote(g);
  if (q.why) return { ok: false, error: q.why };
  distress(g).checksUntil = q.until;
  pushMessage(g, { tone: 'warn', cat: 'tech', title: `A-checks planned late until ${fmtDay(q.until)}`, cue: 'notice', ref: { kind: 'debt', id: 'checks' }, body: `Each A-check is booked at about ${Math.round((D.checks.dueX - 1) * 100)} % past its interval, inside the ${Math.round(BAL.overdueTolerance * 100)} % tolerance the authority allows, so the cash goes out later. Deferred defects pile up meanwhile: more technical delays and AOGs until the next check.` });
  return { ok: true, msg: `Checks stretched for ${q.days} days` };
}

/** ops/maintenance.ts: the A-check planning point and due date while stretched. Pure. */
export function checkStretch(g: GameState): { planAt: number; dueX: number } {
  const u = g.treasury?.distress?.checksUntil;
  return u && g.now < u ? { planAt: D.checks.planAt, dueX: D.checks.dueX } : { planAt: BAL.planAt, dueX: 1 };
}

/** Monthly: the deferred-defects backlog grows on every flying aircraft while checks are stretched. */
function monthlyChecks(g: GameState): void {
  const d = distress(g);
  if (!d.checksUntil || g.now >= d.checksUntil) return;
  for (const ac of Object.values(g.fleet)) if (ac.status !== 'delivering' && ac.status !== 'stored') ac.maint.deferred = clamp(ac.maint.deferred + D.checks.deferredPerMonth, 0, 1);
}

// ---------- 6. early payment ----------

export interface PrepayQuote { receivableId: string; amount: number; discount: number; now: number; days: number; agree: number; why: string | null }

/** Ask a client to pay an open invoice now for a discount (§6). Pure. */
export function prepayQuote(g: GameState, receivableId: string): PrepayQuote | null {
  const r = g.finance.receivables.find((x) => x.id === receivableId);
  if (!r) return null;
  const P = D.prepay;
  const days = Math.max(0, Math.ceil((r.due - g.now) / DAY));
  const pct = clamp(P.base + P.perDay * days, P.clamp[0], P.clamp[1]);
  const discount = Math.round(r.amount * pct);
  const cl = g.clients[r.clientId];
  const rel = clamp(((cl?.relation ?? 0) + 100) / 200, 0, 1);
  const agree = P.agree[0] + (P.agree[1] - P.agree[0]) * rel;
  const q: PrepayQuote = { receivableId, amount: r.amount, discount, now: r.amount - discount, days, agree, why: null };
  if (r.paid !== null) q.why = 'Already paid';
  else if (r.written) q.why = 'Written off';
  else if (r.factor || r.factored) q.why = 'Sold to the bank: the bank collects it';
  else if (r.prepay) q.why = r.prepay.refused ? `${cl?.name ?? 'The client'} said no on ${fmtDay(r.prepay.at)}` : 'Asked already';
  else if (daysOverdue(g, r) > 0) q.why = 'Overdue: chase it (the Inbox) or sell it to the bank';
  else if (cl?.ceased) q.why = `${cl.name} is in administration`;
  else if (r.amount < 20_000) q.why = 'Too small to ask for';
  return q;
}

export function askPrepayment(g: GameState, receivableId: string): ActionResult {
  const q = prepayQuote(g, receivableId);
  if (!q) return { ok: false, error: 'Invoice not found' };
  if (q.why) return { ok: false, error: q.why };
  const r = g.finance.receivables.find((x) => x.id === receivableId)!;
  const cl = g.clients[r.clientId];
  const name = cl?.name ?? 'The client';
  const d = distress(g);
  if (!chance(g, q.agree)) {
    r.prepay = { at: g.now, discount: 0, refused: true };
    bumpRelation(g, r.clientId, D.prepay.refusedRelation);
    pushMessage(g, { tone: 'warn', cat: 'finance', title: `${name} will pay on the due date`, body: `We asked them to settle ${usd(r.amount)} for ${r.desc} early for ${usd(q.discount)} off. "Our terms are our terms," they said. Relation ${D.prepay.refusedRelation}.`, cue: 'message', ref: { kind: 'receivable', id: r.id } });
    return { ok: true, msg: `${name} said no` };
  }
  r.prepay = { at: g.now, discount: q.discount };
  cashOnly(g, r.amount);
  post(g, 'distress', -q.discount);
  d.stats.discounts += q.discount;
  r.paid = g.now;
  bumpRelation(g, r.clientId, D.prepay.relation);
  pushMessage(g, { tone: 'info', cat: 'finance', title: `${name} pays early: ${usd(q.now)} in`, body: `${usd(r.amount)} for ${r.desc}, ${q.days} days before it was due, less ${usd(q.discount)} (${(q.discount / r.amount * 100).toFixed(1)} %). They noticed we needed it: relation ${D.prepay.relation}.`, cue: 'paymentIn', ref: { kind: 'receivable', id: r.id } });
  return { ok: true, msg: `${usd(q.now)} in from ${name}` };
}

// ---------- 7. PER restructuring ----------

export interface PerQuote {
  /** The home country's procedure, in words. */
  procedure: string;
  claims: number; writeOff: number; fee: number; months: number; until: Minute; labelUntil: Minute; noCreditUntil: Minute;
  why: string | null;
}

/** The home country's court-protected restructuring: Portugal's PER by name, elsewhere the country's equivalent. */
export function procedureName(g: GameState): string {
  const code = AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';
  if (code === 'PT') return 'PER (Processo Especial de Revitalização)';
  const name = code ? countryName(code) : 'the home country';
  return `${name}'s court-protected restructuring (its PER)`;
}

/** The unsecured claims a plan writes down: the overdraft, plans, deferred rent and pay, an unsecured drawn line. Pure. */
export function unsecuredClaims(g: GameState): number {
  const d = distress(g);
  const sum = (xs: Instalment[]) => xs.reduce((s, x) => s + x.amount, 0);
  let claims = Math.max(0, -g.company.cash);
  for (const p of d.plans) if (!p.done) claims += sum(p.repay);
  for (const r of d.rentDeferrals) if (!r.done) claims += sum(r.repay);
  if (d.salaryDeferral && !d.salaryDeferral.done) claims += sum(d.salaryDeferral.repay);
  const line = g.treasury?.credit;
  if (line && !line.secured) claims += line.drawn;
  return Math.round(claims);
}

export function perQuote(g: GameState): PerQuote {
  const P = D.per;
  const claims = unsecuredClaims(g);
  const fee = Math.max(P.feeMin, Math.round(claims * P.fee));
  const until = g.now + Math.round(P.months * MONTH);
  const d = distress(g);
  const bill = monthEndBill(g, monthKey(g.now)).total;
  const since = g.finance.negSince ?? null;
  const q: PerQuote = { procedure: procedureName(g), claims, writeOff: Math.round(Math.max(0, -g.company.cash) * P.writeOff), fee, months: P.months, until, labelUntil: until + Math.round(P.labelMonths * MONTH), noCreditUntil: g.now + Math.round(P.noCreditMonths * MONTH), why: null };
  if (d.per) q.why = d.per.failed ? 'The plan failed' : d.per.exited ? `Done once (exited ${fmtDay(d.per.exited)}): the court does not open a second` : `The plan runs until ${fmtDay(d.per.until)}`;
  else if (g.scen) q.why = 'Not in a scenario';
  else if (g.company.cash >= 0) q.why = 'Only a company below zero can file';
  else if (!(g.company.cash < -P.minBillX * bill || (since !== null && g.now - since >= P.minDays * DAY))) q.why = `Not deep enough yet: below ${usd(-P.minBillX * bill)} (a month's bills), or ${P.minDays} days below zero (${since !== null ? Math.floor((g.now - since) / DAY) : 0} so far)`;
  return q;
}

export function fileRestructuring(g: GameState): ActionResult {
  const q = perQuote(g);
  if (q.why) return { ok: false, error: q.why };
  const P = D.per;
  const d = distress(g);
  // Court and advisers first; then the creditors' haircut: the bank forgives part of the overdraft (a gain, cash up),
  // the plans, deferred rent and pay are cut (a gain on the statement, no cash), an unsecured line's drawn balance too.
  post(g, 'distress', -q.fee);
  let written = 0;
  const over = Math.max(0, -g.company.cash);
  const w0 = Math.round(over * P.writeOff);
  if (w0 > 0) { post(g, 'distress', w0); written += w0; }
  const cut = (xs: Instalment[]): number => {
    let w = 0;
    for (const x of xs) {
      const c = Math.round(x.amount * P.writeOff);
      x.amount -= c;
      x.fee = Math.min(x.fee, x.amount);
      w += c;
    }
    return w;
  };
  for (const p of d.plans) if (!p.done) written += cut(p.repay);
  for (const r of d.rentDeferrals) if (!r.done) written += cut(r.repay);
  if (d.salaryDeferral && !d.salaryDeferral.done) written += cut(d.salaryDeferral.repay);
  const line = g.treasury?.credit;
  let lineCut = 0;
  if (line && !line.secured && line.drawn > 0) {
    lineCut = Math.round(line.drawn * P.writeOff);
    line.drawn -= lineCut;
    for (const r of line.repay ?? []) r.amount = Math.round(r.amount * (1 - P.writeOff));
    written += lineCut;
  }
  const noCash = written - w0;
  if (noCash > 0) { post(g, 'distress', noCash); cashOnly(g, -noCash); }
  d.stats.writtenOff += written;
  // Claims frozen: the plan period; the label and the credit ban.
  d.per = { at: g.now, until: q.until, labelUntil: q.labelUntil, noCreditUntil: q.noCreditUntil, writtenOff: written, fees: q.fee, cancelled: 0 };
  for (const p of d.plans) if (!p.done) for (const x of p.repay) x.at = Math.max(x.at, nextMonthStart(q.until));
  for (const r of d.rentDeferrals) if (!r.done) for (const x of r.repay) x.at = Math.max(x.at, nextMonthStart(q.until));
  if (d.salaryDeferral && !d.salaryDeferral.done) for (const x of d.salaryDeferral.repay) x.at = Math.max(x.at, nextMonthStart(q.until));
  if (line?.repay?.length) for (const r of line.repay) r.at = Math.max(r.at, nextMonthStart(q.until));
  for (const l of g.treasury?.loans ?? []) { l.nextDue = Math.max(l.nextDue, nextMonthStart(q.until)); if (l.calledDue) l.calledDue = Math.max(l.calledDue, q.until); }
  // Reputation and the clients.
  bumpReliable(g, P.reliable);
  g.company.reputation.clean = clamp(g.company.reputation.clean + P.clean, 0, 100);
  const working = new Set<string>();
  for (const c of Object.values(g.contracts)) if (c.status === 'signed' || c.status === 'active') working.add(c.clientId);
  for (const id of working) bumpRelation(g, id, P.relation);
  let cancelled = 0;
  for (const c of Object.values(g.contracts)) {
    if (c.status !== 'signed' && c.status !== 'active') continue;
    const cl = g.clients[c.clientId];
    if (!cl || cl.relation >= P.cancelBelow || !chance(g, P.cancelChance)) continue;
    if (cancelByClient(g, c.id, `${cl.name} will not fly with an operator in restructuring.`).ok) cancelled++;
  }
  d.per.cancelled = cancelled;
  // A lessor takes an aircraft back: the leased one with the least work ahead, at the earliest return the lease allows.
  if (chance(g, P.repossessChance)) {
    const leased = Object.values(g.fleet).filter((a) => a.ownership.kind === 'dryLeaseIn' && !a.returning && a.status !== 'delivering');
    const legsAhead = (id: string) => Object.values(g.flights).filter((f) => f.aircraftId === id && f.status === 'scheduled' && f.kind !== 'positioning').length;
    leased.sort((a, b) => legsAhead(a.id) - legsAhead(b.id));
    for (const ac of leased) {
      const eq = earlyReturnQuote(g, ac.id);
      if (!eq.ok) continue;
      if (returnEarly(g, ac.id, eq.end).ok) {
        if (ac.returning) ac.returning.earlyFee = 0;
        d.per.repossessed = ac.id;
        pushMessage(g, { tone: 'bad', cat: 'company', title: `${eq.why ?? ''}${ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.lessor : 'The lessor'} takes ${ac.reg} back`, cue: 'cashNegative', ref: { kind: 'aircraft', id: ac.id }, body: `The filing lets the lessor end the lease: ${ac.reg} goes back on ${fmtDay(eq.end)}, no early-return fee. Its work after that needs another aircraft.` });
        break;
      }
    }
  }
  pushMessage(g, {
    tone: 'bad', cat: 'finance', title: `Restructuring filed: ${q.procedure}`, cue: 'cashNegative', ref: { kind: 'debt', id: 'per' },
    body: `The court protects us until ${fmtDay(q.until)}: the creditors' claims are frozen, no instalment, loan or deferred rent is taken until then, and the 30-day insolvency clock stops. The creditors write off ${Math.round(P.writeOff * 100)} % (${usd(written)}: ${usd(w0)} of the overdraft forgiven${noCash ? `, ${usd(noCash)} of plans and deferrals` : ''}); court and advisers ${usd(q.fee)}. The price: reliability ${P.reliable}, clean ${P.clean}, every client we fly for ${P.relation}${cancelled ? `, ${cancelled} contract${cancelled === 1 ? '' : 's'} cancelled` : ''}${d.per.repossessed ? ', one aircraft repossessed' : ''}, no new credit until ${fmtDay(q.noCreditUntil)} and a "Restructuring" label on our offers (${Math.round(P.ratePct * 100)} % rate, no deposits) until ${fmtDay(q.labelUntil)}. Cash must be above zero on ${fmtDay(q.until)}, or the court orders liquidation.`,
  });
  return { ok: true, msg: `Restructuring filed; ${usd(written)} written off; the plan runs to ${fmtDay(q.until)}` };
}

/** Daily: the plan's end (exit or liquidation) and its monthly note. */
function dailyPer(g: GameState): void {
  const d = distress(g);
  const p = d.per;
  if (!p || p.exited || p.failed) return;
  if (g.now >= p.until) {
    if (g.company.cash >= 0) {
      p.exited = g.now;
      g.finance.negSince = null;
      pushMessage(g, { tone: 'good', cat: 'finance', title: 'Out of restructuring', body: `The plan period ended with cash at ${usd(g.company.cash)}: the court closes the case. The frozen claims fall due from the next month end. The label stays until ${fmtDay(p.labelUntil)}; no new credit until ${fmtDay(p.noCreditUntil)}.`, cue: 'message', ref: { kind: 'debt', id: 'per' } });
    } else {
      p.failed = g.now;
      gameOver(g, `The restructuring plan failed: cash was ${usd(g.company.cash)} at its end and the court ordered liquidation.`);
    }
  }
}

// ---------- passes ----------

/** Daily: the board's reviews and the plan's end. */
export function dailyDistress(g: GameState): void {
  if (!g.treasury?.distress) return;
  dailyInvestor(g);
  dailyPer(g);
}

/**
 * Month end k (finance/index.ts monthlyTreasury, before the statement closes): deferred rent and pay stay with us, due
 * repayments and plan parts are swept (none while the restructuring plan runs), the defects backlog grows while checks
 * are stretched.
 */
export function monthlyDistress(g: GameState, k: MonthKey): void {
  if (!g.treasury?.distress) return;
  const end = monthStart(k + 1);
  const d = distress(g);
  monthlyChecks(g);
  monthlyFurlough(g, k);
  monthlyRent(g, k, end);
  monthlySalary(g, k, end);
  if (!perActive(g)) monthlyPlans(g, end);
  else {
    // Frozen: the deferred rent and pay of the month still stay (the deferral itself is a creditor's favour, not a claim due).
    const p = d.per!;
    const left = Math.max(0, Math.ceil((p.until - g.now) / DAY));
    pushMessage(g, { tone: 'info', cat: 'finance', title: `Restructuring: ${left} days of court protection left`, body: `Cash ${usd(g.company.cash)}. It must be above zero on ${fmtDay(p.until)}.`, cue: 'message', ref: { kind: 'debt', id: 'per' } });
  }
}

/** The forecast's distress items: repayments due, deferred rent and pay kept at the month ends ahead. Pure. */
export function distressForecastItems(g: GameState, days: number): ForecastItem[] {
  const d = g.treasury?.distress;
  if (!d) return [];
  const out: ForecastItem[] = [];
  const end = g.now + days * DAY;
  const frozenUntil = perActive(g) ? nextMonthStart(d.per!.until) : 0;
  const at = (t: Minute) => Math.max(t, frozenUntil);
  for (const r of d.rentDeferrals ?? []) {
    if (r.done) continue;
    const ac = g.fleet[r.aircraftId];
    for (let i = 0; i < r.months; i++) {
      const m = monthStart(monthKey(r.from) + i + 1);
      if (m > g.now && m <= end && ac && ac.ownership.kind === 'dryLeaseIn') out.push({ t: m, amount: ac.ownership.rentPerMonth, what: `${ac.reg}'s rent deferred` });
    }
    for (const x of r.repay) if (at(x.at) <= end) out.push({ t: at(x.at), amount: -x.amount, what: 'deferred rent repaid' });
  }
  for (const p of d.plans ?? []) {
    if (p.done || perActive(g)) continue;
    for (const x of p.repay) if (x.at <= end) out.push({ t: x.at, amount: -x.amount, what: `${p.creditor}'s plan` });
  }
  const sd = d.salaryDeferral;
  if (sd && !sd.done) {
    const bill = monthEndBill(g, monthKey(g.now));
    const per = Math.round(bill.salaries * sd.share + bill.heads);
    for (let i = 0; i < sd.monthsLeft; i++) {
      const m = monthStart(monthKey(g.now) + i + 1);
      if (m <= end) out.push({ t: m, amount: per, what: 'pay deferred' });
    }
    for (const x of sd.repay) if (at(x.at) <= end) out.push({ t: at(x.at), amount: -x.amount, what: 'deferred pay repaid' });
  }
  return out;
}

// ---------- the panel ----------

export type DistressId = 'prepay' | 'factor' | 'secured' | 'plan' | 'rent' | 'salary' | 'furlough' | 'checks' | 'investor' | 'per';

export interface DistressChoice { value: number; label: string }
export interface DistressTarget { id: string; label: string; why: string | null }

export interface DistressOption {
  id: DistressId;
  title: string;
  /** What it gives (today's numbers), what it costs, what follows (plain). */
  gives: string;
  costs: string;
  consequence: string;
  /** Why not today (plain), null when possible. */
  why: string | null;
  /** The choices (months, share) and the targets (aircraft, creditor, invoice) the dialog offers. */
  choices?: DistressChoice[];
  choiceLabel?: string;
  targets?: DistressTarget[];
  targetLabel?: string;
  /** Rank: smaller first (the gentlest first). */
  rank: number;
}

const k$ = (v: number) => usd(v);

/** The ways out today, best first (§panel). Pure. */
export function distressOptions(g: GameState): DistressOption[] {
  const out: DistressOption[] = [];
  const bill = monthEndBill(g, monthKey(g.now)).total;
  // 6a. early payment.
  const recv = g.finance.receivables.filter((r) => r.paid === null).sort((a, b) => a.due - b.due);
  const pre = recv.map((r) => ({ r, q: prepayQuote(g, r.id)! }));
  const preOk = pre.filter((x) => !x.q.why);
  out.push({
    id: 'prepay', title: 'Ask a client to pay early', rank: 1,
    gives: preOk.length ? `${k$(preOk.reduce((s, x) => s + x.q.now, 0))} now across ${preOk.length} invoice${preOk.length === 1 ? '' : 's'}` : 'Cash now for an invoice not yet due',
    costs: `${Math.round(D.prepay.clamp[0] * 100)}–${Math.round(D.prepay.clamp[1] * 100)} % off the invoice`,
    consequence: `Relation ${D.prepay.relation} with the client; about half say no when they barely know us`,
    why: preOk.length ? null : recv.length ? 'No invoice to ask for (overdue ones: chase or sell them)' : 'No open invoices',
    targets: pre.map((x) => ({ id: x.r.id, label: `${g.clients[x.r.clientId]?.name ?? 'Client'} · ${k$(x.r.amount)} · due ${fmtDay(x.r.due)}`, why: x.q.why })), targetLabel: 'Invoice',
  });
  // 6b. factoring (the bank's existing dialog).
  const fac = recv.map((r) => ({ r, q: factorQuote(g, r.id, true)! })).filter((x) => !x.q.why);
  out.push({
    id: 'factor', title: 'Sell an invoice to the bank', rank: 2,
    gives: fac.length ? `${k$(fac.reduce((s, x) => s + x.q.now, 0))} now across ${fac.length} invoice${fac.length === 1 ? '' : 's'}; the rest when the client pays` : 'About 95 % of an invoice now',
    costs: '1–8 % fee, by how far off the due date is', consequence: 'With recourse the invoice comes back if the client never pays',
    why: fac.length ? null : 'No invoice the bank buys today', targets: fac.map((x) => ({ id: x.r.id, label: `${g.clients[x.r.clientId]?.name ?? 'Client'} · ${k$(x.r.amount)} · ${k$(x.q.now)} now`, why: null })), targetLabel: 'Invoice',
  });
  // 1. the secured line (finance/index.ts).
  const line = g.treasury?.credit;
  const sec = D.secured;
  out.push({
    id: 'secured', title: line ? 'Draw on the credit line' : 'Ask the bank for a secured line', rank: 3,
    gives: line ? `${k$(Math.max(0, line.limit - line.drawn))} undrawn${line.frozen ? ' (frozen)' : ''}` : `A line sized on ${Math.round(sec.recvShare * 100)} % of your receivables and ${Math.round(sec.acShare * 100)} % of unpledged owned aircraft`,
    costs: line ? `${pct1((g.treasury?.credit?.margin ?? 0))} over the bank rate on what is drawn` : `Bank rate + ${pct1(sec.margin[(g.company.standing ?? 0) as 0 | 1 | 2])}, ${Math.round(sec.arrangementFee * 100)} % arrangement fee`,
    consequence: line ? 'Covenants checked monthly; a breach costs a waiver fee, then the margin, then the line' : 'The bank takes security over your owned aircraft (no sale, loan or leaseback until repaid) and wants cash plus undrawn credit at 1.5 months\' bills',
    why: line ? (line.frozen ? 'The line is frozen' : line.limit - line.drawn <= 0 ? 'Fully drawn' : null) : null,
  });
  // 3. creditor plans.
  const plans = CREDITOR_GROUPS.map((gp) => planQuote(g, gp, D.plan.months[1]));
  const planOk = plans.filter((p) => !p.why);
  out.push({
    id: 'plan', title: 'Spread the bills with a creditor', rank: 4,
    gives: planOk.length ? `Up to ${k$(Math.max(...planOk.map((p) => p.amount)))} kept now (${planOk.map((p) => p.creditor).join(', ')})` : 'Half of the last two months\' bills paid back over 3–6 months',
    costs: `${Math.round(D.plan.feeMin * 100)}–${Math.round(D.plan.feePerMonth * 600) / 100} % fee; the parts are taken at the month ends whatever the cash`,
    consequence: `Two parts from an overdrawn account and the creditor calls the rest (${Math.round(D.plan.callFee * 100)} % fee) and wants cash in advance`,
    why: planOk.length ? null : plans[0].why?.startsWith('Too much') ? plans[0].why : 'Nothing big enough owed lately, or a plan already runs with each',
    choices: D.plan.months.map((m) => ({ value: m, label: `${m} months` })), choiceLabel: 'Over',
    targets: plans.map((p) => ({ id: p.group, label: `${GROUP_NAME[p.group]} · ${p.creditor} · ${k$(p.amount)}`, why: p.why })), targetLabel: 'Creditor',
  });
  // 2. rent deferral.
  const leased = Object.values(g.fleet).filter((a) => a.ownership.kind === 'dryLeaseIn');
  const rq = leased.map((a) => ({ a, q: rentDeferralQuote(g, a.id, D.rent.months[0])! }));
  const rOk = rq.filter((x) => !x.q.why);
  out.push({
    id: 'rent', title: 'Ask a lessor to defer the rent', rank: 5,
    gives: rOk.length ? `${D.rent.months[0]}–${D.rent.months[1]} months' rent kept (${k$(Math.max(...rOk.map((x) => x.q.rent)))} a month on ${rOk[0].a.reg}${rOk.length > 1 ? ` and ${rOk.length - 1} more` : ''})` : 'Two or three months\' rent kept now',
    costs: `Repaid plus ${Math.round(D.rent.premium * 100)} % over the same months after; the lease runs ${D.rent.extendX}× the months longer`,
    consequence: `Reliability ${D.rent.reliable}; a repayment taken from an overdrawn account blocks that lessor for a year`,
    why: rOk.length ? null : leased.length ? rq[0].q.why : 'No leased aircraft',
    choices: D.rent.months.map((m) => ({ value: m, label: `${m} months` })), choiceLabel: 'Defer',
    targets: rq.map((x) => ({ id: x.a.id, label: `${x.a.reg} · ${x.q.lessor} · ${k$(x.q.rent)} a month`, why: x.q.why })), targetLabel: 'Aircraft',
  });
  // 5b. salary deferral.
  const sq = salaryDeferralQuote(g, D.salary.months[0]);
  out.push({
    id: 'salary', title: 'Defer part of the pay', rank: 6,
    gives: `About ${k$(sq.perMonth)} kept at each month end (${Math.round(D.salary.share * 100)} % of crew pay, the heads' pay in full)`,
    costs: `Paid back over the ${D.salary.repayMonths} month ends after`, consequence: `Morale ${D.salary.morale} now and at each deferred month end; more sick calls and resignations`,
    why: sq.why, choices: D.salary.months.map((m) => ({ value: m, label: `${m} month${m === 1 ? '' : 's'}` })), choiceLabel: 'For',
  });
  // 5a. furlough.
  const fq = furloughQuote(g, D.furlough.shares[0], D.furlough.weeks[0]);
  out.push({
    id: 'furlough', title: 'Furlough a share of the crew', rank: 7,
    gives: fq.why ? 'Unpaid leave for a quarter or half of each role' : `About ${k$(fq.total)} saved over ${fq.weeks} weeks (${fq.crewIds.length} crew at a quarter)`,
    costs: 'Fewer crew can fly: trips may lose their crew', consequence: `Morale ${D.furlough.morale} for them, ${D.furlough.moraleOthers} for the rest; resignations follow`,
    why: fq.why, choices: D.furlough.shares.map((s) => ({ value: s, label: `${Math.round(s * 100)} %` })), choiceLabel: 'Share',
    targets: D.furlough.weeks.map((w) => ({ id: String(w), label: `${w} weeks`, why: null })), targetLabel: 'For',
  });
  // 5c. checks stretched.
  const cq = stretchChecksQuote(g);
  out.push({
    id: 'checks', title: 'Plan the A-checks late', rank: 8,
    gives: `Each A-check booked about ${Math.round((D.checks.dueX - 1) * 100)} % past its interval for ${D.checks.days} days: the cash goes out later`,
    costs: 'Nothing today', consequence: `Inside the ${Math.round(BAL.overdueTolerance * 100)} % tolerance the authority allows, but deferred defects pile up: more technical delays and AOGs`,
    why: cq.why,
  });
  // 4. an investor.
  const iq = investorQuote(g);
  out.push({
    id: 'investor', title: 'Bring in an investor now', rank: 9,
    gives: `${k$(iq.amount)} from ${iq.name}: the overdraft cleared and a month's bills (${k$(bill)})`,
    costs: `${iq.stake} % of the company (${iq.forcedStake} % if you wait for the forced rescue)`,
    consequence: `A board seat with quarterly targets (cash above zero, margin ≥ ${Math.round(D.investor.marginMin * 100)} %): two misses sell an aircraft, three replace you. Reliability ${D.investor.reliable}.${iq.rescue ? ' Counts as your one rescue.' : ''}`,
    why: iq.why,
  });
  // 7. PER.
  const pq = perQuote(g);
  out.push({
    id: 'per', title: 'File for restructuring', rank: 10,
    gives: `${pq.months} months of court protection: claims frozen, the insolvency clock stopped, ${Math.round(D.per.writeOff * 100)} % of unsecured claims written off (${k$(pq.writeOff)} of the overdraft today)`,
    costs: `Court and advisers ${k$(pq.fee)}; reliability ${D.per.reliable}, clean ${D.per.clean}; every client ${D.per.relation}`,
    consequence: `Some clients cancel, a lessor may take an aircraft back, no new credit for a year, a "Restructuring" label (${Math.round(D.per.ratePct * 100)} % rate, no deposits). Cash below zero at the end: liquidation.`,
    why: pq.why,
  });
  return out.sort((a, b) => Number(!!a.why) - Number(!!b.why) || a.rank - b.rank);
}

/** The dialog's one button: applies the option with its choice and target. */
export function applyDistress(g: GameState, id: DistressId, choice?: number, target?: string): ActionResult {
  switch (id) {
    case 'prepay': return target ? askPrepayment(g, target) : { ok: false, error: 'Pick an invoice' };
    case 'plan': return target ? startPlan(g, target as CreditorGroup, choice ?? D.plan.months[1]) : { ok: false, error: 'Pick a creditor' };
    case 'rent': return target ? deferRent(g, target, choice ?? D.rent.months[0]) : { ok: false, error: 'Pick an aircraft' };
    case 'salary': return deferSalaries(g, choice ?? D.salary.months[0]);
    case 'furlough': return furloughCrew(g, choice ?? D.furlough.shares[0], Number(target ?? D.furlough.weeks[0]));
    case 'checks': return stretchChecks(g);
    case 'investor': return seekInvestor(g);
    case 'per': return fileRestructuring(g);
    default: return { ok: false, error: 'Use the bank\'s own dialog' };
  }
}

/** The open commitments for the panel: one plain line each, with the next date. Pure. */
export function debtCommitments(g: GameState): { id: string; text: string; tone: 'muted' | 'warn' | 'bad' | 'good'; at?: Minute }[] {
  const d = g.treasury?.distress;
  if (!d) return [];
  const out: { id: string; text: string; tone: 'muted' | 'warn' | 'bad' | 'good'; at?: Minute }[] = [];
  const sum = (xs: Instalment[]) => xs.reduce((s, x) => s + x.amount, 0);
  const p = d.per;
  if (p && !p.failed) {
    if (!p.exited) out.push({ id: 'per', text: `Restructuring: court protection until ${fmtDay(p.until)}; cash must be above zero then. ${usd(p.writtenOff)} written off.`, tone: 'bad', at: p.until });
    else if (g.now < p.labelUntil) out.push({ id: 'per', text: `Out of restructuring since ${fmtDay(p.exited)}; the label (${Math.round(D.per.ratePct * 100)} % rate, no deposits) until ${fmtDay(p.labelUntil)}, no new credit until ${fmtDay(p.noCreditUntil)}.`, tone: 'warn', at: p.labelUntil });
  }
  const inv = d.investor;
  if (inv && !inv.released) out.push({ id: 'investor', text: `${inv.name} (${inv.stake} %): board review ${fmtDay(inv.reviewAt)}; cash above zero and a 3-month margin ≥ ${Math.round(D.investor.marginMin * 100)} % (now ${margin3(g) <= -1 ? 'no revenue' : `${Math.round(margin3(g) * 100)} %`}). ${inv.misses ? `${inv.misses} miss${inv.misses === 1 ? '' : 'es'} in a row.` : `${inv.met} of ${D.investor.metToRelease} met.`}`, tone: inv.misses ? 'bad' : 'muted', at: inv.reviewAt });
  for (const r of d.rentDeferrals ?? []) {
    if (r.done) continue;
    const ac = g.fleet[r.aircraftId];
    const left = r.months - monthsDeferred(g, r);
    out.push({ id: r.id, text: r.repay.length ? `${r.lessor}: ${usd(sum(r.repay))} of deferred rent on ${ac?.reg ?? 'the aircraft'} to repay, next ${fmtDay(r.repay[0].at)}` : `${r.lessor}: ${ac?.reg ?? 'the aircraft'}'s rent deferred for ${left} more month end${left === 1 ? '' : 's'}`, tone: r.defaulted ? 'bad' : 'warn', at: r.repay[0]?.at });
  }
  for (const pl of d.plans ?? []) if (!pl.done && pl.repay.length) out.push({ id: pl.id, text: `${pl.creditor}: ${usd(sum(pl.repay))} over ${pl.repay.length} month end${pl.repay.length === 1 ? '' : 's'}, next ${fmtDay(pl.repay[0].at)}${pl.missed ? ` · ${pl.missed} missed` : ''}`, tone: pl.missed ? 'bad' : 'warn', at: pl.repay[0].at });
  const sd = d.salaryDeferral;
  if (sd && !sd.done) out.push({ id: 'salary', text: sd.monthsLeft ? `Pay deferred for ${sd.monthsLeft} more month end${sd.monthsLeft === 1 ? '' : 's'} (${usd(sd.deferred)} so far)` : `${usd(sum(sd.repay))} of deferred pay to repay, next ${fmtDay(sd.repay[0]?.at ?? g.now)}`, tone: 'warn', at: sd.repay[0]?.at });
  const fu = d.furlough;
  if (fu && g.now < fu.until) out.push({ id: 'furlough', text: `${fu.crewIds.length} crew on unpaid leave until ${fmtDay(fu.until - 1)} (about ${usd(fu.saved)} a month saved)`, tone: 'warn', at: fu.until });
  if (d.checksUntil && g.now < d.checksUntil) out.push({ id: 'checks', text: `A-checks planned late until ${fmtDay(d.checksUntil)}: more technical delays meanwhile`, tone: 'warn', at: d.checksUntil });
  return out;
}

// ---------- cards (four lines) ----------

/** The board's targets missed, or at risk inside 14 days of a review (amber), red after a miss. Pure. */
export function boardTargetCard(g: GameState): ProblemCard | null {
  const inv = g.treasury?.distress?.investor;
  if (!inv || inv.released) return null;
  const I = D.investor;
  const m = margin3(g);
  const cashOk = g.company.cash >= 0, marginOk = m >= I.marginMin;
  const soon = inv.reviewAt - g.now <= 14 * DAY;
  if (!inv.misses && (!soon || (cashOk && marginOk))) return null;
  const which = !cashOk && !marginOk ? 'cash is below zero and the margin negative' : !cashOk ? `cash is below zero (${usd(g.company.cash)})` : `the margin is ${m <= -1 ? 'nothing (no revenue)' : `${Math.round(m * 100)} %`} over three months`;
  const next = inv.misses + 1 >= I.takeOverAt ? 'the board replaces the management and the game ends' : inv.misses + 1 >= I.forceSaleAt ? 'the board sells an aircraft' : 'a second miss sells an aircraft, a third replaces you';
  return {
    subject: { kind: 'boardTarget', ref: { kind: 'debt', id: 'investor' } }, severity: inv.misses ? 'red' : 'amber',
    title: inv.misses ? `The board's targets are missed (${inv.misses})` : `Board review ${fmtDay(inv.reviewAt)}: a target is off`,
    what: inv.misses ? `${inv.name}'s board found its targets missed ${inv.misses} quarter${inv.misses === 1 ? '' : 's'} running` : `${inv.name}'s board reviews on ${fmtDay(inv.reviewAt)} and ${which}`,
    why: inv.misses ? `At the last review ${which}.` : `The targets are cash above zero and a 3-month operating margin of at least ${Math.round(I.marginMin * 100)} %.`,
    hurt: mkHurt({ money: Math.max(0, -g.company.cash), what: 'short', extra: `at the next miss ${next}` }),
    actions: [
      { id: 'debt', label: 'Ways out of debt', open: { tab: 'finance', view: 'debt' }, primary: true },
      { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } },
    ],
    details: [`Investor ${inv.name}, ${inv.stake} % since ${fmtDay(inv.at)}`, `Reviews every ${I.reviewDays} days; ${inv.met} met in a row, ${inv.misses} missed`, `Forced sales so far: ${inv.forcedSales}`],
    visuals: {}, terms: [], by: inv.reviewAt,
  };
}

/** The restructuring plan while it runs (red): days left and the cash it needs. Pure. */
export function restructuringCard(g: GameState): ProblemCard | null {
  const p = g.treasury?.distress?.per;
  if (!p || p.exited || p.failed || g.now >= p.until) return null;
  const left = Math.max(0, Math.ceil((p.until - g.now) / DAY));
  const low = cashForecast(g, Math.min(90, left)).reduce((m, x) => Math.min(m, x.cash), g.company.cash);
  return {
    subject: { kind: 'restructuring', ref: { kind: 'debt', id: 'per' } }, severity: 'red',
    title: `Restructuring: ${left} days of protection left`, what: `The court protects the company for ${left} more day${left === 1 ? '' : 's'}, until ${fmtDay(p.until)}`,
    why: `Cash is ${usd(g.company.cash)}; the creditors' claims are frozen and the insolvency clock stopped until then.`,
    hurt: mkHurt({ money: Math.max(0, -g.company.cash), what: 'to find', extra: `cash below zero on ${fmtDay(p.until)} means liquidation` }),
    actions: [
      { id: 'debt', label: 'Ways out of debt', open: { tab: 'finance', view: 'debt' }, primary: true },
      { id: 'findWork', label: 'Find work', open: { tab: 'contracts' } },
    ],
    details: [`Filed ${fmtDay(p.at)}; ${usd(p.writtenOff)} written off, ${usd(p.fees)} of fees`, `Forecast low in the period ${usd(low)}`, `Label until ${fmtDay(p.labelUntil)}; no new credit until ${fmtDay(p.noCreditUntil)}`],
    visuals: { gauges: [{ id: 'cash', label: 'Plan period', value: Math.min(D.per.months * 30, Math.floor((g.now - p.at) / DAY)), limit: Math.round(D.per.months * 30.44), unit: 'hm', text: `${Math.floor((g.now - p.at) / DAY)} of ${Math.round(D.per.months * 30.44)} days`, tone: 'bad' }] },
    terms: [], by: p.until,
  };
}

/** problems/money.ts: the distress cards standing today. Pure. */
export function distressProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const b = boardTargetCard(g);
  if (b) out.push(b);
  const r = restructuringCard(g);
  if (r) out.push(r);
  return out;
}

/** The type name helper for the panel (plain). */
export const typeShort = (typeId: string): string => typeOf(typeId).short;
