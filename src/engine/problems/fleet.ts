// v0.7.1 aircraft and delivery problems as ProblemCards (UPDATE-0.7.1.md §9.4): a delivery stuck at the seller for
// want of pilots, an uncrewed ferry, a missed refit slot, a lease return coming up. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fmtDay } from '../core/time';
import type { GameState } from '../core/types';
import { flightsOf } from '../core/entities';
import { deliveryStatus } from '../ops/delivery';
import { saleQuote } from '../ops/sale';
import { leaseView, returnQuote } from '../ops/leaseReturn';
import { usd } from '../ops/util';
import { crewFlightCard } from './crew';
import { mkHurt, type ProblemCard } from './types';
import type { TermId } from '../../data/glossary';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

export function deliveryWaitCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  const st = ac ? deliveryStatus(g, ac.id) : null;
  if (!ac || !st || st.phase !== 'waiting' || st.waitingSince === null) return null;
  const t = typeOf(ac.typeId);
  const days = Math.max(1, Math.ceil((g.now - st.waitingSince) / DAY));
  const park = BAL.delivery.parkPerDay[t.body === 'wide' ? 1 : 0];
  const rent = ac.ownership.kind === 'dryLeaseIn' ? ac.ownership.rentPerMonth : 0;
  return {
    subject: { kind: 'deliveryWait', ref: { kind: 'aircraft', id: ac.id } }, severity: days >= 7 ? 'red' : 'amber',
    title: `${ac.reg} is stuck at ${city(st.site)}`, what: `${ac.reg} is stuck at ${city(st.site)}`,
    why: `No ${t.short}-rated captain and first officer are free to ferry it home; parking costs ${usd(park)} a day${rent ? ` and the rent of ${usd(rent)} a month runs` : ''}.`,
    hurt: mkHurt({ money: park * days + Math.round((rent / 30) * days), what: 'so far', extra: `${days} day${days > 1 ? 's' : ''} waiting` }),
    actions: [{ id: 'hire', label: 'Hire', open: { modal: 'hire', id: t.family }, primary: true }, { id: 'convert', label: 'Convert', open: { tab: 'crew', view: 'conversions' } }, { id: 'fleet', label: 'Fleet', open: { tab: 'fleet', sel: { kind: 'aircraft', id: ac.id } } }],
    details: [st.text], visuals: {}, terms: ['ferry', 'deadhead'], by: st.homeBy ?? undefined,
  };
}

export function ferryUncrewedCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  if (!f || !f.purpose || f.status !== 'scheduled' || f.std - g.now > 2 * DAY) return null;
  const card = crewFlightCard(g, flightId, 'ferryUncrewed');
  if (!card) return null;
  const what = `The ${f.purpose === 'delivery' ? 'delivery' : f.purpose === 'return' ? 'lease-return' : 'refit'} ferry ${f.no} has no ${card.what.includes('pilots') ? 'pilots' : 'crew'}`;
  return { ...card, title: what, what, terms: [...new Set<TermId>(['ferry', ...card.terms])] };
}

export function refitMissedCard(g: GameState, maintId: string): ProblemCard | null {
  const m = g.maintenance[maintId];
  const ac = m ? g.fleet[m.aircraftId] : undefined;
  if (!m || !ac || m.kind !== 'refit' || m.status !== 'cancelled' || !m.booked || m.booked < g.now - 14 * DAY) return null;
  const job = Object.values(g.contracts).find((c) => (c.status === 'signed' || c.status === 'active') && c.aircraftIds.includes(ac.id) && c.requirements.layouts?.length && !c.requirements.layouts.includes(ac.cabin.layout));
  return {
    subject: { kind: 'refit', ref: { kind: 'maint', id: m.id } }, severity: job ? 'red' : 'amber',
    title: `${ac.reg}'s refit slot at ${city(m.at)} was missed`, what: `${ac.reg}'s refit slot at ${city(m.at)} was missed`,
    why: `The aircraft couldn't reach ${city(m.at)} in time for the ${fmtDay(m.start)} slot${m.cause ? ` (${m.cause.toLowerCase()})` : ''}.`,
    hurt: mkHurt({ money: job?.product.kind === 'charter' ? job.product.price : 0, what: 'of work needs the cabin', extra: job ? `${job.title} needs it` : undefined }),
    actions: [{ id: 'refit', label: 'Refit', open: { modal: 'refit', id: ac.id }, primary: true }], details: [], visuals: {}, terms: ['ferry'], by: job?.start,
  };
}

