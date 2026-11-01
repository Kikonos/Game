// v0.14 market presence and far fewer offers (the player: "way less contracts, especially in the beginning … attend
// different trade fairs in different continents … direct where I want my clients to be from"): the markets, the
// presence record (seeded, fairs, visits, flying, satisfied clients, the fade), offers weighted by presence with a
// trickle from elsewhere, the offer rate by standing, none in quiet spells, look-alikes and unflyable drafts drawn
// again, the regional fairs and their calendars, an older save seeded.

import { describe, expect, it } from 'vitest';
import { AIRPORTS } from '../../data/airports';
import { FAIR_BY_ID, FAIRS, fairEdition, heldIn } from '../../data/fairs';
import { MARKET_IDS, MARKETS, marketOfCountry, type MarketId } from '../../data/markets';
import { CLIENT_SEEDS_V014 } from '../../data/naming';
import { BAL } from '../core/balance';
import { DAY, fromUTC, toDate } from '../core/time';
import type { Client, ContractOffer, GameState } from '../core/types';
import { isMarketClient } from '../contracts/clients';
import { fleetCanFly, generateOffer, lookAlike, marketPerWeek, nearClient, type Ctx } from '../contracts/offers';
import { newGame, run } from '../contracts/testkit';
import { isQuiet } from '../ops/director';
import { deserialize, serialize } from '../save';
import { fixture } from '../fixtures/compatKit';
import {
  bumpPresence, dailyPresence, fairPresence, freshPresence, homeMarket, marketTilt, presence, PRESENCE, presenceIn, presenceView, presenceWeight,
} from './presence';
import { bookTrip, fairsAhead, inAudience, nextEdition, presenceText, tripQuote } from './trips';
import { com } from './state';
import './index';

const setPresence = (g: GameState, m: Partial<Record<MarketId, number>>) => {
  const p = presence(g);
  for (const id of MARKET_IDS) p.m[id] = m[id] ?? 0;
};

describe('markets', () => {
  it('every country with an airport has a market; West & East Africa split by country; 13 markets', () => {
    expect(MARKETS).toHaveLength(13);
    for (const a of AIRPORTS) expect(MARKET_IDS, a.country).toContain(marketOfCountry(a.country));
    expect(marketOfCountry('NG')).toBe('waf');
    expect(marketOfCountry('GH')).toBe('waf');
    expect(marketOfCountry('KE')).toBe('eaf');
    expect(marketOfCountry('ZA')).toBe('eaf');
    expect(marketOfCountry('PT')).toBe('seu');
    expect(marketOfCountry('GB')).toBe('nwe');
    expect(marketOfCountry('DE')).toBe('cee');
    expect(marketOfCountry('AE')).toBe('me');
    expect(marketOfCountry('MX')).toBe('lat');
    expect(marketOfCountry('CA')).toBe('nam');
    // Each market a demand calendar of 12 months.
    for (const m of MARKETS) expect(m.season, m.id).toHaveLength(12);
  });

  it('every market has a fair of its own (listed first) or a global one; the airshows every other year', () => {
    const own = new Set(FAIRS.map((f) => f.markets[0]).filter(Boolean));
    for (const id of MARKET_IDS) expect(own.has(id), id).toBe(true);
    expect(FAIRS.filter((f) => f.global).map((f) => f.id)).toEqual(['routesWorld']);
    expect(heldIn(FAIR_BY_ID.dubaiAirshow, 2027)).toBe(true);
    expect(heldIn(FAIR_BY_ID.dubaiAirshow, 2028)).toBe(false);
    expect(nextEdition(FAIR_BY_ID.dubaiAirshow, toMinute(2027, 12, 1)).year).toBe(2029);
    expect(nextEdition(FAIR_BY_ID.singaporeAirshow, toMinute(2027, 3, 1)).year).toBe(2028);
    // Announced editions read plainly; our guesses '(planned)'.
    expect(nextEdition(FAIR_BY_ID.routesAsia, toMinute(2027, 1, 1)).where).toBe('New Delhi, Bharat Mandapam');
    expect(nextEdition(FAIR_BY_ID.routesAsia, toMinute(2027, 6, 1)).where).toBe('Kuala Lumpur, MITEC (planned)');
    expect(fairEdition(FAIR_BY_ID.routesAmericas, 2027)).toMatchObject({ m: 2, d: 10, at: 'SJU', confirmed: true });
    expect(fairEdition(FAIR_BY_ID.fitur, 2027)).toMatchObject({ m: 1, d: 20, confirmed: true });
  });
});

