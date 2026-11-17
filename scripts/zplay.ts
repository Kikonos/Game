// review harness: play one route like a player. npx tsx scripts/zplay.ts <BASE|save.json> <seed> <days> <spec...>
// spec: idea[:n] | mkt:<id>  ; opts: freq=N layout=all-economy|two-class noseason fares=low|market|high type=<typeId> reg=<reg> mkg=high
import { readFileSync } from 'node:fs';
import { createGame } from '../src/engine/newGame';
import { deserialize, serialize } from '../src/engine/save';
import { writeFileSync } from 'node:fs';
import { DAY, fmtDate, monthKey } from '../src/engine/core/time';
import { advanceTo } from '../src/engine/sim';
import { unlockHead, hireHead } from '../src/engine/ops/heads';
import { suspendRoute, resumeRoute, baseFare, monthOf, dirSectors, project, studyBase, firstFlightOf, answerSlot, bestChoice, resolveRotation, rotationChoices, businessCase, caseDraft, decideCase, routeIdeas, startStudy, marketOfRoute, freqPerWeek } from '../src/engine/network';
const [src, seedS, daysS, spec, ...opts] = process.argv.slice(2);
const opt = (k: string) => opts.find((o) => o.startsWith(k + '='))?.slice(k.length + 1);
const has = (k: string) => opts.includes(k);
const g = src.endsWith('.json') ? deserialize(readFileSync(src, 'utf8')) : createGame({ name: 'Rev', code: 'RV', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: src, seed: Number(seedS) } as never);
if (!g.heads?.netPlanner?.hired) { unlockHead(g, 'netPlanner', true); const r = hireHead(g, 'netPlanner', 2); if (!r.ok) console.log('hire', r.error); }
let mk: string | undefined; let model: any;
if (spec === 'best') { /* below */ } else if (spec.startsWith('idea')) {
  const ideas = routeIdeas(g);
  console.log('ideas', ideas.slice(0, 6).map((i) => `${i.marketId} ${i.typeId} ${i.perWeek}/wk m${Math.round(i.margin * 100)}% lf${Math.round(i.lf * 100)}`).join(' | '));
  const i = ideas[Number(spec.split(':')[1] ?? 0)];
  mk = i.marketId; model = i.model;
} else if (spec !== 'best') mk = spec.split(':').slice(1).join(':');
const fleet = Object.values(g.fleet).filter((a) => a.status !== 'leasedOut');
const cash0 = g.company.cash;
let id: string;
if (spec === 'best') {
  const ideas = routeIdeas(g).slice(0, Number(opt('k') ?? 3));
  console.log('ideas', ideas.map((i) => `${i.marketId} ${i.typeId} ${i.perWeek}/wk m${Math.round(i.margin * 100)}%`).join(' | '));
  const ids = ideas.map((i) => startStudy(g, i.marketId, 'full', i.model).routeId!).filter(Boolean);
  let n = 0;
  while (ids.some((x) => g.network!.routes[x].status === 'study') && n++ < 120) advanceTo(g, g.now + DAY, new Set());
  let best: string | undefined; let bestRes = -Infinity;
  for (const x of ids) {
    const dd = caseDraft(g, x)!; const a0 = fleet.find((a) => a.typeId === dd.typeId) ?? fleet[0]; dd.typeId = a0.typeId; dd.layout = a0.cabin.layout as never;
    const b = businessCase(g, x, dd)!;
    console.log('  study', g.network!.routes[x].marketId, freqPerWeek(dd), '/wk', b.verdict?.word, Math.round(b.p50.result / 1e3), 'k', (b.p50.margin * 100).toFixed(1), '%');
    if (b.verdict?.word === 'Worth it' && b.p50.result > bestRes) { bestRes = b.p50.result; best = x; }
  }
  if (!best) { console.log('NOTHING WORTH IT'); process.exit(0); }
  for (const x of ids) if (x !== best) decideCase(g, x, 'shelve');
  id = best;
} else {
  const res = startStudy(g, mk!, 'full', (opt('model') as never) ?? model);
  if (!res.routeId) throw new Error(res.why);
  id = res.routeId;
}
const r = g.network!.routes[id];
mk = r.marketId;
let n = 0;
while (r.status === 'study' && n++ < 120) advanceTo(g, g.now + DAY, new Set());
const d = caseDraft(g, id)!;
const recType = d.typeId;
const ac = fleet.find((a) => a.reg === opt('reg')) ?? fleet.find((a) => a.typeId === (opt('type') ?? recType) && a.status === 'available') ?? fleet.find((a) => a.typeId === (opt('type') ?? recType)) ?? fleet.sort((a, b) => b.cabin.total - a.cabin.total)[0];
d.typeId = ac.typeId; d.layout = (opt('layout') as never) ?? (ac.cabin.layout as never);
if (opt('freq')) { const f = Number(opt('freq')); d.every = 1; d.days = f >= 7 ? 127 : [0, 1, 9, 21, 85, 87, 119][f]; }
if (has('noseason')) delete d.season;
if (opt('fares')) d.fares = opt('fares') as never;
if (opt('mkg')) d.marketing = opt('mkg') as never;
const bc = businessCase(g, id, d)!;
const m = marketOfRoute(r)!;
console.log(`CASE ${mk} model ${r.model} rec ${recType} fly ${ac.reg} ${ac.typeId} ${ac.cabin.total}${d.layout} ${freqPerWeek(d)}/wk season ${!!d.season} | p50 res ${Math.round(bc.p50.result / 1e3)}k margin ${(bc.p50.margin * 100).toFixed(1)}% lf ${Math.round(bc.p50.lf * 100)}% rev ${Math.round(bc.p50.rev / 1e3)}k | p10 ${Math.round(bc.p10.result / 1e3)}k p90 ${Math.round(bc.p90.result / 1e3)}k | launch ${Math.round(bc.launchCost / 1e3)}k payback ${bc.paybackWeeks}w | acmiResult ${Math.round((bc.acmiResult ?? 0) / 1e3)}k verdict ${bc.verdict?.word} | study truth ${r.study?.truth?.toFixed(2)}`);
{ const st = firstFlightOf(g, r, d); const x50 = r.study!.est!.p50 / Math.max(1, studyBase(g, r)); const P = project(g, { ...r, model: d.model }, d, st, x50);
  console.log(`CASEMONTHS from ${fmtDate(st)} ` + P.months.map((q) => `${Math.round(q.result / 1e3)}(${Math.round(q.rev / 1e3)}|${q.seats ? Math.round(q.pax / q.seats * 100) : 0}%)`).join(' '));
  console.log('CASE tix/pax', (P.parts.tickets / Math.max(1, P.pax)).toFixed(1), 'pax', Math.round(P.pax), 'paxSec', Math.round(P.paxSec), 'seatSec', Math.round(P.seatSec), 'avg base Y', (Array.from({length:12},(_,mo)=>baseFare(m,'Y',mo,'out',d.fares)+baseFare(m,'Y',mo,'back',d.fares)).reduce((a,b)=>a+b,0)/24).toFixed(1)); console.log('x50', x50.toFixed(3), 'truth', r.study?.truth, 'est', JSON.stringify(r.study?.est)); console.log('CASEPARTS', JSON.stringify(Object.fromEntries(Object.entries(P.parts).map(([a, b]) => [a, Math.round((b as number) / 1e3)]))), 'bh', Math.round(P.bh)); }
