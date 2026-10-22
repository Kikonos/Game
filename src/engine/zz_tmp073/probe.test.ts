import { it } from 'vitest';
import { addAircraft, newGame } from '../contracts/testkit';
import { restRefitOptions } from '../ops/cabin';
it('probe', () => {
  const g = newGame(4);
  g.company.approvals.push('augmented');
  for (const [t, rest] of [['a332', { fc: null, cc: null }], ['a332', { fc: { cls: 2, kind: 'jSeats', places: 2 }, cc: { cls: 2, kind: 'jSeats', places: 5 } }], ['b763', { fc: null, cc: null }], ['a321neo', { fc: null, cc: null }], ['b772', { fc: { cls: 1, kind: 'fcrc', places: 2 }, cc: null }]] as const) {
    const ac = addAircraft(g, t);
    ac.rest = structuredClone(rest) as never;
    console.log(t, ac.cabin.label, JSON.stringify(restRefitOptions(g, ac.id).map((o) => [o.id, o.side, o.cls, o.where, o.days, o.cost, o.seats, o.opens, o.ok, o.why])));
  }
});
