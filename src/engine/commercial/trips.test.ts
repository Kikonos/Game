// v0.14 sales trips and fairs: the calendar, who travels, tickets by the crew deadhead rules (the hour, seats that
// exist, the airline itinerary, the per-seat price), costs in the ledger, the traveller on the map, the payoff, a trip
// called off by a closure.

import { describe, expect, it } from 'vitest';
import { FAIR_BY_ID, FAIRS } from '../../data/fairs';
import { BAL } from '../core/balance';
import { DAY, fromUTC, localOffset } from '../core/time';
import type { GameState } from '../core/types';
import { ticketPrice } from '../crew/timeline';
import { newGame, run } from '../contracts/testkit';
import { commercialFlightsAirborne, commercialFlightsBetween, ticketBlock } from '../ops/commercial';
import { startEvent } from '../ops/world';
import { TPL_BY_ID } from '../../data/worldEvents';
import { com } from './state';
import { bookTrip, cancelTrip, dailyTrips, fairDays, fairsAhead, nextEdition, travellers, tripNow, tripQuote } from './trips';
import './index';

const sales = (g: GameState) => [...g.finance.history, g.finance.current].reduce((s, m) => s + (m.lines.sales ?? 0), 0);

describe('the fair calendar', () => {
  it('real 2027 editions: ITB 16–18 Mar, Routes Europe Antalya 20–22 Apr, Routes World Barcelona 17–19 Oct', () => {
    const itb = fairDays(FAIR_BY_ID.itb, 2027);
    expect(itb.start + localOffset('BER', itb.start)).toBe(fromUTC(2027, 3, 16, 8));
    expect(fairDays(FAIR_BY_ID.routesEurope, 2027).at).toBe('AYT');
    expect(fairDays(FAIR_BY_ID.routesWorld, 2027).at).toBe('BCN');
    expect(fairDays(FAIR_BY_ID.mroEurope, 2028).where).toMatch(/London/);
    // Every fair has a usual week for the years not listed.
    for (const f of FAIRS) expect(nextEdition(f, fromUTC(2031, 1, 1)).start).toBeGreaterThan(fromUTC(2031, 1, 1));
  });

  it('a new game (1 Mar 2027) sees ITB, Routes Europe and ATM ahead', () => {
    const g = newGame(21);
    const ids = fairsAhead(g).map((f) => f.id);
    expect(ids.slice(0, 3)).toEqual(['itb', 'routesEurope', 'atm']);
  });
});

describe('who travels', () => {
  it('you always; the commercial analyst once hired', () => {
    const g = newGame(22);
    expect(travellers(g).map((t) => t.who)).toEqual(['ceo']);
    expect(tripQuote(g, 'analyst', { fairId: 'itb' }).ok).toBe(false);
    g.heads!.analyst.hired = { name: 'Rita Lopes', skill: 0.8, salary: 9000, since: g.now };
    expect(travellers(g).map((t) => t.who)).toEqual(['ceo', 'analyst']);
    expect(tripQuote(g, 'analyst', { fairId: 'itb' }).ok).toBe(true);
  });
});

