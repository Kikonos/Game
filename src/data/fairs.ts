// v0.14 trade fairs and industry events our commercial people travel to (commercial/trips.ts). Real events at their
// real venues. 2027 dates are the organisers' published ones (checked Oct 2026: ITB 16–18 Mar, Routes Europe Antalya
// 20–22 Apr, Routes World Barcelona 17–19 Oct, MRO Europe Barcelona 19–21 Oct; MRO Europe London 3–5 Oct 2028).
// Others, and later years, follow each event's usual week (plausible, not announced).

import type { ClientKind } from '../engine/core/types';
import type { MarketId } from './markets';

export interface FairEdition {
  /** UTC year, month (1–12), first day, number of days. */
  y: number;
  m: number;
  d: number;
  days: number;
  /** Airport of the host city, the city and venue (Routes moves every year). */
  at?: string;
  where?: string;
  /** v0.14 dates and venue published by the organiser (checked Oct 2026); any other edition is our guess and reads
   *  '(planned)' wherever its venue is shown. */
  confirmed?: boolean;
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
  /** Who you meet: client kinds, and the countries they come from (empty: the fair's markets, or anywhere when global). */
  meets: ClientKind[];
  countries: string[];
  /** v0.14 the markets it builds presence in (data/markets.ts), its own region first; `global`: every market a little. */
  markets: MarketId[];
  global?: true;
  /** v0.14 held every other year only (airshows). */
  years?: 'odd' | 'even';
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
    usual: { m: 3, d: 4, days: 3 }, editions: [{ y: 2027, m: 3, d: 16, days: 3, confirmed: true }, { y: 2028, m: 3, d: 7, days: 3 }, { y: 2029, m: 3, d: 6, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: EU, markets: ['cee', 'nwe', 'seu'], pass: 1_200, leads: 'tour',
    blurb: "The tour operators' fair: TUI, Corendon, Schauinsland and the leisure airlines plan next winter and the summer after.",
  },
  {
    id: 'routesEurope', name: 'Routes Europe', short: 'Routes Europe', at: 'AYT', where: 'Antalya, NEST Congress Centre',
    usual: { m: 4, d: 20, days: 3 },
    editions: [{ y: 2027, m: 4, d: 20, days: 3, at: 'AYT', where: 'Antalya, NEST Congress Centre', confirmed: true }, { y: 2028, m: 4, d: 25, days: 3, at: 'BUD', where: 'Budapest, HUNGEXPO' }, { y: 2029, m: 4, d: 24, days: 3, at: 'OPO', where: 'Porto, Alfândega Congress Centre' }],
    meets: ['airline'], countries: EU, markets: ['cee', 'seu', 'nwe'], pass: 4_500, leads: 'airline',
    blurb: "Route planners of about 120 European airlines meet airports and suppliers: the place to hear who is short of aircraft.",
  },
  {
    id: 'atm', name: 'Arabian Travel Market', short: 'ATM Dubai', at: 'DXB', where: 'Dubai, World Trade Centre',
    usual: { m: 5, d: 3, days: 4 }, editions: [{ y: 2027, m: 5, d: 3, days: 4, confirmed: true }, { y: 2028, m: 5, d: 1, days: 4 }, { y: 2029, m: 4, d: 30, days: 4 }],
    meets: ['airline', 'tourOperator', 'government', 'agency'], countries: ['SA', 'AE', 'QA', 'JO', 'MA', 'DZ', 'EG', 'PK', 'BD', 'ID', 'NG', 'TR'], markets: ['me', 'naf', 'sas'], pass: 1_500, leads: 'gulf',
    blurb: 'The Gulf and Middle East market: Saudi carriers, Hajj and Umrah operators and the region\'s tourism boards.',
  },
  {
    id: 'waf', name: 'World Aviation Festival', short: 'Aviation Festival', at: 'LIS', where: 'Lisbon, FIL',
    usual: { m: 10, d: 6, days: 3 }, editions: [{ y: 2027, m: 10, d: 5, days: 3 }, { y: 2028, m: 10, d: 10, days: 3 }, { y: 2029, m: 10, d: 9, days: 3 }],
    meets: ['airline'], countries: EU, markets: ['seu', 'nwe', 'cee'], pass: 2_500, leads: 'airline',
    blurb: 'Airline commercial and operations chiefs, lessors and ACMI providers: wet-lease capacity for next summer is talked about here.',
  },
  {
    id: 'routesWorld', name: 'Routes World', short: 'Routes World', at: 'BCN', where: 'Barcelona, Fira Barcelona',
    usual: { m: 10, d: 17, days: 3 },
    editions: [{ y: 2027, m: 10, d: 17, days: 3, at: 'BCN', where: 'Barcelona, Fira Barcelona', confirmed: true }, { y: 2028, m: 9, d: 24, days: 3, at: 'AMM', where: 'Amman, Dead Sea Convention Centre' }, { y: 2029, m: 10, d: 14, days: 3, at: 'GRU', where: 'São Paulo, Expo Center Norte' }],
    meets: ['airline'], countries: [], markets: [], global: true, pass: 5_000, leads: 'airline',
    blurb: 'The biggest route-development meeting: airlines from every continent, a week of 20-minute meetings.',
  },
  {
    id: 'mroEurope', name: 'MRO Europe', short: 'MRO Europe', at: 'LHR', where: 'London, ExCeL',
    usual: { m: 10, d: 14, days: 3 },
    editions: [{ y: 2027, m: 10, d: 19, days: 3, at: 'BCN', where: 'Barcelona, Fira Gran Via', confirmed: true }, { y: 2028, m: 10, d: 3, days: 3, at: 'LHR', where: 'London, ExCeL', confirmed: true }, { y: 2029, m: 10, d: 16, days: 3, at: 'AMS', where: 'Amsterdam, RAI' }],
    meets: ['airline'], countries: EU, markets: ['nwe', 'cee', 'seu'], pass: 1_800, leads: 'aog',
    blurb: 'Engineering and maintenance: airlines with engine problems and long shop visits look for spare lift (AOG cover).',
  },
  {
    id: 'wtm', name: 'WTM London', short: 'WTM', at: 'LHR', where: 'London, ExCeL',
    usual: { m: 11, d: 3, days: 3 }, editions: [{ y: 2027, m: 11, d: 2, days: 3 }, { y: 2028, m: 11, d: 7, days: 3 }, { y: 2029, m: 11, d: 6, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: ['GB', 'IE', 'ES', 'PT', 'GR', 'TR', 'NL', 'BE', 'DE', 'FR', 'IT', 'HR', 'CY', 'MT'], markets: ['nwe', 'seu'], pass: 1_200, leads: 'tour',
    blurb: 'World Travel Market, the week the tender season opens: Jet2, TUI and the UK tour operators firm up summer capacity.',
  },
  // ---------- v0.14 regional fairs (market presence): one or more in every part of the world ----------
  // Checked Oct 2026. Confirmed: FITUR 20–24 Jan 2027 (IFEMA; trade days 20–22), Routes Americas San Juan 10–12 Feb
  // 2027, Avalon 23–28 Feb 2027 (trade days 23–26), Routes Asia New Delhi 16–18 Mar 2027, MRO Americas Orlando 13–15
  // Apr 2027 (Chicago 2028, Orlando 2029), AviaDev Africa Lusaka 9–11 Jun 2027, CAPA Australia Pacific Canberra 24–25
  // Jun 2027, Singapore Airshow 15–20 Feb 2028 (trade days 15–18). Listed but not announced by the organiser: Dubai
  // Airshow 15–19 Nov 2027, Global Aviation Africa Casablanca 24–26 Mar 2027, CAPA Asia Hong Kong 28–29 Sep 2027.
  // Not found: a current Routes Africa (none since 2019), so West Africa has Akwaaba in Lagos instead.
  {
    id: 'fitur', name: 'FITUR Madrid', short: 'FITUR', at: 'MAD', where: 'Madrid, IFEMA',
    usual: { m: 1, d: 20, days: 3 }, editions: [{ y: 2027, m: 1, d: 20, days: 3, confirmed: true }, { y: 2028, m: 1, d: 19, days: 3 }, { y: 2029, m: 1, d: 24, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: [], markets: ['seu', 'lat'], pass: 700, leads: 'tour',
    blurb: 'Spain’s tourism fair and the bridge to Latin America: Iberian tour operators and the Latin airlines plan the year.',
  },
  {
    id: 'routesAmericas', name: 'Routes Americas', short: 'Routes Americas', at: 'SJU', where: 'San Juan, Puerto Rico Convention Center',
    usual: { m: 2, d: 10, days: 3 },
    editions: [{ y: 2027, m: 2, d: 10, days: 3, confirmed: true }, { y: 2028, m: 2, d: 15, days: 3, at: 'GDL', where: 'Guadalajara, Expo Guadalajara' }, { y: 2029, m: 2, d: 13, days: 3, at: 'BOG', where: 'Bogotá, Ágora' }],
    meets: ['airline'], countries: [], markets: ['lat', 'nam'], pass: 4_500, leads: 'airline',
    blurb: 'Route planners from Canada to Chile: Latin airlines growing faster than their fleets look for lift.',
  },
  {
    id: 'avalon', name: 'Australian International Airshow', short: 'Avalon', at: 'MEL', where: 'Geelong, Avalon Airport', years: 'odd',
    usual: { m: 2, d: 23, days: 4 }, editions: [{ y: 2027, m: 2, d: 23, days: 4, confirmed: true }, { y: 2029, m: 2, d: 27, days: 4 }],
    meets: ['airline', 'government'], countries: [], markets: ['oce'], pass: 600, leads: 'airline',
    blurb: 'Every other year at Avalon: Australian and Pacific airlines, the mining charter firms and Defence.',
  },
  {
    id: 'singaporeAirshow', name: 'Singapore Airshow', short: 'Singapore Airshow', at: 'SIN', where: 'Singapore, Changi Exhibition Centre', years: 'even',
    usual: { m: 2, d: 16, days: 4 }, editions: [{ y: 2028, m: 2, d: 15, days: 4, confirmed: true }],
    meets: ['airline', 'government'], countries: [], markets: ['sea', 'eas'], pass: 900, leads: 'airline',
    blurb: 'Asia’s biggest airshow, every other February: Southeast Asian airlines short of aircraft for the peaks.',
  },
  {
    id: 'routesAsia', name: 'Routes Asia', short: 'Routes Asia', at: 'DEL', where: 'New Delhi, Bharat Mandapam',
    usual: { m: 3, d: 14, days: 3 },
    editions: [{ y: 2027, m: 3, d: 16, days: 3, confirmed: true }, { y: 2028, m: 3, d: 14, days: 3, at: 'KUL', where: 'Kuala Lumpur, MITEC' }, { y: 2029, m: 3, d: 13, days: 3, at: 'KIX', where: 'Osaka, INTEX Osaka' }],
    meets: ['airline'], countries: [], markets: ['sas', 'sea', 'eas'], pass: 4_500, leads: 'airline',
    blurb: 'Asia-Pacific route development: Indian and Southeast Asian airlines wet-lease to cover peaks and late deliveries.',
  },
  {
    id: 'gaa', name: 'Global Aviation Africa', short: 'Aviation Africa', at: 'CMN', where: 'Casablanca',
    usual: { m: 3, d: 24, days: 3 }, editions: [{ y: 2027, m: 3, d: 24, days: 3 }],
    meets: ['airline', 'government'], countries: [], markets: ['naf', 'waf'], pass: 1_500, leads: 'airline',
    blurb: 'North and West African airlines and civil aviation authorities: Hajj lift and capacity for the summer diaspora.',
  },
  {
    id: 'mroAmericas', name: 'MRO Americas', short: 'MRO Americas', at: 'MCO', where: 'Orlando, Orange County Convention Center',
    usual: { m: 4, d: 13, days: 3 },
    editions: [{ y: 2027, m: 4, d: 13, days: 3, confirmed: true }, { y: 2028, m: 4, d: 25, days: 3, at: 'ORD', where: 'Chicago, McCormick Place' }, { y: 2029, m: 4, d: 17, days: 3 }],
    meets: ['airline'], countries: [], markets: ['nam', 'lat'], pass: 1_800, leads: 'aog',
    blurb: 'Engineering in the Americas: carriers with engines in the shop and aircraft on the ground look for cover.',
  },
  {
    id: 'aviadev', name: 'AviaDev Africa', short: 'AviaDev', at: 'LUN', where: 'Lusaka, International Convention Centre',
    usual: { m: 6, d: 10, days: 3 }, editions: [{ y: 2027, m: 6, d: 9, days: 3, confirmed: true }],
    meets: ['airline', 'tourOperator'], countries: [], markets: ['eaf', 'waf'], pass: 1_500, leads: 'airline',
    blurb: 'Africa’s route-development forum: East and Southern African airlines and tourism boards.',
  },
  {
    id: 'capaAusPac', name: 'CAPA Airline Leader Summit Australia Pacific', short: 'CAPA Australia', at: 'CBR', where: 'Canberra',
    usual: { m: 6, d: 24, days: 2 }, editions: [{ y: 2027, m: 6, d: 24, days: 2, confirmed: true }],
    meets: ['airline'], countries: [], markets: ['oce', 'sea'], pass: 2_500, leads: 'airline',
    blurb: 'Airline chiefs of Australia, New Zealand and the Pacific: winter capacity and the islands’ thin routes.',
  },
  {
    id: 'akwaaba', name: 'Akwaaba African Travel Market', short: 'Akwaaba', at: 'LOS', where: 'Lagos, Eko Hotel & Suites',
    usual: { m: 9, d: 13, days: 3 }, editions: [{ y: 2027, m: 9, d: 12, days: 3 }],
    meets: ['airline', 'tourOperator', 'agency', 'government'], countries: [], markets: ['waf'], pass: 400, leads: 'tour',
    blurb: 'West Africa’s travel market in Lagos: Nigerian and Ghanaian airlines short of aircraft, Hajj and diaspora groups.',
  },
  {
    id: 'capaAsia', name: 'CAPA Airline Leader Summit Asia', short: 'CAPA Asia', at: 'HKG', where: 'Hong Kong',
    usual: { m: 9, d: 28, days: 2 }, editions: [{ y: 2027, m: 9, d: 28, days: 2 }],
    meets: ['airline'], countries: [], markets: ['eas', 'sea'], pass: 2_500, leads: 'airline',
    blurb: 'Chinese, Japanese and Korean airline chiefs: the Golden Week and Lunar New Year peaks.',
  },
  {
    id: 'altaForum', name: 'ALTA Airline Leaders Forum', short: 'ALTA Forum', at: 'PTY', where: 'Panama City',
    usual: { m: 10, d: 18, days: 3 }, editions: [{ y: 2027, m: 10, d: 17, days: 3 }],
    meets: ['airline'], countries: [], markets: ['lat'], pass: 3_000, leads: 'airline',
    blurb: 'The Latin American and Caribbean airlines’ assembly: where carriers short of lift talk to ACMI providers.',
  },
  {
    id: 'itbAsia', name: 'ITB Asia', short: 'ITB Asia', at: 'SIN', where: 'Singapore, Marina Bay Sands',
    usual: { m: 10, d: 20, days: 3 }, editions: [{ y: 2027, m: 10, d: 20, days: 3 }],
    meets: ['tourOperator', 'airline'], countries: [], markets: ['sea', 'eas', 'sas'], pass: 1_000, leads: 'tour',
    blurb: 'The Asian tour operators’ fair: charter series for the December and Lunar New Year peaks.',
  },
  {
    id: 'dubaiAirshow', name: 'Dubai Airshow', short: 'Dubai Airshow', at: 'DXB', where: 'Dubai World Central', years: 'odd',
    usual: { m: 11, d: 15, days: 5 }, editions: [{ y: 2027, m: 11, d: 15, days: 5 }, { y: 2029, m: 11, d: 12, days: 5 }],
    meets: ['airline', 'government'], countries: [], markets: ['me', 'sas', 'naf'], pass: 1_500, leads: 'gulf',
    blurb: 'Every other November: Gulf and Saudi carriers, the Hajj lift for next year and governments’ VIP flights.',
  },
  {
    id: 'wingsIndia', name: 'Wings India', short: 'Wings India', at: 'HYD', where: 'Hyderabad, Begumpet Airport', years: 'even',
    usual: { m: 1, d: 26, days: 4 }, editions: [{ y: 2028, m: 1, d: 26, days: 4 }],
    meets: ['airline', 'government'], countries: [], markets: ['sas'], pass: 700, leads: 'airline',
    blurb: 'India’s civil aviation show, every other January: Indian airlines wet-lease while their new aircraft are late.',
  },
];

export const FAIR_BY_ID: Record<string, Fair> = Object.fromEntries(FAIRS.map((f) => [f.id, f]));

/** v0.14 whether the fair is held that year (airshows every other year). Pure. */
export const heldIn = (f: Fair, y: number): boolean => !f.years || (f.years === 'odd') === (y % 2 === 1);

/** The edition of a fair in a year (the listed one, else its usual week at its usual place). */
export function fairEdition(f: Fair, y: number): Required<FairEdition> {
  const e = f.editions.find((x) => x.y === y);
  return e ? { at: f.at, where: f.where, confirmed: false, ...e } as Required<FairEdition> : { y, m: f.usual.m, d: f.usual.d, days: f.usual.days, at: f.at, where: f.where, confirmed: false };
}

/** v0.14 the venue as shown: 'Budapest, HUNGEXPO (planned)' for an edition the organiser has not announced. Pure. */
export const editionWhere = (e: Pick<Required<FairEdition>, 'where' | 'confirmed'>): string => (e.confirmed ? e.where : `${e.where} (planned)`);

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
  // v0.14 (player's call) the winter round only from Gulf, North African and winter-sun airlines: not Royal Jordanian.
  { name: 'Royal Jordanian', w: 0.5, fam: 'A320', mixed: true },
  { name: 'Saudia', w: 0.7, fam: 'A320', mixed: true, winter: true },
  { name: 'flynas', w: 0.7, fam: 'A320', mixed: true, winter: true },
  { name: 'flyadeal', w: 0.6, fam: 'A320', mixed: true, winter: true },
  { name: 'Air Algérie', w: 0.5, fam: 'B737', mixed: true, winter: true },
];

/** v0.14 (player's call: keep the winter round, Jun–Aug) who may issue a winter RFP: a Gulf or North African airline,
 *  or a winter-sun carrier based at the Canaries, Madeira, Cape Verde or the Red Sea resorts. */
export const WINTER_TENDER_COUNTRIES = new Set(['SA', 'AE', 'QA', 'BH', 'KW', 'OM', 'MA', 'DZ', 'TN', 'LY', 'EG']);
export const WINTER_SUN_BASES = new Set(['LPA', 'TFS', 'TFN', 'ACE', 'FUE', 'SPC', 'FNC', 'SID', 'BVC', 'RAI', 'HRG', 'SSH', 'RMF']);
export const winterIssuer = (c: { country: string; base: string }): boolean => WINTER_TENDER_COUNTRIES.has(c.country) || WINTER_SUN_BASES.has(c.base);
