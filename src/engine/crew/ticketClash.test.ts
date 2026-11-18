// v0.25 crew tickets that overlap (bots seed 3 Madrid and seed 9): a ticket home landing 09:40 while the next ticket out
// of base left at 10:00, and a ticket back to the set landing 35 min before the ticket on to the next set. Two tickets in
// a row now need 1:15 from landing to the next check-in (TICKET_CONNECT), and a clash is mended per person.

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { addDeadhead } from '../core/entities';
import { DAY } from '../core/time';
import { fixtureGame } from './fixtures';
import { evalSegs } from './rules';
import { shiftOk, unclashTickets } from './roster';
import { crewIx, ctxOf, posSeg, touchCrew } from './timeline';

const ci = BAL.deadheadCheckIn;

describe('crew tickets in a row', () => {
  it('a ticket checking in 35 min after the last one lands is illegal', () => {
    const g = fixtureGame();
    const c = Object.values(g.crew)[0];
    c.loc = 'ATH';
    const t = Math.ceil((g.now + DAY) / 60) * 60;
    const a = posSeg({ from: 'ATH', to: 'AMS', std: t, sta: t + 200 }, c);
    const b = posSeg({ from: 'AMS', to: 'MAD', std: t + 200 + 35 + ci, sta: t + 200 + 35 + ci + 150 }, c);
    expect(evalSegs(ctxOf(g, c), [a, b]).some((i) => i.code === 'overlap' && i.level === 'illegal')).toBe(true);
    const b2 = posSeg({ from: 'AMS', to: 'MAD', std: t + 200 + 80 + ci, sta: t + 200 + 80 + ci + 150 }, c);
    expect(evalSegs(ctxOf(g, c), [a, b2]).some((i) => i.code === 'overlap')).toBe(false);
  });

  it('a ticket home landing after the next ticket out leaves: they fly straight from where they are', () => {
    const g = fixtureGame();
    const c = Object.values(g.crew)[0];
    c.loc = 'ATH';
    c.status = 'available';
    const t = Math.ceil((g.now + DAY) / 60) * 60;
    addDeadhead(g, { crewIds: [c.id], from: 'ATH', to: c.base, std: t, sta: t + 220, cost: 300 });
    addDeadhead(g, { crewIds: [c.id], from: c.base, to: 'NCE', std: t + 240, sta: t + 400, cost: 300 });
    touchCrew(g);
    expect(unclashTickets(g, [c.id])).toEqual([c.id]);
    const tk = (crewIx(g).tickets.get(c.id) ?? []).filter((f) => f.status === 'scheduled').sort((x, y) => x.std - y.std);
    expect(tk.map((f) => `${f.from}-${f.to}`)).toEqual(['ATH-NCE']);
    expect(tk[0].std).toBeGreaterThanOrEqual(t);
    expect(unclashTickets(g, [c.id])).toEqual([]);
  });

  it('a ticket home already checked in keeps them on it: the ticket on is bought again after the connection', () => {
    const g = fixtureGame();
    const c = Object.values(g.crew)[0];
    c.loc = 'ATH';
    c.status = 'available';
    const t = g.now + 30;
    addDeadhead(g, { crewIds: [c.id], from: 'ATH', to: c.base, std: t, sta: t + 220, cost: 300 });
    // (the ticket on leaves 13 h after landing: fine; moved to 10 min after landing, it is bought again)
    const b = addDeadhead(g, { crewIds: [c.id], from: c.base, to: 'NCE', std: t + 13 * 60, sta: t + 15 * 60, cost: 300 });
    touchCrew(g);
    expect(unclashTickets(g, [c.id])).toEqual([]);
    b.std = t + 230;
    b.sta = t + 400;
    touchCrew(g);
    expect(unclashTickets(g, [c.id])).toEqual([c.id]);
    const tk = (crewIx(g).tickets.get(c.id) ?? []).filter((f) => f.status === 'scheduled').sort((x, y) => x.std - y.std);
    expect(tk.map((f) => `${f.from}-${f.to}`)).toEqual([`ATH-${c.base}`, `${c.base}-NCE`]);
    for (let i = 1; i < tk.length; i++) expect(tk[i].std - ci).toBeGreaterThanOrEqual(tk[i - 1].sta + 75);
  });
});

// v0.25 core-1 (bot seed 11 from day 88): a tour grew by a day; one pilot's re-plan moved the set's shared ticket out three
// days earlier, which took a cabin crew member past her 168 h recovery rest and a captain 6 h after his standby. A shared
// ticket moves only when it moves legally for everyone on it (roster.ts shiftOk; else the one re-planned gets their own).
describe('a shared ticket out moves only when it is legal for everyone on it', () => {
  it('is refused when the earlier time cuts the rest after a standby, allowed when it does not', () => {
    const g = fixtureGame();
    const c = Object.values(g.crew)[0];
    c.loc = c.base;
    c.status = 'available';
    const t = Math.ceil(g.now / 60) * 60 + 20 * 60;
    c.standby = [{ from: t - 12 * 60, to: t, kind: 'home', at: c.base }];
    const f = addDeadhead(g, { crewIds: [c.id], from: c.base, to: 'NCE', std: t + 30 * 60, sta: t + 32 * 60, cost: 300 });
    // (the standby is over, not called)
    g.now = t + 30;
    touchCrew(g);
    expect(shiftOk(g, f, c.id, t + 6 * 60, t + 8 * 60)).toBe(false);
    expect(shiftOk(g, f, c.id, t + 20 * 60, t + 22 * 60)).toBe(true);
  });
});
