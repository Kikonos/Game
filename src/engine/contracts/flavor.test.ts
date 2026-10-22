// Naming kit and offer flavour: real codes don't clash, tables point at real seeds and airports, generated copy is plausible.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BROKERS, CLIENT_SEEDS, CLIENT_SEEDS_B1, COMPANY_PRESETS, RIVALS, RIVALS_B1 } from '../../data/naming';
import { typeOf } from '../core/perf';
import type { ContractOffer } from '../core/types';
import { CLIENT_DESIGNATORS, clientPrefix, rivalFor } from './clients';
import * as F from './flavor';
import { generateOffer } from './offers';
import { newGame } from './testkit';

const SEEDS = [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1];
const NAMES = new Set(SEEDS.map((s) => s.name));

describe('naming kit', () => {
  it('every airline client flies under its own IATA code; presets avoid them', () => {
    for (const s of SEEDS.filter((x) => x.kind === 'airline')) expect(CLIENT_DESIGNATORS, s.name).toContain(clientPrefix(s.name));
    for (const p of COMPANY_PRESETS) expect(CLIENT_DESIGNATORS, p.name).not.toContain(p.code);
    expect(new Set(COMPANY_PRESETS.map((p) => p.code)).size).toBe(COMPANY_PRESETS.length);
  });

  it('rivals have real types, and most leasable families have a rival', () => {
    const rivals = [...RIVALS, ...RIVALS_B1];
    for (const r of rivals) for (const f of r.fleet) expect(ACMI_TYPES[f.typeId], `${r.name} ${f.typeId}`).toBeTruthy();
    const covered = new Set(rivals.flatMap((r) => r.fleet.map((f) => typeOf(f.typeId).family)));
    for (const fam of ['A320', 'B737', 'B757/767', 'A330/340', 'B777', 'A350', 'B747']) expect(covered.has(fam as never), fam).toBe(true);
  });

  it('brokers are the airliner group-charter brokers only', () => {
    expect(BROKERS).toEqual(['Chapman Freeborn', 'Air Charter Service', 'Air Partner', 'ACC Aviation', 'Hunt & Palmer']);
  });

  it('flavour tables point at seeded clients and known airports', () => {
    for (const grp of F.ADHOC_GROUPS) for (const c of grp.clients ?? []) expect(NAMES.has(c), c).toBe(true);
    for (const n of Object.keys(F.DIASPORA_BY_CLIENT)) expect(SEEDS.find((s) => s.name === n)?.role, n).toBe('diaspora');
    const codes = [
      ...F.CRISIS_AIRPORTS, ...Object.keys(F.CRISES_AT), ...F.SHRINES.map((x) => x.code), ...F.SHIP_PORTS.map((x) => x.code),
      ...Object.values(F.DIASPORA_BY_CLIENT).flatMap((x) => x.dests),
    ];
    for (const c of codes) expect(AIRPORT_BY_CODE[c], c).toBeTruthy();
    for (const c of F.CRISIS_AIRPORTS) expect(F.CRISES_AT[c]?.length, c).toBeGreaterThanOrEqual(3);
    // TAAG (a client) is based at Luanda: its crisis lines never ground a carrier.
    for (const l of F.CRISES_AT.LAD) expect(l).not.toMatch(/national carrier|grounded/);
  });
});

describe('generated copy', () => {
  it('ad hoc groups, sports tours and repatriations stay plausible', () => {
    const offers: ContractOffer[] = [];
    for (const [seed, base] of [[3, 'LIS'], [5, 'VNO'], [8, 'MLA'], [11, 'MAD']] as const) {
      const g = newGame(seed, base);
      for (let i = 0; i < 60; i++) {
        for (const a of ['adhoc', 'sports', 'repatriation', 'tourSeries'] as const) {
          const o = generateOffer(g, a, { window: false, wide: i % 3 === 0 });
          if (o) offers.push(o);
        }
        for (const o of Object.values(g.offers)) delete g.offers[o.id];
      }
      const cl = (o: ContractOffer) => g.clients[o.clientId]?.name ?? '';
      for (const o of offers.splice(0)) {
        const name = cl(o);
        expect(o.blurb, o.title).not.toMatch(/undefined|NaN/);
        if (name === 'Formula 1') expect(o.title).toMatch(/^Race logistics/);
        if (/Film crew|Drama production/.test(o.title)) expect(name).toBe('BBC Studios');
        if (/Stag-and-hen|Wedding party/.test(o.title)) expect(o.requirements.minSeats).toBeLessThan(200);
        if (/Pre-season tour/.test(o.title)) expect(['Sporting CP', 'SL Benfica', 'Real Madrid', 'Olympique de Marseille', 'Manchester United', 'FC Barcelona', 'Ajax']).toContain(name);
        if (/cruise ship/.test(o.blurb)) expect(name).toMatch(/crew travel/);
        expect(o.title).not.toMatch(/Derby/);
        if (o.archetype === 'repatriation') expect(F.crisisLines(o.pin).some((l) => o.blurb.includes(l)), o.blurb).toBe(true);
      }
    }
  }, 20_000);

  it('a lost widebody job goes to a widebody rival', () => {
    const g = newGame(4);
    for (let i = 0; i < 40; i++) {
      const r = rivalFor(g, { pin: 'LIS', requirements: { minSeats: 260, families: ['A330/340'] } as ContractOffer['requirements'] })!;
      expect(r.fleet.some((f) => typeOf(f.typeId).family === 'A330/340'), r.name).toBe(true);
      const n = rivalFor(g, { pin: 'VNO', requirements: { minSeats: 174 } as ContractOffer['requirements'] })!;
      expect(n.fleet.some((f) => typeOf(f.typeId).body === 'narrow'), n.name).toBe(true);
    }
  });
});

describe('rival display', () => {
  it('shows the base city and type families without counts', async () => {
    const { rivalFleetText } = await import('./clients');
    const g = newGame(2);
    const hf = g.rivals.find((r) => r.name === 'Hi Fly')!;
    expect(rivalFleetText(hf)).toBe('Lisbon · typical fleet A330/340, A350');
    expect(g.rivals.find((r) => r.name === 'Heston Airlines')).toMatchObject({ country: 'LT', base: 'VNO' });
  });
});
