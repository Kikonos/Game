// Fictional naming kit (RESEARCH §11). Real operators appear only as history in the docs.

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

export const RIVALS: RivalSeed[] = [
  { name: 'Baltic Wingset', country: 'LT', base: 'VNO', fleet: 'narrow', personality: 'cheap' },
  { name: 'Gozo Sky Charter', country: 'MT', base: 'MLA', fleet: 'mixed', personality: 'steady' },
  { name: 'Iberosol Air Charters', country: 'ES', base: 'MAD', fleet: 'mixed', personality: 'steady' },
  { name: 'Mallorca Prestige Air', country: 'ES', base: 'PMI', fleet: 'mixed', personality: 'premium' },
  { name: 'Fjord Polar Cargo', country: 'IS', base: 'KEF', fleet: 'wide', personality: 'steady' },
  { name: 'Thames Readiness Air', country: 'GB', base: 'STN', fleet: 'narrow', personality: 'rescue' },
  { name: 'Ozark Military Charter', country: 'US', base: 'IAD', fleet: 'wide', personality: 'military' },
  { name: 'Danube Wetlease', country: 'RO', base: 'OTP', fleet: 'narrow', personality: 'cheap' },
  { name: 'Carpathia Jet', country: 'RO', base: 'OTP', fleet: 'narrow', personality: 'cheap' },
];

export const BROKERS = [
  'Meridian Air Partners', 'Northstar Charter Brokers', 'Halcyon Aviation Solutions', 'Albatross Air Brokerage', 'Ironbridge Charter Group',
  'Windrose Air Logistics', 'Bluewater Group Charter', 'Polaris Ad-hoc', 'Cobalt Aviation Advisory',
];

export interface ClientSeed {
  name: string;
  kind: 'airline' | 'tourOperator' | 'government' | 'agency' | 'sports' | 'music' | 'corporate';
  country: string;
  /** Hub or home airport (season bases, AOG cover, home games). */
  base: string;
}

export const CLIENT_SEEDS: ClientSeed[] = [
  // Airlines (season bases, AOG cover, capacity leases)
  { name: 'NordicBlue', kind: 'airline', country: 'SE', base: 'ARN' },
  { name: 'Celtic Skyways', kind: 'airline', country: 'IE', base: 'DUB' },
  { name: 'TransBaltica', kind: 'airline', country: 'LV', base: 'RIX' },
  { name: 'Adriatica', kind: 'airline', country: 'HR', base: 'ZAG' },
  { name: 'Dalmatia Wings', kind: 'airline', country: 'HR', base: 'SPU' },
  { name: 'Hanse Holiday Air', kind: 'airline', country: 'DE', base: 'HAM' },
  { name: 'Rhein Leisure', kind: 'airline', country: 'DE', base: 'DUS' },
  { name: 'Maghreb Crescent Airways', kind: 'airline', country: 'MA', base: 'CMN' },
  { name: 'Levant Star', kind: 'airline', country: 'JO', base: 'AMM' },
  { name: 'Sahelia Airways', kind: 'airline', country: 'SN', base: 'DSS' },
  { name: 'Kalahari Skyways', kind: 'airline', country: 'ZA', base: 'JNB' },
  { name: 'Amazonas Linhas Aéreas', kind: 'airline', country: 'BR', base: 'GRU' },
  { name: 'Cerrado Air', kind: 'airline', country: 'BR', base: 'BSB' },
  { name: 'Lakeshore Air', kind: 'airline', country: 'CA', base: 'YYZ' },
  { name: 'Andina Sur', kind: 'airline', country: 'PE', base: 'LIM' },
  { name: 'Mekong Royal Air', kind: 'airline', country: 'VN', base: 'SGN' },
  // Tour operators and agencies
  { name: 'SunHoliday Reisen', kind: 'tourOperator', country: 'DE', base: 'FRA' },
  { name: 'Costa Dourada Tours', kind: 'tourOperator', country: 'PT', base: 'LIS' },
  { name: 'AquaVista Holidays', kind: 'tourOperator', country: 'GB', base: 'MAN' },
  { name: 'Polar Horizons Expeditions', kind: 'tourOperator', country: 'NO', base: 'OSL' },
  { name: 'Lusofonia Viagens', kind: 'agency', country: 'PT', base: 'LIS' },
  // Government and agency stand-ins
  { name: 'Ministry of Foreign Affairs of Portugal', kind: 'government', country: 'PT', base: 'LIS' },
  { name: 'Ministry of Foreign Affairs of Spain', kind: 'government', country: 'ES', base: 'MAD' },
  { name: 'Ministry of Foreign Affairs of Lithuania', kind: 'government', country: 'LT', base: 'VNO' },
  { name: 'World Peace Mission Office', kind: 'government', country: 'US', base: 'EBB' },
  { name: 'International Migration Relief Organisation', kind: 'agency', country: 'CH', base: 'GVA' },
  { name: 'Ministry of Defence of Portugal', kind: 'government', country: 'PT', base: 'LIS' },
  // Sport, music, corporate
  { name: 'Sporting Atlântico', kind: 'sports', country: 'PT', base: 'LIS' },
  { name: 'Real Ciudad CF', kind: 'sports', country: 'ES', base: 'MAD' },
  { name: 'Dynamo Vilnorth', kind: 'sports', country: 'LT', base: 'VNO' },
  { name: 'Olympique Littoral', kind: 'sports', country: 'FR', base: 'MRS' },
  { name: 'Union Rhein-Ruhr', kind: 'sports', country: 'DE', base: 'DUS' },
  { name: 'Crimson Lions', kind: 'sports', country: 'GB', base: 'LHR' },
  { name: '"The Iron Hymn" world tour', kind: 'music', country: 'GB', base: 'LHR' },
  { name: 'Velocity GP Team', kind: 'corporate', country: 'GB', base: 'LHR' },
];
