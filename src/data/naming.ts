// Naming kit: the player's own company presets are fictional; clients, brokers and rivals are real, neutral names.

export interface CompanyPreset {
  name: string;
  code: string;
  icao: string;
  callsign: string;
  base: string;
}

/** New-game presets; the base list doubles as the v0.5 home-base choice (Lisbon default). */
export const COMPANY_PRESETS: CompanyPreset[] = [
  { name: 'Atlântica Wings', code: 'AW', icao: 'ATW', callsign: 'ATLANTICA', base: 'LIS' },
  { name: 'Amberline Air', code: 'AB', icao: 'ABL', callsign: 'AMBERLINE', base: 'VNO' },
  { name: 'Valletta Jetlease', code: 'VJ', icao: 'VJL', callsign: 'MALTESE', base: 'MLA' },
  { name: 'Iberosol Charter', code: 'IS', icao: 'IBS', callsign: 'SOLAIR', base: 'MAD' },
  { name: 'Daugava Wetlease', code: 'DW', icao: 'DGW', callsign: 'DAUGAVA', base: 'RIX' },
];

export const HOME_BASES = ['LIS', 'VNO', 'MLA', 'MAD', 'RIX'] as const;

export interface RivalSeed {
  name: string;
  country: string;
  base: string;
  /** Narrow, wide or mixed fleet. */
  fleet: 'narrow' | 'wide' | 'mixed';
  personality: 'cheap' | 'premium' | 'rescue' | 'military' | 'steady';
}

/** Real ACMI / charter operators used as competing bidders and sub-charter partners (SmartLynx ceased in Nov 2025: excluded). */
export const RIVALS: RivalSeed[] = [
  { name: 'Hi Fly', country: 'PT', base: 'LIS', fleet: 'wide', personality: 'steady' },
  { name: 'euroAtlantic airways', country: 'PT', base: 'LIS', fleet: 'mixed', personality: 'steady' },
  { name: 'Wamos Air', country: 'ES', base: 'MAD', fleet: 'wide', personality: 'steady' },
  { name: 'Privilege Style', country: 'ES', base: 'PMI', fleet: 'mixed', personality: 'premium' },
  { name: 'Avion Express', country: 'LT', base: 'VNO', fleet: 'narrow', personality: 'cheap' },
  { name: 'GetJet Airlines', country: 'LT', base: 'VNO', fleet: 'narrow', personality: 'cheap' },
  { name: 'Airhub Airlines', country: 'MT', base: 'MLA', fleet: 'narrow', personality: 'cheap' },
  { name: 'Air Atlanta Icelandic', country: 'IS', base: 'KEF', fleet: 'wide', personality: 'steady' },
  { name: 'Titan Airways', country: 'GB', base: 'STN', fleet: 'narrow', personality: 'rescue' },
  { name: 'Global Crossing Airlines', country: 'US', base: 'MIA', fleet: 'narrow', personality: 'steady' },
];

export const BROKERS = [
  'Chapman Freeborn', 'Air Charter Service', 'Air Partner', 'ACC Aviation', 'Avia Solutions Group', 'PrivateFly',
  'Stratos Jets', 'Click Charter', 'Aviation Capacity Brokers',
];

