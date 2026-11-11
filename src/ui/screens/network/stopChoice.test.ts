// v0.22 final check: in Build your own route, a stop added to a pair the aircraft reaches nonstop (Lisbon–Los Angeles
// on an A330 with New York as "Fuel stop only") showed the side-by-side with "Nonstop" marked "Chosen" although the
// route built lands at New York. The comparison now carries the fuel stop as its own way when the aircraft also
// reaches nonstop, the card marks the way the route really has, and the adviser says when the landing is not needed.

import { describe, expect, it } from 'vitest';
import { BAL } from '../../../engine/core/balance';
import { DAY } from '../../../engine/core/time';
import type { GameState } from '../../../engine/core/types';
import { devAddType } from '../../../engine/dev';
import { createGame } from '../../../engine/newGame';
import { hireHead, unlockHead } from '../../../engine/ops/heads';
import { caseAdvice, caseDraft, marketOfRoute, setStop, startStudy, stopoverCompare, studyBase } from '../../../engine/network';
import { stopMin } from '../../../engine/network/model';
import { typeOf } from '../../../engine/core/perf';
import { countryNameThe } from '../../../data/countries';
import { stopChosen } from './networkLogic';

const newGame = (seed = 5) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
function atCase(g: GameState, id: string): string {
  const res = startStudy(g, id, 'full');
  const r = g.network!.routes[res.routeId!];
  r.study!.truth = 1;
  r.status = 'case';
  const base = studyBase(g, r);
  r.study!.est = { p10: Math.round(base * 0.85), p50: Math.round(base), p90: Math.round(base * 1.15) };
  r.study!.done = g.now;
  r.study!.validUntil = g.now + BAL.v019.launch.validDays * DAY;
  const cs = r.stages.find((s) => s.id === 'case')!;
  cs.state = 'waiting';
  cs.start = g.now;
  return r.id;
}

describe('country names inside a sentence', () => {
  it('"inside the United States", "the Netherlands", plain "Portugal"', () => {
    expect(countryNameThe('US')).toBe('the United States');
    expect(countryNameThe('GB')).toBe('the United Kingdom');
    expect(countryNameThe('AE')).toBe('the United Arab Emirates');
    expect(countryNameThe('NL')).toBe('the Netherlands');
    expect(countryNameThe('DO')).toBe('the Dominican Republic');
    expect(countryNameThe('PT')).toBe('Portugal');
    expect(countryNameThe('BR')).toBe('Brazil');
    const g = newGame(8);
    expect(stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a320ceo')!.odds.why).toContain('inside the United States (cabotage)');
  });
});

describe('the stop comparison names the way the route really flies', () => {
  it('an aircraft that reaches nonstop: nonstop, the fuel stop and the stopover are three ways; the fuel stop costs a landing', () => {
    const g = newGame(8);
    devAddType(g, 'a332');
    const c = stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a332')!;
    expect(c.plain.mode).toBe('nonstop');
    expect(c.fuel).not.toBeNull();
    expect(c.fuel!.mode).toBe('fuel');
    expect(c.fuel!.label).toBe('Fuel stop only');
    expect(c.fuel!.hours).toBeGreaterThan(c.plain.hours);
    expect(c.fuel!.result).toBeLessThan(c.plain.result);
    // The route built with the stop is the fuel stop, not "Nonstop"; with seats sold there, the stopover.
    expect(stopChosen(c, false)).toBe('fuel');
    expect(stopChosen(c, true)).toBe('stopover');
  }, 120_000);

  it('a stopover takes longer on the ground than a fuel stop, on every type', () => {
    for (const t of ['a320ceo', 'a321ceo', 'b763', 'a332', 'a333', 'a343', 'b77w']) {
      if (!typeOf(t)) continue;
      expect(stopMin({ stopover: { at: 'JFK' } as never }, t)).toBeGreaterThanOrEqual(stopMin({}, t) + 10);
    }
    const g = newGame(8);
    const c = stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a320ceo')!;
    expect(c.stopover.hours).toBeGreaterThan(c.plain.hours);
  }, 120_000);

  it('switching the stop back and forth never drifts the study: the same shape gives the same numbers', () => {
    const g = newGame(7);
    devAddType(g, 'a332');
    const rid = atCase(g, 'X:LIS-LAX@JFK');
    const r = g.network!.routes[rid];
    const est0 = { ...r.study!.est! };
    const seen: Record<string, string> = {};
    const key = () => JSON.stringify(r.study!.est);
    for (let i = 0; i < 6; i++) {
      for (const mode of ['nonstop', 'stopover', 'fuel', 'stopover', 'nonstop', 'fuel'] as const) {
        expect(setStop(g, rid, mode, 'JFK')).toBeNull();
        // Each shape reads the same every time it is chosen.
        if (seen[r.marketId]) expect(key()).toBe(seen[r.marketId]);
        seen[r.marketId] = key();
      }
      expect(setStop(g, rid, 'stopover', 'JFK')).toBeNull();
      expect(r.study!.est).toEqual(est0);
      expect(r.study!.ref).toBeUndefined();
    }
    expect(Object.keys(seen).sort()).toEqual(['X:LIS-LAX', 'X:LIS-LAX@JFK', 'X:LIS-LAX~JFK']);
  }, 120_000);

  it('an aircraft that needs the stop: two ways as before, the fuel stop is the plain one', () => {
    const g = newGame(8);
    const c = stopoverCompare(g, 'LIS', 'LAX', 'JFK', 'a320ceo')!;
    expect(c.plain.mode).toBe('fuel');
    expect(c.fuel).toBeNull();
    expect(stopChosen(c, false)).toBe('plain');
    expect(stopChosen(c, true)).toBe('stopover');
  }, 120_000);

  it('at the business case of a route with a fuel stop it does not need, the adviser says to fly it nonstop; one step does it', () => {
    const g = newGame(9);
    devAddType(g, 'a332');
    const rid = atCase(g, 'X:LIS-LAX@JFK');
    expect(setStop(g, rid, 'fuel')).toBeNull();
    const r = g.network!.routes[rid];
    expect(marketOfRoute(r)!.via).toEqual(['JFK']);
    unlockHead(g, 'analyst', true);
    hireHead(g, 'analyst', 2);
    const d = { ...caseDraft(g, rid)!, typeId: 'a332' };
    const stop = caseAdvice(g, rid, d).list.filter((x) => x.key === 'stop');
    const direct = stop.find((x) => x.stop?.mode === 'nonstop');
    expect(direct).toBeDefined();
    expect(direct!.title).toBe('Fly it nonstop');
    expect(direct!.gain).toBeGreaterThan(15_000);
    expect(setStop(g, rid, 'nonstop')).toBeNull();
    expect(marketOfRoute(r)!.via ?? []).toEqual([]);
    // Nonstop now: nothing more to say about a stop it no longer has.
    expect(caseAdvice(g, rid, { ...caseDraft(g, rid)!, typeId: 'a332' }).list.some((x) => x.stop?.mode === 'nonstop')).toBe(false);
  }, 120_000);
});
