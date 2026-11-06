// v0.17 lane `deals` (UPDATE-0.17.md §D, §H, §T): requests for proposals, AOC families and variations, the exotic floor.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { DAY, yearOf } from '../core/time';
import { advanceTo } from '../sim';
import { aircraftChance, rfpPreview, sendRfp, withdrawRfp, windowX } from './rfp';
import { aocMiss, applyVariation, aocView, familyOnAoc, needsVariation, variationQuote } from './aoc';
import { LESSOR_BY_ID } from '../../data/lessors';
import { newGame } from './deals017.helpers';
import { gateMisses } from '../ops/approvalGate';
import type { GameState } from '../core/types';

const runDays = (g: GameState, d: number) => {
  const end = g.now + d * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY));
};
const draft = { typeId: 'a320ceo', band: 'mid' as const, months: 36, count: 1 as const, from: null, flex: true };

describe('v0.17 requests for proposals (§D)', () => {
  it('a start-up asking for a mid-life A320ceo: mid-life lessors look, top lessors decline on the rating', () => {
    const g = newGame(51);
    const p = rfpPreview(g, draft);
    expect(p.blocked).toBeNull();
    expect(p.goesTo).toBeGreaterThanOrEqual(2);
    expect(p.lessors.find((l) => l.id === 'aercap')?.ok).toBe(false);
    expect(p.lessors.find((l) => l.id === 'carlyle')?.ok).toBe(true);
    expect(p.text).toMatch(/^Goes to \d+ lessors · \d+ won't consider us yet \(rating C\) · answers in/);
  });

  it('answers on their own days; a summary when the last is in; proposals on the market with their fields', () => {
    const g = newGame(52);
    const r = sendRfp(g, { ...draft, count: 2, from: g.now + 150 * DAY });
    expect(r.ok).toBe(true);
    const rfp = g.leasing!.rfps[0];
    expect(rfp.replyBy).toBeLessThanOrEqual(g.now + 15 * DAY);
    runDays(g, 16);
    expect(rfp.status).toBe('done');
    expect(rfp.answers.every((a) => a.kind)).toBe(true);
    expect(g.messages.some((m) => m.ref?.kind === 'rfp' && /request:/.test(m.title))).toBe(true);
    for (const o of g.market.aircraft.filter((x) => x.rfpId === rfp.id)) {
      expect(o.source).toBe('proposal');
      expect(o.lessorId).toBeDefined();
      expect(o.freeAt).toBeDefined();
      expect(o.validUntil).toBeGreaterThan(g.now - 1);
      const age = yearOf(g.now) - o.builtYear;
      expect(age).toBeGreaterThanOrEqual(8);
      expect(age).toBeLessThan(17);
    }
  });

  it('is deterministic: the same game asks and is answered alike', () => {
    const run = () => {
      const g = newGame(53);
      sendRfp(g, { ...draft, from: g.now + 200 * DAY });
      runDays(g, 16);
      return JSON.stringify(g.leasing!.rfps[0].answers);
    };
    expect(run()).toBe(run());
  });

  it('at most 2 open while a Newcomer; withdraw', () => {
    const g = newGame(54);
    expect(sendRfp(g, draft).ok).toBe(true);
    expect(sendRfp(g, { ...draft, typeId: 'b738' }).ok).toBe(true);
    expect(rfpPreview(g, { ...draft, typeId: 'a321ceo' }).blocked).toMatch(/At most 2/);
    expect(withdrawRfp(g, g.leasing!.rfps[0].id).ok).toBe(true);
    expect(rfpPreview(g, { ...draft, typeId: 'a321ceo' }).blocked).toBeNull();
  });

  it('planning ahead pays: the window factor', () => {
    expect(windowX(10)).toBe(0.5);
    expect(windowX(90)).toBe(0.9);
    expect(windowX(200)).toBe(1.15);
  });

  it('a widebody needs its approval first; §T an exotic with every requirement met has the floor chance', () => {
    const g = newGame(55);
    expect(rfpPreview(g, { ...draft, typeId: 'a388', band: 'old' }).blocked).toMatch(/first/);
    g.company.approvals.push('widebody', 'augmented', 'etops120', 'etops180');
    const rfp = { typeId: 'b748', from: g.now + 200 * DAY, asap: false };
    expect(aircraftChance(g, rfp, LESSOR_BY_ID.exop)).toBeGreaterThanOrEqual(BAL.v017.exotic.floor.default);
    expect(aircraftChance(g, { ...rfp, typeId: 'b742' }, LESSOR_BY_ID.exop)).toBeGreaterThanOrEqual(BAL.v017.exotic.floor.classic);
    const p = rfpPreview(g, { ...draft, typeId: 'a388', band: 'old' });
    expect(p.lessors.find((l) => l.id === 'amedeo')?.ok).toBe(true);
    // The first widebody family rides on Widebody operations: no variation.
    expect(p.aocNote).toBeUndefined();
  });
});

describe('v0.17 AOC families and variations (§H)', () => {
  it('a new A320 operator: A321neo needs nothing, the 737 needs a variation', () => {
    const g = newGame(61);
    expect(familyOnAoc(g, 'A320')).toBe(true);
    expect(needsVariation(g, 'A320')).toBe(false);
    expect(needsVariation(g, 'B737')).toBe(true);
    expect(aocMiss(g, 'B737')?.state).toBe('missing');
    const q = variationQuote(g, 'B737')!;
    expect(q.cost).toBe(80_000);
    expect(q.days).toBe(90);
  });

  it('the first widebody family comes with Widebody operations', () => {
    const g = newGame(62);
    expect(needsVariation(g, 'A330/340')).toBe(true);
    g.company.approvals.push('widebody');
    expect(needsVariation(g, 'A330/340')).toBe(false);
    expect(familyOnAoc(g, 'A330/340')).toBe(true);
  });

  it('filed, due in 90 days, granted once 2 + 2 pilots are rated', () => {
    const g = newGame(63);
    g.company.cash = 5_000_000;
    expect(applyVariation(g, 'B737').ok).toBe(true);
    const v = g.company.aocVariations![0];
    expect(v.done - g.now).toBe(90 * DAY);
    expect(aocMiss(g, 'B737')?.state).toBe('late');
    expect(aocView(g).variations[0].waiting).toMatch(/captain/);
    g.now = v.done + 1;
    runDays(g, 1);
    expect(v.granted).toBeUndefined();
    let cpt = 0;
    let fo = 0;
    for (const c of Object.values(g.crew)) {
      if (c.role === 'CPT' && cpt < 2) {
        c.ratings.push('B737');
        cpt++;
      } else if (c.role === 'FO' && fo < 2) {
        c.ratings.push('B737');
        fo++;
      }
    }
    runDays(g, 1);
    expect(v.granted).toBeDefined();
    expect(g.company.aocFamilies).toContain('B737');
    expect(g.messages.some((m) => m.title === 'The B737 is on our AOC')).toBe(true);
  });

  it('the gate at departure: a revenue leg of a family not on the AOC misses `aoc`', () => {
    const g = newGame(64);
    const ac = Object.values(g.fleet)[0];
    const f = { id: 'fx', no: 'AW1', aircraftId: ac.id, kind: 'charter', from: 'LIS', to: 'FAO', std: g.now + DAY, sta: g.now + DAY + 60, delay: 0, status: 'scheduled' } as never;
    expect(gateMisses(g, f).some((m) => m.id === 'aoc')).toBe(false);
    g.company.aocFamilies = [];
    const m = gateMisses(g, f).find((x) => x.id === 'aoc');
    expect(m?.family).toBe('A320');
    expect(gateMisses(g, { ...(f as object), kind: 'ferry' } as never).some((x) => x.id === 'aoc')).toBe(false);
  });
});
