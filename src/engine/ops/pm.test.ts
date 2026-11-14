// v0.24 the fleet's preventive maintenance programme (ops/pm.ts): levels, the ramp, fewer AOGs and defects, the cost
// on the maintenance line, old saves at 'low' (the game as before).

import { afterEach, describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { chance } from '../core/rng';
import { DAY } from '../core/time';
import type { Contract, GameState, LedgerCat, PmLevel } from '../core/types';
import { acceptOffer } from '../contracts';
import { hamBase, newGame, owned, run } from '../contracts/testkit';
import { techReliability } from '../core/techLog';
import { deserialize, serialize } from '../save';
import { legCostEstimate } from './flights';
import { aogChance } from './maintenance';
import { pmFactors, pmLevel, pmProgress, pmQuote, setPmLevel } from './pm';
import { ageF } from './util';

const bal = BAL as unknown as Record<string, number>;
const saved = { aogBase: bal.aogBase, techDelayChance: bal.techDelayChance };
afterEach(() => Object.assign(bal, saved));

const line = (g: GameState, cat: LedgerCat) => [g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);
const clone = (g: GameState) => deserialize(serialize(g));
/** The level's change as if made a ramp ago (its effect in full). */
const ramped = (g: GameState) => {
  if (g.company.pm) g.company.pm.since = g.now - BAL.pm.rampDays * DAY;
};

describe('v0.24 preventive maintenance programme', () => {
  it('a new game and an old save are at Low: every factor 1, no fee', () => {
    const g = newGame(3);
    expect(pmLevel(g)).toBe('low');
    expect(pmFactors(g)).toEqual({ delay: 1, aog: 1, deferred: 1 });
    expect(pmQuote(g, 'low').monthly).toBe(0);
    const old = clone(g);
    delete old.company.pm;
    const back = clone(old);
    expect(pmLevel(back)).toBe('low');
    expect(back.company.pm).toBeUndefined();
  });

  it('the effect builds over the ramp (not at once); the level survives a save', () => {
    const g = newGame(3);
    expect(setPmLevel(g, 'high').ok).toBe(true);
    expect(pmProgress(g)).toBe(0);
    expect(pmFactors(g).aog).toBe(1);
    run(g, g.now + Math.round((BAL.pm.rampDays / 2) * DAY));
    const half = pmFactors(g);
    expect(half.aog).toBeLessThan(1);
    expect(half.aog).toBeGreaterThan(BAL.pm.aogX.high);
    run(g, g.now + BAL.pm.rampDays * DAY);
    expect(pmFactors(g)).toEqual({ delay: BAL.pm.delayX.high, aog: BAL.pm.aogX.high, deferred: BAL.pm.deferredX.high });
    const back = clone(g);
    expect(pmLevel(back)).toBe('high');
    expect(pmFactors(back).aog).toBe(BAL.pm.aogX.high);
    // Back down: the factors return over the ramp too.
    expect(setPmLevel(g, 'low').ok).toBe(true);
    expect(pmFactors(g).aog).toBe(BAL.pm.aogX.high);
  });

  it('a change mid-ramp starts from the factors in force: no jump either way, and a Low/High toggle does not buy High for free', () => {
    const g = newGame(3);
    setPmLevel(g, 'high');
    g.now += 23 * DAY;
    const mid = pmFactors(g);
    expect(mid.aog).toBeGreaterThan(BAL.pm.aogX.high);
    expect(mid.aog).toBeLessThan(1);
    // High → Low half way: the factors stay where they were (not High's full 0.45), then drift back to Low.
    setPmLevel(g, 'low');
    expect(pmFactors(g)).toEqual(mid);
    g.now += 10 * DAY;
    const later = pmFactors(g);
    expect(later.aog).toBeGreaterThan(mid.aog);
    // Back to High before that ramp is half done: no snap to High in full either.
    setPmLevel(g, 'high');
    expect(pmFactors(g)).toEqual(later);
    expect(pmProgress(g)).toBe(0);
    // The level survives a save with its starting point.
    expect(pmFactors(clone(g))).toEqual(later);
    // The toggle the review found: High in full, then Low 22 days / High 1 day, over 92 days.
    const t = newGame(3);
    setPmLevel(t, 'high');
    ramped(t);
    let sum = 0;
    let n = 0;
    for (let cycle = 0; cycle < 4; cycle++) {
      setPmLevel(t, 'low');
      for (let d = 0; d < 22; d++, n++) {
        t.now += DAY;
        sum += pmFactors(t).aog;
      }
      setPmLevel(t, 'high');
      t.now += DAY;
      sum += pmFactors(t).aog;
      n++;
    }
    // Mostly at Low: the average AOG factor ends up worse than Medium's (it was 0.58 before the fix).
    expect(sum / n).toBeGreaterThan(BAL.pm.aogX.medium);
    // Settles in full after a ramp.
    run(g, g.now + BAL.pm.rampDays * DAY + DAY);
    expect(pmProgress(g)).toBe(1);
    expect(pmFactors(g)).toEqual({ delay: BAL.pm.delayX.high, aog: BAL.pm.aogX.high, deferred: BAL.pm.deferredX.high });
  });

  it('AOGs per departure fall with the level over a seeded sample', () => {
    const counts: Record<PmLevel, number> = { low: 0, medium: 0, high: 0 };
    for (const level of ['low', 'medium', 'high'] as PmLevel[]) {
      const g = newGame(11);
      setPmLevel(g, level);
      ramped(g);
      const ac = owned(g);
      // Many departures from a far outstation with deferred defects: the same seed for every level.
      const a = { ...ac, maint: { ...ac.maint, deferred: 0.3 } };
      const p = aogChance(g, a, 'TFS') * 40;
      const h = { rng: g.rng };
      for (let i = 0; i < 20_000; i++) if (chance(h, p)) counts[level]++;
    }
    expect(counts.low).toBeGreaterThan(200);
    expect(counts.medium).toBeLessThan(counts.low * 0.8);
    expect(counts.high).toBeLessThan(counts.low * 0.55);
    expect(counts.high).toBeLessThan(counts.medium);
  });

  it('fewer defects deferred per flight and fewer technical delays (the record a reliability approval reads)', () => {
    const exp = (level: PmLevel) => {
      const g = newGame(5);
      setPmLevel(g, level);
      ramped(g);
      const ac = owned(g);
      // Expected technical failures per departure: defects at the gate (most > 15 min) plus AOGs (several legs each).
      return BAL.techDelayChance * ageF(g, ac) * pmFactors(g).delay * 0.78 + aogChance(g, ac, g.company.homeBase) * 3;
    };
    const lo = exp('low');
    const hi = exp('high');
    expect(hi).toBeLessThan(lo * 0.55);
    // An 18-year-old A320 fleet on the minimum programme runs about 98.5–99 %; High takes it past 99 %.
    expect(1 - hi).toBeGreaterThan(0.99);
  });

  it('the cost posts on the maintenance line: a monthly fee per aircraft (daily) and more per block hour', () => {
    const lo = newGame(3);
    const hi = clone(lo);
    setPmLevel(hi, 'high');
    const m0 = line(hi, 'maintenance');
    run(lo, lo.now + 3 * DAY);
    run(hi, hi.now + 3 * DAY);
    const n = Object.values(hi.fleet).filter((a) => a.status !== 'delivering' && a.status !== 'stored' && a.status !== 'leasedOut').length;
    const fee = (line(hi, 'maintenance') - m0) - (line(lo, 'maintenance') - m0);
    // Three days of fees (narrowbodies), within rounding.
    expect(-fee).toBeGreaterThan(n * BAL.pm.fee.high[0] * (3 / 30.44) * 0.9);
    expect(-fee).toBeLessThan(n * BAL.pm.fee.high[0] * (4 / 30.44) * 1.1);
    // Per block hour: the leg's maintenance estimate grows by costX of the type's maintBH.
    const ac = owned(hi);
    const f = { block: 180, kind: 'revenue', sched: undefined } as unknown as Parameters<typeof legCostEstimate>[1];
    const a = legCostEstimate(lo, f, ac, 180).maint;
    const b = legCostEstimate(hi, f, ac, 180).maint;
    expect(b / a).toBeCloseTo(1 + BAL.pm.costX.high, 6);
    // The quote: high costs more than medium, medium more than low.
    expect(pmQuote(hi, 'high').fees).toBeGreaterThan(pmQuote(hi, 'medium').fees);
    expect(pmQuote(hi, 'medium').monthly).toBeGreaterThan(0);
  });

  it('a season base flown at High: more on maintenance, no more technical failures than at Low', () => {
    // Turn the dice up so a short base shows the difference on one seed.
    Object.assign(bal, { aogBase: saved.aogBase * 15, techDelayChance: saved.techDelayChance * 8 });
    const out: Record<string, { fails: number; deps: number; maint: number }> = {};
    for (const level of ['low', 'high'] as PmLevel[]) {
      const g = newGame(4);
      setPmLevel(g, level);
      ramped(g);
      const ac = owned(g);
      const r = acceptOffer(g, hamBase(g, g.now + 2 * DAY, 45, 3).id, [ac.id]);
      if (!r.ok) throw new Error(r.error);
      const c: Contract = g.contracts[r.data!.contractId];
      run(g, c.end + DAY);
      const t = techReliability(g, 90);
      out[level] = { fails: t.fails, deps: t.deps, maint: -line(g, 'maintenance') };
    }
    expect(out.low.deps).toBeGreaterThan(80);
    expect(out.high.maint).toBeGreaterThan(out.low.maint);
    expect(out.high.fails).toBeLessThanOrEqual(out.low.fails);
  }, 120_000);
});
