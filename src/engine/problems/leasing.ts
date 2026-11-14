// v0.17 the aircraft market's problem cards (UPDATE-0.17.md §N.4; lane `deals`), four lines each: what · why · does it
// hurt · what you can do. Action ids the Market screen acts on directly (each also opens the deal row or the aircraft):
// 'dealPay' (meet the security in cash), 'dealLc' (by letter of credit), 'dealSign', 'dealWalk', 'techReps',
// 'aocApply'. Pure.

import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { GameState, LeaseDeal } from '../core/types';
import { usd } from '../ops/util';
import { mkHurt, type ProblemAction, type ProblemCard } from './types';
import { needsVariation, variationQuote } from '../leasing/aoc';
import { rating } from '../leasing/credit';
import { cashToSign, depositDue } from '../leasing/deals';
import { lcWhy } from '../finance/lc';
import { workSoonAfter } from '../leasing/induction';

const lessorOf = (d: LeaseDeal) => d.offer.lessor.replace(' (used sale)', '');
const dealOpen = (id: string) => ({ tab: 'fleet' as const, view: 'market', sel: { kind: 'deal' as const, id } });
const acOpen = (id: string) => ({ tab: 'fleet' as const, sel: { kind: 'aircraft' as const, id } });

/** 'Avolon wants more security for the A330-200' (deal id); or a letter of credit the lessor wants in cash (aircraft id). */
export function leaseConditionsCard(g: GameState, dealId: string): ProblemCard | null {
  const L = g.leasing;
  if (!L) return null;
  const ac = g.fleet[dealId];
  if (ac) {
    const due = L.lcCashDue?.[ac.id];
    const v = L.lc[ac.id];
    if (due === undefined || !v || ac.ownership.kind !== 'dryLeaseIn') return null;
    const what = `${ac.ownership.lessor} wants cash for ${ac.reg}'s deposit`;
    return {
      subject: { kind: 'leaseConditions', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber', title: what, what,
      why: 'The credit line behind its letter of credit is frozen or closed.',
      hurt: mkHurt({ money: v, what: `taken in cash on ${fmtDay(due)}`, extra: 'refunded at the return' }),
      actions: [{ id: 'finance', label: 'Finance', open: { tab: 'finance' }, primary: true }, { id: 'aircraft', label: ac.reg, open: acOpen(ac.id) }],
      details: [`Letter of credit ${usd(v)}`, 'A renewed line lets the letter of credit stand'], visuals: {}, terms: [], by: due,
    };
  }
  const d = L.deals.find((x) => x.id === dealId);
  if (!d || d.stage !== 'conditions' || !d.conditions) return null;
  const t = typeOf(d.offer.typeId);
  const now = rating(g).grade;
  const extra = d.conditions.extraDeposit;
  const lw = lcWhy(g, d.offer.lessorId, now, depositDue(d));
  const what = `${lessorOf(d)} wants more security for the ${t.short}`;
  return {
    subject: { kind: 'leaseConditions', ref: { kind: 'deal', id: d.id } }, severity: 'amber', title: what, what,
    why: now !== d.gradeAtOffer ? `Our lessor rating fell from ${d.gradeAtOffer} to ${now} since the letter of intent.` : `At rating ${now} its credit committee asks one more month's deposit.`,
    hurt: mkHurt({ money: extra, what: 'more deposit', extra: `or walk away by ${fmtDay(d.conditions.until)} (the ${usd(d.holding)} holding deposit comes back)` }),
    actions: [
      { id: 'dealPay', label: `Pay ${usd(extra)}`, open: dealOpen(d.id), primary: true },
      ...(!lw ? [{ id: 'dealLc', label: 'Letter of credit', open: dealOpen(d.id) }] : []),
      { id: 'dealWalk', label: 'Walk away', open: dealOpen(d.id) },
    ],
    details: [`Deposit at signing ${usd(depositDue(d))} with the extra`, lw ? `Letter of credit: ${lw}` : 'A letter of credit uses the undrawn credit line (1.25 % a year)', `No answer by ${fmtDay(d.conditions.until)}: the deal lapses and the holding deposit comes back`],
    visuals: {}, terms: [], by: d.conditions.until,
  };
}

/** 'Approved: sign the A320ceo lease' (deal id). */
export function leaseSignCard(g: GameState, dealId: string): ProblemCard | null {
  const d = g.leasing?.deals.find((x) => x.id === dealId);
  if (!d || d.stage !== 'approved' || d.signBy === undefined) return null;
  const t = typeOf(d.offer.typeId);
  const due = cashToSign(g, d);
  const short = g.company.cash < due;
  const what = `Approved: sign the ${t.short} lease`;
  return {
    subject: { kind: 'leaseSign', ref: { kind: 'deal', id: d.id } }, severity: 'amber', title: what, what,
    why: `${lessorOf(d)}'s credit check passed; ${short ? `cash is short (${usd(due)} due to sign)` : 'automatic signing was off'}.`,
    hurt: mkHurt({ money: d.holding, what: `holding deposit lost if not signed by ${fmtDay(d.signBy)}` }),
    actions: [
      { id: 'dealSign', label: `Sign (${usd(due)})`, open: dealOpen(d.id), primary: true },
      { id: 'dealWalk', label: 'Walk away', open: dealOpen(d.id) },
    ],
    details: [`Deposit ${usd(depositDue(d))}${d.lc ? ' by letter of credit' : ''}; transition and extras included in the sum`, `At ${fmtDay(d.signBy)} it is signed if the cash is there, else the holding deposit is lost`],
    visuals: {}, terms: [], by: d.signBy,
  };
}

/** 'Transition findings on CS-TQB' (aircraft id), only with work booked soon after the handover. */
export function inductionDelayCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  const i = ac?.induction;
  if (!ac || !i?.findings || ac.status !== 'delivering' || i.check[0] > g.now || i.ready <= g.now) return null;
  if (!workSoonAfter(g, ac, i.ready)) return null;
  const wide = typeOf(ac.typeId).body === 'wide';
  const cost = BAL.v017.induction.techReps.cost[wide ? 'wide' : 'narrow'];
  const first = Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.contractId && f.status === 'scheduled').sort((a, b) => a.std - b.std)[0];
  const what = `Transition findings on ${ac.reg}`;
  const actions: ProblemAction[] = [];
  if (!i.techReps) actions.push({ id: 'techReps', label: `Add tech reps (${usd(cost)}, −5 days)`, open: acOpen(ac.id), primary: true });
  if (first) actions.push({ id: 'subcharter', label: 'Sub-charter the first week', open: { modal: 'subcharter', id: first.id }, primary: !actions.length });
  actions.push({ id: 'aircraft', label: ac.reg, open: acOpen(ac.id) });
  return {
    subject: { kind: 'inductionDelay', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber', title: what, what,
    why: `${i.findings.text}.`,
    hurt: mkHurt({ extra: `ready ${i.findings.days} days later, ${fmtDay(i.ready)}${first && first.std < i.ready + 3 * DAY ? `; ${first.no} on ${fmtDay(first.std)} starts without it` : ''}` }),
    actions, details: [`Transition at ${ac.delivery?.where ?? ac.at}`, `Expected ${fmtDay(i.expected ?? i.ready)} before the findings`], visuals: {}, terms: [], by: i.ready,
  };
}

