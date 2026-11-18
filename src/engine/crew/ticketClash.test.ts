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
import { crewIx, ctxOf, posSeg, segsOf, touchCrew } from './timeline';
import { acceptOffer } from '../contracts';
import { legsOffer, newGame } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { openDuties } from './check';

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

// v0.25 r3 (bot seed 3 MAD): a ticket out landing close to the report is part of its duty's seg, with no seg of its own,
// so shiftOk passed any move of it; a captain's re-plan moved the set's ticket out six days earlier and took the FO past
// his 168 h recovery rest. Moved away from the duty it is now checked as a ride of its own.
describe('a shared ticket out that is part of its duty', () => {
  it('is checked when it moves: refused into the rest after a standby', () => {
    const g = newGame(21);
    const ac = Object.values(g.fleet)[0];
    ac.at = 'PMI';
    const t0 = Math.ceil(g.now / DAY) * DAY;
    const r = acceptOffer(g, legsOffer(g, [['PMI', 'LIS', t0 + 6 * DAY + 10 * 60]]).id, [ac.id]);
    expect(r.ok).toBe(true);
    advanceTo(g, g.now + 1, new Set());
    const leg = Object.values(g.flights).find((f) => f.contractId === (r.ok ? r.data!.contractId : '') && f.kind === 'revenue')!;
    const q = g.pairings[g.duties[leg.dutyId!].pairingId];
    const qd = openDuties(g, q)[0];
    const c = Object.values(g.crew).find((x) => x.role === 'CPT' && x.status === 'available' && !Object.values(g.pairings).some((p) => p.slots.some((s) => s.crewId === x.id)))!;
    c.loc = c.base;
    c.restUntil = g.now - 60;
    c.off = [];
    const seat = q.slots.findIndex((s) => s.role === 'CPT');
    q.slots[seat].crewId = c.id;
    const t = addDeadhead(g, { crewIds: [c.id], from: c.base, to: 'PMI', std: qd.report - 4 * 60, sta: qd.report - 2 * 60, cost: 0 });
    qd.deadheadIds.push(t.id);
    // A home standby that ends the evening before the trip's day.
    const sbyEnd = qd.report - 18 * 60;
    c.standby = [{ from: sbyEnd - 12 * 60, to: sbyEnd, kind: 'home', at: c.base }];
    touchCrew(g);
    expect(segsOf(g, c).some((x) => x.kind === 'pos' && x.ticketId === t.id)).toBe(false);
    // Two hours after the standby ends: no rest. A day before the standby starts: fine.
    expect(shiftOk(g, t, c.id, sbyEnd + 2 * 60, sbyEnd + 4 * 60)).toBe(false);
    expect(shiftOk(g, t, c.id, sbyEnd - 36 * 60, sbyEnd - 34 * 60)).toBe(true);
  });
});
