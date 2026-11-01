// Naming kit: the player's own company presets are fictional; clients, brokers and rivals are real companies.

import type { RatingFamily } from './acmiTypes';

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
 * Missing: any family; [] none of ours (A220 / Embraer operators).
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
  RwandAir: ['B737', 'A330/340'], 'Air Tanzania': ['B737', 'B787'], IndiGo: ['A320', 'A330/340'], SpiceJet: ['B737'], 'SriLankan Airlines': ['A320', 'A330/340'],
  'US-Bangla Airlines': ['B737'], 'Jeju Air': ['B737'], 'Hong Kong Airlines': ['A320', 'A330/340'], 'Juneyao Air': ['A320', 'B787'], 'Cebu Pacific': ['A320', 'A330/340'],
  AirAsia: ['A320'], 'VietJet Air': ['A320', 'A330/340'], Qantas: ['B737', 'A330/340', 'B787'], 'Virgin Australia': ['B737'], 'Jetstar Airways': ['A320', 'B787'],
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
}

export const CLIENT_SEEDS: ClientSeed[] = [
  // Airlines (season bases, AOG cover, capacity leases)
  { name: 'SAS Scandinavian Airlines', kind: 'airline', country: 'SE', base: 'ARN' },
  { name: 'Aer Lingus', kind: 'airline', country: 'IE', base: 'DUB' },
  { name: 'airBaltic', kind: 'airline', country: 'LV', base: 'RIX' },
  { name: 'Croatia Airlines', kind: 'airline', country: 'HR', base: 'ZAG' },
  { name: 'LOT Polish Airlines', kind: 'airline', country: 'PL', base: 'WAW' },
  { name: 'Condor', kind: 'airline', country: 'DE', base: 'HAM' },
  { name: 'Eurowings', kind: 'airline', country: 'DE', base: 'DUS' },
  { name: 'Lufthansa', kind: 'airline', country: 'DE', base: 'FRA' },
  { name: 'TAP Air Portugal', kind: 'airline', country: 'PT', base: 'LIS' },
  { name: 'Royal Air Maroc', kind: 'airline', country: 'MA', base: 'CMN' },
  { name: 'Royal Jordanian', kind: 'airline', country: 'JO', base: 'AMM' },
  { name: 'Air Sénégal', kind: 'airline', country: 'SN', base: 'DSS' },
  { name: 'TAAG Angola Airlines', kind: 'airline', country: 'AO', base: 'LAD' },
  { name: 'Airlink', kind: 'airline', country: 'ZA', base: 'JNB' },
  { name: 'LATAM Brasil', kind: 'airline', country: 'BR', base: 'GRU' },
  { name: 'GOL Linhas Aéreas', kind: 'airline', country: 'BR', base: 'BSB' },
  { name: 'Azul Brazilian Airlines', kind: 'airline', country: 'BR', base: 'GRU' },
  { name: 'Air Canada', kind: 'airline', country: 'CA', base: 'YYZ' },
  { name: 'LATAM Perú', kind: 'airline', country: 'PE', base: 'LIM' },
  { name: 'Vietnam Airlines', kind: 'airline', country: 'VN', base: 'SGN' },
  { name: 'Saudia', kind: 'airline', country: 'SA', base: 'JED' },
  { name: 'flynas', kind: 'airline', country: 'SA', base: 'RUH' },
  // Tour operators and agencies
  { name: 'TUI Deutschland', kind: 'tourOperator', country: 'DE', base: 'FRA' },
  { name: 'Jet2holidays', kind: 'tourOperator', country: 'GB', base: 'MAN' },
  { name: 'Sunweb', kind: 'tourOperator', country: 'NL', base: 'AMS' },
  { name: 'Corendon', kind: 'tourOperator', country: 'NL', base: 'AMS', role: 'diaspora' },
  { name: 'Viagens Abreu', kind: 'agency', country: 'PT', base: 'LIS', role: 'diaspora' },
  // Governments and agencies
  { name: 'Portuguese Ministry of Foreign Affairs', kind: 'government', country: 'PT', base: 'LIS', role: 'foreign' },
  { name: 'Spanish Ministry of Foreign Affairs', kind: 'government', country: 'ES', base: 'MAD', role: 'foreign' },
  { name: 'Lithuanian Ministry of Foreign Affairs', kind: 'government', country: 'LT', base: 'VNO', role: 'foreign' },
  { name: 'UK Foreign Office (FCDO)', kind: 'government', country: 'GB', base: 'LHR', role: 'foreign' },
  { name: 'German Federal Foreign Office', kind: 'government', country: 'DE', base: 'BER', role: 'foreign' },
  { name: 'UN World Food Programme (WFP)', kind: 'agency', country: 'IT', base: 'FCO', role: 'aid' },
  { name: 'UN Department of Peace Operations (DPO)', kind: 'government', country: 'US', base: 'JFK', role: 'aid' },
  { name: 'UNHCR', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid' },
  { name: 'International Organization for Migration (IOM)', kind: 'agency', country: 'CH', base: 'GVA', role: 'aid' },
  { name: 'Portuguese Ministry of National Defence', kind: 'government', country: 'PT', base: 'LIS', role: 'defence' },
  // Sport, music, corporate
  { name: 'Sporting CP', kind: 'sports', country: 'PT', base: 'LIS', tier: 'big' },
  { name: 'SL Benfica', kind: 'sports', country: 'PT', base: 'LIS', tier: 'big' },
  { name: 'Real Madrid', kind: 'sports', country: 'ES', base: 'MAD', tier: 'big' },
  { name: 'Olympique de Marseille', kind: 'sports', country: 'FR', base: 'MRS', tier: 'big' },
  { name: 'Fortuna Düsseldorf', kind: 'sports', country: 'DE', base: 'DUS' },
  { name: 'Manchester United', kind: 'sports', country: 'GB', base: 'MAN', tier: 'big' },
  { name: 'Live Nation', kind: 'music', country: 'US', base: 'LHR' },
  { name: 'Formula 1', kind: 'corporate', country: 'GB', base: 'LHR' },
];

// ---------- B1 additions (contracts): more clients so every home base has its ministries, tour operators and clubs ----------

export const CLIENT_SEEDS_B1: ClientSeed[] = [
  { name: 'Maltese Ministry for Foreign Affairs', kind: 'government', country: 'MT', base: 'MLA', role: 'foreign' },
  { name: 'Latvian Ministry of Foreign Affairs', kind: 'government', country: 'LV', base: 'RIX', role: 'foreign' },
  { name: 'Spanish Ministry of Defence', kind: 'government', country: 'ES', base: 'MAD', role: 'defence' },
  { name: 'Lithuanian Ministry of National Defence', kind: 'government', country: 'LT', base: 'VNO', role: 'defence' },
  { name: 'Armed Forces of Malta', kind: 'government', country: 'MT', base: 'MLA', role: 'defence' },
  { name: 'Latvian Ministry of Defence', kind: 'government', country: 'LV', base: 'RIX', role: 'defence' },
  { name: 'Czech Ministry of Foreign Affairs', kind: 'government', country: 'CZ', base: 'PRG', role: 'foreign' },
  { name: 'Czech Ministry of Defence', kind: 'government', country: 'CZ', base: 'PRG', role: 'defence' },
  { name: 'Bulgarian Ministry of Foreign Affairs', kind: 'government', country: 'BG', base: 'SOF', role: 'foreign' },
  { name: 'Bulgarian Ministry of Defence', kind: 'government', country: 'BG', base: 'SOF', role: 'defence' },
  { name: 'Estonian Ministry of Foreign Affairs', kind: 'government', country: 'EE', base: 'TLL', role: 'foreign' },
  { name: 'Estonian Ministry of Defence', kind: 'government', country: 'EE', base: 'TLL', role: 'defence' },
  { name: 'Čedok', kind: 'tourOperator', country: 'CZ', base: 'PRG' },
  { name: 'Bulgaria Air', kind: 'airline', country: 'BG', base: 'SOF' },
  { name: 'Novatours', kind: 'tourOperator', country: 'LT', base: 'VNO' },
  { name: 'Frontex', kind: 'agency', country: 'PL', base: 'WAW', role: 'aid' },
  { name: 'EU Civil Protection and Humanitarian Aid (ECHO)', kind: 'agency', country: 'BE', base: 'BRU', role: 'aid' },
  { name: 'Fiji Airways', kind: 'airline', country: 'FJ', base: 'NAN' },
  { name: 'Jet2.com', kind: 'airline', country: 'GB', base: 'MAN' },
  { name: 'TUI fly Belgium', kind: 'airline', country: 'BE', base: 'BRU' },
  { name: 'Corendon Airlines', kind: 'airline', country: 'TR', base: 'AYT' },
  { name: 'Schauinsland-Reisen', kind: 'tourOperator', country: 'DE', base: 'DUS' },
  { name: 'Aegean Airlines', kind: 'airline', country: 'GR', base: 'ATH' },
  { name: 'Sunwing Vacations', kind: 'tourOperator', country: 'CA', base: 'YYZ' },
  { name: 'Abercrombie & Kent', kind: 'tourOperator', country: 'GB', base: 'LHR' },
  { name: 'Joe Walsh Tours', kind: 'agency', country: 'IE', base: 'DUB', role: 'pilgrim' },
  { name: 'Opera Romana Pellegrinaggi', kind: 'agency', country: 'IT', base: 'FCO', role: 'pilgrim' },
  { name: 'Novartis', kind: 'corporate', country: 'CH', base: 'ZRH' },
  { name: 'FC Barcelona', kind: 'sports', country: 'ES', base: 'BCN', tier: 'big' },
  { name: 'AEG Presents', kind: 'music', country: 'GB', base: 'LHR' },
  { name: 'Wasserman Music', kind: 'music', country: 'US', base: 'JFK' },
  { name: 'Riga FC', kind: 'sports', country: 'LV', base: 'RIX' },
  { name: 'Floriana FC', kind: 'sports', country: 'MT', base: 'MLA' },
  { name: 'FK Žalgiris', kind: 'sports', country: 'LT', base: 'VNO' },
  { name: 'Ajax', kind: 'sports', country: 'NL', base: 'AMS', tier: 'big' },
  // Group travel, events and marine crewing (ad hoc work).
  { name: 'Columbia Shipmanagement', kind: 'agency', country: 'CY', base: 'LCA', role: 'marine', marine: 'ships' },
  { name: 'Bernhard Schulte Shipmanagement', kind: 'agency', country: 'DE', base: 'HAM', role: 'marine', marine: 'ships' },
  { name: 'Wallem Group', kind: 'agency', country: 'HK', base: 'HKG', role: 'marine', marine: 'ships' },
  { name: 'Anglo-Eastern Ship Management', kind: 'agency', country: 'HK', base: 'HKG', role: 'marine', marine: 'ships' },
  { name: 'Carnival Corporation crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine', marine: 'cruise' },
  { name: 'MSC Cruises crew travel', kind: 'agency', country: 'CH', base: 'GVA', role: 'marine', marine: 'cruise' },
  { name: 'Royal Caribbean crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine', marine: 'cruise' },
  { name: 'Hotelplan Group', kind: 'agency', country: 'CH', base: 'ZRH' },
  { name: 'Kuoni Group Travel', kind: 'agency', country: 'CH', base: 'ZRH' },
  { name: 'Sportsworld Group Travel', kind: 'agency', country: 'GB', base: 'LGW' },
  { name: 'American Express Global Business Travel', kind: 'corporate', country: 'GB', base: 'LHR' },
  { name: 'BBC Studios', kind: 'corporate', country: 'GB', base: 'LHR' },
];

// ---------- v0.8 (UPDATE-0.8.md §2): Hajj, presidencies, interior ministries, health and polar clients ----------

export const CLIENT_SEEDS_V08: ClientSeed[] = [
  { name: 'Garuda Indonesia', kind: 'airline', country: 'ID', base: 'CGK', role: 'hajj' },
  { name: 'Biman Bangladesh Airlines', kind: 'airline', country: 'BD', base: 'DAC', role: 'hajj' },
  { name: 'National Hajj Commission of Nigeria', kind: 'government', country: 'NG', base: 'ABV', role: 'hajj' },
  { name: 'Pakistan Ministry of Religious Affairs', kind: 'government', country: 'PK', base: 'ISB', role: 'hajj' },
  { name: 'Air Algérie', kind: 'airline', country: 'DZ', base: 'ALG', role: 'hajj' },
  { name: 'Presidência da República de Angola', kind: 'government', country: 'AO', base: 'LAD', role: 'presidency' },
  { name: 'Présidence de la République du Sénégal', kind: 'government', country: 'SN', base: 'DSS', role: 'presidency' },
  { name: 'Office of the President of Ghana', kind: 'government', country: 'GH', base: 'ACC', role: 'presidency' },
  { name: 'Presidency of Nigeria', kind: 'government', country: 'NG', base: 'ABV', role: 'presidency' },
  { name: 'UK Home Office', kind: 'government', country: 'GB', base: 'STN', role: 'interior' },
  { name: 'Spanish Ministry of the Interior', kind: 'government', country: 'ES', base: 'MAD', role: 'interior' },
  { name: 'German Federal Police', kind: 'government', country: 'DE', base: 'BER', role: 'interior' },
  { name: 'World Health Organization (WHO)', kind: 'agency', country: 'CH', base: 'GVA', role: 'health' },
  { name: 'International SOS', kind: 'agency', country: 'GB', base: 'LHR', role: 'health' },
  { name: 'White Desert', kind: 'tourOperator', country: 'ZA', base: 'CPT', role: 'polar' },
  { name: 'Norwegian Polar Institute (DROMLAN)', kind: 'government', country: 'NO', base: 'CPT', role: 'polar' },
  { name: 'Antarctic Logistics & Expeditions', kind: 'agency', country: 'US', base: 'PUQ', role: 'polar' },
];

/**
 * v0.14 market presence: airlines and a tour operator in the markets outside Europe that wet-lease from European ACMI
 * operators (capacity gaps, late deliveries, the peaks). Added to a new game and to an older save on load (by name).
 * Their offers come mostly once we are known in their market (contracts/offers.ts presence weights).
 */
export const CLIENT_SEEDS_V014: ClientSeed[] = [
  { name: 'Air Peace', kind: 'airline', country: 'NG', base: 'LOS' },
  { name: 'Air Côte d’Ivoire', kind: 'airline', country: 'CI', base: 'ABJ' },
  { name: 'ASKY Airlines', kind: 'airline', country: 'TG', base: 'LFW' },
  { name: 'Africa World Airlines', kind: 'airline', country: 'GH', base: 'ACC' },
  { name: 'Kenya Airways', kind: 'airline', country: 'KE', base: 'NBO' },
  { name: 'RwandAir', kind: 'airline', country: 'RW', base: 'KGL' },
  { name: 'Air Tanzania', kind: 'airline', country: 'TZ', base: 'DAR' },
  { name: 'IndiGo', kind: 'airline', country: 'IN', base: 'DEL' },
  { name: 'SpiceJet', kind: 'airline', country: 'IN', base: 'DEL' },
  { name: 'SriLankan Airlines', kind: 'airline', country: 'LK', base: 'CMB' },
  { name: 'US-Bangla Airlines', kind: 'airline', country: 'BD', base: 'DAC' },
  { name: 'Jeju Air', kind: 'airline', country: 'KR', base: 'ICN' },
  { name: 'Hong Kong Airlines', kind: 'airline', country: 'HK', base: 'HKG' },
  { name: 'Juneyao Air', kind: 'airline', country: 'CN', base: 'PVG' },
  { name: 'H.I.S.', kind: 'tourOperator', country: 'JP', base: 'NRT' },
  { name: 'Cebu Pacific', kind: 'airline', country: 'PH', base: 'MNL' },
  { name: 'AirAsia', kind: 'airline', country: 'MY', base: 'KUL' },
  { name: 'VietJet Air', kind: 'airline', country: 'VN', base: 'SGN' },
  { name: 'Qantas', kind: 'airline', country: 'AU', base: 'SYD' },
  { name: 'Virgin Australia', kind: 'airline', country: 'AU', base: 'BNE' },
  { name: 'Jetstar Airways', kind: 'airline', country: 'AU', base: 'MEL' },
  { name: 'Air Transat', kind: 'airline', country: 'CA', base: 'YUL' },
  { name: 'WestJet', kind: 'airline', country: 'CA', base: 'YYC' },
  { name: 'Sun Country Airlines', kind: 'airline', country: 'US', base: 'MSP' },
  { name: 'Avianca', kind: 'airline', country: 'CO', base: 'BOG' },
  { name: 'Viva Aerobus', kind: 'airline', country: 'MX', base: 'MTY' },
  { name: 'Aerolíneas Argentinas', kind: 'airline', country: 'AR', base: 'EZE' },
  { name: 'Sky Airline', kind: 'airline', country: 'CL', base: 'SCL' },
  { name: 'Arajet', kind: 'airline', country: 'DO', base: 'SDQ' },
  { name: 'Kuwait Airways', kind: 'airline', country: 'KW', base: 'KWI' },
  { name: 'Oman Air', kind: 'airline', country: 'OM', base: 'MCT' },
  { name: 'Tunisair', kind: 'airline', country: 'TN', base: 'TUN' },
  { name: 'EgyptAir', kind: 'airline', country: 'EG', base: 'CAI' },
];

/**
 * v0.12.1 world tours: Les Voyages de TMR (Marseille; its 'Tour du monde en avion privé' leaves from Paris CDG, 51 tours
 * so far). Added to a game the first time one of its tours is offered (contracts/clients.ts ensureClient), so a game
 * that never sees one keeps the client list it started with.
 */
export const CLIENT_SEEDS_V0121: ClientSeed[] = [
  { name: 'Les Voyages de TMR', kind: 'tourOperator', country: 'FR', base: 'CDG' },
];

export const RIVALS_B1: RivalSeed[] = [
  { name: 'Heston Airlines', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 6]), personality: 'cheap' },
  { name: 'KlasJet', country: 'LT', base: 'VNO', fleet: F(['b738', 3], ['a320ceo', 2]), personality: 'premium' },
  { name: 'Smartwings', country: 'CZ', base: 'PRG', fleet: F(['b738', 20]), personality: 'big' },
];
