import { it } from 'vitest';
import { demoFlights } from '../dev';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { flightsOf, reassignFlights, subcharterFlights } from '../core/entities';
import { flightCrewStatus } from '../crew';
it('dbg', () => {
  const g = createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 11 });
  demoFlights(g, undefined, 2);
  const [a, b] = Object.keys(g.fleet);
  const fa = flightsOf(g, a).filter((f) => f.status === 'scheduled');
  reassignFlights(g, [fa[0].id], b);
  subcharterFlights(g, [fa[1].id], 'rival1');
  for (let i = 0; i < 6; i++) {
    const r = advanceTo(g, g.flights[fa[1].id].sta + 1);
    console.log(i, r.pause, g.now, g.flights[fa[1].id].sta, g.decisions.map((d) => d.kind + ':' + d.title), g.messages.slice(0, 3).map((m) => m.title));
    for (const f of Object.values(g.flights).slice(0, 8)) console.log(f.no, f.from, f.to, f.status, f.std, f.delay, f.aircraftId, flightCrewStatus(g, f.id).level);
    if (!r.pause) break;
  }
});
