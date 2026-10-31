// v0.12.1 core/curfew.ts: the strict curfew check the planners use, and the nearest allowed minute.

import { describe, expect, it } from 'vitest';
import { curfewEnd, curfewOk, curfewShift, inCurfew } from './curfew';
import { curfewEnd as dEnd, inCurfew as dIn } from '../ops/disrupt';
import { fromUTC } from './time';

describe('curfew helpers (v0.12.1)', () => {
  it('strict check: HAM 05:30 local is shut, 06:00 is open; FRA 04:15 local; LHR 04:50 UTC in winter', () => {
    // January: HAM and FRA on CET (UTC+1), LHR on GMT.
    expect(curfewOk('HAM', fromUTC(2028, 1, 12, 4, 30))).toBe(false);
    expect(curfewOk('HAM', fromUTC(2028, 1, 12, 5, 0))).toBe(true);
    expect(curfewOk('FRA', fromUTC(2028, 1, 12, 3, 15))).toBe(false);
    expect(curfewOk('LHR', fromUTC(2028, 1, 12, 4, 50))).toBe(false);
    expect(curfewOk('LIS', fromUTC(2028, 1, 12, 2, 0))).toBe(true);
    // The grace (HAM: delayed landings until 24:00) does not count for the strict check.
    const late = fromUTC(2028, 1, 12, 22, 30);
    expect(inCurfew('HAM', late, true)).toBe(false);
    expect(curfewOk('HAM', late)).toBe(false);
  });

  it('curfewShift: the first minute after, the last minute before, the same minute when open', () => {
    const t = fromUTC(2028, 1, 12, 4, 30); // HAM 05:30 CET
    expect(curfewShift('HAM', t, 'after')).toBe(fromUTC(2028, 1, 12, 5, 0)); // 06:00 local
    expect(curfewShift('HAM', t, 'before')).toBe(fromUTC(2028, 1, 11, 21, 59)); // 22:59 local the night before
    const open = fromUTC(2028, 1, 12, 12, 0);
    expect(curfewShift('HAM', open, 'after')).toBe(open);
    expect(curfewShift('LIS', t, 'before')).toBe(t);
  });

  it('curfewShift across the spring clock change lands on the edge', () => {
    // 26 Mar 2028: Hamburg goes from CET to CEST at 01:00 UTC; 00:30 UTC is 01:30 CET, inside the ban.
    const t = fromUTC(2028, 3, 26, 0, 30);
    const x = curfewShift('HAM', t, 'after');
    expect(x).toBe(fromUTC(2028, 3, 26, 4, 0)); // 06:00 CEST
    expect(curfewOk('HAM', x)).toBe(true);
    expect(curfewOk('HAM', x - 1)).toBe(false);
  });

  it('disrupt.ts re-exports the same helpers', () => {
    expect(dIn).toBe(inCurfew);
    expect(dEnd).toBe(curfewEnd);
  });
});
