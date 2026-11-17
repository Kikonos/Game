// r3-bal: one sector's cost lines (sectorCost) for a market, type and load.
// npx tsx scripts/balsector.ts <marketId> <typeId> <pax> [save.json]
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { createGame } from '../src/engine/newGame';
import { sectorCost, MARKET_BY_ID } from '../src/engine/network';
import { blockMinutes, typeOf } from '../src/engine/core/perf';
const [mk, typeId, paxS, save] = process.argv.slice(2);
const m = MARKET_BY_ID[mk];
const g = save ? deserialize(readFileSync(save, 'utf8')) : createGame({ name: 'Cal', code: 'CA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: m.from, seed: 1 } as never);
const t = typeOf(typeId)!;
console.log(typeId, 'fuelTBH', t.fuelTBH, 'maintBH', t.maintBH, 'rentMonth', t.rentMonth, 'rateBH', t.rateBH, 'seats', t.maxSeats, 'fuelPrice', g.market.fuelPrice);
for (const [a, b] of [[m.from, m.to], [m.to, m.from]]) {
  const c = sectorCost(g, { marketId: mk, model: m.model } as never, a, b, typeId, null, { j: 0, y: Number(paxS), cargoKg: 0, sold: Number(paxS) * 150 });
  const blk = blockMinutes(typeId, a, b);
  console.log(a, b, 'blk', blk, Object.entries(c).map(([k, v]) => `${k} ${Math.round(v)}`).join(' '), 'total', Math.round(Object.values(c).reduce((x, y) => x + y, 0)));
}
