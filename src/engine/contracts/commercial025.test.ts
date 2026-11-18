// v0.25 commercial realism: offers that fit their clients and their dates.

import { describe, expect, it } from 'vitest';
import { hamBase, leased, newGame } from './testkit';
import { feasibility } from './feasibility';
import { generateOffer } from './offers';
import { DAY, fromUTC, toDate } from '../core/time';
import { baseDestOpen, possessive, SMALL_STATES, TITLES, type TitleCtx, diasporaReasonsAt, DIASPORA_BY_CLIENT, DIASPORA_REASONS, LEAGUE_CITIES, resortOpen, SIX_NATIONS, SUMMER_ONLY } from './flavor';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { rivalFor, riskTier, seedRisk } from './clients';
import { hajjDates } from '../../data/worldCalendar';
import type { ContractOffer, GameState } from '../core/types';

const byName = (g: GameState, n: string) => Object.values(g.clients).find((c) => c.name === n);

describe('v0.25 named clients get the trips they do', () => {
  it('Shell, Siemens and Real Madrid never get a diaspora charter, even when asked for one', () => {
    const g = newGame();
    let seen = 0;
    for (const n of ['Shell', 'Siemens', 'Real Madrid', 'Novartis']) {
      const c = byName(g, n);
      if (!c) continue;
      for (let i = 0; i < 8; i++) {
        for (const variant of [undefined, 'diaspora', 'pilgrimage'] as const) {
          const o = generateOffer(g, 'adhoc', { client: c.id, window: false, ...(variant ? { variant } : {}) });
          if (!o) continue;
          seen++;
          expect(o.clientId).toBe(c.id);
          expect(o.title, `${n}: ${o.title}`).not.toMatch(/Diaspora|Pilgrimage/);
          delete g.offers[o.id];
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('v0.25 diaspora reasons fit the date', () => {
  const at = (y: number, m: number, d: number) => fromUTC(y, m, d);
  it('an August departure is never for Christmas, a December one never for the summer holidays', () => {
    const lists = [DIASPORA_REASONS, ...Object.values(DIASPORA_BY_CLIENT).map((x) => x.reasons)];
    for (const l of lists) {
      expect(diasporaReasonsAt(l, at(2027, 8, 2))).not.toContain('for Christmas and New Year');
      expect(diasporaReasonsAt(l, at(2027, 12, 18))).not.toContain('for the summer holidays');
    }
    expect(diasporaReasonsAt(DIASPORA_REASONS, at(2027, 12, 18))).toContain('for Christmas and New Year');
  });
  it('Eid only in the fortnight before Eid al-Fitr or Eid al-Adha', () => {
    const r = DIASPORA_BY_CLIENT.Corendon.reasons;
    const h = hajjDates(2027);
    expect(diasporaReasonsAt(r, h.arafah - 5 * DAY)).toContain('for Eid with their families');
    expect(diasporaReasonsAt(r, h.arafah - 60 * DAY)).not.toContain('for Eid with their families');
  });
  it('generated diaspora offers across the year never name a reason out of season', () => {
    const g = newGame();
    const c = Object.values(g.clients).find((x) => DIASPORA_BY_CLIENT[x.name]) ?? Object.values(g.clients).find((x) => /Diaspora/i.test(x.name));
    if (!c) return;
    let n = 0;
    for (let d = 5; d < 365; d += 9) {
      const o = generateOffer(g, 'adhoc', { client: c.id, window: false, variant: 'diaspora', start: g.now + d * DAY });
      if (!o) continue;
      n++;
      const m = toDate(o.start).getUTCMonth() + 1;
      if (m !== 12) expect(o.blurb).not.toMatch(/Christmas/);
      if (m < 6 || m > 8) expect(o.blurb).not.toMatch(/summer holidays/);
      delete g.offers[o.id];
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('v0.25 tour series and leisure bases keep to the resort season', () => {
  it('no summer-only resort in a series that runs into November–April, across seeds', () => {
    let n = 0;
    for (const seed of [3, 7, 11, 19]) {
      const g = newGame(seed);
      for (let d = 30; d < 395; d += 15) {
        for (const wide of [false]) {
          const o = generateOffer(g, 'tourSeries', { window: false, wide, start: g.now + d * DAY });
          if (!o || o.pattern.kind !== 'legs') continue;
          n++;
          const legs = o.pattern.legs;
          for (const l of legs.filter((x) => x.from === legs[0].from)) {
            if (!SUMMER_ONLY.has(l.to)) continue;
            const m0 = toDate(legs[0].dep).getUTCMonth() + 1, m1 = toDate(legs[legs.length - 1].dep).getUTCMonth() + 1;
            expect(m0 >= 5 && m0 <= 10 && m1 >= 5 && m1 <= 10, `${o.title} ${toDate(legs[0].dep).toISOString()}`).toBe(true);
          }
          delete g.offers[o.id];
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });
  it('the season rules', () => {
    expect(resortOpen('BOJ', fromUTC(2027, 11, 3), fromUTC(2027, 12, 20))).toBe(false);
    expect(resortOpen('BOJ', fromUTC(2027, 6, 3), fromUTC(2027, 8, 20))).toBe(true);
    expect(resortOpen('TFS', fromUTC(2027, 11, 3), fromUTC(2028, 1, 20))).toBe(true);
    expect(baseDestOpen('RHO', fromUTC(2027, 11, 1), fromUTC(2028, 3, 31))).toBe(false);
    expect(baseDestOpen('RHO', fromUTC(2027, 4, 1), fromUTC(2027, 10, 31))).toBe(true);
  });
});

describe('v0.25 federations and league cities', () => {
  it('the FPF and the RFU never fly a league away day; their trips go abroad', () => {
    const g = newGame(5);
    let n = 0;
    for (const name of ['Portuguese Football Federation (FPF)', 'Rugby Football Union (RFU)', 'German Football Association (DFB)']) {
      const c = byName(g, name);
      if (!c) continue;
      for (let i = 0; i < 12; i++) {
        const o = generateOffer(g, 'sports', { client: c.id, window: false, wide: false, start: g.now + (10 + i * 3) * DAY });
        if (!o || o.pattern.kind !== 'legs') continue;
        n++;
        expect(o.title, o.title).not.toMatch(/^League away|Away match|Short away|away package/);
        const to = AIRPORT_BY_CODE[o.pattern.legs[0].to];
        expect(to.country, `${name} → ${to.code}`).not.toBe(c.country);
        if (/Rugby/.test(name)) expect(SIX_NATIONS).toContain(to.code);
        delete g.offers[o.id];
      }
    }
    expect(n).toBeGreaterThan(5);
  });
  it("a club's league away day goes to a city with a top-flight club", () => {
    const g = newGame(6);
    let n = 0;
    for (const c of Object.values(g.clients).filter((x) => x.kind === 'sports' && LEAGUE_CITIES[x.country])) {
      for (let i = 0; i < 4; i++) {
        const o = generateOffer(g, 'sports', { client: c.id, window: false, wide: false, start: g.now + (10 + i * 5) * DAY });
        if (!o || o.pattern.kind !== 'legs') continue;
        for (const l of o.pattern.legs) {
          if (l.from !== o.pattern.legs[0].from || AIRPORT_BY_CODE[l.to].country !== c.country) continue;
          n++;
          expect(LEAGUE_CITIES[c.country], `${c.name} → ${l.to}`).toContain(l.to);
        }
        delete g.offers[o.id];
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('v0.25 season titles', () => {
  const ctx = (month: string, extra: Partial<TitleCtx> = {}): TitleCtx => ({
    client: 'TUI UK & Ireland', brand: 'TUI', from: 'LGW', to: 'AYT', fromCity: 'London', toCity: 'Antalya', season: 'summer', month, n: 3, nation: 'British', ...extra,
  });
  const all = (arch: string, x: TitleCtx) => (TITLES[arch] ?? []).map((f) => f(x)).filter(Boolean);
  it('no half-term in July; half-term in October or the last week of May, for a short programme', () => {
    expect(all('tourSeries', ctx('July'))).not.toContainEqual(expect.stringMatching(/Half-term/));
    expect(all('tourSeries', ctx('July'))).toContain('School holidays to Antalya');
    expect(all('tourSeries', ctx('October', { season: 'autumn' }))).toContain('Half-term charters London–Antalya');
    expect(all('tourSeries', ctx('May', { day: 25 }))).toContain('Half-term charters London–Antalya');
    expect(all('tourSeries', ctx('May', { day: 5 }))).not.toContainEqual(expect.stringMatching(/Half-term/));
    expect(all('tourSeries', ctx('October', { season: 'autumn', n: 8 }))).not.toContainEqual(expect.stringMatching(/Half-term/));
  });
  it('the summer peak is June to August', () => {
    for (const m of ['September', 'October', 'May']) expect(all('seasonBase', ctx(m)).join('|')).not.toMatch(/Summer peak|Holiday peak/);
    expect(all('seasonBase', ctx('July'))).toContain('Summer peak at London');
  });
});

describe('v0.25 possessives', () => {
  it("Rainbow Tours' lead, not Rainbow Tours's", () => {
    expect(possessive('Rainbow Tours')).toBe("Rainbow Tours'");
    expect(possessive('Condor')).toBe("Condor's");
  });
});

describe('v0.25 clients that fit the job', () => {
  it('a rival never loses a job to itself, and a ceased rival takes none', () => {
    const g = newGame(4);
    const r0 = g.rivals[0];
    const self = Object.values(g.clients).find((c) => c.rivalId === r0.id);
    const req = { minSeats: 174 } as ContractOffer['requirements'];
    for (let i = 0; i < 30; i++) {
      if (self) expect(rivalFor(g, { pin: r0.base, requirements: req, clientId: self.id })?.id).not.toBe(r0.id);
    }
    const r1 = g.rivals[1];
    r1.status = 'ceased';
    for (let i = 0; i < 30; i++) expect(rivalFor(g, { pin: r1.base, requirements: req })?.id).not.toBe(r1.id);
  });
  it('a European defence ministry never rotates to an African Union mission', () => {
    const g = newGame(8);
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const o = generateOffer(g, 'troopRotation', { window: false, start: g.now + (30 + i) * DAY });
      if (!o || o.pattern.kind !== 'legs') continue;
      n++;
      if (AIRPORT_BY_CODE[g.clients[o.clientId].base]?.continent !== 'AF') expect(o.pattern.legs[0].to, o.title).not.toBe('MGQ');
      delete g.offers[o.id];
    }
    expect(n).toBeGreaterThan(5);
  });
  it('Frontex sends no relief flights', () => {
    const g = newGame(9);
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const o = generateOffer(g, 'humanitarian', { window: false, airport: 'JUB' });
      if (!o) continue;
      n++;
      expect(g.clients[o.clientId].name).not.toMatch(/Frontex/);
      delete g.offers[o.id];
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('v0.25 profit after lease and crew', () => {
  it('a wet base on a leased aircraft: the profit takes off the lease and the crew sets for the days tied up', () => {
    const g = newGame();
    const o = hamBase(g, g.now + 20 * DAY, 60);
    const ac = leased(g);
    const r = feasibility(g, o.id, ac.id);
    expect(r.estFixed).toBeGreaterThan(0);
    expect(r.estProfit).toBe(r.estMargin - r.estFixed!);
    const days = Math.ceil((o.end - o.start) / DAY);
    const lease = ac.ownership.kind === 'dryLeaseIn' ? (ac.ownership.rentPerMonth / 30.44) * days : 0;
    expect(r.estFixed!).toBeGreaterThan(lease);
    // A narrowbody set (2 pilots, 4 cabin) costs at least $20K a month with on-costs, for two or more sets.
    expect(r.estFixed! - lease).toBeGreaterThan(((2 * 20_000) / 30.44) * days * 0.9);
  });
});

describe('v0.25 payment behaviour by country risk', () => {
  it('a low-risk government pays mostly on time; a high-risk one late; old saves get the tier once', () => {
    const g = newGame(2);
    const govs = Object.values(g.clients).filter((c) => c.kind === 'government');
    expect(govs.length).toBeGreaterThan(0);
    for (const c of govs) {
      expect(c.risk).toBe(riskTier(c.country));
      if (c.risk === 'low') expect(c.payReliability).toBe(0.85);
      else expect(c.payReliability).toBe(0.2);
    }
    expect(riskTier('PT')).toBe('low');
    expect(riskTier('NG')).toBe('high');
    // An older save: no tier, the old behaviour; the load seeds both.
    const c = govs.find((x) => x.risk === 'low')!;
    delete c.risk;
    c.payReliability = 0.2;
    c.lateDays = [25, 90];
    seedRisk(c);
    expect(c.risk).toBe('low');
    expect(c.payReliability).toBe(0.85);
    expect(c.lateDays).toEqual([0, 15]);
    c.payReliability = 0.5;
    seedRisk(c);
    expect(c.payReliability).toBe(0.5);
  });
});

describe('v0.25 repatriations', () => {
  it('a small state brings fewer citizens home; a live crisis country draws the flights', () => {
    const g = newGame(3);
    const c = Object.values(g.clients).find((x) => x.kind === 'government' && /Foreign/.test(x.name));
    if (!c) return;
    const pax: number[] = [];
    for (let i = 0; i < 12; i++) {
      const o = generateOffer(g, 'repatriation', { client: c.id, window: false, wide: false });
      if (!o || o.pattern.kind !== 'legs') continue;
      pax.push(o.pattern.legs[0].pax);
      delete g.offers[o.id];
    }
    expect(pax.length).toBeGreaterThan(0);
    const scale = SMALL_STATES[c.country] ?? 1;
    for (const p of pax) expect(p).toBeLessThanOrEqual(Math.round(175 * scale));
  });
});
