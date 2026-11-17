import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { quoteRouteLife, quoteCancelRotation, rotationFlyCost, rotationPax } from '../src/engine/network';
import { DAY } from '../src/engine/core/time';
const g = deserialize(readFileSync(process.argv[2], 'utf8'));
for (const r of Object.values(g.network!.routes)) {
  console.log(r.id, r.marketId, r.status, r.series.map((s) => s.typeId).join(','), Object.entries(r.pnl).slice(-3).map(([k, p]) => `${k}:${Math.round(p.result)}/${p.seats ? Math.round(100 * (p.paxSec ?? p.pax) / p.seats) : 0}%`).join(' '));
  if (r.status === 'closed') continue;
  for (const rot of r.rotations.filter((x) => x.status === 'planned' || x.status === 'flights').slice(0, 8)) {
    const c = quoteCancelRotation(g, rot.id);
    console.log('  ', Math.round((rot.dep - g.now) / DAY), 'pax', rotationPax(r, rot), 'refund', c.refunds, 'comp', c.cost, 'fly', rotationFlyCost(g, r, rot));
  }
  const q = quoteRouteLife(g, r.id);
  console.log('  ', JSON.stringify({ ...q }));
}
