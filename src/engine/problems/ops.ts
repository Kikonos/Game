// v0.11 Operations problems as ProblemCards (the four lines: what / why / does it hurt / what you can do): a live
// disruption (its decision carries the lines), a ramp inspection finding, an authority audit finding. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtDate } from '../core/time';
import type { Decision, GameState, Message, Ref } from '../core/types';
import { mkHurt, usdShort, type Hurt, type ProblemCard } from './types';

const DISRUPT = new Set(['ctot', 'turnaround', 'curfew', 'diversion', 'medical', 'divertOnward', 'birdStrike', 'sickAway']);
const RED = new Set(['diversion', 'medical', 'sickAway', 'divertOnward']);
export const isDisruption = (d: Pick<Decision, 'kind'>) => DISRUPT.has(d.kind);

const level = (money: number, pax: number): Hurt['level'] => (!money && !pax ? 'none' : money < 10_000 && pax < 100 ? 'low' : 'high');

/** The card of an open disruption decision (its lines ride in the decision's data). */
export function disruptionCard(_g: GameState, d: Decision): ProblemCard {
  const x = d.data ?? {};
  const money = Number(x.money ?? 0);
  const pax = Number(x.pax ?? 0);
  const delayMin = Number(x.delayMin ?? 0);
  const ref: Ref = d.ref ?? { kind: 'decision', id: d.id };
  const what = String(x.what ?? d.title);
  return {
    subject: { kind: 'disruption', ref }, severity: RED.has(d.kind) ? 'red' : 'amber', title: what, what,
    why: String(x.why ?? d.body),
    hurt: { ...mkHurt({ money, pax, delayMin }), level: RED.has(d.kind) ? 'high' : level(money, pax), text: String(x.hurt ?? '') || mkHurt({ money, pax, delayMin }).text },
    actions: [{ id: 'decision', label: 'Decide', open: { modal: 'decision', id: d.id }, primary: true }],
    details: d.options.map((o) => `${o.label}: ${o.desc}`), visuals: {}, terms: [], by: d.expires,
  };
}

/** A disruption that was handled (its Inbox message) or is still open. */
export function disruptionAt(g: GameState, id: string): ProblemCard | null {
  const d = g.decisions.find((x) => isDisruption(x) && (x.ref?.id === id || x.data?.flightId === id || x.data?.aircraftId === id));
  if (d) return disruptionCard(g, d);
  const m = g.messages.find((x) => x.problem?.kind === 'disruption' && x.problem.ref.id === id);
  return m ? messageCard(m) : null;
}

/** A card told from a message (after the fact: nothing left to decide). */
function messageCard(m: Message): ProblemCard {
  return {
    subject: m.problem!, severity: m.tone === 'bad' ? 'red' : 'amber', title: m.title, what: m.title, why: m.body,
    hurt: { ...mkHurt({ money: m.hurt?.money ?? 0, pax: m.hurt?.pax ?? 0, delayMin: m.hurt?.delayMin ?? 0 }), level: m.hurt?.level ?? 'none' },
    actions: [], details: [], visuals: {}, terms: [],
  };
}

export function rampFindingCard(g: GameState, id: string): ProblemCard | null {
  const r = g.opsx?.ramp.find((x) => x.id === id);
  if (!r || !(r.cats[0] + r.cats[1] + r.cats[2])) return null;
  const where = AIRPORT_BY_CODE[r.at]?.city ?? r.at;
  const worst = r.cats[2] ? 3 : r.cats[1] ? 2 : 1;
  const what = worst === 3 ? `${r.reg} ${r.action === '3c' ? 'detained' : 'held'} after a ramp inspection at ${where}` : `${r.reg}: ramp inspection findings at ${where}`;
  return {
    subject: { kind: 'rampFinding', ref: { kind: 'ramp', id: r.id } }, severity: worst === 3 ? 'red' : 'amber', title: what, what,
    why: `${r.prog === 'local' ? 'The local authority' : `A ${r.prog} inspector`} found: ${r.items.map(([c, t]) => `${t.charAt(0).toLowerCase()}${t.slice(1)} (Cat ${c})`).join('; ')}.`,
    hurt: { ...mkHurt({ money: r.cost, delayMin: r.fixMin }), level: worst === 3 ? 'high' : worst === 2 ? 'low' : 'none',
      text: worst === 3 ? `Yes: ${Math.round(r.fixMin / 60)} h on the ground, ${usdShort(r.cost)}; it goes on our safety record` : `A little: ${worst === 2 ? 'a letter to us and our authority' : 'a note'}; it goes on our safety record` },
    actions: [{ id: 'safety', label: 'Safety record', open: { tab: 'company', view: 'safety' }, primary: true }],
    details: ['Older aircraft and a backlog of deferred defects find more', 'A check clears the deferred defects', 'The yearly audit reads every inspection'],
    visuals: {}, terms: [],
  };
}

export function auditFindingCard(g: GameState, id: string): ProblemCard | null {
  const f = g.opsx?.audit.findings.find((x) => x.id === id);
  if (!f || f.closed) return null;
  const what = `Audit finding (Level ${f.level}): ${f.text.charAt(0).toLowerCase()}${f.text.slice(1)}`;
  return {
    subject: { kind: 'auditFinding', ref: { kind: 'audit', id: f.id } }, severity: f.level === 1 || f.overdue ? 'red' : 'amber', title: what, what,
    why: f.why,
    hurt: { ...mkHurt({ money: f.task.cost }), level: f.overdue ? 'high' : 'low',
      text: f.overdue ? 'Yes: approvals are suspended until it is closed' : `Not yet: due ${fmtDate(f.due)}; if missed, approvals are suspended` },
    actions: [{ id: 'safety', label: f.started ? 'Under way' : 'Start the fix', open: { tab: 'company', view: 'safety' }, primary: true }],
    details: [`${f.task.label}: ${usdShort(f.task.cost)}, ${f.task.days} days`, f.started ? `Done ${fmtDate(f.ready ?? f.due)}` : 'Not started'],
    visuals: {}, terms: [], by: f.due,
  };
}

/** Open audit findings as problems (the Inbox filter, the dots). */
export function opsProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const f of g.opsx?.audit.findings ?? []) {
    if (f.closed) continue;
    const c = auditFindingCard(g, f.id);
    if (c) out.push(c);
  }
  return out;
}
