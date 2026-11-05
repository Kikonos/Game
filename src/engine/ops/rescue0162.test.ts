import { describe, expect, it } from 'vitest';
import { rescueNeed, rescueStake } from './events';

describe('v0.16.2 rescue sizing', () => {
  it('covers the overdraft and the next month-end bill, rounded up', () => {
    expect(rescueNeed(-2_656_981, 3_230_000)).toBe(5_900_000);
    expect(rescueNeed(500_000, 3_000_000)).toBe(3_000_000);
  });
  it('a bigger cheque buys a bigger stake, 25–49 %', () => {
    expect(rescueStake(2_000_000)).toBe(25);
    expect(rescueStake(6_000_000)).toBe(49);
    expect(rescueStake(4_200_000)).toBe(35);
  });
});
