// v0.7.1 crew problems as ProblemCards (UPDATE-0.7.1.md §3.6–§3.8, §9): crew-short / illegal / tight flights (the
// Crew Control card), a sick crew member with work ahead, a resignation with trips still to cover. Pure.

import { BAL } from '../core/balance';
import { seatLabel, typeOf } from '../core/perf';
import { DAY, fmtDay, fmtDateTime, fmtDuration } from '../core/time';
import type { GameState, ProblemRef } from '../core/types';
import { crewGauges, crewShortCard, shortFlights } from '../crew/control';
import { crewName } from '../crew/generate';
import { dutyLegality } from '../crew/rosterActions';
import { flightCrewStatus, rosterOf } from '../crew/roster';
import { restSeatsBlocked } from '../crew/crewRest';
import { mkHurt, usdShort, type ProblemCard } from './types';

/** The crew card for a flight: shortage / illegal (Crew Control's), or a tight crew (amber, no fix needed yet). */
export function crewFlightCard(g: GameState, flightId: string, kind: ProblemRef['kind'] = 'crewShort'): ProblemCard | null {
  const f = g.flights[flightId];
  if (!f || f.status !== 'scheduled' || !f.aircraftId || f.kind === 'deadhead') return null;
  const cs = flightCrewStatus(g, flightId);
  if (cs.level === 'missing' || cs.level === 'illegal') {
    const card = crewShortCard(g, flightId);
    if (card && kind !== 'crewShort' && kind !== 'crewIllegal') card.subject = { kind, ref: card.subject.ref };
    return card;
  }
  if (cs.level !== 'tight' || kind === 'crewShort' || kind === 'crewIllegal') return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const lv = d ? dutyLegality(g, d.id) : null;
  const w = lv?.warnings.find((x) => x.level === 'tight') ?? lv?.warnings[0];
  const who = w?.crewId ? g.crew[w.crewId] : undefined;
  const why = w ? (who && w.reason ? `${crewName(who)} is ${w.reason.text}; one delay breaks it.` : `${w.text}; one delay breaks it.`) : 'The crew is within half an hour of a limit; one delay breaks it.';
  return {
    subject: { kind: 'crewTight', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: `${f.no}'s crew is close to a limit`, what: `${f.no}'s crew is close to a limit`, why,
    hurt: mkHurt({ pax: 0, what: 'penalty', extra: 'nothing yet' }),
    actions: [...(d ? [{ id: 'adjustCrew', label: 'Adjust crew', open: { modal: 'duty' as const, id: d.id }, primary: true }] : []), { id: 'schedule', label: 'Schedule', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } } }],
    details: lv ? lv.warnings.map((x) => x.text) : [], visuals: { gauges: who ? crewGauges(g, who.id, d?.id) : undefined }, terms: ['tight', 'fdp'], by: f.std,
  };
}

/** A sick crew member whose next duty inside a week has nobody else yet (their trips are re-crewed by the roster). */
export function crewSickCard(g: GameState, crewId: string): ProblemCard | null {
  const c = g.crew[crewId];
  if (!c) return null;
  const block = c.blocks?.find((b) => b.from <= g.now + 7 * DAY && b.to > g.now && b.why === 'sick');
  if (!block && c.status !== 'sick') return null;
  const until = block?.to;
  const next = rosterOf(g, c.id, g.now, g.now + 7 * DAY).find((d) => !d.done && d.report > g.now);
  const f = next ? g.flights[next.flightIds[0]] : undefined;
  const cs = f ? flightCrewStatus(g, f.id) : null;
  const short = !!cs && (cs.level === 'missing' || cs.level === 'illegal');
  return {
    subject: { kind: 'crewSick', ref: { kind: 'crew', id: c.id } }, severity: short ? 'red' : 'amber',
    title: `${crewName(c)} is sick${until ? ` until ${fmtDay(until)}` : ''}`, what: `${crewName(c)} is sick${until ? ` until ${fmtDay(until)}` : ''}`,
    why: f ? `${f.no} on ${fmtDay(f.std)} ${short ? 'still needs a replacement' : 'has a replacement from the roster'}.` : 'Nothing of theirs is rostered this week.',
    hurt: mkHurt({ pax: short ? f?.pax ?? 0 : 0, legs: short ? 1 : 0, what: 'penalty', extra: short ? undefined : 'nothing' }),
    actions: f && short ? [{ id: 'crewControl', label: 'Crew Control', open: { modal: 'crewControl', id: f.id }, primary: true }] : [{ id: 'crew', label: 'Crew', open: { tab: 'crew', sel: { kind: 'crew', id: c.id } } }],
    details: [`Status ${c.status}${until ? `, back ${fmtDateTime(until)}` : ''}`], visuals: {}, terms: ['standby'], by: until,
  };
}

/** A crew member on notice with trips rostered past their leaving date (the roster re-crews them). */
export function crewResignedCard(g: GameState, crewId: string): ProblemCard | null {
  const c = g.crew[crewId];
  if (!c?.notice) return null;
  const leaves = c.notice.leaves;
  const days = Math.max(0, Math.ceil((leaves - g.now) / DAY));
  return {
    subject: { kind: 'crewResigned', ref: { kind: 'crew', id: c.id } }, severity: 'amber',
    title: `${crewName(c)} leaves in ${days} days`, what: `${crewName(c)} leaves in ${days} days`,
    why: `They resigned on ${fmtDay(c.notice.given)}; from ${fmtDay(leaves)} their trips need someone else.`,
    hurt: mkHurt({ extra: 'one fewer crew member' }),
    actions: [{ id: 'hire', label: 'Hire', open: { modal: 'hire', id: c.role }, primary: true }, { id: 'crew', label: 'Crew', open: { tab: 'crew', sel: { kind: 'crew', id: c.id } } }],
    details: [`Morale ${Math.round(c.morale)}`], visuals: {}, terms: [], by: leaves,
  };
}

