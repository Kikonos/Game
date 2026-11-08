// v0.19 calibration: the business-case projection (the same demand and costs the simulation uses) for markets × types,
// a year from now at truth 1: LF, yield, revenue, direct costs, contribution per BH against ACMI, result after aircraft
// and crew time, margin. Levers by env: SCALE (demand.scale), FARES (fares.scale).
import { BAL } from '../src/engine/core/balance';
import { createGame } from '../src/engine/newGame';
import { DAY } from '../src/engine/core/time';
import { acmiNetBH, cabinFor, caseDraft, devLaunchRoute, project, routeMonthCosts } from '../src/engine/network';
const B = BAL as unknown as { v019: { demand: { scale: number }; fares: { scale: number } } };
if (process.env.SCALE) B.v019.demand.scale = Number(process.env.SCALE);
if (process.env.FARES) B.v019.fares.scale = Number(process.env.FARES);
const g = createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: 'LIS', seed: 1 } as never);
const markets = (process.env.MKT ?? 'LIS-OXB,LIS-TMS,LIS-DIL,LIS-RAI').split(',');
const types = (process.env.TYPES ?? 'b763,a332,a321ceo,a320ceo').split(',');
for (const mk of markets) {
  const id = devLaunchRoute(g, mk);
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
