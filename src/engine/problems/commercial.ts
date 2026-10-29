// v0.7.1 contract problems as ProblemCards (UPDATE-0.7.1.md §9.2): an offer we can't fly yet, a counter
// about to expire, a client change request, a penalty just paid, a contract cancelled. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { typeOf } from '../core/perf';
import { DAY, fmtDateTime, fmtDay, fmtDuration } from '../core/time';
import type { ContractOffer, GameState, Message } from '../core/types';
import { counterView } from '../contracts/counter';
import { feasibility, type FeasibilityCheck, type FeasibilityReport } from '../contracts/feasibility';
import { jobName } from '../contracts/flavor';
import { mkHurt, type ProblemAction, type ProblemCard } from './types';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const clientName = (g: GameState, o: { clientId: string }) => g.clients[o.clientId]?.name ?? 'The client';


/** A check label inside a sentence: its first letter lowered unless it starts a code (DIL–LIS, A320, MAA). */
const lowerFirst = (t: string) => (/^[A-Z0-9]{2,}\b/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));

/** The worst check of the best report, in plain words, with the fix that goes with it. */
function plainCheck(g: GameState, o: ContractOffer, r: FeasibilityReport, c: FeasibilityCheck): { why: string; action: ProblemAction } {
  const ac = g.fleet[r.aircraftId];
  const t = typeOf(ac.typeId);
  switch (c.id) {
    case 'crew': {
      const short = Object.entries(r.crew.byRole).filter(([, v]) => v && v.short > 0).map(([role, v]) => `${v!.short} ${role}`);
      const list = short.length > 1 ? `${short.slice(0, -1).join(', ')} and ${short[short.length - 1]}` : short[0] ?? 'crew';
      return { why: `You are ${list} short${r.crew.firstShort !== null ? ` from ${fmtDay(r.crew.firstShort)}` : ''}; hires take weeks to join.`, action: { id: 'hire', label: 'Hire', open: { modal: 'hire', id: t.family }, primary: true } };
    }
    case 'availability':
      return { why: `${ac.reg} is busy: ${c.label.replace(/^Busy: /, '').replace(/^Can't be back for /, "it can't be back for ")}.`, action: { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } }, primary: true } };
    case 'range':
      return { why: `The ${t.short} can't fly it nonstop: ${lowerFirst(c.label)}${o.requirements.noTechStops ? '; the client wants no fuel stops' : ''}.`, action: { id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true } };
    case 'body':
      return { why: `${c.label}: no refit changes that.`, action: { id: 'market', label: 'Market', open: { tab: 'fleet', view: 'market' }, primary: true } };
    case 'layout':
      return { why: `The client needs a ${(o.requirements.layouts?.join(' or ') ?? o.requirements.layout ?? 'different').replace('vip', 'VIP')} cabin; ${ac.reg} is ${ac.cabin.label}.`, action: c.action ? { id: 'refit', label: 'Plan refit', open: { modal: 'refit', id: ac.id }, primary: true } : { id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true } };
    case 'paint':
      return { why: `The client wants their livery on the aircraft and no paint-shop slot fits before the start.`, action: { id: 'counterNoPaint', label: 'Counter without paint', open: { modal: 'offer', id: o.id }, primary: true } };
    case 'positioning':
      return { why: `${ac.reg} can't get to ${city(o.pin)} in time: ${lowerFirst(c.label)}.`, action: { id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true } };
    case 'approvals':
    case 'etops':
      return { why: `${c.label}.`, action: { id: 'ladder', label: 'Ladder', open: { tab: 'company', view: 'ladder' }, primary: true } };
    case 'lease':
      return { why: `${c.label}.`, action: { id: 'lease', label: 'Lease…', open: { modal: 'lease', id: ac.id }, primary: true } };
    default:
      return { why: `${c.label}.`, action: { id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true } };
  }
}

const RANK = { ok: 0, warn: 1, no: 2 } as const;

/** v0.12 what no move, sub-lease, hire or check can fix for this aircraft and job (it is the wrong aircraft for it). */
const HARD = new Set(['seats', 'layout', 'family', 'body', 'range', 'runway', 'etops', 'approvals', 'restSeats', 'rest']);
const hardNos = (r: FeasibilityReport) => r.checks.filter((c) => c.level === 'no' && HARD.has(c.id)).length;

