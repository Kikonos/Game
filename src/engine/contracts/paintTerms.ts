// Client paint terms on offers (v0.5.1, LIVERY.md §4): who asks and how often, the quote, and the paint-shop slot.
// rollPaint draws from the engine RNG at offer generation; paintWindow and paintQuote are pure.

import { PAINT_SHOPS } from '../../data/livery';
import { BAL } from '../core/balance';
import { etopsCap, typeOf } from '../core/perf';
import { chance, int, range, weightedPick, type RngHolder } from '../core/rng';
import { DAY } from '../core/time';
import type { Client, ContractOffer, GameState, Minute, PaintKind, PaintTerms, Product } from '../core/types';
import { hash } from '../core/util';
import { clientLivery } from '../ops/paint';
import { setPrice } from './accept';
import { isBigClub, isGovernment } from './clients';
import type { PositioningLeg } from './feasibility';
import { anchorsOf, DEPLOY_LEAD, route, routeSpan, timeChain } from './plan';
import { isWideJob, productValue } from './pricing';

export interface PaintSlot {
  shop: string;
  start: Minute;
  end: Minute;
  /** Ferry to the shop (arrives a turn before start) and on to the next commitment (leaves a turn after end). */
  ferryIn: PositioningLeg[];
  ferryOut: PositioningLeg[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const roundK = (v: number) => Math.round(v / 1000) * 1000;
const UN = (c: Client) => /^UN\b|^UNHCR\b/.test(c.name) || (c.kind === 'agency' && isGovernment(c));

/**
 * A side stream of the engine PRNG for v0.5.1 rolls, seeded from the game seed and a key (offer id…): deterministic
 * and save-safe, and it leaves the main sequence (g.rng) exactly as it was before liveries existed.
 */
export function sideRng(g: GameState, key: string): RngHolder {
  return { rng: hash(`${g.seed}:${key}`) | 0 };
}

/** Paint request kind and whether it is required, for an offer's archetype and term; null: no request. */
function requestFor(g: RngHolder, o: ContractOffer, client: Client): { kind: PaintKind; required: boolean } | null {
  const P = BAL.paint;
  const days = (o.end - o.start) / DAY;
  switch (o.archetype) {
    case 'seasonBase':
      if (days >= 120) return chance(g, P.baseLong) ? { kind: chance(g, P.baseLongFull) ? 'full' : 'decals', required: chance(g, P.baseLongRequired) } : null;
      if (days >= 60) return chance(g, P.baseMid) ? { kind: 'decals', required: chance(g, P.baseMidRequired) } : null;
      return chance(g, P.baseShort) ? { kind: 'decals', required: false } : null;
    case 'troopRotation':
      return UN(client) && chance(g, P.unRotation) ? { kind: 'decals', required: true } : null;
    case 'tourSeries':
      return days >= 56 && chance(g, P.tourSeries) ? { kind: 'decals', required: false } : null;
    case 'sports':
      return isBigClub(client) && chance(g, P.sports) ? { kind: 'decals', required: false } : null;
    case 'adhoc':
      return days >= 5 && client.kind === 'corporate' && chance(g, P.adhocCorporate) ? { kind: 'decals', required: false } : null;
    default:
      // AOG cover, repatriation and governments' urgent work: never.
      return null;
  }
}

/**
 * Rolls a client paint request for a freshly priced offer (finalize): kind, required, share, quote, days and the
 * client livery. A zero share puts the bonus into the asking price. Full paint needs lead ≥ days + 7, else decals;
 * no request at all when even decals can't be done before the start.
 */
export function rollPaint(game: GameState, o: ContractOffer, force?: { kind: PaintKind; required?: boolean }): PaintTerms | undefined {
  const client = game.clients[o.clientId];
  if (!client) return undefined;
  const g = sideRng(game, `paint:${o.id}`);
  const req = force ? { kind: force.kind, required: force.required ?? chance(g, 0.5) } : requestFor(g, o, client);
  if (!req) return undefined;
  const P = BAL.paint;
  const w = isWideJob(o.requirements) ? 1 : 0;
  const leadDays = (o.start - game.now) / DAY;
  let kind = req.kind;
  let days = kind === 'full' ? int(g, P.full.days[w][0], P.full.days[w][1]) : int(g, P.decals.days[0], P.decals.days[1]);
  if (kind === 'full' && leadDays < days + 7) {
    kind = 'decals';
    days = int(g, P.decals.days[0], P.decals.days[1]);
  }
  if (leadDays < days + 2) return undefined;
  const cost = roundK(range(g, ...(kind === 'full' ? P.full.cost[w] : P.decals.cost[w]) as [number, number]));
  const stripCost = kind === 'full' ? roundK(cost * P.stripFactor) : roundK(range(g, ...(P.decalRemoval.cost[w] as [number, number])));
  const share = weightedPick(g, kind === 'full' ? P.shareFull : P.shareDecals, ([, wt]) => wt)![0];
  const declinePct = r2(range(g, ...(req.required ? P.declineRequired : P.declineOptional)));
  const t: PaintTerms = {
    kind, required: req.required, declinePct, clientShare: share, cost, stripCost, days, stripDays: kind === 'full' ? days : P.decalRemoval.days,
    livery: clientLivery(client, kind),
  };
  if (share === 0) {
    t.bonusPct = P.zeroShareBonus;
    setPrice(o, priceOf(o.product) * (1 + P.zeroShareBonus));
    o.estValue = productValue(o.product, o.estBH, o.start, o.end, o.terms);
  }
  return t;
}

const priceOf = (p: Product) => (p.kind === 'wet' ? p.ratePerBH : p.kind === 'charter' ? p.price : p.rentPerMonth);

/** One line of terms for blurbs and the offer card: 'Full repaint in their colours (required); they pay half.' */
export function paintTermsText(t: PaintTerms): string {
  const what = t.kind === 'full' ? 'Full repaint in their colours' : 'Their titles and logo on a white aircraft (decals)';
  const pays = t.clientShare >= 1 ? 'they pay the paint and the repaint after' : t.clientShare > 0 ? `they pay ${Math.round(t.clientShare * 100)}% of the paint and repaint` : `we pay the paint; the rate is ${Math.round((t.bonusPct ?? 0) * 100)}% higher for it`;
  const opt = t.required ? 'a condition of the deal' : `optional, ${Math.round(t.declinePct * 100)}% off the rate without it`;
  return `${what}, ${t.days} day${t.days > 1 ? 's' : ''} in a paint shop (${opt}); ${pays}.`;
}

/**
 * What signing costs and pays with paint on or off, per aircraft. Off: the price without any zero-share bonus,
 * less declinePct. Pure.
 */
export function paintQuote(o: Pick<ContractOffer, 'product' | 'paint'>, paint: boolean): { product: Product; cost: number; reimbursed: number; days: number } {
  const product = structuredClone(o.product);
  const t = o.paint;
  if (!t) return { product, cost: 0, reimbursed: 0, days: 0 };
  if (!paint) {
    setPrice({ product }, (priceOf(o.product) / (1 + (t.bonusPct ?? 0))) * (1 - t.declinePct));
    return { product, cost: 0, reimbursed: 0, days: 0 };
  }
  const cost = t.cost + t.stripCost;
  return { product, cost, reimbursed: Math.round(cost * t.clientShare), days: t.days };
}

/**
 * A paint-shop slot of `days` for an aircraft. Paint-in (no `after`): the latest slot that ends at least 24 h (and a
 * ferry on to `nextAt` plus the deployment lead) before `before`, after its last commitment before then. Strip
 * (`after` set): the first gap from `after` that fits, ending by `before`. The shop is the home base when it has one,
 * else the paint shop with the least ferry block time. null when nothing fits. Pure.
 */
export function paintWindow(g: GameState, aircraftId: string, terms: Pick<PaintTerms, 'days'>, before: Minute, after?: Minute, opts: { nextAt?: string } = {}): PaintSlot | null {
  const ac = g.fleet[aircraftId];
  if (!ac || !PAINT_SHOPS.length) return null;
  const turn = typeOf(ac.typeId).turnMin;
  const home = g.company.homeBase;
  const dur = terms.days * DAY;
  const shops = PAINT_SHOPS.includes(home) ? [home] : [...PAINT_SHOPS];
  const anchors = anchorsOf(g, aircraftId);
  const cap = etopsCap(g.company.approvals, ac.typeId);
  /** Best shop between X (free from `free`) and Y (null = open end): least block in + out. */
  const shopFor = (X: string, Y: string | null) => {
    let best: { shop: string; inR: { from: string; to: string; block: number }[]; outR: { from: string; to: string; block: number }[]; cost: number } | null = null;
    for (const shop of shops) {
      const inR = route(ac.typeId, X, shop, cap);
      const outR = Y === null ? [] : route(ac.typeId, shop, Y, cap);
      if (!inR || !outR) continue;
      const cost = routeSpan(inR, ac.typeId) + routeSpan(outR, ac.typeId);
      if (!best || cost < best.cost) best = { shop, inR, outR, cost };
    }
    return best;
  };
  const earliestFrom = (free: Minute, ferry: boolean) => (ferry ? Math.max(free, g.now + BAL.ferryLeadMin) : Math.max(free, g.now + 60));
  const slot = (s: NonNullable<ReturnType<typeof shopFor>>, start: Minute): PaintSlot => ({
    shop: s.shop, start, end: start + dur,
    ferryIn: s.inR.length ? timeChain(s.inR, start - turn - routeSpan(s.inR, ac.typeId), ac.typeId) : [],
    ferryOut: s.outR.length ? timeChain(s.outR, start + dur + turn, ac.typeId) : [],
  });

  if (after === undefined) {
    // Paint-in: after the latest commitment that starts before `before`.
    let prev = anchors[0];
    for (const a of anchors) if (a.std < before && (!prev || a.sta > prev.sta)) prev = a;
    if (!prev || prev.std >= before) return null;
    const free = prev.kind === 'start' ? prev.sta : prev.sta + turn;
    const Y = opts.nextAt ?? anchors.find((a) => a.std >= before)?.from ?? home;
    const s = shopFor(prev.to, Y);
    if (!s) return null;
    const outMin = s.outR.length ? routeSpan(s.outR, ac.typeId) + turn + DEPLOY_LEAD : 0;
    const end = Math.floor((before - Math.max(BAL.paint.readyBefore, outMin)) / 15) * 15;
    const start = end - dur;
    const ferry = s.inR.length > 0;
    if (start < earliestFrom(free, ferry) + (ferry ? routeSpan(s.inR, ac.typeId) + turn : 0)) return null;
    return slot(s, start);
  }

  // Strip: walk the gaps between commitments from `after`.
  let i = 0;
  let cur = anchors[0];
  if (!cur) return null;
  let free = cur.kind === 'start' ? cur.sta : cur.sta + turn;
  let at = cur.to;
  for (i = 1; i <= anchors.length; i++) {
    const nx = anchors[i];
    if (nx && nx.std < free) {
      if (nx.sta + turn > free) {
        free = nx.sta + turn;
        at = nx.to;
      }
      continue;
    }
    const s = shopFor(at, nx ? nx.from : null);
    if (s) {
      const ferry = s.inR.length > 0;
      const start = Math.ceil((Math.max(earliestFrom(Math.max(free, after), ferry) + (ferry ? routeSpan(s.inR, ac.typeId) + turn : 0), after) / 15)) * 15;
      const end = start + dur;
      const room = nx ? nx.std - (s.outR.length ? routeSpan(s.outR, ac.typeId) + turn + DEPLOY_LEAD : turn) : Infinity;
      if (end <= room && end <= before) return slot(s, start);
      if (start + dur > before) return null;
    }
    if (!nx) return null;
    free = nx.kind === 'start' ? nx.sta : nx.sta + turn;
    at = nx.to;
  }
  return null;
}
