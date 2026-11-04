// v0.16 the offer filter (UPDATE-0.16.md §D): what is hidden and what always shows, re-evaluation on a change, no
// chime or message for a hidden offer, the Market list and the hidden count.

import { describe, expect, it } from 'vitest';
import { takeCues } from '../core/cues';
import { takePause } from '../core/pause';
import type { ContractOffer, GameState } from '../core/types';
import { marketOffers } from '../../ui/screens/screenLogic';
import { clearOfferFilter, filterEmpty, hiddenOffers, offerHidden, offerMarkets, refilterOffers, setOfferFilter } from './filter';
import { generateOffer } from './offers';
import { newGame, offer } from './testkit';

const tourOp = (g: GameState, o: ContractOffer) => g.clients[o.clientId].kind === 'tourOperator';

describe('offerHidden', () => {
  it('hides nothing without a filter or with it switched off', () => {
    const g = newGame(5);
    const o = offer(g, 'tourSeries');
    expect(offerHidden(g, o)).toBe(false);
    setOfferFilter(g, { on: false, kindsOff: ['tourOperator'] });
    expect(offerHidden(g, o)).toBe(false);
    expect(filterEmpty(g.filter)).toBe(false);
  });

  it('switches client kinds off and keeps the rest', () => {
    const g = newGame(5);
    const t = offer(g, 'tourSeries');
    const a = offer(g, 'seasonBase');
    expect(tourOp(g, t)).toBe(true);
    setOfferFilter(g, { on: true, kindsOff: ['tourOperator'] });
    expect(offerHidden(g, t)).toBe(true);
    expect(offerHidden(g, a)).toBe(false);
  });

  it('a minimum rate per block hour applies to ACMI work, a minimum profit to charters, a minimum client level to everyone', () => {
    const g = newGame(5);
    const wet = offer(g, 'seasonBase');
    const ch = offer(g, 'tourSeries');
    expect(wet.product.kind).toBe('wet');
    expect(ch.product.kind).toBe('charter');
    setOfferFilter(g, { on: true, minRatePerBH: (wet.product.kind === 'wet' ? wet.product.ratePerBH : 0) + 1 });
    expect(offerHidden(g, wet)).toBe(true);
    expect(offerHidden(g, ch)).toBe(false);
    setOfferFilter(g, { minRatePerBH: 0, minProfit: 50_000_000 });
    expect(offerHidden(g, ch)).toBe(true);
    expect(offerHidden(g, wet)).toBe(false);
    setOfferFilter(g, { minProfit: 0, minPrestige: 4 });
    g.clients[ch.clientId].prestige = 1;
    g.clients[wet.clientId].prestige = 4;
    expect(offerHidden(g, ch)).toBe(true);
    expect(offerHidden(g, wet)).toBe(false);
  });

  it('only the chosen markets: a job touching none of them is hidden', () => {
    const g = newGame(5);
    const o = offer(g, 'tourSeries');
    const ms = offerMarkets(g, o);
    expect(ms.length).toBeGreaterThan(0);
    setOfferFilter(g, { on: true, markets: ['oce'] });
    expect(offerHidden(g, o)).toBe(!ms.includes('oce'));
    setOfferFilter(g, { markets: [ms[0]] });
    expect(offerHidden(g, o)).toBe(false);
  });

  it('humanitarian work and repeat business always show; a plain new offer from a known client follows the filter', () => {
    const g = newGame(5);
    setOfferFilter(g, { on: true, kindsOff: ['tourOperator', 'airline', 'government', 'agency', 'sports', 'music', 'corporate', 'operator'] });
    const t = offer(g, 'tourSeries');
    expect(offerHidden(g, t)).toBe(true);
    t.repeatOf = 'k1';
    expect(offerHidden(g, t)).toBe(false);
    delete t.repeatOf;
    g.clients[t.clientId].jobs = 3;
    expect(offerHidden(g, t)).toBe(true);
    const ev = offer(g, 'evacuation');
    expect(offerHidden(g, ev)).toBe(false);
  });
});

describe('the market with a filter', () => {
  it('a new offer the filter hides gets no chime, no message and no pause; it is counted and left off the Market list', () => {
    const g = newGame(5);
    setOfferFilter(g, { on: true, kindsOff: ['tourOperator'] });
    const msgs = g.messages.length;
    takeCues();
    takePause();
    const o = generateOffer(g, 'tourSeries', { wide: false, window: false, paint: false, cabin: false });
    expect(o).toBeTruthy();
    expect(o!.hidden).toBe(true);
    expect(takeCues()).toEqual([]);
    expect(takePause()).toBeNull();
    expect(g.messages.length).toBe(msgs);
    expect(g.stats.v016?.hidden).toBe(1);
    expect(marketOffers(g).some((x) => x.id === o!.id)).toBe(false);
    expect(hiddenOffers(g).map((x) => x.id)).toContain(o!.id);
    // Switched off: it shows again, silently.
    setOfferFilter(g, { on: false });
    expect(o!.hidden).toBeUndefined();
    expect(takeCues()).toEqual([]);
    expect(marketOffers(g).some((x) => x.id === o!.id)).toBe(true);
  });

  it('a filter change re-evaluates the open offers both ways and says how many are hidden', () => {
    const g = newGame(5);
    const t = offer(g, 'tourSeries');
    const r = setOfferFilter(g, { on: true, kindsOff: ['tourOperator'] });
    expect(r.ok && r.data?.hidden).toBe(1);
    expect(r.ok && r.msg).toBe('Filter on: 1 offer hidden');
    expect(t.hidden).toBe(true);
    const r2 = setOfferFilter(g, { kindsOff: [] });
    expect(r2.ok && r2.data?.hidden).toBe(0);
    expect(t.hidden).toBeUndefined();
    t.status = 'countered';
    setOfferFilter(g, { kindsOff: ['tourOperator'] });
    expect(t.hidden).toBeUndefined();
    t.status = 'open';
    refilterOffers(g);
    expect(t.hidden).toBe(true);
    clearOfferFilter(g);
    expect(g.filter).toBeUndefined();
    expect(t.hidden).toBeUndefined();
  });

  it('tidies the settings: empty lists and zero minimums fall away', () => {
    const g = newGame(5);
    setOfferFilter(g, { on: true, kindsOff: ['sports', 'sports'], families: [], markets: ['me', 'me'], minRatePerBH: 0, minProfit: -5, minPrestige: 1 });
    expect(g.filter).toEqual({ on: true, kindsOff: ['sports'], markets: ['me'] });
  });
});
