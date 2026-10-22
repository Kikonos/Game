import { newGame, addAircraft } from '../../src/engine/contracts/testkit';
import { devGrantApproval } from '../../src/engine/dev';
import { devHajj } from '../../src/engine/contracts/missions';
import { feasibility } from '../../src/engine/contracts';
import { fmtDay, fmtDateTime } from '../../src/engine/core/time';
for (const seed of [1, 2, 3, 4, 5]) {
  const g = newGame(seed);
  const ac = addAircraft(g, 'a333'); for (const a of ['widebody', 'augmented'] as const) devGrantApproval(g, a);
  const id = devHajj(g); const o = g.offers[id];
  if (!o) { console.log(seed, 'none'); continue; }
  const p = o.product as any;
  console.log(seed, o.title, 'legs', (o.pattern as any).legs.length, 'estBH', o.estBH, 'mgh', p.mghPerMonth, 'rate', p.ratePerBH, 'value', o.estValue, 'terms', o.terms!.map(([a, b]) => fmtDay(a) + '-' + fmtDay(b)).join(' / '));
  console.log('  ', o.blurb.slice(0, 260));
  console.log('  ', (o.pattern as any).legs.slice(0, 4).map((l: any) => `${l.from}-${l.to} ${fmtDateTime(l.dep)}`).join(', '));
  const f = feasibility(g, id, ac.id)!;
  console.log('   ', f.level, f.checks.filter((c) => c.level !== 'ok').map((c: any) => c.label + ': ' + c.text).slice(0, 4).join(' | '), 'rev', f.estRevenue, 'margin', f.estMargin);
}