/** Every current crew problem, worst first: short/illegal flights (the ladder's list), sick crew with work ahead, resignations. */
export function crewProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const seen = new Set<string>();
  for (const x of shortFlights(g)) {
    const f = g.flights[x.flightId];
    const k = f.dutyId ?? f.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const card = crewFlightCard(g, x.flightId);
    if (card) out.push(card);
  }
  // v0.7.2 captains in an FO seat and rest seats that would offload passengers, over the next 48 h.
  for (const d of Object.values(g.duties)) {
    if (d.done || d.report < g.now || d.report > g.now + 2 * DAY || !d.flightIds.length) continue;
    const cap = captainAsFoCard(g, d.flightIds[0]);
    if (cap) out.push(cap);
    for (const fid of d.flightIds) {
      const f = g.flights[fid];
      if (!f || f.pax === undefined || !restSeatsBlocked(g, fid)) continue;
      const r = restSeatsCard(g, fid);
      if (r && r.hurt.pax > 0) out.push(r);
    }
  }
  for (const c of Object.values(g.crew)) {
    if (c.status === 'sick' || c.blocks?.some((b) => b.why === 'sick' && b.from <= g.now + 7 * DAY && b.to > g.now)) {
      const card = crewSickCard(g, c.id);
      if (card && card.severity === 'red') out.push(card);
    }
    if (c.notice && c.notice.leaves - g.now <= 14 * DAY) {
      const card = crewResignedCard(g, c.id);
      if (card) out.push(card);
    }
  }
  return out;
}

// ---------- v0.7.2 ----------

/** A captain rostered in a first officer's (or relief pilot's) seat on the flight's duty (the soonest one). Pure. */
export function captainAsFoCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!f || !d || !p || d.done) return null;
  const slot = p.slots.find((s) => s.crewId && (s.role === 'FO' || s.role === 'CRP') && g.crew[s.crewId]?.role === 'CPT');
  const c = slot ? g.crew[slot.crewId!] : undefined;
  if (!c) return null;
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const type = ac ? typeOf(ac.typeId).short : 'type';
  const nth = (c.asFoAt ?? []).filter((t) => t > g.now - 30 * DAY).length + 1;
  const A = BAL.v072.asFo;
  const ord = nth === 1 ? '1st' : nth === 2 ? '2nd' : nth === 3 ? '3rd' : `${nth}th`;
  return {
    subject: { kind: 'captainAsFo', ref: { kind: 'flight', id: f.id } }, severity: 'amber',
    title: `Capt. ${crewName(c)} flies ${f.no} as first officer`, what: `Capt. ${crewName(c)} flies ${f.no} as first officer`,
    why: `No ${type} first officer is free on ${fmtDay(d.report)}.`,
    hurt: { ...mkHurt({}), text: `Not much: their pay stays; their morale drops if it happens more than twice a month (this is the ${ord})${nth > A.freePerMonth ? `: morale ${A.morale}` : ''}` },
    actions: [
      { id: 'hire', label: 'Hire first officers', open: { modal: 'hire', id: 'FO' }, primary: true },
      { id: 'adjustCrew', label: 'Adjust crew', open: { modal: 'duty', id: d.id } },
    ],
    details: [`${seatLabel(slot!.role, c.role)} on ${f.no} ${f.from}–${f.to} ${fmtDateTime(f.std)}`, `${nth} time${nth > 1 ? 's' : ''} in 30 days`],
    visuals: {}, terms: ['asFo'], by: f.std,
  };
}

/** Seats taken out of sale for crew rest on a flight (the duty needs in-flight rest, the aircraft has no bunks). Pure. */
export function restSeatsCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!f || !ac) return null;
  const blocked = restSeatsBlocked(g, f.id);
  const off = g.messages.find((m) => m.problem?.kind === 'restSeats' && m.ref?.id === f.id);
  if (!blocked && !off) return null;
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  const total = ac.cabin.total;
  const sellable = total - (blocked || (ac.crewRest?.seats ?? 0));
  const pax = f.pax ?? 0;
  const n = off?.hurt?.pax ?? Math.max(0, pax - sellable);
  const money = off?.hurt?.money ?? n * BAL.v072.restSeats.offloadPerPax;
  return {
    subject: { kind: 'restSeats', ref: { kind: 'flight', id: f.id } }, severity: n > 0 ? 'red' : 'amber',
    title: `${f.no} can sell ${sellable} of ${total} seats`, what: `${f.no} can sell ${sellable} of ${total} seats`,
    why: `The ${d ? fmtDuration(d.fdp) : 'long'} duty needs in-flight rest and ${ac.reg} has no bunks, so the last row is curtained off.`,
    hurt: n > 0
      ? { ...mkHurt({ money, pax: n, what: 'compensation' }), text: `Yes: ${n} passenger${n > 1 ? 's' : ''} ${off ? 'offloaded' : 'to offload at departure'}, ${usdShort(money)}` }
      : { ...mkHurt({}), text: `Not much: the load is ${pax || 'below the sellable seats'}` },
    actions: [
      { id: 'schedule', label: 'Swap aircraft', open: { tab: 'schedule', sel: { kind: 'flight', id: f.id } }, primary: true },
      { id: 'refit', label: 'Plan crew rest', open: { modal: 'refit', id: ac.id } },
    ],
    details: [`${blocked || ac.crewRest?.seats || 0} crew rest seats (class 3) on ${ac.reg}`, `Booked ${pax} passengers`], visuals: {}, terms: ['restSeats', 'restClass3', 'crewRest'], by: f.std,
  };
}
