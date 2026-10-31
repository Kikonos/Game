// v0.12.1 approvals at departure (player decision): a revenue or positioning leg that needs an approval we do not
// hold when it leaves (Widebody operations and the Ladder's other gates for its type, the ETOPS level of its route)
// does not fly. Feasibility only checked this at signing ("If the grant slips, the job cannot be flown"): a 767 flew
// fourteen Croatia Airlines legs with Widebody operations stuck waiting for rated pilots. Ferries (delivery, lease,
// return, sale, checks) fly on a ferry permit, as before. Ahead of time (when the grant is late or stuck) the leg gets
// the card and a decision: sub-charter at our cost, swap aircraft (the flight sheet), or cancel (our fault: we
// signed it). At the gate, by default, a rival flies it if one can, else it is cancelled.

import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { pushMessage } from '../core/messages';
import { etopsNeeded, typeOf } from '../core/perf';
import { range } from '../core/rng';
import { DAY, fmtDate, fmtDay } from '../core/time';
import type { ActionResult, Aircraft, ApprovalId, Decision, Flight, GameState, Minute } from '../core/types';
import { rerosterFrom } from '../crew';
import { APPROVALS, gateApprovals, waitingFor } from './company';
import { ask } from './events';
import { cancelCost, cancelLegs, moveFlight, noticeText, pickRival, rivalFactor, subcharterCost, subcharterLegs, type SubHit, unitOf } from './flights';
import { contractOf, isRevenue, usd } from './util';

/** Why an approval is not ours at a time: never applied for, stuck waiting at the authority, or due after it. */
export type GateState = 'missing' | 'waiting' | 'late';
export interface GateMiss { id: ApprovalId; state: GateState; /** Pending: the authority's due date. */ due: Minute | null }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ETOPS_ID = (min: number): ApprovalId => (min > 180 ? 'etops240' : min > 120 ? 'etops180' : 'etops120');
/** 'Widebody operations', 'ETOPS 180'. */
export const gateName = (id: ApprovalId): string => APPROVALS.find((a) => a.id === id)?.name ?? id;
const nameOf = gateName;

/**
 * The approvals a leg needs on our certificate: the Ladder's gate of its type and the ETOPS level of its route (twins).
 * None for a ferry (permit), a deadhead or a sub-chartered leg. Pure.
 */
export function legApprovals(g: GameState, f: Flight): ApprovalId[] {
  if (!f.aircraftId || f.operatedBy || f.kind === 'ferry' || f.kind === 'deadhead') return [];
  const ac = g.fleet[f.aircraftId];
  if (!ac) return [];
  const t = typeOf(ac.typeId);
  const out = [...gateApprovals(t.tier)];
  if (t.engines === 2) {
    const need = etopsNeeded(ac.typeId, f.from, f.to);
    if (need > 0) out.push(ETOPS_ID(need));
  }
  return [...new Set(out)];
}

const ETOPS_MIN: Partial<Record<ApprovalId, number>> = { etops120: 120, etops180: 180, etops240: 240 };
/** v0.12.1 a held higher ETOPS approval covers a lower one (ETOPS 180 flies a 120-minute leg). Pure. */
export const etopsCovered = (held: readonly ApprovalId[], id: ApprovalId): boolean => !!ETOPS_MIN[id] && held.some((a) => (ETOPS_MIN[a] ?? 0) >= ETOPS_MIN[id]!);

/** What a leg needs that we will not hold at `t` (its departure by default): missing, stuck (waiting) or due later. Pure. */
export function gateMisses(g: GameState, f: Flight, t: Minute = f.std + f.delay): GateMiss[] {
  const co = g.company;
  const out: GateMiss[] = [];
  for (const id of legApprovals(g, f)) {
    if (co.approvals.includes(id) || etopsCovered(co.approvals, id)) continue;
    const p = co.pendingApprovals.find((x) => x.id === id);
    if (!p) out.push({ id, state: 'missing', due: null });
    else if (p.waiting) out.push({ id, state: 'waiting', due: p.done });
    else if (p.done > t) out.push({ id, state: 'late', due: p.done });
    else if (t <= g.now) out.push({ id, state: 'late', due: p.done });
  }
  return out;
}

/** The WHY in one plain sentence: 'Widebody operations is stuck: the authority waits for rated pilots (…)'. Pure. */
export function gateWhy(g: GameState, f: Flight, m: GateMiss): string {
  const name = nameOf(m.id);
  if (m.state === 'missing') return `We don't hold ${name}, and it is not applied for.`;
  if (m.state === 'waiting') {
    const p = g.company.pendingApprovals.find((x) => x.id === m.id);
    const why = p?.waiting ? ` (${p.waiting.replace(/^Needs /, 'needs ')})` : '';
    return `${name} is stuck: the authority waits for ${waitingFor(p?.waiting ?? '')}${why}.`;
  }
  return `${name} is due ${fmtDate(m.due ?? f.std)}, after ${f.no} leaves on ${fmtDay(f.std)}.`;
}

