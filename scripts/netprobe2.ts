import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { advanceTo } from '../src/engine/sim';
import { DAY, fmtDate, fmtDateTime } from '../src/engine/core/time';
import { devLaunchRoute, expectedPax, dirCap } from '../src/engine/network';
const [file, market = 'LIS-OXB', daysS = '80', reg] = process.argv.slice(2);
const g = deserialize(readFileSync(file, 'utf8'));
const ac = reg ? Object.values(g.fleet).find((a) => a.reg === reg) : Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').sort((a, b) => b.cabin.total - a.cabin.total)[0];
const id = devLaunchRoute(g, market, ac?.id);
const r = g.network!.routes[id];
const end = g.now + Number(daysS) * DAY;
let lastLog = 0;
while (g.now < end && !g.gameOver) {
  advanceTo(g, Math.min(end, g.now + DAY));
  if (g.now - lastLog >= 14 * DAY) {
    lastLog = g.now;
    const nx = r.rotations.find((x) => x.status === 'planned' || x.status === 'flights');
    if (nx) {
      const e = expectedPax(g, r, nx, 'out');
      console.log(fmtDate(g.now), 'next', fmtDate(nx.dep), nx.status, 'booked', nx.sectors.map((s) => `${s.bookedJ}/${s.bookedY}`).join(' '), 'exp', Math.round(e.j), Math.round(e.y), 'cap', JSON.stringify(dirCap(r, nx, 'out', ac!.typeId)), 'rep', r.reputation, 'aw', r.awareness.toFixed(2));
    }
  }
}
for (const x of r.rotations.filter((x) => x.dep < g.now)) {
  console.log('ROT', fmtDate(x.dep), x.status, x.aircraftId ? g.fleet[x.aircraftId]?.reg : x.operatedBy ?? '-', x.sectors.map((s) => { const f = s.flightId ? g.flights[s.flightId] : undefined; return `${s.from}-${s.to} ${f ? `${f.no} ${f.status} ${fmtDateTime(f.std)} d${f.delay} ${f.delayReason ?? ''} op:${f.operatedBy ?? ''}` : 'noflight'} void:${!!s.voided} cost:${s.cost}`; }).join(' | '));
}
