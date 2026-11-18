// v0.25 (k5t6, a weekly Helsinki–Palma series flown from Malta: 71 revenue block hours a season against 68 empty)
// between two trips from the same outstation the aircraft waits there unless the hop home and back costs less.

import { describe, expect, it } from 'vitest';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import { acceptOffer } from '.';
import { HOP_WAIT_MAX, homeHopPays, hopCosts } from './schedule';
import { legsOffer, newGame, owned } from './testkit';

describe('v0.25 weekly series: wait at the outstation or hop home, on cost', () => {
  it('a week at Helsinki costs less than flying Lisbon and back: the aircraft waits', () => {
    const g = newGame(7);
    const ac = owned(g);
    const c = hopCosts(g, ac.id, 'HEL', 6 * DAY)!;
    expect(c.hop).toBeGreaterThan(c.wait);
    expect(homeHopPays(g, ac.id, 'HEL', 6 * DAY)).toBe(false);
    // Longer than a week's series: home, where it can take other work.
    expect(homeHopPays(g, ac.id, 'HEL', HOP_WAIT_MAX + DAY)).toBe(true);
  });

  it('a weekly Helsinki–Palma series has no empty Helsinki–Lisbon–Helsinki between its trips', () => {
    const g = newGame(7);
    const ac = owned(g);
    for (const f of Object.values(g.flights)) if (f.aircraftId === ac.id) f.status = 'cancelled';
    const t = g.now + 5 * DAY;
    const o = legsOffer(g, [['HEL', 'PMI', t], ['PMI', 'HEL', t + 6 * 60], ['HEL', 'PMI', t + 7 * DAY], ['PMI', 'HEL', t + 7 * DAY + 6 * 60]], 150);
    const r = acceptOffer(g, o.id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    const legs = flightsOf(g, ac.id).filter((f) => f.status === 'scheduled').sort((a, b) => a.std - b.std);
    const between = legs.filter((f) => f.kind === 'positioning' && f.std > t && f.std < t + 7 * DAY);
    expect(between).toEqual([]);
    expect(legs[legs.length - 1].to).toBe(g.company.homeBase);
  });
});