export function leaseReturnCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac || ac.ownership.kind !== 'dryLeaseIn') return null;
  const v = leaseView(g, ac.id);
  if (!v || v.daysLeft > 30 || ac.returning) return null;
  const q = returnQuote(g, ac.id);
  const lines = q ? q.lines.map((l) => `${l.label} ${usd(l.amount)}`).join(', ') : '';
  return {
    subject: { kind: 'leaseReturn', ref: { kind: 'aircraft', id: ac.id } }, severity: v.daysLeft <= 7 ? 'red' : 'amber',
    title: `${ac.reg} goes back to ${v.lessor} in ${v.daysLeft} days`, what: `${ac.reg} goes back to ${v.lessor} in ${v.daysLeft} days`,
    why: q ? `Return check at ${city(q.site)} (${q.checkDays} days): ${lines} (${usd(q.total)} in all); or extend the lease.` : `The lease ends ${fmtDay(v.ends)}.`,
    hurt: mkHurt({ money: q?.total ?? 0, what: 'return costs' }),
    actions: [{ id: 'lease', label: 'Lease…', open: { modal: 'lease', id: ac.id }, primary: true }],
    details: v.options.map((o) => `${o.label}: ${o.chips.join(', ')}`), visuals: {}, terms: ['ferry'], by: v.ends,
  };
}

export function fleetProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const ac of Object.values(g.fleet)) {
    const d = deliveryWaitCard(g, ac.id);
    if (d) out.push(d);
    const l = leaseReturnCard(g, ac.id);
    if (l) out.push(l);
    // v0.7.2 an agreed sale stays on the list until the handover.
    if (ac.sale) {
      const s = saleCard(g, ac.id);
      if (s) out.push(s);
    }
  }
  for (const f of Object.values(g.flights)) {
    if (!f.purpose || f.status !== 'scheduled') continue;
    const c = ferryUncrewedCard(g, f.id);
    if (c) out.push(c);
  }
  for (const m of Object.values(g.maintenance)) {
    if (m.kind !== 'refit' || m.status !== 'cancelled') continue;
    const c = refitMissedCard(g, m.id);
    if (c) out.push(c);
  }
  return out;
}

/** v0.7.2 a sale agreed (amber info until the handover), or one the player wants that signed work still blocks. Pure. */
export function saleCard(g: GameState, aircraftId: string): ProblemCard | null {
  const ac = g.fleet[aircraftId];
  if (!ac) return null;
  if (ac.sale) {
    const s = ac.sale;
    return {
      subject: { kind: 'sale', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber',
      title: `${ac.reg} goes to ${s.buyer} on ${fmtDay(s.closes)}`, what: `${ac.reg} goes to ${s.buyer} on ${fmtDay(s.closes)}`,
      why: `We agreed to sell it for ${usd(s.price)}; it takes no new work and is handed over at ${city(g.company.homeBase)}.`,
      hurt: { ...mkHurt({}), text: 'Not much: the buyer pays on handover' },
      actions: [{ id: 'sell', label: 'Sale…', open: { modal: 'sell', id: ac.id }, primary: true }, { id: 'fleet', label: 'Fleet', open: { tab: 'fleet', sel: { kind: 'aircraft', id: ac.id } } }],
      details: [`Agreed ${fmtDay(s.agreed)}`, ...(s.ferryIds?.length ? ['A ferry brings it home first'] : [])], visuals: {}, terms: ['marketValue'], by: s.closes,
    };
  }
  if (ac.ownership.kind !== 'owned') return null;
  const q = saleQuote(g, ac.id);
  if (q.ok || !q.blockers.length) return null;
  const first = flightsOf(g, ac.id).find((f) => f.status === 'scheduled' && f.contractId && !f.purpose);
  // v0.7.2 only a booking in the way (a check or refit): its ferries can't be sub-chartered.
  const onlyBooking = !!q.booking && q.blockers.length === 1;
  const actions: ProblemCard['actions'] = onlyBooking
    ? [
        { id: 'cancelCheck', label: q.booking!.kind === 'A' || q.booking!.kind === 'C' ? 'Cancel the check' : 'Cancel the booking', open: { modal: 'check', id: ac.id }, primary: true },
        { id: 'schedule', label: `Sell after ${fmtDay(q.booking!.until)}`, open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } } },
      ]
    : [
        ...(first ? [{ id: 'subcharter', label: 'Sub-charter those legs', open: { modal: 'subcharter' as const, id: first.id }, primary: true }] : []),
        { id: 'schedule', label: 'Open Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac.id } } },
      ];
  return {
    subject: { kind: 'sale', ref: { kind: 'aircraft', id: ac.id } }, severity: 'amber',
    title: `${ac.reg} can't be sold yet`, what: `${ac.reg} can't be sold yet`,
    why: `${q.blockers[0]}${q.blockers.length > 1 ? ` (and ${q.blockers.length - 1} more)` : ''}.`,
    hurt: { ...mkHurt({}), text: 'Not yet: nothing lost' },
    actions,
    details: q.blockers, visuals: {}, terms: ['marketValue'],
  };
}
