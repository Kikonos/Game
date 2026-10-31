// Naming kit and offer flavour: real codes don't clash, tables point at real seeds and airports, generated copy is plausible.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACMI_TYPES } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { BROKERS, CLIENT_SEEDS, CLIENT_SEEDS_B1, COMPANY_PRESETS, RIVALS, RIVALS_B1 } from '../../data/naming';
import { typeOf } from '../core/perf';
import { fromUTC } from '../core/time';
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
        // Round 4 (§V.2): no title starts with a bare verb ('Needs an A320 at Hamburg') or names the client.
        expect(o.title, name).not.toMatch(/^(Needs?|Wants?|Asks?|Takes?|Flies|Fly|Seeks?)\b/);
        if (name) expect(o.title, name).not.toContain(name);
      }
    }
  }, 20_000);

  it('round 4 (§V.2): no title template carries the client; clientless() stays for old saves', () => {
    const x = { client: 'ZZCLIENT', brand: 'ZZBRAND', from: 'HAM', to: 'PMI', fromCity: 'Hamburg', toCity: 'Palma', month: 'June', n: 6, event: 'EUFOR', pk: true, nation: 'German', type: 'A320', wide: true };
    for (const season of ['summer', 'winter', 'autumn', 'easter', 'christmas', 'ski'] as const) {
      for (const [arch, fns] of Object.entries(F.TITLES)) {
        for (const f of fns ?? []) {
          const t = f({ ...x, season });
          expect(t, `${arch}: ${t}`).not.toMatch(/ZZ/);
          expect(t, `${arch}: ${t}`).not.toMatch(/^(Needs?|Wants?|Asks?)\b/);
        }
      }
    }
    expect(F.clientless('TUI needs an A320 at Hamburg', 'TUI Deutschland')).toBe('Needs an A320 at Hamburg');
    expect(F.clientless('AOG cover: an A320 at Hamburg', 'TUI Deutschland')).toBe('AOG cover: an A320 at Hamburg');
  });

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

describe('v0.12.1 months on the game calendar', () => {
  it('monthOf/seasonOf read game minutes from the epoch, local at the airport when given', () => {
    expect(F.monthOf(fromUTC(2028, 3, 31, 12))).toBe('March');
    expect(F.monthOf(fromUTC(2028, 11, 30, 12))).toBe('November');
    expect(F.seasonOf(fromUTC(2028, 11, 30, 12), 'PMI')).not.toBe('christmas');
    expect(F.seasonOf(fromUTC(2028, 12, 5, 12), 'PMI')).toBe('christmas');
    // Local midnight 1 Dec in Casablanca (UTC+1) is 30 Nov 23:00 UTC.
    const cmn = fromUTC(2027, 11, 30, 23);
    expect(F.monthOf(cmn)).toBe('November');
    expect(F.monthOf(cmn, 'CMN')).toBe('December');
  });
  it('no game minute is turned into a date without the epoch (lint)', () => {
    const root = join(__dirname, '..', '..');
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) {
          readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
            if (/new Date\([^)]*\* ?60_?000/.test(l) && !/EPOCH|Date\.UTC\(2000, 0, 1\)/.test(l)) bad.push(`${p}:${i + 1}`);
          });
        }
      }
    };
    walk(root);
    expect(bad).toEqual([]);
  });
});

describe('v0.12.1 offer text lint', () => {
  it("no '1 days', no 'a' before a vowel sound, no empty brackets in generated titles and blurbs", () => {
    const bad: string[] = [];
    const kinds: ContractOffer['archetype'][] = ['adhoc', 'tourSeries', 'seasonBase', 'sports', 'repatriation', 'capacityLease', 'aogCover', 'vip', 'evacuation', 'humanitarian', 'medical', 'deportation'];
    for (const seed of [3, 8, 13]) {
      const g = newGame(seed);
      for (let i = 0; i < 6; i++) {
        for (const k of kinds) {
          const o = generateOffer(g, k, { wide: i % 2 === 1, window: false });
          if (!o) continue;
          const t = `${o.title} | ${o.blurb}`;
          if (/\b1 days\b/.test(t) || /\ba (?!one\b|one-|once\b|uni|use|eu|Eu|UN\b|US\b|UK\b)[aeiouAEIOU]/.test(t) || /\(\s*\)/.test(t)) bad.push(t);
          delete g.offers[o.id];
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
