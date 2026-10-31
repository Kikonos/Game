// v0.14 trade fairs and industry events our commercial people travel to (commercial/trips.ts). Real events at their
// real venues. 2027 dates are the organisers' published ones (checked Oct 2026: ITB 16–18 Mar, Routes Europe Antalya
// 20–22 Apr, Routes World Barcelona 17–19 Oct, MRO Europe Barcelona 19–21 Oct; MRO Europe London 3–5 Oct 2028).
// Others, and later years, follow each event's usual week (plausible, not announced).

import type { ClientKind } from '../engine/core/types';

export interface FairEdition {
  /** UTC year, month (1–12), first day, number of days. */
  y: number;
  m: number;
  d: number;
  days: number;
  /** Airport of the host city, the city and venue (Routes moves every year). */
  at?: string;
  where?: string;
}

export interface Fair {
  id: string;
  name: string;
  /** Short name for rows ('ITB'). */
  short: string;
  /** Usual host (airport, 'city, venue'); an edition may move. */
  at: string;
  where: string;
  /** Usual month and first day, days long (any year without an edition listed). */
  usual: { m: number; d: number; days: number };
  editions: FairEdition[];
  /** Who you meet: client kinds, and the countries they come from (empty: anywhere). */
  meets: ClientKind[];
  countries: string[];
  /** Delegate pass (USD). */
  pass: number;
  /** What the leads tend to be: season bases and wet leases (airlines), tour series and charters (tour operators), AOG cover (engineering). */
  leads: 'airline' | 'tour' | 'aog' | 'gulf';
  blurb: string;
}

const EU = ['PT', 'ES', 'FR', 'DE', 'GB', 'IE', 'NL', 'BE', 'IT', 'GR', 'HR', 'PL', 'CZ', 'BG', 'RO', 'LT', 'LV', 'EE', 'SE', 'NO', 'DK', 'FI', 'AT', 'CH', 'HU', 'TR', 'MT', 'CY'];

