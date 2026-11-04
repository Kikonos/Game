// v0.16 the offer filter (UPDATE-0.16.md §D): what you tell your sales team and the brokers not to bring you. Applied
// when an offer is created (offers.ts finalize): a hidden offer gets `hidden`, no cue, no message, no pause; it still
// exists and expires as usual (the Market tab counts them under "N offers hidden by your filter"). Changing the filter
// re-evaluates the open offers without a chime. Humanitarian work, tenders we won, leads we worked and repeat business
// from our own clients are never hidden.

import { marketOfAirport, marketOfCountry, type MarketId } from '../../data/markets';
import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import type { ActionResult, ClientKind, ContractOffer, GameState, OfferFilter } from '../core/types';
import { feasibility } from './feasibility';
import { clientPrestige } from './prestige';

const F = BAL.v016.filter;

/** Player words for the client kinds the filter can switch off. */
export const KIND_LABEL: Record<ClientKind, string> = {
  tourOperator: 'Tour operators and holiday brochures', airline: 'Airlines', government: 'Governments and militaries', agency: 'Agencies and aid organisations',
  sports: 'Sports', music: 'Music tours', corporate: 'Companies', broker: 'Brokers', operator: 'Other operators',
};
/** The kinds offered as switches, in display order. */
export const FILTER_KINDS: ClientKind[] = ['tourOperator', 'airline', 'government', 'agency', 'sports', 'music', 'corporate', 'operator'];

/** The filter as set (undefined = none). Pure. */
export const offerFilter = (g: GameState): OfferFilter | undefined => g.filter;

/** Load: an older filter without a kinds list gets an empty one (an absent filter is "no filter"). */
export function loadFilter(g: GameState): void {
  if (g.filter) g.filter.kindsOff ??= [];
}

/** The filter that applies now (off or absent = nothing hidden). Pure. */
const active = (g: GameState): OfferFilter | null => (g.filter?.on ? g.filter : null);

/** The markets an offer touches: the client's country and every airport of its pattern. Pure. */
export function offerMarkets(g: GameState, o: ContractOffer): MarketId[] {
  const out = new Set<MarketId>();
  const c = g.clients[o.clientId];
  if (c) out.add(marketOfCountry(c.country));
  const p = o.pattern;
  const codes = p.kind === 'base' ? [p.base, ...p.dests] : p.kind === 'legs' ? p.legs.flatMap((l) => [l.from, l.to]) : [];
  for (const code of codes) {
    const m = marketOfAirport(code);
    if (m) out.add(m);
  }
  return [...out];
}

/** The best estimated profit of a charter on our fleet (quick feasibility, $), null when nothing of ours can fly it. Pure. */
export function bestProfit(g: GameState, o: ContractOffer): number | null {
  let best: number | null = null;
  for (const id of Object.keys(g.fleet)) {
    const r = feasibility(g, o.id, id, { quick: true });
    if (r.level === 'no') continue;
    if (best === null || r.estMargin > best) best = r.estMargin;
  }
  return best;
}

/** Whether the filter hides this offer (pure; read at creation and on a filter change). */
export function offerHidden(g: GameState, o: ContractOffer): boolean {
  const f = active(g);
  if (!f) return false;
  // Humanitarian work always rings; a won tender, a lead we worked and repeat business from our clients are ours to see.
  if (F.alwaysShow.includes(o.archetype)) return false;
  if (o.leadId || o.repeatOf || o.call) return false;
  if (g.com?.tenders?.some((t) => t.result?.offerId === o.id)) return false;
  const c = g.clients[o.clientId];
  if (c?.jobs) return false;
  if (c && f.kindsOff.includes(c.kind)) return true;
  if (f.minPrestige && c && clientPrestige(c) < f.minPrestige) return true;
  if (f.minRatePerBH && o.product.kind === 'wet' && o.product.ratePerBH < f.minRatePerBH) return true;
  if (f.minProfit && o.product.kind === 'charter') {
    const p = bestProfit(g, o);
    if (p !== null && p < f.minProfit) return true;
  }
  if (f.families?.length) {
    const want = f.families;
    const asked = o.requirements.families ?? [];
    if (asked.length) {
      if (!asked.some((x) => want.includes(x))) return true;
    } else {
      // The job names no type: it is for our chosen types when one of them can fly it (none of ours in those families: the filter cannot judge).
      const ours = Object.values(g.fleet).filter((a) => want.includes(typeOf(a.typeId).family as RatingFamily));
      if (ours.length && !ours.some((a) => feasibility(g, o.id, a.id, { quick: true }).level !== 'no')) return true;
    }
  }
  if (f.markets?.length) {
    const ms = offerMarkets(g, o);
    if (ms.length && !ms.some((m) => f.markets!.includes(m))) return true;
  }
  return false;
}

/** Open offers hidden by the filter, best first. Pure. */
export function hiddenOffers(g: GameState): ContractOffer[] {
  return Object.values(g.offers)
    .filter((o) => o.hidden && ((o.status === 'open' && o.expires > g.now) || o.status === 'countered'))
    .sort((a, b) => b.estValue - a.estValue || a.expires - b.expires);
}

/** Re-evaluate every open offer against the filter (hidden ↔ shown, no chime). A call or a countered offer is left alone. */
export function refilterOffers(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    if (o.status !== 'open' || o.call) continue;
    const hide = offerHidden(g, o);
    if (hide && !o.hidden) o.hidden = true;
    else if (!hide && o.hidden) delete o.hidden;
  }
}

/** A clean copy of a filter: no empty lists, no zero minimums. */
function tidy(f: OfferFilter): void {
  f.kindsOff = [...new Set(f.kindsOff)];
  if (!f.minPrestige || f.minPrestige <= 1) delete f.minPrestige;
  if (!f.minRatePerBH || f.minRatePerBH <= 0) delete f.minRatePerBH;
  if (!f.minProfit || f.minProfit <= 0) delete f.minProfit;
  if (f.families) {
    f.families = [...new Set(f.families)];
    if (!f.families.length) delete f.families;
  }
  if (f.markets) {
    f.markets = [...new Set(f.markets)];
    if (!f.markets.length) delete f.markets;
  }
}

/** Whether the filter would hide anything at all (every setting at "any"). Pure. */
export const filterEmpty = (f: OfferFilter | undefined): boolean => !f || (!f.kindsOff.length && !f.minPrestige && !f.minRatePerBH && !f.minProfit && !f.families?.length && !f.markets?.length);

/** Set (merge) the filter and re-evaluate the open offers. Player action. */
export function setOfferFilter(g: GameState, patch: Partial<OfferFilter>): ActionResult<{ hidden: number }> {
  const f = (g.filter ??= { on: true, kindsOff: [] });
  Object.assign(f, patch);
  tidy(f);
  refilterOffers(g);
  const n = hiddenOffers(g).length;
  return { ok: true, data: { hidden: n }, msg: f.on ? (n ? `Filter on: ${n} offer${n === 1 ? '' : 's'} hidden` : 'Filter on') : 'Filter off: every offer shows' };
}

/** Back to no filter at all (the switch off, every setting cleared). Player action. */
export function clearOfferFilter(g: GameState): ActionResult {
  delete g.filter;
  refilterOffers(g);
  return { ok: true, msg: 'Filter cleared' };
}
