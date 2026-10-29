// v0.12 player screenshot: the offer card said "180 seats: the client needs 280+" (an A320) while WHAT YOU CAN DO
// offered to sub-lease the A330's trips. Among aircraft that can't take a job, one only busy comes first.
import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { addAircraft, legsOffer, newGame } from '../contracts/testkit';
import { DAY, HOUR, dayStart } from '../core/time';
import { offerFitCard } from './commercial';

describe('v0.12 offer fit card: the aircraft it speaks of', () => {
  it('a busy aircraft that fits the job beats one that is too small', () => {
    const g = newGame();
    g.company.approvals.push('widebody');
    const wide = addAircraft(g, 'a332');
    const t = dayStart(g.now) + 12 * DAY + 8 * HOUR;
    // Keep the A330 busy on the job's days, then offer a 280-seat job the A320s can never fly.
    const busy = legsOffer(g, [['LIS', 'FAO', t], ['FAO', 'LIS', t + 3 * HOUR]], 150);
    const res = acceptOffer(g, busy.id, [wide.id]);
    expect(res.ok, res.ok ? '' : res.error).toBe(true);
    const big = legsOffer(g, [['LIS', 'FAO', t + 30], ['FAO', 'LIS', t + 3 * HOUR + 30]], 280);
    const card = offerFitCard(g, big.id);
    expect(card).not.toBeNull();
    expect(card!.why).not.toMatch(/seats/);
    expect(card!.why).toMatch(new RegExp(wide.reg));
  });
});
