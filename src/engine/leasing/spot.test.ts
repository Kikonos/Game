// v0.17 short-term aircraft (UPDATE-0.17.md §I, §P.10): windows, asking, answers, the lease's fixed return, the
// 1-day inspection, the late charge.

import { describe, expect, it } from 'vitest';
import { SPOT_SOURCES } from '../../data/market';
import { DAY, fromUTC } from '../core/time';
import type { SimEvent } from '../core/types';
import { newGame } from '../contracts/testkit';
import { acquireAircraft, onLeaseEnd } from '../ops/market';
import { chooseLease, returnQuote } from '../ops/leaseReturn';
import { askSpot, dailySpot, sourcesFor, spotSources, windowMonthsLeft } from './spot';

describe('v0.17 short-term subleases (§I)', () => {
  it('quiet windows: Condor\'s A320s from November, Cebu Pacific\'s in July–September', () => {
    const condor = SPOT_SOURCES.find((s) => s.airline === 'Condor')!;
    expect(windowMonthsLeft(condor, fromUTC(2027, 11, 1))).toBeCloseTo(4, 0);
    expect(windowMonthsLeft(condor, fromUTC(2027, 6, 1))).toBe(0);
    expect(sourcesFor('A320', fromUTC(2027, 7, 1)).map((s) => s.airline)).toEqual(expect.arrayContaining(['Cebu Pacific', 'IndiGo']));
    const g = newGame(3);
    expect(spotSources(g, { family: 'A320', months: 3, from: fromUTC(2027, 11, 1) })).toEqual(expect.arrayContaining(['Condor']));
  });

  it('asking: refused for a family not on our AOC; answers in 3–10 days; an offer is a sublease with one month deposit', () => {
    const g = newGame(4);
    g.now = fromUTC(2027, 11, 2);
    expect(askSpot(g, { family: 'B737', months: 4, from: g.now }).ok).toBe(false);
    let got = 0;
    for (let i = 0; i < 12 && !got; i++) {
      const h = newGame(20 + i);
      h.now = fromUTC(2027, 11, 2);
      const r = askSpot(h, { family: 'A320', months: 3, from: h.now });
      expect(r.ok).toBe(true);
      expect(askSpot(h, { family: 'A320', months: 3, from: h.now }).ok).toBe(false);
      const q = h.leasing!.rfps.at(-1)!;
      for (const a of q.answers) {
        expect(a.due - q.sent).toBeGreaterThanOrEqual(3 * DAY);
        expect(a.due - q.sent).toBeLessThanOrEqual(10 * DAY);
      }
      for (let d = 0; d < 11; d++) {
        h.now += DAY;
        dailySpot(h);
      }
      expect(q.status).toBe('done');
      const offers = h.market.aircraft.filter((o) => o.rfpId === q.id);
      for (const o of offers) {
        got++;
        expect(o.source).toBe('spot');
        expect(o.depositMonths).toBe(1);
        expect(o.spot!.airline).toBe(o.lessor);
        expect(o.site).toBe(o.spot!.base);
        // Signed: the lease ends on the airline's date and goes back after a 1-day inspection.
        h.company.cash = 30_000_000;
        const s = acquireAircraft(h, o.id);
        expect(s.ok).toBe(true);
        const ac = h.fleet[(s as { data: { aircraftId: string } }).data.aircraftId];
        const own = ac.ownership as Extract<typeof ac.ownership, { kind: 'dryLeaseIn' }>;
        expect(own.leaseEnd).toBe(Math.max(ac.delivery!.handover + DAY, o.spot!.returnAt));
        expect(own.returnSite).toBe(o.spot!.base);
        const rq = returnQuote(h, ac.id)!;
        expect(rq.checkDays).toBe(1);
        expect(rq.lines.map((l) => l.label)).toEqual(['Return inspection']);
        expect(chooseLease(h, ac.id, 'extend12').ok).toBe(false);
        // Not back on the date: twice the rent until it is.
        ac.status = 'available';
        h.now = own.leaseEnd;
        const rent = own.rentPerMonth;
        onLeaseEnd(h, { t: h.now, seq: 0, type: 'lease.end', id: ac.id, v: 0 } as SimEvent);
        expect(own.rentPerMonth).toBe(rent * 2);
        expect(own.leaseEnd).toBe(h.now + 7 * DAY);
        break;
      }
    }
    expect(got).toBeGreaterThan(0);
  });
});
