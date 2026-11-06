// v0.16.4 crew bug round (the player's bug reports of 5 Nov): #2 the rest plan of a two-leg duty (BLU2011 CMN–AMS
// empty, then BLU2003 AMS–MBJ) and the CREW SHORTAGE on BLU2004; #3 standby runs as a resignation reason and the
// card's wording; #4 four pilots on a 2-hour HX6001 SHA–HKG; and the alarm self-check.

import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/compatKit';
import { deserialize } from '../save';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { crewResignedCard } from '../problems/crew';
import { ALARM_HOOKS } from './control';
import { planAircraft } from './duties';
import { leaveWhy, repairStandbyMorale } from './morale';
import { restLegsNote, restPlanForFlight } from './restPlan';
import { checkAlarm, confirmAlarm, judgePerson, table2, takeSelfCheckRecords } from './selfCheck';
import { touchCrew } from './timeline';
import { fixtureGame as newGame } from './fixtures';

const snap02 = () => deserialize(fixture('v0162-blu2003'));
const snap04 = () => deserialize(fixture('v0162-hx6001'));
const flightNo = (g: GameState, no: string) => Object.values(g.flights).find((f) => f.no === no && f.status !== 'done' && f.status !== 'cancelled')!;

describe('#2 BLU2003: one duty, the same crew, rest on the long leg only', () => {
  it('the sheet says the empty leg is flown by the same crew, counts in the day, and the rest is on BLU2003', () => {
    const g = snap02();
    const f = flightNo(g, 'BLU2003');
    const plan = restPlanForFlight(g, f.id)!;
    expect(plan.ok).toBe(true);
    // Every rest turn is on BLU2003; BLU2011 is in the plan only because it is part of the duty.
    expect([...plan.pilots, ...plan.cabin].every((t) => t.flightId === f.id)).toBe(true);
    const note = restLegsNote(g, plan, f.dutyId!)!;
    expect(note).toContain('BLU2011 CMN–AMS (empty)');
    expect(note).toContain('same crew');
    expect(note).toMatch(/they rest on BLU2003 only/);
  });

  it('the CREW SHORTAGE on BLU2004 is real: the self-check confirms two empty pilot seats and no free fix', () => {
    const g = snap02();
    const f = flightNo(g, 'BLU2004');
    const v = checkAlarm(g, 'short', f.id, ALARM_HOOKS);
    expect(v.confirmed).toBe(true);
    expect(v.evidence.join(' ')).toMatch(/2 seats empty \(CPT, FO\)/);
  });
});

describe('#3 resignations: standby is no reason, plain words', () => {
  it('long standby runs no longer weigh on morale or show as a reason; the save repair gives the points back once', () => {
    const g = newGame();
    const c = Object.values(g.crew)[0];
    c.morale = 50;
    c.moraleWhy = { standby: -1.4, pay: -15.8 };
    expect(leaveWhy(c)).toBe('salaries paid late');
    repairStandbyMorale(g);
    expect(c.moraleWhy.standby).toBeUndefined();
    expect(c.morale).toBeCloseTo(51.4, 5);
    repairStandbyMorale(g);
    expect(c.morale).toBeCloseTo(51.4, 5);
  });

  it('the card names the person and the reason (no "They resigned")', () => {
    const g = newGame();
    const c = Object.values(g.crew).find((x) => x.role === 'CC')!;
    c.moraleWhy = { pay: -15.8, standby: -1.4 };
    c.notice = { given: g.now, leaves: g.now + 30 * DAY };
    const card = crewResignedCard(g, c.id)!;
    expect(card.why).toMatch(new RegExp(`^${c.first} resigned on .*: salaries paid late\\. Last day `));
    expect(card.why).not.toMatch(/They|standby/);
  });
});

