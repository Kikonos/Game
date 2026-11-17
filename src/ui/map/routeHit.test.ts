import { describe, expect, it } from 'vitest';
import { HIT_ROUTE, nearestLine, segDist2 } from './mapLogic';

describe('route line hits (flat map and globe)', () => {
  it('segDist2 measures to the segment, not the infinite line', () => {
    expect(segDist2(5, 3, 0, 0, 10, 0)).toBe(9);
    expect(segDist2(13, 4, 0, 0, 10, 0)).toBe(25);
  });
  it('a finger gets at least 24 px each side, a mouse less', () => {
    expect(HIT_ROUTE.touch).toBeGreaterThanOrEqual(24);
    expect(HIT_ROUTE.mouse).toBeLessThan(HIT_ROUTE.touch);
    const lines = [{ id: 'A', pts: [[0, 0], [100, 0]] as [number, number][] }];
    expect(nearestLine(lines, 50, 23, HIT_ROUTE.touch)).toBe('A');
    expect(nearestLine(lines, 50, 23, HIT_ROUTE.mouse)).toBeUndefined();
  });
  it('the nearest line wins', () => {
    const lines = [{ id: 'A', pts: [[0, 0], [100, 0]] as [number, number][] }, { id: 'B', pts: [[0, 10], [100, 10]] as [number, number][] }];
    expect(nearestLine(lines, 50, 7, 24)).toBe('B');
    expect(nearestLine(lines, 50, 2, 24)).toBe('A');
  });
  it('points behind the globe (null) cannot be hit', () => {
    const lines = [{ id: 'A', pts: [[0, 0], [50, 0], null, [150, 0]] as ([number, number] | null)[] }];
    expect(nearestLine(lines, 25, 5, 24)).toBe('A');
    expect(nearestLine(lines, 100, 0, 24)).toBeUndefined();
  });
});
