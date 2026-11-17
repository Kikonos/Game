// r3-bal: what a save holds on the network: routes with their P&L by month, the planner's ideas.
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { fmtDate } from '../src/engine/core/time';
import { routeIdeas, marketOfRoute } from '../src/engine/network';
const g = deserialize(readFileSync(process.argv[2], 'utf8'));
console.log('now', fmtDate(g.now), 'cash', Math.round(g.company.cash), 'base', g.company.homeBase, 'fleet', Object.values(g.fleet).map((a) => `${a.reg}:${a.typeId}:${a.cabin.label ?? a.cabin.total}:${a.status}`).join(' '));
for (const r of Object.values(g.network?.routes ?? {})) {
  const m = marketOfRoute(r);
  console.log('route', r.id, r.marketId, r.status, r.model, 'series', JSON.stringify(r.series.map((s) => ({ days: s.days, every: s.every, typeId: s.typeId, out: s.out, nights: s.nights }))), 'stages', r.stages.map((s) => `${s.id}:${s.state}:${s.cost}`).join(','));
  for (const [k, p] of Object.entries(r.pnl)) console.log('  ', k, JSON.stringify(p));
  void m;
}
for (const i of routeIdeas(g)) console.log('idea', JSON.stringify(i));
