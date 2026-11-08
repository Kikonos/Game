// Bug reports of 8 Nov (second export, the player's save 'Blue Airlines' 24 Nov – 9 Dec 2028):
// #1 Carolina Almeida's annual leave planned at Manila (she should fly home to Lisbon first, and back if needed);
// #2 a 'Days off' morale hit with 8 days off of 7; #3 two captains on VN6000 (a far-base reserve flying along);
// #4 CP7040 MNL–KIX: CREW OUT OF HOURS 'the cabin crew cannot all rest in this cruise' on a plain day, again and again.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { ALARM_HOOKS } from './control';
import { checkAlarm } from './selfCheck';
import { crewAlertKind, outOfHours } from './outOfHours';
import { flightCrewStatus } from './roster';
import { restMarked } from './restMarks';
import { BAL } from '../core/balance';
import { DAY } from '../core/time';
import { dailyMorale, moraleOf } from './morale';
import { addCrew, fixtureGame } from './fixtures';

const snap04 = () => deserialize(fixture('v0182-cp7040'));
const snap01 = () => deserialize(fixture('v0182-leave'));

describe('#4 CP7040: a rest mark from an earlier duty of the tour', () => {
  it('on load the marks left by CP7020 (6 Dec) are gone: CP7040 is a plain day, no alarm, no hold', () => {
    const g = snap04();
    const f = g.flights.f3rxe;
    const d = g.duties[f.dutyId!];
    expect(d.augment).toBe(0);
    expect(g.pairings[d.pairingId].slots.some((s) => s.ooh?.limit === 'inflightRest')).toBe(false);
    expect(restMarked(g.pairings[d.pairingId], d)).toBe(false);
    expect(crewAlertKind(g, f.id)).toBe(null);
    expect(outOfHours(g, f.id)).toEqual([]);
    expect(flightCrewStatus(g, f.id).level).not.toBe('illegal');
  });

  it('a stale mark (as an older build left it) never speaks for a later duty, and the self-check refutes the claim', () => {
    const g = snap04();
    const f = g.flights.f3rxe;
    const d = g.duties[f.dutyId!];
    const p = g.pairings[d.pairingId];
    // The mark as v0.18.2 left it: no duty named, made on 6 Dec at CP7020's gate.
    for (const s of p.slots) if (s.crewId && (s.role === 'PUR' || s.role === 'CC')) s.ooh = { crewId: s.crewId, limit: 'inflightRest', over: 0, at: d.report - 3 * 24 * 60 };
    expect(restMarked(p, d)).toBe(false);
    expect(crewAlertKind(g, f.id)).toBe(null);
    // A mark that does name this (plain) duty is no claim either: the day needs no in-flight rest.
    for (const s of p.slots) if (s.ooh) s.ooh.dutyId = d.id;
    expect(restMarked(p, d)).toBe(false);
    const v = checkAlarm(g, 'hours', f.id, ALARM_HOOKS, p.slots.filter((s) => s.ooh).map((s) => ({ crewId: s.crewId!, code: 'inflightRest' })));
    expect(v.confirmed).toBe(false);
    expect(v.evidence.join(' ')).toMatch(/not an augmented day/);
  });
});

describe('#2 Carolina Almeida: a "Days off" debuff with 8 days off of 7', () => {
  it('on load the hit from a published day off moved is "Day off moved", and days off away weigh nothing', () => {
    const g = snap01();
    const c = g.crew.c32u5;
    // 9, 8, 8, 8, 9 days off in the months closed: never under the legal 7.
    expect(Object.values(c.offMonths ?? {}).every((n) => n >= 7)).toBe(true);
    expect(c.moraleWhy?.daysOff).toBeUndefined();
    expect(c.moraleWhy?.offAway).toBeUndefined();
    expect(c.moraleWhy?.offMoved).toBeLessThan(0);
    const labels = moraleOf(g, c.id).drivers.map((d) => d.label);
    expect(labels).not.toContain('Days off');
    expect(labels).not.toContain('Days off away');
    expect(labels).toContain('Day off moved');
  });

  it('a day off at the hotel is no driver; back from annual leave a lift that lasts months', () => {
    const g = fixtureGame();
    const c = g.crew[addCrew(g, { CC: 1 })[0]];
    c.awaySince = g.now - 5 * DAY;
    c.loc = 'HAM';
    c.morale = 60;
    dailyMorale(g);
    expect(c.moraleWhy?.offAway).toBeUndefined();
    // Two weeks of annual leave that ended yesterday.
    c.loc = c.base;
    c.awaySince = null;
    c.blocks = [{ from: g.now - 15 * DAY, to: g.now - DAY, why: 'leave', annual: true }];
    const m0 = c.morale;
    dailyMorale(g);
    expect(c.leaveBack).toBe(g.now - DAY);
    expect(c.morale - m0).toBeGreaterThanOrEqual(BAL.morale.leaveLift.back);
    expect(moraleOf(g, c.id).drivers.find((d) => d.key === 'leave')?.value).toBeGreaterThan(0);
    // Once per leave, and still lifting two months on (the glow), gone after the few months.
    const once = c.morale;
    dailyMorale(g);
    expect(c.morale - once).toBeLessThan(1);
    g.now += 60 * DAY;
    const why = { ...c.moraleWhy };
    dailyMorale(g);
    expect((c.moraleWhy?.leave ?? 0) - (why.leave ?? 0) * BAL.morale.whyDecay).toBeGreaterThan(0);
    g.now += 40 * DAY;
    c.moraleWhy = {};
    dailyMorale(g);
    expect(c.moraleWhy?.leave).toBeUndefined();
  });
});
