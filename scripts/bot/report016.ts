// v0.16 balance: one line each for the sales desk and the bank, read from the state at the end of a bot run (pure
// reads; UPDATE-0.16.md §C and §A). Leads by source and stage, pitches and their answers, broker relations and deals,
// sales managers; the credit line (limit, most drawn, breaches), loans, leasebacks, invoices sold, interest and fees.

import type { GameState } from '../../src/engine/core/types';
import { statsV016 } from '../../src/engine/core/stats016';
import { BROKER_IDS, brokerName } from '../../src/engine/commercial/sales';

const k$ = (v: number) => `${Math.round(v / 1000)}k`;

export function botSalesFinanceReport(g: GameState): string {
  const s = statsV016(g);
  const c = g.com;
  const leads = c?.leads ?? [];
  const bySrc: Record<string, number> = {};
  for (const l of leads) bySrc[l.source] = (bySrc[l.source] ?? 0) + 1;
  const pitches = c?.pitches ?? [];
  const pr = (r: string) => pitches.filter((p) => p.result === r).length;
  const brokers = BROKER_IDS.filter((id) => c?.brokers?.[id]).map((id) => `${brokerName(id).split(' ')[0]} ${Math.round(c!.brokers![id]!.relation)}/${c!.brokers![id]!.deals}`).join(', ') || 'none';
  const reps = (c?.reps ?? []).map((r) => `${r.market} ${r.skill}`).join(', ') || 'none';
  const by = s.leadsBy ? Object.entries(s.leadsBy).map(([k, v]) => `${k} ${v}`).join(', ') : `in save: ${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}`;
  const sales = `v0.16 sales: leads ${s.leads} (open now ${leads.filter((l) => l.stage === 'lead' || l.stage === 'proposal' || l.stage === 'negotiation').length}; by source {${by}}) · cold ${s.leadsCold}, lost ${s.leadsLost}, signed ${s.leadsSigned} · pitches ${s.pitches} (maybe ${pr('maybe')}, offer ${pr('offer')}, no ${pr('no')}, pending ${pitches.filter((p) => !p.result).length}) · brokers {${brokers}} deals ${s.brokerDeals} · sales managers {${reps}} · stretch ${s.stretchOffers}/${s.stretchSigned} · hidden ${s.hidden} · ramp saved ${s.rampSaved}`;
  const t = g.treasury;
  const cr = t?.credit;
  const fin = t
    ? `v0.16 finance: credit ${cr ? `limit ${k$(cr.limit)}, drawn now ${k$(cr.drawn)}, margin ${(cr.margin * 100).toFixed(1)}%${cr.frozen ? ', FROZEN' : ''}${cr.stepUp ? ', step-up' : ''}${cr.notRenewed ? ', not renewed' : ''}` : 'none'} · draws ${s.draws}, most drawn ${k$(t.stats.drawnMax)}, breaches ${s.breaches} · loans ${s.loans} (open ${t.loans.length}, balance ${k$(t.loans.reduce((a, l) => a + l.balance, 0))}) · leasebacks ${s.leasebacks} · factored ${s.factored} (${k$(t.stats.factored)}) · interest paid ${k$(t.stats.interest)}, fees ${k$(t.stats.fees)}`
    : 'v0.16 finance: no treasury';
  return `${sales}\n${fin}`;
}
