// r3-bal: the business case of every researched market on each fitting type at the recommended plan (scripts/netcal.ts
// in full): load factor, RASK / CASK (US cents per seat-km, all-in: aircraft, crew and overheads included), yield (US
// cents per passenger-km and $ a passenger), margin, the best and worst season quarters, and the cost per block hour by
// kind. Markdown out.  npx tsx scripts/balmeasure.ts [MKT=all|MLA|ids] [LAYOUT=two-class|all-economy] [> file]
import { createGame } from '../src/engine/newGame';
import { BAL } from '../src/engine/core/balance';
import { DAY } from '../src/engine/core/time';
import { ROUTE_MARKETS } from '../src/data/routes';
import { distanceNm } from '../src/engine/core/geo';
import { typeOf } from '../src/engine/core/perf';
import { cabinFor, caseDraft, chainOf, chainProblem, devLaunchRoute, launchCost, marketOfRoute, project, sectorCost, freqPerWeek, type Dir } from '../src/engine/network';
import type { GameState } from '../src/engine/core/types';

const B = BAL.v019 as unknown as { demand: { scale: number; freqCap: { x: number; all: boolean }; beta: { freq: number } }; fares: { scale: number } };
if (process.env.SCALE) B.demand.scale = Number(process.env.SCALE);
if (process.env.CAPALL) B.demand.freqCap.all = process.env.CAPALL === '1';
if (process.env.CAPX) B.demand.freqCap.x = Number(process.env.CAPX);
if (process.env.FREQB) B.demand.beta.freq = Number(process.env.FREQB);
const mkt = process.env.MKT ?? 'all';
const layout = (process.env.LAYOUT ?? 'two-class') as 'two-class' | 'all-economy';
const markets = mkt === 'all' ? ROUTE_MARKETS.filter((m) => !m.closed && !(process.env.EXCL ?? '').split(',').includes(m.from)) : /^[A-Z]{3}$/.test(mkt) ? ROUTE_MARKETS.filter((m) => m.from === mkt && !m.closed) : ROUTE_MARKETS.filter((m) => mkt.split(',').includes(m.id));
const NARROW = ['a320ceo', 'a321ceo'];
const WIDE = ['b763', 'a332'];
const games = new Map<string, GameState>();
const gameAt = (base: string) => {
  let x = games.get(base);
  if (!x) games.set(base, (x = createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base, seed: 1 } as never)));
  return x;
};
const km = (a: string, b: string) => distanceNm(a, b) * 1.852;
const c1 = (v: number) => v.toFixed(1);
const pc = (v: number) => `${Math.round(v * 100)}%`;
const k = (v: number) => `${Math.round(v / 1000)}k`;

