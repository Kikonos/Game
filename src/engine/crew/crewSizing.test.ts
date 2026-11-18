// v0.25 r2 (crew-oversets) sets on station sized on the duty-days a set can work in 28 days, the busiest moment only when
// duties overlap in time, and the spare sets (grown ones too) stood down together.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { hamBase, leased, newGame, run } from '../contracts/testkit';
import { DAY, dayStart } from '../core/time';
import type { Duty } from '../core/types';
import { resizeDeployments, setsFromDuties } from './duties';
import { setsStaying } from './farBase';
import { fixtureGame } from './fixtures';
import { crewPlan, type FamilyPlan } from './sets';
import { planHoldLine } from './utilisation';
import { rollingRoster } from '../../test/rolling';
import { deserialize, serialize } from '../save';

rollingRoster();

const H = 60;
/** Duties at these local-free UTC hours, every day for `days` days (no flights: no block hours). */
function duties(start: number, days: number, times: [number, number][], extra: [number, number][] = []): Duty[] {
  const out: Duty[] = [];
  for (let k = 0; k < days; k++) for (const [a, b] of times) out.push({ id: `d${k}-${a}`, report: start + k * DAY + a * H, release: start + k * DAY + b * H, flightIds: [] } as unknown as Duty);
  for (const [a, b] of extra) out.push({ id: `x${a}`, report: start + a * H, release: start + b * H, flightIds: [] } as unknown as Duty);
  return out.sort((x, y) => x.report - y.report);
}

describe('v0.25 r2 sets from the duty-days', () => {
  const g = fixtureGame();
  const t0 = dayStart(g.now) + DAY;

  it('one rotation a day: two sets (18.7 duty-days a set in 28), not three or four', () => {
    expect(setsFromDuties(g, duties(t0, 28, [[6, 13]]), t0)).toBe(2);
  });

  it('two duties on one day that do not overlap (rest fits between them) do not make a third set', () => {
    // An early duty and a late one on day 3: 06:00 release + 10 h rest < 20:00.
    expect(setsFromDuties(g, duties(t0, 28, [[2, 6]], [[3 * 24 + 20, 3 * 24 + 23]]), t0)).toBe(2);
  });

  it('two waves a day that overlap in time: as many sets as the duty-days ask (three for 56)', () => {
    const ds = duties(t0, 28, [[4, 11], [12, 19]]);
    expect(setsFromDuties(g, ds, t0)).toBe(3);
  });

  it('three duties at once: never fewer sets than that', () => {
    expect(setsFromDuties(g, duties(t0, 3, [[4, 10], [5, 11], [6, 12]]), t0)).toBe(3);
  });
});

describe('v0.25 r2 spare sets stood down together', () => {
  it('two sets too many are both stood down at the end of their last tours; the plan stops counting them at once', () => {
    const g = newGame(21, 'LIS');
    const o = hamBase(g, g.now + 3 * DAY, 70, 1);
    o.broker = undefined;
    expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
    run(g, g.now + 10 * DAY);
    const dep = Object.values(g.deployments)[0];
    expect(dep).toBeDefined();
    const n0 = dep.anchors!.length;
    dep.anchors = [...dep.anchors!, dep.anchors![n0 - 1] + DAY, dep.anchors![n0 - 1] + 2 * DAY];
    dep.setsOnStation = dep.anchors.length;
    dep.sized = dep.anchors.length;
    resizeDeployments(g);
    const down = Object.keys(dep.setEnd ?? {}).map(Number);
    expect(down).toContain(n0);
    expect(down).toContain(n0 + 1);
    expect(setsStaying(dep)).toBe(dep.setsOnStation - down.length);
    run(g, Math.max(g.now, ...Object.values(dep.setEnd!)) + 2 * DAY);
    resizeDeployments(g);
    expect(dep.anchors.length).toBeLessThanOrEqual(n0);
    expect(dep.setsOnStation).toBe(dep.anchors.length);
  }, 120_000);
});

describe('v0.25 r2 an older save\'s grown sets stood down on load, not at the first midnight', () => {
  it('Planning counts the sets the flying needs straight after Continue; a second load changes nothing', () => {
    const g = newGame(21, 'LIS');
    const o = hamBase(g, g.now + 3 * DAY, 70, 1);
    o.broker = undefined;
    expect(acceptOffer(g, o.id, [leased(g).id]).ok).toBe(true);
    run(g, g.now + 10 * DAY + 9 * H);
    const dep = Object.values(g.deployments)[0];
    const n0 = dep.anchors!.length;
    dep.anchors = [...dep.anchors!, dep.anchors![n0 - 1] + DAY, dep.anchors![n0 - 1] + 2 * DAY];
    dep.setsOnStation = dep.anchors.length;
    dep.sized = dep.anchors.length;
    delete dep.setEnd;
    // As an older build wrote it: no flag, the grown sets still counted.
    delete g.stats.resizeOnLoad;
    const old = JSON.parse(serialize(g));
    const h = deserialize(JSON.stringify(old));
    const d2 = h.deployments[dep.id];
    expect(h.now).toBe(g.now);
    expect(Object.keys(d2.setEnd ?? {}).map(Number)).toEqual(expect.arrayContaining([n0, n0 + 1]));
    expect(setsStaying(d2)).toBeLessThanOrEqual(n0);
    expect(h.stats.resizeOnLoad).toBe(true);
    // Saved again and loaded: the repair does not run twice.
    const again = deserialize(serialize(h));
    expect(again.deployments[dep.id].setEnd).toEqual(d2.setEnd);
  }, 120_000);
});

describe('v0.25 r2 Planning says what Utilisation says', () => {
  it('a family short on paper whose short ranks fly little: "No need to hire yet", and nothing once one short rank flies', () => {
    const g = fixtureGame();
    for (const c of Object.values(g.crew)) c.hired = g.now - 400 * DAY;
    const p = { family: 'A320' as const, roles: [{ role: 'CC' as const, balance: -3 }, { role: 'CPT' as const, balance: 0 }] as FamilyPlan['roles'] };
    const line = planHoldLine(g, p);
    expect(line).toMatch(/^No need to hire yet: cabin crew flew \d+ h on average in 28 days, \d+ under 15 h\.$/);
    // Busy cabin crew (70 h in 28 days): the hire is needed, no line.
    for (const c of Object.values(g.crew)) if (c.role === 'CC') c.log = [{ start: g.now - 5 * DAY, end: g.now - 5 * DAY + 600, fdp: 600, block: 70 * 60, sectors: 4, augmented: false, disruptive: false }];
    expect(planHoldLine(g, p)).toBeNull();
  });
});

describe('v0.25 r2 the reserve on a family\'s sets on station together', () => {
  it('two detachments of 2 sets each: 5 sets (4 plus one in five, rounded once), not 3 + 3', () => {
    const g = fixtureGame();
    const ids = Object.keys(g.fleet).slice(0, 2);
    expect(ids.length).toBe(2);
    ids.forEach((aircraftId, i) => {
      g.deployments[`dp${i}`] = { id: `dp${i}`, contractId: `k${i}`, aircraftId, base: 'HAM', start: g.now - DAY, end: g.now + 60 * DAY, setsOnStation: 2, pairingIds: [] };
    });
    const homes = Object.keys(g.fleet).length - 2;
    expect(crewPlan(g)[0].setsNeeded).toBe(5 + 5 * homes);
  });
});
