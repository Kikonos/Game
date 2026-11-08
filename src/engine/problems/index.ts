// v0.7.1 one read API for every problem (UPDATE-0.7.1.md §1, §8, §9): problemFor dispatches by kind, problems lists
// every current card worst first (cached per state revision and hour), problemAt finds the card behind a red or
// amber dot, postProblem posts the Inbox message every lane posts the same way.

import { flightsRev } from '../core/entities';
import { readCache, uiRev } from '../core/uiRev';
import { pushMessage } from '../core/messages';
import type { Cue } from '../core/cues';
import type { GameState, Message, MessageCat, ProblemKind, ProblemRef, Ref } from '../core/types';
import { crewRev } from '../crew/timeline';
import { crewPeakCard } from '../crew/forecast';
import { crewHoldCard } from '../crew/utilisation';
import { cabinRestCard, captainAsFoCard, crewFlightCard, crewHoursCard, crewProblems, crewResignedCard, crewSickCard, restCards, restFacilityCard, restSeatsCard, restTooShortCard } from './crew';
import { changeRequestCard, commercialProblems, contractCancelledCard, counterExpiryCard, offerFitCard, penaltyCard } from './commercial';
import { awayIdleCard, awayIdleSince, deliveryWaitCard, ferryUncrewedCard, noFerryCard, fleetProblems, leaseReturnCard, refitMissedCard, saleCard } from './fleet';
import { cashLowCard, cashNegativeCard, covenantBreachCard, creditHeadroomCard, factorRecourseCard, invoiceOverdueCard, leaseDueCard, loanDueCard, lossMonthCard, moneyProblems } from './money';
import { leadColdCard, leadProblems } from '../commercial/sales';
import { boardTargetCard, restructuringCard } from '../finance/distress';
import { aogCard, checkCard, checkClashCard, noSlotCard, techProblems } from './tech';
import { hurtBadges, hurtProse, type ProblemCard } from './types';
import { auditFindingCard, disruptionAt, disruptionCard, isDisruption, opsProblems, rampFindingCard } from './ops';
import { approvalLateCard, approvalProblems } from './approval';
import { clientCrisisCard, crisisProblems } from '../commercial/crises';
import { inductionDelayCard, leaseConditionsCard, leaseSignCard, leasingProblems, spotReturnCard, variationNeededCard } from './leasing';
import { airspaceClosedCard, clientUnhappyCard, dryLeaseInfoCard, leaseDamageCard, leaseLateCard, lostToRivalCard, uninsurableCard, worldProblems } from './world';

export { hurtBadges, lateText, limitTone, mkHurt, usdShort } from './types';
export type { GaugeSpec, Hurt, MiniMapSpec, ProblemAction, ProblemCard, ReachSpec, TimelineSpec } from './types';
export type { ProblemKind, ProblemRef };
export { approvalLateCard };
export { clientUnhappyCard, lostToRivalCard, airspaceClosedCard, uninsurableCard, leaseLateCard, leaseDamageCard, dryLeaseInfoCard };
export { crewFlightCard, crewHoursCard, crewSickCard, crewResignedCard, aogCard, checkCard, checkClashCard, noSlotCard, offerFitCard, counterExpiryCard, changeRequestCard, contractCancelledCard, cashLowCard, cashNegativeCard, invoiceOverdueCard, lossMonthCard, leaseDueCard, deliveryWaitCard, ferryUncrewedCard, noFerryCard, refitMissedCard, leaseReturnCard, captainAsFoCard, restSeatsCard, saleCard, restFacilityCard, restTooShortCard, cabinRestCard };

/**
 * v0.15.1 (perf) the direct look-ups (problemFor, problemAt) cached like the list: per state revision and hour (keyOf)
 * and the player's edit count, so a screen asking the same question many times in one hour (every offer card, every
 * Inbox line, every render) computes it once. Only the app reads this cache (uiRev.ts enableReadCache), and never inside
 * an engine step (an event, a player action): the simulation and the messages it posts always read the live state.
 */
const lookups = new WeakMap<GameState, { key: string; m: Map<string, ProblemCard | null> }>();
function lookup(g: GameState, k: string, f: () => ProblemCard | null): ProblemCard | null {
  if (!readCache()) return f();
  const key = `${keyOf(g)}:${uiRev()}`;
  let c = lookups.get(g);
  if (!c || c.key !== key) lookups.set(g, (c = { key, m: new Map() }));
  const hit = c.m.get(k);
  if (hit !== undefined || c.m.has(k)) return hit ?? null;
  const v = f();
  c.m.set(k, v);
  return v;
}

