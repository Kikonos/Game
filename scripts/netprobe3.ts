import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { advanceTo } from '../src/engine/sim';
import { DAY, fmtDateTime } from '../src/engine/core/time';
import { devLaunchRoute } from '../src/engine/network';
const [file, market = 'LIS-OXB', daysS = '75', reg] = process.argv.slice(2);
const g = deserialize(readFileSync(file, 'utf8'));
const ac = reg ? Object.values(g.fleet).find((a) => a.reg === reg) : Object.values(g.fleet).filter((a) => a.status !== 'leasedOut').sort((a, b) => b.cabin.total - a.cabin.total)[0];
const id = devLaunchRoute(g, market, ac?.id);
const no = `${g.company.icao}${g.network!.routes[id].flightNo}`;
const seen = new Set<string>();
const end = g.now + Number(daysS) * DAY;
while (g.now < end) {
  advanceTo(g, Math.min(end, g.now + DAY), new Set());
  for (const m of g.messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    if ((m.title + m.body).includes(no.slice(0, -1)) || m.topic === 'network') console.log(fmtDateTime(m.t), '|', m.title, '|', m.body.slice(0, 220));
  }
}
