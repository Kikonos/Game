// v0.8 problems as ProblemCards (UPDATE-0.8.md §9): an unhappy client, a job a rival took, closed airspace, no
// war-risk cover, a late or damaged dry-lease return, and what a dry lease is. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { ZONE_BY_ID } from '../../data/worldZones';
import { BAL } from '../core/balance';
import { DAY, fmtDay } from '../core/time';
import type { GameState } from '../core/types';
import { levelOf, unhappyReasons } from '../contracts/relations';
import { mkHurt, usdShort, type ProblemCard } from './types';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

export function clientUnhappyCard(g: GameState, clientId: string): ProblemCard | null {
  const c = g.clients[clientId];
  if (!c || levelOf(g, c) !== 'unhappy') return null;
  const why = unhappyReasons(c);
  const what = `${c.name} is unhappy with us`;
  return {
    subject: { kind: 'clientUnhappy', ref: { kind: 'client', id: c.id } }, severity: 'amber', title: what, what,
    why: why.length ? `${why.slice(0, 2).join('; ')}.` : 'Cancellations, hand-overs to rivals and late recoveries add up.',
    hurt: { ...mkHurt({}), level: 'low', text: 'Yes: −5 % on their offers, they call a third as often, no forgiven delays' },
    actions: [{ id: 'client', label: 'Client', open: { modal: 'client', id: c.id }, primary: true }],
    details: [`Relation ${Math.round(c.relation)} (back to normal at ${BAL.v08.levels.unhappyBack})`, 'Fly their next job on time and say yes to their next request; it recovers about 4 a month of good flying.'],
    visuals: {}, terms: ['relationLevel'],
  };
}

export function lostToRivalCard(g: GameState, offerId: string): ProblemCard | null {
  const o = g.offers[offerId];
  if (!o || o.status !== 'lost' || !o.lostWhy || !o.lostTo) return null;
  const cl = g.clients[o.clientId]?.name ?? 'The client';
  const what = `${o.lostTo} took the ${cl} ${o.title}`.replace(`the ${cl} ${cl}`, `the ${cl}`);
  const rival = g.rivals.find((r) => r.name === o.lostTo);
  return {
    subject: { kind: 'lostToRival', ref: { kind: 'offer', id: o.id } }, severity: 'amber', title: what, what,
    why: `They ${o.lostWhy}.`,
    hurt: { ...mkHurt({}), text: 'Not now: we lose the work, nothing else' },
    actions: rival ? [{ id: 'rival', label: 'Rival', open: { modal: 'rival', id: rival.id }, primary: true }] : [],
    details: ["Decide sooner on 'Rivals bidding' offers", 'Keep an aircraft near the work', 'Trusted clients ask us first (first refusal)'],
    visuals: {}, terms: ['firstRefusal'],
  };
}

export function airspaceClosedCard(g: GameState, eventId: string): ProblemCard | null {
  const e = (g.world?.events ?? []).find((x) => x.id === eventId);
  if (!e || e.done || (!e.closed && !(e.airportClosedUntil && e.airportClosedUntil > g.now))) return null;
  const z = e.zoneId ? ZONE_BY_ID[e.zoneId] : undefined;
  let held = 0;
  let rerouted = 0;
  let pax = 0;
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled') continue;
    if (f.closedBy === e.id) {
      held++;
      pax += f.pax ?? 0;
    } else if (f.detour && f.std < e.end + DAY && f.std >= e.start) rerouted++;
  }
  const what = z && e.closed ? `${z.adj} airspace is closed` : `${city(e.at)} airport is closed`;
  return {
    subject: { kind: 'airspaceClosed', ref: { kind: 'event', id: e.id } }, severity: held ? 'red' : 'amber', title: what, what,
    why: `${e.title}.`,
    hurt: { ...mkHurt({ pax, legs: held }), text: `${held} leg${held === 1 ? '' : 's'} held, ${rerouted} rerouted${z ? ` (+${z.detourMin} min each)` : ''}; force majeure: no penalties` },
    actions: [{ id: 'event', label: 'Event', open: { modal: 'worldEvent', id: e.id }, primary: true }],
    details: [`Expected to reopen ${fmtDay(e.end)}`, 'Wait for the reopening (default) or cancel the legs without penalty'],
    visuals: {}, terms: ['forceMajeure'], by: e.end,
  };
}

export function uninsurableCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  const d = g.decisions.find((x) => x.kind === 'uninsurable' && x.ref?.id === flightId);
  if (!f || f.status !== 'scheduled' || !d) return null;
  const what = `No war-risk cover for ${f.to} on ${fmtDay(f.std)}`;
  return {
    subject: { kind: 'uninsurable', ref: { kind: 'flight', id: f.id } }, severity: 'red', title: what, what,
    why: `Insurers withdrew cover 48 h before (${city(f.to)}, level 3).`,
    hurt: { ...mkHurt({ pax: f.pax ?? 0 }), level: 'high', text: 'Yes: the flight cannot legally operate' },
    actions: [{ id: 'decision', label: 'Decide', open: { modal: 'decision', id: d.id }, primary: true }],
    details: ['Wait a day (half the time the insurer comes back)', 'Cancel (force majeure: no penalty)', 'Hand it to a rival who has cover'],
    visuals: {}, terms: ['warRisk', 'forceMajeure'], by: f.std,
  };
}

