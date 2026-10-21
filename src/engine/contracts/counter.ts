// Counter-offers (v0.5.2): reply timing, the client's odds and the card/inbox wording. The client always answers
// before the offer lapses: its expiry clock is paused while a counter is pending and resumes on the reply.

import { int } from '../core/rng';
import { fmtDay, fmtTime } from '../core/time';
import { clamp } from '../core/util';
import type { ContractOffer, GameState, Minute, Product } from '../core/types';
import { askingPrice } from './accept';
import { paintQuote } from './paintTerms';

/** Client leverage-for-us: urgent jobs need an answer now (1), short notice some (0.5), normal none. */
export const leverage = (o: Pick<ContractOffer, 'urgency'>): number => (o.urgency === 'urgent' ? 1 : o.urgency === 'short' ? 0.5 : 0);

/** Reply delay (minutes, engine RNG): urgent 1–3 h, short notice 3–8 h, normal 16–30 h (about a day). */
export function replyDelay(g: GameState, o: Pick<ContractOffer, 'urgency'>): number {
  return o.urgency === 'urgent' ? int(g, 60, 180) : o.urgency === 'short' ? int(g, 180, 480) : int(g, 16 * 60, 30 * 60);
}

/** The counter's comparison price: the asking price, without the client's paint when the counter drops it. */
export function counterBase(o: ContractOffer): number {
  const noPaint = !!o.paint && o.counter?.paint === false;
  return noPaint && !o.paint!.required ? askingPrice(paintQuote(o, false)) : askingPrice(o);
}

export interface CounterOdds {
  accept: number;
  halfway: number;
  refuse: number;
}

/**
 * The client's answer odds for a counter at `ratio` × asking. Under the asking price: always yes. Inside the hidden
 * walk-away (`floor`, stretched for urgent clients) the yes share falls as the ask grows and "meet halfway" takes
 * most of the rest; beyond it a yes is rare. Urgent and short-notice clients concede more. Pure.
 */
export function counterOdds(o: Pick<ContractOffer, 'urgency' | 'floor'>, ratio: number, halfwayOk = true): CounterOdds {
  if (ratio <= 1) return { accept: 1, halfway: 0, refuse: 0 };
  const L = leverage(o);
  const x = (ratio - 1) / Math.max(0.01, o.floor + 0.06 * L - 1);
  const accept = x <= 1 ? clamp(0.8 - 0.7 * x + 0.15 * L, 0.02, 0.95) : clamp(0.08 + 0.1 * L - 0.08 * (x - 1), 0, 0.2);
  const h = halfwayOk ? clamp(0.7 + 0.2 * L - 0.3 * Math.max(0, x - 1), 0.15, 0.9) : 0;
  const halfway = (1 - accept) * h;
  return { accept, halfway, refuse: Math.max(0, 1 - accept - halfway) };
}

/** Halfway between the asking price and our counter, rounded like the market quotes (per BH: $5, totals: $100). */
export function halfwayPrice(p: Product, asking: number, counter: number): number {
  const mid = (asking + counter) / 2;
  const step = p.kind === 'wet' ? 5 : p.kind === 'charter' ? 100 : 50;
  return Math.round(mid / step) * step;
}

/** Expiry minutes left that the paused clock keeps (old saves: what was left when the counter was sent, ≥ 2 h). */
export const leftOf = (o: ContractOffer): number => o.counter?.left ?? Math.max(120, o.expires - (o.counter?.at ?? o.expires));

export interface CounterView {
  state: 'pending' | 'accepted' | 'refused' | 'halfway';
  /** Our counter, and the price now on the table (the halfway price after 'halfway'), in counter units. */
  price: number;
  asking: number;
  /** Pending: when the client answers. */
  replyBy: Minute | null;
  /** When the offer lapses (paused while pending: now + the time left). */
  expiresAt: Minute;
  /** Card line. */
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
}

const money = (p: Product, v: number): string => {
  const k = v >= 10_000 ? `$${(v / 1000).toFixed(v >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : `$${Math.round(v).toLocaleString('en-US')}`;
  return p.kind === 'wet' ? `${k}/BH` : p.kind === 'dry' ? `${k}/month` : k;
};
const when = (t: Minute) => `${fmtDay(t)} ${fmtTime(t)}`;

/** Offer-card status of the counter (null when none). Pure. */
export function counterView(g: GameState, offerId: string): CounterView | null {
  const o = g.offers[offerId];
  const k = o?.counter;
  if (!o || !k) return null;
  const asking = askingPrice(o);
  if (o.status === 'countered' && !k.result) {
    const expiresAt = g.now + leftOf(o);
    return { state: 'pending', price: k.price, asking, replyBy: k.replyAt, expiresAt, text: `Counter ${money(o.product, k.price)} sent · reply by ${when(k.replyAt)} · clock paused`, tone: 'info' };
  }
  const client = g.clients[o.clientId]?.name ?? 'The client';
  const open = o.status === 'open';
  if (k.result === 'halfway') {
    return {
      state: 'halfway', price: k.price, asking, replyBy: null, expiresAt: o.expires, tone: open ? 'warn' : 'info',
      text: open ? `${client} met us halfway: ${money(o.product, asking)} · accept by ${when(o.expires)}` : `${client} met us halfway at ${money(o.product, asking)}`,
    };
  }
  if (k.result === 'accepted') return { state: 'accepted', price: k.price, asking, replyBy: null, expiresAt: o.expires, text: `Counter ${money(o.product, k.price)} accepted`, tone: 'good' };
  return {
    state: 'refused', price: k.price, asking, replyBy: null, expiresAt: o.expires, tone: open ? 'warn' : 'bad',
    text: open ? `Counter refused · ${money(o.product, asking)} stands until ${when(o.expires)}` : `Counter ${money(o.product, k.price)} refused`,
  };
}
