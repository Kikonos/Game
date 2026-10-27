// Crew-planning round (26 Oct 2026): a private jet's crew check in 30 min before wheels-up at the FBO, as the roster
// plans the ride; the landing logged them from an airline's hour before. Bot seed 3: a cabin crew member flown out by
// jet at 04:00 after six early duties (60 h recovery due, ORO.FTL.235(d)) had rested from 15:10 three days before. The
// plan read 60:20 of recovery; the log read 59:50, no recovery, and her 168 h ran to 193 h.

import { describe, expect, it } from 'vitest';
import { newGame, run } from '../contracts/testkit';
import { addDeadhead } from '../core/entities';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';

const H = 60;

describe('a private jet ride in the log', () => {
  it('starts at the FBO check-in, so the recovery before it counts as planned', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.role === 'CC' && x.status === 'available' && x.loc === x.base)!;
    const ci = BAL.crewControl.jet.checkInMin;
    expect(ci).toBeLessThan(BAL.deadheadCheckIn);
    const std = Math.ceil((g.now + 2 * H) / 60) * 60;
    // Six early duties (disruptive), the last ending exactly 60 h before the jet's check-in.
    const end = std - ci - 60 * H;
    c.log = Array.from({ length: 6 }, (_, i) => ({ start: end - (5 - i) * DAY - 6 * H, end: end - (5 - i) * DAY, fdp: 6 * H, block: 4 * H, sectors: 2, augmented: false, disruptive: true, early: true }));
    c.lastRecovery = c.log[0].start;
    c.restUntil = end + 12 * H;
    c.standby = [];
    const f = addDeadhead(g, { crewIds: [c.id], from: c.loc, to: 'MAD', std, sta: std + 80, cost: 0 });
    f.charter = { cls: 'light', model: 'Test jet', operator: 'Test', reg: 'X-TEST' } as NonNullable<typeof f.charter>;
    run(g, f.sta + 1);
    expect(c.loc).toBe('MAD');
    expect(c.log.at(-1)!.start).toBe(std - ci);
    expect(c.lastRecovery).toBe(std - ci);
  });
});
