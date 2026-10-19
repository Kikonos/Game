import { it } from 'vitest';
import { DAY } from '../core/time';
import { demoFlights, devFleet } from '../dev';
import { autoRoster } from '.';
import { planAircraft } from './duties';
import { addCrew, fixtureGame } from './fixtures';
import { segsOf } from './timeline';
it('dbg', () => {
  for (let k = 0; k < 3; k++) {
    const g = fixtureGame();
    devFleet(g, 4);
    addCrew(g, { CPT: 10, FO: 10, SCC: 10, CC: 30 });
    demoFlights(g, undefined, 30);
    let t0 = performance.now();
    for (const id of Object.keys(g.fleet)) planAircraft(g, id, g.now);
    const tPlan = performance.now() - t0;
    t0 = performance.now();
    for (const c of Object.values(g.crew)) segsOf(g, c);
    const tSegs = performance.now() - t0;
    t0 = performance.now();
    const res = autoRoster(g, { to: g.now + 31 * DAY });
    const tAll = performance.now() - t0;
    t0 = performance.now();
    for (const c of Object.values(g.crew)) segsOf(g, c);
    const tSegs2 = performance.now() - t0;
    t0 = performance.now();
    autoRoster(g, { to: g.now + 31 * DAY });
    const tAgain = performance.now() - t0;
    console.log({ tPlan, tSegs, tAll, tSegs2, tAgain, assigned: res.assigned });
  }
});
