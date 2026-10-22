// v0.7.2 F3: sub-chartering costs reliability, more as it becomes a habit (UPDATE-0.7.2.md F3).

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame, owned } from '../contracts/testkit';
import { positioningCost, subHit } from './flights';
import { subcharter, subcharterHit, subcharterQuote, subcharterQuotes } from './subcharter';

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
    c.subLegs = Array.from({ length: 11 }, () => g.now - DAY);
    // share 11 / (11 + 10 flown + 12 planned) = 0.33 → −1.0
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

  it('a fresh contract: the first few legs cost −0.3 each; later legs of the same hand-over cost more', () => {
    const g = newGame(3);
    const { fl } = job(g, 12);
    expect(subHit(g, fl.slice(0, 2)).reliability).toBe(-0.6);
    expect(subHit(g, fl.slice(0, 3)).reliability).toBe(-0.9);
    const ten = subHit(g, fl.slice(0, 10)).reliability;
    expect(ten).toBeLessThan(-3);
    const all = subHit(g, fl);
    expect(all.reliability).toBe(-8);
    expect(all.relation).toBe(-4);
  });

  it('at most −8 per client in 7 days: bundling or splitting a hand-over costs the same', () => {
    const g = newGame(3);
    const { fl } = job(g, 12);
    const all = subHit(g, fl).reliability;
    const ids = fl.slice(0, 12).map((f) => f.id);
    const r1 = subcharter(g, ids, subcharterQuote(g, ids)!.cost);
    if (!r1.ok) throw new Error(r1.error);
    const first = g.stats.subHit!;
    const rest = subHit(g, fl.slice(12));
    expect(Math.round((first + rest.reliability) * 10) / 10).toBe(all);
    g.now += 8 * DAY;
    expect(subHit(g, fl.slice(20)).reliability).toBeLessThan(0);
  });

  it('the quote shows exactly what the hand-over applies, and the logs fill', () => {
    const g = newGame(3);
    const { c, fl } = job(g);
    const ids = [fl[0].id, fl[1].id];
    const q = subcharterQuote(g, ids)!;
    // v0.8: the relation part scales with the chosen rival's quality (1.5 − quality); reliability as v0.7.2.
    const base = subcharterHit(g, ids);
    const rival = g.rivals.find((x) => x.id === q.rivalId)!;
    expect(q.hit).toEqual({ ...base, relation: Math.round(base.relation * (1.5 - rival.quality) * 10) / 10 });
    const before = g.company.reputation.reliable;
    const rel = g.clients[c.clientId].relation;
    const r = subcharter(g, ids, q.cost);
    if (!r.ok) throw new Error(r.error);
    expect(Math.round((g.company.reputation.reliable - before) * 10) / 10).toBe(q.hit.reliability);
    expect(g.clients[c.clientId].relation - rel).toBeCloseTo(q.hit.relation);
    expect(r.msg).toMatch(/ notices: reliability −0\.6\.$/);
    expect(q.hit.reliability).toBe(-0.6); // two of the contract's 12 planned legs: still −0.3 each
    expect(g.stats.subLog!.length).toBe(2);
    expect(c.subLegs!.length).toBe(2);
  });
});

describe('v0.8 fix round 1: quotes', () => {
  it("never quotes the rival that is the contract's own client; positioning from far bases costs more; the best operator is always shown", () => {
    const g = newGame(3);
    const { c, fl } = job(g);
    const ids = [fl[0].id, fl[1].id];
    const all = subcharterQuotes(g, ids);
    expect(all.length).toBeGreaterThan(0);
    // Make the cheapest one our client (we fly for them): it drops out.
    const r = g.rivals.find((x) => x.id === all[0].rivalId)!;
    r.clientId = c.clientId;
    const qs = subcharterQuotes(g, ids);
    expect(qs.some((q) => q.rivalId === r.id)).toBe(false);
    // A Miami operator pays to cross the Atlantic: dearer than the same price level next door.
    const gc = g.rivals.find((x) => x.base === 'MIA');
    if (gc) expect(positioningCost(gc, [fl[0], fl[1]], owned(g).typeId)).toBeGreaterThan(positioningCost({ ...gc, base: 'LIS' }, [fl[0], fl[1]], owned(g).typeId));
    const free = qs.filter((q) => q.available);
    if (free.length > 1) expect(Math.max(...free.map((q) => q.quality))).toBe(Math.max(...subcharterQuotes(g, ids).filter((q) => q.available).map((q) => q.quality)));
    // Three quotes are not all the same price any more.
    if (qs.length === 3) expect(new Set(qs.map((q) => q.cost)).size).toBeGreaterThan(1);
  });
});