describe('#4 HX6001: an empty leg into the station is not joined to the work when that needs extra pilots', () => {
  it('re-planned, TAS–HKG is a pilots-only trip and the HKG days fly with two pilots', () => {
    const g = snap04();
    // Before: TAS–HKG (6 h) + HKG–CJU–HKG in one 13:40 day with four pilots, carried on every later duty of the trip.
    expect(g.duties[flightNo(g, 'BLU2101').dutyId!].augment).toBe(2);
    for (const p of Object.values(g.pairings)) if (p.aircraftId === 'a1' && p.start > g.now) for (const s of p.slots) s.crewId = null;
    touchCrew(g);
    planAircraft(g, 'a1', g.now);
    const pos = flightNo(g, 'BLU2101');
    const d = g.duties[pos.dutyId!];
    expect(d.flightIds.map((id) => g.flights[id].kind)).toEqual(['positioning']);
    expect(d.augment).toBe(0);
    const hx = Object.values(g.flights).filter((f) => f.aircraftId === 'a1' && f.kind === 'revenue' && f.status === 'scheduled' && f.std < g.now + 10 * DAY);
    expect(hx.length).toBeGreaterThan(4);
    for (const f of hx) expect(g.duties[f.dutyId!].augment).toBe(0);
    const p = g.pairings[g.duties[flightNo(g, 'HX6001').dutyId!].pairingId];
    expect(p.slots.filter((s) => (s.role === 'CPT' || s.role === 'FO') && !s.above).length).toBe(2);
  });
});

describe('Alarm self-check', () => {
  it('Table 2 written out: 13:00 by day, 11:00 at night, 30 min less a sector from the third', () => {
    expect(table2(8 * 60, 2)).toBe(13 * 60);
    expect(table2(8 * 60, 4)).toBe(12 * 60);
    expect(table2(14 * 60, 1)).toBe(12 * 60 + 30);
    expect(table2(22 * 60, 2)).toBe(11 * 60);
    expect(table2(5 * 60 + 20, 2)).toBe(12 * 60 + 15);
  });

  it('a claim the independent reading refutes is withheld; a stale flight is withheld', () => {
    const g = snap02();
    // A full, legal crew on a later leg: an alarm claiming the captain is over the 7-day duty limit is refuted.
    const f = Object.values(g.flights).filter((x) => x.status === 'scheduled' && x.kind === 'revenue' && x.dutyId && x.std > g.now + DAY && ALARM_HOOKS.bad(g, x.id) === false).sort((a, b) => a.std - b.std)[0];
    const d = g.duties[f.dutyId!];
    const p = g.pairings[d.pairingId];
    const cpt = p.slots.find((s) => s.role === 'CPT' && s.crewId)!.crewId!;
    const r = judgePerson(g, g.crew[cpt], d, p);
    expect(r.values.duty7d![0]).toBeLessThan(60 * 60);
    const v = checkAlarm(g, 'hours', f.id, ALARM_HOOKS, [{ crewId: cpt, code: 'duty7d' }]);
    expect(v.confirmed).toBe(false);
    expect(v.why).toMatch(/refuted/);
    const done = Object.values(g.flights).find((x) => x.status === 'done' && x.dutyId)!;
    expect(checkAlarm(g, 'short', done.id, ALARM_HOOKS).confirmed).toBe(false);
  });

  it('counts confirmed and withheld, keeps the evidence on the flight, queues withheld ones for Bug reports; never touches the game', () => {
    const g = snap02();
    const before = JSON.stringify({ f: g.flights, d: g.duties, p: g.pairings, c: g.crew, seq: g.seq, rng: g.rng });
    const f = flightNo(g, 'BLU2004');
    expect(confirmAlarm(g, 'short', f, 'CREW SHORTAGE: BLU2004').confirmed).toBe(true);
    expect(f.crewChecked?.[0]).toMatch(/seats empty/);
    const done = Object.values(g.flights).find((x) => x.status === 'done' && x.dutyId)!;
    expect(confirmAlarm(g, 'short', done, 'CREW SHORTAGE: old').confirmed).toBe(false);
    expect(g.selfCheck).toMatchObject({ confirmed: 1, withheld: 1 });
    const recs = takeSelfCheckRecords(g);
    expect(recs.map((x) => x.title)).toEqual(['CREW SHORTAGE: old']);
    expect(takeSelfCheckRecords(g)).toEqual([]);
    delete f.crewChecked;
    expect(JSON.stringify({ f: g.flights, d: g.duties, p: g.pairings, c: g.crew, seq: g.seq, rng: g.rng })).toBe(before);
  });
});
