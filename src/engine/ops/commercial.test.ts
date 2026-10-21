// v0.5.2 commercial deadheads: real carriers per route, flight numbers, connections, map reads.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { CARRIER_BY_IATA, CARRIERS } from '../../data/carriers';
import { addDeadhead } from '../core/entities';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from '../crew/fixtures';
import { commercialFlightsAirborne, commercialFlightsBetween, commercialItinerary, commercialProgress, CONNECT_MIN, itinerary, ticketBlock } from './commercial';
import { flightType } from './flightType';

const T0 = 14_300_000;

describe('carrier table', () => {
  it('real IATA codes, unique, hubs in the airport list', () => {
    expect(new Set(CARRIERS.map((c) => c.iata)).size).toBe(CARRIERS.length);
    for (const c of CARRIERS) {
      expect(c.iata).toMatch(/^[A-Z0-9]{2}$/);
      for (const h of c.hubs) expect(AIRPORT_BY_CODE[h], `${c.iata} ${h}`).toBeTruthy();
    }
  });
});

describe('itineraries', () => {
  it('home carriers and low-cost airlines on European routes', () => {
    const lisVno = new Set<string>();
    for (let d = 0; d < 30; d++) lisVno.add(itinerary('LIS', 'VNO', T0 + d * 1440, T0 + d * 1440 + ticketBlock('LIS', 'VNO'))[0].iata);
    expect([...lisVno].every((x) => ['TP', 'FR', 'W6', 'BT', 'U2', 'LO'].includes(x))).toBe(true);
    expect(lisVno.has('BT')).toBe(true);
    const fra = itinerary('FRA', 'MUC', T0, T0 + ticketBlock('FRA', 'MUC'));
    expect(fra).toHaveLength(1);
    expect(fra[0].iata).toBe('LH');
  });

  it('long haul with a link flies nonstop; elsewhere one connection at a hub, the same airline through its hub', () => {
    const jfk = itinerary('LIS', 'JFK', T0, T0 + ticketBlock('LIS', 'JFK'));
    expect(jfk).toHaveLength(1);
    expect(['TP', 'DL', 'B6', 'UA', 'AA']).toContain(jfk[0].iata);
    const nbo = itinerary('LIS', 'NBO', T0, T0 + ticketBlock('LIS', 'NBO'));
    expect(nbo).toHaveLength(2);
    expect(nbo[0].to).toBe(nbo[1].from);
    const hubAirline = CARRIER_BY_IATA[nbo[0].iata];
    if (hubAirline.hubs.includes(nbo[0].to)) expect(nbo[1].iata).toBe(nbo[0].iata);
    expect(nbo[1].dep - nbo[0].arr).toBe(CONNECT_MIN);
    expect(ticketBlock('LIS', 'NBO')).toBe(nbo[0].arr - nbo[0].dep + CONNECT_MIN + nbo[1].arr - nbo[1].dep);
  });

  it('flight numbers: airline code, stable per route, odd/even by direction', () => {
    const a = itinerary('LIS', 'MAD', T0, T0 + 80)[0];
    const b = itinerary('LIS', 'MAD', T0 + 7 * 1440, T0 + 7 * 1440 + 80).find(() => true)!;
    expect(a.no).toMatch(/^[A-Z0-9]{2} \d{1,4}$/);
    if (a.iata === b.iata) expect(a.no).toBe(b.no);
    const back = itinerary('MAD', 'LIS', T0, T0 + 80)[0];
    if (back.iata === a.iata) expect(Number(back.no.split(' ')[1]) % 2).not.toBe(Number(a.no.split(' ')[1]) % 2);
  });

  it('nearly every pair of our airports has a listed carrier for each leg, legs fit the ticket window', () => {
    const codes = AIRPORTS.filter((x) => x.size >= 2).map((x) => x.code);
    let missing = 0;
    let n = 0;
    for (let i = 0; i < codes.length; i += 7) {
      for (let j = 3; j < codes.length; j += 11) {
        if (codes[i] === codes[j]) continue;
        const blk = ticketBlock(codes[i], codes[j]);
        const legs = itinerary(codes[i], codes[j], T0, T0 + blk);
        n++;
        expect(legs[0].dep).toBe(T0);
        expect(legs[legs.length - 1].arr).toBe(T0 + blk);
        for (const l of legs) {
          expect(l.arr).toBeGreaterThan(l.dep);
          if (!CARRIERS.some((c) => c.iata === l.iata && c.name === l.airline)) missing++;
        }
      }
    }
    expect(missing).toBe(0);
    expect(n).toBeGreaterThan(100);
  });

  it('carriers that really fly the route; flag and hub carriers take most departures', () => {
    const ALLOW: Record<string, string[]> = {
      'LIS-CDG': ['TP', 'AF', 'U2'], 'LHR-LIS': ['BA', 'TP'], 'LIS-ORY': ['TP', 'AF', 'U2', 'VY', 'HV'], 'LIS-MAD': ['TP', 'IB', 'UX', 'FR', 'U2'],
      'LIS-CMN': ['TP', 'AT'], 'LIS-FRA': ['TP', 'LH'], 'DUB-LIS': ['EI', 'TP', 'FR'], 'AMS-DUB': ['KL', 'EI'], 'LIS-GRU': ['TP', 'LA'],
      'LGW-TFS': ['BA', 'U2'], 'FRA-MUC': ['LH'], 'LIS-JFK': ['TP', 'DL', 'B6', 'UA'], 'LIS-FNC': ['TP'], 'LIS-PDL': ['TP', 'S4'],
      'LIS-BCN': ['TP', 'VY', 'FR', 'U2'], 'LIS-OTP': ['TP', 'RO', 'FR', 'W6'], 'CFU-LIS': ['U2', 'FR'], 'LHR-MAD': ['BA', 'IB'],
      'CDG-FRA': ['AF', 'LH'], 'LIS-PRG': ['TP', 'QS', 'FR', 'U2'],
    };
    // Network-only or connecting: never a low-cost carrier.
    const VIA: Record<string, string[]> = { 'ADA-LIS': ['TK'], 'LIS-AYT': ['TK'], 'LIS-RUH': ['TK', 'EK', 'QR', 'EY'], 'LIS-SSH': ['MS', 'TK'] };
    const lcc = (x: string) => CARRIER_BY_IATA[x].kind === 'lcc';
    for (const [pair, ok] of Object.entries({ ...ALLOW, ...VIA })) {
      const [a, b] = pair.split('-');
      let home = 0;
      let n = 0;
      for (let d = 0; d < 40; d++) {
        for (const h of [7, 13, 19]) {
          const t = T0 + d * 1440 + h * 60;
          for (const l of itinerary(a, b, t, t + ticketBlock(a, b))) {
            expect(ok, `${pair} ${l.no}`).toContain(l.iata);
            n++;
            if (!lcc(l.iata)) home++;
          }
        }
      }
      if (home && ok.some(lcc)) expect(home / n, pair).toBeGreaterThan(0.6);
    }
  });

  it('each departure bank of a route is its own flight number, the same every day', () => {
    const no = (d: number, h: number) => {
      const t = T0 + d * 1440 + h * 60;
      return itinerary('FRA', 'MUC', t, t + 60)[0].no;
    };
    expect(new Set([no(0, 6), no(0, 12), no(0, 18)]).size).toBe(3);
    expect(no(5, 12)).toBe(no(0, 12));
  });

  it('old tickets booked with nonstop times still fit their window', () => {
    const legs = itinerary('LIS', 'NBO', T0, T0 + 420);
    expect(legs[0].dep).toBe(T0);
    expect(legs[legs.length - 1].arr).toBe(T0 + 420);
    expect(legs[1].dep).toBeGreaterThanOrEqual(legs[0].arr);
  });
});

