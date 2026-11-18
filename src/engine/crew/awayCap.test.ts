// v0.25 r2 (crew-awaychain) no more time away from base than the rotation: crew already away go last for a tour or
// trip that keeps them away past it, and a ticket home held weeks ahead does not keep them idle at the hotel.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { Pairing } from '../core/types';
import { fixtureGame } from './fixtures';
import { awayTooLong } from './roster';
import { TOUR_STAGGER } from './duties';

const pairing = (over: Partial<Pairing>): Pairing => ({ id: 'px', aircraftId: null, contractId: null, deploymentId: 'dp1', start: 0, end: 0, dutyIds: [], slots: [], status: 'planned', legality: 'legal', ...over }) as Pairing;

describe('v0.25 r2 time away capped at the rotation', () => {
  const g = fixtureGame();
  const c = Object.values(g.crew)[0];
  const R = g.company.policies.rotationWeeks * 7 * DAY;
  const at = (loc: string, since: number | null) => {
    c.loc = loc;
    c.awaySince = since;
  };

  it('away 30 days: a tour to day 50 is refused; one ending inside the rotation, a guest seat, or someone at home are not', () => {
    at('OSL', g.now - 30 * DAY);
    const p = pairing({ start: g.now + DAY, end: g.now + 20 * DAY, tour: { set: 1, from: g.now + DAY, to: g.now + 20 * DAY } });
    expect(awayTooLong(g, c, p, [], g.now + DAY, g.now + 20 * DAY, false)).toBe(true);
    expect(awayTooLong(g, c, p, [], g.now + DAY, g.now + R - 30 * DAY + TOUR_STAGGER * DAY, false)).toBe(false);
    expect(awayTooLong(g, c, p, [], g.now + DAY, g.now + 20 * DAY, true)).toBe(false);
    at(c.base, null);
    expect(awayTooLong(g, c, p, [], g.now + DAY, g.now + 60 * DAY, false)).toBe(false);
  });

  it('a ticket home before the report starts a new stint (only the time from the ticket out counts)', () => {
    at('OSL', g.now - 30 * DAY);
    const p = pairing({ start: g.now + 3 * DAY, end: g.now + 30 * DAY });
    const home = { kind: 'pos', start: g.now + DAY, end: g.now + DAY + 240, at: c.base } as never;
    expect(awayTooLong(g, c, p, [home], g.now + 3 * DAY, g.now + 30 * DAY, false)).toBe(false);
    expect(awayTooLong(g, c, p, [], g.now + 3 * DAY, g.now + 30 * DAY, false)).toBe(true);
  });
});
