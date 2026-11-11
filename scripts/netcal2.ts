// v0.21 calibration: the business case of markets × types with the money by kind (the waterfall's parts), per rotation.
// MKT=LIS-OXB,X:LIS-JFK TYPES=b763,a320ceo FARES=market|high MKTG=normal npx tsx scripts/netcal2.ts
import { createGame } from '../src/engine/newGame';
import { DAY } from '../src/engine/core/time';
import { aircraftCostBH, businessCase, caseDraft, crewCostBH, cabinFor, devLaunchRoute, project, marketOfRoute, freqPerWeek } from '../src/engine/network';
const g = createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: 'LIS', seed: 1 } as never);
const markets = (process.env.MKT ?? 'LIS-OXB,LIS-TMS,LIS-RAI,LIS-MPM,LIS-REC,LIS-LAD').split(',');
const types = (process.env.TYPES ?? 'b763,a332,a321ceo,a320ceo').split(',');
const k = (v: number) => `${Math.round(v / 1000)}k`;
for (const mk of markets) {
  const id = devLaunchRoute(g, mk);
  const r = g.network!.routes[id];
  if (!r) { console.log(mk, id); continue; }
  const m = marketOfRoute(r)!;
  for (const typeId of types) {
    const d = { ...caseDraft(g, id)!, typeId, layout: (process.env.LAYOUT ?? 'two-class') as never, fares: (process.env.FARES ?? 'market') as never, marketing: (process.env.MKTG ?? 'normal') as never };
    if (process.env.FREQ) { d.days = [0, 32, 36, 21, 85, 93, 119, 127][Number(process.env.FREQ)]; d.every = 1; delete d.monthly; }
    const p = project(g, r, d, g.now + 30 * DAY, 1, process.env.FIFTH ? { fifth: process.env.FIFTH as never } : {});
    const cab = cabinFor(typeId, d.layout ?? 'two-class');
    const P = p.parts;
    const n = Math.max(1, p.rotations);
    console.log(`${mk} ${r.model} ${typeId} ${cab.label} f${freqPerWeek(d).toFixed(2)} n${d.nights} LF ${(p.paxSec / p.seatSec * 100).toFixed(0)}% (off ${(p.lfOff * 100).toFixed(0)} peak ${(p.lfPeak * 100).toFixed(0)}) yield ${Math.round(P.tickets / Math.max(1, p.pax))} rev ${k(p.rev)} result ${k(p.result)} margin ${(p.result / p.rev * 100).toFixed(1)}% bh ${Math.round(p.bh)} | per rot: tix ${k(P.tickets / n)} cargo ${k(P.cargo / n)} extras ${k(P.extras / n)} fee ${k(P.fee / n)} | fuel ${k(P.fuel / n)} airport ${k(P.airport / n)} service ${k(P.service / n)} sales ${k(P.sales / n)} maint ${k(P.maint / n)} overheads ${k(P.overheads / n)} aircraft ${k(P.aircraft / n)} crew ${k(P.crew / n)} | acBH ${Math.round(aircraftCostBH(g, null, typeId))} crewBH ${Math.round(crewCostBH(typeId, cab.total))}${p.split ? ` split thr ${p.split.thr.toFixed(0)} ab ${p.split.ab.toFixed(0)} bc ${p.split.bc.toFixed(0)}` : ''}`);
    if (process.env.CASE) { const bc = businessCase(g, id, d); console.log('  ', bc?.verdict?.word, bc?.verdict?.reasons.join(' | '), bc?.stop ? JSON.stringify({ fuelOnly: bc.stop.fuelOnly, withRights: bc.stop.withRights }) : '', bc?.asStop ? JSON.stringify(bc.asStop) : ''); }
  }
  r.status = 'closed';
  void m;
}
