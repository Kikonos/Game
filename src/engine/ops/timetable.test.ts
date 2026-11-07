// Rotations round (v0.16.4): crew tickets are booked onto a fixed, deterministic timetable per route (ops/commercial.ts
// departures): the same named flight never shows twice at different times, later bookings join the same departure, a
// sold-out departure is passed over and named, and an older save's tickets move onto the timetable where the crew
// still connect.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, dubBase, newGame, run } from '../contracts/testkit';
import { addDeadhead, retimeFlight, touchTickets } from '../core/entities';
import { DAY } from '../core/time';
import { deserialize, serialize } from '../save';
import { planHome, planHomeAfter, ticketSlotOk, touchCrew } from '../crew/timeline';
import { retimeToTimetable } from '../crew/roster';
import { departures, flightNoAt, fullDeparture, isDeparture, itinerary, nextDeparture, prevDeparture, ticketBlock } from './commercial';

const DAY0 = Math.floor((Date.UTC(2027, 5, 10) / 60000 - Date.UTC(2000, 0, 1) / 60000) / DAY);

describe('the ticket timetable', () => {
  it('is deterministic, sorted, on whole hours, with more departures on big short pairs than thin long ones', () => {
    const a = departures('LIS', 'HAM', DAY0);
    expect(a).toEqual(departures('LIS', 'HAM', DAY0));
    expect(a.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < a.length; i++) expect(a[i]).toBeGreaterThan(a[i - 1]);
    for (const t of a) expect(t % 60).toBe(0);
    for (const t of a) expect(isDeparture('LIS', 'HAM', t)).toBe(true);
    expect(isDeparture('LIS', 'HAM', a[0] + 60)).toBe(a.includes(a[0] + 60));
    // A long thin pair flies less often than a short trunk pair, over a week.
    const week = (from: string, to: string) => Array.from({ length: 7 }, (_, i) => departures(from, to, DAY0 + i).length).reduce((x, y) => x + y, 0);
    expect(week('LIS', 'MIA')).toBeLessThan(week('LIS', 'MAD'));
    expect(week('LIS', 'MIA')).toBeGreaterThan(0);
  });

  it('next and previous departures bracket a time; flight numbers differ by departure and keep their number every day', () => {
    const t = DAY0 * DAY + 10 * 60;
    const n = nextDeparture('LIS', 'HAM', t)!;
    const p = prevDeparture('LIS', 'HAM', t)!;
    expect(n).toBeGreaterThanOrEqual(t);
    expect(p).toBeLessThanOrEqual(t);
    const today = departures('LIS', 'HAM', DAY0);
    const nos = today.map((x) => flightNoAt('LIS', 'HAM', x));
    expect(new Set(nos).size).toBe(nos.length);
    const tomorrow = departures('LIS', 'HAM', DAY0 + 1);
    if (tomorrow.length === today.length) expect(tomorrow.map((x) => flightNoAt('LIS', 'HAM', x))).toEqual(nos);
    // The itinerary of a timetable departure carries that number.
    expect(itinerary('LIS', 'HAM', today[0], today[0] + ticketBlock('LIS', 'HAM'))[0].no).toBe(nos[0]);
  });

  it('a sold-out departure is rare and deterministic', () => {
    let full = 0;
    let all = 0;
    for (let d = DAY0; d < DAY0 + 60; d++) for (const x of departures('LIS', 'HAM', d)) {
      all++;
      if (fullDeparture('LIS', 'HAM', x)) full++;
      expect(fullDeparture('LIS', 'HAM', x)).toBe(fullDeparture('LIS', 'HAM', x));
    }
    expect(all).toBeGreaterThan(100);
    expect(full / all).toBeLessThan(0.12);
  });

  it('planned tickets home leave on timetable departures, and a seat search only accepts them', () => {
    const g = newGame(21);
    const d = { report: DAY0 * DAY + 8 * 60, release: DAY0 * DAY + 16 * 60, restAt: 'HAM', augment: 0 } as never;
    const h = planHome(d, 'LIS');
    expect(isDeparture('HAM', 'LIS', h.std)).toBe(true);
    expect(h.std).toBeGreaterThanOrEqual(DAY0 * DAY + 17 * 60);
    const h2 = planHomeAfter(d, 'LIS', 36 * 60);
    expect(isDeparture('HAM', 'LIS', h2.std)).toBe(true);
    const off = departures('HAM', 'LIS', DAY0 + 1).find((x) => !departures('HAM', 'LIS', DAY0 + 1).includes(x + 60))! + 60;
    expect(ticketSlotOk(g, 'HAM', 'LIS', off, off + ticketBlock('HAM', 'LIS'))).toBe(false);
  });

  it('a base crewed from Lisbon books every ticket on the timetable; crew of one trip on one departure share a booking', () => {
    const g = newGame(21);
    const o = dubBase(g, g.now + 3 * DAY, 30);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    run(g, g.contracts[r.data!.contractId].start + 2 * DAY);
    const tickets = Object.values(g.flights).filter((f) => f.kind === 'deadhead' && !f.charter && f.crewIds.length);
    expect(tickets.length).toBeGreaterThan(0);
    for (const f of tickets) expect(isDeparture(f.from, f.to, f.std), `${f.from}-${f.to} ${f.std}`).toBe(true);
    // No two bookings of one trip on the same departure.
    const seen = new Map<string, string>();
    for (const d of Object.values(g.duties)) {
      for (const fid of d.deadheadIds) {
        const f = g.flights[fid];
        if (!f || f.kind !== 'deadhead' || f.status !== 'scheduled') continue;
        const k = `${d.id}|${f.from}|${f.to}|${f.std}`;
        expect(seen.get(k), k).toBeUndefined();
        seen.set(k, f.id);
      }
    }
  });

  it('an older save: a future ticket off the timetable moves onto it when the crew still connect; a flown one stays', () => {
    const g = newGame(21);
    const o = dubBase(g, g.now + 3 * DAY, 30);
    o.broker = undefined;
    const r = acceptOffer(g, o.id, [leased(g).id]);
    if (!r.ok) throw new Error(r.error);
    run(g, g.contracts[r.data!.contractId].start - DAY);
    // (v0.17.2 a ticket either way: crew home may ride our own legs now.)
    const t = Object.values(g.flights).find((f) => f.kind === 'deadhead' && f.status === 'scheduled' && f.std > g.now + DAY && (f.to === 'LIS' || f.from === 'LIS'))!;
    expect(t).toBeTruthy();
    // As an older build booked it: 25 minutes off the hour, off the timetable.
    retimeFlight(g, t, t.std + 25, t.sta + 25);
    const flown = addDeadhead(g, { crewIds: [t.crewIds[0]], from: 'LIS', to: 'DUB', std: g.now - 3 * DAY, sta: g.now - 3 * DAY + 180, cost: 0 });
    flown.status = 'done';
    touchTickets(g);
    touchCrew(g);
    expect(isDeparture(t.from, t.to, t.std)).toBe(false);
    const h = deserialize(serialize(g));
    const t2 = h.flights[t.id];
    expect(isDeparture(t2.from, t2.to, t2.std)).toBe(true);
    // (A ticket home moves to a later departure; v0.17.2 a ticket out may move to an earlier one that still connects.)
    if (t.to === 'LIS') expect(t2.std).toBeGreaterThanOrEqual(t.std);
    else expect(Math.abs(t2.std - t.std)).toBeLessThanOrEqual(3 * 60);
    expect(h.flights[flown.id].std).toBe(flown.std);
    expect(retimeToTimetable(h)).toBe(0);
  });
});