/**
 * The best report for an offer (quick feasibility per aircraft). v0.12 among aircraft that can't take it, one only busy
 * (its trips can move or be sub-leased) comes before one that can never fit (too few seats), so the card's WHY and
 * its WHAT YOU CAN DO speak of the same aircraft.
 */
function bestReport(g: GameState, o: ContractOffer): FeasibilityReport | null {
  let best: FeasibilityReport | null = null;
  for (const id of Object.keys(g.fleet)) {
    const r = feasibility(g, o.id, id, { quick: true });
    const better = !best || RANK[r.level] < RANK[best.level]
      || (r.level === best.level && (hardNos(r) < hardNos(best) || (hardNos(r) === hardNos(best) && r.estMargin > best.estMargin)));
    if (better) best = r;
  }
  return best;
}

export function offerFitCard(g: GameState, offerId: string): ProblemCard | null {
  const o = g.offers[offerId];
  if (!o || o.status !== 'open' || o.expires <= g.now) return null;
  const r = bestReport(g, o);
  if (!r || r.level === 'ok') return null;
  const worst = [...r.checks].sort((a, b) => RANK[b.level] - RANK[a.level])[0];
  if (!worst || worst.level === 'ok') return null;
  const { why, action } = plainCheck(g, o, r, worst);
  const job = jobName(clientName(g, o), o.title);
  const hard = r.level === 'no';
  return {
    subject: { kind: 'offerFit', ref: { kind: 'offer', id: o.id } }, severity: hard ? 'red' : 'amber',
    title: hard ? `${job}: not flyable yet` : `${job}: check before signing`,
    what: hard ? `${job}: not flyable yet` : `${job}: check before signing`,
    why,
    hurt: mkHurt({ money: o.estValue, what: 'of work' }),
    actions: [action, ...(action.id !== 'review' ? [{ id: 'review', label: 'Review offer', open: { modal: 'offer' as const, id: o.id } }] : [])],
    details: r.checks.filter((c) => c.level !== 'ok').map((c) => `${c.label}${c.detail ? ` — ${c.detail}` : ''}`),
    visuals: {}, terms: o.product.kind === 'wet' ? ['acmi', 'wetLease'] : [], by: o.expires,
  };
}

export function counterExpiryCard(g: GameState, offerId: string): ProblemCard | null {
  const o = g.offers[offerId];
  const v = o ? counterView(g, o.id) : null;
  if (!o || !v) return null;
  const name = clientName(g, o);
  if (v.state === 'halfway' && o.status === 'open' && o.expires - g.now <= 24 * 60) {
    return {
      subject: { kind: 'counterExpiry', ref: { kind: 'offer', id: o.id } }, severity: o.expires - g.now <= 6 * 60 ? 'red' : 'amber',
      title: `${name}'s halfway offer expires in ${fmtDuration(o.expires - g.now)}`, what: `${name}'s halfway offer expires in ${fmtDuration(o.expires - g.now)}`,
      why: `They met us at ${v.text.replace(/^.*met us halfway: /, '').replace(/ · accept by.*$/, '')}; after ${fmtDateTime(o.expires)} UTC the job goes to a rival.`,
      hurt: mkHurt({ money: o.estValue, what: 'of work' }),
      actions: [{ id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true }], details: [v.text], visuals: {}, terms: [], by: o.expires,
    };
  }
  if (v.state === 'pending' && v.replyBy !== null && v.replyBy - g.now <= 12 * 60) {
    return {
      subject: { kind: 'counterExpiry', ref: { kind: 'offer', id: o.id } }, severity: 'amber',
      title: `${name} answers our counter by ${fmtDateTime(v.replyBy)}`, what: `${name} answers our counter by ${fmtDateTime(v.replyBy)}`,
      why: `We asked ${v.text.replace(/^Counter /, '').replace(/ sent.*$/, '')}; a refusal reopens the offer at the asking price.`,
      hurt: mkHurt({ money: o.estValue, what: 'of work' }),
      actions: [{ id: 'review', label: 'Review offer', open: { modal: 'offer', id: o.id }, primary: true }], details: [v.text], visuals: {}, terms: [], by: v.replyBy,
    };
  }
  return null;
}

