// v0.8 rivals with personalities (UPDATE-0.8.md §3, §14): bids and their reasons, the rival.bid event, first
// refusal, quotes to hire them, monthly fleets.

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { ContractOffer, GameState, SimEvent } from '../core/types';
import { subcharterQuotes } from '../ops/subcharter';
import { acceptOffer } from './accept';
import { generateOffer } from './offers';
import { loadRivals, offerCompetition, onRivalBid, refreshRivals, rivalList, rivalView, rollRivalBid, whyKind } from './rivals';
import { legsOffer, newGame, owned } from './testkit';

const ev = (id: string): SimEvent => ({ t: 0, type: 'rival.bid', id } as unknown as SimEvent);

/** A fresh open offer copy with no bid yet (same shape every time). */
function blank(g: GameState, base: ContractOffer, i: number): ContractOffer {
  const o: ContractOffer = { ...structuredClone(base), id: `rb${i}`, status: 'open', rivalBid: undefined, firstRefusal: undefined, created: g.now, expires: g.now + 5 * DAY };
  g.offers[o.id] = o;
  return o;
}

describe('competing bids (§3.3)', () => {
  it('more rivals bid in a soft market than in a boom', () => {
    const g = newGame(11);
    const base = generateOffer(g, 'adhoc', { wide: false, window: false })!;
    const rate = (idx: number) => {
      g.market.narrowIndex = idx;
      g.market.wideIndex = idx;
      g.market.shocks = [];
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const o = blank(g, base, i);
        rollRivalBid(g, o);
        if (o.rivalBid) n++;
        delete g.offers[o.id];
      }
      return n / 400;
    };
    const soft = rate(0.82);
    const boom = rate(1.25);
    expect(soft).toBeGreaterThan(boom + 0.1);
    // p = 0.25 + 0.5 × (1.2 − index), clamped 0.15–0.8 (a few rolls find no fitting free rival).
    expect(soft).toBeLessThanOrEqual(0.44 + 0.07);
    expect(boom).toBeGreaterThan(0.08);
  });

  it('bids land inside the style window with a reason; strong when in the first half', () => {
    const g = newGame(12);
    const base = generateOffer(g, 'adhoc', { wide: false, window: false })!;
    const WINDOW: Record<string, [number, number]> = { cheap: [0.3, 0.7], rescue: [0.2, 0.5], big: [0.4, 0.8], steady: [0.5, 0.9], premium: [0.6, 1.0], military: [0.6, 1.0] };
    let seen = 0;
    for (let i = 0; i < 300; i++) {
      const o = blank(g, base, i);
      rollRivalBid(g, o);
      const b = o.rivalBid;
      if (!b) continue;
      seen++;
      const r = g.rivals.find((x) => x.id === b.rivalId)!;
      const [a, z] = WINDOW[r.personality];
      const f = (b.at - o.created) / (o.expires - o.created);
      expect(f).toBeGreaterThanOrEqual(a - 0.01);
      expect(f).toBeLessThanOrEqual(z + 0.01);
      expect(b.why.length).toBeGreaterThan(5);
      expect(['cheaper', 'closer', 'sooner']).toContain(whyKind(b.why));
      if (r.priceFactor < 0.97) expect(b.why).toMatch(/^quoted about \d+ % under the asking rate/);
      const c = offerCompetition(g, o.id);
      expect(c.level).toBe(f <= 0.5 ? 'strong' : 'some');
      expect(c.text).toContain(r.name);
    }
    expect(seen).toBeGreaterThan(50);
  });

  it('an urgent offer far from our aircraft: "closer" and "could fly tonight"', () => {
    const g = newGame(13);
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      const o = generateOffer(g, 'aogCover', { wide: false, window: false, start: g.now + 20 * 60 });
      if (!o) continue;
      o.rivalBid = undefined;
      o.firstRefusal = undefined;
      rollRivalBid(g, o);
      const bid = o.rivalBid as ContractOffer['rivalBid'];
      if (bid && /had an? .+ at .+, ours were [\d,]+ km away/.test(bid.why)) found = true;
      if (bid && o.urgency === 'urgent' && !/quoted/.test(bid.why)) expect(bid.why).toMatch(/could fly tonight|km away/);
      delete g.offers[o.id];
    }
    expect(found).toBe(true);
  });

  it('rival.bid closes only open (or unanswered countered) offers, is stale-safe and never touches first refusal', () => {
    const g = newGame(14);
    const base = generateOffer(g, 'adhoc', { wide: false, window: false })!;
    const r = g.rivals.find((x) => (x.status ?? 'active') === 'active')!;
    const mk = (i: number, patch: Partial<ContractOffer>) => {
      const o = blank(g, base, i);
      o.rivalBid = { rivalId: r.id, at: g.now, factor: 0.9, why: 'quoted about 10 % under the asking rate' };
      Object.assign(o, patch);
      return o;
    };
    const won0 = r.won ?? 0;
    const open = mk(1, {});
    onRivalBid(g, ev(open.id));
    expect(open.status).toBe('lost');
    expect(open.lostWhy).toMatch(/quoted/);
    expect(r.won).toBe(won0 + 1);
    // Stale: already accepted / lost / the bid not due yet / first refusal.
    const acc = mk(2, { status: 'accepted' });
    onRivalBid(g, ev(acc.id));
    expect(acc.status).toBe('accepted');
    const early = mk(3, {});
    early.rivalBid!.at = g.now + 60;
    onRivalBid(g, ev(early.id));
    expect(early.status).toBe('open');
    const fr = mk(4, { firstRefusal: true });
    onRivalBid(g, ev(fr.id));
    expect(fr.status).toBe('open');
    onRivalBid(g, ev('nope'));
    // A first-refusal offer never rolls a bid.
    const fr2 = blank(g, base, 5);
    fr2.firstRefusal = true;
    for (let i = 0; i < 20; i++) rollRivalBid(g, fr2);
    expect(fr2.rivalBid).toBeUndefined();
    expect(offerCompetition(g, fr2.id).text).toMatch(/First refusal/);
    // Unseen losses stay silent; a seen one is announced.
    const m0 = g.messages.length;
    const seen = mk(6, { seen: true });
    onRivalBid(g, ev(seen.id));
    expect(g.messages.length).toBe(m0 + 1);
    expect(g.messages[0].title).toContain(r.name);
  });
});

