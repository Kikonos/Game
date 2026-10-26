// Crew-planning round (26 Oct 2026): a ticket home is positioning, and positioning is duty (ORO.FTL.210: 60 h in any
// 7 days). The ticket home for crew left away (stranded, or before a leave) was timed after their rest and the 168 h
// recovery only. Bot seed 5: an FO sent home from Riyadh after six long days flew the 01:00 home, 65:31 of duty in 7 days.

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { DAY } from '../core/time';
import { evalSegs } from './rules';
import { sendStrandedHome } from './roster';
import { ctxOf, crewIx, segsOf, touchCrew } from './timeline';

const H = 60;

describe('a ticket home after a long week away', () => {
  it('waits at the hotel until it fits the 7-day duty limit', () => {
    const g = newGame(21);
    const c = Object.values(g.crew).find((x) => x.role === 'FO' && x.status === 'available' && x.loc === x.base)!;
    c.loc = 'MAD';
    c.standby = [];
    // Six 10-hour days away, one a day, the last ending 14 h ago: rested, but at 60 h of duty in the week.
    const s0 = g.now - 6 * DAY;
    c.log = Array.from({ length: 6 }, (_, i) => ({ start: s0 + i * DAY, end: s0 + i * DAY + 10 * H, fdp: 10 * H, block: 7 * H, sectors: 2, augmented: false, disruptive: false }));
    c.lastRecovery = s0;
    c.restUntil = c.log[5].end + 12 * H;
    touchCrew(g);
    sendStrandedHome(g);
    const t = (crewIx(g).tickets.get(c.id) ?? []).find((f) => f.status === 'scheduled' && f.to === c.base)!;
    expect(t).toBeDefined();
    const bad = evalSegs(ctxOf(g, c), segsOf(g, c)).filter((i) => i.level === 'illegal');
    expect(bad.map((i) => i.text)).toEqual([]);
    expect(t.std).toBeGreaterThan(g.now + 12 * H);
  });
});
