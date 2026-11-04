// v0.16 the new clients (UPDATE-0.16.md §B.5, §E): every seed has a real base airport, a level, an IATA code when it
// is an airline, a livery recipe and a seat in the families table; a new game and an older save both get them by
// name with stable ids and no duplicates; the far routes' airports carry time zones, states and runways.

import { describe, expect, it } from 'vitest';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { CLIENT_LIVERIES } from '../../data/clientLiveries';
import { COUNTRIES } from '../../data/countries';
import { TENDER_CLIENT_SEEDS } from '../../data/fairs';
import { AIRLINE_FAMILIES, AIRLINE_FAMILIES_V016, AIRLINE_MARKETS, CLIENT_SEEDS, CLIENT_SEEDS_B1, CLIENT_SEEDS_V014, CLIENT_SEEDS_V016, CLIENT_SEEDS_V08, COMPANY_PRESETS, RIVALS, RIVALS_B1 } from '../../data/naming';
import { standardOffsetHours } from '../../data/timezones';
import { recipeLivery } from '../ops/paint';
import { clientByName } from '../commercial/state';
import { CLIENT_DESIGNATORS, clientPrefix, isBigClub, isMarketClient, seedClientsV016 } from './clients';
import { BASE_HUBS_MARKET, BASE_HUBS_NB, BASE_HUBS_WB, RESORTS_WB } from './flavor';
import { newGame } from './testkit';

const NEW_AIRPORTS = ['PTP', 'FDF', 'CAY', 'DZA', 'WLS', 'PPT', 'POM', 'POS', 'BGI', 'KIN', 'ANU', 'PLS', 'GCM', 'GEO', 'BZZ', 'TRN'];

