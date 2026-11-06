// v0.17 step 0 (UPDATE-0.17.md §Q.1, §P.1–3): the skeleton is in place and neutral — the leasing state on a new game and
// on an old save, the legacy terms and weights unchanged, the lessor data, the rating read, the exotic path.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { LESSOR_DEFS, lessorIdOf } from '../../data/lessors';
import { BAL } from '../core/balance';
import { COST_CATS } from '../core/ledger';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { fixture } from '../fixtures/compatKit';
import {
  camoCapacity, exoticPath, familyOnAoc, inductionPlan, isExotic, lcInUse, leasingBill, lessorRating, quoteTerms, rfpPreview, sendRfp, signLoi, tightNow, tightWord, usesLoi,
} from '.';
import { acquireAircraft, eligibleTypes } from '../ops';
import { devMarketOffer } from '../dev';

const newGame = (seed = 3) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });

describe('v0.17 step 0: state and load', () => {
  it('a new game has the leasing state: base tightness for every type, empty lists, the AOC families', () => {
    const g = newGame();
    expect(g.leasing).toBeDefined();
    for (const t of ACMI_TYPES_LIST) expect(g.leasing!.tight[t.id]).toBe(BAL.v017.supply.base[t.id] ?? t.scarcity);
    expect(g.leasing!.rfps).toEqual([]);
    expect(g.leasing!.deals).toEqual([]);
    expect(g.company.aocFamilies).toEqual(['A320']);
    expect(g.company.aocVariations).toEqual([]);
  });

  it('a new game and a reloaded one serialise alike', () => {
    const g = newGame(4);
    advanceTo(g, g.now + 10 * DAY);
    const a = serialize(g);
    const state = (s: string) => JSON.stringify(JSON.parse(s).state);
    expect(state(serialize(deserialize(a)))).toBe(state(a));
  });

  it('an older save without leasing loads with the defaults and its fleet families on the AOC', () => {
    const g = deserialize(fixture('v0162-blu2003'));
    expect(g.leasing?.tight.a320ceo).toBe(BAL.v017.supply.base.a320ceo);
    const fams = new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family));
    expect(new Set(g.company.aocFamilies)).toEqual(fams);
    for (const f of fams) expect(familyOnAoc(g, f)).toBe(true);
  });
});

describe('v0.17 step 0: neutral', () => {
  it('the market weights are 1 − scarcity, the terms are the legacy ones, the handover is the legacy lead', () => {
    const g = newGame(5);
    for (const e of eligibleTypes(g)) expect(e.w).toBeCloseTo((1 - e.t.scarcity) * (e.teaser ? BAL.market7.teaserWeight : 1), 12);
    for (const t of ACMI_TYPES_LIST) expect(tightNow(g, t.id)).toBe(t.scarcity);
    const d = { offerId: 'mo1', typeId: 'a320ceo', kind: 'dryLeaseIn' as const, builtYear: 2012, newBuild: false, rentPerMonth: 210_000, reservesPerFH: 400, leaseMonths: 36, deposit: 420_000, price: 0 };
    expect(quoteTerms(g, d)).toEqual({ rentPerMonth: 210_000, reservesPerFH: 400, leaseMonths: 36, deposit: 420_000, price: 0 });
    const id = devMarketOffer(g, 'a320ceo');
    const o = g.market.aircraft.find((x) => x.id === id)!;
    expect(inductionPlan(g, o).ready).toBe(g.now + o.leadDays * DAY);
    expect(usesLoi(g, o)).toBe(false);
    expect(signLoi(g, id).ok).toBe(false);
    g.company.cash = 50_000_000;
    const r = acquireAircraft(g, id);
    expect(r.ok).toBe(true);
    const ac = g.fleet[(r as { data: { aircraftId: string } }).data.aircraftId];
    expect(ac.delivery?.handover).toBe(g.now + o.leadDays * DAY);
    expect(ac.induction).toBeUndefined();
  });

  it('nothing to ask, nothing billed, no letters of credit (the v0.16 market, --market=v16)', () => {
    const g = newGame(6);
    const on = BAL.v017.on;
    (BAL.v017 as { on: boolean }).on = false;
    try {
    expect(rfpPreview(g, { typeId: 'a320ceo', band: 'mid', months: 36, count: 1, from: null, flex: true }).blocked).toBeTruthy();
    expect(sendRfp(g, { typeId: 'a320ceo', band: 'mid', months: 36, count: 1, from: null, flex: true }).ok).toBe(false);
    expect(leasingBill(g, 0)).toBe(0);
    expect(lcInUse(g)).toBe(0);
    expect(camoCapacity(g)).toBe(1);
    } finally {
      (BAL.v017 as { on: boolean }).on = on;
    }
  });

  it('the transition cost is a cost line; the master switch is on', () => {
    expect(COST_CATS).toContain('transition');
    expect(BAL.v017.on).toBe(true);
  });
});

describe('v0.17 step 0: lessors, rating, exotic path', () => {
  it('every lessor of §B, legacy names map to ids', () => {
    expect(LESSOR_DEFS.map((l) => l.id)).toEqual(['aercap', 'smbc', 'avolon', 'alc', 'boc', 'cdb', 'acg', 'aircastle', 'carlyle', 'vallair', 'doric', 'amedeo', 'exop']);
    for (const n of ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'BOC Aviation', 'Carlyle Aviation Partners', 'Air Lease Corporation', 'Aviation Capital Group']) expect(lessorIdOf(n)).not.toBeNull();
    expect(lessorIdOf('AerCap (used sale)')).toBeNull();
    expect(lessorIdOf('Somebody')).toBeNull();
    for (const l of LESSOR_DEFS) for (const gr of ['A', 'B', 'C', 'D'] as const) expect(l.caps[gr].wide).toBeLessThanOrEqual(l.caps[gr].all);
  });

  it('a new game rates C (start-up), with its parts', () => {
    const g = newGame(7);
    const r = lessorRating(g);
    expect(r.grade).toBe('C');
    expect(r.score).toBeGreaterThanOrEqual(35);
    expect(r.score).toBeLessThan(55);
    expect(r.parts.length).toBeGreaterThan(3);
    expect(tightWord(0.2)).toBe('Easy');
    expect(tightWord(0.9)).toBe('Almost none');
  });

  it('exotic types have a path: who has them and what it takes', () => {
    const g = newGame(8);
    for (const t of BAL.v017.exotic.types) {
      expect(isExotic(t)).toBe(true);
      const p = exoticPath(g, t);
      expect(p.exotic).toBe(true);
      expect(p.sources.length).toBeGreaterThan(0);
      // 747 classics are sold only (no lease, no grade rule): bought with the cash.
      if (BAL.v017.exotic.classics.includes(t)) expect(p.steps.find((s) => s.key === 'cash')?.ok).toBe(true);
      else expect(p.steps.find((s) => s.key === 'grade')?.ok).toBe(false);
    }
    expect(exoticPath(g, 'a388').sources).toEqual(expect.arrayContaining(['doric', 'amedeo', 'exop']));
    expect(exoticPath(g, 'b744').sources).toContain('exop');
    expect(isExotic('a320ceo')).toBe(false);
  });
});
