// v0.7.1 one read API for every problem (UPDATE-0.7.1.md §1, §8, §9): problemFor dispatches by kind, problems lists
// every current card worst first (cached per state revision and hour), problemAt finds the card behind a red or
// amber dot, postProblem posts the Inbox message every lane posts the same way.

import { flightsRev } from '../core/entities';
import { pushMessage } from '../core/messages';
import type { GameState, Message, MessageCat, ProblemKind, ProblemRef, Ref } from '../core/types';
import { crewRev } from '../crew/timeline';
import { captainAsFoCard, crewFlightCard, crewProblems, crewResignedCard, crewSickCard, restSeatsCard } from './crew';
import { changeRequestCard, commercialProblems, contractCancelledCard, counterExpiryCard, offerFitCard, penaltyCard } from './commercial';
import { deliveryWaitCard, ferryUncrewedCard, fleetProblems, leaseReturnCard, refitMissedCard, saleCard } from './fleet';
import { cashLowCard, invoiceOverdueCard, leaseDueCard, lossMonthCard, moneyProblems } from './money';
import { aogCard, checkCard, checkClashCard, noSlotCard, techProblems } from './tech';
import { hurtBadges, type ProblemCard } from './types';

export { hurtBadges, lateText, limitTone, mkHurt, usdShort } from './types';
export type { GaugeSpec, Hurt, MiniMapSpec, ProblemAction, ProblemCard, ReachSpec, TimelineSpec } from './types';
export type { ProblemKind, ProblemRef };
export { crewFlightCard, crewSickCard, crewResignedCard, aogCard, checkCard, checkClashCard, noSlotCard, offerFitCard, counterExpiryCard, changeRequestCard, contractCancelledCard, cashLowCard, invoiceOverdueCard, lossMonthCard, leaseDueCard, deliveryWaitCard, ferryUncrewedCard, refitMissedCard, leaseReturnCard, captainAsFoCard, restSeatsCard, saleCard };

/** The card for one problem (null = no problem, or not any more). Pure. */
export function problemFor(g: GameState, subject: ProblemRef): ProblemCard | null {
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
      const m = g.messages.find((x) => x.problem?.kind === 'penalty' && x.ref?.id === id);
      return m ? penaltyCard(g, m) : null;
    }
    case 'contractCancelled': return contractCancelledCard(g, id);
    case 'cashLow': return cashLowCard(g);
    case 'invoiceOverdue': return invoiceOverdueCard(g, id);
    case 'lossMonth': return lossMonthCard(g);
    case 'leaseDue': return leaseDueCard(g, id);
    case 'goalMiss': return null;
    case 'deliveryWait': return deliveryWaitCard(g, id);
    case 'ferryUncrewed': return ferryUncrewedCard(g, id);
    case 'refit': return refitMissedCard(g, id);
    case 'leaseReturn': return leaseReturnCard(g, id);
    // v0.7.2
    case 'restSeats': return restSeatsCard(g, id);
    case 'captainAsFo': return captainAsFoCard(g, id);
    case 'sale': return saleCard(g, id);
  }
}

const SEV = { red: 0, amber: 1 } as const;
const KIND_RANK: ProblemKind[] = [
  'aog', 'grounded', 'crewShort', 'crewIllegal', 'ferryUncrewed', 'cashLow', 'checkOverdue', 'checkClash', 'deliveryWait', 'crewSick', 'counterExpiry', 'changeRequest',
  'invoiceOverdue', 'checkDue', 'checkNoSlot', 'offerFit', 'leaseReturn', 'leaseDue', 'refit', 'crewResigned', 'crewTight', 'lossMonth', 'penalty', 'contractCancelled', 'crewReach', 'crewRest', 'crewFdp', 'goalMiss',
  // v0.7.2
  'restSeats', 'captainAsFo', 'sale',
];
const rankOf = (c: ProblemCard) => SEV[c.severity] * 100 + KIND_RANK.indexOf(c.subject.kind);

const cache = new WeakMap<GameState, { key: string; list: ProblemCard[] }>();
const keyOf = (g: GameState) => {
  let fh = 0;
  for (const ac of Object.values(g.fleet)) fh += ac.maint.fhSinceA + ac.maint.fhSinceC + (ac.status === 'aog' ? 1 : 0);
  return `${crewRev(g)}:${flightsRev(g)}:${Math.floor(g.now / 60)}:${g.messages.length}:${g.decisions.length}:${Math.round(g.company.cash)}:${Object.keys(g.maintenance).length}:${Object.keys(g.offers).length}:${g.finance.receivables.length}:${g.finance.history.length}:${Math.round(fh)}`;
};

/** Every current problem, worst first (Inbox filter, dots, hints, bot). Cached per crew/flight revision and hour. Pure. */
export function problems(g: GameState): ProblemCard[] {
  const key = keyOf(g);
  const hit = cache.get(g);
  if (hit && hit.key === key) return hit.list;
  const list = [...crewProblems(g), ...techProblems(g), ...commercialProblems(g), ...moneyProblems(g), ...fleetProblems(g)];
  list.sort((a, b) => rankOf(a) - rankOf(b) || (a.by ?? Infinity) - (b.by ?? Infinity) || (a.subject.ref.id < b.subject.ref.id ? -1 : 1));
  cache.set(g, { key, list });
  return list;
}

/** The problem behind a red/amber dot: the worst current problem on this entity, else a direct look-up by kind. Pure. */
export function problemAt(g: GameState, ref: Ref): ProblemCard | null {
  const hit = problems(g).find((c) => c.subject.ref.kind === ref.kind && c.subject.ref.id === ref.id);
  if (hit) return hit;
  switch (ref.kind) {
    case 'flight': {
      const f = g.flights[ref.id];
      return crewFlightCard(g, ref.id, f?.purpose ? 'ferryUncrewed' : 'crewShort') ?? crewFlightCard(g, ref.id, 'crewTight');
    }
    case 'aircraft': return aogCard(g, ref.id) ?? checkCard(g, ref.id) ?? noSlotCard(g, ref.id) ?? deliveryWaitCard(g, ref.id) ?? leaseReturnCard(g, ref.id);
    case 'crew': return crewSickCard(g, ref.id) ?? crewResignedCard(g, ref.id);
    case 'maint': return checkClashCard(g, ref.id) ?? refitMissedCard(g, ref.id);
    case 'offer': return counterExpiryCard(g, ref.id) ?? offerFitCard(g, ref.id);
    case 'contract': return contractCancelledCard(g, ref.id) ?? g.finance.receivables.filter((r) => r.contractId === ref.id).map((r) => invoiceOverdueCard(g, r.id)).find((c) => !!c) ?? null;
    case 'decision': return changeRequestCard(g, ref.id);
    case 'cash': return cashLowCard(g);
    case 'statement': return lossMonthCard(g);
    default: return null;
  }
}

/** Posts the Inbox message for a card: title = WHAT, body = WHY + HURT, with the problem ref and a hurt snapshot. */
export function postProblem(g: GameState, card: ProblemCard, opts: { cat: MessageCat; tone?: 'warn' | 'bad'; topic?: Message['topic']; tail?: string }): Message {
  return pushMessage(g, {
    tone: opts.tone ?? (card.severity === 'red' ? 'bad' : 'warn'), cat: opts.cat, topic: opts.topic,
    title: card.what, body: `${card.why} ${card.hurt.text}.${opts.tail ? ` ${opts.tail}` : ''}`, ref: card.subject.ref,
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