/** 'The 737-800 needs our AOC varied' (aircraft or deal id). */
export function variationNeededCard(g: GameState, id: string): ProblemCard | null {
  const ac = g.fleet[id];
  const d = ac ? undefined : g.leasing?.deals.find((x) => x.id === id && (x.stage === 'committee' || x.stage === 'conditions' || x.stage === 'approved'));
  const typeId = ac?.typeId ?? d?.offer.typeId;
  if (!typeId) return null;
  const t = typeOf(typeId);
  if (!needsVariation(g, t.family)) return null;
  if ((g.company.aocVariations ?? []).some((v) => v.family === t.family && !v.granted)) return null;
  const q = variationQuote(g, t.family, typeId);
  if (!q) return null;
  const handover = ac?.delivery?.handover ?? ac?.induction?.ready;
  const what = `The ${t.short} needs our AOC varied`;
  return {
    subject: { kind: 'variationNeeded', ref: ac ? { kind: 'aircraft', id: ac.id } : { kind: 'deal', id } }, severity: 'amber', title: what, what,
    why: `No ${t.family} on our AOC: the authority takes ${q.days} days. Crew can be hired and trained on it once it is filed.`,
    hurt: mkHurt({ extra: `${handover ? `handover ${fmtDay(handover)}; ` : ''}revenue flights only after the variation (about ${fmtDay(q.due)} if filed today)` }),
    actions: [
      { id: 'aocApply', label: `Apply (${usd(q.cost)})`, open: { tab: 'company', view: 'ladder' }, primary: true },
      // v0.24 no 'Book conversions' here: crew are trained onto the type once the variation is filed (crewTypeBlock).
    ],
    details: [q.text], visuals: {}, terms: [], by: q.due,
  };
}

/** 'D-ATUB goes back to TUI fly on 31 Mar' (aircraft id), 14 days before. */
export function spotReturnCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn' || !ac.ownership.spot) return null;
  const end = ac.ownership.leaseEnd;
  if (end - g.now > 14 * DAY || end < g.now - DAY) return null;
  const sp = ac.ownership.spot;
  const late = Math.round(((ac.ownership.rentPerMonth * 12) / 365) * BAL.v017.terms.spotReturn.lateX);
  const what = `${ac.reg} goes back to ${sp.airline} on ${fmtDay(end)}`;
  return {
    subject: { kind: 'spotReturn', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber', title: what, what,
    why: `The short-term lease ends; it is handed back at ${sp.base}.`,
    hurt: mkHurt({ money: late, what: 'a day if late' }),
    actions: [{ id: 'aircraft', label: 'Plan the return ferry', open: acOpen(ac.id), primary: true }],
    details: [`Late costs ${usd(late)} a day (twice the daily rent)`], visuals: {}, terms: [], by: end,
  };
}

/** Every current leasing problem (problems/index.ts problems). Pure. */
export function leasingProblems(g: GameState): ProblemCard[] {
  const L = g.leasing;
  if (!L || !BAL.v017.on) return [];
  const out: ProblemCard[] = [];
  const push = (c: ProblemCard | null) => {
    if (c) out.push(c);
  };
  for (const d of L.deals) {
    if (d.stage === 'conditions') push(leaseConditionsCard(g, d.id));
    else if (d.stage === 'approved') push(leaseSignCard(g, d.id));
  }
  for (const id of Object.keys(L.lcCashDue ?? {})) push(leaseConditionsCard(g, id));
  const fams = new Set<string>();
  for (const ac of Object.values(g.fleet)) {
    if (ac.induction?.findings) push(inductionDelayCard(g, ac.id));
    if (ac.ownership.kind === 'dryLeaseIn' && ac.ownership.spot) push(spotReturnCard(g, ac.id));
    const fam = typeOf(ac.typeId).family;
    if (!fams.has(fam) && needsVariation(g, fam)) {
      fams.add(fam);
      push(variationNeededCard(g, ac.id));
    }
  }
  return out;
}
