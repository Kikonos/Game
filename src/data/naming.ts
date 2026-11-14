// Naming kit: the player's own company presets are fictional; clients, brokers and rivals are real companies.

import type { RatingFamily } from './acmiTypes';
import type { Prestige, Stars } from '../engine/core/types';

export interface CompanyPreset {
  name: string;
  code: string;
  icao: string;
  callsign: string;
  base: string;
}

/** New-game presets; the base list doubles as the v0.5 home-base choice (Lisbon default).
 *  Codes avoid every client designator in the game (clients.ts IATA) and the big carriers' codes. */
export const COMPANY_PRESETS: CompanyPreset[] = [
  { name: 'Atlântica Wings', code: 'W7', icao: 'AWQ', callsign: 'ATLANTICA', base: 'LIS' },
  { name: 'Amberline Air', code: 'AB', icao: 'ABL', callsign: 'AMBERLINE', base: 'VNO' },
  { name: 'Valletta Jetlease', code: 'V9', icao: 'VJQ', callsign: 'MALTESE', base: 'MLA' },
  { name: 'Iberosol Charter', code: 'I9', icao: 'ISQ', callsign: 'SOLAIR', base: 'MAD' },
  { name: 'Daugava Wetlease', code: 'DW', icao: 'DGW', callsign: 'DAUGAVA', base: 'RIX' },
  { name: 'Vltava Air Charter', code: 'VC', icao: 'VTC', callsign: 'VLTAVA', base: 'PRG' },
  { name: 'Balkan Wings', code: 'B9', icao: 'BWQ', callsign: 'BALKANWING', base: 'SOF' },
  { name: 'Toompea Aviation', code: 'T9', icao: 'TQA', callsign: 'TOOMPEA', base: 'TLL' },
];

/** Home bases offered at New Game (Lisbon default): the five of the brief plus three more ACMI-style AOC bases. */
export const HOME_BASES = ['LIS', 'VNO', 'MLA', 'MAD', 'RIX', 'PRG', 'SOF', 'TLL'] as const;
export type HomeBase = (typeof HOME_BASES)[number];
export const DEFAULT_HOME_BASE: HomeBase = 'LIS';

/** One line per home base for the New Game cards (neutral, about the market around it). */
export const HOME_BASE_NOTES: Record<HomeBase, string> = {
  LIS: 'Atlantic gateway: Brazil, Africa, diaspora and repatriation work, close to the Iberian tour operators.',
  VNO: 'Baltic narrowbody hub with low costs; summer bases all over Europe.',
  MLA: 'Island AOC with a Mediterranean reach and a well-known aircraft registry.',
  MAD: 'Iberian hub: Latin America, football clubs and tour operators.',
  RIX: 'Baltic base with Nordic and Canadian winter work.',
  PRG: 'Central European base: tour-operator series and short-notice ACMI across the continent.',
  SOF: 'South-east European base with low costs and Black Sea and Balkan summer flying.',
  TLL: 'Northern base: Nordic winter charters and Baltic summer wet leases.',
};

export interface RivalSeed {
  name: string;
  country: string;
  base: string;
  /** Typical fleet, approximate (acmiTypes ids): drives sub-charter matching and who wins a lost offer. */
  fleet: { typeId: string; count: number }[];
  personality: 'cheap' | 'premium' | 'rescue' | 'military' | 'steady' | /** v0.8 */ 'big';
}

const F = (...xs: [string, number][]) => xs.map(([typeId, count]) => ({ typeId, count }));

/** Real ACMI / charter operators used as competing bidders and sub-charter partners (SmartLynx ceased in Nov 2025: excluded). */
export const RIVALS: RivalSeed[] = [
  { name: 'Hi Fly', country: 'PT', base: 'LIS', fleet: F(['a332', 2], ['a333', 2], ['a343', 2], ['a359', 1]), personality: 'premium' },
  { name: 'euroAtlantic airways', country: 'PT', base: 'LIS', fleet: F(['b763', 3], ['b772', 1]), personality: 'steady' },
  { name: 'Wamos Air', country: 'ES', base: 'MAD', fleet: F(['a332', 2], ['a333', 5]), personality: 'steady' },
  { name: 'Privilege Style', country: 'ES', base: 'PMI', fleet: F(['b752', 3], ['b772', 2]), personality: 'premium' },
  { name: 'Avion Express', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 12], ['a321ceo', 5]), personality: 'big' },
  { name: 'GetJet Airlines', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 6], ['b738', 2], ['a333', 2]), personality: 'cheap' },
  { name: 'Airhub Airlines', country: 'MT', base: 'MLA', fleet: F(['a320ceo', 4], ['b738', 2]), personality: 'cheap' },
  { name: 'Air Atlanta Icelandic', country: 'IS', base: 'KEF', fleet: F(['b744', 6], ['a333', 2]), personality: 'big' },
  { name: 'Titan Airways', country: 'GB', base: 'STN', fleet: F(['a321ceo', 3], ['a321neo', 2]), personality: 'rescue' },
  { name: 'Global Crossing Airlines', country: 'US', base: 'MIA', fleet: F(['a320ceo', 6], ['a321ceo', 6]), personality: 'steady' },
];

/**
 * v0.8 rating families each airline client flies (approximate 2026 fleets; dry-lease lessees and family checks).
 * Missing: any family; [] none of ours (A220 / Embraer operators: they wet-lease narrowbodies, never a widebody).
 * v0.24 checked again against the 2026 fleets: IndiGo flies 787-9s damp-leased from Norse (2025), not A330s; US-Bangla
 * two A330-300s; Qantas A321XLRs (2025) and A380s; Austrian 777-200ERs; Cyprus Airways A220-300s only. Every airline
 * client must have a row (contracts/clientFleets.test.ts): the offers ask only for the bodies it flies.
 */
export const AIRLINE_FAMILIES: Record<string, RatingFamily[]> = {
  'SAS Scandinavian Airlines': ['A320', 'A330/340', 'A350'], 'Aer Lingus': ['A320', 'A330/340'], airBaltic: [], 'Croatia Airlines': ['A320'],
  'LOT Polish Airlines': ['B737', 'B787'], Condor: ['A320', 'A330/340', 'B757/767'], Eurowings: ['A320'], Lufthansa: ['A320', 'A330/340', 'A350', 'B747', 'B787'],
  'TAP Air Portugal': ['A320', 'A330/340'], 'Royal Air Maroc': ['B737', 'B787'], 'Royal Jordanian': ['A320', 'B787'], 'Air Sénégal': ['A320', 'A330/340'],
  'TAAG Angola Airlines': ['B737', 'B777', 'B787'], Airlink: [], 'LATAM Brasil': ['A320', 'B777', 'B787'], 'GOL Linhas Aéreas': ['B737'],
  'Azul Brazilian Airlines': ['A320', 'A330/340'], 'Air Canada': ['A320', 'B737', 'B777', 'B787', 'A330/340'], 'LATAM Perú': ['A320', 'B787'],
  'Vietnam Airlines': ['A320', 'B787', 'A350'], Saudia: ['A320', 'A330/340', 'B777', 'B787'], flynas: ['A320', 'A330/340'], 'Bulgaria Air': ['A320'],
  'Fiji Airways': ['B737', 'A330/340', 'A350'], 'Jet2.com': ['B737', 'A320', 'B757/767'], 'TUI fly Belgium': ['B737', 'B787'], 'Corendon Airlines': ['B737'],
  'Aegean Airlines': ['A320'], 'Garuda Indonesia': ['B737', 'A330/340', 'B777'], 'Biman Bangladesh Airlines': ['B737', 'B777', 'B787'], 'Air Algérie': ['B737', 'A330/340'],
  // v0.14 the market-presence airlines.
  'Air Peace': ['B737', 'B777'], 'Air Côte d’Ivoire': ['A320', 'A330/340'], 'ASKY Airlines': ['B737'], 'Africa World Airlines': [], 'Kenya Airways': ['B737', 'B787'],
  RwandAir: ['B737', 'A330/340'], 'Air Tanzania': ['B737', 'B787'], IndiGo: ['A320', 'B787'], SpiceJet: ['B737'], 'SriLankan Airlines': ['A320', 'A330/340'],
  'US-Bangla Airlines': ['B737', 'A330/340'], 'Jeju Air': ['B737'], 'Hong Kong Airlines': ['A320', 'A330/340'], 'Juneyao Air': ['A320', 'B787'], 'Cebu Pacific': ['A320', 'A330/340'],
  AirAsia: ['A320'], 'VietJet Air': ['A320', 'A330/340'], Qantas: ['B737', 'A320', 'A330/340', 'B787', 'A380'], 'Virgin Australia': ['B737'], 'Jetstar Airways': ['A320', 'B787'],
  'Air Transat': ['A320', 'A330/340'], WestJet: ['B737', 'B787'], 'Sun Country Airlines': ['B737'], Avianca: ['A320', 'B787'], 'Viva Aerobus': ['A320'],
  'Aerolíneas Argentinas': ['B737', 'A330/340'], 'Sky Airline': ['A320'], Arajet: ['B737'], 'Kuwait Airways': ['A320', 'A330/340', 'B777'], 'Oman Air': ['B737', 'B787'],
  Tunisair: ['A320', 'A330/340'], EgyptAir: ['A320', 'B737', 'A330/340', 'B787'],
};

