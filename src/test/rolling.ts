// v0.18.1 tests built on the rolling roster of before the monthly one (published 14 days ahead, crewed 14 days ahead):
// small hand-made crews whose seats and rests they check would otherwise also be planned onto trips weeks ahead.
import { afterAll, beforeAll } from 'vitest';
import { BAL } from '../engine/core/balance';

export function rollingRoster(): void {
  let was = true;
  beforeAll(() => {
    was = BAL.v09.roster.monthly;
    (BAL.v09.roster as { monthly: boolean }).monthly = false;
  });
  afterAll(() => {
    (BAL.v09.roster as { monthly: boolean }).monthly = was;
  });
}
