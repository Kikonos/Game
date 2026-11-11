// v0.22 final check: a negative percentage carries the same minus sign as a negative amount ("margin −21%" beside
// "−$2.74M", not "-21%"), and a rounding to zero is never "−0%".

import { describe, expect, it } from 'vitest';
import { money, moneyDelta, pct } from './format';

describe('pct and money read alike', () => {
  it('negative percentages use the true minus sign', () => {
    expect(pct(0.51)).toBe('51%');
    expect(pct(-0.21)).toBe('−21%');
    expect(pct(-0.216, 1)).toBe('−21.6%');
    expect(money(-2_740_000)).toBe('−$2.74M');
    expect(moneyDelta(2_740_000)).toBe('+$2.74M');
  });
  it('a value that rounds to zero has no sign', () => {
    expect(pct(-0.001)).toBe('0%');
    expect(pct(0)).toBe('0%');
  });
});
