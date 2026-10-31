// v0.12.1 a home standby planned inside the local nights owed at home after a trip across time zones
// (CS FTL.1.235(b)(3)) goes when the day plan runs (planStandby re-checks only the next 36 h; v0.7.2 save, 60 days on: an FO home from Nadi at 08:30 was on
// standby from 12:00 the next day, an illegal roster).

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame, owned, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import { fitTzStandby } from './dayPlan';
import { evalSegs } from './rules';
import { ctxOf, segsOf, touchCrewState } from './timeline';

describe('v0.12.1 standby after a trip across time zones', () => {
  it('a window inside the time-zone recovery nights at home goes; the roster is legal again', () => {
    const g = newGame(12);
    if (!g.company.approvals.includes('etops120')) g.company.approvals.push('etops120');
    const ac = owned(g);
    const t = g.now + 2 * DAY;
    const r = acceptOffer(g, legsOffer(g, [['LIS', 'DXB', t], ['DXB', 'LIS', t + DAY]]).id, [ac.id]);
    if (!r.ok) throw new Error(r.error);
    run(g, g.now + 60);
    const legs = Object.values(g.flights).filter((f) => f.contractId === r.data!.contractId && f.kind === 'revenue');
    const home = legs.reduce((a, b) => (b.sta > a.sta ? b : a));
    const crew = home.crewIds.map((id) => g.crew[id]).filter((c) => c.base === 'LIS');
    expect(crew.length).toBeGreaterThan(0);
    // A home standby the next day at 12:00 (a late shift), as planned before the trip took this shape.
    const from = Math.ceil(home.sta / DAY) * DAY + 12 * 60;
    for (const c of crew) c.standby = [...(c.standby ?? []), { from, to: from + 12 * 60, shift: 'L' as const }];
    touchCrewState(g);
    const tz = (id: string) => evalSegs(ctxOf(g, g.crew[id]), segsOf(g, g.crew[id])).filter((i) => i.code === 'tzRest' && i.level === 'illegal');
    expect(crew.some((c) => tz(c.id).length)).toBe(true);
    fitTzStandby(g);
    for (const c of crew) {
      expect(tz(c.id)).toEqual([]);
      expect((c.standby ?? []).some((w) => w.from === from && w.calledAt === undefined && w.kind !== 'reserve')).toBe(false);
    }
  });
});