export const FAIRS: Fair[] = [
  {
    id: 'itb', name: 'ITB Berlin', short: 'ITB', at: 'BER', where: 'Berlin, Messe Berlin',
    usual: { m: 3, d: 4, days: 3 }, editions: [{ y: 2027, m: 3, d: 16, days: 3 }, { y: 2028, m: 3, d: 7, days: 3 }, { y: 2029, m: 3, d: 6, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: EU, pass: 1_200, leads: 'tour',
    blurb: "The tour operators' fair: TUI, Corendon, Schauinsland and the leisure airlines plan next winter and the summer after.",
  },
  {
    id: 'routesEurope', name: 'Routes Europe', short: 'Routes Europe', at: 'AYT', where: 'Antalya, NEST Congress Centre',
    usual: { m: 4, d: 20, days: 3 },
    editions: [{ y: 2027, m: 4, d: 20, days: 3, at: 'AYT', where: 'Antalya, NEST Congress Centre' }, { y: 2028, m: 4, d: 25, days: 3, at: 'BUD', where: 'Budapest, HUNGEXPO' }, { y: 2029, m: 4, d: 24, days: 3, at: 'OPO', where: 'Porto, Alfândega Congress Centre' }],
    meets: ['airline'], countries: EU, pass: 4_500, leads: 'airline',
    blurb: "Route planners of about 120 European airlines meet airports and suppliers: the place to hear who is short of aircraft.",
  },
  {
    id: 'atm', name: 'Arabian Travel Market', short: 'ATM Dubai', at: 'DXB', where: 'Dubai, World Trade Centre',
    usual: { m: 5, d: 3, days: 4 }, editions: [{ y: 2027, m: 5, d: 3, days: 4 }, { y: 2028, m: 5, d: 1, days: 4 }, { y: 2029, m: 4, d: 30, days: 4 }],
    meets: ['airline', 'tourOperator', 'government', 'agency'], countries: ['SA', 'AE', 'QA', 'JO', 'MA', 'DZ', 'EG', 'PK', 'BD', 'ID', 'NG', 'TR'], pass: 1_500, leads: 'gulf',
    blurb: 'The Gulf and Middle East market: Saudi carriers, Hajj and Umrah operators and the region\'s tourism boards.',
  },
  {
    id: 'waf', name: 'World Aviation Festival', short: 'Aviation Festival', at: 'LIS', where: 'Lisbon, FIL',
    usual: { m: 10, d: 6, days: 3 }, editions: [{ y: 2027, m: 10, d: 5, days: 3 }, { y: 2028, m: 10, d: 10, days: 3 }, { y: 2029, m: 10, d: 9, days: 3 }],
    meets: ['airline'], countries: EU, pass: 2_500, leads: 'airline',
    blurb: 'Airline commercial and operations chiefs, lessors and ACMI providers: wet-lease capacity for next summer is talked about here.',
  },
  {
    id: 'routesWorld', name: 'Routes World', short: 'Routes World', at: 'BCN', where: 'Barcelona, Fira Barcelona',
    usual: { m: 10, d: 17, days: 3 },
    editions: [{ y: 2027, m: 10, d: 17, days: 3, at: 'BCN', where: 'Barcelona, Fira Barcelona' }, { y: 2028, m: 9, d: 24, days: 3, at: 'AMM', where: 'Amman, Dead Sea Convention Centre' }, { y: 2029, m: 10, d: 14, days: 3, at: 'GRU', where: 'São Paulo, Expo Center Norte' }],
    meets: ['airline'], countries: [], pass: 5_000, leads: 'airline',
    blurb: 'The biggest route-development meeting: airlines from every continent, a week of 20-minute meetings.',
  },
  {
    id: 'mroEurope', name: 'MRO Europe', short: 'MRO Europe', at: 'LHR', where: 'London, ExCeL',
    usual: { m: 10, d: 14, days: 3 },
    editions: [{ y: 2027, m: 10, d: 19, days: 3, at: 'BCN', where: 'Barcelona, Fira Gran Via' }, { y: 2028, m: 10, d: 3, days: 3, at: 'LHR', where: 'London, ExCeL' }, { y: 2029, m: 10, d: 16, days: 3, at: 'AMS', where: 'Amsterdam, RAI' }],
    meets: ['airline'], countries: EU, pass: 1_800, leads: 'aog',
    blurb: 'Engineering and maintenance: airlines with engine problems and long shop visits look for spare lift (AOG cover).',
  },
  {
    id: 'wtm', name: 'WTM London', short: 'WTM', at: 'LHR', where: 'London, ExCeL',
    usual: { m: 11, d: 3, days: 3 }, editions: [{ y: 2027, m: 11, d: 2, days: 3 }, { y: 2028, m: 11, d: 7, days: 3 }, { y: 2029, m: 11, d: 6, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: ['GB', 'IE', 'ES', 'PT', 'GR', 'TR', 'NL', 'BE', 'DE', 'FR', 'IT', 'HR', 'CY', 'MT'], pass: 1_200, leads: 'tour',
    blurb: 'World Travel Market, the week the tender season opens: Jet2, TUI and the UK tour operators firm up summer capacity.',
  },
];

export const FAIR_BY_ID: Record<string, Fair> = Object.fromEntries(FAIRS.map((f) => [f.id, f]));

/** The edition of a fair in a year (the listed one, else its usual week at its usual place). */
export function fairEdition(f: Fair, y: number): Required<FairEdition> {
  const e = f.editions.find((x) => x.y === y);
  return e ? { at: f.at, where: f.where, ...e } as Required<FairEdition> : { y, m: f.usual.m, d: f.usual.d, days: f.usual.days, at: f.at, where: f.where };
}

/** v0.14 airlines and tour operators that issue summer ACMI tenders and are not in the base client list (added on first use). */
export interface TenderClientSeed {
  name: string;
  kind: 'airline';
  country: string;
  base: string;
  family: 'A320' | 'B737';
}

export const TENDER_CLIENT_SEEDS: TenderClientSeed[] = [
  { name: 'Ryanair', kind: 'airline', country: 'IE', base: 'DUB', family: 'B737' },
  { name: 'Wizz Air', kind: 'airline', country: 'HU', base: 'BUD', family: 'A320' },
  { name: 'easyJet', kind: 'airline', country: 'GB', base: 'LGW', family: 'A320' },
  { name: 'Sunclass Airlines', kind: 'airline', country: 'DK', base: 'CPH', family: 'A320' },
  { name: 'SunExpress', kind: 'airline', country: 'TR', base: 'AYT', family: 'B737' },
  { name: 'TUI Airways', kind: 'airline', country: 'GB', base: 'MAN', family: 'B737' },
  { name: 'flyadeal', kind: 'airline', country: 'SA', base: 'JED', family: 'A320' },
];

/**
 * Who issues summer ACMI tenders (by client name: the first that exists or can be added), weighted: the leisure
 * airlines and the low-cost carriers short of aircraft every summer, then the network airlines.
 * `fam`: the family they want (crew commonality); `mixed`: they like their own cabin crew on board (language).
 */
export const TENDER_ISSUERS: { name: string; w: number; fam?: 'A320' | 'B737'; mixed?: boolean; winter?: boolean }[] = [
  { name: 'Jet2.com', w: 3, fam: 'B737' },
  { name: 'TUI fly Belgium', w: 3, fam: 'B737' },
  { name: 'TUI Airways', w: 2, fam: 'B737' },
  { name: 'Corendon Airlines', w: 2, fam: 'B737', mixed: true },
  { name: 'Sunclass Airlines', w: 2, fam: 'A320' },
  { name: 'Condor', w: 2, fam: 'A320' },
  { name: 'Eurowings', w: 2, fam: 'A320' },
  { name: 'easyJet', w: 2, fam: 'A320' },
  { name: 'Ryanair', w: 1.5, fam: 'B737' },
  { name: 'Wizz Air', w: 1.5, fam: 'A320' },
  { name: 'SunExpress', w: 1.5, fam: 'B737', mixed: true },
  { name: 'SAS Scandinavian Airlines', w: 1.5, fam: 'A320' },
  { name: 'Aer Lingus', w: 1, fam: 'A320' },
  { name: 'TAP Air Portugal', w: 1, fam: 'A320' },
  { name: 'Croatia Airlines', w: 1, fam: 'A320' },
  { name: 'LOT Polish Airlines', w: 1, fam: 'B737' },
  { name: 'Aegean Airlines', w: 1, fam: 'A320' },
  { name: 'Bulgaria Air', w: 0.7, fam: 'A320' },
  { name: 'Royal Air Maroc', w: 0.7, fam: 'B737', mixed: true, winter: true },
  { name: 'Royal Jordanian', w: 0.5, fam: 'A320', mixed: true, winter: true },
  { name: 'Saudia', w: 0.7, fam: 'A320', mixed: true, winter: true },
  { name: 'flynas', w: 0.7, fam: 'A320', mixed: true, winter: true },
  { name: 'flyadeal', w: 0.6, fam: 'A320', mixed: true, winter: true },
  { name: 'Air Algérie', w: 0.5, fam: 'B737', mixed: true, winter: true },
];
