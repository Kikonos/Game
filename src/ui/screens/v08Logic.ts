// v0.8 pure UI helpers: offer card chips, the dry-lease panel numbers, our share of a mixed cabin. No React, no writes.

import type { ClientLevel } from '../../engine/contracts';
import type { ContractOffer, Role } from '../../engine/core/types';
import type { Chip } from './screenLogic';

const LEVEL_TONE: Record<ClientLevel, Chip['tone']> = { unhappy: 'bad', new: undefined, known: undefined, trusted: 'good', partner: 'good' };

/**
 * The v0.8 chip row of an offer card (at most 4): the client's level, rivals bidding, then the one or two special
 * terms (first refusal, client crew, dry lease, Newcomer discount, repeat business).
 */
export function v08Chips(
  o: Pick<ContractOffer, 'firstRefusal' | 'standingPct' | 'requirements' | 'product' | 'dry' | 'repeatOf' | 'eventId'>,
  client: { level: ClientLevel; chip: string } | null,
  competition: 'none' | 'some' | 'strong',
): Chip[] {
  const out: Chip[] = [];
  if (client) out.push({ label: client.chip, tone: LEVEL_TONE[client.level], tip: 'The client\'s relationship with us and its rate effect' });
  if (o.firstRefusal) out.push({ label: 'First refusal', tone: 'good', tip: 'They asked us first: no rival takes it before it expires' });
  else if (competition === 'strong') out.push({ label: 'Rivals bidding', tone: 'warn', tip: 'Another operator is quoting and is keen: decide soon' });
  else if (competition === 'some') out.push({ label: 'Some interest', tip: 'Another operator is quoting too' });
  const cc = o.requirements.clientCabin;
  if (cc && cc.n > 0) out.push({ label: `Client crew ${cc.n} of ${cc.of}`, tip: 'The client provides part of the cabin crew; we fly the rest' });
  if (o.product.kind === 'dry' && o.dry) out.push({ label: `Dry lease · ${o.dry.months} month${o.dry.months === 1 ? '' : 's'}`, tip: 'Aircraft only: their crews fly it' });
  if (o.repeatOf && out.length < 4) out.push({ label: 'Repeat business', tone: 'good' });
  if ((o.standingPct ?? 0) < 0 && out.length < 4) out.push({ label: `Newcomer −${Math.round(-(o.standingPct ?? 0) * 100)} %`, tip: 'New operators get the work nobody wants, at lower rates' });
  if (o.eventId && out.length < 4) out.push({ label: 'World event', tone: 'warn' });
  return out.slice(0, 4);
}

export interface DryMoney { rent: number; months: number; reserves: number; fh: number; deposit: number; consent: number; total: number }

/** The dry-lease offer's money lines: rent × months, reserves at the expected hours, deposit (back at return), consent fee. */
export function dryMoney(o: Pick<ContractOffer, 'product' | 'dry'>): DryMoney | null {
  if (o.product.kind !== 'dry' || !o.dry) return null;
  const months = o.dry.months;
  const fh = Math.round(o.dry.fhPerMonth * months);
  const rent = o.product.rentPerMonth * months;
  const reserves = o.product.reservesPerFH * fh;
  return { rent, months, reserves, fh, deposit: o.dry.deposit, consent: o.dry.consent, total: rent + reserves - o.dry.consent };
}

/** Our cabin seats on a mixed-crew job (as crew/clientCrew dropClientSeats): M seats (one PUR, the rest CC) less the
 *  client's n; their SCCM leading takes the purser seat first, else CC seats go and our purser stays. */
export function ourCabin(cc: { n: number; of: number; leads: boolean }): Role[] {
  const cc0 = Math.max(0, cc.of - 1);
  let n = Math.min(cc.n, cc.of);
  const pur = cc.leads && n > 0 ? (n--, 0) : 1;
  return [...(pur ? (['PUR'] as Role[]) : []), ...Array.from({ length: Math.max(0, cc0 - n) }, () => 'CC' as Role)];
}