/** Alarm self-check: a crew card on a flight whose alarm was confirmed carries the evidence ("Checked ✓"). Pure. */
function withChecked(g: GameState, card: ProblemCard | null): ProblemCard | null {
  if (!card || card.checked || card.subject.ref.kind !== 'flight' || !card.subject.kind.startsWith('crew')) return card;
  const f = g.flights[card.subject.ref.id];
  return f?.crewAlert && f.crewChecked?.length ? { ...card, checked: f.crewChecked } : card;
}

/** The card for one problem (null = no problem, or not any more). Pure. */
export function problemFor(g: GameState, subject: ProblemRef): ProblemCard | null {
  return lookup(g, `for:${subject.kind}:${subject.ref.kind}:${subject.ref.id}`, () => withChecked(g, problemForRaw(g, subject)));
}

function problemForRaw(g: GameState, subject: ProblemRef): ProblemCard | null {
  const id = subject.ref.id;
  switch (subject.kind) {
    case 'crewShort': case 'crewIllegal': case 'crewTight': case 'crewReach': case 'crewRest': case 'crewFdp':
      return crewFlightCard(g, id, subject.kind);
    case 'crewSick': return crewSickCard(g, id);
    case 'crewResigned': return crewResignedCard(g, id);
    case 'aog': return aogCard(g, id);
    case 'checkDue': case 'checkOverdue': case 'grounded': return checkCard(g, id);
    case 'checkClash': return checkClashCard(g, id);
    case 'checkNoSlot': return noSlotCard(g, id);
    case 'offerFit': return offerFitCard(g, id);
    case 'counterExpiry': return counterExpiryCard(g, id);
    case 'changeRequest': return changeRequestCard(g, id);
    case 'penalty': {
      // v0.14.1 (CODE-03) by the problem's own ref (the contract): the message's ref is the flight that was late or
      // cancelled, so matching on it never found one. The card opens the contract.
      const m = g.messages.find((x) => x.problem?.kind === 'penalty' && x.problem.ref.id === id);
      return m ? penaltyCard(g, { ...m, ref: m.problem!.ref }) : null;
    }
    case 'contractCancelled': return contractCancelledCard(g, id);
    case 'cashLow': return cashLowCard(g);
    case 'cashNegative': return cashNegativeCard(g);
    case 'invoiceOverdue': return invoiceOverdueCard(g, id);
    case 'lossMonth': return lossMonthCard(g);
    case 'leaseDue': return leaseDueCard(g, id);
    case 'deliveryWait': return deliveryWaitCard(g, id);
    case 'awayIdle': return awayIdleCard(g, id);
    case 'noFerry': return noFerryCard(g, id);
    case 'ferryUncrewed': return ferryUncrewedCard(g, id);
    case 'refit': return refitMissedCard(g, id);
    case 'leaseReturn': return leaseReturnCard(g, id);
    // v0.7.2
    case 'restSeats': return restSeatsCard(g, id);
    case 'captainAsFo': return captainAsFoCard(g, id);
    case 'sale': return saleCard(g, id);
    // v0.7.3 (ref: the duty's first flight)
    case 'restFacility': return restFacilityCard(g, id);
    case 'restTooShort': return restTooShortCard(g, id);
    case 'cabinRest': return cabinRestCard(g, id);
    // v0.8
    case 'clientUnhappy': return clientUnhappyCard(g, id);
    case 'lostToRival': return lostToRivalCard(g, id);
    case 'airspaceClosed': return airspaceClosedCard(g, id);
    case 'uninsurable': return uninsurableCard(g, id);
    case 'leaseLate': return leaseLateCard(g, id);
    case 'leaseDamage': return leaseDamageCard(g, id);
    case 'dryLeaseInfo': return dryLeaseInfoCard(g, id);
    // v0.9
    case 'crewHours': return crewHoursCard(g, id);
    // v0.11
    case 'disruption': return disruptionAt(g, id);
    case 'rampFinding': return rampFindingCard(g, id);
    case 'auditFinding': return auditFindingCard(g, id);
    // Peak-staffing round
    case 'crewPeak': return crewPeakCard(g, id);
    case 'crewHold': return crewHoldCard(g, id);
    // v0.12.1
    case 'approvalLate': return approvalLateCard(g, id);
    // v0.14
    case 'clientCrisis': return clientCrisisCard(g, id);
    // v0.16 finance (problems/money.ts) and sales (commercial/sales.ts).
    case 'covenantBreach': return covenantBreachCard(g);
    case 'loanDue': return loanDueCard(g, id);
    case 'creditHeadroom': return creditHeadroomCard(g);
    case 'factorRecourse': return factorRecourseCard(g, id);
    case 'leadCold': return leadColdCard(g, id);
    // v0.16.3 distress finance (finance/distress.ts).
    case 'boardTarget': return boardTargetCard(g);
    case 'restructuring': return restructuringCard(g);
    // v0.17 the aircraft market (problems/leasing.ts).
    case 'leaseConditions': return leaseConditionsCard(g, id);
    case 'leaseSign': return leaseSignCard(g, id);
    case 'inductionDelay': return inductionDelayCard(g, id);
    case 'variationNeeded': return variationNeededCard(g, id);
    case 'spotReturn': return spotReturnCard(g, id);
  }
}