describe('map reads', () => {
  it('airborne legs carry our crew, progress, and survive a save/load unchanged', () => {
    const g = fixtureGame(61);
    const ids = addCrew(g, { CPT: 1, CC: 2 });
    const std = g.now + 120;
    const f = addDeadhead(g, { crewIds: ids, from: 'LIS', to: 'NBO', std, sta: std + ticketBlock('LIS', 'NBO'), cost: 0 });
    expect(flightType(g, f)).toBe('deadhead');
    const legs = commercialItinerary(g, f);
    expect(legs).toHaveLength(2);
    expect(commercialFlightsAirborne(g, std - 1)).toHaveLength(0);
    const up = commercialFlightsAirborne(g, std + 30);
    expect(up).toHaveLength(1);
    expect(up[0].id).toBe(`${f.id}:0`);
    expect(up[0].crewIds).toEqual(ids);
    expect(commercialProgress(up[0], std + 30)).toBeGreaterThan(0);
    // During the connection nothing is airborne; then leg 2.
    expect(commercialFlightsAirborne(g, legs[0].arr + 10)).toHaveLength(0);
    expect(commercialFlightsAirborne(g, legs[1].dep + 10)[0].legIndex).toBe(1);
    expect(commercialFlightsBetween(g, std, f.sta)).toHaveLength(2);
    const g2 = deserialize(serialize(g));
    expect(commercialItinerary(g2, g2.flights[f.id])).toEqual(legs);
  });
});
