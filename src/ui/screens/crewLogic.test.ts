import { describe, expect, it } from 'vitest';
import type { CalBlock, CalFlight } from '../../engine/crew';
import { DAY, HOUR } from '../../engine/core/time';
import { calAt, calKey, calLayer, calLegend, dutyType, pickCal } from './crewLogic';

const fl = (type: CalFlight['type']): CalFlight => ({ id: type, no: 'AW 1', from: 'LIS', to: 'OPO', std: 0, sta: 60, type });
const blk = (kind: CalBlock['kind'], start: number, end: number, flights?: CalFlight[]): CalBlock => ({ kind, start, end, label: kind, detail: '', flights });

describe('crew calendar strip', () => {
  it('types duties by their legs', () => {
    expect(dutyType({ flights: [fl('positioning'), fl('operating')] })).toBe('operating');
    expect(dutyType({ flights: [fl('ferry')] })).toBe('ferry');
    expect(dutyType({ flights: [fl('ferry'), fl('positioning')] })).toBe('positioning');
    expect(dutyType({ flights: [] })).toBe('operating');
    expect(calKey(blk('positioning', 0, 1))).toBe('ride');
    expect(calKey(blk('sick', 0, 1))).toBe('sick');
  });

  it('layers rest/off under status windows under work and travel', () => {
    expect(calLayer({ kind: 'off' })).toBe(0);
    expect(calLayer({ kind: 'duty' })).toBe(2);
    expect(calLayer({ kind: 'deadhead' })).toBe(2);
    expect(calLayer({ kind: 'joining' })).toBe(1);
  });

  it('lists legend keys in a fixed order, once each', () => {
    const b = [blk('off', 0, DAY), blk('duty', DAY, DAY + 8 * HOUR, [fl('ferry')]), blk('sick', 2 * DAY, 4 * DAY), blk('duty', 5 * DAY, 5 * DAY + HOUR, [fl('operating')]), blk('off', 6 * DAY, 7 * DAY)];
    expect(calLegend(b)).toEqual(['operating', 'ferry', 'sick', 'off']);
  });

  it('picks a narrow duty near the tap over the rest underneath, and work over a status window', () => {
    const ppm = 600 / (14 * DAY);
    const rest = blk('rest', 10 * HOUR, 30 * HOUR);
    const duty = blk('duty', 2 * HOUR, 10 * HOUR, [fl('operating')]);
    const sick = blk('sick', 2 * DAY, 3 * DAY);
    const dutyUnder = blk('duty', 2 * DAY + 2 * HOUR, 2 * DAY + 9 * HOUR, [fl('operating')]);
    const b = [duty, rest, sick, dutyUnder];
    expect(pickCal(b, 11 * HOUR, ppm)).toBe(duty); // 1 h ≈ 1.8 px off the duty end
    expect(pickCal(b, 20 * HOUR, ppm)).toBe(rest); // far from any work
    expect(pickCal(b, 2 * DAY + 4 * HOUR, ppm)).toBe(dutyUnder);
    expect(pickCal(b, 2 * DAY + 20 * HOUR, ppm)).toBe(sick);
    expect(pickCal(b, 10 * DAY, ppm)).toBeNull();
    expect(calAt(b, 2 * DAY + 3 * HOUR)).toBe(dutyUnder);
    expect(calAt(b, 2 * DAY + 12 * HOUR)).toBe(sick);
    expect(calAt(b, 12 * HOUR)).toBe(rest);
  });
});
