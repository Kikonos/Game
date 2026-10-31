// v0.14 a dry-leased-out aircraft's cosmetic legs for its lessee: deterministic, within range and runway, a quiet night.
import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { standardOffsetHours } from '../../data/timezones';
import { distanceNm } from '../../engine/core/geo';
import { blockMinutes, maxSectorNm, runwayFit } from '../../engine/core/perf';
import { DAY } from '../../engine/core/time';
import { SHOW_MAX_BLOCK, SHOW_MIN_BLOCK, showAt, showDay, showDestinations } from './dryShow';

const CASES: [string, string][] = [['a320ceo', 'LIM'], ['b738', 'LAD'], ['a332', 'JED'], ['a321ceo', 'DSS'], ['b744', 'LIS']];
const D0 = Math.floor(14663520 / DAY);

describe('v0.14 dry lease out on the map (cosmetic)', () => {
  it('is a pure function of aircraft, base, type and time: the same every call (no RNG)', () => {
    for (const [type, base] of CASES) {
      for (let d = D0; d < D0 + 10; d++) expect(showDay('a7', type, base, 'LP', d)).toEqual(showDay('a7', type, base, 'LP', d));
      const t = D0 * DAY + 13 * 60 + 17;
      expect(showAt('a7', type, base, 'LP', t)).toEqual(showAt('a7', type, base, 'LP', t));
    }
    // another aircraft at the same base flies another day
    const a = JSON.stringify([0, 1, 2, 3].map((i) => showDay('a7', 'a320ceo', 'LIM', 'LP', D0 + i)));
    const b = JSON.stringify([0, 1, 2, 3].map((i) => showDay('a9', 'a320ceo', 'LIM', 'LP', D0 + i)));
    expect(a).not.toBe(b);
  });

  it('flies only routes the type can fly both ways nonstop, with runways that fit, in 2–4 rotations a day', () => {
    for (const [type, base] of CASES) {
      const dests = showDestinations(type, base);
      expect(dests.length).toBeGreaterThan(2);
      for (const to of dests) {
        expect(runwayFit(type, to)).not.toBe('no');
        expect(distanceNm(base, to)).toBeLessThanOrEqual(maxSectorNm(type, base, to));
        expect(distanceNm(base, to)).toBeLessThanOrEqual(maxSectorNm(type, to, base));
        const b = blockMinutes(type, base, to);
        expect(b).toBeGreaterThanOrEqual(SHOW_MIN_BLOCK);
        expect(b).toBeLessThanOrEqual(SHOW_MAX_BLOCK);
        expect(AIRPORT_BY_CODE[to].enroute).toBeFalsy();
      }
      const A = AIRPORT_BY_CODE[base];
      const off = standardOffsetHours(A.code, A.country, A.lon) * 60;
      let flying = 0;
      for (let d = D0; d < D0 + 30; d++) {
        const legs = showDay('a7', type, base, 'XX', d);
        if (!legs.length) continue;
        flying++;
        expect(legs.length % 2).toBe(0);
        expect(legs.length / 2).toBeGreaterThanOrEqual(1);
        expect(legs.length / 2).toBeLessThanOrEqual(4);
        for (let i = 0; i < legs.length; i++) {
          const l = legs[i];
          expect(l.arr - l.dep).toBe(blockMinutes(type, l.from, l.to));
          if (i % 2 === 0) expect(l.from).toBe(base);
          else expect([l.to, l.from]).toEqual([base, legs[i - 1].to]);
          // turns on the ground between legs
          if (i) expect(l.dep - legs[i - 1].arr).toBeGreaterThanOrEqual(40);
          expect(l.no).toMatch(/^XX\d{4}$/);
        }
        // a quiet night: nothing before 06:00 or after 23:30 local
        const local = (m: number) => m + off - d * DAY;
        expect(local(legs[0].dep)).toBeGreaterThanOrEqual(6 * 60);
        expect(local(legs[legs.length - 1].arr)).toBeLessThanOrEqual(23 * 60 + 30);
      }
      expect(flying).toBeGreaterThan(24);
    }
    // most days have 2 or more rotations for a narrowbody on short sectors
    const rot = [...Array(30)].map((_, i) => showDay('a7', 'a320ceo', 'LIM', 'LP', D0 + i).length / 2);
    expect(rot.filter((n) => n >= 2).length).toBeGreaterThan(20);
  });

  it('is on the ground at base at night and in the air on a leg mid-sector', () => {
    const legs = showDay('a7', 'a320ceo', 'LIM', 'LP', D0 + 1);
    expect(legs.length).toBeGreaterThan(0);
    const mid = (legs[0].dep + legs[0].arr) / 2;
    const s = showAt('a7', 'a320ceo', 'LIM', 'LP', mid);
    expect('leg' in s && s.leg.to).toBe(legs[0].to);
    expect(showAt('a7', 'a320ceo', 'LIM', 'LP', legs[0].dep - 30)).toEqual({ at: 'LIM' });
    expect(showAt('a7', 'a320ceo', 'LIM', 'LP', legs[0].arr + 5)).toEqual({ at: legs[0].to });
  });

  it('stays parked where no route fits (no destinations)', () => {
    expect(showDay('a7', 'a320ceo', 'XXX', 'LP', D0)).toEqual([]);
    expect(showAt('a7', 'a320ceo', 'XXX', 'LP', D0 * DAY)).toEqual({ at: 'XXX' });
  });
});
