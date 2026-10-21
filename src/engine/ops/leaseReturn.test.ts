// v0.7 lease returns (UPDATE-0.7.md §F6.6): the 120-day notice, extensions, the return ferry and check, return costs.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addFlight, removeFlights } from '../core/entities';
import { DAY } from '../core/time';
import type { Aircraft, GameState } from '../core/types';
import { leased, newGame, run } from '../contracts/testkit';
import { resolveDecision } from './events';
import { chooseLease, dailyLeases, leaseView, returnQuote } from './leaseReturn';

const MONTH = 30.44 * DAY;
const line = (g: GameState, cat: 'leaseReturn') => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

/** The startup lease, ending `days` from now (the lessor redelivers at Shannon). */
function ending(seed: number, days: number): { g: GameState; ac: Aircraft } {
  const g = newGame(seed);
  const ac = leased(g);
  if (ac.ownership.kind !== 'dryLeaseIn') throw new Error('no lease');
  ac.ownership.leaseEnd = g.now + days * DAY;
  ac.ownership.returnSite = 'SNN';
  ac.ownership.deposit = 456_000;
  ac.ownership.noticeGiven = false;
  return { g, ac };
}

describe('the lease notice', () => {
  it('120 days before the end: one decision (extend 12 by default, extend 36, return) with live quotes; the default extends at × 0.97 × index', () => {
    const { g, ac } = ending(3, 125);
    dailyLeases(g);
    expect(g.decisions.filter((d) => d.kind === 'leaseEnd')).toHaveLength(0);
    g.now += 6 * DAY;
    dailyLeases(g);
    dailyLeases(g);
    const ds = g.decisions.filter((d) => d.kind === 'leaseEnd');
    expect(ds).toHaveLength(1);
    const d = ds[0];
    expect(d.defaultOption).toBe('extend12');
    expect(d.options.map((o) => o.id)).toEqual(['extend12', 'extend36', 'return']);
    expect(d.expires).toBe(g.now + 14 * DAY);
    // −3% / −8% at a market index of 1 (the index moves the rent too).
    expect(d.body).toMatch(/^AerCap offers 12 months at \$\d+K \([−+]\d+%\) or 36 months at \$\d+K \([−+]\d+%\)\. Returning costs about \$.* at Shannon/);
    const v = leaseView(g, ac.id)!;
    expect(v.decisionId).toBe(d.id);
    const own = ac.ownership as Extract<Aircraft['ownership'], { kind: 'dryLeaseIn' }>;
    const rent0 = own.rentPerMonth;
    const end0 = own.leaseEnd;
    expect(resolveDecision(g, d.id, 'extend12').ok).toBe(true);
    expect(own.rentPerMonth).toBe(Math.round((rent0 * 0.97 * g.market.narrowIndex) / 1000) * 1000);
    expect(own.leaseEnd).toBe(Math.round(end0 + 12 * MONTH));
    expect(own.noticeGiven).toBe(false);
    expect(g.stats.leaseExtensions).toBe(1);
    expect(g.decisions.filter((x) => x.kind === 'leaseEnd')).toHaveLength(0);
    expect(g.queue.some((e) => e.type === 'lease.end' && e.id === ac.id && e.t === own.leaseEnd)).toBe(true);
  });
});

