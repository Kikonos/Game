// v0.19.2 player report: the market study read '5-5 weeks' and '7-7 weeks'. One value when both ends are equal.

import { describe, expect, it } from 'vitest';
import { fmtSpan } from './time';

describe('fmtSpan', () => {
  it('shows one value when the ends are equal, a range only when they differ', () => {
    expect(fmtSpan(5, 5, 'weeks')).toBe('5 weeks');
    expect(fmtSpan(5, 7, 'weeks')).toBe('5–7 weeks');
    expect(fmtSpan(7, 5, 'weeks')).toBe('5–7 weeks');
    expect(fmtSpan(1, 1, 'weeks')).toBe('1 week');
    expect(fmtSpan(1, 2, 'weeks')).toBe('1–2 weeks');
    expect(fmtSpan(2, 3)).toBe('2–3');
    expect(fmtSpan(3, 3)).toBe('3');
  });
});
