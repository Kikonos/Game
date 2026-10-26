// v0.12 Visual B: sky phases from the sun's real elevation; label thinning on the map; airline-leg silhouettes.
import { describe, expect, it } from 'vitest';
import { skyAt } from '../components/SkyArt';
import { skyPhase } from './sky';

/** Game minute of a UTC date (game minutes count from 1 Jan 2000 00:00 UTC). */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => (Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(2000, 0, 1)) / 60_000;

describe('sky phase', () => {
  it('reads day above +6°, night below −6°, dawn or dusk between by the sun rising or setting', () => {
    expect(skyPhase(30, true)).toBe('day');
    expect(skyPhase(6, false)).toBe('day');
    expect(skyPhase(5.9, true)).toBe('dawn');
    expect(skyPhase(5.9, false)).toBe('dusk');
    expect(skyPhase(-6, false)).toBe('dusk');
    expect(skyPhase(-6.1, true)).toBe('night');
    expect(skyPhase(-40, false)).toBe('night');
  });
  it('follows the local sun at an airport (Lisbon, 15 March 2027)', () => {
    expect(skyAt('LIS', at(2027, 3, 15, 13))).toBe('day');
    expect(skyAt('LIS', at(2027, 3, 15, 2))).toBe('night');
    expect(skyAt('LIS', at(2027, 3, 15, 6, 45))).toBe('dawn'); // sunrise ~07:10 UTC
    expect(skyAt('LIS', at(2027, 3, 15, 18, 55))).toBe('dusk'); // sunset ~18:40 UTC
  });
  it('is the local time, not UTC: noon UTC is night in Auckland and day in Lisbon', () => {
    expect(skyAt('AKL', at(2027, 3, 15, 12))).toBe('night');
    expect(skyAt('LIS', at(2027, 3, 15, 12))).toBe('day');
  });
});
