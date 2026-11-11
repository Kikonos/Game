// v0.19 probe: a save (or a new game), a route launched with the dev hook on an aircraft, N days played; the route's
// numbers month by month. npx tsx scripts/netprobe.ts <save.json|new> <market> <days> [aircraftReg]
import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { createGame } from '../src/engine/newGame';
import { advanceTo } from '../src/engine/sim';
import { DAY, fmtDate, fmtMonth } from '../src/engine/core/time';
import { devLaunchRoute } from '../src/engine/network';
import { statementTotals } from '../src/engine/core/ledger';

const [file = 'new', market = 'LIS-OXB', daysS = '120', reg] = process.argv.slice(2);
const g = file === 'new' ? createGame({ name: 'Probe Air', code: 'PA', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' }, base: 'LIS', seed: Number(process.env.SEED ?? 1) } as never) : deserialize(readFileSync(file, 'utf8'));
const ac = reg ? Object.values(g.fleet).find((a) => a.reg === reg) : Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').sort((a, b) => b.cabin.total - a.cabin.total)[0];
console.log('start', fmtDate(g.now), 'aircraft', ac?.reg, ac?.typeId, ac?.cabin.label, 'cash', Math.round(g.company.cash));
const t0 = Date.now();
const id = devLaunchRoute(g, market, ac?.id);
console.log('route', id, g.network?.routes[id]?.status, 'first', g.network?.routes[id]?.firstFlight ? fmtDate(g.network.routes[id].firstFlight!) : '-');
const end = g.now + Number(daysS) * DAY;
while (g.now < end && !g.gameOver) advanceTo(g, Math.min(end, g.now + 7 * DAY));
const r = g.network!.routes[id];
console.log('end', fmtDate(g.now), 'status', r?.status, 'rep', r?.reputation, 'unearned', r?.unearned, 'cash', Math.round(g.company.cash), 'ms', Date.now() - t0);
for (const [k, p] of Object.entries(r?.pnl ?? {}).sort((a, b) => +a[0] - +b[0])) {
  console.log(fmtMonth(+k), JSON.stringify(p));
}
const flown = r?.rotations.filter((x) => x.status === 'flown') ?? [];
for (const x of flown.slice(-6)) console.log('rot', fmtDate(x.dep), x.aircraftId ? g.fleet[x.aircraftId]?.reg : x.operatedBy, x.sectors.map((s) => `${s.from}-${s.to} J${s.flownJ}/${s.capJ} Y${s.flownY}/${s.capY} kg${s.cargoKg} rev${s.rev} cost${s.cost}`).join(' | '));
const lines: Record<string, number> = {};
for (const st of [...g.finance.history.slice(-4), g.finance.current]) for (const [k2, v] of Object.entries(st.lines)) if (['ticketRevenue', 'cargoRevenue', 'ancillaryRevenue', 'handling', 'catering', 'paxServices', 'navCharges', 'distribution', 'marketing', 'paxComp', 'routeSetup'].includes(k2)) lines[k2] = (lines[k2] ?? 0) + (v as number);
console.log('ledger', JSON.stringify(lines));
console.log('stats', JSON.stringify(g.network?.stats));
const msgs = g.messages.filter((m) => m.topic === 'network').slice(0, 12).map((m) => `${fmtDate(m.t)} ${m.title}`);
console.log(msgs.join('\n'));
void statementTotals;
