// v0.7.4 client cabin requests on offers (like the v0.5.1 client paint): "the client wants a two-class cabin for this
// contract". A quick reconfiguration (about 48 h in our hangar) before the first departure, paid by the client in full
// or half, often put back after at the same share. rollCabin draws from a side stream of the engine PRNG at offer
// generation (the main sequence untouched); the rest is pure.

import type { CabinLayout } from '../../data/acmiTypes';
import { cabinPresets } from '../../data/cabins';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { chance, range, weightedPick } from '../core/rng';
import { DAY } from '../core/time';
import type { CabinTerms, ContractOffer, GameState, Product } from '../core/types';
import { setPrice } from './accept';
import { paintQuote, sideRng } from './paintTerms';

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The type's standard preset for a layout ('12J/156Y' for an A320 two-class), else null. Pure. */
export function cabinTarget(typeId: string, layout: CabinLayout) {
  return cabinPresets(typeId).find((p) => p.layout === layout && layout !== 'vip') ?? null;
}

/** Quick reconfiguration terms for a type and layout (BAL.refit). */
function quickTerms(typeId: string, layout: CabinLayout): { days: number; cost: number } | null {
  const t = BAL.refit[typeOf(typeId).body === 'wide' ? 'wb' : 'nb'][layout];
  return t ? { days: t[0], cost: t[1] } : null;
}

/**
 * Rolls a client cabin request for a freshly priced offer on the reference type `ref`: long season bases, capacity
 * leases and long tour series sometimes come with one (never when the client already set cabin rules). Two-class
 * when its seats still meet the client's minimum, else all-economy; never a layout the reference type lacks. Pure
 * apart from the side stream.
 */
export function rollCabin(game: GameState, o: ContractOffer, ref: string, force?: { layout: CabinLayout; required?: boolean; share?: number; revert?: boolean }): CabinTerms | undefined {
  const req = o.requirements;
  // Premium sports and VIP work set their own cabin rules (premium seats): no request on top.
  if (req.minPremium) return undefined;
  const C = BAL.clientCabin;
  const g = sideRng(game, `cabin:${o.id}`);
  const days = (o.end - o.start) / DAY;
  const p = o.archetype === 'seasonBase' ? (days >= 120 ? C.baseLong : days >= 60 ? C.baseMid : 0)
    : o.archetype === 'capacityLease' ? C.lease
    : o.archetype === 'tourSeries' && days >= 56 ? C.tourSeries : 0;
  // Within the cabins the work accepts (a season base: all economy or two-class), the one the client wants.
  const allowed = req.layouts ?? (req.layout ? [req.layout] : null);
  const fits = (l: CabinLayout) => {
    const t = cabinTarget(ref, l);
    return !!t && (!allowed || allowed.includes(l)) && t.j + t.w + t.y >= req.minSeats && (!req.maxSeats || t.j + t.w + t.y <= req.maxSeats);
  };
  if (force) {
    // Forced (tests, dev): the layout asked for when the work allows it, else the other everyday layout.
    const l = fits(force.layout) ? force.layout : (['two-class', 'all-economy'] as CabinLayout[]).find(fits);
    const q = l ? quickTerms(ref, l) : null;
    if (!l || !q) return undefined;
    return { layout: l, required: force.required ?? true, declinePct: 0.03, clientShare: force.share ?? 1, cost: q.cost, days: q.days, revert: force.revert ?? true };
  }
  if (!p || !chance(g, p)) return undefined;
  const want: CabinLayout | null = chance(g, C.twoClass) && fits('two-class') ? 'two-class' : fits('all-economy') ? 'all-economy' : fits('two-class') ? 'two-class' : null;
  if (!want) return undefined;
  const q = quickTerms(ref, want);
  if (!q) return undefined;
  const lead = (o.start - game.now) / DAY;
  if (lead < q.days + 2) return undefined;
  return {
    layout: want, required: chance(g, C.required), declinePct: r2(range(g, ...C.declinePct)),
    clientShare: weightedPick(g, C.share, ([, w]) => w)![0], cost: q.cost, days: q.days, revert: chance(g, C.revert),
  };
}

const LAYOUT_WORDS: Record<CabinLayout, string> = { 'all-economy': 'an all-economy cabin', 'two-class': 'a two-class cabin (business and economy)', 'three-class': 'a three-class cabin', vip: 'a VIP cabin' };

/** One plain line for the blurb and the offer card: 'They want a two-class cabin (12J/156Y on an A320) for the contract: …'. */
export function cabinTermsText(t: CabinTerms, typeId?: string): string {
  const target = typeId ? cabinTarget(typeId, t.layout) : null;
  const pays = t.clientShare >= 1 ? `they pay for it${t.revert ? ' and for putting it back after' : ''}` : `they pay half${t.revert ? ', also of putting it back after' : ''}`;
  const opt = t.required ? 'a condition of the deal' : `optional, ${Math.round(t.declinePct * 100)}% off the rate without it`;
  return `They want ${LAYOUT_WORDS[t.layout]}${target ? ` (${target.label}${typeId ? ` on the ${typeOf(typeId).short}` : ''})` : ''} for the contract: a quick ${t.days * 24} h reconfiguration in our hangar before it starts (${opt}); ${pays}.`;
}

const priceOf = (p: Product) => (p.kind === 'wet' ? p.ratePerBH : p.kind === 'charter' ? p.price : p.rentPerMonth);

/**
 * What the client pays with its paint and cabin requests on or off (v0.5.1 paintQuote, then the cabin request:
 * declined optional cabin = declinePct off). Pure.
 */
export function termsProduct(o: Pick<ContractOffer, 'product' | 'paint' | 'cabin'>, opts: { paint?: boolean; cabin?: boolean } = {}): Product {
  const product = paintQuote(o, opts.paint !== false).product;
  if (o.cabin && opts.cabin === false && !o.cabin.required) setPrice({ product }, priceOf(product) * (1 - o.cabin.declinePct));
  return product;
}

/** Per aircraft: the reconfiguration (and change back) cost on its own type, and the client's share. Pure. */
export function cabinQuote(t: CabinTerms, typeId: string, fromLayout: CabinLayout): { cost: number; back: number; reimbursed: number; days: number; label: string | null } {
  const target = cabinTarget(typeId, t.layout);
  if (!target || fromLayout === t.layout) return { cost: 0, back: 0, reimbursed: 0, days: 0, label: target?.label ?? null };
  const q = quickTerms(typeId, t.layout) ?? { days: t.days, cost: t.cost };
  const b = t.revert && fromLayout !== 'vip' ? quickTerms(typeId, fromLayout) : null;
  const back = b?.cost ?? 0;
  return { cost: q.cost, back, reimbursed: Math.round((q.cost + back) * t.clientShare), days: q.days, label: target.label };
}
