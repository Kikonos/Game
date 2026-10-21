// v0.5.2 counter-offers: paused expiry, reply windows, accept / halfway / refuse odds and card status.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { ContractOffer, GameState } from '../core/types';
import { acceptOffer, askingPrice, counterOffer, feasibilityAll } from '.';
import { answerBy, counterOdds, counterView, halfwayPrice } from './counter';
import { newGame, offer, run } from './testkit';

const fit = (g: GameState, o: ContractOffer) => feasibilityAll(g, o.id).find((r) => r.level !== 'no')!.aircraftId;

describe('counter odds', () => {
  it('at or under the asking price the client always says yes', () => {
    expect(counterOdds({ urgency: 'normal', floor: 1.1 }, 1)).toEqual({ accept: 1, halfway: 0, refuse: 0 });
  });
  it('sum to one, fall with the ask, and urgent clients concede more', () => {
    let prev = 1;
    for (const r of [1.02, 1.05, 1.08, 1.12, 1.2, 1.4]) {
      const n = counterOdds({ urgency: 'normal', floor: 1.1 }, r);
      const u = counterOdds({ urgency: 'urgent', floor: 1.1 }, r);
      expect(n.accept + n.halfway + n.refuse).toBeCloseTo(1, 9);
      expect(n.accept).toBeLessThanOrEqual(prev);
      expect(u.accept).toBeGreaterThan(n.accept);
      expect(u.refuse).toBeLessThanOrEqual(n.refuse);
      prev = n.accept;
    }
    // Far above the walk-away: mostly no.
    expect(counterOdds({ urgency: 'normal', floor: 1.05 }, 1.5).refuse).toBeGreaterThan(0.5);
    expect(counterOdds({ urgency: 'normal', floor: 1.1 }, 1.05, false).halfway).toBe(0);
  });
  it('halfway rounds like a market quote', () => {
    expect(halfwayPrice({ kind: 'wet', ratePerBH: 6310, mghPerMonth: 1, excessRate: 1, cycleFee: 0, positioningBillable: true }, 6310, 6900)).toBe(6605);
  });
});

describe('counter state machine', () => {
  it('a pending counter pauses the expiry; the client answers in 1–3 h on urgent work', () => {
    const g = newGame(21);
    const o = offer(g, 'aogCover');
    o.urgency = 'urgent';
    o.expires = g.now + 90;
    const asking = askingPrice(o);
    expect(counterOffer(g, o.id, Math.round(asking * 1.09), [fit(g, o)]).ok).toBe(true);
    const k = o.counter!;
    expect(k.replyAt - g.now).toBeGreaterThanOrEqual(60);
    expect(k.replyAt - g.now).toBeLessThanOrEqual(180);
    expect(k.left).toBe(90);
    const v = counterView(g, o.id)!;
    expect(v.state).toBe('pending');
    expect(v.text).toMatch(/reply by .* clock paused/);
    run(g, k.replyAt + 1);
    // Never 'expired' while we waited: the client answered.
    expect(k.result).toBeTruthy();
    expect(o.status).not.toBe('expired');
    if (k.result !== 'accepted') {
      expect(o.status).toBe('open');
      expect(o.expires).toBe(k.replyAt + 90);
    }
  });

  it('an urgent job starting within 3 h: the answer and the reopened clock stay before its first departure', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const g = newGame(200 + seed);
      const o = offer(g, 'aogCover');
      // v0.7: a short-notice job no crew can reach in time is not flyable (feasibility 'crew' no).
      const id = feasibilityAll(g, o.id).find((r) => r.level !== 'no')?.aircraftId;
      if (!id) continue;
      run(g, o.start - 170);
      if (o.status !== 'open') continue;
      o.urgency = 'urgent';
      // A clock left long (as the paused one resuming would): the cap must still hold.
      o.expires = o.start + DAY;
      const by = answerBy(g, o, [id]);
      if (!counterOffer(g, o.id, Math.round(askingPrice(o) * 1.15), [id]).ok) continue;
      const k = o.counter!;
      expect(k.replyAt).toBeLessThanOrEqual(Math.max(g.now + 15, by - 60));
      run(g, k.replyAt + 1);
      expect(k.result).toBeTruthy();
      if (o.status === 'open') {
        checked++;
        expect(o.expires).toBeLessThanOrEqual(o.start);
        run(g, o.expires + 1);
        expect(acceptOffer(g, o.id, [id]).ok).toBe(false);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('normal offers get an answer in about a day', () => {
    const g = newGame(22);
    const o = offer(g, 'adhoc');
    o.urgency = 'normal';
    expect(counterOffer(g, o.id, Math.round(askingPrice(o) * 1.04), [fit(g, o)]).ok).toBe(true);
    expect(o.counter!.replyAt - g.now).toBeGreaterThanOrEqual(16 * 60);
    expect(o.counter!.replyAt - g.now).toBeLessThanOrEqual(30 * 60);
  });

  it('all three answers happen, each with an inbox message and card status; halfway can be signed', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 24 && seen.size < 3; seed++) {
      const g = newGame(100 + seed);
      const o = offer(g, 'adhoc');
      o.urgency = 'short';
      o.expires = g.now + 3 * DAY;
      const asking = askingPrice(o);
      const ask = Math.round(asking * o.floor);
      const id = fit(g, o);
      expect(counterOffer(g, o.id, ask, [id]).ok).toBe(true);
      const at = o.counter!.replyAt;
      run(g, at + 1);
      const k = o.counter!;
      seen.add(k.result!);
      const msg = g.messages.find((m) => m.t >= at && m.cat === 'commercial' && m.body.length > 0 && (m.title.includes(o.title)));
      expect(msg, k.result).toBeTruthy();
      const v = counterView(g, o.id)!;
      expect(v.state).toBe(k.result);
      if (k.result === 'halfway') {
        expect(askingPrice(o)).toBe(halfwayPrice(o.product, asking, ask));
        expect(v.text).toMatch(/met us halfway/);
        const res = acceptOffer(g, o.id, [id]);
        expect(res.ok).toBe(true);
        if (res.ok) expect(askingPrice(g.contracts[res.data!.contractId])).toBe(k.offer);
      } else if (k.result === 'refused') {
        expect(askingPrice(o)).toBe(asking);
        expect(v.text).toMatch(/refused/);
      } else expect(o.status).toBe('accepted');
    }
    expect([...seen].sort()).toEqual(['accepted', 'halfway', 'refused']);
  });

  it('is deterministic for a seed', () => {
    const play = () => {
      const g = newGame(31);
      const o = offer(g, 'adhoc');
      counterOffer(g, o.id, Math.round(askingPrice(o) * 1.08), [fit(g, o)]);
      run(g, o.counter!.replyAt + 1);
      return [o.counter!.result, o.counter!.replyAt, askingPrice(o), g.rng];
    };
    expect(play()).toEqual(play());
  });
});