export interface ClientSeed {
  name: string;
  kind: 'airline' | 'tourOperator' | 'government' | 'agency' | 'sports' | 'music' | 'corporate';
  country: string;
  /** Hub or home airport (season bases, AOG cover, home games). */
  base: string;
  /** Special handling: ministries, aid bodies, single-purpose agencies. */
  role?: 'foreign' | 'defence' | 'aid' | 'marine' | 'diaspora' | 'pilgrim';
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
  { name: 'Corendon', kind: 'tourOperator', country: 'NL', base: 'AMS' },
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
  { name: 'Sporting CP', kind: 'sports', country: 'PT', base: 'LIS' },
  { name: 'SL Benfica', kind: 'sports', country: 'PT', base: 'LIS' },
  { name: 'Real Madrid', kind: 'sports', country: 'ES', base: 'MAD' },
  { name: 'Olympique de Marseille', kind: 'sports', country: 'FR', base: 'MRS' },
  { name: 'Fortuna Düsseldorf', kind: 'sports', country: 'DE', base: 'DUS' },
  { name: 'Manchester United', kind: 'sports', country: 'GB', base: 'MAN' },
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
  { name: 'Frontex', kind: 'agency', country: 'PL', base: 'WAW', role: 'aid' },
  { name: 'EU Civil Protection and Humanitarian Aid (ECHO)', kind: 'agency', country: 'BE', base: 'BRU', role: 'aid' },
  { name: 'Fiji Airways', kind: 'airline', country: 'FJ', base: 'NAN' },
  { name: 'Jet2.com', kind: 'airline', country: 'GB', base: 'MAN' },
  { name: 'TUI fly Belgium', kind: 'airline', country: 'BE', base: 'BRU' },
  { name: 'Corendon Airlines', kind: 'airline', country: 'TR', base: 'AYT' },
  { name: 'Neckermann Reisen', kind: 'tourOperator', country: 'DE', base: 'FRA' },
  { name: 'Aegean Airlines', kind: 'airline', country: 'GR', base: 'ATH' },
  { name: 'Sunwing Vacations', kind: 'tourOperator', country: 'CA', base: 'YYZ' },
  { name: 'Abercrombie & Kent', kind: 'tourOperator', country: 'ZA', base: 'CPT' },
  { name: 'Santuário de Fátima pilgrimages', kind: 'agency', country: 'PT', base: 'OPO', role: 'pilgrim' },
  { name: 'Novartis', kind: 'corporate', country: 'CH', base: 'ZRH' },
  { name: 'Barcelona Football Club', kind: 'sports', country: 'ES', base: 'BCN' },
  { name: 'AEG Presents', kind: 'music', country: 'GB', base: 'LHR' },
  { name: 'Wasserman Music', kind: 'music', country: 'US', base: 'JFK' },
  { name: 'Rīgas FK', kind: 'sports', country: 'LV', base: 'RIX' },
  { name: 'Floriana FC', kind: 'sports', country: 'MT', base: 'MLA' },
  { name: 'Žalgiris Kaunas', kind: 'sports', country: 'LT', base: 'VNO' },
  { name: 'Ajax', kind: 'sports', country: 'NL', base: 'AMS' },
  // Group travel, events and marine crewing (ad hoc work).
  { name: 'Columbia Shipmanagement', kind: 'agency', country: 'CY', base: 'LCA', role: 'marine' },
  { name: 'Bernhard Schulte Shipmanagement', kind: 'agency', country: 'DE', base: 'HAM', role: 'marine' },
  { name: 'Wallem Group', kind: 'agency', country: 'HK', base: 'HKG', role: 'marine' },
  { name: 'Anglo-Eastern Ship Management', kind: 'agency', country: 'IN', base: 'BOM', role: 'marine' },
  { name: 'Carnival Corporation crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine' },
  { name: 'MSC Cruises crew travel', kind: 'agency', country: 'CH', base: 'GVA', role: 'marine' },
  { name: 'Royal Caribbean crew travel', kind: 'agency', country: 'US', base: 'MIA', role: 'marine' },
  { name: 'Hotelplan Group', kind: 'agency', country: 'CH', base: 'ZRH' },
  { name: 'Kuoni Group Travel', kind: 'agency', country: 'CH', base: 'ZRH' },
  { name: 'Sportsworld Group Travel', kind: 'agency', country: 'GB', base: 'LGW' },
  { name: 'American Express Global Business Travel', kind: 'corporate', country: 'GB', base: 'LHR' },
  { name: 'BBC Studios', kind: 'corporate', country: 'GB', base: 'LHR' },
];

export const RIVALS_B1: RivalSeed[] = [
  { name: 'Heston Airlines', country: 'PL', base: 'WAW', fleet: 'narrow', personality: 'cheap' },
  { name: 'KlasJet', country: 'LT', base: 'VNO', fleet: 'narrow', personality: 'steady' },
  { name: 'Smartwings', country: 'CZ', base: 'PRG', fleet: 'narrow', personality: 'steady' },
];