const SEV = { red: 0, amber: 1 } as const;
const KIND_RANK: ProblemKind[] = [
  'aog', 'grounded', 'crewHours', 'crewShort', 'crewIllegal', 'ferryUncrewed', 'cashNegative', 'cashLow', 'covenantBreach', 'loanDue', 'checkOverdue', 'checkClash', 'deliveryWait', 'awayIdle', 'crewSick', 'counterExpiry', 'changeRequest',
  'invoiceOverdue', 'creditHeadroom', 'factorRecourse', 'checkDue', 'checkNoSlot', 'offerFit', 'noFerry', 'leaseReturn', 'leaseDue', 'refit', 'crewResigned', 'crewTight', 'lossMonth', 'penalty', 'contractCancelled', 'crewReach', 'crewRest', 'crewFdp',
  // v0.7.2
  'restSeats', 'captainAsFo', 'sale',
  // v0.7.3
  'restTooShort', 'restFacility', 'cabinRest',
  // v0.8
  'airspaceClosed', 'uninsurable', 'leaseLate', 'clientUnhappy', 'leaseDamage', 'lostToRival', 'dryLeaseInfo',
  // v0.11
  'disruption', 'auditFinding', 'rampFinding',
  // v0.12.1
  'approvalLate',
  // v0.14
  'clientCrisis',
  // v0.16 sales
  'leadCold',
  // v0.17 the aircraft market
  'leaseConditions', 'leaseSign', 'variationNeeded', 'inductionDelay', 'spotReturn',
];
const rankOf = (c: ProblemCard) => SEV[c.severity] * 100 + KIND_RANK.indexOf(c.subject.kind);

const cache = new WeakMap<GameState, { key: string; list: ProblemCard[] }>();
const keyOf = (g: GameState) => {
  let fh = 0;
  for (const ac of Object.values(g.fleet)) fh += ac.maint.fhSinceA + ac.maint.fhSinceC + (ac.status === 'aog' ? 1 : 0);
  return `${g.opsx?.audit.findings.length ?? 0}:${g.opsx?.audit.findings.filter((f) => f.closed || f.started || f.overdue).length ?? 0}:${crewRev(g)}:${flightsRev(g)}:${Math.floor(g.now / 60)}:${g.messages.length}:${g.decisions.length}:${Math.round(g.company.cash)}:${Object.keys(g.maintenance).length}:${Object.keys(g.offers).length}:${g.finance.receivables.length}:${g.finance.history.length}:${Math.round(fh)}:${g.world?.events.length ?? 0}:${g.leasing?.rev ?? 0}`;
};

/** Every current problem, worst first (Inbox filter, dots, hints, bot). Cached per crew/flight revision and hour. Pure. */
export function problems(g: GameState): ProblemCard[] {
  const key = keyOf(g);
  const hit = cache.get(g);
  if (hit && hit.key === key) return hit.list;
  const list = [...crewProblems(g), ...techProblems(g), ...commercialProblems(g), ...moneyProblems(g), ...fleetProblems(g), ...worldProblems(g), ...opsProblems(g), ...approvalProblems(g), ...crisisProblems(g), ...leadProblems(g), ...leasingProblems(g)];
  list.sort((a, b) => rankOf(a) - rankOf(b) || (a.by ?? Infinity) - (b.by ?? Infinity) || (a.subject.ref.id < b.subject.ref.id ? -1 : 1));
  cache.set(g, { key, list });
  return list;
}

/** The problem behind a red/amber dot: the worst current problem on this entity, else a direct look-up by kind. Pure. */
export function problemAt(g: GameState, ref: Ref): ProblemCard | null {
  return lookup(g, `at:${ref.kind}:${ref.id}`, () => withChecked(g, problemAtRaw(g, ref)));
}

