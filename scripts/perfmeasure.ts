// Performance probe (v0.25 round 2): load, Continue, save and sim speed of a save.
//   npx tsx scripts/perfmeasure.ts <save.json> [days=10] [--midnight]
// Prints: file size; save open (decompress, parse, migrate, each module's load); the first settle the Continue button
// runs (store.afterLoad); serialize + lz16 compress (a save); then game days per real second at 1-hour steps (4x-like UI
// ticks), and with --midnight the cost of each midnight step against the hourly steps around it.
import { readFileSync } from 'node:fs';
import LZString from 'lz-string';
import { serialize, migrate } from '../src/engine/save';
import { MODULES, advanceTo, settle } from '../src/engine/sim';
import { DAY, fmtDateTime } from '../src/engine/core/time';
import type { GameState } from '../src/engine/core/types';
import { resolveDecision } from '../src/engine/ops';

const file = process.argv[2];
const days = Number(process.argv[3] ?? 10);
const MID = process.argv.includes('--midnight');
const raw = readFileSync(file, 'utf8');
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;

const lz = LZString.compressToUTF16(raw);
let t = performance.now();
const text = LZString.decompressFromUTF16(lz);
const tDec = ms(t);
t = performance.now();
const data = JSON.parse(text) as { state: GameState };
const tParse = ms(t);
t = performance.now();
const g = migrate(data.state);
const tMig = ms(t);
const per: string[] = [];
const tLoad0 = performance.now();
for (const m of MODULES) {
  const a = performance.now();
  m.load?.(g);
  per.push(`${m.name} ${(performance.now() - a).toFixed(0)}`);
}
const tLoad = ms(tLoad0);
t = performance.now();
settle(g);
const tSettle = ms(t);
console.log(`file ${(raw.length / 1e6).toFixed(2)} MB json, ${((lz.length * 2) / 1e6).toFixed(2)} MB lz16 · ${fmtDateTime(g.now)}`);
console.log(`open: decompress ${tDec}, parse ${tParse}, migrate ${tMig}, onLoad ${tLoad} (${per.join(', ')}); Continue settle ${tSettle}`);
t = performance.now();
const s = serialize(g, 'auto');
const tSer = ms(t);
t = performance.now();
const c = LZString.compressToUTF16(s);
console.log(`save: serialize ${tSer}, compress ${ms(t)}, ${((c.length * 2) / 1e6).toFixed(2)} MB`);

const start = g.now;
const t0 = performance.now();
const mids: number[] = [];
const hours: number[] = [];
for (let d = 1; d <= days && !g.gameOver; d++) {
  for (let h = 0; h < 24; h++) {
    const a = performance.now();
    advanceTo(g, start + (d - 1) * DAY + (h + 1) * 60);
    const dt = performance.now() - a;
    const crossed = Math.floor((start + (d - 1) * DAY + h * 60) / DAY) !== Math.floor((start + (d - 1) * DAY + (h + 1) * 60) / DAY);
    (crossed ? mids : hours).push(dt);
  }
  for (const x of [...g.decisions]) resolveDecision(g, x.id, x.defaultOption);
}
const wall = (performance.now() - t0) / 1000;
const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] ?? 0;
console.log(`sim: ${days} days in ${wall.toFixed(1)} s = ${(days / wall).toFixed(2)} game days/s (hourly steps)`);
console.log(`hour step p50 ${q(hours, 0.5).toFixed(0)} p95 ${q(hours, 0.95).toFixed(0)} max ${q(hours, 1).toFixed(0)} ms; midnight step p50 ${q(mids, 0.5).toFixed(0)} max ${q(mids, 1).toFixed(0)} ms`);
if (MID) console.log(`midnights: ${mids.map((x) => x.toFixed(0)).join(' ')}`);