/** Scheduled revenue legs within the warning window that need an approval we won't hold by then, by departure. Pure. */
export function legsAtRisk(g: GameState, days: number = BAL.ladder.gateWarnDays): Flight[] {
  const until = g.now + days * DAY;
  const out: Flight[] = [];
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.aircraftId || !isRevenue(f) || f.std > until) continue;
    if (gateMisses(g, f).length) out.push(f);
  }
  return out.sort((a, b) => a.std - b.std || (a.id < b.id ? -1 : 1));
}

/** v0.12.1 the jobs a pending approval puts at risk (the Ladder card): client name, legs and the first departure. Pure. */
export function jobsAtRisk(g: GameState, id: ApprovalId): { contractId: string; client: string; legs: number; first: Minute }[] {
  const by = new Map<string, { contractId: string; client: string; legs: number; first: Minute }>();
  for (const f of legsAtRisk(g, 366)) {
    if (!f.contractId || !gateMisses(g, f).some((m) => m.id === id)) continue;
    const k = g.contracts[f.contractId];
    const x = by.get(f.contractId) ?? { contractId: f.contractId, client: (k && g.clients[k.clientId]?.name) || 'A client', legs: 0, first: f.std };
    x.legs++;
    x.first = Math.min(x.first, f.std);
    by.set(f.contractId, x);
  }
  return [...by.values()].sort((a, b) => a.first - b.first);
}

/**
 * v0.12.1 the Ladder's line for a pending approval: which jobs it puts at risk, or null. 'At risk: Croatia Airlines,
 * 14 legs from 20 Feb' / '…, and 2 more jobs'. Pure.
 */
export function atRiskLine(g: GameState, id: ApprovalId): string | null {
  const jobs = jobsAtRisk(g, id);
  if (!jobs.length) return null;
  const j = jobs[0];
  const more = jobs.length - 1;
  return `At risk: ${j.client}, ${plural(j.legs, 'leg')} from ${fmtDay(j.first)}${more ? `, and ${plural(more, 'more job')}` : ''}`;
}

/** The blocked revenue legs of the job the leg belongs to, on its aircraft, inside the warning window. Pure. */
export function blockedGroup(g: GameState, f: Flight): Flight[] {
  return legsAtRisk(g).filter((x) => x.aircraftId === f.aircraftId && x.contractId === f.contractId);
}

/**
 * Daily: a job with legs at risk gets the decision once a week while it lasts (sub-charter, cancel, or keep it for the
 * gate's default). Its card is in the problems list all along (problems/approval.ts).
 */
export function dailyApprovalGate(g: GameState): void {
  // (Asks older than a month are forgotten.)
  if (g.stats.gateAsked) for (const [k, t] of Object.entries(g.stats.gateAsked)) if (t < g.now - 30 * DAY) delete g.stats.gateAsked[k];
  const seen = new Set<string>();
  for (const f of legsAtRisk(g)) {
    const key = `${f.contractId ?? f.id}|${f.aircraftId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const k = contractOf(g, f);
    if (g.decisions.some((d) => d.kind === 'approvalLate' && d.data?.key === key)) continue;
    const last = (g.stats.gateAsked ??= {})[key];
    if (last !== undefined && g.now - last < 7 * DAY) continue;
    g.stats.gateAsked[key] = g.now;
    const legs = blockedGroup(g, f);
    const ac = g.fleet[f.aircraftId!];
    const m = gateMisses(g, f)[0];
    const who = (k && g.clients[k.clientId]?.name) || 'the client';
    const rivalId = pickRival(g, ac.typeId, legs);
    const sub = rivalId ? subcharterCost(g, legs, 1.5 * rivalFactor(g, rivalId)) : 0;
    const pen = cancelCost(g, legs);
    const n = plural(legs.length, 'leg');
    ask(g, {
      kind: 'approvalLate', title: `${f.no} can't fly without ${nameOf(m.id)}`,
      body: `${gateWhy(g, f, m)} ${n} for ${who} from ${fmtDay(f.std)} need it. Without it on the day, a rival flies them if one can, else they are cancelled.`,
      options: [
        { id: 'wait', label: 'Wait for the grant', desc: 'If it is still missing at the gate, a rival flies the leg if one can, else it is cancelled.', chips: [n] },
        ...(rivalId ? [{ id: 'subcharter', label: `Sub-charter to ${g.rivals.find((r) => r.id === rivalId)?.name ?? 'a rival'}`, desc: 'A rival flies them at our cost; we still bill the client.', tone: 'warn' as const, chips: [usd(-sub), n] }] : []),
        { id: 'cancel', label: 'Cancel those legs', desc: 'Our fault: we signed the job. Compensation, and reliability falls.', tone: 'bad', chips: [pen ? usd(-pen) : 'No compensation', n] },
      ],
      defaultOption: 'wait', expires: Math.max(g.now + 60, Math.min(f.std - 3 * 60, g.now + 12 * 60)), ref: { kind: 'flight', id: f.id },
      data: { key, flightId: f.id, aircraftId: ac.id, ...(rivalId ? { rivalId } : {}) },
    });
  }
}

