// Naming kit: the player's own company presets are fictional; clients, brokers and rivals are real companies.

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
  { name: 'GetJet Airlines', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 6], ['b738', 2]), personality: 'cheap' },
  { name: 'Airhub Airlines', country: 'MT', base: 'MLA', fleet: F(['a320ceo', 4], ['b738', 2]), personality: 'cheap' },
  { name: 'Air Atlanta Icelandic', country: 'IS', base: 'KEF', fleet: F(['b744', 6], ['a333', 2]), personality: 'big' },
  { name: 'Titan Airways', country: 'GB', base: 'STN', fleet: F(['a321ceo', 3], ['a321neo', 2]), personality: 'rescue' },
  { name: 'Global Crossing Airlines', country: 'US', base: 'MIA', fleet: F(['a320ceo', 6], ['a321ceo', 6]), personality: 'steady' },
];

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

export const RIVALS_B1: RivalSeed[] = [
  { name: 'Heston Airlines', country: 'LT', base: 'VNO', fleet: F(['a320ceo', 6]), personality: 'cheap' },
  { name: 'KlasJet', country: 'LT', base: 'VNO', fleet: F(['b738', 3], ['a320ceo', 2]), personality: 'premium' },
  { name: 'Smartwings', country: 'CZ', base: 'PRG', fleet: F(['b738', 20]), personality: 'big' },
];
