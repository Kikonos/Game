// v0.12.1 crew deadheading on our own passenger flights. A former ACMI flight attendant: "Sometimes we would deadhead
// on our own flights as passengers with other passengers if it served the destination we needed to deadhead to (long-
// term base, crew rotations, and one of the destinations was Lisbon)." Here: a long-term base at Dublin flying
// Dublin–Lisbon, crews from Lisbon. The crew changing over at the base ride the contract's own LIS–DUB and DUB–LIS
// flights in the seats nobody bought, instead of airline tickets.

import { describe, expect, it } from 'vitest';
import { acceptOffer } from '../contracts';
import { leased, newGame, offer, run } from '../contracts/testkit';
import { cancelFlight, touchFlights } from '../core/entities';
import { DAY } from '../core/time';
import type { Flight, GameState, Pairing } from '../core/types';
import { delayFlight } from '../ops';
import { deserialize, serialize } from '../save';
import { advanceTo } from '../sim';
import { crewCalendar } from './calendar';
import { applyCrewFix, crewControl } from './control';
import { releaseCrew, setFlightsCrew } from './roster';
import { openDuties } from './check';
import { outTicket, rideRoom, rideSeats, ridersText, ridesAllowed } from './timeline';
import { rollingRoster } from '../../test/rolling';

// v0.18.1 built on the rolling 14-day roster (see src/test/rolling.ts).
rollingRoster();

/** The Dublin base (home base Lisbon), played to 36 days in: tours have changed over at least once. */
function dublin(seed = 21, days = 36): { g: GameState; k: string; ac: string } {
  const g = newGame(seed);
  const ac = leased(g);
  const o = offer(g, 'seasonBase', { airport: 'DUB', dests: ['LIS'], waves: 2, start: g.now + 3 * DAY, days: 60 });
  o.broker = undefined;
  const r = acceptOffer(g, o.id, [ac.id]);
  if (!r.ok) throw new Error(r.error);
  const k = r.data!.contractId;
  run(g, g.contracts[k].start + days * DAY);
  return { g, k, ac: ac.id };
}

const revenue = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
/** A ride still to fly on the contract's own LIS–DUB flight, with the tour it takes its riders to. */
function rideOut(g: GameState, k: string, after = 0): { f: Flight; p: Pairing } {
  for (const f of Object.values(g.flights).sort((a, b) => a.std - b.std)) {
    if (f.contractId !== k || !revenue(f) || f.from !== 'LIS' || f.status !== 'scheduled' || !f.riders?.length || f.std < after) continue;
    const p = Object.values(g.pairings).find((q) => q.tour && openDuties(g, q)[0]?.deadheadIds.includes(f.id));
    if (p) return { f, p };
  }
  throw new Error('no ride out');
}

