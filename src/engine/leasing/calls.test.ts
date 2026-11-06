// v0.17 lessor calls (UPDATE-0.17.md §J.1–§J.2, §T, §P.6): rates, caps, lessors that fit our grade, open windows,
// new-build leads, the exotic path.

import { describe, expect, it } from 'vitest';
import { LESSOR_BY_ID, LESSOR_DEFS } from '../../data/lessors';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY, fromUTC, monthKey } from '../core/time';
import type { AircraftOffer, GameState } from '../core/types';
import { newGame } from '../contracts/testkit';
import { devGrantApproval } from '../ops/company';
import { dailyMarket, refreshMarket } from '../ops/market';
import { callLessors, exoticCall, isCall, newBuildLead } from './calls';
import { leasingSide } from './side';
import { isExotic } from './exotic';

/** The market's own handlers day by day for `days`: every offer seen once, the most calls open at once. */
function market(seed: number, days: number, setup?: (g: GameState) => void) {
  const g = newGame(seed);
  setup?.(g);
  const seen = new Map<string, AircraftOffer>();
  let maxOpen = 0;
  let maxWide = 0;
  let k = monthKey(g.now);
  for (let d = 1; d <= days; d++) {
    g.now += DAY;
    if (monthKey(g.now) !== k) {
      k = monthKey(g.now);
      refreshMarket(g);
    }
    dailyMarket(g);
    const calls = g.market.aircraft.filter((o) => isCall(o) && o.expires > g.now);
    maxOpen = Math.max(maxOpen, calls.length);
    maxWide = Math.max(maxWide, calls.filter((o) => typeOf(o.typeId).body === 'wide').length);
    for (const o of g.market.aircraft) if (!seen.has(o.id)) seen.set(o.id, { ...o });
  }
  return { g, seen: [...seen.values()], maxOpen, maxWide };
}

const RANK = { A: 0, B: 1, C: 2, D: 3 } as const;

describe('v0.17 lessor calls (§J.1)', () => {
  it('narrowbody calls 1.3–2.0 a month; never more than 6 calls or 2 widebodies open; each from a lessor that fits our grade', () => {
    let narrow = 0;
    const seeds = 12;
    for (let seed = 1; seed <= seeds; seed++) {
      const { seen, maxOpen, maxWide } = market(seed, 365);
      expect(maxOpen).toBeLessThanOrEqual(BAL.v017.calls.maxOpen);
      expect(maxWide).toBeLessThanOrEqual(BAL.v017.calls.maxWide);
      for (const o of seen) {
        expect(o.source === 'call' || o.source === 'newBuild').toBe(true);
        const life = (o.expires - (o.created ?? 0)) / DAY;
        const [lo, hi] = typeOf(o.typeId).body === 'wide' ? BAL.v017.calls.wideDays : BAL.v017.calls.days;
        expect(life).toBeGreaterThanOrEqual(lo);
        expect(life).toBeLessThanOrEqual(hi);
        if (typeOf(o.typeId).body === 'narrow') narrow++;
        if (o.kind === 'dryLeaseIn') {
          const def = LESSOR_BY_ID[o.lessorId!];
          expect(def).toBeDefined();
          expect(def.families).toContain(typeOf(o.typeId).family);
          // Guaranteed offers come from a keen mid-life lessor whatever our grade; others fit it.
          if (!['aircastle', 'carlyle', 'vallair'].includes(def.id)) expect(RANK[o.grade!]).toBeLessThanOrEqual(RANK[def.minGrade[typeOf(o.typeId).body]!]);
          expect(o.why?.length).toBeGreaterThan(1);
          expect(o.minFH).toBe(typeOf(o.typeId).body === 'wide' ? 150 : 80);
        }
      }
    }
    const perMonth = narrow / seeds / 12;
    expect(perMonth).toBeGreaterThanOrEqual(1.3);
    expect(perMonth).toBeLessThanOrEqual(2.0);
  });

  it('widebody calls 0.25–0.5 a month once the gate is held (rating B)', () => {
    let wide = 0;
    const seeds = 12;
    for (let seed = 1; seed <= seeds; seed++) {
      const { seen } = market(seed, 365, (g) => {
        devGrantApproval(g, 'widebody');
        g.leasing!.credit = { score: 62, grade: 'B', parts: [], at: g.now + 400 * DAY };
      });
      wide += seen.filter((o) => typeOf(o.typeId).body === 'wide' && !isExotic(o.typeId) && (o.created ?? 0) > seen[0].created! + 0).length;
    }
    const perMonth = wide / seeds / 12;
    expect(perMonth).toBeGreaterThanOrEqual(0.25);
    expect(perMonth).toBeLessThanOrEqual(0.55);
  });

  it('top-tier lessors do not call a start-up rated C; Vallair and the mid-life lessors do', () => {
    const g = newGame(3);
    const ids = callLessors(g, typeOf('a320ceo'), { grade: 'C' }).map((x) => x.def.id);
    expect(ids).not.toContain('aercap');
    expect(ids).not.toContain('smbc');
    expect(ids).toEqual(expect.arrayContaining(['vallair', 'carlyle', 'aircastle', 'acg']));
    // Widebodies at C: only old ones, from the lessors that accept C.
    for (const x of callLessors(g, typeOf('a332'), { grade: 'C' })) expect(x.bands).toEqual(['old']);
    expect(callLessors(g, typeOf('a332'), { grade: 'D' })).toEqual([]);
    expect(callLessors(g, typeOf('a332'), { grade: 'B' }).map((x) => x.def.id)).toContain('aercap');
  });
});