describe('v0.16 client seeds', () => {
  it('every seed has a known base, a level, a recipe, and no name repeats an older seed or a rival', () => {
    const older = new Set([...CLIENT_SEEDS, ...CLIENT_SEEDS_B1, ...CLIENT_SEEDS_V08, ...CLIENT_SEEDS_V014].map((s) => s.name));
    const rivals = new Set([...RIVALS, ...RIVALS_B1].map((r) => r.name));
    const names = new Set<string>();
    for (const s of CLIENT_SEEDS_V016) {
      expect(AIRPORT_BY_CODE[s.base], `${s.name}: base ${s.base}`).toBeDefined();
      expect([1, 2, 3, 4], s.name).toContain(s.prestige);
      expect(older.has(s.name), `${s.name}: already seeded`).toBe(false);
      expect(rivals.has(s.name), `${s.name}: a rival operator`).toBe(false);
      expect(names.has(s.name), `${s.name}: twice`).toBe(false);
      names.add(s.name);
      expect(CLIENT_LIVERIES[s.name], `${s.name}: no livery recipe`).toBeDefined();
      expect(COUNTRIES[s.country], `${s.name}: country ${s.country}`).toBeDefined();
      if (s.kind === 'airline') {
        expect(CLIENT_DESIGNATORS, s.name).toContain(clientPrefix(s.name));
        expect(AIRLINE_FAMILIES_V016[s.name], `${s.name}: families`).toBeDefined();
        expect(AIRLINE_FAMILIES[s.name]).toEqual(AIRLINE_FAMILIES_V016[s.name]);
        // the seeds that stood in for the summer tenders keep their tender level
        const t = TENDER_CLIENT_SEEDS.find((x) => x.name === s.name);
        if (t) expect(s.prestige, s.name).toBe(t.prestige);
      }
      if (s.market) expect(isMarketClient(s), s.name).toBe(true);
      if (s.kind === 'government' || s.kind === 'agency') expect(s.role, s.name).toBeDefined();
    }
    // the levels the design names (UPDATE-0.16.md §B.1)
    const level = (n: string) => CLIENT_SEEDS_V016.find((s) => s.name === n)?.prestige;
    expect(level('Air France')).toBe(4);
    expect(level('KLM')).toBe(4);
    expect(level('French bee')).toBe(3);
    expect(level('Air Caraïbes')).toBe(3);
    expect(level('Ryanair')).toBe(1);
    expect(level('TUI Nederland')).toBe(1);
    expect(level('French Ministry of the Armed Forces')).toBe(4);
    expect(level('Irish Department of Defence')).toBe(3);
    expect(level('UNICEF')).toBe(3);
    expect(level('Paris Saint-Germain')).toBe(2);
    // designators stay unique enough for the presets, and the presets avoid them
    for (const p of COMPANY_PRESETS) expect(CLIENT_DESIGNATORS, p.name).not.toContain(p.code);
    // the non-European airlines say where they fly
    for (const n of ['Air New Zealand', 'Aircalin', 'Air Tahiti Nui', 'Air Austral', 'Caribbean Airlines', 'Ethiopian Airlines', 'Copa Airlines']) expect(AIRLINE_MARKETS[n], n).toBeDefined();
  });

  it('a new game seeds them by name with stable ids; a second pass adds nothing; a tender airline keeps the seed', () => {
    const g = newGame(5);
    const names = Object.values(g.clients).map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const s of CLIENT_SEEDS_V016) {
      const c = Object.values(g.clients).find((x) => x.name === s.name)!;
      expect(c, s.name).toBeDefined();
      expect(c.id).toMatch(/^cx[0-9a-z]+$/);
      expect(c.prestige).toBe(s.prestige);
      expect(c.level).toBe('new');
    }
    const n = Object.keys(g.clients).length;
    seedClientsV016(g);
    expect(Object.keys(g.clients).length).toBe(n);
    // the summer tenders' airlines are the same records
    const ryanair = clientByName(g, 'Ryanair')!;
    expect(ryanair.id).toMatch(/^cx/);
    expect(Object.values(g.clients).filter((c) => c.name === 'Ryanair')).toHaveLength(1);
    // the big clubs fly pre-season tours
    expect(isBigClub(Object.values(g.clients).find((c) => c.name === 'Juventus')!)).toBe(true);
  });

  it('an older save without them gets them on load, keeping the ones it already had', () => {
    const g = newGame(2);
    const before = Object.values(g.clients).filter((c) => !c.id.startsWith('cx'));
    for (const c of Object.values(g.clients)) if (c.id.startsWith('cx')) delete g.clients[c.id];
    // one of them existed under an older id (added on first use by a tender)
    g.clients.cl9zz = { ...Object.values(g.clients)[0], id: 'cl9zz', name: 'easyJet', kind: 'airline', country: 'GB', base: 'LGW', prestige: 1 };
    seedClientsV016(g);
    expect(Object.values(g.clients).filter((c) => c.name === 'easyJet')).toHaveLength(1);
    expect(Object.values(g.clients).find((c) => c.name === 'easyJet')!.id).toBe('cl9zz');
    for (const c of before) expect(g.clients[c.id]).toBe(c);
    expect(Object.values(g.clients).filter((c) => c.name === 'Air France')).toHaveLength(1);
  });

  it('every recipe draws for full paint and decals, with fin lettering of four marks at most', () => {
    for (const s of CLIENT_SEEDS_V016) {
      const r = CLIENT_LIVERIES[s.name];
      for (const kind of ['full', 'decals'] as const) {
        const lv = recipeLivery(r, kind);
        expect(lv.titles?.text, s.name).toBe(r.titles[0]);
        expect(r.titles[0].length, s.name).toBeLessThanOrEqual(28);
        if (lv.code) expect(lv.code.text!.length, s.name).toBeLessThanOrEqual(4);
      }
    }
  });

  it('the far routes’ airports are real places with a runway, a time zone and a state the game knows', () => {
    for (const code of NEW_AIRPORTS) {
      const a = AIRPORT_BY_CODE[code];
      expect(a, code).toBeDefined();
      expect(a.runwayM, code).toBeGreaterThanOrEqual(1900);
      expect(COUNTRIES[a.country], `${code}: ${a.country}`).toBeDefined();
      const d = Math.abs(standardOffsetHours(code, a.country, a.lon) - a.lon / 15);
      expect(Math.min(d, 24 - d), code).toBeLessThan(3);
    }
    expect(AIRPORT_BY_CODE.DZA.narrow).toBe(true);
    expect(AIRPORT_BY_CODE.WLS.narrow).toBe(true);
    expect(AIRPORT_BY_CODE.BZZ.enroute).toBe(true);
    expect(standardOffsetHours('PPT', 'PF', AIRPORT_BY_CODE.PPT.lon)).toBe(-10);
    expect(standardOffsetHours('WLS', 'WF', AIRPORT_BY_CODE.WLS.lon)).toBe(12);
    expect(standardOffsetHours('DZA', 'YT', AIRPORT_BY_CODE.DZA.lon)).toBe(3);
    // the hubs and resorts the builders read exist
    for (const c of [...BASE_HUBS_NB, ...BASE_HUBS_WB, ...BASE_HUBS_MARKET, ...RESORTS_WB]) expect(AIRPORT_BY_CODE[c], c).toBeDefined();
  });
});