describe('v0.12.1 crew riding our own passenger flights', () => {
  it('the crew changing over at the base ride its own LIS–DUB and DUB–LIS flights, not airline tickets', () => {
    const { g, k } = dublin();
    const flown = Object.values(g.flights).filter((f) => f.contractId === k && revenue(f) && f.status === 'done' && f.riders?.length);
    expect(flown.some((f) => f.from === 'LIS' && f.to === 'DUB')).toBe(true);
    expect(flown.some((f) => f.from === 'DUB' && f.to === 'LIS')).toBe(true);
    const { f, p } = rideOut(g, k);
    expect(f.riders!.length).toBeLessThanOrEqual(rideSeats(g, f));
    // Those riders hold no airline ticket out to Dublin.
    const tix = Object.values(g.flights).filter((t) => t.kind === 'deadhead' && t.status === 'scheduled' && t.to === 'DUB');
    for (const id of f.riders!) expect(tix.some((t) => t.crewIds.includes(id))).toBe(false);
    // Chosen over a ticket: with our flights full, the same trip's crew would fly out on an airline ticket.
    const d = openDuties(g, p)[0];
    expect(outTicket(g, p, d, 'LIS').plan.rideId).toBe(f.id);
    const full = Object.values(g.flights).filter((x) => x.contractId === k && revenue(x) && x.status === 'scheduled');
    for (const x of full) x.pax = 999;
    const t = outTicket(g, p, d, 'LIS');
    expect(t.plan.rideId).toBeUndefined();
    expect(t.why).toBeNull();
    for (const x of full) delete x.pax;
  });

  it('free seats: the cabin less passengers, crew in passenger seats and other riders; no fixed cap; the client must allow it', () => {
    const { g, k } = dublin();
    const { f } = rideOut(g, k);
    const ac = g.fleet[f.aircraftId!];
    // A wet lease's client sells the seats: a typical 85 % load when none are booked.
    expect(f.pax).toBeUndefined();
    expect(rideSeats(g, f)).toBe(ac.cabin.total - Math.round(ac.cabin.total * 0.85));
    expect(rideRoom(g, f)).toBe(rideSeats(g, f) - f.riders!.length);
    f.pax = ac.cabin.total - 30;
    expect(rideSeats(g, f)).toBe(30);
    expect(ridersText(g, f)).toBe(`${f.riders!.length} (seats ${30 - f.riders!.length} free)`);
    // A deportation flight's client never lets our crew sit among its passengers.
    g.contracts[k].archetype = 'deportation';
    expect(ridesAllowed(g, f)).toBe(false);
    expect(rideSeats(g, f)).toBe(0);
  });

  it('the crew calendar reads the ride as our own flight, no ticket', () => {
    const { g, k } = dublin();
    const { f } = rideOut(g, k);
    const cal = crewCalendar(g, f.riders![0], g.now, g.now + 14 * DAY);
    const b = cal.find((x) => x.kind === 'positioning' && x.flightIds?.includes(f.id));
    expect(b?.detail).toMatch(new RegExp(`^Riding ${f.no} LIS–DUB · own flight, no ticket`));
  });

  it('seats filled by a change: the riders come off and are rebooked (another of our flights with seats, else an airline ticket)', () => {
    const { g, k } = dublin();
    const { f, p } = rideOut(g, k);
    const ids = [...f.riders!];
    f.pax = g.fleet[f.aircraftId!].cabin.total;
    touchFlights(g);
    advanceTo(g, g.now + 1);
    expect(f.riders ?? []).toEqual([]);
    const d = openDuties(g, p)[0];
    expect(d.deadheadIds).not.toContain(f.id);
    for (const id of ids) {
      if (!p.slots.some((s) => s.crewId === id)) continue;
      const way = d.deadheadIds.map((x) => g.flights[x]).find((t) => !!t && t.status === 'scheduled' && (t.kind === 'deadhead' ? t.crewIds : t.riders ?? []).includes(id));
      expect(way, id).toBeTruthy();
      // Never back onto a full flight.
      if (way!.kind !== 'deadhead') expect(way!.riders!.length).toBeLessThanOrEqual(rideSeats(g, way!));
    }
    // With every flight full, an airline ticket.
    for (const x of Object.values(g.flights)) if (x.contractId === k && revenue(x) && x.status === 'scheduled') x.pax = g.fleet[x.aircraftId!].cabin.total;
    touchFlights(g);
    advanceTo(g, g.now + 1);
    for (const id of ids) {
      if (!p.slots.some((s) => s.crewId === id)) continue;
      expect(d.deadheadIds.some((x) => g.flights[x]?.kind === 'deadhead' && g.flights[x].crewIds.includes(id)), id).toBe(true);
    }
  });

  /** Each rider still on the trip has a way out again: a ticket, another of our flights, or (v0.14) the first leg of
   *  their next duty leaving from where they are. */
  const wayOut = (g: GameState, p: Pairing, ids: string[], gone: string) => {
    const d = openDuties(g, p)[0];
    expect(d.deadheadIds).not.toContain(gone);
    for (const id of ids) {
      if (!p.slots.some((s) => s.crewId === id)) continue;
      const carried = d.deadheadIds.some((x) => {
        const t = g.flights[x];
        return !!t && t.status === 'scheduled' && (t.kind === 'deadhead' ? t.crewIds : t.riders ?? []).includes(id);
      });
      const operates = g.flights[d.flightIds[0]]?.from === g.crew[id].loc && g.flights[d.flightIds[0]]?.crewIds.includes(id);
      expect(carried || operates, id).toBe(true);
    }
  };

  it('a cancelled flight: its riders are rebooked at once (a ride days out: an airline ticket or another of ours)', () => {
    // (v0.17.2 the sets change a day apart from day 35: played to day 31, the changes are days out.)
    const { g, k } = dublin(21, 31);
    const { f, p } = rideOut(g, k, g.now + 3 * DAY);
    const ids = [...f.riders!];
    cancelFlight(g, f, 'Test');
    advanceTo(g, g.now + 1);
    wayOut(g, p, ids, f.id);
  });

  it('v0.14 a ride cancelled a day out: the riders are not stranded (they crew the empty leg that takes the aircraft out)', () => {
    // The calls merge had moved the case above to a ride 3+ days out ("one a day out finds no ticket in time"). The
    // first ride here is 32 h out: cancelling the LIS–DUB leg leaves the aircraft at Lisbon, schedule recovery flies it
    // to Dublin empty, and the riders (in Lisbon, due in Dublin) are its crew: no ticket needed, and they get there.
    // v0.14 seed 22: the market's offer stream changed the draws (on seed 21 the first ride is now 80 h out).
    // v0.18.1 seed 23: leave by request changed who is free (on 22 the case no longer forms).
    // v0.14.1 the offer stream moved again (the Newcomer pace): the clock goes on to 32 h before the next ride, so the
    // case no longer hangs on where a seed's first ride falls.
    const { g, k } = dublin(23);
    let { f, p } = rideOut(g, k);
    if (f.std - g.now >= 2 * DAY) {
      run(g, f.std - 32 * 60);
      ({ f, p } = rideOut(g, k, g.now));
    }
    expect(f.std - g.now).toBeLessThan(2 * DAY);
    const ids = [...f.riders!];
    cancelFlight(g, f, 'Test');
    advanceTo(g, g.now + 1);
    wayOut(g, p, ids, f.id);
    // They reach the trip: its first duty from Dublin is flown with them aboard.
    const dub = openDuties(g, p).find((d) => g.flights[d.flightIds[0]]?.from === f.to)!;
    const first = g.flights[dub.flightIds[0]];
    run(g, first.sta + 60);
    expect(first.status).toBe('done');
    for (const id of ids) if (p.slots.some((s) => s.crewId === id)) expect(first.crewIds, id).toContain(id);
  });

  it('a delayed flight takes its riders late: they land with it, and their rest runs from the late landing', () => {
    // v0.18.1 seed 23 (leave by request changed the draws on 22).
    // v0.14 seed 22: the market's offer stream changed the draws; on seed 21 (and 23) the ride now also meets a random
    // delay on top of the test's 90 minutes and no positioning entry ends at the landing (a crew-log case, not this one).
    const { g, k } = dublin(23);
    const { f } = rideOut(g, k);
    const id = f.riders![0];
    expect(delayFlight(g, f.id, 90, 'Test').ok).toBe(true);
    run(g, f.sta + 12 * 60);
    expect(f.status).toBe('done');
    const c = g.crew[id];
    expect(c.loc).not.toBe('LIS');
    expect(f.riders).toContain(id);
    // The positioning is logged to the real landing.
    expect(c.log.some((e) => e.end === f.ata)).toBe(true);
  });

  it('a save keeps the riders and plays on identically', () => {
    const { g, k } = dublin();
    const { f } = rideOut(g, k);
    const h = deserialize(serialize(g));
    expect(h.flights[f.id].riders).toEqual(f.riders);
    run(g, g.now + 2 * DAY);
    run(h, h.now + 2 * DAY);
    const a = JSON.parse(serialize(g));
    const b = JSON.parse(serialize(h));
    delete a.meta;
    delete b.meta;
    const diff = (x: any, y: any, path: string): string | null => {
      if (JSON.stringify(x) === JSON.stringify(y)) return null;
      if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return `${path}: ${JSON.stringify(x)?.slice(0, 200)} vs ${JSON.stringify(y)?.slice(0, 200)}`;
      for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) { const r = diff(x[kk], y[kk], `${path}.${kk}`); if (r) return r; }
      return path;
    };
    expect(diff(a, b, '')).toBeNull();
  });

  it("v0.12.1 Crew Control's Fly someone in seats the crew its list shows (a day off between a tour's duties is no bar)", () => {
    // v0.16 (inbound offers halved) seed 21's roster has nobody free elsewhere on the day; seed 22 has the same shape with spare crew.
    const { g } = dublin(23);
    // A first officer taken off a tour starting days ahead.
    const p = Object.values(g.pairings).filter((q) => q.tour && q.status === 'planned' && q.start > g.now + DAY && q.slots.some((s) => s.crewId && s.role === 'FO')).sort((a, b) => a.start - b.start)[0];
    expect(p).toBeDefined();
    releaseCrew(g, p, p.slots.find((s) => s.crewId && s.role === 'FO')!.crewId!);
    setFlightsCrew(g, p);
    const f = g.flights[openDuties(g, p)[0].flightIds[0]];
    const dh = crewControl(g, f.id)!.solutions.find((x) => x.id === 'deadhead')!;
    expect(dh.options?.length ?? 0).toBeGreaterThan(0);
    // Listed means seatable: never 'not now · Nobody legal can be flown in' beside a list of legal crew.
    expect(dh.available, dh.why).toBe(true);
    const r = applyCrewFix(g, f.id, 'deadhead', { confirmed: true, crewIds: [dh.options![0].id] });
    expect(r.ok).toBe(true);
    expect(p.slots.some((s) => s.crewId === dh.options![0].id)).toBe(true);
  });
});