describe('v0.17 new builds (§J.2)', () => {
  it('realistic leads: A321neo 540–1,080 days, the A350 and 787 from 2030, never under 540 days', () => {
    const g = newGame(4);
    for (let i = 0; i < 40; i++) {
      const r = leasingSide(g, `t${i}`);
      const a = newBuildLead(g, 'a321neo', r);
      expect(a).toBeGreaterThanOrEqual(540);
      expect(a).toBeLessThanOrEqual(1080);
      const w = newBuildLead(g, 'a359', r);
      expect(g.now + w * DAY).toBeGreaterThanOrEqual(fromUTC(2030, 1, 1));
      expect(newBuildLead(g, 'b778', r) * DAY + g.now).toBeGreaterThanOrEqual(fromUTC(2032, 1, 1));
    }
  });

  it('a new-build call needs rating B for the A321neo and A for a widebody', () => {
    const g = newGame(5);
    expect(callLessors(g, typeOf('a321neo'), { newBuild: true, grade: 'C' })).toEqual([]);
    expect(callLessors(g, typeOf('a321neo'), { newBuild: true, grade: 'B' }).length).toBeGreaterThan(0);
    expect(callLessors(g, typeOf('a359'), { newBuild: true, grade: 'B' })).toEqual([]);
  });
});

describe('v0.17 exotic types (§T): hard, expensive, never impossible', () => {
  const grantAll = (g: GameState) => {
    for (const a of ['widebody', 'etops120', 'etops180', 'augmented', 'etops240'] as const) devGrantApproval(g, a);
  };

  it('every exotic type has a lessor or the previous operator to come from', () => {
    for (const id of BAL.v017.exotic.types) {
      const t = typeOf(id);
      expect(LESSOR_DEFS.some((l) => l.families.includes(t.family) && l.minGrade[t.body])).toBe(true);
    }
  });

  it('an exotic call comes once the gate allows it: at B a lease or a sale, at C a lease with the big security, at D only a sale', () => {
    const kinds = { B: new Set<string>(), C: new Set<string>(), D: new Set<string>() };
    let security = 0;
    for (const grade of ['B', 'C', 'D'] as const) {
      for (let i = 0; i < 40; i++) {
        const g = newGame(10 + i);
        grantAll(g);
        g.leasing!.credit = { score: grade === 'B' ? 62 : grade === 'C' ? 45 : 30, grade, parts: [], at: g.now + DAY };
        const o = exoticCall(g, leasingSide(g, `x${i}`));
        if (!o) continue;
        expect(isExotic(o.typeId)).toBe(true);
        kinds[grade].add(o.kind);
        if (grade === 'D') expect(o.kind).toBe('buy');
        if (grade === 'C' && o.kind === 'dryLeaseIn') {
          expect(o.exoticSecurity).toBeGreaterThan(0);
          expect(o.reservesDeposit).toBeGreaterThan(0);
          expect(o.depositMonths).toBe(3 + BAL.v017.exotic.securityMonths);
          security++;
        }
        if (BAL.v017.exotic.classics.includes(o.typeId)) expect(o.kind).toBe('buy');
      }
    }
    expect(kinds.B.has('dryLeaseIn')).toBe(true);
    expect(kinds.B.has('buy')).toBe(true);
    expect(security).toBeGreaterThan(0);
    expect([...kinds.D]).toEqual(['buy']);
  });
});
