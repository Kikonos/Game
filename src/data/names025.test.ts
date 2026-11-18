// v0.25 larger crew name pools (MT, IT, RO, PL, GB, FR, SK, CV): about 20 each, no repeats, feminine forms aligned.
import { describe, expect, it } from 'vitest';
import { NAMES } from './names';
import { opsReasons } from '../engine/ops/flights';
import { fromUTC } from '../engine/core/time';

describe('crew name pools', () => {
  it('the grown pools have about 20 names each, none twice; feminine surnames line up', () => {
    for (const k of ['MT', 'IT', 'RO', 'PL', 'GB', 'FR', 'SK', 'CV']) {
      const kit = NAMES[k];
      for (const xs of [kit.f, kit.m, kit.last]) {
        expect(xs.length, k).toBeGreaterThanOrEqual(20);
        expect(new Set(xs).size, k).toBe(xs.length);
      }
      if (kit.lastF) expect(kit.lastF.length, k).toBe(kit.last.length);
    }
  });
});

describe('delay reasons by season and place (v0.25)', () => {
  it('de-icing and snow clearance only in winter at the northern bases; summer storms in summer', () => {
    expect(opsReasons('RIX', fromUTC(2027, 1, 10))).toContain('Weather: de-icing, queue at the pad');
    expect(opsReasons('RIX', fromUTC(2027, 9, 10))).not.toContain('Weather: de-icing, queue at the pad');
    expect(opsReasons('MLA', fromUTC(2027, 1, 10))).not.toContain('Weather: snow clearance');
    expect(opsReasons('MLA', fromUTC(2027, 7, 10))).toContain('Weather: thunderstorms on the route');
    expect(opsReasons('MLA', fromUTC(2027, 7, 10))).toContain('Wheelchair assistance late');
  });
});