describe('tickets as crew deadheads', () => {
  it('on the hour, the airline itinerary times, priced per seat, landing the evening before', () => {
    const g = newGame(23);
    const q = tripQuote(g, 'ceo', { fairId: 'itb' });
    expect(q.ok).toBe(true);
    const home = g.company.homeBase;
    expect(q.out!.std % 60).toBe(0);
    expect(q.out!.sta - q.out!.std).toBe(ticketBlock(home, 'BER'));
    expect(q.out!.sta).toBeLessThanOrEqual(q.start);
    expect(q.back!.std).toBeGreaterThan(q.end);
    expect(q.tickets).toBe(ticketPrice(home, 'BER') * 2);
    expect(q.hotel).toBe(q.nights * BAL.hotelPerNight[g.company.policies.hotelTier]);
    expect(q.legsOut[0].no).toMatch(/^[A-Z0-9]{2} \d+$/);
    expect(q.total).toBe(q.tickets + q.pass + q.hotel + q.perDiem);
  });

  it('booking pays seats and the pass now, hotel and per diem on return; one trip at a time', () => {
    const g = newGame(24);
    const before = sales(g);
    const r = bookTrip(g, 'ceo', { fairId: 'itb' });
    expect(r.ok).toBe(true);
    const t = com(g).trips[0];
    expect(sales(g) - before).toBe(-(t.cost.tickets + t.cost.pass));
    expect(bookTrip(g, 'ceo', { fairId: 'routesEurope' }).ok).toBe(false);
    run(g, t.back.sta + DAY + 60);
    expect(t.status).toBe('done');
    expect(sales(g) - before).toBe(-(t.cost.tickets + t.cost.pass + t.cost.hotel + t.cost.perDiem));
    expect(t.met!.length).toBeGreaterThanOrEqual(3);
    expect(g.messages.some((m) => m.title.includes('is back from ITB Berlin'))).toBe(true);
  });

  it('the traveller rides the airline leg on the map (no crew aboard, their name), and says where they are', () => {
    const g = newGame(25);
    bookTrip(g, 'ceo', { fairId: 'itb' });
    const t = com(g).trips[0];
    const mid = Math.round((t.out.std + t.out.sta) / 2);
    const legs = commercialFlightsAirborne(g, mid);
    const mine = legs.find((c) => c.tripId === t.id);
    expect(mine).toBeTruthy();
    expect(mine!.crewIds).toEqual([]);
    expect(mine!.who).toBe(t.name);
    expect(commercialFlightsBetween(g, t.back.std, t.back.sta).some((c) => c.ticketId === `${t.id}~b`)).toBe(true);
    g.now = mid;
    expect(tripNow(g, t)).toMatch(/^Flying|^Connecting/);
  });

  it('a client visit: one client, more relation, meetings two days on', () => {
    const g = newGame(26);
    const cl = Object.values(g.clients).find((c) => c.name === 'Condor')!;
    const rel = cl.relation;
    const r = bookTrip(g, 'ceo', { clientId: cl.id });
    expect(r.ok).toBe(true);
    const t = com(g).trips[0];
    expect(t.kind).toBe('visit');
    expect(t.cost.pass).toBe(0);
    run(g, t.back.sta + DAY + 60);
    expect(t.met).toEqual([cl.id]);
    expect(g.clients[cl.id].relation).toBeGreaterThan(rel);
  });

  it('calling a trip off refunds the pass, not the seats', () => {
    const g = newGame(27);
    bookTrip(g, 'ceo', { fairId: 'itb' });
    const t = com(g).trips[0];
    const after = sales(g);
    expect(cancelTrip(g, t.id).ok).toBe(true);
    expect(sales(g) - after).toBe(t.cost.pass);
    expect(t.status).toBe('cancelled');
    expect(commercialFlightsBetween(g, t.out.std, t.out.sta).some((c) => c.tripId === t.id)).toBe(false);
  });

  it('a closure at the fair city before departure calls the trip off (with a note)', () => {
    const g = newGame(28);
    bookTrip(g, 'ceo', { fairId: 'routesEurope' });
    const t = com(g).trips[0];
    // Antalya airport shut over the outbound seat.
    const tpl = { ...Object.values(TPL_BY_ID).find((x) => !!x.airportDays)!, id: 'testAyt', at: 'AYT', country: 'TR', airportDays: [60, 60] as [number, number], days: [60, 60] as [number, number] };
    g.now = t.out.std - 3 * DAY;
    startEvent(g, tpl);
    run(g, t.out.std - DAY);
    expect(t.status).toBe('cancelled');
    expect(g.messages.some((m) => m.title.startsWith('Trip called off'))).toBe(true);
  });

  it('a fair trip in tender season can bring an invitation to tender (a lead)', () => {
    let leads = 0;
    let rfps = 0;
    for (const seed of [31, 32, 33, 34, 35, 36]) {
      const g = newGame(seed);
      g.now = fromUTC(2027, 10, 20);
      const r = bookTrip(g, 'ceo', { fairId: 'wtm' });
      if (!r.ok) continue;
      const t = com(g).trips[0];
      g.now = t.back.sta + 60;
      dailyTrips(g);
      expect(t.status).toBe('done');
      leads += t.leads?.length ?? 0;
      rfps += (t.leads ?? []).filter((l) => l.kind === 'rfp').length;
      for (const l of t.leads ?? []) {
        if (l.kind === 'rfp') expect(com(g).tenders.find((x) => x.id === l.tenderId)?.invited).toBe(true);
        else expect(g.offers[l.offerId!]?.firstRefusal).toBe(true);
      }
    }
    expect(leads).toBeGreaterThan(0);
    expect(rfps).toBeGreaterThanOrEqual(0);
  });
});
