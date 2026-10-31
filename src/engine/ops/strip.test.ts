// v0.7.2 F1 crewAway (the hotel dots) and F8 opsStripFacts (the top bar's live strip).

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import { demoFlights } from '../dev';
import { crewAway } from '../crew';
import { newGame, run } from '../contracts/testkit';
import { opsStripFacts } from './strip';
import { touchCrewState } from '../crew/timeline';

describe('crewAway (F1)', () => {
  it('lists crew away from their base by airport until the last one leaves; joining crew are not counted', () => {
    const g = newGame(3);
    const [a, b, c] = Object.values(g.crew);
    a.loc = 'FUE';
    a.status = 'resting';
    b.loc = 'FUE';
    b.status = 'available';
    c.loc = 'FUE';
    c.status = 'joining';
    touchCrewState(g);
    let v = crewAway(g);
    expect(v.at.get('FUE')).toEqual([a.id, b.id]);
    expect(v.atHotels).toBe(2);
    a.loc = a.base;
    touchCrewState(g);
    v = crewAway(g);
    expect(v.at.get('FUE')).toEqual([b.id]);
    b.loc = b.base;
    touchCrewState(g);
    expect(crewAway(g).at.has('FUE')).toBe(false);
  });
});

describe('opsStripFacts (F8)', () => {
  it('counts airborne of the fleet, the next departure, on-time today and crew on duty / at hotels', () => {
    const g = newGame(5);
    demoFlights(g, undefined, 3, 'revenue');
    const t0 = opsStripFacts(g);
    expect(t0.fleet).toBe(Object.keys(g.fleet).length);
    expect(t0.onTime).toBeNull();
    const next = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId && f.kind !== 'deadhead' && f.std >= g.now).sort((x, y) => x.std - y.std || (x.id < y.id ? -1 : 1))[0];
    expect(t0.next?.flightId).toBe(next.id);
    // Run into the day until something is airborne and something has landed.
    let x = t0;
    for (let t = g.now; t < g.now + 2 * DAY; t += 30) {
      run(g, t);
      x = opsStripFacts(g);
      if (x.airborne > 0 && x.onTime) break;
    }
    expect(x.airborne).toBe(Object.values(g.fleet).filter((ac) => ac.status === 'flying' || (ac.flightId && g.flights[ac.flightId]?.status === 'enroute')).length);
    expect(x.airborne).toBeLessThanOrEqual(x.fleet);
    if (x.onTime) expect(x.onTime.onTime).toBeLessThanOrEqual(x.onTime.landed);
    const away = crewAway(g);
    expect(x.crewOnDuty).toBe(away.onDuty);
    expect(x.crewAtHotels).toBe(away.atHotels);
    expect(x.crewOnDuty).toBe(Object.values(g.crew).filter((c) => c.status === 'onDuty').length);
  });

  it('lists AOG aircraft', () => {
    const g = newGame(5);
    const ac = Object.values(g.fleet)[0];
    ac.status = 'aog';
    expect(opsStripFacts(g).aog).toEqual([{ aircraftId: ac.id, reg: ac.reg, at: ac.at }]);
  });
});

describe('v0.12.1 the strip reads the real times', () => {
  it('D9 a held leg is next at std + delay with its lateness; a leg moved and flown on the new time is not on time', () => {
    const g = newGame(5);
    demoFlights(g, undefined, 3, 'revenue');
    const legs = Object.values(g.flights).filter((f) => f.status === 'scheduled' && f.aircraftId && f.kind !== 'deadhead').sort((x, y) => x.std - y.std);
    const [a, b] = legs;
    g.now = a.std + 10;
    a.delay = 30;
    b.std = Math.max(b.std, g.now + 60);
    const x = opsStripFacts(g);
    expect(x.next?.flightId).toBe(a.id);
    expect(x.next?.dep).toBe(a.std + 30);
    expect(x.next?.late).toBe(30);
    // Flown on its moved time two hours behind schedule: late, not on time.
    a.status = 'done';
    a.schedStd = a.std - 120;
    a.atd = a.std + a.delay;
    a.ata = a.atd + a.block;
    g.now = a.ata + 1;
    const y = opsStripFacts(g);
    expect(y.onTime?.landed).toBeGreaterThanOrEqual(1);
    expect(y.onTime!.onTime).toBe(y.onTime!.landed - 1);
  });
});
