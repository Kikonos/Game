// r3-bal: launch a route on a save and fly it, printing the route P&L month by month.
// npx tsx scripts/balrun.ts <save> <marketId|idea> <days> [aircraftReg] [--real]   (--real: study, case, stages as a player does)
import { readFileSync } from 'node:fs';
import { deserialize, serialize } from '../src/engine/save';
import { writeFileSync } from 'node:fs';
import { DAY, fmtDate, monthKey } from '../src/engine/core/time';
import { advanceTo } from '../src/engine/sim';
import { answerSlot, bestChoice, resolveRotation, rotationChoices, businessCase, caseDraft, decideCase, devLaunchRoute, routeIdeas, startStudy } from '../src/engine/network';
const [file, mk0, daysS, reg] = process.argv.slice(2);
const REAL = process.argv.includes('--real');
const g = deserialize(readFileSync(file, 'utf8'));
const idea = mk0 === 'idea' ? routeIdeas(g)[0] : undefined;
const mk = idea ? idea.marketId : mk0;
if (idea) console.log('idea', JSON.stringify(idea));
const ac = Object.values(g.fleet).find((a) => a.reg === reg) ?? Object.values(g.fleet).filter((a) => a.status === 'available').sort((a, b) => b.cabin.total - a.cabin.total)[0];
const cash0 = g.company.cash;
let id: string;
const t0 = Date.now();
if (!REAL) id = devLaunchRoute(g, mk, ac.id);
else {
  const res = startStudy(g, mk, 'full', idea?.model);
  if (!res.routeId) throw new Error(res.why);
  id = res.routeId;
  const r = g.network!.routes[id];
  let n = 0;
  while (r.status === 'study' && n++ < 120) advanceTo(g, g.now + DAY, new Set());
  console.log('study done', r.status, n, fmtDate(g.now));
  const d = caseDraft(g, id)!;
  d.typeId = ac.typeId; d.layout = ac.cabin.layout as never;
  const bc = businessCase(g, id, d)!;
  console.log('case', d.typeId, JSON.stringify({ plan: { days: d.days, every: d.every, out: d.out, nights: d.nights, season: d.season }, p50: bc.p50, launch: bc.launchCost, payback: bc.paybackWeeks, verdict: bc.verdict?.word, parts: bc.parts, months: undefined }));
  if (process.env.CASEONLY) process.exit(0);
  const why = decideCase(g, id, 'go', d);
  if (why) throw new Error(why);
  if (r.series[0]) r.series[0].tail = ac.id;
}
const r = g.network!.routes[id];
console.log('route', id, mk, r.model, 'on', ac.reg, ac.typeId, ac.cabin.total, 'start', fmtDate(g.now));
const end = g.now + Number(daysS) * DAY;
let topUp = 0;
const fixes: Record<string, number> = {};
const seen = new Set<string>(g.messages.map((x) => x.id));
while (g.now < end) {
  // The harness keeps the company alive (nobody plays the ACMI side): cash added outside the route's books.
  if (g.company.cash < 2e6) { g.company.cash += 5e6; topUp += 5e6; }
  if (g.gameOver) { console.log('GAME OVER', g.gameOver.reason); break; }
  advanceTo(g, Math.min(end, g.now + DAY), new Set());
  if (process.env.NOTES) for (const msg of g.messages) { if (seen.has(msg.id)) break; seen.add(msg.id); if (msg.ref?.id === id) console.log('note', fmtDate(msg.t), msg.title, '|', msg.body); }
  if (process.env.DUMPAT && fmtDate(g.now) === process.env.DUMPAT) { writeFileSync(process.env.DUMPTO!, serialize(g)); console.error('dumped'); process.exit(0); }
  if (Math.round((end - g.now) / DAY) % 30 === 0) console.error('day', fmtDate(g.now), r.status, Math.round((Date.now() - t0) / 1000), 's');
  for (const s of r.stages) if (s.id === 'slots' && s.state === 'waiting') answerSlot(g, id, true);
  // The harness answers what a player would: a rotation within a week with no aircraft or crew gets the best quote.
  for (const rot of r.rotations) {
    if (rot.dep < g.now || rot.dep > g.now + 7 * DAY || (rot.status !== 'planned' && rot.status !== 'flights')) continue;
    const f = rot.sectors[0].flightId ? g.flights[rot.sectors[0].flightId] : undefined;
    if (f && f.aircraftId && f.status !== 'cancelled') continue;
    const b = bestChoice(rotationChoices(g, rot.id));
    if (b && resolveRotation(g, rot.id, b.choice)) { fixes[b.choice] = (fixes[b.choice] ?? 0) + 1; }
  }
}
const k = (v: number) => `${Math.round(v / 1000)}k`;
let cum = 0;
for (const [m, p] of Object.entries(r.pnl).sort((a, b) => +a[0] - +b[0])) {
  if (+m >= monthKey(g.now)) continue;
  cum += p.result - p.launch;
  console.log(`  ${m} sec ${p.sectors} LF ${p.seats ? Math.round(p.pax / p.seats * 100) : 0}% rev ${k(p.rev)} direct ${k(p.direct)} acTime ${k(p.acTime)} result ${k(p.result)} launch ${k(p.launch)} margin ${p.rev ? Math.round(p.result / p.rev * 100) : 0}% cum ${k(cum)}`);
}
console.log('fixes', JSON.stringify(fixes));
console.log('cash delta', k(g.company.cash - cash0 - topUp), 'secs', Math.round((Date.now() - t0) / 1000));
