// v0.12.1 (Round F merge): an empty leg planned right behind the leg before it was re-planned to the far end of its
// gap when that leg's ETA slipped a few minutes (S1027: BLU953 DUS–LIS, 7 min behind BLU932, moved from 15:45 to
// 21:59; its crew's day ran 14:44 and the next morning's flight left late). It now moves by those minutes.

import { describe, expect, it } from 'vitest';
import { flightsOf, retimeFlight } from '../core/entities';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import { acceptOffer } from '.';
import { relinkPositioning } from './schedule';
import { leased, legsOffer, newGame } from './testkit';

describe('relink nudges a chain only a few minutes early', () => {
  it('the empty leg keeps its id and moves 10 min, not to the latest slot', () => {
    const g = newGame(31);
    const ac = leased(g);
    const dep = Math.ceil(g.now / DAY) * DAY + DAY + 8 * 60;
    const r = acceptOffer(g, legsOffer(g, [['LIS', 'PMI', dep], ['LIS', 'MAD', dep + DAY + 10 * 60]]).id, [ac.id]);
    expect(r.ok).toBe(true);
    const turn = typeOf(ac.typeId).turnMin;
    const legs = () => flightsOf(g, ac.id).filter((f) => f.status === 'scheduled' || f.status === 'enroute');
    const a = legs().find((f) => f.kind === 'revenue' && f.to === 'PMI')!;
    const p = legs().find((f) => f.kind === 'positioning' && f.from === 'PMI' && f.to === 'LIS')!;
    expect(p).toBeTruthy();
    // Planned straight after the inbound (as a crew's duty would carry it): kept as it is.
    retimeFlight(g, p, a.sta + turn, a.sta + turn + (p.sta - p.std));
    relinkPositioning(g, ac.id);
    expect(g.flights[p.id].std).toBe(a.sta + turn);
    // The inbound leaves and its ETA slips 7 min: the empty leg follows by 10 min (5-min steps), same leg.
    g.now = a.std + 1;
    a.status = 'enroute';
    a.atd = a.std;
    a.eta = a.sta + 7;
    relinkPositioning(g, ac.id);
    const q = legs().filter((f) => f.kind === 'positioning' && f.from === 'PMI');
    expect(q.map((f) => f.id)).toEqual([p.id]);
    expect(q[0].std).toBe(a.sta + turn + 10);
  });
});