/** Resolver of 'approvalLate': wait (the gate decides), the job's blocked legs to a rival, or cancelled (our fault). */
export function resolveApprovalLate(g: GameState, d: Decision, opt: string): ActionResult {
  const f = g.flights[String(d.data?.flightId ?? '')];
  if (!f || f.status !== 'scheduled') return { ok: true, msg: 'The leg is gone' };
  if (opt === 'wait') return { ok: true, msg: `${f.no} waits for the grant` };
  const legs = blockedGroup(g, f);
  if (!legs.length) return { ok: true, msg: 'Nothing is at risk any more' };
  const ac = g.fleet[f.aircraftId ?? ''];
  if (opt === 'subcharter') {
    const rival = String(d.data?.rivalId ?? '') || (ac ? pickRival(g, ac.typeId, legs) : '');
    if (!rival) return { ok: false, error: 'No rival can take them' };
    const n = subcharterLegs(g, legs, rival, subcharterCost(g, legs, 1.5 * rivalFactor(g, rival)));
    if (ac) rerosterFrom(g, ac.id, g.now);
    return { ok: true, msg: `${g.rivals.find((r) => r.id === rival)?.name ?? 'A rival'} flies ${plural(n, 'leg')} for us` };
  }
  if (opt === 'cancel') {
    const rev = legs.filter(isRevenue).length;
    const pen = cancelLegs(g, legs, 'No approval', rev ? BAL.crewControl.cancelRep : 0);
    if (ac) rerosterFrom(g, ac.id, g.now);
    return { ok: true, msg: `${plural(rev, 'leg')} cancelled${pen ? `, ${usd(pen)} compensation` : ''}` };
  }
  return { ok: false, error: 'Unknown option' };
}

/**
 * At the gate (flights.ts onFlightDep): a leg that needs an approval we don't hold does not leave. A positioning leg
 * days ahead of its job waits for the grant; otherwise the unit it starts goes to a rival when one can take it (our
 * cost), else it is cancelled (our fault: compensation and reliability). True when the leg was stopped.
 */
export function noApprovalAtGate(g: GameState, f: Flight, ac: Aircraft): boolean {
  const miss = gateMisses(g, f, g.now);
  if (!miss.length) return false;
  const legs = unitOf(g, ac, f);
  const rev = legs.filter(isRevenue);
  const name = miss.map((m) => nameOf(m.id)).join(' and ');
  if (!rev.length) {
    // An empty leg with no job right behind it waits for the grant (or a day while it is stuck).
    const due = Math.max(...miss.map((m) => (m.state === 'late' && m.due ? m.due : g.now + DAY)));
    moveFlight(g, f, Math.max(g.now + 60, due + 60), `Waiting: ${name}`);
    return true;
  }
  const why = `${ac.reg} can't fly passengers without ${name}.`;
  const live = legs.filter((x) => x.status === 'scheduled');
  const rivalId = pickRival(g, ac.typeId, live);
  if (rivalId) {
    const cost = subcharterCost(g, live, range(g, BAL.subcharterFactor[0], BAL.subcharterFactor[1]) * rivalFactor(g, rivalId));
    const out: { hit?: SubHit } = {};
    subcharterLegs(g, live, rivalId, cost, out);
    pushMessage(g, {
      tone: 'warn', cat: 'company', title: `${rev[0].no} sub-chartered${rev.length > 1 ? ` with ${rev.length - 1} more` : ''}: no ${name}`,
      body: `${why} ${g.rivals.find((r) => r.id === rivalId)?.name ?? 'A rival'} flies ${rev.map((x) => `${x.no} ${x.from}–${x.to}`).join(', ')} for us (${usd(cost)}); the client is billed as usual.${noticeText(g, rev[0], out.hit)}`,
      ref: { kind: 'flight', id: rev[0].id },
    });
  } else {
    const pen = cancelLegs(g, live, `No approval: ${name}`, BAL.crewControl.cancelRep);
    pushMessage(g, {
      tone: 'bad', cat: 'company', title: `${rev[0].no} cancelled${rev.length > 1 ? ` with ${rev.length - 1} more` : ''}: no ${name}`,
      body: `${why} No rival could take ${rev.length > 1 ? 'them' : 'it'}: ${rev.map((x) => `${x.no} ${x.from}–${x.to}`).join(', ')} cancelled. Our fault: ${pen ? `compensation ${usd(pen)}, ` : ''}reliability falls.`,
      ref: { kind: 'flight', id: rev[0].id },
    });
  }
  (g.stats.gateStopped ??= 0);
  g.stats.gateStopped += rev.length;
  rerosterFrom(g, ac.id, g.now);
  return true;
}

/** Legs of an aircraft that need an approval held only later (dev and tests). */
export const blockedLegsOf = (g: GameState, aircraftId: string): Flight[] => flightsOf(g, aircraftId).filter((f) => f.status === 'scheduled' && gateMisses(g, f).length > 0);