describe('return quote', () => {
  it('check by body, half-life beyond 50% of the C interval (× 0.5), cabin back as delivered, white repaint unless white; deposit separate', () => {
    const { g, ac } = ending(4, 200);
    ac.maint.fhSinceC = 0.8 * BAL.cCheckFH.narrow;
    ac.maint.lastC = g.now;
    const q = returnQuote(g, ac.id)!;
    const half = Math.round(((0.8 - 0.5) * BAL.checkCost.C[0] * 0.5) / 1000) * 1000;
    expect(q.lines).toEqual([
      { label: 'Return check', amount: 180_000 },
      { label: 'Half-life compensation', amount: half },
      { label: 'Strip and white repaint', amount: 180_000 },
    ]);
    expect(q).toMatchObject({ site: 'SNN', deposit: 456_000, checkDays: 7, total: 360_000 + half });
    expect(q.ferry.map((l) => `${l.from}-${l.to}`)).toEqual(['LIS-SNN']);
    // White and refitted: no repaint, the cabin goes back.
    ac.livery = 'white';
    ac.cabin = { j: 24, w: 0, y: 90, total: 114, label: '24J/90Y', layout: 'vip' };
    const q2 = returnQuote(g, ac.id)!;
    expect(q2.lines.map((l) => l.label)).toEqual(['Return check', 'Half-life compensation', 'Cabin back to all-economy']);
    expect(q2.lines[2].amount).toBe(120_000);
    expect(returnQuote(g, Object.values(g.fleet).find((a) => a.ownership.kind === 'owned')!.id)).toBeNull();
  });
});

describe('returning the aircraft', () => {
  it('books a ferry and a check ending at the lease end; costs at the start; deposit back and the aircraft gone at the end', () => {
    const { g, ac } = ending(5, 40);
    const own = ac.ownership as Extract<Aircraft['ownership'], { kind: 'dryLeaseIn' }>;
    const r = chooseLease(g, ac.id, 'return');
    if (!r.ok) throw new Error(r.error);
    const ret = ac.returning!;
    const m = g.maintenance[ret.maintId];
    expect(m).toMatchObject({ kind: 'return', at: 'SNN', leaseReturn: true, end: own.leaseEnd, start: own.leaseEnd - 7 * DAY });
    expect(ret.ferryIds.length).toBe(1);
    expect(g.flights[ret.ferryIds[0]]).toMatchObject({ kind: 'ferry', purpose: 'return', from: 'LIS', to: 'SNN' });
    expect(g.messages[0].title).toBe(`Lease return booked: ${ac.reg}`);
    expect(chooseLease(g, ac.id, 'return').ok).toBe(false);
    const quote = ret.quote;
    const cash0 = g.company.cash;
    run(g, m.start + 60);
    expect(m.status).toBe('inWork');
    expect(line(g, 'leaseReturn')).toBe(-quote);
    run(g, m.end + 60);
    expect(g.fleet[ac.id]).toBeUndefined();
    expect(g.stats.leaseReturns).toBe(1);
    const msg = g.messages.find((x) => x.title === `${ac.reg} returned to AerCap`)!;
    expect(msg.body).toMatch(/^Redelivered at Shannon after a 7-day return check\. Return costs \$.*Deposit \$456K refunded\./);
    expect(line(g, 'leaseReturn')).toBe(-quote);
    // The deposit came back (other cash flows aside, cash rose by at least most of it at the end).
    expect(g.company.cash).toBeGreaterThan(cash0 - quote - 3_000_000);
  });

  it('refuses a return that clashes with flights; extending later unbooks a planned return', () => {
    const { g, ac } = ending(6, 60);
    const own = ac.ownership as Extract<Aircraft['ownership'], { kind: 'dryLeaseIn' }>;
    const f = addFlight(g, { no: 'T1', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'LIS', to: 'FAO', std: own.leaseEnd - 3 * DAY, sta: own.leaseEnd - 3 * DAY + 60 });
    const bad = chooseLease(g, ac.id, 'return');
    expect(bad.ok ? '' : bad.error).toMatch(/^Clashes with 1 flight from .*: move them first$/);
    removeFlights(g, [f.id]);
    const r = chooseLease(g, ac.id, 'return');
    if (!r.ok) throw new Error(r.error);
    const m = g.maintenance[ac.returning!.maintId];
    expect(chooseLease(g, ac.id, 'extend36').ok).toBe(true);
    expect(ac.returning).toBeUndefined();
    expect(m.status).toBe('cancelled');
  });
});
