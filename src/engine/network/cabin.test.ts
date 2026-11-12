// v0.23.1 a route's cabin changed while it runs (report bmwdnxjlp5jo6): the quote compares the two cabins from the
// game's own demand and fare model, and the change re-files the seats of every departure on sale, moving the
// business passengers already booked to economy now with their refund (out of the ticket cash held).

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { GameState } from '../core/types';
import { createGame } from '../newGame';
import { advanceTo } from '../sim';
import { deserialize, serialize } from '../save';
import { cabinFor } from './model';
import { cabinQuote, devLaunchRoute, routeCabin, setRouteCabin, setSeries } from '.';

const newGame = (seed = 13) => createGame({ name: 'Atlântica Wings', code: 'AW', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed });
const biggest = (g: GameState) => Object.values(g.fleet).sort((a, b) => b.cabin.total - a.cabin.total)[0];
const run = (g: GameState, days: number) => {
  const end = g.now + days * DAY;
  while (g.now < end) advanceTo(g, Math.min(end, g.now + DAY), new Set());
};
const live = (g: GameState, id: string) => g.network!.routes[id].rotations.filter((x) => (x.status === 'planned' || x.status === 'flights') && x.dep > g.now && !x.sectors.some((s) => s.accrued));

/** A route on sale selling business and economy on an all-economy aircraft (the player's Lisbon–Bissau). */
function twoClassRoute() {
  const g = newGame();
  const ac = biggest(g);
  expect(ac.cabin.j + ac.cabin.w).toBe(0);
  const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
  expect(setRouteCabin(g, id, 'two-class')).toBeNull();
  run(g, 3);
  return { g, id, ac };
}