if (process.env.CASEONLY) process.exit(0);
const why = decideCase(g, id, 'go', d);
if (why) throw new Error(why);
if (r.series[0]) r.series[0].tail = ac.id;
const end = g.now + Number(daysS) * DAY;
let topUp = 0; let loops = 0;
const fixes: Record<string, number> = {};
const seen = new Set<string>(g.messages.map((x) => x.id));
const go = g.now; let reproj = false; const caseFirst = r.firstFlight!;
while (g.now < end) {
  if (g.company.cash < 2e6) { g.company.cash += 5e6; topUp += 5e6; }
  if (g.gameOver) { console.log('GAME OVER', g.gameOver.reason); break; }
  { const dt = new Date(Date.UTC(2000, 0, 1) + g.now * 60000); const nb = Math.round((Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) - Date.UTC(2000, 0, 1)) / 60000);
    if (process.env.LOOP && r.status === 'operating' && !r.closing && g.now + DAY >= nb && nb - 90 > g.now) {
      advanceTo(g, nb - 90, new Set()); const e1 = suspendRoute(g, id, false); advanceTo(g, nb + 90, new Set()); const e2 = resumeRoute(g, id); loops++; if (e1 || e2) console.log('loop err', e1, e2);
    } }
  advanceTo(g, Math.min(end, g.now + DAY), new Set());
  if (process.env.SAVEAT && fmtDate(g.now) === process.env.SAVEAT) { writeFileSync(process.env.SAVETO ?? 'zplay-save.json', serialize(g)); console.log('saved at', fmtDate(g.now), 'route', id); }
  if (process.env.AWARE && new Date(Date.UTC(2000,0,1)+g.now*60000).getUTCDate()===15) console.log('aware', fmtDate(g.now), r.status, r.awareness.toFixed(2), 'rep', r.reputation?.toFixed?.(0));
  if (process.env.NOTES) for (const msg of g.messages) { if (seen.has(msg.id)) break; seen.add(msg.id); if (msg.ref?.id === id) console.log('note', fmtDate(msg.t), msg.title, '|', msg.body); }
  if (!reproj && r.status === 'onSale') { reproj = true; const x50 = r.study!.est!.p50 / Math.max(1, studyBase(g, r)); const P = project(g, { ...r, model: d.model }, d, r.firstFlight!, x50);
    console.log(`REPROJ firstFlight ${fmtDate(r.firstFlight!)} (case ${fmtDate(caseFirst)}, +${Math.round((r.firstFlight! - caseFirst) / DAY)} d) res ${Math.round(P.result / 1e3)}k margin ${(P.result / P.rev * 100).toFixed(1)}% months ` + P.months.map((q) => Math.round(q.result / 1e3)).join(' ')); }
  for (const s of r.stages) if (s.id === 'slots' && s.state === 'waiting') answerSlot(g, id, true);
  for (const rot of r.rotations) {
    if (rot.dep < g.now || rot.dep > g.now + 7 * DAY || (rot.status !== 'planned' && rot.status !== 'flights')) continue;
    const f = rot.sectors[0].flightId ? g.flights[rot.sectors[0].flightId] : undefined;
    if (f && f.aircraftId && f.status !== 'cancelled') continue;
    const b = bestChoice(rotationChoices(g, rot.id));
    if (b && resolveRotation(g, rot.id, b.choice)) fixes[b.choice] = (fixes[b.choice] ?? 0) + 1;
  }
}
const k = (v: number) => `${Math.round(v / 1000)}`;
let cum = 0; let y1 = { rev: 0, res: 0, launch: 0, bh: 0, pax: 0, seats: 0, n: 0 }; const y2 = { rev: 0, res: 0, n: 0 }; let all = { rev: 0, res: 0, bh: 0 };
const months: string[] = [];
const ent = Object.entries(r.pnl).sort((a, b) => +a[0] - +b[0]).filter(([mm]) => +mm < monthKey(g.now));
const firstFly = ent.find(([, p]) => p.sectors > 0)?.[0];
for (const [mm, p] of ent) {
  cum += p.result - p.launch;
  months.push(`${p.sectors ? '' : '*'}${k(p.result - p.launch)}`);
  if (firstFly && +mm >= +firstFly && y1.n < 12) { y1.rev += p.rev; y1.res += p.result; y1.bh += p.bh; y1.pax += p.paxSec ?? p.pax; y1.seats += p.seats; y1.n++; }
  else if (firstFly && +mm >= +firstFly) { y2.rev += p.rev; y2.res += p.result; y2.n++; }
  y1.launch += p.launch; all.rev += p.rev; all.res += p.result; all.bh += p.bh;
  if (process.env.MONTHS) console.log(`  ${mm} tix ${k(p.tickets)} cargo ${k(p.cargo)} anc ${k(p.ancillary)} sec ${p.sectors} LF ${p.seats ? Math.round((p.paxSec ?? p.pax) / p.seats * 100) : 0}% rev ${k(p.rev)} direct ${k(p.direct)} acTime ${k(p.acTime)} result ${k(p.result)} launch ${k(p.launch)} cum ${k(cum)}`);
}
console.log(`MONTHS(k, result-launch) ${months.join(' ')}`);
console.log(`Y1 (${y1.n} mo from first flight) res ${k(y1.res)}k margin ${(y1.res / Math.max(1, y1.rev) * 100).toFixed(1)}% lf ${Math.round(y1.pax / Math.max(1, y1.seats) * 100)}% bh ${Math.round(y1.bh)} res/BH ${Math.round(y1.res / Math.max(1, y1.bh))} | case/BH ${Math.round(bc.p50.result / Math.max(1, (bc.acmi / Math.max(1, 1))) )} | launch ${k(y1.launch)}k | case vs actual res ${(y1.res / Math.max(1, Math.abs(bc.p50.result)) * 100).toFixed(0)}% | ALL res ${k(all.res)}k cum-after-launch ${k(cum)}k`);
console.log(`Y2 (${y2.n} mo) res ${k(y2.res)}k margin ${(y2.res / Math.max(1, y2.rev) * 100).toFixed(1)}%`);
console.log(`loops ${loops} status ${r.status} fixes ${JSON.stringify(fixes)} topUp ${topUp / 1e6}M cashΔ(ex topup) ${k(g.company.cash - cash0 - topUp)}k stats ${JSON.stringify(g.network!.stats)} go ${fmtDate(go)} end ${fmtDate(g.now)}`);

