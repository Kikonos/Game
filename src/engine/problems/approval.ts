// v0.12.1 approvals at departure as a ProblemCard (ops/approvalGate.ts): a leg that needs an approval we won't hold
// by its departure. One card per job and aircraft in the problems list (its first leg at risk); the flight sheet
// finds it on any of the job's legs. Pure.

import { BAL } from '../core/balance';
import { fmtDay } from '../core/time';
import type { GameState } from '../core/types';
import { blockedGroup, gateMisses, gateName, gateWhy, legsAtRisk } from '../ops/approvalGate';
import { cancelCost } from '../ops/flights';
import { contractOf } from '../ops/util';
import { mkHurt, type ProblemCard } from './types';

/** The card of a leg at risk (null: it will have what it needs). */
export function approvalLateCard(g: GameState, flightId: string): ProblemCard | null {
  const f = g.flights[flightId];
  if (!f || f.status !== 'scheduled' || !f.aircraftId) return null;
  const miss = gateMisses(g, f);
  if (!miss.length) return null;
  const legs = blockedGroup(g, f);
  const group = legs.length ? legs : [f];
  const first = group[0];
  const k = contractOf(g, first);
  const who = (k && g.clients[k.clientId]?.name) || 'the client';
  const label = miss.map((m) => gateName(m.id)).join(' and ');
  const what = `${first.no} can't fly without ${label}`;
  const pax = group.reduce((n, x) => n + (x.pax ?? 0), 0);
  const pen = cancelCost(g, group);
  const d = g.decisions.find((x) => x.kind === 'approvalLate' && x.data?.flightId && blockedGroup(g, g.flights[String(x.data.flightId)] ?? f).some((y) => y.id === f.id));
  const red = miss.some((m) => m.state !== 'late') || first.std - g.now <= BAL.ladder.gateRedH * 60;
  return {
    subject: { kind: 'approvalLate', ref: { kind: 'flight', id: first.id } }, severity: red ? 'red' : 'amber', title: what, what,
    why: gateWhy(g, first, miss[0]),
    hurt: mkHurt({ pax, legs: group.length, money: pen, what: 'compensation if cancelled', extra: group.length > 1 ? `for ${who} from ${fmtDay(first.std)}` : undefined }),
    actions: [
      ...(d ? [{ id: 'decision', label: 'Decide', open: { modal: 'decision' as const, id: d.id }, primary: true }] : []),
      { id: 'subcharter', label: 'Sub-charter (our cost)', open: { modal: 'subcharter' as const, id: first.id }, primary: !d },
      { id: 'swap', label: 'Swap aircraft', open: { modal: 'sheet' as const, id: first.id } },
      { id: 'ladder', label: 'Ladder', open: { tab: 'company' as const, view: 'ladder' } },
    ],
    details: [
      ...group.slice(0, 6).map((x) => `${x.no} ${x.from}–${x.to} ${fmtDay(x.std)}`),
      ...(group.length > 6 ? [`and ${group.length - 6} more`] : []),
      'At the gate, if it is still missing: a rival flies it if one can, else it is cancelled (our fault: compensation, reliability falls)',
    ],
    visuals: {}, terms: [], by: first.std,
  };
}

/** Current cards: one per job and aircraft, at its first leg at risk. */
export function approvalProblems(g: GameState): ProblemCard[] {
  const out: ProblemCard[] = [];
  const seen = new Set<string>();
  for (const f of legsAtRisk(g)) {
    const key = `${f.contractId ?? f.id}|${f.aircraftId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = approvalLateCard(g, f.id);
    if (c) out.push(c);
  }
  return out;
}
