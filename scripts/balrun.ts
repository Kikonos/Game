// r3-bal: launch a route on a save and fly it, printing the route P&L month by month.
// npx tsx scripts/balrun.ts <save> <marketId|idea> <days> [aircraftReg] [--real]   (--real: study, case, stages as a player does)
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { DAY, fmtDate, monthKey } from '../src/engine/core/time';
import { advanceTo } from '../src/engine/sim';
import { answerSlot, businessCase, caseDraft, decideCase, devLaunchRoute, routeIdeas, startStudy, marketOfRoute } from '../src/engine/network';
const [file, mk0, daysS, reg] = process.argv.slice(2);
const REAL = process.argv.includes('--real');
const g = deserialize(readFileSync(file, 'utf8'));
const mk = mk0 === 'idea' ? routeIdeas(g)[0].marketId : mk0;
const ac = Object.values(g.fleet).find((a) => a.reg === reg) ?? Object.values(g.fleet).filter((a) => a.status === 'available').sort((a, b) => b.cabin.total - a.cabin.total)[0];
const cash0 = g.company.cash;
let id: string;
const t0 = Date.now();
if (!REAL) id = devLaunchRoute(g, mk, ac.id);
else {
  const res = startStudy(g, mk, 'full');
  if (!res.routeId) throw new Error(res.why);
  id = res.routeId;
  const r = g.network!.routes[id];
  while (r.status === 'study') advanceTo(g, g.now + DAY, new Set());
  const d = caseDraft(g, id)!;
  d.typeId = ac.typeId; d.layout = ac.cabin.layout as never;
  const bc = businessCase(g, id, d)!;
  console.log('case', d.typeId, JSON.stringify({ plan: { days: d.days, every: d.every, out: d.out, nights: d.nights, season: d.season }, p50: bc.p50, launch: bc.launchCost, payback: bc.paybackWeeks, verdict: bc.verdict?.word, parts: bc.parts, months: undefined }));
  const why = decideCase(g, id, 'go', d);
  if (why) throw new Error(why);
  if (r.series[0]) r.series[0].tail = ac.id;
}
const r = g.network!.routes[id];
console.log('route', id, mk, r.model, 'on', ac.reg, ac.typeId, ac.cabin.total, 'start', fmtDate(g.now));
const end = g.now + Number(daysS) * DAY;
while (g.now < end) {
  advanceTo(g, Math.min(end, g.now + DAY), new Set());
  for (const s of r.stages) if (s.id === 'slots' && s.state === 'waiting') answerSlot(g, id, true);
}
const k = (v: number) => `${Math.round(v / 1000)}k`;
let cum = 0;
for (const [m, p] of Object.entries(r.pnl).sort((a, b) => +a[0] - +b[0])) {
  if (+m >= monthKey(g.now)) continue;
  cum += p.result - p.launch;
  console.log(`  ${m} sec ${p.sectors} LF ${p.seats ? Math.round(p.pax / p.seats * 100) : 0}% rev ${k(p.rev)} direct ${k(p.direct)} acTime ${k(p.acTime)} result ${k(p.result)} launch ${k(p.launch)} margin ${p.rev ? Math.round(p.result / p.rev * 100) : 0}% cum ${k(cum)}`);
}
console.log('cash delta', k(g.company.cash - cash0), 'secs', Math.round((Date.now() - t0) / 1000));
