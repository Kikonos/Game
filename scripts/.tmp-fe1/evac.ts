import { createGame } from '/home/user/wt/acmi/src/engine/newGame';
import { devWorldEvent } from '/home/user/wt/acmi/src/engine/dev';
import { feasibilityAll } from '/home/user/wt/acmi/src/engine/contracts';
import { worldEvent } from '/home/user/wt/acmi/src/engine/ops/world';
import { DAY } from '/home/user/wt/acmi/src/engine/core/time';
for (const tpl of ['warSudan', 'warLibya', 'unrestHaiti']) for (let seed = 1; seed <= 8; seed++) {
  const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed, start: undefined });
  g.now += seed * 3 * DAY;
  const id = devWorldEvent(g, undefined, tpl);
  const e = g.world!.events.find((x) => x.id === id)!;
  const offers = e.offerIds.map((oid) => {
    const o = g.offers[oid];
    const reps = feasibilityAll(g, oid);
    const air = reps.flatMap((r) => r.checks.filter((c) => c.id === 'airspace').map((c) => `${c.level}:${c.label}`));
    return `${o.archetype} ${o.title} best=${reps.map((r) => r.level).join('/')} ${[...new Set(air)].join(';')}`;
  });
  console.log(tpl, seed, 'closed', !!e.closed, e.title, '|', offers.join(' || '));
}
