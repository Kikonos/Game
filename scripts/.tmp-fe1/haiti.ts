import { createGame } from '../../src/engine/newGame';
import { devWorldEvent } from '../../src/engine/dev';
import { feasibilityAll } from '../../src/engine/contracts';
import { DAY, fmtDateTime } from '../../src/engine/core/time';
const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed: 1 });
g.now += 3 * DAY;
const id = devWorldEvent(g, undefined, 'unrestHaiti');
const e = g.world!.events.find((x) => x.id === id)!;
for (const oid of e.offerIds) { const o = g.offers[oid]; console.log(o.title, o.blurb); console.log((o.pattern as any).legs.map((l: any) => `${l.from}-${l.to} ${fmtDateTime(l.dep)}`).join(', '), 'now', fmtDateTime(g.now));
  for (const r of feasibilityAll(g, oid)) console.log(r.level, r.checks.filter((c) => c.level !== 'ok').map((c) => c.label).join(' | '), r.positionIn.map((p: any) => p.from + '-' + p.to).join(','));
}
