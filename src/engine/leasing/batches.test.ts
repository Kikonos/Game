// v0.17 failure batches (UPDATE-0.17.md §J.3, §P.11): at most one in 300 days, 3–6 offers of one family, under the
// rent quote of the same airframe, one message with the offerNew cue.

import { describe, expect, it } from 'vitest';
import { TPL_BY_ID } from '../../data/worldEvents';
import { DAY } from '../core/time';
import { newGame } from '../contracts/testkit';
import { startEvent } from '../ops/world';
import { quoteTerms } from './terms';

describe('v0.17 failure batches (§J.3)', () => {
  it('TAROM fails: 3–6 of its 737-800s, one batch id, at a storage site, open 14–30 days; one message; the next failure inside 300 days adds no batch', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed);
      startEvent(g, TPL_BY_ID.failTarom);
      const batch = g.market.aircraft.filter((o) => o.source === 'batch');
      expect(batch.length).toBeGreaterThanOrEqual(3);
      expect(batch.length).toBeLessThanOrEqual(6);
      expect(new Set(batch.map((o) => o.batchId)).size).toBe(1);
      for (const o of batch) {
        expect(o.typeId).toBe('b738');
        expect(o.batchOf).toBe('TAROM');
        const life = (o.expires - g.now) / DAY;
        expect(life).toBeGreaterThanOrEqual(14);
        expect(life).toBeLessThanOrEqual(30);
        expect(o.leadDays).toBeGreaterThanOrEqual(30);
        expect(o.leadDays).toBeLessThanOrEqual(120);
        if (o.kind === 'dryLeaseIn') {
          // 8–15 % under the rent the same airframe would be quoted as a lessor call.
          const call = quoteTerms(g, { offerId: o.id, typeId: o.typeId, kind: o.kind, builtYear: o.builtYear, newBuild: false, source: 'call', lessorId: o.lessorId, band: o.band, monthsWanted: o.leaseMonths, grade: o.grade, rentPerMonth: 0, reservesPerFH: 0, leaseMonths: 0, deposit: 0, price: 0 });
          const x = o.rentPerMonth / call.rentPerMonth;
          expect(x).toBeGreaterThan(0.83);
          expect(x).toBeLessThan(0.93);
        } else expect(o.lessor).toMatch(/administrator/);
      }
      const m = g.messages.find((x) => /TAROM's 737-800s are on the market/.test(x.title));
      expect(m).toBeDefined();
      expect(g.leasing!.stats.batches).toBe(1);
      g.now += 100 * DAY;
      startEvent(g, TPL_BY_ID.failAirMoldova);
      expect(g.market.aircraft.filter((o) => o.source === 'batch' && o.typeId === 'a320ceo')).toEqual([]);
      expect(g.leasing!.stats.batches).toBe(1);
      g.now += 250 * DAY;
      startEvent(g, { ...TPL_BY_ID.failAirMoldova, id: 'failAirMoldova2' });
      expect(g.leasing!.stats.batches).toBe(2);
    }
  });
});
