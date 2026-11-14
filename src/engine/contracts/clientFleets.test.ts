// v0.24 client fleet realism (player: "Iberojet is widebody only airline and was offered as narrowbody lead, scan for
// similar errors"). Every airline client has its real fleet families (data/naming.ts AIRLINE_FAMILIES); an airline only
// asks for the body it flies, whichever way the job comes (the market, a lead, a pitch, a tender, a sub-charter, an event).

import { describe, expect, it } from 'vitest';
import '../commercial/index';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { TENDER_CLIENT_SEEDS, TENDER_ISSUERS, WIDE_TENDER_ISSUERS } from '../../data/fairs';
import { AIRLINE_FAMILIES, CLIENT_SEEDS, CLIENT_SEEDS_B1, CLIENT_SEEDS_V014, CLIENT_SEEDS_V016, CLIENT_SEEDS_V08 } from '../../data/naming';
import { DAY } from '../core/time';
import type { Client, GameState } from '../core/types';
import { devAddType } from '../dev';
import { fairLead, pitchTargets } from '../commercial/sales';
import { bodiesFor, clientBodies, clientFlies } from './fleetFit';
import { generateOffer } from './offers';
import { bodyOfReq } from './shape';
import { newGame } from './testkit';

const WIDE_FAMS = new Set<string>(ACMI_TYPES_LIST.filter((t) => t.body === 'wide').map((t) => t.family));
const NARROW_FAMS = new Set<string>(ACMI_TYPES_LIST.filter((t) => t.body === 'narrow').map((t) => t.family));
const AIRLINE_SEEDS = [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1, ...CLIENT_SEEDS_V08, ...CLIENT_SEEDS_V014, ...CLIENT_SEEDS_V016].filter((s) => s.kind === 'airline');

/** Real 2026 fleets: airlines that fly widebodies only, and some that fly narrowbodies only. */
const WIDE_ONLY = ['Iberojet', 'World2fly', 'Corsair', 'French bee', 'Air Caraïbes', 'Virgin Atlantic', 'Norse Atlantic Airways', 'Air Tahiti Nui', 'Air Mauritius'];
const NARROW_ONLY = ['Ryanair', 'easyJet', 'Wizz Air', 'Vueling', 'Volotea', 'Norwegian', 'flyadeal', 'Eurowings', 'Aegean Airlines', 'KM Malta Airlines', 'SunExpress', 'Enter Air', 'Marabu', 'airBaltic', 'Airlink', 'Cyprus Airways'];

const airlines = (g: GameState): Client[] => Object.values(g.clients).filter((c) => c.kind === 'airline' && !c.rivalId);
const clear = (g: GameState) => {
  for (const x of Object.values(g.offers)) if (x.status === 'open' || x.status === 'countered') delete g.offers[x.id];
};

describe('airline fleets in the data', () => {
  it('every airline client has its fleet families listed', () => {
    const missing = AIRLINE_SEEDS.filter((s) => !AIRLINE_FAMILIES[s.name]).map((s) => s.name);
    expect(missing).toEqual([]);
    for (const s of TENDER_CLIENT_SEEDS) expect(AIRLINE_FAMILIES[s.name], s.name).toBeDefined();
  });

  it('the widebody-only and narrowbody-only airlines are what their real fleets say', () => {
    for (const n of WIDE_ONLY) expect(clientBodies({ name: n, kind: 'airline' }), n).toEqual({ narrow: false, wide: true });
    for (const n of NARROW_ONLY) expect(clientBodies({ name: n, kind: 'airline' }), n).toEqual({ narrow: true, wide: false });
    // An airline flying none of our families (A220s, Embraers) fills in with a narrowbody, never a widebody.
    expect(clientBodies({ name: 'airBaltic', kind: 'airline' }).wide).toBe(false);
    // Anyone else (a tour operator, a ministry) may ask for either.
    expect(clientBodies({ name: 'TUI Deutschland', kind: 'tourOperator' })).toEqual({ narrow: true, wide: true });
  });

  it('tenderers ask for a family they fly: narrowbody RFPs from narrowbody operators, widebody RFPs from widebody ones', () => {
    for (const t of TENDER_ISSUERS) if (t.fam) expect(AIRLINE_FAMILIES[t.name], t.name).toContain(t.fam);
    for (const s of TENDER_CLIENT_SEEDS) expect(AIRLINE_FAMILIES[s.name], s.name).toContain(s.family);
    for (const xs of Object.values(WIDE_TENDER_ISSUERS)) {
      for (const x of xs) expect((AIRLINE_FAMILIES[x.name] ?? []).some((f: RatingFamily) => WIDE_FAMS.has(f)), x.name).toBe(true);
    }
  });

  it('every family listed is one of the game\'s families', () => {
    const all = new Set<string>([...WIDE_FAMS, ...NARROW_FAMS]);
    for (const [name, fams] of Object.entries(AIRLINE_FAMILIES)) for (const f of fams) expect(all.has(f), `${name}: ${f}`).toBe(true);
  });
});

