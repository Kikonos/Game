import { newGame, run } from '../../src/engine/contracts/testkit';
import { feasibilityAll } from '../../src/engine/contracts';
import { DAY } from '../../src/engine/core/time';
for (const seed of [11, 13]) {
  const g = newGame(seed); const t0 = g.now; const seen = new Map<string, any>();
  for (let h = 1; h <= 30 * 24; h++) { run(g, t0 + h * 60); for (const o of Object.values(g.offers)) if (!seen.has(o.id)) { const reps = feasibilityAll(g, o.id); seen.set(o.id, { a: o.archetype, t: o.title, fit: reps.some((r) => r.level !== 'no'), why: reps.flatMap((r) => r.checks.filter((c) => c.level === 'no').map((c) => c.label)).slice(0, 2).join(' | ') }); } }
  const xs = [...seen.values()];
  console.log('seed', seed, xs.length, 'fit', xs.filter((x) => x.fit).length);
  for (const x of xs.filter((x) => !x.fit)) console.log('  ', x.a, x.t, '::', x.why.slice(0, 160));
}
