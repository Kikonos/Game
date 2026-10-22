// v0.7.2 F3: sub-chartering costs reliability, more as it becomes a habit (UPDATE-0.7.2.md F3).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame, owned } from '../contracts/testkit';
import { subHit } from './flights';
import { subcharter, subcharterHit, subcharterQuote } from './subcharter';

/** A signed job of `n` round trips (2n revenue legs) on the owned A320, flights generated. */
function job(g: GameState, n = 6) {
  const ac = owned(g);
  const t = g.now + 5 * DAY;
  const legs: [string, string, number][] = [];
  for (let i = 0; i < n; i++) legs.push(['LIS', 'FAO', t + i * 2 * DAY], ['FAO', 'LIS', t + i * 2 * DAY + 6 * 60]);
  const o = legsOffer(g, legs, 150);
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  const fl = flightsOf(g, ac.id).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
  return { ac, c, fl };
}

describe('sub-charter reliability (F3)', () => {
  it('the first leg costs −0.3; relation −0.5 a leg', () => {
    const g = newGame(3);
    const { fl } = job(g);
    const h = subHit(g, [fl[0]]);
    expect(h.reliability).toBe(-0.3);
    expect(h.relation).toBe(-0.5);
    expect(h.text).toBe('reliability −0.3 · the client notices');
  });

  it('a contract with a third or more of its legs handed over costs −1 a leg', () => {
    const g = newGame(3);
    const { c, fl } = job(g);
    c.legsFlown = 10;
    c.start = g.now - 30 * DAY;
    c.subLegs = [g.now - DAY, g.now - DAY, g.now - DAY, g.now - DAY, g.now - DAY];
    // share 5 / 15 = 0.33 → −1.0
    expect(subHit(g, [fl[0]]).reliability).toBe(-1);
  });

  it('20 legs in 90 days company-wide reach −1 a leg; legs older than 90 days stop counting', () => {
    const g = newGame(3);
    const { fl } = job(g);
    g.stats.subLog = Array.from({ length: 20 }, () => g.now - 10 * DAY);
    expect(subHit(g, [fl[0]]).reliability).toBe(-1);
    g.stats.subLog = Array.from({ length: 20 }, () => g.now - 91 * DAY);
    expect(subHit(g, [fl[0]]).reliability).toBe(-0.3);
  });

  it('each leg of one hand-over costs more than the last; at most −8 a hand-over; relation at most −4 a client', () => {
    const g = newGame(3);
    const { fl } = job(g, 12);
    const one = subHit(g, fl.slice(0, 1)).reliability;
    const two = subHit(g, fl.slice(0, 2)).reliability;
    expect(two).toBeLessThan(2 * one);
    const all = subHit(g, fl);
    expect(all.reliability).toBe(-8);
    expect(all.relation).toBe(-4);
  });

  it('the quote shows exactly what the hand-over applies, and the logs fill', () => {
    const g = newGame(3);
    const { c, fl } = job(g);
    const ids = [fl[0].id, fl[1].id];
    const q = subcharterQuote(g, ids)!;
    expect(q.hit).toEqual(subcharterHit(g, ids));
    const before = g.company.reputation.reliable;
    const rel = g.clients[c.clientId].relation;
    const r = subcharter(g, ids, q.cost);
    if (!r.ok) throw new Error(r.error);
    expect(Math.round((g.company.reputation.reliable - before) * 10) / 10).toBe(q.hit.reliability);
    expect(g.clients[c.clientId].relation - rel).toBeCloseTo(q.hit.relation);
    expect(r.msg).toMatch(/ notices: reliability −1\.3\.$/);
    expect(q.hit.reliability).toBe(-1.3); // the second leg: half the contract's legs so far handed over
    expect(g.stats.subLog!.length).toBe(2);
    expect(c.subLegs!.length).toBe(2);
  });
});
