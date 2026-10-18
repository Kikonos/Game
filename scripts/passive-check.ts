// A cautious beginner: 2 leased A320neos, 2 routes, default fares.
import { AIRCRAFT_BY_ID } from '../src/data/aircraft';
import * as A from '../src/engine/actions';
import { defaultCabin } from '../src/engine/cabin';
import { monthProfit, monthRevenue } from '../src/engine/economy';
import { createGame } from '../src/engine/newGame';
import { advanceDay } from '../src/engine/sim';
const hub = process.argv[2] ?? 'MAD';
const dests = (process.argv[3] ?? 'BCN,LIS').split(',');
const type = process.argv[4] ?? 'a320neo';
const s = createGame({ name: 'P', code: 'PP', ceo: 'P', hub, difficulty: 'normal', seed: 7, livery: { primary: '#000', secondary: '#fff', tail: 'solid' } });
for (const d of dests) {
  const r = A.openRoute(s, hub, d);
  let offer = s.market.leases.find((o) => o.typeId === type);
  console.log(d, r.ok, offer ? A.leaseAircraft(s, offer.id, hub, defaultCabin(AIRCRAFT_BY_ID[type])) : 'no offer');
  const ac = s.fleet.at(-1)!;
  console.log(A.assignAircraft(s, ac.id, r.routeId!, Math.min(A.maxFreqFor(s, ac, r.routeId!), 21)), A.maxFreqFor(s, ac, r.routeId!));
}
for (let m = 0; m < 12; m++) {
  for (let i = 0; i < 30; i++) advanceDay(s);
  const h = s.finance.history.at(-1);
  if (h) console.log(`month ${m} rev ${(monthRevenue(h) / 1e6).toFixed(2)}M profit ${(monthProfit(h) / 1e6).toFixed(2)}M cash ${(s.cash / 1e6).toFixed(1)}M LF ${s.routes.map((r) => r.history.at(-1) ? Math.round(r.history.at(-1)!.pax / r.history.at(-1)!.seats * 100) : 0).join('/')} lvl ${s.level} rep ${s.reputation.toFixed(0)}`);
}
const h = s.finance.history.at(-1)!;
console.log(Object.fromEntries(Object.entries({ ...h.rev, ...h.exp }).filter(([, v]) => v > 0).map(([k, v]) => [k, (v / 1e3).toFixed(0) + 'K'])));
