import { createGame } from '../../src/engine/newGame';
import { devMixedCrew } from '../../src/engine/contracts/missions';
import { generateOffer, acceptOffer, feasibility } from '../../src/engine/contracts';
for (const seed of [1, 2, 3, 4, 5]) {
  const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed });
  const sn = Object.values(g.clients).find((c) => c.name === 'Air Sénégal')!;
  const o = generateOffer(g, 'seasonBase', { client: sn.id, wide: false, window: false, start: g.now + 3 * 1440, days: 30, dests: ['LIS', 'BCN'] });
  const ac = Object.values(g.fleet)[0];
  if (o) { const f = feasibility(g, o.id, ac.id); console.log(seed, 'offer', o.title, f.level, f.checks.filter((c) => c.level === 'no').map((c) => c.label).join(' | ')); const r = acceptOffer(g, o.id, [ac.id]); console.log('  accept', r.ok, r.error); }
  else console.log(seed, 'no offer');
  const g2 = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed });
  console.log('  dev', JSON.stringify(devMixedCrew(g2)));
}