describe('v0.23.1 a route cabin: business and economy, or economy only', () => {
  it('the quote compares both cabins a flight, from the demand and fare model; selling business with no business seats costs downgrades', () => {
    const { g, id } = twoClassRoute();
    expect(routeCabin(g, g.network!.routes[id])).toBe('two-class');
    const q = cabinQuote(g, id, 'all-economy')!;
    expect(q).toBeTruthy();
    expect(q.from.cabin).toBe('two-class');
    expect(q.to.cabin).toBe('all-economy');
    expect(q.from.seatsJ).toBeGreaterThan(0);
    expect(q.to.seatsJ).toBe(0);
    // The economy cabin of the type seats more (business seats take more room).
    expect(q.to.seats).toBeGreaterThan(q.from.seats);
    for (const s of [q.from, q.to]) {
      expect(s.pax).toBeGreaterThan(0);
      expect(s.lf).toBeGreaterThan(0);
      expect(s.lf).toBeLessThanOrEqual(1);
      expect(s.yieldPax).toBeGreaterThan(0);
      expect(s.flights).toBeGreaterThan(0);
      expect(Math.abs(s.rev - s.cost - s.result)).toBeLessThanOrEqual(12); // months rounded
    }
    // Business pays more a passenger; economy only carries no business passengers.
    expect(q.from.yieldPax).toBeGreaterThan(q.to.yieldPax);
    expect(q.to.paxJ).toBe(0);
    // The aircraft has no business seats: the business side carries the downgrades on the day.
    expect(q.noJSeats).toBe(true);
    expect(q.from.downgrades).toBeGreaterThan(0);
    expect(q.to.downgrades).toBe(0);
    expect(q.departures).toBe(live(g, id).length);
    expect(q.first).toBe(Math.min(...live(g, id).map((x) => x.dep)));
  });

  it('economy only: every departure on sale re-filed at once, business passengers moved now with the Art. 10 refund out of the ticket cash', () => {
    const { g, id, ac } = twoClassRoute();
    const r = g.network!.routes[id];
    const before = live(g, id);
    const bookedJ = before.reduce((a, x) => a + x.sectors.reduce((b, s) => b + s.bookedJ, 0), 0);
    const bookedAll = before.reduce((a, x) => a + x.sectors.reduce((b, s) => b + s.bookedJ + s.bookedY, 0), 0);
    expect(bookedJ).toBeGreaterThan(0);
    const q = cabinQuote(g, id, 'all-economy')!;
    expect(q.bookedJ).toBeGreaterThan(0);
    expect(q.refund).toBeGreaterThan(0);
    const cash0 = g.company.cash;
    const unearned0 = r.unearned;
    const flown = r.rotations.filter((x) => x.status === 'flown').map((x) => JSON.stringify(x.sectors));
    expect(setRouteCabin(g, id, 'all-economy')).toBeNull();
    // Refunds: cash and the ticket cash held go down by the same amount, at most the quote.
    const paid = cash0 - g.company.cash;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(q.refund);
    expect(unearned0 - r.unearned).toBe(paid);
    const after = live(g, id);
    expect(after.length).toBe(before.length);
    for (const x of after) for (const s of x.sectors) {
      expect(s.capJ).toBe(0);
      expect(s.bookedJ).toBe(0);
      // Its aircraft's own seats when it has one, else the type's economy cabin.
      if (x.aircraftId) expect(s.capY).toBe(g.fleet[x.aircraftId].cabin.total);
    }
    // Nobody lost a seat; flown rotations untouched; the timetable sells economy from now on.
    expect(after.reduce((a, x) => a + x.sectors.reduce((b, s) => b + s.bookedJ + s.bookedY, 0), 0)).toBe(bookedAll);
    expect(r.rotations.filter((x) => x.status === 'flown').map((x) => JSON.stringify(x.sectors))).toEqual(flown);
    expect(r.series.every((s) => s.layout === 'all-economy')).toBe(true);
    expect(routeCabin(g, r)).toBe('all-economy');
    expect(g.messages[0].title).toMatch(/economy only/);
    void ac;
    // Days later: no business sold, no downgrade on the day.
    const downs = g.network!.stats.downgrades;
    run(g, 10);
    for (const x of live(g, id)) for (const s of x.sectors) expect(s.bookedJ).toBe(0);
    expect(g.network!.stats.downgrades).toBe(downs);
  });

  it('back to business and economy: business seats on sale again, no refund; the same cabin twice changes nothing', () => {
    const { g, id } = twoClassRoute();
    expect(setRouteCabin(g, id, 'all-economy')).toBeNull();
    const cash = g.company.cash;
    expect(setRouteCabin(g, id, 'all-economy')).toBeNull();
    expect(g.company.cash).toBe(cash);
    const q = cabinQuote(g, id, 'two-class')!;
    expect(q.from.cabin).toBe('all-economy');
    expect(q.refund).toBe(0);
    expect(setRouteCabin(g, id, 'two-class')).toBeNull();
    expect(g.company.cash).toBe(cash);
    for (const x of live(g, id)) for (const s of x.sectors) expect(s.capJ).toBeGreaterThan(0);
    expect(routeCabin(g, g.network!.routes[id])).toBe('two-class');
  });

  it('the timetable editor changing the cabin does the same (seats re-filed, business passengers moved with their refund)', () => {
    const { g, id } = twoClassRoute();
    const r = g.network!.routes[id];
    const bookedJ = live(g, id).reduce((a, x) => a + x.sectors.reduce((b, s) => b + s.bookedJ, 0), 0);
    expect(bookedJ).toBeGreaterThan(0);
    const cash = g.company.cash;
    expect(setSeries(g, id, { ...r.series[0], layout: 'all-economy' })).toBeNull();
    expect(g.company.cash).toBeLessThan(cash);
    for (const x of live(g, id)) for (const s of x.sectors) {
      expect(s.capJ).toBe(0);
      expect(s.bookedJ).toBe(0);
    }
  });

  it('final debug round: a departure another operator flies keeps its cabin and is not refunded; the quote counts the refund and the cash after', () => {
    const { g, id } = twoClassRoute();
    const r = g.network!.routes[id];
    const sub = live(g, id).find((x) => x.sectors.some((s) => s.bookedJ > 0))!;
    sub.operatedBy = 'rv1';
    const subJ = JSON.stringify(sub.sectors.map((s) => [s.capJ, s.capY, s.bookedJ, s.bookedY, s.sold]));
    const q = cabinQuote(g, id, 'all-economy')!;
    expect(q.departures).toBe(live(g, id).length - 1);
    expect(q.cashAfter).toBe(Math.round(g.company.cash - q.refund));
    const cash0 = g.company.cash;
    expect(setRouteCabin(g, id, 'all-economy')).toBeNull();
    expect(cash0 - g.company.cash).toBe(q.refund);
    expect(JSON.stringify(sub.sectors.map((s) => [s.capJ, s.capY, s.bookedJ, s.bookedY, s.sold]))).toBe(subJ);
    expect(routeCabin(g, r)).toBe('all-economy');
  });

  it('final debug round: a save whose timetable sells economy only but whose departures still sell business is switched at load', () => {
    const { g, id } = twoClassRoute();
    const r = g.network!.routes[id];
    // (Before v0.23.1 the timetable's cabin changed alone.)
    for (const s of r.series) s.layout = 'all-economy';
    expect(routeCabin(g, r)).toBe('two-class');
    const h = deserialize(serialize(g));
    const r2 = h.network!.routes[id];
    expect(routeCabin(h, r2)).toBe('all-economy');
    for (const x of live(h, id)) for (const s of x.sectors) expect(s.capJ + s.bookedJ).toBe(0);
    expect(h.company.cash).toBeLessThan(g.company.cash);
  });

  it('final debug round: economy only on an aircraft with business seats boards economy into every seat (no denied boarding)', () => {
    const g = newGame();
    const ac = biggest(g);
    const two = cabinFor(ac.typeId, 'two-class');
    ac.cabin = { ...ac.cabin, j: two.j, w: 0, y: two.y, total: two.total, label: two.label, layout: 'two-class' };
    const id = devLaunchRoute(g, 'LIS-OXB', ac.id);
    const r = g.network!.routes[id];
    run(g, 3);
    expect(setRouteCabin(g, id, 'all-economy')).toBeNull();
    const rot = r.rotations.find((x) => x.dep > g.now + DAY && x.sectors.every((s) => !s.accrued) && x.aircraftId === ac.id)!;
    for (const s of rot.sectors) {
      expect(s.capY).toBe(ac.cabin.total);
      const add = s.capY - s.bookedY;
      s.bookedY = s.capY;
      s.sold = (s.sold ?? 0) + add * 150;
      r.unearned += add * 150;
    }
    const end = rot.dep + 2 * DAY;
    while (g.now < end) advanceTo(g, Math.min(end, g.now + 120), new Set());
    expect(rot.sectors.every((s) => !s.denied)).toBe(true);
    expect(rot.sectors[0].flownY).toBeGreaterThan(ac.cabin.y);
  });

  it('a partner route: the partner sells the seats (no quote, refused)', () => {
    const { g, id } = twoClassRoute();
    g.network!.routes[id].model = 'partner';
    expect(cabinQuote(g, id, 'all-economy')).toBeNull();
    expect(setRouteCabin(g, id, 'all-economy')).toMatch(/partner/);
    expect(setRouteCabin(g, 'nope', 'all-economy')).toMatch(/no longer/);
  });
});
