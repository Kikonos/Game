// v0.5.2 commercial deadheads: real carriers per route, flight numbers, connections, map reads.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE, AIRPORTS } from '../../data/airports';
import { CARRIER_BY_IATA, CARRIERS } from '../../data/carriers';
import { addDeadhead } from '../core/entities';
import { deserialize, serialize } from '../save';
import { addCrew, fixtureGame } from '../crew/fixtures';
import { commercialFlightsAirborne, commercialFlightsBetween, commercialItinerary, commercialProgress, CONNECT_MIN, directCarriers, itinerary, LCC_ONLY, ticketBlock } from './commercial';
import { FACTORIES, LESSOR_SITES } from '../../data/market';
import { HOME_BASES } from '../../data/naming';
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
  }, 20_000);

  it('carriers that really fly the route; based low-cost carriers, then the home airlines, take the departures', () => {
    const ALLOW: Record<string, string[]> = {
      'LIS-CDG': ['TP', 'AF', 'U2'], 'LHR-LIS': ['BA', 'TP'], 'LIS-ORY': ['TP', 'AF', 'U2', 'VY', 'HV'], 'LIS-MAD': ['TP', 'IB', 'UX', 'FR', 'U2'],
      'LIS-CMN': ['TP', 'AT'], 'LIS-FRA': ['TP', 'LH'], 'DUB-LIS': ['EI', 'TP', 'FR'], 'AMS-DUB': ['KL', 'EI'], 'LIS-GRU': ['TP', 'LA'],
      'LGW-TFS': ['BA', 'U2'], 'FRA-MUC': ['LH'], 'LIS-JFK': ['TP', 'DL', 'B6', 'UA'], 'LIS-FNC': ['TP'], 'LIS-PDL': ['TP', 'S4'],
      'LIS-BCN': ['TP', 'VY', 'FR', 'U2'], 'LIS-OTP': ['TP', 'RO', 'FR', 'W6'], 'CFU-LIS': ['U2', 'FR', 'A3', 'TP'], 'LHR-MAD': ['BA', 'IB'],
      'CDG-FRA': ['AF', 'LH'], 'LIS-PRG': ['TP', 'QS', 'FR', 'U2'],
    };
    // Network-only or connecting: never a low-cost carrier.
    const VIA: Record<string, string[]> = { 'ADA-LIS': ['TK'], 'LIS-AYT': ['TK'], 'LIS-RUH': ['TK', 'EK', 'QR', 'EY'], 'LIS-SSH': ['MS', 'TK'] };
    const lcc = (x: string) => CARRIER_BY_IATA[x].kind === 'lcc';
    for (const [pair, ok] of Object.entries({ ...ALLOW, ...VIA })) {
      const [a, b] = pair.split('-');
      let home = 0;
      let n = 0;
      const seen: string[] = [];
      for (let d = 0; d < 40; d++) {
        for (const h of [7, 13, 19]) {
          const t = T0 + d * 1440 + h * 60;
          for (const l of itinerary(a, b, t, t + ticketBlock(a, b))) {
            expect(ok, `${pair} ${l.no}`).toContain(l.iata);
            seen.push(l.iata);
            n++;
            if (!lcc(l.iata)) home++;
          }
        }
      }
      // v0.6 tiers: a low-cost carrier based at either end takes most departures, else the home airlines all.
      const [x, y] = [a, b];
      const nonstop = itinerary(x, y, T0, T0 + ticketBlock(x, y)).length === 1;
      const based = seen.some((c) => lcc(c) && (CARRIER_BY_IATA[c].hubs.includes(x) || CARRIER_BY_IATA[c].hubs.includes(y)));
      // Half on a flag-carrier trunk route (a home airline's hub at either end).
      const trunk = seen.some((c) => !lcc(c) && (CARRIER_BY_IATA[c].hubs.includes(x) || CARRIER_BY_IATA[c].hubs.includes(y)));
      if (nonstop && based && home) expect(1 - home / n, pair).toBeGreaterThan(trunk ? 0.35 : 0.55);
      else if (nonstop && !based) expect(home / n, pair).toBeGreaterThan(0.95);
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

// v0.6 (UPDATE-0.6.md §C1): realistic deadhead airlines.
describe('realistic deadhead airlines', () => {
  const picks = (a: string, b: string, days = 30) => {
    const out = new Map<string, number>();
    const hubs = new Set<string>();
    for (let d = 0; d < days; d++) {
      for (const h of [6, 10, 14, 18, 22]) {
        const t = T0 + d * 1440 + h * 60;
        const legs = itinerary(a, b, t, t + ticketBlock(a, b));
        for (const l of legs) out.set(l.iata, (out.get(l.iata) ?? 0) + 1);
        if (legs.length > 1) hubs.add(legs[0].to);
      }
    }
    return { iatas: [...out.keys()].sort(), hubs: [...hubs] };
  };

  it('the pair table', () => {
    expect(picks('STN', 'DUB').iatas).toEqual(['FR']);
    expect(picks('DUB', 'STN').iatas).toEqual(['FR']);
    expect(picks('LGW', 'GVA').iatas).toContain('U2');
    expect(picks('BUD', 'OTP').iatas).toContain('W6');
    expect(picks('BCN', 'PMI').iatas).toContain('VY');
    const ory = picks('ORY', 'AGP').iatas;
    expect(ory.includes('HV') || ory.includes('VY')).toBe(true);
    const lde = picks('LDE', 'LIS');
    expect(lde.iatas).not.toContain('U2');
    expect(lde.hubs.length).toBeGreaterThan(0);
    for (const h of lde.hubs) expect(AIRPORT_BY_CODE[h].country).toBe('FR');
    const tfs = picks('TFS', 'OTP');
    expect(tfs.hubs.length).toBeGreaterThan(0);
    for (const h of tfs.hubs) expect(AIRPORT_BY_CODE[h].country, h).toBe('ES');
    const kbl = itinerary('LIS', 'KBL', T0, T0 + ticketBlock('LIS', 'KBL'));
    expect(kbl).toHaveLength(2);
    expect(['IST', 'DXB', 'DOH']).toContain(kbl[0].to);
    const opo = picks('LIS', 'OPO').iatas;
    expect(opo.every((x) => x === 'TP' || x === 'FR')).toBe(true);
  });

  it('low-cost carriers only on the markets their base flies; regional networks; seasonal nonstops', () => {
    // easyJet Lisbon flies to the UK, France, Switzerland, Italy… not to Scandinavia, Poland, Turkey or North Africa.
    for (const p of ['ARN-LIS', 'BUD-LIS', 'LIS-WAW', 'LIS-ADB', 'LIS-BJV', 'LIS-TUN', 'AMS-HEL']) expect(picks(...(p.split('-') as [string, string])).iatas, p).not.toContain('U2');
    for (const p of ['LIS-ALG', 'LIS-TUN']) {
      const x = picks(...(p.split('-') as [string, string])).iatas;
      expect(x, p).not.toContain('U2');
      expect(x, p).not.toContain('FR');
    }
    // Turkish leisure airports from Lisbon: Turkish via Istanbul.
    for (const to of ['ADB', 'BJV']) {
      const t = picks('LIS', to);
      expect(t.iatas, to).toEqual(['TK']);
      expect(t.hubs, to).toEqual(['IST']);
    }
    // Croatia Airlines does not fly Zagreb–Lisbon; it and Lufthansa fly Split / Dubrovnik–Frankfurt nonstop.
    for (let d = 0; d < 30; d++) {
      const t = T0 + d * 1440 + 9 * 60;
      const legs = itinerary('DBV', 'LIS', t, t + ticketBlock('DBV', 'LIS'));
      expect(legs.some((l) => l.iata === 'OU' && l.from === 'ZAG' && l.to === 'LIS')).toBe(false);
    }
    const spu = picks('SPU', 'FRA');
    expect(spu.hubs).toEqual([]);
    expect(spu.iatas.every((x) => x === 'LH' || x === 'OU')).toBe(true);
    // Vueling flies from its Barcelona base to Amsterdam.
    expect(picks('BCN', 'AMS').iatas).toContain('VY');
    // A trunk route between two flag carriers' hubs: the based low-cost carrier takes about half, not 70%.
    const n = { lcc: 0, all: 0 };
    for (let d = 0; d < 60; d++) {
      for (const h of [7, 13, 19]) {
        const t = T0 + d * 1440 + h * 60;
        for (const l of itinerary('LIS', 'CDG', t, t + ticketBlock('LIS', 'CDG'))) {
          n.all++;
          if (l.iata === 'U2') n.lcc++;
        }
      }
    }
    expect(n.lcc / n.all).toBeLessThan(0.6);
  });

  it('over 300 seeded random European pairs: hubs in Europe, no network airline at a low-cost airport, no LCC where it avoids, deterministic', () => {
    const eu = AIRPORTS.filter((x) => x.continent === 'EU').map((x) => x.code).sort();
    let seed = 12345;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    let n = 0;
    while (n < 300) {
      const a = eu[Math.floor(rnd() * eu.length)];
      const b = eu[Math.floor(rnd() * eu.length)];
      if (a === b) continue;
      n++;
      const t = T0 + Math.floor(rnd() * 30) * 1440 + 9 * 60;
      const legs = itinerary(a, b, t, t + ticketBlock(a, b));
      expect(itinerary(a, b, t, t + ticketBlock(a, b))).toEqual(legs);
      for (const l of legs) {
        expect(AIRPORT_BY_CODE[l.from].continent, `${a}-${b} via ${l.from}`).toBe('EU');
        expect(AIRPORT_BY_CODE[l.to].continent, `${a}-${b} via ${l.to}`).toBe('EU');
        const c = CARRIER_BY_IATA[l.iata];
        for (const end of [l.from, l.to]) {
          if (c.kind !== 'lcc' && LCC_ONLY.has(end)) expect(c.hubs, `${l.no} ${l.from}-${l.to}`).toContain(end);
          if (c.kind === 'lcc' && c.avoid?.includes(end)) expect(c.hubs, `${l.no} ${l.from}-${l.to}`).toContain(end);
        }
      }
    }
  });
});

// v0.7 (UPDATE-0.7.md §C3): per-airline reach and closed networks; the 42-pair table.
describe('deadhead carriers v0.7: the pair table', () => {
  /** nonstop: carriers allowed on a nonstop itinerary (null: must connect); conn: a connection is allowed (true = anywhere,
   *  else the hubs or the hub country); never: carriers no leg may use; first: carriers the leg from the origin may not use. */
  interface Row { pair: string; nonstop: string[] | null; conn?: boolean | string[] | { country: string } | { continents: string[] }; never?: string[]; neverFirst?: string[]; neverLast?: string[]; noVia?: string[] }
  const EU_HUB = { continents: ['EU'] };
  const ROWS: Row[] = [
    { pair: 'DXB-LIS', nonstop: ['EK'], never: ['TP'] },
    { pair: 'LIS-DXB', nonstop: ['EK'], never: ['TP'] },
    { pair: 'DOH-LIS', nonstop: ['QR'], never: ['TP'] },
    { pair: 'AUH-LIS', nonstop: ['EY'], conn: true, never: ['TP'] },
    { pair: 'LIS-SOF', nonstop: ['FR', 'W6'], conn: EU_HUB, never: ['FB'] },
    { pair: 'SOF-LIS', nonstop: ['FR', 'W6'], conn: EU_HUB, never: ['FB'] },
    { pair: 'HAM-BOJ', nonstop: ['EW'], conn: ['MUC', 'FRA', 'VIE'], never: ['FB'], noVia: ['SOF'] },
    { pair: 'LGW-GVA', nonstop: ['U2', 'BA'], never: ['LX'] },
    { pair: 'LHR-GVA', nonstop: ['BA', 'LX'], never: ['U2', 'FR'] },
    { pair: 'LTN-GVA', nonstop: ['U2'], never: ['LX', 'BA'] },
    { pair: 'MAN-GVA', nonstop: ['U2'], never: ['LX'] },
    { pair: 'STN-DUB', nonstop: ['FR'], never: ['EI'] },
    { pair: 'LIS-OPO', nonstop: ['TP', 'FR'] },
    { pair: 'LIS-FRA', nonstop: ['TP', 'LH'] },
    { pair: 'LIS-MAD', nonstop: ['TP', 'IB', 'UX'] },
    { pair: 'LIS-LAD', nonstop: ['TP', 'DT'] },
    { pair: 'LIS-GRU', nonstop: ['TP', 'LA'] },
    { pair: 'LIS-JFK', nonstop: ['TP', 'DL', 'UA', 'AA'] },
    { pair: 'LIS-KBL', nonstop: null, conn: ['IST', 'DXB', 'DOH'] },
    { pair: 'LIS-SIN', nonstop: null, conn: ['IST', 'DXB', 'DOH'], neverLast: ['TP'] },
    { pair: 'VNO-RIX', nonstop: ['BT'] },
    { pair: 'RIX-LIS', nonstop: ['BT', 'FR'], conn: true },
    { pair: 'BUD-OTP', nonstop: ['W6'] },
    { pair: 'BCN-PMI', nonstop: ['VY', 'FR', 'UX'] },
    { pair: 'ORY-AGP', nonstop: ['HV', 'VY'] },
    // Corrected (v0.7): easyJet flies Amsterdam–Lisbon from its Amsterdam base all year, alongside KLM, TAP and Transavia.
    { pair: 'AMS-LIS', nonstop: ['KL', 'TP', 'HV', 'U2'] },
    { pair: 'LIS-CMN', nonstop: ['AT', 'TP'], never: ['FR'] },
    { pair: 'LIS-SID', nonstop: ['TP', 'VR'] },
    { pair: 'IST-LIS', nonstop: ['TK', 'TP'] },
    { pair: 'TLV-LIS', nonstop: ['TP', 'LY'] },
    { pair: 'DXB-HAM', nonstop: ['EK'], never: ['LH'] },
    { pair: 'DXB-SOF', nonstop: ['FZ'], never: ['FB', 'TP'] },
    { pair: 'MAD-DXB', nonstop: ['EK'], never: ['IB'] },
    { pair: 'CDG-DXB', nonstop: ['EK', 'AF'] },
    { pair: 'SNN-LHR', nonstop: ['EI'] },
    { pair: 'TLS-LIS', nonstop: ['TP', 'U2'] },
    { pair: 'HAM-LIS', nonstop: ['TP', 'EW'] },
    { pair: 'LIS-SCL', nonstop: null, conn: ['GRU', 'MAD'] },
    { pair: 'LIS-CHS', nonstop: null, conn: { continents: ['EU', 'NA'] } },
    { pair: 'LDE-LIS', nonstop: null, conn: { country: 'FR' }, never: ['U2'] },
    { pair: 'LIS-BOJ', nonstop: null, conn: true, neverFirst: ['FB'] },
    { pair: 'FRA-SOF', nonstop: ['LH', 'FB'] },
    // v0.7 fix round 1: the delivery and return sites (Shannon, Tarbes, Charleston) and the Gulf / African networks.
    { pair: 'LIS-SNN', nonstop: null, conn: ['LHR', 'STN', 'FAO'], never: ['IB', 'UX'], neverLast: ['TP', 'BA'], noVia: ['DUB'] },
    { pair: 'VNO-SNN', nonstop: null, conn: ['LHR', 'STN'], neverLast: ['BT'], noVia: ['DUB'] },
    { pair: 'RIX-SNN', nonstop: null, conn: ['LHR', 'STN'], neverLast: ['BT'], noVia: ['DUB'] },
    { pair: 'TLL-SNN', nonstop: null, conn: ['LHR', 'STN'], neverLast: ['BT'], noVia: ['DUB'] },
    { pair: 'MAD-SNN', nonstop: null, conn: true, neverLast: ['UX', 'IB'], noVia: ['DUB'] },
    { pair: 'MLA-SNN', nonstop: null, conn: ['LHR', 'STN'], noVia: ['DUB'] },
    { pair: 'DXB-SNN', nonstop: null, conn: ['LHR', 'STN'], noVia: ['DUB'] },
    { pair: 'LIS-LDE', nonstop: null, conn: ['CDG', 'ORY'], neverLast: ['TP', 'U2'] },
    { pair: 'DXB-CHS', nonstop: null, conn: { continents: ['NA', 'EU'] }, neverLast: ['EK'] },
    { pair: 'DXB-SCL', nonstop: null, conn: ['GRU', 'EZE', 'MAD', 'MIA', 'JFK'], neverFirst: ['LA'] },
    { pair: 'MAD-CGK', nonstop: null, conn: true, never: ['UX', 'IB'], neverFirst: ['GA'] },
    { pair: 'VNO-DOH', nonstop: null, conn: true, neverFirst: ['QR'] },
    { pair: 'LIS-ADD', nonstop: null, conn: true, neverFirst: ['ET'] },
    { pair: 'RIX-DXB', nonstop: ['BT', 'FZ'], never: ['EY'], noVia: ['AUH'] },
    { pair: 'VNO-DXB', nonstop: ['W6', 'FZ', 'BT'], conn: true, never: ['EY'], noVia: ['AUH'] },
    { pair: 'DXB-VNO', nonstop: ['W6', 'FZ', 'BT'], conn: true, never: ['EY', 'QR'], noVia: ['AUH', 'DOH'] },
  ];
  const BANKS = [1, 4, 7, 10, 13, 16, 19, 22];

  it('has the 58 rows', () => expect(ROWS).toHaveLength(58));

  for (const r of ROWS) {
    it(r.pair, () => {
      const [a, b] = r.pair.split('-');
      expect(AIRPORT_BY_CODE[a], a).toBeTruthy();
      expect(AIRPORT_BY_CODE[b], b).toBeTruthy();
      const seen = new Set<string>();
      for (let d = 0; d < 30; d++) {
        for (const h of BANKS) {
          const t = T0 + d * 1440 + h * 60;
          const legs = itinerary(a, b, t, t + ticketBlock(a, b));
          const tag = `${r.pair} d${d} ${legs.map((l) => `${l.no} ${l.from}-${l.to}`).join(' · ')}`;
          for (const l of legs) {
            seen.add(l.iata);
            expect(r.never ?? [], tag).not.toContain(l.iata);
          }
          expect(r.neverFirst ?? [], tag).not.toContain(legs[0].iata);
          if (legs.length > 1) expect(r.neverLast ?? [], tag).not.toContain(legs[legs.length - 1].iata);
          if (legs.length === 1) {
            expect(r.nonstop, tag).not.toBeNull();
            expect(r.nonstop, tag).toContain(legs[0].iata);
          } else {
            expect(legs, tag).toHaveLength(2);
            expect(r.conn, tag).toBeTruthy();
            const hub = legs[0].to;
            expect(r.noVia ?? [], tag).not.toContain(hub);
            const c = r.conn!;
            if (Array.isArray(c)) expect(c, tag).toContain(hub);
            else if (typeof c === 'object' && 'country' in c) expect(AIRPORT_BY_CODE[hub].country, tag).toBe(c.country);
            else if (typeof c === 'object' && 'continents' in c) expect(c.continents, tag).toContain(AIRPORT_BY_CODE[hub].continent);
          }
        }
      }
      if (r.nonstop && !r.conn) expect(r.nonstop.some((x) => seen.has(x)), `${r.pair}: ${[...seen]}`).toBe(true);
    });
  }

  it('every home base to and from every lessor site and factory: real carriers on every leg (no fallback); Shannon, Tarbes and Charleston on their own airlines', () => {
    const OWN: Record<string, string[]> = { SNN: ['EI', 'FR', 'UA', 'DL', 'AA'], LDE: ['AF', 'FR'], CHS: ['DL', 'UA', 'AA', 'B6', 'WN', 'AS', 'BA'] };
    const sites = [...new Set([...LESSOR_SITES.map((x) => x.code), ...Object.values(FACTORIES).flatMap((f) => f!.sites.map((x) => x.code))])];
    for (const home of HOME_BASES) {
      for (const site of sites) {
        if (site === home) continue;
        for (const [a, b] of [[home, site], [site, home]]) {
          for (let d = 0; d < 6; d++) {
            const t = T0 + d * 1440 + (4 + 5 * d) * 60;
            const legs = itinerary(a, b, t, t + ticketBlock(a, b));
            const tag = `${a}-${b} ${legs.map((l) => `${l.no} ${l.from}-${l.to}`).join(' · ')}`;
            for (const l of legs) {
              expect(directCarriers(l.from, l.to).map((c) => c.iata), tag).toContain(l.iata);
              for (const end of [l.from, l.to]) if (OWN[end]) expect(OWN[end], tag).toContain(l.iata);
            }
          }
        }
      }
    }
  });

  it('regional carriers with a closed network never appear outside it', () => {
    const closed = CARRIERS.filter((c) => c.dests);
    expect(closed.length).toBeGreaterThanOrEqual(12);
    const codes = AIRPORTS.filter((x) => x.size >= 2).map((x) => x.code);
    for (const c of closed) {
      const net = new Set([...c.hubs, ...c.dests!]);
      for (let i = 0; i < codes.length; i += 3) {
        for (const h of c.hubs) {
          const x = codes[i];
          if (x === h) continue;
          for (const [p, q] of [[h, x], [x, h]]) {
            const t = T0 + (i % 30) * 1440 + 9 * 60;
            for (const l of itinerary(p, q, t, t + ticketBlock(p, q))) {
              if (l.iata !== c.iata) continue;
              const ok = (net.has(l.from) && net.has(l.to) && (c.hubs.includes(l.from) || c.hubs.includes(l.to))) || !!c.routes?.includes(`${l.from}-${l.to}`) || !!c.routes?.includes(`${l.to}-${l.from}`);
              expect(ok, `${c.iata} ${l.from}-${l.to}`).toBe(true);
            }
          }
        }
      }
    }
    // A full sweep of airport pairs (≈ 4 s alone): room under load.
  }, 30_000);
});
