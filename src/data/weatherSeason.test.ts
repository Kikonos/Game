// v0.25 weather causes fit the season and the place (no snow at Riga in September, nor at Tenerife in July).
import { describe, expect, it } from 'vitest';
import { weatherCausesAt } from './opsData';
import { weatherAt } from '../engine/ops/disrupt';
import { fromUTC } from '../engine/core/time';

const SNOW = 'Snow on the runway being cleared';
const FOG = 'Fog below landing minimums';

describe('weather causes by season and latitude', () => {
  it('snow only from November to March, from 40° of latitude', () => {
    expect(weatherAt('RIX', fromUTC(2027, 9, 15))).not.toContain(SNOW);
    expect(weatherAt('RIX', fromUTC(2027, 1, 15))).toContain(SNOW);
    expect(weatherAt('TFS', fromUTC(2027, 7, 15))).not.toContain(SNOW);
    expect(weatherAt('TFS', fromUTC(2027, 1, 15))).not.toContain(SNOW);
  });
  it('fog in autumn and winter; the southern half of the world has its seasons the other way round', () => {
    expect(weatherCausesAt(50, 7)).not.toContain(FOG);
    expect(weatherCausesAt(50, 11)).toContain(FOG);
    expect(weatherCausesAt(-45, 7)).toContain(SNOW);
    expect(weatherCausesAt(-45, 1)).not.toContain(SNOW);
  });
  it('always something to pick', () => {
    for (let m = 1; m <= 12; m++) for (const lat of [-60, -30, 0, 30, 60]) expect(weatherCausesAt(lat, m).length).toBeGreaterThan(0);
  });
});