export function leaseLateCard(g: GameState, contractId: string): ProblemCard | null {
  const c = g.contracts[contractId];
  if (!c?.dry || !c.dry.late || c.status === 'completed' || c.status === 'cancelled') return null;
  const ac = g.fleet[c.aircraftIds[0]];
  const lessee = g.clients[c.clientId]?.name ?? 'The lessee';
  const back = (c.dry.leaseEnd ?? c.end) + c.dry.late * DAY;
  const clash = Object.values(g.flights).filter((f) => f.aircraftId === ac?.id && f.contractId !== c.id && f.status === 'scheduled' && f.std < back + 2 * DAY);
  const what = `${lessee} returns ${ac?.reg ?? 'our aircraft'} ${c.dry.late} days late`;
  return {
    subject: { kind: 'leaseLate', ref: { kind: 'contract', id: c.id } }, severity: clash.length ? 'red' : 'amber', title: what, what,
    why: 'Their replacement aircraft is late.',
    hurt: { ...mkHurt({ legs: clash.length }), level: clash.length ? 'high' : 'none', text: `Holdover rent pays 150 %${clash.length ? `; our flights from ${fmtDay(clash[0].std)} need her` : ''}` },
    actions: clash.length ? [{ id: 'subcharter', label: 'Hand to a rival', open: { modal: 'subcharter', id: clash[0].id }, primary: true }, { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'aircraft', id: ac!.id } } }] : [],
    details: [`New return ${fmtDay(back)}`, 'Hand those legs to a rival, or move the trip to another aircraft'],
    visuals: {}, terms: ['dryLease'], by: back,
  };
}

export function leaseDamageCard(g: GameState, contractId: string): ProblemCard | null {
  const c = g.contracts[contractId];
  const dmg = c?.dry?.damage;
  if (!c || !dmg) return null;
  const ac = g.fleet[c.aircraftIds[0]];
  const ours = Math.round(dmg.cost * (1 - BAL.v08.dry.lesseeShare));
  const lessee = g.clients[c.clientId]?.name ?? 'the lessee';
  const what = `${ac?.reg ?? 'Our aircraft'}: ${(dmg.what ?? 'damage').toLowerCase()} finding`;
  return {
    subject: { kind: 'leaseDamage', ref: { kind: 'contract', id: c.id } }, severity: 'amber', title: what, what,
    why: 'Found at the return inspection.',
    hurt: { ...mkHurt({ money: ours, what: 'ours' }), text: `${dmg.days} days out, ${usdShort(ours)} is ours (${lessee} pays ${Math.round(BAL.v08.dry.lesseeShare * 100)} %)` },
    actions: [], details: ['Nothing to decide; plan around the days in the hangar'], visuals: {}, terms: ['dryLease'],
  };
}

export function dryLeaseInfoCard(g: GameState, id: string): ProblemCard | null {
  const k = g.contracts[id];
  const o = g.offers[id];
  const x = o ?? k;
  if (!x || x.product.kind !== 'dry') return null;
  const ac = k ? g.fleet[k.aircraftIds[0]] : o?.dryFor ? g.fleet[o.dryFor] : undefined;
  const months = Math.round((x.end - x.start) / (30.44 * DAY));
  const fam = ac ? ac.typeId.toUpperCase().replace(/CEO|NEO/, '') : 'our';
  return {
    subject: { kind: 'dryLeaseInfo', ref: { kind: o ? 'offer' : 'contract', id: x.id } }, severity: 'amber',
    title: 'What a dry lease is', what: 'What a dry lease is',
    why: 'They fly it with their crews; we earn rent and reserves.',
    hurt: { ...mkHurt({}), text: `Our ${fam} crews have less work for ${months} months; C-check after return` },
    actions: [{ id: 'review', label: 'Review offer', open: { modal: 'offer', id: x.id }, primary: true }],
    details: ['Book the C-check before if it falls inside', 'Accept or let it go'], visuals: {}, terms: ['dryLease', 'reserves'],
  };
}

/** Current v0.8 problems (the Inbox and dots): unhappy clients, closures, late/damaged leases. Pure. */
export function worldProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const c of Object.values(g.clients)) if (c.level === 'unhappy') { const k = clientUnhappyCard(g, c.id); if (k) out.push(k); }
  for (const e of g.world?.events ?? []) if (!e.done && e.start <= g.now) { const k = airspaceClosedCard(g, e.id); if (k) out.push(k); }
  for (const d of g.decisions) if (d.kind === 'uninsurable' && d.ref) { const k = uninsurableCard(g, d.ref.id); if (k) out.push(k); }
  for (const c of Object.values(g.contracts)) if (c.dry && (c.status === 'active' || c.status === 'signed')) { const k = leaseLateCard(g, c.id); if (k) out.push(k); }
  return out;
}
