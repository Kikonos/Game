// Crew-planning round (26 Oct 2026): rest after a standby that was not called (CS FTL.1.225). Airport standby not
// leading to an FDP is followed by ORO.FTL.235 rest ((a)(1)), at least its own length (it counts in full as duty);
// standby at home or in suitable accommodation is followed by a rest period too ((b)(4)): 12 h at home base, 10 h away.
// Reserve is not duty (CS FTL.1.230): no rest after it. A called window ends at the report with no rest in between.
// The invariant checker reads the same rule (scripts/invariants.ts 'sby-rest'); the player's save's warnings were
// windows from before v0.10.2 / v0.11 (a call-out cut short, a ticket home 8 h after a hotel standby), now fixed.

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import type { CrewMember } from '../core/types';
import { evalSegs } from './rules';
import { ctxOf, posSeg, standbySeg, touchCrew } from './timeline';

const H = 60;

function fo(): { g: ReturnType<typeof newGame>; c: CrewMember } {
  const g = newGame(21);
  const c = Object.values(g.crew).find((x) => x.role === 'FO' && x.status === 'available')!;
  return { g, c };
}

describe('rest after an uncalled standby', () => {
  it('is 12 h at home, 10 h at a hotel away, an airport standby its length (12 h at least), none after reserve', () => {
    const { g, c } = fo();
    const t = g.now + 2 * 24 * H;
    expect(standbySeg(c, { from: t, to: t + 12 * H, kind: 'home', at: c.base }).rest).toBe(12 * H);
    expect(standbySeg(c, { from: t, to: t + 12 * H, kind: 'hotel', at: 'HAM' }).rest).toBe(10 * H);
    expect(standbySeg(c, { from: t, to: t + 4 * H, kind: 'airport', at: c.base }).rest).toBe(12 * H);
    expect(standbySeg(c, { from: t, to: t + 14 * H, kind: 'airport', at: c.base }).rest).toBe(14 * H);
    expect(standbySeg(c, { from: t, to: t + 24 * H, kind: 'reserve', at: c.base }).rest).toBe(0);
    // Called out: the window ends at the report, no rest in between.
    expect(standbySeg(c, { from: t, to: t + 12 * H, kind: 'hotel', at: 'HAM', calledAt: t + 3 * H }, t + 4 * H).rest).toBe(0);
  });

  it('a ticket 8 h after an uncalled hotel standby is refused; one 10 h after is legal', () => {
    const { g, c } = fo();
    c.loc = 'HAM';
    // A 10 h hotel standby that ended an hour ago, nobody called.
    const t = g.now - 11 * H;
    c.restUntil = t - 60;
    c.standby = [{ from: t, to: t + 10 * H, kind: 'hotel', at: 'HAM' }];
    touchCrew(g);
    const sby = standbySeg(c, c.standby[0]);
    const at = (gap: number) => {
      const std = t + 10 * H + gap + 60;
      return evalSegs(ctxOf(g, c), [sby, posSeg({ from: 'HAM', to: c.base, std, sta: std + 3 * H }, c, true)]).filter((i) => i.code === 'rest' && i.level === 'illegal');
    };
    expect(at(8 * H).length).toBe(1);
    expect(at(10 * H).length).toBe(0);
  });
});