export function changeRequestCard(g: GameState, decisionId: string): ProblemCard | null {
  const d = g.decisions.find((x) => x.id === decisionId);
  if (!d || d.kind !== 'changeRequest') return null;
  const c = d.data?.contractId ? g.contracts[String(d.data.contractId)] : undefined;
  const accept = d.options.find((o) => o.id === 'accept');
  // Round 4 (§V): an extra rotation's WHY is its body (said once: the modal drops the body under the card) and its
  // hurt the maintenance it costs; other requests keep the first sentence and the accept option's chips.
  const extra = d.data?.kind === 'extra';
  const maint = extra && typeof d.data?.maint === 'number' ? d.data.maint : 0;
  return {
    subject: { kind: 'changeRequest', ref: { kind: 'decision', id: d.id } }, severity: 'amber',
    title: d.title, what: d.title,
    why: extra ? d.body : `${d.body.split('. ')[0]}. ${accept?.desc ?? ''}`.trim(),
    hurt: extra ? mkHurt({ money: maint, what: 'maintenance' }) : mkHurt({ extra: accept?.chips?.join(', ') }),
    actions: [{ id: 'decide', label: 'Decide', open: { modal: 'decision', id: d.id }, primary: true }, ...(c ? [{ id: 'contract', label: 'Contract', open: { modal: 'contract' as const, id: c.id } }] : [])],
    details: d.options.map((o) => `${o.label}: ${o.desc}`), visuals: {}, terms: ['fdp'], by: d.expires,
  };
}

export function contractCancelledCard(g: GameState, contractId: string): ProblemCard | null {
  const c = g.contracts[contractId];
  if (!c || c.status !== 'cancelled' || !c.cancelledAt || c.cancelledAt < g.now - 7 * DAY) return null;
  const name = clientName(g, c);
  return {
    subject: { kind: 'contractCancelled', ref: { kind: 'contract', id: c.id } }, severity: 'amber',
    title: `${c.title} was cancelled`, what: `${c.title} was cancelled`,
    why: `Cancelled on ${fmtDay(c.cancelledAt)}; ${name} will remember it, and the aircraft's calendar is open again.`,
    hurt: mkHurt({ extra: 'relation and reputation' }),
    actions: [{ id: 'findWork', label: 'Find work', open: { tab: 'contracts' }, primary: true }], details: [], visuals: {}, terms: [], by: c.cancelledAt,
  };
}

/** A penalty posted on a contract: the message that paid it carries the card (after the fact). */
export function penaltyCard(_g: GameState, m: Message): ProblemCard | null {
  if (!m.hurt || !m.ref || m.ref.kind !== 'contract') return null;
  return {
    subject: { kind: 'penalty', ref: m.ref }, severity: 'amber', title: m.title, what: m.title, why: m.body,
    hurt: mkHurt({ money: m.hurt.money, pax: m.hurt.pax, delayMin: m.hurt.delayMin, what: 'paid' }),
    actions: [{ id: 'contract', label: 'Contract', open: { modal: 'contract', id: m.ref.id }, primary: true }], details: [], visuals: {}, terms: [], by: m.t,
  };
}

export function commercialProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const o of Object.values(g.offers)) {
    if (o.status === 'open' && o.start <= g.now + 60 * DAY) {
      const ce = counterExpiryCard(g, o.id);
      if (ce) out.push(ce);
      else if (o.urgency !== 'normal' || o.expires - g.now <= 3 * DAY) {
        const f = offerFitCard(g, o.id);
        if (f && f.severity === 'red') out.push(f);
      }
    } else if (o.status === 'countered') {
      const ce = counterExpiryCard(g, o.id);
      if (ce) out.push(ce);
    }
  }
  for (const d of g.decisions) if (d.kind === 'changeRequest') {
    const c = changeRequestCard(g, d.id);
    if (c) out.push(c);
  }
  for (const c of Object.values(g.contracts)) {
    const x = contractCancelledCard(g, c.id);
    if (x) out.push(x);
  }
  return out;
}
