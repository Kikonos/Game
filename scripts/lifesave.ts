// v0.24.1 route lifecycle on a real save: launch a route (dev hook) on the save's first researched market, let it sell,
// then suspend / wind down / close it and write the save out for `invariants.ts save <out> 30`.
// usage: npx tsx scripts/lifesave.ts <save.json> <suspend|suspendRefund|windDown|windDownAll|close|resume> <out.json> [sellDays=21]

import { readFileSync, writeFileSync } from 'node:fs';
import { DAY } from '../src/engine/core/time';
import { settle } from '../src/engine/sim';
import { advanceTo } from '../src/engine/sim';
import { catalogueFor, closeRoute, devLaunchRoute, quoteRouteLife, resumeRoute, suspendRoute, windDownRoute } from '../src/engine/network';
import { deserialize, serialize } from '../src/engine/save';

const [file, action, out, sell = '21'] = process.argv.slice(2);
const g = deserialize(readFileSync(file, 'utf8'));
const m = catalogueFor(g).find((x) => !x.closed && !Object.values(g.network?.routes ?? {}).some((r) => r.marketId === x.id && r.status !== 'closed'));
const ac = Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').sort((a, b) => b.cabin.total - a.cabin.total)[0];
const id = devLaunchRoute(g, m?.id ?? '', ac?.id);
console.log(`route ${m?.id} on ${ac?.reg}: ${id}`);
const end = g.now + Number(sell) * DAY;
while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
const q = quoteRouteLife(g, id);
console.log(JSON.stringify({ booked: q.booked, empty: q.empty, pax: q.pax, refundCost: q.refundCost, best: q.best, all: q.all }));
const cash0 = g.company.cash;
let res: string | null = null;
// 'none': the route left on sale (for screenshots).
if (action === 'suspend') res = suspendRoute(g, id, false);
else if (action === 'suspendRefund') res = suspendRoute(g, id, true);
else if (action === 'windDown') res = windDownRoute(g, id);
else if (action === 'windDownAll') res = windDownRoute(g, id, true);
else if (action === 'close') res = closeRoute(g, id);
else if (action === 'resume') { res = suspendRoute(g, id, false); advanceTo(g, g.now + 10 * DAY, new Set()); res ??= resumeRoute(g, id); }
settle(g);
const r = g.network!.routes[id];
console.log(`${action}: ${res ?? 'ok'} · status ${r.status}${r.closing ? ` closing, last ${new Date(Date.UTC(2000, 0, 1) + r.closing.last * 60_000).toISOString().slice(0, 10)}` : ''} · cash ${Math.round(g.company.cash - cash0)}`);
writeFileSync(out, serialize(g));
