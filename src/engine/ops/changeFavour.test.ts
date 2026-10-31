// v0.12.1 round E: a client asks us to move a leg later as a favour. Its own later legs that the move pushes (this
// contract or another of theirs) carry no delay penalty, no compensation and no on-time or reliability hit, and say
// "Client's request"; other clients' legs it pushes are our delay, as before. The card says both up front.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame, owned, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { changeRequestFor, clientFeeFor, resolveDecision } from './events';
import { delayOf } from './flights';
import { stats } from './util';

/** Three trips back to back on one A320: A and B for one client, C for another (turns of 15 min slack). */
function book(seed: number) {
  const g = newGame(seed);
  const ac = owned(g);
  const t = g.now + 4 * DAY;
  const sign = (legs: [string, string, number][], clientId?: string) => {
    const o = legsOffer(g, legs);
    if (clientId) o.clientId = clientId;
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    return { c, fl: Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std) };
  };
  const A = sign([['LIS', 'FAO', t], ['FAO', 'LIS', t + 110]]);
  const back = A.fl[1].sta + 60;
  const B = sign([['LIS', 'OPO', back], ['OPO', 'LIS', back + 120]], A.c.clientId);
  const other = Object.values(g.clients).find((x) => x.id !== A.c.clientId && x.kind === 'airline')!;
  const C = sign([['LIS', 'FAO', B.fl[1].sta + 60]], other.id);
  return { g, ac, A, B, C, other };
}

function ask(g: GameState, c: Parameters<typeof changeRequestFor>[1]) {
  stats(g).askedAt = [];
  for (const d of [...g.decisions]) g.decisions.splice(g.decisions.indexOf(d), 1);
  expect(changeRequestFor(g, c)).toBe(true);
  return g.decisions.find((d) => d.kind === 'changeRequest')!;
}

describe('a change request as a favour', () => {
  it("the card names the knock-on up front: the client's own legs (no penalty) and the other client's (our delay)", () => {
    const { g, A, C, other } = book(61);
    const d = ask(g, A.c);
    const desc = d.options.find((o) => o.id === 'accept')!.desc;
    const name = g.clients[A.c.clientId].name;
    expect(desc).toMatch(/^Moving it later also delays /);
    expect(desc).toContain(`of ${name} (their request: no penalty)`);
    expect(desc).toContain(`${C.fl[0].no} of ${other.name} (up to `);
  });

  it("agreed: their own pushed legs are re-based (not late, no penalty, 'Client's request'); the other client's leg is our delay", () => {
    const { g, A, B, C } = book(62);
    const d = ask(g, A.c);
    const min = Number(d.data!.minutes);
    const name = g.clients[A.c.clientId].name;
    const pen0 = g.finance.current.lines.penalties ?? 0;
    const stdB = B.fl.map((f) => f.std);
    resolveDecision(g, d.id, 'accept');
    expect(A.fl[0].asked).toEqual({ min, by: name });
    for (const [i, f] of B.fl.entries()) {
      if (f.std === stdB[i]) continue;
      expect(delayOf(f)).toBe(0);
      expect(f.delayReason).toBe(`Client's request (${name})`);
      expect(f.asked?.by).toBe(name);
    }
    expect(B.fl.some((f, i) => f.std > stdB[i])).toBe(true);
    // The other client's leg keeps its schedule: the push is ours.
    expect(delayOf(C.fl[0])).toBeGreaterThan(0);
    expect(C.fl[0].delayReason).toBe('Late inbound aircraft');
    expect(C.fl[0].asked).toBeUndefined();
    expect(g.messages[0].body).toContain('(their request: no penalty)');
    // Flown: the client's legs leave on time against their new schedule, no penalty for them.
    run(g, B.fl[1].sta + 60);
    for (const f of [...A.fl, ...B.fl]) expect(f.status).toBe('done');
    for (const f of [...A.fl, ...B.fl]) expect(delayOf(f)).toBeLessThanOrEqual(15);
    expect(g.finance.current.lines.penalties ?? 0).toBe(pen0);
  });

  it("sibling: a client's own late change (moved by a day) is not a delay we pay for", () => {
    const g = newGame(63);
    const ac = owned(g);
    const t = g.now + 4 * DAY;
    const o = legsOffer(g, [['LIS', 'FNC', t + 10 * 60], ['FNC', 'LIS', t + 15 * 60]]);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const c = g.contracts[r.data!.contractId];
    g.clients[c.clientId].level = 'known';
    stats(g).askedAt = [];
    expect(clientFeeFor(g, c)).toBe(true);
    const legs = Object.values(g.flights).filter((f) => f.contractId === c.id && f.kind === 'revenue').sort((a, b) => a.std - b.std);
    for (const f of legs) {
      expect(delayOf(f)).toBe(0);
      expect(f.asked).toEqual({ min: DAY, by: g.clients[c.clientId].name });
    }
    const pen0 = g.finance.current.lines.penalties ?? 0;
    for (const d of [...g.decisions]) resolveDecision(g, d.id, d.defaultOption);
    run(g, legs[1].sta + 60);
    expect(legs.map((f) => f.status)).toEqual(['done', 'done']);
    expect(g.finance.current.lines.penalties ?? 0).toBe(pen0);
  });
});