{ const rows: Record<string, number[]> = {};
  for (const rot of r.rotations) { if (rot.status !== 'flown') continue;
    for (const dir of ['out', 'back'] as const) { const idx = dirSectors(r, rot, dir); if (!idx.length) continue; const sec = rot.sectors[idx[0]];
      const pax = sec.bookedJ + sec.bookedY; if (!pax) continue; const tot = idx.reduce((a, i) => a + (rot.sectors[i].sold ?? 0), 0);
      const base = baseFare(m, 'Y', monthOf(rot.dep), dir, r.fares.level); const key = fmtDate(rot.dep).slice(-8);
      (rows[key] ??= []).push(tot / pax / base, pax / (sec.capJ + sec.capY), rot.buckets?.saver === false ? 1 : 0); } }
  console.log('YIELD/base by month (ratio, LF, saverClosedShare): ' + Object.entries(rows).map(([kk, v]) => { const n = v.length / 3; let a = 0, b = 0, c = 0; for (let i = 0; i < v.length; i += 3) { a += v[i]; b += v[i + 1]; c += v[i + 2]; } return `${kk} ${(a / n).toFixed(2)}/${(b / n).toFixed(2)}/${(c / n).toFixed(2)}`; }).join(' | ')); }

{ const st = [...((g.finance as any).history ?? (g.finance as any).statements ?? []), g.finance.current];
  const tot: Record<string, number> = {}; for (const x of st) for (const [kk, v] of Object.entries(x.lines ?? {})) tot[kk] = (tot[kk] ?? 0) + (v as number);
  console.log('LEDGER k', ['ticketRevenue','cargoRevenue','ancillaryRevenue','paxComp','routeSetup','marketing','distribution'].map((kk) => `${kk} ${Math.round((tot[kk] ?? 0) / 1e3)}`).join(' '), 'n', st.length);
  let pc = 0; for (const [, p] of Object.entries(r.pnl)) pc += p.direct; console.log('route pnl direct total k', Math.round(pc / 1e3)); }