const toMinute = (y: number, m: number, d: number): number => fromUTC(y, m, d);

describe('the presence record', () => {
  it('a new company is known at home, a little on its continent, not elsewhere', () => {
    const g = newGame(1);
    expect(homeMarket(g)).toBe('seu');
    expect(presenceIn(g, 'seu')).toBe(PRESENCE.home);
    expect(presenceIn(g, 'nwe')).toBe(PRESENCE.continent);
    expect(presenceIn(g, 'cee')).toBe(PRESENCE.continent);
    expect(presenceIn(g, 'sea')).toBe(0);
    const v = newGame(1, 'VNO');
    expect(homeMarket(v)).toBe('cee');
    expect(presenceIn(v, 'cee')).toBe(PRESENCE.home);
    // The Markets bars: home first, then the best known.
    expect(presenceView(g)[0]).toMatchObject({ id: 'seu', home: true });
  });

  it('gains are saturating; a fair lifts its own market most, the others it lists half, a global fair everywhere a little', () => {
    const g = newGame(2);
    setPresence(g, { seu: 55, lat: 90 });
    expect(bumpPresence(g, 'sea', 20)).toBe(20);
    expect(bumpPresence(g, 'lat', 20)).toBeCloseTo(2, 0);
    const gains = fairPresence(g, ['waf', 'naf'], false, 0.5);
    expect(gains.find((x) => x.id === 'waf')!.gain).toBeCloseTo(PRESENCE.fair, 0);
    expect(gains.find((x) => x.id === 'naf')!.gain).toBeCloseTo(PRESENCE.fairOther, 0);
    const world = fairPresence(g, [], true, 0.5);
    expect(world.length).toBeGreaterThan(8);
    expect(presenceIn(g, 'oce')).toBeCloseTo(PRESENCE.fairGlobal, 0);
  });

  it('fades with a half-life of months (home never below its floor); a job flown there and happy clients hold it up', () => {
    const g = newGame(3);
    setPresence(g, { seu: 55, sea: 40 });
    for (const k of Object.values(g.contracts)) k.status = 'completed';
    for (const c of Object.values(g.clients)) c.relation = 0;
    presence(g).day = Math.floor(g.now / DAY);
    for (let d = 0; d < PRESENCE.halfLifeDays; d++) {
      g.now += DAY;
      dailyPresence(g);
    }
    expect(presenceIn(g, 'sea')).toBeCloseTo(20, 0);
    expect(presenceIn(g, 'seu')).toBeCloseTo(PRESENCE.homeFloor + (55 - PRESENCE.homeFloor) / 2, 0);
    // A contract under way for a Southeast Asian client: the market holds.
    const h = newGame(3);
    setPresence(h, { sea: 40 });
    const cebu = Object.values(h.clients).find((c) => c.name === 'Cebu Pacific')!;
    const k = Object.values(h.contracts)[0] ?? ({ id: 'k1', status: 'active', clientId: cebu.id } as unknown as GameState['contracts'][string]);
    h.contracts[k.id] = { ...k, status: 'active', clientId: cebu.id };
    presence(h).day = Math.floor(h.now / DAY);
    h.now += 30 * DAY;
    dailyPresence(h);
    expect(presenceIn(h, 'sea')).toBeGreaterThan(40 * Math.pow(0.5, 30 / PRESENCE.halfLifeDays) + 3);
  });

  it('an older save is seeded from its base, clients flown for and contracts, and keeps it through a save', () => {
    const g = deserialize(fixture('v08'));
    expect(g.com!.presence).toBeDefined();
    const home = homeMarket(g);
    expect(presenceIn(g, home)).toBeGreaterThanOrEqual(PRESENCE.home);
    // A client flown for abroad lifts its market above zero.
    const h = newGame(4);
    delete h.com!.presence;
    const air = Object.values(h.clients).find((c) => c.name === 'Avianca')!;
    air.jobs = 3;
    air.level = 'known';
    expect(presenceIn(h, 'lat')).toBeGreaterThan(10);
    const back = deserialize(serialize(h));
    expect(back.com!.presence).toEqual(h.com!.presence);
    // The market-presence clients join an older save too, with their own ids.
    expect(Object.values(g.clients).filter((c) => isMarketClient(c)).length).toBe(CLIENT_SEEDS_V014.length);
    expect(Object.values(g.clients).filter((c) => isMarketClient(c)).every((c) => c.id.startsWith('cm'))).toBe(true);
  });
});

