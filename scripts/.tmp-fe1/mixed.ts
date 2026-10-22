import { createGame } from '/home/user/wt/acmi/src/engine/newGame';
import { devMixedCrew, devFleet } from '/home/user/wt/acmi/src/engine/dev';
import { generateOffer } from '/home/user/wt/acmi/src/engine/contracts/offers';
import { acceptOffer } from '/home/user/wt/acmi/src/engine/contracts';
import { DAY } from '/home/user/wt/acmi/src/engine/core/time';
let ok = 0, fail: string[] = [];
for (let seed = 1; seed <= 10; seed++) {
  const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed });
  const id = devMixedCrew(g);
  if (id) ok++; else {
    const sn = Object.values(g.clients).find((c) => c.name === 'Air Sénégal')!;
    const ac = Object.values(g.fleet)[0];
    const o = generateOffer(g, 'seasonBase', { client: sn.id, wide: false, window: false, start: g.now + 3 * DAY, days: 30, dests: ['LIS', 'BCN'] });
    const r = o ? acceptOffer(g, o.id, [ac.id]) : null;
    fail.push(`${seed}: offer ${!!o} ${r?.error ?? r?.ok}`);
  }
}
console.log('ok', ok, 'fail', fail.join(' | '));
