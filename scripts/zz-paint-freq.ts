import { newGame } from '../src/engine/contracts/testkit';
import { generateOffer } from '../src/engine/contracts';
import { DAY } from '../src/engine/core/time';
import type { Archetype } from '../src/engine/core/types';
const t0 = performance.now();
const tally = new Map<string, [number, number]>();
const bump = (k: string, p: boolean) => { const v = tally.get(k) ?? [0, 0]; v[0]++; if (p) v[1]++; tally.set(k, v); };
for (let seed = 1; seed <= 4; seed++) {
  const g = newGame(seed);
  for (let i = 0; i < 400; i++) {
    const arch = (['seasonBase', 'seasonBase', 'troopRotation', 'tourSeries', 'aogCover', 'repatriation', 'adhoc', 'sports'] as Archetype[])[i % 8];
    const o = generateOffer(g, arch);
    if (!o) continue;
    const days = (o.end - o.start) / DAY;
    let k: string = o.archetype;
    if (k === 'seasonBase') k += days >= 120 ? ' long' : days >= 60 ? ' 60-119' : ' 30-59';
    if (k === 'troopRotation') k += /^UN/.test(g.clients[o.clientId].name) ? ' UN' : ' gov';
    if (k === 'tourSeries') k += days >= 56 ? ' ≥56' : ' <56';
    bump(k, !!o.paint);
    if (o.paint) bump(`${k} kind=${o.paint.kind} req=${o.paint.required}`, true);
    delete g.offers[o.id];
  }
}
for (const [k, [n, p]] of [...tally].sort()) console.log(k.padEnd(40), n, p, (p / n).toFixed(2));
console.log(((performance.now() - t0) / 1000).toFixed(1), 's');
