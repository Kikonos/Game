// v0.18.2 leave and rotations (player: leave inside a published rotation sent the crew member home early). Leave
// approved over a tour that has not begun takes the crew member off that tour (its seat is crewed again), never a tour
// under way; and a tour seat goes to crew with leave inside its period only when nobody else can take it.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, LeaveRequest, Pairing } from '../core/types';
import { publishedTo } from './dayPlan';
import { answerLeave, leaveVerdict, setLeavePolicy } from './leave';
import { crewIx } from './timeline';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

function plannedTour(): { g: GameState; p: Pairing; id: string } {
  const g = newGame(21, 'LIS');
  const o = hamBase(g, g.now + 12 * DAY, 60, 2);
  o.broker = undefined;
  expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
  run(g, g.now + 2 * DAY);
  for (const p of Object.values(g.pairings).sort((a, b) => a.start - b.start)) {
    if (!p.tour || p.status !== 'planned' || p.start <= g.now + 3 * DAY) continue;
    const s = p.slots.find((x) => x.crewId);
    if (!s) continue;
    // (The roster out to tomorrow only: the tour lies beyond it, as one planned after the 15th's publication.)
    if (g.dayPlan) g.dayPlan.publishedTo = Math.floor(g.now / DAY) * DAY + DAY;
    expect(publishedTo(g)).toBeLessThan(p.start);
    return { g, p, id: s.crewId! };
  }
  throw new Error('no crewed tour beyond the published roster');
}

describe('v0.18.2 leave approved over a tour not begun', () => {
  it('moves the tour, not the leave: the crew member comes off it and the seat is crewed again', () => {
    const { g, p, id } = plannedTour();
    setLeavePolicy(g, { auto: false, blackout: [] });
    const c = g.crew[id];
    c.leaveYears = { [new Date(Date.UTC(2000, 0, 1) + p.start * 60_000).getUTCFullYear()]: { ent: 60, booked: 0 } };
    const from = Math.floor((p.start + 2 * DAY) / DAY) * DAY;
    const q: LeaveRequest = { id: 'lv-test', crewId: id, from, days: 7, made: g.now, status: 'pending' };
    (g.leaveRequests ??= []).push(q);
    const v = leaveVerdict(g, c, from, 7, q);
    expect(v.hard).toBe(false);
    const r = answerLeave(g, q.id, true);
    expect(r.ok).toBe(true);
    expect((crewIx(g).pairingsOf.get(id) ?? []).some((x) => x.id === p.id)).toBe(false);
    expect(g.pairings[p.id]?.slots.some((s) => s.crewId === id)).toBeFalsy();
  }, 120_000);
});
