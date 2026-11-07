// v0.17.2 player's report (bug bmw5r8e3ggrqs): "I still see a lot of crew deadheading home from long-term bases ... if
// they're still legal they should stay until their 5 weeks are up (5 weeks is what I set in the Company tab; if I set
// more or less it should be that number, or they return early because they are out of hours)."
// - The first tours follow the rotation set under Company: the sets' first changes a day apart (35–38 days at five
//   weeks), not spread over a week (35–42); a set added later serves one rotation from its first duty.
// - Annual leave planned inside a rotation moves to just after it, so the crew member stays the whole rotation; a leave
//   still weeks ahead no longer sends them home now.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, Pairing } from '../core/types';
import { leaveAfterTours, publishedTo } from './dayPlan';
import { TOUR_STAGGER, TOUR_TAIL } from './duties';
import { tourHolding } from './tours';

function base(weeks: 4 | 5 | 6, days = 120, seed = 21): { g: GameState; k: string } {
  const g = newGame(seed);
  g.company.policies.rotationWeeks = weeks;
  const ac = leased(g);
  const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days });
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  return { g, k: r.data!.contractId };
}

const tours = (g: GameState): Pairing[] => Object.values(g.pairings).filter((p) => !!p.tour && p.status !== 'broken');

describe('v0.17.2 rotations follow the length set under Company', () => {
  for (const weeks of [4, 5, 6] as const) {
    it(`${weeks} weeks: every tour is the rotation long (first ones at most ${TOUR_STAGGER} days more, the last up to the end)`, () => {
      const { g, k } = base(weeks);
      run(g, g.contracts[k].start + 75 * DAY);
      const R = weeks * 7 * DAY;
      const dep = Object.values(g.deployments).find((d) => d.contractId === k)!;
      expect(tours(g).length).toBeGreaterThan(2);
      for (const p of tours(g)) {
        const len = p.tour!.to - p.tour!.from;
        const last = Math.abs(p.tour!.to - dep.end) < DAY;
        expect(len, `set ${p.tour!.set}`).toBeLessThanOrEqual(R + (last ? TOUR_TAIL : TOUR_STAGGER * DAY));
        if (!last && p.tour!.from > dep.start) expect(len).toBe(R);
      }
      // The first changes a day apart.
      const a = dep.anchors!;
      for (let s = 1; s < Math.min(a.length, dep.sized ?? a.length); s++) expect(a[s] - a[s - 1]).toBeLessThanOrEqual(DAY);
    });
  }

  it('annual leave inside a rotation moves to just after it; the crew member stays on station meanwhile', () => {
    const { g, k } = base(5);
    run(g, g.contracts[k].start + 4 * DAY);
    const p = tours(g).find((q) => q.slots.some((s) => s.crewId) && q.tour!.to - g.now > 25 * DAY && q.tour!.from <= g.now)!;
    expect(p).toBeTruthy();
    const c = g.crew[p.slots.find((s) => s.crewId)!.crewId!];
    // Planned leave 10 days before the rotation ends, past the published roster.
    const from = p.tour!.to - 10 * DAY;
    expect(from).toBeGreaterThan(publishedTo(g));
    c.blocks = [...(c.blocks ?? []).filter((b) => b.why !== 'leave'), { from, to: from + 7 * DAY, why: 'leave', annual: true }];
    expect(leaveAfterTours(g)).toContain(c.id);
    const b = c.blocks!.find((x) => x.why === 'leave')!;
    expect(b.from).toBeGreaterThanOrEqual(p.tour!.to + DAY);
    expect(b.to - b.from).toBe(7 * DAY);
    expect(g.messages[0].title).toMatch(/leave moves after the rotation/);
  });

  it('leave already in the published roster stays; it sends them home only when two days off', () => {
    const { g, k } = base(5);
    run(g, g.contracts[k].start + 4 * DAY);
    const p = tours(g).find((q) => q.slots.some((s) => s.crewId) && q.tour!.to - g.now > 25 * DAY && q.tour!.from <= g.now)!;
    const c = g.crew[p.slots.find((s) => s.crewId)!.crewId!];
    if (c.loc !== 'DUB') return;
    const from = Math.min(publishedTo(g) - DAY, p.tour!.to - 2 * DAY);
    c.blocks = [...(c.blocks ?? []).filter((b) => b.why !== 'leave'), { from, to: from + 7 * DAY, why: 'leave', annual: true }];
    expect(leaveAfterTours(g)).not.toContain(c.id);
    if (from - g.now > 2 * DAY) expect(tourHolding(g, c)).not.toBeNull();
  });
});
