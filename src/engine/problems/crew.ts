// v0.7.1 crew problems as ProblemCards (UPDATE-0.7.1.md §3.6–§3.8, §9): crew-short / illegal / tight flights (the
// Crew Control card), a sick crew member with work ahead, a resignation with trips still to cover. Pure.

import { DAY, fmtDay, fmtDateTime } from '../core/time';
import type { GameState, ProblemRef } from '../core/types';
import { crewGauges, crewShortCard, shortFlights } from '../crew/control';
import { crewName } from '../crew/generate';
import { dutyLegality } from '../crew/rosterActions';
import { flightCrewStatus, rosterOf } from '../crew/roster';
import { mkHurt, type ProblemCard } from './types';

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
