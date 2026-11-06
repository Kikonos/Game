// v0.17 balance step (UPDATE-0.17.md Q.1e): the exotic floor is the request's, later answers follow the market, the
// previous operator answers mid-life exotic requests, requests bring airframes in the market's band years, and the
// lessor rating starts at C.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { yearOf } from '../core/time';
import { typeOf } from '../core/perf';
import { LESSOR_BY_ID } from '../../data/lessors';
import { EX_OPERATORS } from '../../data/market';
import { lessorRating, lessorsFor } from './credit';
import { newGame } from './deals017.helpers';
import { aircraftChance, bandYears, rfpPreview } from './rfp';

describe('v0.17 balance step', () => {
  it('a new game is rated C (45–54)', () => {
    const r = lessorRating(newGame(3));
    expect(r.grade).toBe('C');
    expect(r.score).toBeGreaterThanOrEqual(45);
    expect(r.score).toBeLessThanOrEqual(54);
  });

  it('the §T floor is per request: shared among its sources, so the request has at least the floor', () => {
    const g = newGame(55);
    g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
    for (const typeId of ['a345', 'a388', 'b744']) {
      const rfp = { typeId, from: g.now, asap: true, band: 'old' as const };
      const defs = lessorsFor(typeId, 'old', !!EX_OPERATORS[typeId]?.length);
      expect(defs.length, typeId).toBeGreaterThan(0);
      const miss = defs.reduce((m, d) => m * (1 - aircraftChance(g, rfp, d)), 1);
      expect(1 - miss, typeId).toBeGreaterThanOrEqual(BAL.v017.exotic.floor.default - 1e-9);
    }
    // An A340-500 is not likelier from each A330/340 lessor than the floor alone would give one source.
    expect(aircraftChance(g, { typeId: 'a345', from: g.now, asap: true, band: 'old' }, LESSOR_BY_ID.carlyle)).toBeLessThan(BAL.v017.exotic.floor.default);
  });

  it('a 747-8 (built 2012–2017) has a source: the airline retiring it answers mid-life requests', () => {
    const g = newGame(55);
    g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
    expect(bandYears(g, typeOf('b748'), 'mid')).not.toBeNull();
    expect(rfpPreview(g, { typeId: 'b748', band: 'mid', months: 36, count: 1, from: null, flex: true }).goesTo).toBeGreaterThan(0);
    // Not for common types: the previous operator still leases only old ones there.
    expect(lessorsFor('a332', 'mid', true).some((l) => l.id === 'exop')).toBe(false);
  });

  it('requests bring airframes in real production years, old at most 26 years', () => {
    const g = newGame(55);
    const now = yearOf(g.now);
    const old = bandYears(g, typeOf('a320ceo'), 'old')!;
    expect(old[0]).toBeGreaterThanOrEqual(Math.max(1988, now - 26));
    expect(old[1]).toBeLessThanOrEqual(now - 16);
    // No young A340-300 (production ended 2011), no A380 built after 2021.
    expect(bandYears(g, typeOf('a343'), 'young')).toBeNull();
    const a380 = bandYears(g, typeOf('a388'), 'young');
    expect(a380 === null || a380[1] <= 2021).toBe(true);
  });
});