describe('offers weighted by presence', () => {
  const clientsIn = (g: GameState, a: MarketId, b: MarketId): Client[] => Object.values(g.clients).filter((c) => c.kind === 'airline' && !c.rivalId && [a, b].includes(marketOfCountry(c.country)));

  it('an ordinary offer goes mostly to clients where we are known, a trickle elsewhere; other draws as before', () => {
    const g = newGame(5);
    setPresence(g, { lat: 80, eas: 0 });
    const list = clientsIn(g, 'lat', 'eas');
    const ctx = { g, wide: false, aspire: false, window: undefined, o: { ordinary: true } } as Ctx;
    let lat = 0;
    for (let i = 0; i < 400; i++) if (marketOfCountry(nearClient(ctx, list)!.country) === 'lat') lat++;
    const nLat = list.filter((c) => marketOfCountry(c.country) === 'lat').length;
    const nEas = list.length - nLat;
    const expected = (nLat * presenceWeight(g, 'MX')) / (nLat * presenceWeight(g, 'MX') + nEas * presenceWeight(g, 'KR'));
    expect(lat / 400).toBeGreaterThan(0.75);
    expect(lat / 400).toBeCloseTo(expected, 1);
    // A trickle from the unknown market.
    expect(lat).toBeLessThan(400);
    // Not an ordinary draw: the market-presence clients are left out (they come through the market and our trips).
    const plain = { ...ctx, o: {} } as Ctx;
    for (let i = 0; i < 50; i++) expect(isMarketClient(nearClient(plain, list)!)).toBe(false);
  });

  it('the work a market asks for leans the mix (wet leases where airlines are short of lift)', () => {
    const g = newGame(6);
    setPresence(g, { waf: 100 });
    expect(marketTilt(g)('seasonBase')).toBeGreaterThan(1.25);
    setPresence(g, { nam: 100 });
    expect(marketTilt(g)('sports')).toBeGreaterThan(1.3);
  });

  it('ordinary offers a week by standing: Newcomer 1.5, Established 3.1, Respected 4.6 (their usual fleets)', () => {
    const g = newGame(7, 'LIS', true);
    expect(marketPerWeek(g)).toBeCloseTo(BAL.marketOffers.perWeek[0], 5);
    g.company.standing = 1;
    expect(marketPerWeek(g)).toBeCloseTo(3.1 * (1 + BAL.marketOffers.fleetSlope * (2 - 3)), 5);
    g.company.standing = 2;
    expect(marketPerWeek(g)).toBeCloseTo(4.6 * BAL.marketOffers.fleetClamp[0], 5);
  });

  it('a Newcomer sees 1–2.5 ordinary offers a week, none in a quiet spell, and the opening three on day one', () => {
    let n = 0;
    let weeks = 0;
    for (const seed of [11, 12]) {
      const g = newGame(seed, 'LIS', true);
      expect(Object.values(g.offers).filter((o) => o.status === 'open')).toHaveLength(3);
      const t0 = g.now;
      const seen = new Map<string, ContractOffer>();
      for (let h = 1; h <= 70 * 4; h++) {
        run(g, t0 + h * 6 * 60);
        // Read while the director still holds that spell (it keeps 60 days).
        for (const o of Object.values(g.offers)) {
          if (seen.has(o.id)) continue;
          seen.set(o.id, o);
          if (o.ordinary) expect(isQuiet(g, o.created), `${o.title} ${toDate(o.created).toISOString()}`).toBe(false);
        }
      }
      const ordinary = [...seen.values()].filter((o) => o.ordinary);
      n += ordinary.length;
      weeks += 10;
      expect(g.company.standing).toBe(0);
    }
    expect(n / weeks).toBeGreaterThanOrEqual(1);
    expect(n / weeks).toBeLessThanOrEqual(2.5);
  }, 120_000);

  it('never a look-alike of an open offer; a draft no aircraft of ours can fly is mostly drawn again', () => {
    const g = newGame(8);
    for (const id of Object.keys(g.offers)) delete g.offers[id];
    const a = generateOffer(g, 'adhoc', { window: false, wide: false })!;
    expect(lookAlike(g, a)).toBeUndefined();
    const twin = { ...a, id: 'twin' } as ContractOffer;
    expect(lookAlike(g, twin)?.id).toBe(a.id);
    expect(lookAlike(g, { ...twin, title: 'Something else', archetype: 'seasonBase', clientId: 'nobody', pin: 'XXX' } as ContractOffer)).toBeUndefined();
    // With every unflyable draft drawn again (and no ladder jobs), the ordinary offers all fit the fleet.
    const M = BAL.marketOffers as { unfitDrop: number };
    const B = BAL as { aspirationalShare: number };
    const keep = [M.unfitDrop, B.aspirationalShare];
    M.unfitDrop = 1;
    B.aspirationalShare = 0;
    try {
      let made = 0;
      for (let i = 0; i < 30; i++) {
        const o = generateOffer(g, undefined, { ordinary: true });
        if (!o) continue;
        made++;
        expect(o.ordinary).toBe(true);
        expect(fleetCanFly(g, o.id), o.title).toBe(true);
        const open = Object.values(g.offers).filter((x) => x.id !== o.id && (x.status === 'open' || x.status === 'countered'));
        expect(open.some((x) => x.title === o.title || (x.archetype === o.archetype && x.pin === o.pin) || (x.clientId === o.clientId && x.pattern.kind === o.pattern.kind))).toBe(false);
      }
      expect(made).toBeGreaterThan(10);
    } finally {
      [M.unfitDrop, B.aspirationalShare] = keep;
    }
  });
});

