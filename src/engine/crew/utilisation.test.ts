// v0.18.2 crew utilisation: crew sized by the flying, deployments re-sized on their programme, the Utilisation figures,
// the hold on hiring, and the actions for a surplus (unpaid leave, redundancy).

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import { resizeDeployments, periodOf } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { crewPlan, setsForHome, setsForStation } from './sets';
import { crewUtilisation, heldHires, hireHold, makeRedundant, offerUnpaidLeave, redundancyQuote, REDUNDANCY, unpaidQuote, UTIL_TYPICAL } from './utilisation';
import { rollingRoster } from '../../test/rolling';

rollingRoster();

describe('v0.18.2 crew sized by the flying', () => {
  it('a deployment keeps its sets on station plus one in five (no longer at least 5); an aircraft at home by its duties and hours', () => {
    expect([2, 3, 4, 5].map(setsForStation)).toEqual([3, 4, 5, 6]);
    // At home at least 5 (charters at short notice); more when the duties or the hours need them.
    expect(setsForHome(undefined)).toBe(5);
    expect(setsForHome({ duties: 30.4, bh: 120 })).toBe(5);
    expect(setsForHome({ duties: 80, bh: 300 })).toBe(7);
    // Long days: the hours decide (420 BH a month at 85 a person, plus one in five).
    expect(setsForHome({ duties: 30, bh: 420 })).toBe(6);
  });

  it('a fleet at home keeps five sets an aircraft', () => {
    const g = fixtureGame();
    const p = crewPlan(g)[0];
    expect(p.setsNeeded).toBe(5 * p.aircraft);
  });
});

describe('v0.18.2 a deployment is sized again on its programme', () => {
  it('a set too many is stood down at the end of its last tour, then its anchor goes; nobody is cut short', () => {
    const g = newGame(21, 'LIS');
    const o = hamBase(g, g.now + 3 * DAY, 70, 1);
    o.broker = undefined;
    expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
    run(g, g.now + 10 * DAY);
    const dep = Object.values(g.deployments)[0];
    expect(dep).toBeDefined();
    // As if sized for more than one wave needs: two sets more.
    const R = g.company.policies.rotationWeeks * 7 * DAY;
    const n0 = dep.anchors!.length;
    dep.anchors = [...dep.anchors!, dep.anchors![n0 - 1] + DAY, dep.anchors![n0 - 1] + 2 * DAY];
    dep.setsOnStation = dep.anchors.length;
    dep.sized = dep.anchors.length;
    const tours = (s: number) => dep.pairingIds.map((id) => g.pairings[id]).filter((p) => p?.tour?.set === s && p.status !== 'done' && p.status !== 'broken');
    const last = dep.anchors.length - 1;
    resizeDeployments(g);
    const end = dep.setEnd?.[last];
    expect(end).toBeDefined();
    // Its tours under way keep their end; no period of that set after it.
    for (const p of tours(last)) expect(p.tour!.to).toBeLessThanOrEqual(end!);
    expect(periodOf(dep, last, end! + DAY, R)).toBeNull();
    run(g, Math.max(g.now, end!) + 2 * DAY);
    resizeDeployments(g);
    expect(dep.anchors.length).toBeLessThanOrEqual(last);
    expect(dep.setsOnStation).toBe(dep.anchors.length);
  }, 120_000);
});

describe('v0.18.2 Crew › Utilisation', () => {
  it('counts block hours per person, idle crew, crew per aircraft and the cost of a surplus', () => {
    const g = fixtureGame();
    addCrew(g, { CPT: 6, FO: 6 });
    for (const c of Object.values(g.crew)) c.hired = g.now - 400 * DAY;
    const u = crewUtilisation(g);
    expect(u.people.length).toBe(Object.keys(g.crew).length);
    expect(u.aircraft).toBeGreaterThan(0);
    expect(u.perAircraft.pilots).toBeGreaterThan(0);
    // Nobody has flown in the fixture: every pilot at work is idle, and the extra pilots are a surplus with a cost.
    expect(u.idle).toBeGreaterThan(0);
    const s = u.surplus.find((x) => x.role === 'CPT');
    expect(s && s.n).toBeGreaterThan(0);
    expect(s!.cost).toBeGreaterThan(0);
    expect(u.surplusCost).toBeGreaterThanOrEqual(s!.cost);
  });

  it('the crew desk holds hiring for a rank that sits idle', () => {
    const g = fixtureGame();
    addCrew(g, { CPT: 6 });
    for (const c of Object.values(g.crew)) c.hired = g.now - 400 * DAY;
    const hold = hireHold(g, 'A320', 'CPT');
    expect(hold?.why).toContain(`under ${UTIL_TYPICAL.idle28} h`);
    // Busy captains (70 h in 28 days each): no hold.
    for (const c of Object.values(g.crew)) if (c.role === 'CPT') c.log = [{ start: g.now - 5 * DAY, end: g.now - 5 * DAY + 600, fdp: 600, block: 70 * 60, sectors: 4, augmented: false, disruptive: false }];
    expect(hireHold(g, 'A320', 'CPT')).toBeNull();
    expect(heldHires(g, 'A320').some((x) => x.role === 'CPT')).toBe(false);
  });

  it('unpaid leave: those who take it stay home without pay, voluntary', () => {
    const g = fixtureGame();
    addCrew(g, { CC: 12 });
    for (const c of Object.values(g.crew)) c.hired = g.now - 400 * DAY;
    const q = unpaidQuote(g, 'A320', 'CC', 4, 1);
    expect(q.why).toBeNull();
    expect(q.ids.length).toBeGreaterThan(0);
    expect(q.ids.length).toBeLessThanOrEqual(4);
    expect(offerUnpaidLeave(g, 'A320', 'CC', 4, 1).ok).toBe(true);
    for (const id of q.ids) expect(g.crew[id].blocks?.some((b) => b.furlough && b.from === q.from && b.to === q.to)).toBe(true);
  });

  it('redundancy: notice, severance paid now, colleagues lose morale; only within the surplus', () => {
    const g = fixtureGame();
    addCrew(g, { FO: 8 });
    for (const c of Object.values(g.crew)) c.hired = g.now - 3 * 365 * DAY;
    const u = crewUtilisation(g);
    const s = u.surplus.find((x) => x.role === 'FO')!;
    expect(s.n).toBeGreaterThan(0);
    const q = redundancyQuote(g, 'A320', 'FO', s.n + 5);
    expect(q.ids.length).toBe(s.n);
    expect(q.noticeDays).toBe(REDUNDANCY.noticeDays.pilot);
    // Three years served: a month and a half's pay each.
    expect(q.severance).toBe(Math.round(q.ids.reduce((t, id) => t + g.crew[id].salary * 1.5, 0)));
    const cash = g.company.cash;
    const other = Object.values(g.crew).find((c) => c.role === 'FO' && !q.ids.includes(c.id))!;
    const m0 = other.morale;
    expect(makeRedundant(g, 'A320', 'FO', s.n).ok).toBe(true);
    expect(g.company.cash).toBe(cash - q.severance);
    for (const id of q.ids) expect(g.crew[id].notice).toEqual({ given: g.now, leaves: q.leaves, redundant: true });
    expect(other.morale).toBeLessThan(m0);
    expect(redundancyQuote(g, 'A320', 'FO', 1).why).not.toBeNull();
  });
});
