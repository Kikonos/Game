// v0.12 Sub-lease a trip (player request: "a 'sub-lease' button when accepting a new contract and swapping
// aircraft"). Sub-lease is the player's word for our sub-charter: another operator flies a whole trip for us with its
// own aircraft and crew, the client is still billed by us, the rival's price goes to the 'subcharter' ledger line and
// the client notices (reliability and relation, subHit). Nothing new in the rules: the trip is the one a trip move
// takes (tripOf), handed over with subcharterQuotes / subcharter. This module only says, in plain words, whether a
// trip can be handed over and why not.
//
// Not re-exported from ops/index: it uses tripMove, which settles copies through sim.ts (an import cycle).

import { fmtDuration, fmtTime } from '../core/time';
import type { Flight, GameState, Minute } from '../core/types';
import { SUB_LEAD, subcharterQuotes, type SubcharterQuote } from './subcharter';
import { tripOf } from './tripMove';
import { isRevenue } from './util';

export interface SubleaseView {
  ok: boolean;
  /** Why the trip can't be sub-leased (plain words), when not ok. */
  reason?: string;
  /** The legs handed over: the trip's legs still on our aircraft (its empty positioning legs are dropped). */
  flightIds: string[];
  contractId: string | null;
  /** 'DUB–DUS–DUB'. */
  label: string;
  start: Minute;
  /** Up to three operators' prices (cheapest available first), as the sub-charter dialog shows them. */
  quotes: SubcharterQuote[];
  /** The cheapest operator with an aircraft free. */
  best: SubcharterQuote | null;
}

const no = (reason: string, f?: Flight, label?: string): SubleaseView => ({
  ok: false, reason, flightIds: [], contractId: f?.contractId ?? null, label: label ?? (f ? `${f.from}–${f.to}` : ''), start: f?.std ?? 0, quotes: [], best: null,
});

/**
 * Whether the trip this leg belongs to can be sub-leased now, to whom and at what price, or why not: legs of a client's
 * contract only (no ferries, crew tickets or empty legs of ours), none of them under way, the first revenue leg at
 * least SUB_LEAD (6 h) away, and an operator (never the contract's own client) with an aircraft free. Pure.
 */
export function subleaseTrip(g: GameState, flightId: string): SubleaseView {
  const f = g.flights[flightId];
  if (!f) return no('Flight not found');
  if (f.operatedBy) return no(`${g.rivals.find((r) => r.id === f.operatedBy)?.name ?? 'Another operator'} already flies it for us`, f);
  if (f.kind === 'deadhead') return no('Crew tickets are airline flights, not ours', f);
  if (f.status === 'cancelled') return no('This leg is cancelled', f);
  if (f.status === 'done') return no('This leg has already flown', f);
  if (f.status === 'enroute') return no('This leg is in the air', f);
  if (f.kind === 'ferry' || f.purpose) return no('A ferry flight has no client: nobody else can fly it for us', f);
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  if (!c) return no('An empty positioning leg follows the aircraft’s work: sub-lease the trip it flies to', f);
  if (c.dry) return no('A dry lease has no flights of ours to hand over', f);
  if (!f.aircraftId) return no('This leg has no aircraft of ours', f);
  const trip = tripOf(g, flightId);
  const chain = trip.legs.length ? trip.legs : [f];
  const label = trip.label || `${f.from}–${f.to}`;
  const gone = chain.find((x) => x.status !== 'scheduled');
  if (gone) return no(`This trip is under way: ${gone.from}–${gone.to} left at ${fmtTime(gone.atd ?? gone.std)}`, f, label);
  const rev = chain.filter(isRevenue);
  if (!rev.length) return no('Only legs flown for a client can be sub-leased; this trip has none', f, label);
  const first = rev.reduce((a, b) => (b.std < a.std ? b : a));
  if (first.std <= g.now + SUB_LEAD) {
    return no(`${first.from}–${first.to} leaves in ${fmtDuration(Math.max(0, first.std - g.now))}: another operator needs at least ${SUB_LEAD / 60} h to take a trip over`, f, label);
  }
  // The trip's legs still on our aircraft (positioning of the contract included: subcharter drops the empty ones).
  const ids = chain.filter((x) => x.aircraftId && x.std > g.now + SUB_LEAD).map((x) => x.id);
  const quotes = subcharterQuotes(g, ids);
  const view: SubleaseView = { ok: true, flightIds: ids, contractId: c.id, label, start: first.std, quotes, best: quotes.find((q) => q.available) ?? null };
  if (!quotes.length) return { ...view, ok: false, reason: 'No other operator flies this type for this client' };
  if (!view.best) {
    const q = quotes[0];
    return { ...view, ok: false, reason: `No operator has an aircraft free (${q.rivalName}: ${(q.why ?? 'fully booked').replace(/^No /, 'no ')})` };
  }
  return view;
}
