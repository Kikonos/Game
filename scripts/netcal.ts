// v0.19 calibration: the business-case projection (the same demand and costs the simulation uses) for markets × types,
// a year from now at truth 1: LF, yield, revenue, direct costs, contribution per BH against ACMI, result after aircraft
// and crew time, margin. Levers by env: SCALE (demand.scale), FARES (fares.scale).
import { BAL } from '../src/engine/core/balance';
import { createGame } from '../src/engine/newGame';
import { DAY } from '../src/engine/core/time';
import { ROUTE_MARKETS } from '../src/data/routes';
import { acmiNetBH, cabinFor, caseDraft, devLaunchRoute, project, routeMonthCosts } from '../src/engine/network';
const B = BAL as unknown as { v019: { demand: { scale: number }; fares: { scale: number } } };
if (process.env.SCALE) B.v019.demand.scale = Number(process.env.SCALE);
if (process.env.FARES) B.v019.fares.scale = Number(process.env.FARES);
// MKT=all: every catalogue market; MKT=MLA: every market from that airport; else a list of ids. The game is based
// where the market leaves from (a market is studied only from one of our bases).
const mkt = process.env.MKT ?? 'LIS-OXB,LIS-TMS,LIS-DIL,LIS-RAI';
const markets = mkt === 'all' ? ROUTE_MARKETS.filter((m) => !m.closed).map((m) => m.id)
  : /^[A-Z]{3}$/.test(mkt) ? ROUTE_MARKETS.filter((m) => m.from === mkt && !m.closed).map((m) => m.id) : mkt.split(',');
const types = (process.env.TYPES ?? 'b763,a332,a321ceo,a320ceo').split(',');
const games = new Map<string, ReturnType<typeof createGame>>();
const gameAt = (base: string) => {
  let x = games.get(base);
  if (!x) games.set(base, (x = createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base, seed: 1 } as never)));
  return x;
};
for (const mk of markets) {
  const g = gameAt(process.env.BASE ?? mk.replace(/^X:/, '').slice(0, 3));
  const id = devLaunchRoute(g, mk);
  if (!g.network?.routes[id]) { console.log(`${mk}: ${id}`); continue; }
  const r = g.network!.routes[id];
  for (const typeId of types) {
    const d = { ...caseDraft(g, id)!, typeId, layout: 'two-class' as const };
    const p = project(g, r, d, g.now + 30 * DAY, 1);
    const fixed = Object.values(routeMonthCosts(r)).reduce((a, x) => a + (x ?? 0), 0) * 12;
    const direct = p.cost; // includes fixed + acTime in project
    const cab = cabinFor(typeId, 'two-class');
    const acmi = acmiNetBH(g, typeId);
    // project's cost includes acTime; recover contribution (rev − direct without acTime) approximately by re-running with acTime counted apart
    console.log(`${mk} ${r.model} ${typeId} ${cab.label} LF ${(p.pax / p.seats * 100).toFixed(0)}% (off ${(p.lfOff * 100).toFixed(0)} peak ${(p.lfPeak * 100).toFixed(0)}) rev ${Math.round(p.rev / 1000)}k cost ${Math.round(direct / 1000)}k result ${Math.round(p.result / 1000)}k margin ${(p.result / p.rev * 100).toFixed(1)}% bh ${Math.round(p.bh)} rev/BH ${Math.round(p.rev / p.bh)} acmiNet/BH ${acmi} fixed ${Math.round(fixed / 1000)}k yield ${Math.round(p.rev / p.pax)}`);
  }
  r.status = 'closed';
}