const rows: string[] = [];
const costRows: string[] = [];
const summary: { id: string; type: string; margin: number; lf: number; bh: number; result: number; perBH: number; long: boolean }[] = [];
for (const m0 of markets) {
  const g = gameAt(m0.from);
  const id = devLaunchRoute(g, m0.id);
  const r = g.network?.routes[id];
  if (!r) { rows.push(`| ${m0.id} | – | ${id} |`); continue; }
  const m = marketOfRoute(r)!;
  const base = caseDraft(g, id)!;
  const dist = chainOf(m, 'out').slice(1).reduce((a, to, i) => a + km(chainOf(m, 'out')[i], to), 0);
  const long = dist > 3_500;
  const types = [...NARROW, ...(long || dist > 2_500 ? WIDE : [])];
  for (const typeId of types) {
    if (chainProblem(m, typeId)) { rows.push(`| ${m.id} | ${typeOf(typeId).short} | can’t fly it (range or runway) |||||||||||`); continue; }
    const d = { ...base, typeId, layout };
    const start = g.now + 30 * DAY;
    const p = project(g, r, d, start, 1);
    const cab = cabinFor(typeId, layout);
    // Seat-km and passenger-km: every sector of the chain.
    let ask = 0;
    let rpk = 0;
    for (const dir of ['out', 'back'] as Dir[]) {
      const c = chainOf(m, dir);
      for (let i = 1; i < c.length; i++) ask += km(c[i - 1], c[i]) * cab.total;
    }
    const secs = Math.max(1, p.sectors);
    const rotYear = p.rotations;
    ask *= rotYear;
    rpk = ask * (p.paxSec / Math.max(1, p.seatSec));
    const P = p.parts;
    const tickets = P.tickets;
    const yieldC = tickets / Math.max(1, rpk) * 100;
    const margin = p.rev ? p.result / p.rev : 0;
    // Quarters: the best and the worst three months flown.
    const q = [0, 3, 6, 9].map((s) => p.months.slice(s, s + 3)).map((ms) => { const rv = ms.reduce((a, x) => a + x.rev, 0); const rs = ms.reduce((a, x) => a + x.result, 0); return rv ? rs / rv : NaN; }).filter((x) => Number.isFinite(x));
    const qs = q.length ? `${pc(Math.max(...q))} / ${pc(Math.min(...q))}` : '–';
    rows.push(`| ${m.id} | ${typeOf(typeId).short} ${cab.label} | ${r.model} | ${freqPerWeek(d).toFixed(1)}${d.season ? ' s' : ''} | ${Math.round(dist)} | ${pc(p.paxSec / Math.max(1, p.seatSec))} | ${Math.round(tickets / Math.max(1, p.pax))} | ${c1(yieldC)} | ${c1(p.rev / ask * 100)} | ${c1(p.cost / ask * 100)} | ${pc(margin)} | ${qs} | ${k(p.result)} | ${k(launchCost(g, r, d))} |`);
    // Cost per block hour by kind (nav, landing, handling apart: one sector's lines at the average load).
    let nav = 0, land = 0, hand = 0;
    const avgPax = p.paxSec / secs;
    for (const dir of ['out', 'back'] as Dir[]) {
      const c = chainOf(m, dir);
      for (let i = 1; i < c.length; i++) {
        const s = sectorCost(g, r, c[i - 1], c[i], typeId, null, { j: 0, y: avgPax, cargoKg: 0, sold: 0 });
        nav += s.navCharges; land += s.fees; hand += s.handling;
      }
    }
    const perRot = (v: number) => v * rotYear / p.bh;
    costRows.push(`| ${m.id} | ${typeOf(typeId).short} | ${Math.round(P.fuel / p.bh)} | ${Math.round(p.parts.crew / p.bh)} | ${Math.round(P.maint / p.bh)} | ${Math.round(P.aircraft / p.bh)} | ${Math.round(perRot(nav))} | ${Math.round(perRot(land))} | ${Math.round(perRot(hand))} | ${Math.round(P.service / p.bh)} | ${Math.round(P.sales / p.bh)} | ${Math.round(P.overheads / p.bh)} | ${Math.round(P.disruption / p.bh)} | ${Math.round(p.cost / p.bh)} | ${Math.round(p.rev / p.bh)} |`);
    summary.push({ id: m.id, type: typeId, margin, lf: p.paxSec / Math.max(1, p.seatSec), bh: p.bh, result: p.result, perBH: p.result / Math.max(1, p.bh), long });
  }
  r.status = 'closed';
}
console.log(`### Business case at the recommended plan (${layout}), first 12 months from the first flight, P50\n`);
console.log('f = flights a week (s: season only). Yield: ticket revenue per passenger ($) and per passenger-km (US¢). RASK/CASK: all revenue / all costs (incl. aircraft lease and insurance, crew, overheads) per seat-km (US¢). Quarters: best / worst quarter margin.\n');
console.log('| market | type | model | f | km | LF | $/pax | yield ¢ | RASK ¢ | CASK ¢ | margin | quarters best/worst | result/yr | launch |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of rows) console.log(x);
console.log('\n### Cost per block hour by kind (USD, same plans)\n');
console.log('| market | type | fuel | crew | maint | aircraft | nav | landing+pax | handling | catering+services | distribution | overheads | disruption | total | revenue |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const x of costRows) console.log(x);
// Summary by type.
console.log('\n### Summary\n');
for (const t of [...NARROW, ...WIDE]) {
  const xs = summary.filter((s) => s.type === t);
  if (!xs.length) continue;
  const sorted = [...xs].sort((a, b) => a.margin - b.margin);
  const med = sorted[Math.floor(sorted.length / 2)].margin;
  const pos = xs.filter((s) => s.margin > 0).length;
  const good = xs.filter((s) => s.margin >= 0.05 && s.margin <= 0.15).length;
  const big = xs.filter((s) => s.margin > 0.2).length;
  const bh = xs.reduce((a, s) => a + s.bh, 0);
  const res = xs.reduce((a, s) => a + s.result, 0);
  console.log(`- ${typeOf(t).short}: ${xs.length} markets, median margin ${pc(med)}, ${pos} positive, ${good} in 5–15 %, ${big} above 20 %; result per BH over all ${Math.round(res / Math.max(1, bh))} USD.`);
}
