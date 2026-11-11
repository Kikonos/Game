// v0.20.1 where a job came from: a tender we won (a contest: several operators bid, the airline chose) or a lead we
// worked (just us: a proposal to a client found by a broker, a sales manager, a fair, a visit or a pitch). The offer
// and the contract carry a small 'From tender' / 'From lead' tag, with the story on tap. Pure.

import type { Contract, ContractOffer, GameState, Lead } from '../core/types';
import { brokerName, commissionOf, leadSourceName } from './sales';
import type { Tender } from './types';

export type Origin = 'tender' | 'lead';
export const ORIGIN_LABEL: Record<Origin, string> = { tender: 'From tender', lead: 'From lead' };

export interface OriginView {
  origin: Origin;
  /** 'From tender' / 'From lead'. */
  label: string;
  /** The story in a sentence or two (the '?' beside the tag). */
  note: string;
}

const tenderOfOffer = (g: GameState, offerId: string): Tender | undefined => g.com?.tenders?.find((t) => t.result?.offerId === offerId);
const leadOf = (g: GameState, id: string | undefined): Lead | undefined => (id ? g.com?.leads?.find((l) => l.id === id) : undefined);

/** Who found a lead, for a card: 'Air Charter Service · 4 % commission', 'Marta Silva, sales manager', 'Trade fair'. Pure. */
export function leadSourceLine(g: GameState, l: Pick<Lead, 'source' | 'brokerId' | 'repId'>): string {
  const name = leadSourceName(g, l as Lead);
  if (l.brokerId) return `${name} · ${Math.round(commissionOf(l.brokerId) * 1000) / 10} % commission`;
  return l.repId ? `${name}, sales manager` : name;
}

function leadNote(g: GameState, leadId: string, brokerId: Lead['brokerId'], signed: boolean): string {
  const l = leadOf(g, leadId);
  const who = l ? leadSourceName(g, l) : brokerId ? brokerName(brokerId) : 'the sales desk';
  const fee = brokerId ? ` ${brokerName(brokerId)} takes ${Math.round(commissionOf(brokerId) * 1000) / 10} % commission${signed ? '' : ' if we sign'}.` : '';
  return signed
    ? `This job came from a lead (${who}): we sent a proposal and the client said yes. Nobody else was asked.${fee}`
    : `This offer answers our proposal on a lead (${who}). It is ours alone: no other operator is quoting.${fee}`;
}

/** Where an offer came from (null: the open market, a call-out, a repeat). Pure. */
export function offerOrigin(g: GameState, o: Pick<ContractOffer, 'id' | 'leadId' | 'brokerId'>): OriginView | null {
  if (o.leadId) return { origin: 'lead', label: ORIGIN_LABEL.lead, note: leadNote(g, o.leadId, o.brokerId, false) };
  const t = tenderOfOffer(g, o.id);
  if (t) return { origin: 'tender', label: ORIGIN_LABEL.tender, note: `We won this in ${g.clients[t.clientId]?.name ?? 'the airline'}’s tender${t.rivals.length ? ` against ${t.rivals.length} other operator${t.rivals.length === 1 ? '' : 's'}` : ''}. It is signed at our bid, so there is no counter.` };
  return null;
}

/** Where a contract came from (null: the open market, a call-out, a repeat). Pure. */
export function contractOrigin(g: GameState, c: Pick<Contract, 'id' | 'offerId' | 'leadId' | 'brokerId'>): OriginView | null {
  if (c.leadId) return { origin: 'lead', label: ORIGIN_LABEL.lead, note: leadNote(g, c.leadId, c.brokerId, true) };
  const t = g.com?.tenders?.find((x) => x.result?.contractId === c.id) ?? tenderOfOffer(g, c.offerId);
  if (t) return { origin: 'tender', label: ORIGIN_LABEL.tender, note: `Won in ${g.clients[t.clientId]?.name ?? 'the airline'}’s tender${t.rivals.length ? ` against ${t.rivals.length} other operator${t.rivals.length === 1 ? '' : 's'}` : ''}, signed at our bid.` };
  return null;
}

/** The '?' beside a tender's 'Open tender' tag and a lead's 'Exclusive' tag: what each kind of work is. */
export const TENDER_NOTE = 'A contest. Several operators send a bid and the airline picks one: the lowest fair price with the best fit wins (reliability, relationship, aircraft age). You hear on the award date.';
export const LEAD_NOTE = 'Just us. Nobody else is asked. Send a proposal before the lead goes cold; if the client says yes, their offer comes to you alone.';