/** Whether an airline client flies this family (unknown airlines: yes). Pure. */
export const fliesFamily = (name: string, family: RatingFamily): boolean => !AIRLINE_FAMILIES[name] || AIRLINE_FAMILIES[name].includes(family);

/**
 * v0.8 where non-European network airlines send a wet-leased aircraft (destination countries; their home region
 * and diaspora routes). Missing: any (European leisure carriers fly the usual sun routes).
 */
export const AIRLINE_MARKETS: Record<string, string[]> = {
  'Royal Air Maroc': ['MA', 'FR', 'ES', 'BE', 'NL', 'IT', 'DE', 'PT', 'GB', 'SN', 'CI', 'ML', 'GN', 'MR', 'TN', 'EG', 'TR'],
  'Air Sénégal': ['SN', 'FR', 'ES', 'IT', 'BE', 'CI', 'ML', 'GN', 'CM', 'GA', 'MR', 'MA', 'CV', 'GM', 'BJ', 'BF', 'GH', 'NG', 'US'],
  'Royal Jordanian': ['JO', 'AE', 'SA', 'EG', 'LB', 'TR', 'GB', 'FR', 'DE', 'IT', 'GR', 'CY', 'QA', 'KW', 'IQ'],
  Saudia: ['SA', 'AE', 'EG', 'JO', 'TR', 'GB', 'FR', 'DE', 'IT', 'ES', 'PK', 'IN', 'BD', 'ID', 'MY', 'MA', 'DZ', 'TN', 'KW', 'QA', 'BH', 'OM'],
  flynas: ['SA', 'AE', 'EG', 'JO', 'TR', 'PK', 'IN', 'BD', 'GE', 'AZ', 'IQ', 'KW', 'QA', 'BH', 'OM'],
  'TAAG Angola Airlines': ['AO', 'PT', 'BR', 'ZA', 'NA', 'CD', 'CG', 'ST', 'MZ', 'CU'],
  Airlink: ['ZA', 'NA', 'BW', 'ZW', 'ZM', 'MZ', 'MG', 'MU', 'SZ', 'LS'],
  'LATAM Brasil': ['BR', 'AR', 'CL', 'UY', 'PY', 'PE', 'CO', 'PT', 'US'], 'GOL Linhas Aéreas': ['BR', 'AR', 'UY', 'PY', 'US'], 'Azul Brazilian Airlines': ['BR', 'AR', 'UY', 'PT', 'US'],
  'LATAM Perú': ['PE', 'CL', 'AR', 'BR', 'CO', 'EC', 'BO', 'US', 'MX'], 'Air Canada': ['CA', 'US', 'MX', 'CU', 'DO', 'JM', 'BS'],
  'Vietnam Airlines': ['VN', 'TH', 'KH', 'LA', 'SG', 'MY', 'JP', 'KR', 'TW', 'ID', 'PH', 'AU', 'IN'], 'Fiji Airways': ['FJ', 'AU', 'NZ', 'TO', 'WS', 'VU', 'US'],
  'Garuda Indonesia': ['ID', 'SG', 'MY', 'SA', 'AU', 'JP', 'TH'], 'Biman Bangladesh Airlines': ['BD', 'IN', 'SA', 'AE', 'QA', 'OM', 'KW', 'MY', 'SG', 'TH', 'NP', 'GB'],
  'Air Algérie': ['DZ', 'FR', 'ES', 'IT', 'BE', 'DE', 'GB', 'TN', 'MA', 'TR', 'SN', 'ML', 'CI'],
  // v0.14 the market-presence airlines: their home market and regional routes.
  'Air Peace': ['NG', 'GH', 'SN', 'CI', 'CM', 'GA', 'LR', 'SL', 'GM', 'AE', 'GB', 'ZA'], 'Air Côte d’Ivoire': ['CI', 'SN', 'GH', 'NG', 'ML', 'BF', 'GN', 'CM', 'GA', 'TG', 'BJ', 'FR'],
  'ASKY Airlines': ['TG', 'GH', 'NG', 'CI', 'SN', 'BJ', 'BF', 'ML', 'CM', 'GA', 'CD', 'LR'], 'Africa World Airlines': ['GH', 'NG', 'SL', 'LR', 'CI', 'SN'],
  'Kenya Airways': ['KE', 'TZ', 'UG', 'RW', 'ET', 'ZA', 'ZM', 'ZW', 'MZ', 'CD', 'AE', 'IN'], RwandAir: ['RW', 'KE', 'UG', 'TZ', 'CD', 'ZM', 'ZA', 'NG', 'GH', 'AE'],
  'Air Tanzania': ['TZ', 'KE', 'UG', 'RW', 'ZM', 'ZW', 'ZA', 'CD', 'IN', 'AE'], IndiGo: ['IN', 'AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'TH', 'SG', 'MY', 'NP', 'LK', 'MV', 'BD', 'VN', 'ID'],
  SpiceJet: ['IN', 'AE', 'SA', 'OM', 'TH', 'NP', 'LK', 'MV', 'BD'], 'SriLankan Airlines': ['LK', 'IN', 'MV', 'AE', 'SA', 'QA', 'TH', 'SG', 'MY', 'BD', 'NP'],
  'US-Bangla Airlines': ['BD', 'IN', 'AE', 'SA', 'OM', 'QA', 'MY', 'SG', 'TH', 'NP'], 'Jeju Air': ['KR', 'JP', 'CN', 'TW', 'VN', 'TH', 'PH', 'GU', 'MY', 'SG', 'HK', 'MO'],
  'Hong Kong Airlines': ['HK', 'CN', 'JP', 'KR', 'TW', 'TH', 'VN', 'PH', 'SG', 'MY', 'ID'], 'Juneyao Air': ['CN', 'JP', 'KR', 'TH', 'SG', 'MY', 'VN', 'HK', 'TW'],
  'Cebu Pacific': ['PH', 'JP', 'KR', 'HK', 'TW', 'SG', 'TH', 'VN', 'MY', 'ID', 'CN', 'MO'], AirAsia: ['MY', 'TH', 'ID', 'SG', 'VN', 'PH', 'KH', 'IN', 'CN', 'HK', 'JP', 'KR', 'AU'],
  'VietJet Air': ['VN', 'TH', 'SG', 'MY', 'KR', 'JP', 'TW', 'HK', 'CN', 'IN', 'AU', 'KH', 'ID'], Qantas: ['AU', 'NZ', 'FJ', 'NC', 'PF', 'ID', 'SG', 'JP', 'US'],
  'Virgin Australia': ['AU', 'NZ', 'FJ', 'VU', 'WS', 'TO', 'ID'], 'Jetstar Airways': ['AU', 'NZ', 'FJ', 'ID', 'TH', 'VN', 'JP', 'SG'],
  'Air Transat': ['CA', 'US', 'MX', 'CU', 'DO', 'JM', 'BS', 'CR', 'FR', 'PT', 'ES', 'GB', 'IT', 'GR'], WestJet: ['CA', 'US', 'MX', 'CU', 'DO', 'JM', 'BS', 'CR'],
  'Sun Country Airlines': ['US', 'MX', 'CR', 'JM', 'DO', 'BS', 'PR'], Avianca: ['CO', 'EC', 'PE', 'PA', 'CR', 'SV', 'GT', 'MX', 'US', 'BR', 'CL', 'AR', 'DO', 'ES'],
  'Viva Aerobus': ['MX', 'US', 'CO', 'PE', 'CU', 'GT'], 'Aerolíneas Argentinas': ['AR', 'BR', 'UY', 'PY', 'CL', 'BO', 'PE', 'CO', 'US', 'ES', 'IT'],
  'Sky Airline': ['CL', 'PE', 'AR', 'BR', 'UY', 'CO', 'EC'], Arajet: ['DO', 'CO', 'MX', 'PE', 'GT', 'JM', 'CR', 'PA', 'CA', 'EC', 'BR', 'AR'],
  'Kuwait Airways': ['KW', 'AE', 'SA', 'QA', 'OM', 'BH', 'EG', 'JO', 'LB', 'TR', 'IN', 'PK', 'BD', 'LK', 'GE', 'AZ'], 'Oman Air': ['OM', 'AE', 'SA', 'QA', 'KW', 'BH', 'IN', 'PK', 'BD', 'LK', 'TH', 'EG', 'JO', 'TR', 'TZ', 'KE'],
  Tunisair: ['TN', 'FR', 'IT', 'DE', 'BE', 'CH', 'GB', 'ES', 'DZ', 'MA', 'LY', 'EG', 'SA', 'SN', 'CI', 'ML', 'TR'], EgyptAir: ['EG', 'SA', 'AE', 'KW', 'QA', 'JO', 'LB', 'TR', 'GR', 'IT', 'FR', 'DE', 'GB', 'SD', 'ET', 'KE', 'NG', 'MA', 'TN'],
};

/** Airliner group-charter brokers (RESEARCH §2.5). */
export const BROKERS = ['Chapman Freeborn', 'Air Charter Service', 'Air Partner', 'ACC Aviation', 'Hunt & Palmer'];

export interface ClientSeed {
  name: string;
  kind: 'airline' | 'tourOperator' | 'government' | 'agency' | 'sports' | 'music' | 'corporate';
  country: string;
  /** Hub or home airport (season bases, AOG cover, home games). */
  base: string;
  /** Special handling: ministries, aid bodies, single-purpose agencies. */
  role?: 'foreign' | 'defence' | 'aid' | 'marine' | 'diaspora' | 'pilgrim' | /** v0.8 */ 'hajj' | 'presidency' | 'interior' | 'health' | 'polar';
  /** Marine crewing: a cruise line (ship crews) or a cargo/tanker ship manager (crew changes). */
  marine?: 'cruise' | 'ships';
  /** Sports: 'big' clubs fly widebody pre-season tours. */
  tier?: 'big';
  /**
   * v0.16 prestige level (UPDATE-0.16.md §B.1): 1 brochure work (tour operators, low-cost), 2 the charter market (leisure
   * airlines, clubs, promoters, agencies, companies), 3 national carriers, aid agencies and the home states' ministries,
   * 4 the majors and big governments. Absent: contracts/prestige.ts seedPrestige derives it from the kind.
   */
  prestige?: Prestige;
  /** v0.16.1 star rating 0–5 when the level alone does not say (a flagship carrier 5, a small brochure 0); else derived (contracts/prestige.ts seedStars). */
  stars?: Stars;
  /**
   * v0.16 a client outside Europe that comes through the market and our trips only, like the v0.14 market-presence
   * airlines (contracts/clients.ts isMarketClient): an ordinary offer once we are known in its market, or one asked of
   * it by name.
   */
  market?: true;
}

export const CLIENT_SEEDS: ClientSeed[] = [
  // Airlines (season bases, AOG cover, capacity leases)
  { name: 'SAS Scandinavian Airlines', kind: 'airline', country: 'SE', base: 'ARN', prestige: 3 },
  { name: 'Aer Lingus', kind: 'airline', country: 'IE', base: 'DUB', prestige: 3 },
  { name: 'airBaltic', kind: 'airline', country: 'LV', base: 'RIX', prestige: 3 },
  { name: 'Croatia Airlines', kind: 'airline', country: 'HR', base: 'ZAG', prestige: 3 },
  { name: 'LOT Polish Airlines', kind: 'airline', country: 'PL', base: 'WAW', prestige: 3 },
  { name: 'Condor', kind: 'airline', country: 'DE', base: 'HAM', prestige: 2 },
  { name: 'Eurowings', kind: 'airline', country: 'DE', base: 'DUS', prestige: 2 },
  { name: 'Lufthansa', kind: 'airline', country: 'DE', base: 'FRA', prestige: 4, stars: 5 },
  { name: 'TAP Air Portugal', kind: 'airline', country: 'PT', base: 'LIS', prestige: 3 },
  { name: 'Royal Air Maroc', kind: 'airline', country: 'MA', base: 'CMN', prestige: 3 },
  { name: 'Royal Jordanian', kind: 'airline', country: 'JO', base: 'AMM', prestige: 3 },
  { name: 'Air Sénégal', kind: 'airline', country: 'SN', base: 'DSS', prestige: 3 },
  { name: 'TAAG Angola Airlines', kind: 'airline', country: 'AO', base: 'LAD', prestige: 3 },
  { name: 'Airlink', kind: 'airline', country: 'ZA', base: 'JNB', prestige: 3 },
  { name: 'LATAM Brasil', kind: 'airline', country: 'BR', base: 'GRU', prestige: 4 },
  { name: 'GOL Linhas Aéreas', kind: 'airline', country: 'BR', base: 'BSB', prestige: 1 },
  { name: 'Azul Brazilian Airlines', kind: 'airline', country: 'BR', base: 'GRU', prestige: 3 },
  { name: 'Air Canada', kind: 'airline', country: 'CA', base: 'YYZ', prestige: 4 },
  { name: 'LATAM Perú', kind: 'airline', country: 'PE', base: 'LIM', prestige: 3 },
  { name: 'Vietnam Airlines', kind: 'airline', country: 'VN', base: 'SGN', prestige: 3 },
  { name: 'Saudia', kind: 'airline', country: 'SA', base: 'JED', prestige: 3 },
  { name: 'flynas', kind: 'airline', country: 'SA', base: 'RUH', prestige: 1 },
  // Tour operators and agencies
  { name: 'TUI Deutschland', kind: 'tourOperator', country: 'DE', base: 'FRA', prestige: 1 },
  { name: 'Jet2holidays', kind: 'tourOperator', country: 'GB', base: 'MAN', prestige: 1 },
  { name: 'Sunweb', kind: 'tourOperator', country: 'NL', base: 'AMS', prestige: 1 },
  { name: 'Corendon', kind: 'tourOperator', country: 'NL', base: 'AMS', role: 'diaspora', prestige: 1 },
  { name: 'Viagens Abreu', kind: 'agency', country: 'PT', base: 'LIS', role: 'diaspora', prestige: 2 },
  // Governments and agencies
  { name: 'Portuguese Ministry of Foreign Affairs', kind: 'government', country: 'PT', base: 'LIS', role: 'foreign', prestige: 3 },
  { name: 'Spanish Ministry of Foreign Affairs', kind: 'government', country: 'ES', base: 'MAD', role: 'foreign', prestige: 3 },
  { name: 'Lithuanian Ministry of Foreign Affairs', kind: 'government', country: 'LT', base: 'VNO', role: 'foreign', prestige: 3 },
  { name: 'UK Foreign Office (FCDO)', kind: 'government', country: 'GB', base: 'LHR', role: 'foreign', prestige: 4 },
  { name: 'German Federal Foreign Office', kind: 'government', country: 'DE', base: 'BER', role: 'foreign', prestige: 4 },
  { name: 'UN World Food Programme (WFP)', kind: 'agency', country: 'IT', base: 'FCO', role: 'aid', prestige: 3 },
  { name: 'UN Department of Peace Operations (DPO)', kind: 'government', country: 'US', base: 'JFK', role: 'aid', prestige: 3 },
  { name: 'UNHCR', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid', prestige: 3 },
  { name: 'International Organization for Migration (IOM)', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid', prestige: 3 },
  { name: 'Portuguese Ministry of National Defence', kind: 'government', country: 'PT', base: 'LIS', role: 'defence', prestige: 3 },
  // Sport, music, corporate
  { name: 'Sporting CP', kind: 'sports', country: 'PT', base: 'LIS', tier: 'big', prestige: 2 },
  { name: 'SL Benfica', kind: 'sports', country: 'PT', base: 'LIS', tier: 'big', prestige: 2 },
  { name: 'Real Madrid', kind: 'sports', country: 'ES', base: 'MAD', tier: 'big', prestige: 2 },
  { name: 'Olympique de Marseille', kind: 'sports', country: 'FR', base: 'MRS', tier: 'big', prestige: 2 },
  { name: 'Fortuna Düsseldorf', kind: 'sports', country: 'DE', base: 'DUS', prestige: 2 },
  { name: 'Manchester United', kind: 'sports', country: 'GB', base: 'MAN', tier: 'big', prestige: 2 },
  { name: 'Live Nation', kind: 'music', country: 'US', base: 'LHR', prestige: 2 },
  { name: 'Formula 1', kind: 'corporate', country: 'GB', base: 'LHR', prestige: 2 },
];

// ---------- B1 additions (contracts): more clients so every home base has its ministries, tour operators and clubs ----------

export const CLIENT_SEEDS_B1: ClientSeed[] = [
  { name: 'Maltese Ministry for Foreign Affairs', kind: 'government', country: 'MT', base: 'MLA', role: 'foreign', prestige: 3 },
  { name: 'Latvian Ministry of Foreign Affairs', kind: 'government', country: 'LV', base: 'RIX', role: 'foreign', prestige: 3 },
  { name: 'Spanish Ministry of Defence', kind: 'government', country: 'ES', base: 'MAD', role: 'defence', prestige: 3 },
  { name: 'Lithuanian Ministry of National Defence', kind: 'government', country: 'LT', base: 'VNO', role: 'defence', prestige: 3 },
  { name: 'Armed Forces of Malta', kind: 'government', country: 'MT', base: 'MLA', role: 'defence', prestige: 3 },
  { name: 'Latvian Ministry of Defence', kind: 'government', country: 'LV', base: 'RIX', role: 'defence', prestige: 3 },
  { name: 'Czech Ministry of Foreign Affairs', kind: 'government', country: 'CZ', base: 'PRG', role: 'foreign', prestige: 3 },
  { name: 'Czech Ministry of Defence', kind: 'government', country: 'CZ', base: 'PRG', role: 'defence', prestige: 3 },
  { name: 'Bulgarian Ministry of Foreign Affairs', kind: 'government', country: 'BG', base: 'SOF', role: 'foreign', prestige: 3 },
  { name: 'Bulgarian Ministry of Defence', kind: 'government', country: 'BG', base: 'SOF', role: 'defence', prestige: 3 },
  { name: 'Estonian Ministry of Foreign Affairs', kind: 'government', country: 'EE', base: 'TLL', role: 'foreign', prestige: 3 },
  { name: 'Estonian Ministry of Defence', kind: 'government', country: 'EE', base: 'TLL', role: 'defence', prestige: 3 },
  { name: 'Čedok', kind: 'tourOperator', country: 'CZ', base: 'PRG', prestige: 1, stars: 0 },
  { name: 'Bulgaria Air', kind: 'airline', country: 'BG', base: 'SOF', prestige: 3 },
  { name: 'Novatours', kind: 'tourOperator', country: 'LT', base: 'VNO', prestige: 1, stars: 0 },
  // v0.24 level 2: Frontex buys its return flights through framework contracts with brokers, flown by small charter
  // operators [E]; no IOSA asked (an EU AOC, insurance and the escorts' own checks).
  { name: 'Frontex', kind: 'agency', country: 'PL', base: 'WAW', role: 'aid', prestige: 2 },
  { name: 'EU Civil Protection and Humanitarian Aid (ECHO)', kind: 'agency', country: 'BE', base: 'BRU', role: 'aid', prestige: 3 },
  { name: 'Fiji Airways', kind: 'airline', country: 'FJ', base: 'NAN', prestige: 3 },
  { name: 'Jet2.com', kind: 'airline', country: 'GB', base: 'MAN', prestige: 2 },
  { name: 'TUI fly Belgium', kind: 'airline', country: 'BE', base: 'BRU', prestige: 2 },
  { name: 'Corendon Airlines', kind: 'airline', country: 'TR', base: 'AYT', prestige: 2 },
  { name: 'Schauinsland-Reisen', kind: 'tourOperator', country: 'DE', base: 'DUS', prestige: 1 },
  { name: 'Aegean Airlines', kind: 'airline', country: 'GR', base: 'ATH', prestige: 3 },
  { name: 'Sunwing Vacations', kind: 'tourOperator', country: 'CA', base: 'YYZ', prestige: 1 },
  { name: 'Abercrombie & Kent', kind: 'tourOperator', country: 'GB', base: 'LHR', prestige: 2 },
  { name: 'Joe Walsh Tours', kind: 'agency', country: 'IE', base: 'DUB', role: 'pilgrim', prestige: 2 },
  { name: 'Opera Romana Pellegrinaggi', kind: 'agency', country: 'IT', base: 'FCO', role: 'pilgrim', prestige: 2 },
  { name: 'Novartis', kind: 'corporate', country: 'CH', base: 'ZRH', prestige: 2 },
  { name: 'FC Barcelona', kind: 'sports', country: 'ES', base: 'BCN', tier: 'big', prestige: 2 },
  { name: 'AEG Presents', kind: 'music', country: 'GB', base: 'LHR', prestige: 2 },
  { name: 'Wasserman Music', kind: 'music', country: 'US', base: 'JFK', prestige: 2 },
  { name: 'Riga FC', kind: 'sports', country: 'LV', base: 'RIX', prestige: 2 },
  { name: 'Floriana FC', kind: 'sports', country: 'MT', base: 'MLA', prestige: 2 },
  { name: 'FK Žalgiris', kind: 'sports', country: 'LT', base: 'VNO', prestige: 2 },
  { name: 'Ajax', kind: 'sports', country: 'NL', base: 'AMS', tier: 'big', prestige: 2 },
  // Group travel, events and marine crewing (ad hoc work).
  { name: 'Columbia Shipmanagement', kind: 'agency', country: 'CY', base: 'LCA', role: 'marine', marine: 'ships', prestige: 2 },
  { name: 'Bernhard Schulte Shipmanagement', kind: 'agency', country: 'DE', base: 'HAM', role: 'marine', marine: 'ships', prestige: 2 },
  { name: 'Wallem Group', kind: 'agency', country: 'HK', base: 'HKG', role: 'marine', marine: 'ships', prestige: 2 },
  { name: 'Anglo-Eastern Ship Management', kind: 'agency', country: 'HK', base: 'HKG', role: 'marine', marine: 'ships', prestige: 2 },
  { name: 'Carnival Corporation crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine', marine: 'cruise', prestige: 2 },
  { name: 'MSC Cruises crew travel', kind: 'agency', country: 'CH', base: 'GVA', role: 'marine', marine: 'cruise', prestige: 2 },
  { name: 'Royal Caribbean crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine', marine: 'cruise', prestige: 2 },
  { name: 'Hotelplan Group', kind: 'agency', country: 'CH', base: 'ZRH', prestige: 2 },
  { name: 'Kuoni Group Travel', kind: 'agency', country: 'CH', base: 'ZRH', prestige: 2 },
  { name: 'Sportsworld Group Travel', kind: 'agency', country: 'GB', base: 'LGW', prestige: 2 },
  { name: 'American Express Global Business Travel', kind: 'corporate', country: 'GB', base: 'LHR', prestige: 2 },
  { name: 'BBC Studios', kind: 'corporate', country: 'GB', base: 'LHR', prestige: 2 },
];

// ---------- v0.8 (UPDATE-0.8.md §2): Hajj, presidencies, interior ministries, health and polar clients ----------

export const CLIENT_SEEDS_V08: ClientSeed[] = [
  { name: 'Garuda Indonesia', kind: 'airline', country: 'ID', base: 'CGK', role: 'hajj', prestige: 3 },
  { name: 'Biman Bangladesh Airlines', kind: 'airline', country: 'BD', base: 'DAC', role: 'hajj', prestige: 3 },
  { name: 'National Hajj Commission of Nigeria', kind: 'government', country: 'NG', base: 'ABV', role: 'hajj', prestige: 4 },
  { name: 'Pakistan Ministry of Religious Affairs', kind: 'government', country: 'PK', base: 'ISB', role: 'hajj', prestige: 4 },
  { name: 'Air Algérie', kind: 'airline', country: 'DZ', base: 'ALG', role: 'hajj', prestige: 3 },
  { name: 'Presidência da República de Angola', kind: 'government', country: 'AO', base: 'LAD', role: 'presidency', prestige: 4 },
  { name: 'Présidence de la République du Sénégal', kind: 'government', country: 'SN', base: 'DSS', role: 'presidency', prestige: 4 },
  { name: 'Office of the President of Ghana', kind: 'government', country: 'GH', base: 'ACC', role: 'presidency', prestige: 4 },
  { name: 'Presidency of Nigeria', kind: 'government', country: 'NG', base: 'ABV', role: 'presidency', prestige: 4 },
  { name: 'UK Home Office', kind: 'government', country: 'GB', base: 'STN', role: 'interior', prestige: 4 },
  { name: 'Spanish Ministry of the Interior', kind: 'government', country: 'ES', base: 'MAD', role: 'interior', prestige: 4 },
  { name: 'German Federal Police', kind: 'government', country: 'DE', base: 'BER', role: 'interior', prestige: 4 },
  { name: 'World Health Organization (WHO)', kind: 'agency', country: 'CH', base: 'GVA', role: 'health', prestige: 3 },
  { name: 'International SOS', kind: 'agency', country: 'GB', base: 'LHR', role: 'health', prestige: 3 },
  { name: 'White Desert', kind: 'tourOperator', country: 'ZA', base: 'CPT', role: 'polar', prestige: 2 },
  { name: 'Norwegian Polar Institute (DROMLAN)', kind: 'government', country: 'NO', base: 'CPT', role: 'polar', prestige: 3 },
  { name: 'Antarctic Logistics & Expeditions', kind: 'agency', country: 'US', base: 'PUQ', role: 'polar', prestige: 2 },
];

/**
 * v0.14 market presence: airlines and a tour operator in the markets outside Europe that wet-lease from European ACMI
 * operators (capacity gaps, late deliveries, the peaks). Added to a new game and to an older save on load (by name).
 * Their offers come mostly once we are known in their market (contracts/offers.ts presence weights).
 */
export const CLIENT_SEEDS_V014: ClientSeed[] = [
  { name: 'Air Peace', kind: 'airline', country: 'NG', base: 'LOS', prestige: 3 },
  { name: 'Air Côte d’Ivoire', kind: 'airline', country: 'CI', base: 'ABJ', prestige: 3 },
  { name: 'ASKY Airlines', kind: 'airline', country: 'TG', base: 'LFW', prestige: 3 },
  { name: 'Africa World Airlines', kind: 'airline', country: 'GH', base: 'ACC', prestige: 3 },
  { name: 'Kenya Airways', kind: 'airline', country: 'KE', base: 'NBO', prestige: 3 },
  { name: 'RwandAir', kind: 'airline', country: 'RW', base: 'KGL', prestige: 3 },
  { name: 'Air Tanzania', kind: 'airline', country: 'TZ', base: 'DAR', prestige: 3 },
  { name: 'IndiGo', kind: 'airline', country: 'IN', base: 'DEL', prestige: 1 },
  { name: 'SpiceJet', kind: 'airline', country: 'IN', base: 'DEL', prestige: 1 },
  { name: 'SriLankan Airlines', kind: 'airline', country: 'LK', base: 'CMB', prestige: 3 },
  { name: 'US-Bangla Airlines', kind: 'airline', country: 'BD', base: 'DAC', prestige: 2 },
  { name: 'Jeju Air', kind: 'airline', country: 'KR', base: 'ICN', prestige: 1 },
  { name: 'Hong Kong Airlines', kind: 'airline', country: 'HK', base: 'HKG', prestige: 3 },
  { name: 'Juneyao Air', kind: 'airline', country: 'CN', base: 'PVG', prestige: 3 },
  { name: 'H.I.S.', kind: 'tourOperator', country: 'JP', base: 'NRT', prestige: 1 },
  { name: 'Cebu Pacific', kind: 'airline', country: 'PH', base: 'MNL', prestige: 1 },
  { name: 'AirAsia', kind: 'airline', country: 'MY', base: 'KUL', prestige: 1 },
  { name: 'VietJet Air', kind: 'airline', country: 'VN', base: 'SGN', prestige: 1 },
  { name: 'Qantas', kind: 'airline', country: 'AU', base: 'SYD', prestige: 4, stars: 5 },
  { name: 'Virgin Australia', kind: 'airline', country: 'AU', base: 'BNE', prestige: 3 },
  { name: 'Jetstar Airways', kind: 'airline', country: 'AU', base: 'MEL', prestige: 1 },
  { name: 'Air Transat', kind: 'airline', country: 'CA', base: 'YUL', prestige: 2 },
  { name: 'WestJet', kind: 'airline', country: 'CA', base: 'YYC', prestige: 3 },
  { name: 'Sun Country Airlines', kind: 'airline', country: 'US', base: 'MSP', prestige: 1 },
  { name: 'Avianca', kind: 'airline', country: 'CO', base: 'BOG', prestige: 3 },
  { name: 'Viva Aerobus', kind: 'airline', country: 'MX', base: 'MTY', prestige: 1 },
  { name: 'Aerolíneas Argentinas', kind: 'airline', country: 'AR', base: 'EZE', prestige: 3 },
  { name: 'Sky Airline', kind: 'airline', country: 'CL', base: 'SCL', prestige: 1 },
  { name: 'Arajet', kind: 'airline', country: 'DO', base: 'SDQ', prestige: 1 },
  { name: 'Kuwait Airways', kind: 'airline', country: 'KW', base: 'KWI', prestige: 3 },
  { name: 'Oman Air', kind: 'airline', country: 'OM', base: 'MCT', prestige: 3 },
  { name: 'Tunisair', kind: 'airline', country: 'TN', base: 'TUN', prestige: 3 },
  { name: 'EgyptAir', kind: 'airline', country: 'EG', base: 'CAI', prestige: 3 },
];

/**
 * v0.12.1 world tours: Les Voyages de TMR (Marseille; its 'Tour du monde en avion privé' leaves from Paris CDG, 51 tours
 * so far). Added to a game the first time one of its tours is offered (contracts/clients.ts ensureClient), so a game
 * that never sees one keeps the client list it started with.
 */
export const CLIENT_SEEDS_V0121: ClientSeed[] = [
  { name: 'Les Voyages de TMR', kind: 'tourOperator', country: 'FR', base: 'CDG', prestige: 2 },
];

export const RIVALS_B1: RivalSeed[] = [
  { name: 'Heston Airlines', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 6]), personality: 'cheap' },
  { name: 'KlasJet', country: 'LT', base: 'VNO', fleet: F(['b738', 3], ['a320ceo', 2]), personality: 'premium' },
  { name: 'Smartwings', country: 'CZ', base: 'PRG', fleet: F(['b738', 20]), personality: 'big' },
];

// ---------- v0.16 (UPDATE-0.16.md §B.5, §E): real airlines, tour operators, governments, agencies, clubs, promoters ----------

/**
 * v0.16 the clients the player asked for, each with its country, hub, kind, role and prestige level (§B.1: 1 brochure work
 * and low-cost, 2 the charter market, 3 national carriers / aid agencies / small states' ministries, 4 the majors and
 * big governments). Added to a new game and to an older save on load by name (contracts/clients.ts seedClientsV016),
 * with ids of their own so nothing else shifts. `market`: outside Europe, reached through market presence (v0.14).
 * Smartwings is a rival operator already (data/naming.ts RIVALS_B1): it hires us through sub-charters, not as a client.
 */
export const CLIENT_SEEDS_V016: ClientSeed[] = [
  // ----- airlines: the majors (4) -----
  { name: 'Air France', kind: 'airline', country: 'FR', base: 'CDG', prestige: 4, stars: 5 },
  { name: 'KLM', kind: 'airline', country: 'NL', base: 'AMS', prestige: 4, stars: 5 },
  { name: 'British Airways', kind: 'airline', country: 'GB', base: 'LHR', prestige: 4, stars: 5 },
  { name: 'Virgin Atlantic', kind: 'airline', country: 'GB', base: 'LHR', prestige: 4 },
  { name: 'Iberia', kind: 'airline', country: 'ES', base: 'MAD', prestige: 4 },
  { name: 'SWISS', kind: 'airline', country: 'CH', base: 'ZRH', prestige: 4 },
  { name: 'Turkish Airlines', kind: 'airline', country: 'TR', base: 'IST', prestige: 4 },
  { name: 'Air New Zealand', kind: 'airline', country: 'NZ', base: 'AKL', prestige: 4, market: true },
  // ----- airlines: national and network carriers (3) -----
  { name: 'French bee', kind: 'airline', country: 'FR', base: 'ORY', prestige: 3 },
  { name: 'Air Caraïbes', kind: 'airline', country: 'FR', base: 'ORY', prestige: 3 },
  { name: 'Austrian Airlines', kind: 'airline', country: 'AT', base: 'VIE', prestige: 3 },
  { name: 'Brussels Airlines', kind: 'airline', country: 'BE', base: 'BRU', prestige: 3 },
  { name: 'Luxair', kind: 'airline', country: 'LU', base: 'LUX', prestige: 3 },
  { name: 'ITA Airways', kind: 'airline', country: 'IT', base: 'FCO', prestige: 3 },
  { name: 'Finnair', kind: 'airline', country: 'FI', base: 'HEL', prestige: 3 },
  { name: 'Icelandair', kind: 'airline', country: 'IS', base: 'KEF', prestige: 3 },
  { name: 'Air Europa', kind: 'airline', country: 'ES', base: 'MAD', prestige: 3 },
  { name: 'Air Serbia', kind: 'airline', country: 'RS', base: 'BEG', prestige: 3 },
  { name: 'TAROM', kind: 'airline', country: 'RO', base: 'OTP', prestige: 3 },
  { name: 'KM Malta Airlines', kind: 'airline', country: 'MT', base: 'MLA', prestige: 3 },
  { name: 'Cyprus Airways', kind: 'airline', country: 'CY', base: 'LCA', prestige: 3 },
  { name: 'El Al', kind: 'airline', country: 'IL', base: 'TLV', prestige: 3 },
  { name: 'Aircalin', kind: 'airline', country: 'NC', base: 'NOU', prestige: 3, market: true },
  { name: 'Air Tahiti Nui', kind: 'airline', country: 'PF', base: 'PPT', prestige: 3, market: true },
  { name: 'Air Austral', kind: 'airline', country: 'RE', base: 'RUN', prestige: 3, market: true },
  { name: 'Caribbean Airlines', kind: 'airline', country: 'TT', base: 'POS', prestige: 3, market: true },
  { name: 'Ethiopian Airlines', kind: 'airline', country: 'ET', base: 'ADD', prestige: 3, market: true },
  { name: 'South African Airways', kind: 'airline', country: 'ZA', base: 'JNB', prestige: 3, market: true },
  { name: 'Air Mauritius', kind: 'airline', country: 'MU', base: 'MRU', prestige: 3, market: true },
  { name: 'Air Seychelles', kind: 'airline', country: 'SC', base: 'SEZ', prestige: 3, market: true },
  { name: 'Cabo Verde Airlines', kind: 'airline', country: 'CV', base: 'SID', prestige: 3, market: true },
  { name: 'Air Niugini', kind: 'airline', country: 'PG', base: 'POM', prestige: 3, market: true },
  { name: 'Solomon Airlines', kind: 'airline', country: 'SB', base: 'HIR', prestige: 3, market: true },
  { name: 'Copa Airlines', kind: 'airline', country: 'PA', base: 'PTY', prestige: 3, market: true },
  { name: 'Bahamasair', kind: 'airline', country: 'BS', base: 'NAS', prestige: 3, market: true },
  { name: 'Cayman Airways', kind: 'airline', country: 'KY', base: 'GCM', prestige: 3, market: true },
  // ----- airlines: leisure (2) -----
  { name: 'Corsair', kind: 'airline', country: 'FR', base: 'ORY', prestige: 2 },
  { name: 'TUI Airways', kind: 'airline', country: 'GB', base: 'MAN', prestige: 2 },
  { name: 'World2fly', kind: 'airline', country: 'ES', base: 'PMI', prestige: 2 },
  { name: 'Iberojet', kind: 'airline', country: 'ES', base: 'MAD', prestige: 2 },
  { name: 'Edelweiss Air', kind: 'airline', country: 'CH', base: 'ZRH', prestige: 2 },
  { name: 'Discover Airlines', kind: 'airline', country: 'DE', base: 'FRA', prestige: 2 },
  { name: 'Marabu', kind: 'airline', country: 'EE', base: 'HAM', prestige: 2 },
  { name: 'Neos', kind: 'airline', country: 'IT', base: 'MXP', prestige: 2 },
  { name: 'Norse Atlantic Airways', kind: 'airline', country: 'NO', base: 'OSL', prestige: 2 },
  { name: 'Sunclass Airlines', kind: 'airline', country: 'DK', base: 'CPH', prestige: 2 },
  { name: 'SunExpress', kind: 'airline', country: 'TR', base: 'AYT', prestige: 2 },
  { name: 'Enter Air', kind: 'airline', country: 'PL', base: 'WAW', prestige: 2 },
  // ----- airlines: low-cost (1) -----
  { name: 'Transavia', kind: 'airline', country: 'NL', base: 'AMS', prestige: 1 },
  { name: 'easyJet', kind: 'airline', country: 'GB', base: 'LGW', prestige: 1 },
  { name: 'Ryanair', kind: 'airline', country: 'IE', base: 'DUB', prestige: 1 },
  { name: 'Vueling', kind: 'airline', country: 'ES', base: 'BCN', prestige: 1 },
  { name: 'Volotea', kind: 'airline', country: 'ES', base: 'NTE', prestige: 1 },
  { name: 'Norwegian', kind: 'airline', country: 'NO', base: 'OSL', prestige: 1 },
  { name: 'Wizz Air', kind: 'airline', country: 'HU', base: 'BUD', prestige: 1 },
  { name: 'Pegasus Airlines', kind: 'airline', country: 'TR', base: 'SAW', prestige: 1 },
  { name: 'flyadeal', kind: 'airline', country: 'SA', base: 'JED', prestige: 1 },
  // ----- tour operators (brochure work, 1; the upmarket ones 2) -----
  { name: 'TUI UK & Ireland', kind: 'tourOperator', country: 'GB', base: 'LGW', prestige: 1 },
  { name: 'TUI Nederland', kind: 'tourOperator', country: 'NL', base: 'AMS', prestige: 1 },
  { name: 'TUI France', kind: 'tourOperator', country: 'FR', base: 'ORY', prestige: 1 },
  { name: 'TUI Nordic', kind: 'tourOperator', country: 'SE', base: 'ARN', prestige: 1 },
  { name: 'DER Touristik', kind: 'tourOperator', country: 'DE', base: 'CGN', prestige: 1 },
  { name: 'alltours', kind: 'tourOperator', country: 'DE', base: 'DUS', prestige: 1 },
  { name: 'Coral Travel', kind: 'tourOperator', country: 'TR', base: 'AYT', prestige: 1 },
  { name: 'Anex Tour', kind: 'tourOperator', country: 'TR', base: 'AYT', prestige: 1 },
  { name: 'Apollo (DER Touristik Nordic)', kind: 'tourOperator', country: 'SE', base: 'ARN', prestige: 1 },
  { name: 'Rainbow Tours', kind: 'tourOperator', country: 'PL', base: 'WAW', prestige: 1 },
  { name: 'Itaka', kind: 'tourOperator', country: 'PL', base: 'WAW', prestige: 1 },
  { name: 'Exim Tours', kind: 'tourOperator', country: 'CZ', base: 'PRG', prestige: 1, stars: 0 },
  { name: 'Soltour', kind: 'tourOperator', country: 'ES', base: 'PMI', prestige: 1, stars: 0 },
  { name: 'Travelplan', kind: 'tourOperator', country: 'ES', base: 'MAD', prestige: 1, stars: 0 },
  { name: 'Alpitour', kind: 'tourOperator', country: 'IT', base: 'MXP', prestige: 1 },
  { name: 'Aurinkomatkat', kind: 'tourOperator', country: 'FI', base: 'HEL', prestige: 1, stars: 0 },
  { name: 'Club Med', kind: 'tourOperator', country: 'FR', base: 'CDG', prestige: 2 },
  // ----- governments: defence and foreign ministries (big states 4; the small ones' everyday rotations 3) -----
  { name: 'French Ministry of the Armed Forces', kind: 'government', country: 'FR', base: 'CDG', role: 'defence', prestige: 4 },
  { name: 'French Ministry for Europe and Foreign Affairs', kind: 'government', country: 'FR', base: 'CDG', role: 'foreign', prestige: 4 },
  { name: 'Italian Ministry of Defence', kind: 'government', country: 'IT', base: 'FCO', role: 'defence', prestige: 4 },
  { name: 'Italian Ministry of Foreign Affairs', kind: 'government', country: 'IT', base: 'FCO', role: 'foreign', prestige: 4 },
  { name: 'Dutch Ministry of Defence', kind: 'government', country: 'NL', base: 'EIN', role: 'defence', prestige: 4 },
  { name: 'Dutch Ministry of Foreign Affairs', kind: 'government', country: 'NL', base: 'AMS', role: 'foreign', prestige: 4 },
  { name: 'Belgian Ministry of Defence', kind: 'government', country: 'BE', base: 'BRU', role: 'defence', prestige: 4 },
  { name: 'Norwegian Ministry of Defence', kind: 'government', country: 'NO', base: 'OSL', role: 'defence', prestige: 4 },
  { name: 'Swedish Armed Forces', kind: 'government', country: 'SE', base: 'ARN', role: 'defence', prestige: 4 },
  { name: 'Danish Ministry of Defence', kind: 'government', country: 'DK', base: 'CPH', role: 'defence', prestige: 4 },
  { name: 'Finnish Defence Forces', kind: 'government', country: 'FI', base: 'HEL', role: 'defence', prestige: 4 },
  { name: 'Polish Ministry of National Defence', kind: 'government', country: 'PL', base: 'WAW', role: 'defence', prestige: 4 },
  { name: 'UK Ministry of Defence', kind: 'government', country: 'GB', base: 'BZZ', role: 'defence', prestige: 4 },
  { name: 'NATO Support and Procurement Agency (NSPA)', kind: 'government', country: 'LU', base: 'LUX', role: 'defence', prestige: 4 },
  { name: 'Irish Department of Defence', kind: 'government', country: 'IE', base: 'DUB', role: 'defence', prestige: 3 },
  { name: 'Irish Department of Foreign Affairs', kind: 'government', country: 'IE', base: 'DUB', role: 'foreign', prestige: 3 },
  { name: 'Austrian Ministry of Defence', kind: 'government', country: 'AT', base: 'VIE', role: 'defence', prestige: 3 },
  { name: 'Romanian Ministry of National Defence', kind: 'government', country: 'RO', base: 'OTP', role: 'defence', prestige: 3 },
  { name: 'Hungarian Defence Forces', kind: 'government', country: 'HU', base: 'BUD', role: 'defence', prestige: 3 },
  { name: 'Greek Ministry of National Defence', kind: 'government', country: 'GR', base: 'ATH', role: 'defence', prestige: 3 },
  { name: 'Croatian Ministry of Defence', kind: 'government', country: 'HR', base: 'ZAG', role: 'defence', prestige: 3 },
  { name: 'Australian Department of Defence', kind: 'government', country: 'AU', base: 'CBR', role: 'defence', prestige: 4, market: true },
  { name: 'Australian Department of Foreign Affairs and Trade', kind: 'government', country: 'AU', base: 'CBR', role: 'foreign', prestige: 4, market: true },
  { name: 'New Zealand Defence Force', kind: 'government', country: 'NZ', base: 'AKL', role: 'defence', prestige: 4, market: true },
  { name: 'New Zealand Ministry of Foreign Affairs and Trade', kind: 'government', country: 'NZ', base: 'WLG', role: 'foreign', prestige: 4, market: true },
  { name: 'Canadian Department of National Defence', kind: 'government', country: 'CA', base: 'YOW', role: 'defence', prestige: 4, market: true },
  { name: 'Global Affairs Canada', kind: 'government', country: 'CA', base: 'YOW', role: 'foreign', prestige: 4, market: true },
  { name: 'US Department of State', kind: 'government', country: 'US', base: 'IAD', role: 'foreign', prestige: 4, market: true },
  // ----- UN and aid agencies (3) -----
  { name: 'UNICEF', kind: 'agency', country: 'DK', base: 'CPH', role: 'aid', prestige: 3 },
  { name: 'UN OCHA', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid', prestige: 3 },
  { name: 'UNDP', kind: 'agency', country: 'US', base: 'JFK', role: 'aid', prestige: 3 },
  { name: 'International Committee of the Red Cross (ICRC)', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid', prestige: 3 },
  { name: 'IFRC', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid', prestige: 3 },
  { name: 'Médecins Sans Frontières (MSF)', kind: 'agency', country: 'CH', base: 'GVA', role: 'health', prestige: 3 },
  // ----- sports: clubs and federations (2; the big clubs fly widebody pre-season tours) -----
  { name: 'Paris Saint-Germain', kind: 'sports', country: 'FR', base: 'ORY', tier: 'big', prestige: 2 },
  { name: 'FC Bayern München', kind: 'sports', country: 'DE', base: 'MUC', tier: 'big', prestige: 2 },
  { name: 'Juventus', kind: 'sports', country: 'IT', base: 'TRN', tier: 'big', prestige: 2 },
  { name: 'Borussia Dortmund', kind: 'sports', country: 'DE', base: 'DUS', tier: 'big', prestige: 2 },
  { name: 'Inter', kind: 'sports', country: 'IT', base: 'MXP', tier: 'big', prestige: 2 },
  { name: 'AC Milan', kind: 'sports', country: 'IT', base: 'MXP', tier: 'big', prestige: 2 },
  { name: 'Atlético de Madrid', kind: 'sports', country: 'ES', base: 'MAD', tier: 'big', prestige: 2 },
  { name: 'FC Porto', kind: 'sports', country: 'PT', base: 'OPO', tier: 'big', prestige: 2 },
  { name: 'Liverpool FC', kind: 'sports', country: 'GB', base: 'MAN', tier: 'big', prestige: 2 },
  { name: 'Arsenal', kind: 'sports', country: 'GB', base: 'LTN', tier: 'big', prestige: 2 },
  { name: 'Chelsea FC', kind: 'sports', country: 'GB', base: 'LGW', tier: 'big', prestige: 2 },
  { name: 'Manchester City', kind: 'sports', country: 'GB', base: 'MAN', tier: 'big', prestige: 2 },
  { name: 'Celtic FC', kind: 'sports', country: 'GB', base: 'GLA', prestige: 2 },
  { name: 'Rangers FC', kind: 'sports', country: 'GB', base: 'GLA', prestige: 2 },
  { name: 'Tottenham Hotspur', kind: 'sports', country: 'GB', base: 'STN', prestige: 2 },
  { name: 'Newcastle United', kind: 'sports', country: 'GB', base: 'NCL', prestige: 2 },
  { name: 'AS Roma', kind: 'sports', country: 'IT', base: 'FCO', prestige: 2 },
  { name: 'SSC Napoli', kind: 'sports', country: 'IT', base: 'NAP', prestige: 2 },
  { name: 'Sevilla FC', kind: 'sports', country: 'ES', base: 'SVQ', prestige: 2 },
  { name: 'Athletic Club', kind: 'sports', country: 'ES', base: 'BIO', prestige: 2 },
  { name: 'SC Braga', kind: 'sports', country: 'PT', base: 'OPO', prestige: 2 },
  { name: 'Olympique Lyonnais', kind: 'sports', country: 'FR', base: 'LYS', prestige: 2 },
  { name: 'AS Monaco', kind: 'sports', country: 'FR', base: 'NCE', prestige: 2 },
  { name: 'Feyenoord', kind: 'sports', country: 'NL', base: 'AMS', prestige: 2 },
  { name: 'PSV', kind: 'sports', country: 'NL', base: 'EIN', prestige: 2 },
  { name: 'Club Brugge', kind: 'sports', country: 'BE', base: 'BRU', prestige: 2 },
  { name: 'Galatasaray', kind: 'sports', country: 'TR', base: 'IST', prestige: 2 },
  { name: 'Fenerbahçe', kind: 'sports', country: 'TR', base: 'SAW', prestige: 2 },
  { name: 'Olympiacos', kind: 'sports', country: 'GR', base: 'ATH', prestige: 2 },
  { name: 'FC Red Bull Salzburg', kind: 'sports', country: 'AT', base: 'SZG', prestige: 2 },
  { name: 'GNK Dinamo Zagreb', kind: 'sports', country: 'HR', base: 'ZAG', prestige: 2 },
  { name: 'Legia Warszawa', kind: 'sports', country: 'PL', base: 'WAW', prestige: 2 },
  { name: 'SK Slavia Praha', kind: 'sports', country: 'CZ', base: 'PRG', prestige: 2 },
  { name: 'FC København', kind: 'sports', country: 'DK', base: 'CPH', prestige: 2 },
  { name: 'Portuguese Football Federation (FPF)', kind: 'sports', country: 'PT', base: 'LIS', prestige: 2 },
  { name: 'Royal Spanish Football Federation (RFEF)', kind: 'sports', country: 'ES', base: 'MAD', prestige: 2 },
  { name: 'French Football Federation (FFF)', kind: 'sports', country: 'FR', base: 'CDG', prestige: 2 },
  { name: 'German Football Association (DFB)', kind: 'sports', country: 'DE', base: 'FRA', prestige: 2 },
  { name: 'The Football Association (FA)', kind: 'sports', country: 'GB', base: 'BHX', prestige: 2 },
  { name: 'Italian Football Federation (FIGC)', kind: 'sports', country: 'IT', base: 'FCO', prestige: 2 },
  { name: 'Royal Dutch Football Association (KNVB)', kind: 'sports', country: 'NL', base: 'AMS', prestige: 2 },
  { name: 'Irish Rugby Football Union (IRFU)', kind: 'sports', country: 'IE', base: 'DUB', prestige: 2 },
  { name: 'Rugby Football Union (RFU)', kind: 'sports', country: 'GB', base: 'LHR', prestige: 2 },
  { name: 'French Rugby Federation (FFR)', kind: 'sports', country: 'FR', base: 'CDG', prestige: 2 },
  { name: 'Lithuanian Basketball Federation', kind: 'sports', country: 'LT', base: 'VNO', prestige: 2 },
  // ----- music promoters and agencies (2) -----
  { name: 'CAA Touring', kind: 'music', country: 'US', base: 'LAX', prestige: 2 },
  { name: 'Semmel Concerts', kind: 'music', country: 'DE', base: 'MUC', prestige: 2 },
  { name: 'DEAG', kind: 'music', country: 'DE', base: 'BER', prestige: 2 },
  { name: 'FKP Scorpio', kind: 'music', country: 'DE', base: 'HAM', prestige: 2 },
  { name: 'Mojo Concerts', kind: 'music', country: 'NL', base: 'AMS', prestige: 2 },
  { name: 'Gérard Drouot Productions', kind: 'music', country: 'FR', base: 'CDG', prestige: 2 },
  { name: 'Everything Is New', kind: 'music', country: 'PT', base: 'LIS', prestige: 2 },
  { name: 'Doctor Music', kind: 'music', country: 'ES', base: 'BCN', prestige: 2 },
  { name: 'SJM Concerts', kind: 'music', country: 'GB', base: 'MAN', prestige: 2 },
  { name: 'Kilimanjaro Live', kind: 'music', country: 'GB', base: 'LHR', prestige: 2 },
  { name: 'Vivo Concerti', kind: 'music', country: 'IT', base: 'MXP', prestige: 2 },
  // ----- companies (2): plant shuttles, offshore and mining rotations, board travel -----
  { name: 'Airbus', kind: 'corporate', country: 'FR', base: 'TLS', prestige: 2 },
  { name: 'Shell', kind: 'corporate', country: 'NL', base: 'AMS', prestige: 2 },
  { name: 'Siemens', kind: 'corporate', country: 'DE', base: 'MUC', prestige: 2 },
  { name: 'TotalEnergies', kind: 'corporate', country: 'FR', base: 'CDG', prestige: 2 },
  { name: 'Maersk', kind: 'corporate', country: 'DK', base: 'CPH', prestige: 2 },
  { name: 'Equinor', kind: 'corporate', country: 'NO', base: 'BGO', prestige: 2 },
  { name: 'Nestlé', kind: 'corporate', country: 'CH', base: 'GVA', prestige: 2 },
  { name: 'Eni', kind: 'corporate', country: 'IT', base: 'FCO', prestige: 2 },
  { name: 'BHP', kind: 'corporate', country: 'AU', base: 'PER', prestige: 2, market: true },
  { name: 'Rio Tinto', kind: 'corporate', country: 'AU', base: 'PER', prestige: 2, market: true },
  // v0.19.4 a Hajj airlift tenderer (widebody tenders), last so no other id moves.
  { name: 'Pakistan International Airlines', kind: 'airline', country: 'PK', base: 'KHI', role: 'hajj', prestige: 3 },
  // v0.24 state and national work for every start base (after the rest, so no other id moves). Malta's return flights:
  // [E] Malta joins Frontex-coordinated return operations, run by its Ministry for Home Affairs; the national football
  // associations fly their teams to away qualifiers by charter [E].
  { name: 'Maltese Ministry for Home Affairs', kind: 'government', country: 'MT', base: 'MLA', role: 'interior', prestige: 3 },
  { name: 'Malta Football Association', kind: 'sports', country: 'MT', base: 'MLA', prestige: 2 },
  { name: 'Football Association of the Czech Republic', kind: 'sports', country: 'CZ', base: 'PRG', prestige: 2 },
  { name: 'Bulgarian Football Union', kind: 'sports', country: 'BG', base: 'SOF', prestige: 2 },
  { name: 'Latvian Football Federation', kind: 'sports', country: 'LV', base: 'RIX', prestige: 2 },
  { name: 'Estonian Football Association', kind: 'sports', country: 'EE', base: 'TLL', prestige: 2 },
  { name: 'Lithuanian Football Federation', kind: 'sports', country: 'LT', base: 'VNO', prestige: 2 },
];

/** v0.16 the rating families the new airlines fly (approximate 2026 fleets); [] none of ours. */
export const AIRLINE_FAMILIES_V016: Record<string, RatingFamily[]> = {
  // v0.19.4
  'Pakistan International Airlines': ['A320', 'B777'],
  'Air France': ['A320', 'A350', 'B777', 'B787', 'A330/340'], KLM: ['B737', 'A320', 'B777', 'B787', 'A330/340'], 'British Airways': ['A320', 'B777', 'B787', 'A350', 'A380'],
  'Virgin Atlantic': ['A330/340', 'A350', 'B787'], Iberia: ['A320', 'A330/340', 'A350'], SWISS: ['A320', 'A330/340', 'B777', 'A350'], 'Turkish Airlines': ['A320', 'B737', 'A330/340', 'A350', 'B777', 'B787'],
  'Air New Zealand': ['A320', 'B787', 'B777'], 'French bee': ['A350'], 'Air Caraïbes': ['A350', 'A330/340'], 'Austrian Airlines': ['A320', 'B777', 'B787'], 'Brussels Airlines': ['A320', 'A330/340'],
  Luxair: ['B737'], 'ITA Airways': ['A320', 'A330/340', 'A350'], Finnair: ['A320', 'A330/340', 'A350'], Icelandair: ['B737', 'B757/767', 'A320'], 'Air Europa': ['B737', 'B787'],
  'Air Serbia': ['A320', 'A330/340'], TAROM: ['B737'], 'KM Malta Airlines': ['A320'], 'Cyprus Airways': [], 'El Al': ['B737', 'B787', 'B777'],
  Aircalin: ['A320', 'A330/340'], 'Air Tahiti Nui': ['B787'], 'Air Austral': ['B737', 'B777', 'B787'], 'Caribbean Airlines': ['B737'], 'Ethiopian Airlines': ['B737', 'A350', 'B777', 'B787'],
  'South African Airways': ['A320', 'A330/340'], 'Air Mauritius': ['A330/340', 'A350'], 'Air Seychelles': ['A320'], 'Cabo Verde Airlines': ['B737', 'B757/767'], 'Air Niugini': ['B737', 'B757/767'],
  'Solomon Airlines': ['A320'], 'Copa Airlines': ['B737'], Bahamasair: ['B737'], 'Cayman Airways': ['B737'],
  Corsair: ['A330/340'], 'TUI Airways': ['B737', 'B787'], World2fly: ['A330/340', 'A350'], Iberojet: ['A330/340', 'A350'], 'Edelweiss Air': ['A320', 'A330/340', 'A350'],
  'Discover Airlines': ['A320', 'A330/340'], Marabu: ['A320'], Neos: ['B737', 'B787'], 'Norse Atlantic Airways': ['B787'], 'Sunclass Airlines': ['A320', 'A330/340'],
  SunExpress: ['B737'], 'Enter Air': ['B737'], Transavia: ['B737', 'A320'], easyJet: ['A320'], Ryanair: ['B737'], Vueling: ['A320'], Volotea: ['A320'], Norwegian: ['B737'],
  'Wizz Air': ['A320'], 'Pegasus Airlines': ['A320', 'B737'], flyadeal: ['A320'],
};

/** v0.16 where the new non-European airlines (and the overseas French ones) send a wet-leased aircraft. */
export const AIRLINE_MARKETS_V016: Record<string, string[]> = {
  // v0.19.4
  'Pakistan International Airlines': ['PK', 'SA', 'AE', 'QA', 'OM', 'BH', 'KW', 'GB', 'FR', 'CA', 'MY', 'TH', 'CN'],
  'Air New Zealand': ['NZ', 'AU', 'FJ', 'WS', 'TO', 'CK', 'NC', 'PF', 'US', 'SG', 'JP'], Aircalin: ['NC', 'AU', 'NZ', 'PF', 'FJ', 'WF', 'VU', 'JP', 'SG'],
  'Air Tahiti Nui': ['PF', 'US', 'FR', 'NZ', 'JP', 'NC'], 'Air Austral': ['RE', 'YT', 'FR', 'MU', 'MG', 'SC', 'ZA', 'TH', 'IN'], 'Caribbean Airlines': ['TT', 'JM', 'BB', 'GY', 'SR', 'AG', 'US', 'CA', 'GB'],
  'Ethiopian Airlines': ['ET', 'KE', 'TZ', 'UG', 'RW', 'DJ', 'SD', 'NG', 'GH', 'ZA', 'AE', 'IN', 'CN', 'GB', 'DE', 'IT', 'FR', 'BE'], 'South African Airways': ['ZA', 'NA', 'ZW', 'ZM', 'MZ', 'MU', 'BR', 'AU', 'GB', 'DE'],
  'Air Mauritius': ['MU', 'RE', 'MG', 'SC', 'ZA', 'KE', 'IN', 'FR', 'GB', 'AE', 'SG', 'MY', 'AU'], 'Air Seychelles': ['SC', 'MU', 'ZA', 'IN', 'LK', 'AE'], 'Cabo Verde Airlines': ['CV', 'PT', 'SN', 'GW', 'US', 'BR', 'IT', 'FR'],
  'Air Niugini': ['PG', 'AU', 'SB', 'FJ', 'SG', 'HK', 'PH', 'JP'], 'Solomon Airlines': ['SB', 'AU', 'FJ', 'VU', 'PG'], 'Copa Airlines': ['PA', 'CO', 'CR', 'GT', 'SV', 'MX', 'US', 'DO', 'JM', 'BR', 'AR', 'CL', 'PE', 'EC', 'VE'],
  Bahamasair: ['BS', 'US', 'TC', 'CU', 'JM', 'HT'], 'Cayman Airways': ['KY', 'US', 'JM', 'HN', 'BS'],
  'El Al': ['IL', 'US', 'GB', 'FR', 'DE', 'IT', 'ES', 'GR', 'CY', 'TH', 'IN'], 'Turkish Airlines': ['TR', 'DE', 'GB', 'FR', 'NL', 'IT', 'ES', 'US', 'SA', 'AE', 'EG', 'MA', 'DZ', 'TN', 'NG', 'KE', 'ZA', 'IN', 'PK', 'TH', 'JP', 'KR', 'CN', 'BR', 'AR', 'GE', 'AZ', 'KZ', 'UZ'],
};

// The new airlines join the family and market tables every builder reads (fliesFamily, inMarket).
Object.assign(AIRLINE_FAMILIES, AIRLINE_FAMILIES_V016);
Object.assign(AIRLINE_MARKETS, AIRLINE_MARKETS_V016);