function problemAtRaw(g: GameState, ref: Ref): ProblemCard | null {
  const hit = problems(g).find((c) => c.subject.ref.kind === ref.kind && c.subject.ref.id === ref.id);
  if (hit) return hit;
  switch (ref.kind) {
    case 'flight': {
      const f = g.flights[ref.id];
      // v0.12.1 a leg that needs an approval we won't hold by then (any leg of the job).
      return crewFlightCard(g, ref.id, f?.purpose ? 'ferryUncrewed' : 'crewShort') ?? approvalLateCard(g, ref.id) ?? crewFlightCard(g, ref.id, 'crewTight');
    }
    case 'aircraft': return aogCard(g, ref.id) ?? checkCard(g, ref.id) ?? noSlotCard(g, ref.id) ?? deliveryWaitCard(g, ref.id) ?? awayIdleCard(g, ref.id) ?? leaseReturnCard(g, ref.id);
    case 'crew': return ref.id.startsWith('peak:') ? crewPeakCard(g, ref.id) : ref.id.startsWith('hold:') ? crewHoldCard(g, ref.id) : crewSickCard(g, ref.id) ?? crewResignedCard(g, ref.id);
    case 'maint': return checkClashCard(g, ref.id) ?? refitMissedCard(g, ref.id);
    case 'offer': return counterExpiryCard(g, ref.id) ?? offerFitCard(g, ref.id) ?? lostToRivalCard(g, ref.id);
    case 'client': return clientUnhappyCard(g, ref.id);
    case 'event': return airspaceClosedCard(g, ref.id) ?? clientCrisisCard(g, ref.id);
    case 'contract': return contractCancelledCard(g, ref.id) ?? leaseLateCard(g, ref.id) ?? leaseDamageCard(g, ref.id) ?? g.finance.receivables.filter((r) => r.contractId === ref.id).map((r) => invoiceOverdueCard(g, r.id)).find((c) => !!c) ?? null;
    case 'decision': {
      const d = g.decisions.find((x) => x.id === ref.id);
      return d && isDisruption(d) ? disruptionCard(g, d) : changeRequestCard(g, ref.id);
    }
    case 'ramp': return rampFindingCard(g, ref.id);
    case 'audit': return auditFindingCard(g, ref.id);
    case 'cash': return cashNegativeCard(g) ?? cashLowCard(g);
    case 'statement': return lossMonthCard(g);
    default: return null;
  }
}

/** Posts the Inbox message for a card: title = WHAT, body = WHY + HURT (as prose, §V), with the problem ref and a hurt snapshot. */
export function postProblem(g: GameState, card: ProblemCard, opts: { cat: MessageCat; tone?: 'warn' | 'bad'; topic?: Message['topic']; tail?: string; cue?: Cue | null }): Message {
  return pushMessage(g, {
    tone: opts.tone ?? (card.severity === 'red' ? 'bad' : 'warn'), cat: opts.cat, topic: opts.topic, ...(opts.cue !== undefined ? { cue: opts.cue } : {}),
    title: card.what, body: `${card.why} ${hurtProse(card)}.${opts.tail ? ` ${opts.tail}` : ''}`, ref: card.subject.ref,
    problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level },
  });
}

/** `problem` and `hurt` for an existing pushMessage call (the message keeps its own words). */
export function cardMeta(card: ProblemCard | null | undefined): { problem?: ProblemRef; hurt?: Message['hurt'] } {
  if (!card) return {};
  return { problem: card.subject, hurt: { money: card.hurt.money, pax: card.hurt.pax, delayMin: card.hurt.delayMin, level: card.hurt.level } };
}

/** The badge strings for a message's hurt snapshot (UI). */
export const messageBadges = (m: Message): string[] => (m.hurt ? hurtBadges(m.hurt) : []);

/** v0.16.4 daily: an aircraft stuck away from base with nothing planned is told in the Inbox once a stay (a chime). */
export function postAwayIdle(g: GameState): void {
  for (const ac of Object.values(g.fleet)) {
    const card = awayIdleCard(g, ac.id);
    if (!card) continue;
    const since = awayIdleSince(g, ac.id);
    if (g.stats.awayTold?.[ac.id] === since) continue;
    (g.stats.awayTold ??= {})[ac.id] = since;
    postProblem(g, card, { cat: 'ops' });
  }
}

/**
 * v0.7.3 the in-flight rest cards as Inbox messages (daily): once per contract and kind (a flight without a contract:
 * once per duty); restTooShort once per duty. Counts Stats.restTooShort.
 */
export function postRestProblems(g: GameState): void {
  for (const card of restCards(g)) {
    const f = g.flights[card.subject.ref.id];
    if (!f) continue;
    const kind = card.subject.kind;
    const key = kind !== 'restTooShort' && f.contractId ? `c:${f.contractId}` : `d:${f.dutyId ?? f.id}`;
    const seen = g.messages.some((m) => {
      if (m.problem?.kind !== kind || m.ref?.kind !== 'flight') return false;
      const mf = g.flights[m.ref.id];
      if (!mf) return false;
      return (kind !== 'restTooShort' && mf.contractId ? `c:${mf.contractId}` : `d:${mf.dutyId ?? mf.id}`) === key;
    });
    if (seen) continue;
    postProblem(g, card, { cat: 'crew' });
    if (kind === 'restTooShort') g.stats.restTooShort = (g.stats.restTooShort ?? 0) + 1;
  }
}