describe('every airline client asks only for the body it flies', () => {
  it('season bases and AOG cover, asked of each airline by name, narrowbody and widebody', () => {
    const g = newGame(11, 'MLA');
    devAddType(g, 'a333');
    g.company.approvals.push('widebody', 'etops120', 'etops180');
    const bad: string[] = [];
    let made = 0;
    for (const c of airlines(g)) {
      for (const wide of [false, true]) {
        for (const a of ['seasonBase', 'aogCover'] as const) {
          clear(g);
          const o = generateOffer(g, a, { client: c.id, wide, window: false, paint: false, cabin: false, start: g.now + 40 * DAY });
          if (!o) continue;
          made++;
          if (!clientFlies(c, o.requirements)) bad.push(`${c.name} ${a} ${bodyOfReq(o.requirements)}`);
        }
      }
      g.now += 60;
    }
    expect(bad).toEqual([]);
    expect(made).toBeGreaterThan(50);
  });

  it('Iberojet (A330s and A350s) never asks a narrowbody fleet for anything: no offer, no lead, no pitch', () => {
    const g = newGame(5, 'MAD');
    const ibj = airlines(g).find((c) => c.name === 'Iberojet')!;
    expect(ibj).toBeDefined();
    expect(bodiesFor(g, ibj)).toEqual([]);
    for (const a of ['seasonBase', 'aogCover'] as const) {
      clear(g);
      expect(generateOffer(g, a, { client: ibj.id, wide: false, window: false, paint: false, cabin: false })).toBeNull();
    }
    expect(fairLead(g, ibj, 'fitur', 'FITUR Madrid')).toBeNull();
    expect(pitchTargets(g).some((t) => t.client.id === ibj.id)).toBe(false);
    // With a widebody of ours it is a widebody client.
    devAddType(g, 'a333');
    g.company.approvals.push('widebody');
    expect(bodiesFor(g, ibj)).toEqual(['wide']);
    const l = fairLead(g, ibj, 'fitur2', 'FITUR Madrid');
    if (l) expect(l.body).toBe('wide');
  });

  it('a narrowbody-only airline never asks for a widebody', () => {
    const g = newGame(5, 'LIS');
    devAddType(g, 'a333');
    g.company.approvals.push('widebody');
    const ryr = airlines(g).find((c) => c.name === 'Ryanair')!;
    expect(bodiesFor(g, ryr)).toEqual(['narrow']);
    clear(g);
    expect(generateOffer(g, 'seasonBase', { client: ryr.id, wide: true, window: false, paint: false, cabin: false })).toBeNull();
  });

  it('the market draw over a season never hands an airline a body it does not fly', () => {
    const g = newGame(21, 'MLA');
    const bad: string[] = [];
    for (let i = 0; i < 160; i++) {
      g.now += 6 * 60;
      const o = generateOffer(g, i % 2 ? 'seasonBase' : 'aogCover', { window: false, paint: false, cabin: false });
      if (o && !clientFlies(g.clients[o.clientId], o.requirements)) bad.push(`${g.clients[o.clientId].name} ${bodyOfReq(o.requirements)}`);
      if (i % 10 === 0) clear(g);
    }
    expect(bad).toEqual([]);
  });
});