describe('fairs build presence', () => {
  it('a regional fair meets its region’s clients and leaves us better known there (the message says where)', () => {
    const g = newGame(9);
    expect(inAudience(FAIR_BY_ID.akwaaba, 'NG')).toBe(true);
    expect(inAudience(FAIR_BY_ID.akwaaba, 'IE')).toBe(false);
    expect(inAudience(FAIR_BY_ID.itb, 'DE')).toBe(true);
    expect(inAudience(FAIR_BY_ID.routesWorld, 'AU')).toBe(true);
    const f = fairsAhead(g).find((x) => x.id === 'routesAsia')!;
    expect(f.market).toBe('sas');
    expect(tripQuote(g, 'ceo', { fairId: 'routesAsia' }).ok).toBe(true);
    const before = presenceIn(g, 'sas');
    // A client we have flown for there thinks a little better of us even if not met.
    const lk = Object.values(g.clients).find((c) => c.name === 'SriLankan Airlines')!;
    lk.jobs = 1;
    lk.relation = 10;
    expect(bookTrip(g, 'ceo', { fairId: 'routesAsia' }).ok).toBe(true);
    const t = com(g).trips[0];
    run(g, t.back.sta + 2 * DAY);
    expect(t.status).toBe('done');
    expect(presenceIn(g, 'sas') - before).toBeGreaterThan(PRESENCE.fair * 0.8);
    expect(presenceIn(g, 'sea')).toBeGreaterThan(PRESENCE.fairOther * 0.7);
    expect(t.presence![0][0]).toBe('sas');
    expect(lk.relation).toBeGreaterThanOrEqual(12);
    expect(presenceText(t)).toMatch(/^South Asia \(\+\d+\)/);
    const msg = g.messages.find((m) => m.ref?.kind === 'offer' || m.ref?.kind === 'trip' || m.ref?.kind === 'tender');
    expect(g.messages.some((m) => /(is|are) back from Routes Asia/.test(m.title) && /Better known in South Asia/.test(m.body))).toBe(true);
    expect(msg).toBeDefined();
    // The clients met are from its region.
    for (const id of t.met ?? []) expect(['sas', 'sea', 'eas']).toContain(marketOfCountry(g.clients[id].country));
  }, 60_000);

  it('a client visit lifts the client’s market', () => {
    const g = newGame(10);
    const cl = Object.values(g.clients).find((c) => c.name === 'Royal Air Maroc')!;
    const before = presenceIn(g, 'naf');
    expect(bookTrip(g, 'ceo', { clientId: cl.id }).ok).toBe(true);
    const t = com(g).trips[0];
    run(g, t.back.sta + DAY);
    expect(presenceIn(g, 'naf')).toBeGreaterThan(before + PRESENCE.visit * 0.7);
  }, 60_000);

  it('a new game seeds every fair a market and lists fairs on every continent within a year', () => {
    const g = newGame(11);
    const conts = new Set(FAIRS.filter((f) => nextEdition(f, g.now).start - g.now < 366 * DAY).flatMap((f) => f.markets.map((m) => MARKETS.find((x) => x.id === m)!.continent)));
    expect([...conts].sort()).toEqual(['AF', 'AS', 'EU', 'ME', 'NA', 'OC', 'SA']);
    expect(freshPresence(g).m.seu).toBe(PRESENCE.home);
  });
});