describe('hiring rivals (§3.4)', () => {
  function job(g: GameState) {
    const ac = owned(g);
    const t = g.now + 5 * DAY;
    const o = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 6 * 60]], 150);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    return flightsOf(g, ac.id).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
  }

  it('at most three quotes, available ones first; a busy rival says when it is free; a Partner rival is cheaper', () => {
    const g = newGame(15);
    const ids = job(g).map((f) => f.id);
    const q = subcharterQuotes(g, ids);
    expect(q.length).toBeGreaterThan(0);
    expect(q.length).toBeLessThanOrEqual(3);
    for (const x of q) expect(x.quality).toBeGreaterThanOrEqual(0);
    // Make the cheapest busy: it drops behind the available ones with a reason.
    const first = g.rivals.find((r) => r.id === q[0].rivalId)!;
    first.load = 0.95;
    const q2 = subcharterQuotes(g, ids);
    const busy = q2.find((x) => x.rivalId === first.id);
    if (busy) {
      expect(busy.available).toBe(false);
      expect(busy.why).toMatch(/^No aircraft free until /);
      expect(q2.findIndex((x) => x.rivalId === first.id)).toBe(q2.length - 1);
    }
    first.load = 0.5;
    // Level discount: the rival as our client at Partner (−10 %).
    const before = subcharterQuotes(g, ids).find((x) => x.rivalId === first.id)!.cost;
    const cl = g.clients[first.clientId!];
    cl.level = 'partner';
    cl.relation = 70;
    cl.jobs = 5;
    const after = subcharterQuotes(g, ids).find((x) => x.rivalId === first.id)!.cost;
    expect(after).toBeLessThan(before * 0.93);
  });
});

describe('fleets and the Rivals view (§3.2, §3.6)', () => {
  it('monthly fleet changes are the same for the same seed and logged', () => {
    const play = () => {
      const g = newGame(16);
      for (let m = 0; m < 12; m++) {
        g.now += 31 * DAY;
        refreshRivals(g);
      }
      return g;
    };
    const a = play();
    const b = play();
    expect(a.rivals.map((r) => r.fleet)).toEqual(b.rivals.map((r) => r.fleet));
    const changed = a.rivals.filter((r) => (r.log ?? []).some(([, t]) => /^(Added|Returned)/.test(t)));
    expect(changed.length).toBeGreaterThan(0);
    const v = rivalView(a, changed[0].id)!;
    expect(v.log.length).toBeGreaterThan(0);
    expect(rivalList(a).length).toBe(a.rivals.length);
  });

  it('each rival gets an operator client record once (load is idempotent)', () => {
    const g = newGame(17);
    const n = Object.keys(g.clients).length;
    loadRivals(g);
    expect(Object.keys(g.clients).length).toBe(n);
    for (const r of g.rivals) {
      expect(r.clientId).toBeDefined();
      expect(g.clients[r.clientId!].rivalId).toBe(r.id);
    }
  });
});
