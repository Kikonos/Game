// v0.21 probe: the analyst's and the planner's advice on business cases, the stop comparison and the planner's ideas.
// MKT=LIS-OXB,X:LIS-LAX TYPES=b763 npx tsx scripts/netadvice.ts [save.json]
import { readFileSync } from 'node:fs';
import { createGame } from '../src/engine/newGame';
import { deserialize } from '../src/engine/save';
import { businessCase, caseAdvice, caseDraft, devLaunchRoute, marketOfRoute, routeIdeas, sharedStop, stopoverCompare } from '../src/engine/network';
import { hireHead, unlockHead } from '../src/engine/ops/heads';
import { devAddType } from '../src/engine/dev';
const file = process.argv[2];
const g = file ? deserialize(readFileSync(file, 'utf8')) : createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: 'LIS', seed: 1 } as never);
if (!file) for (const t of (process.env.FLEET ?? 'b763,a332').split(',')) devAddType(g, t);
for (const id of ['analyst', 'netPlanner'] as const) { unlockHead(g, id, true); if (!g.heads![id].hired) hireHead(g, id, 2); }
const k = (v: number) => `${Math.round(v / 1000)}k`;
for (const mk of (process.env.MKT ?? 'LIS-OXB,LIS-RAI,LIS-TMS,LIS-MPM,LIS-REC,X:LIS-LAX,X:LIS-LAX@JFK,X:LIS-JNB').split(',')) {
  const id = devLaunchRoute(g, mk);
  const r = g.network!.routes[id];
  if (!r) { console.log(mk, id); continue; }
  r.status = 'case';
  delete r.plan;
  const d = caseDraft(g, id)!;
  if (process.env.TYPE) d.typeId = process.env.TYPE;
  const t0 = Date.now();
  const bc = businessCase(g, id, d)!;
  const t1 = Date.now();
  const a = caseAdvice(g, id, d);
  console.log(`${mk} ${d.typeId} days ${d.days} every ${d.every}${d.monthly ? ' monthly' : ''} n${d.nights}: ${bc.verdict?.word} result ${k(bc.p50.result)} margin ${(bc.p50.margin * 100).toFixed(1)}% LF ${(bc.p50.lf * 100).toFixed(0)}% (case ${t1 - t0} ms, advice ${Date.now() - t1} ms)`);
  for (const v of bc.verdict?.reasons ?? []) console.log('   ·', v);
  for (const x of a.list) console.log(`   > [${x.who}] ${x.title}: ${x.why}`);
  const m = marketOfRoute(r)!;
  const at = sharedStop(m);
  if (at) { const c = stopoverCompare(g, m.from, m.to, at, d.typeId); console.log('   compare', c ? `${c.plain.label} ${k(c.plain.result)} ${c.plain.hours}h | stopover ${k(c.stopover.result)} ${c.stopover.hours}h | rights ${c.withRights ? k(c.withRights.result) : '-'} odds ${c.odds.full}/${c.odds.limited}\n     + ${c.pros.join('\n     + ')}\n     - ${c.cons.join('\n     - ')}` : 'none'); }
  r.status = 'closed';
}
const t2 = Date.now();
const ideas = routeIdeas(g);
console.log(`ideas (${Date.now() - t2} ms):`);
for (const i of ideas) console.log(`  ${i.from}-${i.to} ${i.typeId} result ${k(i.result)} margin ${(i.margin * 100).toFixed(0)}% · ${i.why}`);
