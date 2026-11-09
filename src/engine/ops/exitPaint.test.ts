// v0.19.2 player report (s1212): "CS-TCS has a lease return and then a ferry back to Lisbon for paint. Why?"
// After an Easter wet lease in Royal Air Maroc colours the aircraft's return to the lessor at Hamburg was booked; the
// daily strip job then found the first paint-shop gap after the last commitment, which was the return check itself,
// and booked the strip at LIS after the lease end (a ferry HAM–LIS for an aircraft no longer ours). The return check
// strips the client's colours and paints it white (returnQuote's repaint line), so no paint shop is booked once a return
// is booked, a strip already booked is dropped when the return is booked, the client still pays its share of the strip,
// and a save carrying such a booking is repaired on load.

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Aircraft, Contract, GameState, MaintenanceEvent } from '../core/types';
import { acceptOffer, feasibility } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { deserialize, serialize } from '../save';
import { chooseLease, returnQuote } from './leaseReturn';
import { scheduleCheck } from './maintenance';

type Lease = Extract<Aircraft['ownership'], { kind: 'dryLeaseIn' }>;
const income = (g: GameState) => [...g.finance.history, g.finance.current].reduce((s, st) => s + (st.lines.otherRevenue ?? 0), 0);
const paints = (g: GameState, id: string, phase?: 'in' | 'out') =>
  Object.values(g.maintenance).filter((m) => m.aircraftId === id && m.kind === 'paint' && (!phase || m.paint?.phase === phase));

/** A leased A320 painted for a HAM–PMI season base (client pays the strip), the paint-in done. */
function painted(seed = 6): { g: GameState; ac: Aircraft; c: Contract; own: Lease } {
  const g = newGame(seed);
  const ac = leased(g);
  const own = ac.ownership as Lease;
  own.leaseEnd = g.now + 400 * DAY;
  const o = offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves: 2, start: g.now + 21 * DAY, days: 45, paint: { kind: 'full', required: true } });
  expect(feasibility(g, o.id, ac.id).level).not.toBe('no');
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const c = g.contracts[r.data!.contractId];
  c.paint!.clientShare = 1;
  run(g, g.maintenance[c.paint!.inMx![ac.id]].end + 60);
  expect(ac.paintedFor).toBe(c.id);
  return { g, ac, c, own };
}

describe('v0.19.2 no paint shop after a lease return (CS-TCS)', () => {
  it('a return booked before the job ends: no strip is booked, the return check repaints it and the client pays its share', () => {
    const { g, ac, c, own } = painted();
    const last = Math.max(...flightsOf(g, ac.id).filter((f) => f.contractId === c.id).map((f) => f.sta));
    own.leaseEnd = Math.ceil((last + 16 * DAY) / DAY) * DAY + 12 * 60;
    own.noticeGiven = false;
    expect(chooseLease(g, ac.id, 'return').ok).toBe(true);
    expect(returnQuote(g, ac.id)!.lines.map((l) => l.label)).toContain('Strip and white repaint');
    const rm = g.maintenance[ac.returning!.maintId];
    const income0 = income(g);
    // Day by day through the job's end and the return: no strip at any time (it was booked at LIS after the return).
    for (let t = g.now + DAY; t < own.leaseEnd + 3 * DAY; t += DAY) {
      run(g, t);
      expect(paints(g, ac.id, 'out').filter((m) => m.status === 'planned' || m.status === 'inWork')).toEqual([]);
    }
    expect(c.status).toBe('completed');
    expect(rm.status).toBe('done');
    expect(g.fleet[ac.id]).toBeUndefined();
    // No leg left for it anywhere (no ferry to a paint shop after the handover).
    expect(Object.values(g.flights).filter((f) => f.aircraftId === ac.id && f.status === 'scheduled')).toEqual([]);
    expect(income(g) - income0).toBe(c.paint!.stripCost);
    expect(g.messages.some((m) => m.title.startsWith(`${ac.reg} returned`) && /paid .* towards the repaint/.test(m.body))).toBe(true);
  }, 120_000);

  it('a strip booked first is dropped when the return is booked; no paint can be booked for an aircraft going back', () => {
    const { g, ac, c, own } = painted(6);
    // Hour by hour to the moment the strip is booked (the job just ended), before it starts.
    let strip: MaintenanceEvent | undefined;
    for (let t = c.end - DAY; !strip && t < c.end + 10 * DAY; t += 60) {
      run(g, t);
      strip = paints(g, ac.id, 'out').find((m) => m.status === 'planned');
    }
    expect(strip).toBeDefined();
    own.leaseEnd = Math.ceil((strip!.end + 40 * DAY) / DAY) * DAY + 12 * 60;
    own.noticeGiven = false;
    expect(chooseLease(g, ac.id, 'return').ok).toBe(true);
    expect(strip!.status).toBe('cancelled');
    expect((strip!.ferryIds ?? []).every((id) => g.flights[id]?.status !== 'scheduled')).toBe(true);
    const r = scheduleCheck(g, ac.id, 'paint', g.now + 5 * DAY, 'LIS', { paint: { contractId: c.id, phase: 'out', days: 7, cost: 1 } });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/return check repaints it/) });
    // Extending instead: the strip comes back at the next daily round.
    expect(chooseLease(g, ac.id, 'extend12').ok).toBe(true);
    run(g, g.now + 2 * DAY);
    expect(paints(g, ac.id, 'out').some((m) => m.status !== 'cancelled')).toBe(true);
  }, 120_000);

  it('load repair: a strip planned after the return, or any visit for an aircraft gone, is called off', () => {
    const { g, ac, c, own } = painted(6);
    const last = Math.max(...flightsOf(g, ac.id).filter((f) => f.contractId === c.id).map((f) => f.sta));
    own.leaseEnd = Math.ceil((last + 16 * DAY) / DAY) * DAY + 12 * 60;
    own.noticeGiven = false;
    expect(chooseLease(g, ac.id, 'return').ok).toBe(true);
    // An old save: the strip at LIS after the lease end (as on s1212), and a check for an aircraft no longer in the fleet.
    const paintIn = g.maintenance[c.paint!.inMx![ac.id]];
    const bad: MaintenanceEvent = { ...structuredClone(paintIn), id: 'mx-old', status: 'planned', at: 'LIS', start: own.leaseEnd + 300, end: own.leaseEnd + 300 + 7 * DAY, paint: { phase: 'out', contractId: c.id }, ferryIds: [] };
    const ghost: MaintenanceEvent = { ...structuredClone(paintIn), id: 'mx-ghost', aircraftId: 'gone', kind: 'A', status: 'planned', start: g.now + DAY, end: g.now + DAY + 480, ferryIds: [] };
    delete ghost.paint;
    g.maintenance[bad.id] = bad;
    g.maintenance[ghost.id] = ghost;
    const back = deserialize(serialize(g));
    expect(back.maintenance['mx-old'].status).toBe('cancelled');
    expect(back.maintenance['mx-ghost'].status).toBe('cancelled');
    expect(back.maintenance[ac.returning!.maintId].status).toBe('planned');
    // Idempotent: a second load changes no maintenance booking.
    expect(deserialize(serialize(back)).maintenance).toEqual(back.maintenance);
  }, 120_000);
});
