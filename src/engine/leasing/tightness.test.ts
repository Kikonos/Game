// v0.17 market tightness (UPDATE-0.17.md §A): read with the season and shocks, the monthly pull, supply events, the
// outlook line, the once-only 777-9 delay; the v0.16 market reads the scarcity.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { TPL_BY_ID } from '../../data/worldEvents';
import { BAL } from '../core/balance';
import { DAY, fromUTC } from '../core/time';
import type { WorldEvent } from '../core/types';
import { newGame } from '../contracts/testkit';
import { marketOutlook } from '../ops/market';
import { startEvent } from '../ops/world';
import { baseTight, onSupplyEvent, seasonTight, stepTightness, supplyOutlook, targetTight, tightNow, tightWord } from './tightness';

const ev = (g: ReturnType<typeof newGame>, kind: WorldEvent['kind'], extra: Partial<WorldEvent> = {}): WorldEvent => ({
  id: `we${kind}`, kind, tpl: extra.tpl ?? kind, title: 'Test', body: '', country: 'XX', at: 'LIS', start: g.now, end: g.now + 30 * DAY, offerIds: [], flightsHit: 0, ...extra,
});

describe('v0.17 tightness (§A)', () => {
  it('reads the stored value + the season + shocks; the v0.16 market reads the scarcity', () => {
    const g = newGame(3);
    g.leasing!.tight.a320ceo = 0.45;
    // 1 March: narrowbody season +0.06.
    expect(seasonTight('narrow', g.now)).toBe(0.06);
    expect(tightNow(g, 'a320ceo')).toBeCloseTo(0.51, 6);
    g.leasing!.shocks.push({ id: 's', typeIds: ['a320ceo'], delta: 0.1, until: g.now + DAY, text: 'x' });
    expect(tightNow(g, 'a320ceo')).toBeCloseTo(0.61, 6);
    expect(tightNow(g, 'a320ceo', g.now + 2 * DAY)).toBeCloseTo(0.51, 6);
    (BAL.v017 as { on: boolean }).on = false;
    try {
      for (const t of ACMI_TYPES_LIST) expect(tightNow(g, t.id)).toBe(t.scarcity);
    } finally {
      (BAL.v017 as { on: boolean }).on = true;
    }
  });

  it('the words of §A.1', () => {
    expect(tightWord(0.29)).toBe('Easy');
    expect(tightWord(0.45)).toBe('Normal');
    expect(tightWord(0.6)).toBe('Tight');
    expect(tightWord(0.8)).toBe('Very tight');
    expect(tightWord(0.95)).toBe('Almost none');
  });

  it('moves monthly toward its target (phase, narrowbody easing) and stays inside 0.05–0.99; deterministic', () => {
    const a = newGame(4);
    const b = newGame(4);
    for (const g of [a, b]) {
      g.leasing!.tight.a332 = 0.2;
      for (let m = 0; m < 12; m++) {
        g.now += 31 * DAY;
        stepTightness(g);
      }
    }
    expect(a.leasing!.tight).toEqual(b.leasing!.tight);
    expect(Math.abs(a.leasing!.tight.a332 - targetTight(a, 'a332'))).toBeLessThan(0.2);
    expect(a.leasing!.tight.a332).toBeGreaterThan(0.45);
    for (const v of Object.values(a.leasing!.tight)) {
      expect(v).toBeGreaterThanOrEqual(0.05);
      expect(v).toBeLessThanOrEqual(0.99);
    }
    // The narrowbody easing: A320ceo's target is under its base after a year.
    expect(targetTight(a, 'a320ceo')).toBeLessThan(baseTight('a320ceo'));
    expect(a.leasing!.prevTight).toBeDefined();
  });

  it('supply events: GTF tightens the A320 family, a recession eases all, a Gulf war tightens widebodies', () => {
    const g = newGame(5);
    const t0 = { neo: tightNow(g, 'a321neo'), ceo: tightNow(g, 'a320ceo'), w: tightNow(g, 'a332'), b: tightNow(g, 'b738') };
    onSupplyEvent(g, ev(g, 'engineCrisis', { tpl: 'engineGtf' }));
    expect(tightNow(g, 'a321neo')).toBeCloseTo(t0.neo + 0.1, 6);
    expect(tightNow(g, 'a320ceo')).toBeCloseTo(t0.ceo + 0.05, 6);
    onSupplyEvent(g, ev(g, 'war', { zoneId: 'iraq' }));
    expect(tightNow(g, 'a332')).toBeCloseTo(t0.w + 0.04, 6);
    onSupplyEvent(g, ev(g, 'war', { zoneId: 'sudan', id: 'we2' }));
    expect(tightNow(g, 'a332')).toBeCloseTo(t0.w + 0.04, 6);
    const b1 = tightNow(g, 'b738');
    expect(b1).toBeCloseTo(t0.b + 0.05, 6);
    onSupplyEvent(g, ev(g, 'recession'));
    expect(tightNow(g, 'b738')).toBeCloseTo(b1 - 0.1, 6);
  });

  it('a world airline failure eases its families (TAROM: the 737)', () => {
    const g = newGame(6);
    const before = tightNow(g, 'b738');
    startEvent(g, TPL_BY_ID.failTarom);
    expect(tightNow(g, 'b738')).toBeCloseTo(before - 0.15, 6);
  });

  it('the outlook lists up to five types near us with a word; the 777-9 delay comes once in 2027–2028', () => {
    const g = newGame(7);
    const s = supplyOutlook(g);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(5);
    expect(marketOutlook(g).supplyText).toMatch(/A320|737/);
    let fired = 0;
    for (let m = 0; m < 30; m++) {
      g.now += 31 * DAY;
      const had = g.leasing!.supply?.delay777x;
      stepTightness(g);
      if (had === undefined && g.leasing!.supply?.delay777x !== undefined) fired++;
    }
    expect(fired).toBe(1);
    expect(g.leasing!.supply!.delay777x!).toBeLessThan(fromUTC(2029, 1, 1));
  });
});
