// v0.7 aircraft market places (UPDATE-0.7.md §F6.2, §F7.2): where aircraft change hands and where cabins are
// refitted. Real sites; codes not in airports.ts are dropped where they are used.

import type { RatingFamily } from './acmiTypes';

export interface Site {
  code: string;
  /** Who hands the aircraft over / does the work. */
  name: string;
  /** City as people say it (Tarbes, not Lourdes). */
  city: string;
}

/** Lessor storage, redelivery and MRO sites (all with airline service, so delivery pilots can fly in). */
export const LESSOR_SITES: Site[] = [
  { code: 'SNN', name: 'Atlantic Aviation Group', city: 'Shannon' },
  { code: 'LDE', name: 'Tarmac Aerosave', city: 'Tarbes' },
  { code: 'TLS', name: 'Tarmac Aerosave Francazal', city: 'Toulouse' },
  { code: 'MLA', name: 'Lufthansa Technik Malta', city: 'Malta' },
  { code: 'VNO', name: 'FL Technics', city: 'Vilnius' },
  { code: 'HAM', name: 'Lufthansa Technik', city: 'Hamburg' },
  { code: 'MAD', name: 'Iberia Maintenance', city: 'Madrid' },
];

export interface ExOperator {
  airline: string;
  hub: string;
}

/** Real former operators of each type (used aircraft are handed over at their hub). */
export const EX_OPERATORS: Record<string, ExOperator[]> = {
  a320ceo: [{ airline: 'Vueling', hub: 'BCN' }, { airline: 'IndiGo', hub: 'DEL' }, { airline: 'Lufthansa', hub: 'FRA' }],
  b738: [{ airline: 'Turkish Airlines', hub: 'IST' }, { airline: 'Norwegian', hub: 'OSL' }],
  a321ceo: [{ airline: 'Lufthansa', hub: 'FRA' }, { airline: 'Turkish Airlines', hub: 'IST' }],
  a321neo: [{ airline: 'Aer Lingus', hub: 'DUB' }, { airline: 'Wizz Air', hub: 'BUD' }],
  b752: [{ airline: 'Icelandair', hub: 'KEF' }, { airline: 'Condor', hub: 'FRA' }],
  b763: [{ airline: 'Condor', hub: 'FRA' }, { airline: 'LATAM', hub: 'SCL' }, { airline: 'Air Canada', hub: 'YUL' }, { airline: 'ANA', hub: 'NRT' }],
  a332: [{ airline: 'Air Europa', hub: 'MAD' }, { airline: 'TAP', hub: 'LIS' }, { airline: 'Turkish Airlines', hub: 'IST' }],
  a333: [{ airline: 'Garuda', hub: 'CGK' }, { airline: 'Malaysia Airlines', hub: 'KUL' }, { airline: 'Cathay Pacific', hub: 'HKG' }],
  a343: [{ airline: 'Lufthansa', hub: 'MUC' }, { airline: 'SWISS', hub: 'ZRH' }, { airline: 'South African', hub: 'JNB' }],
  b772: [{ airline: 'Singapore Airlines', hub: 'SIN' }, { airline: 'Kenya Airways', hub: 'NBO' }],
  b77w: [{ airline: 'Emirates', hub: 'DXB' }, { airline: 'Air France', hub: 'CDG' }],
  b789: [{ airline: 'Norwegian', hub: 'OSL' }, { airline: 'Etihad', hub: 'AUH' }],
  a359: [{ airline: 'Thai Airways', hub: 'BKK' }, { airline: 'Cathay Pacific', hub: 'HKG' }],
  a35u: [{ airline: 'Singapore Airlines', hub: 'SIN' }],
  b77l: [{ airline: 'Air India', hub: 'BOM' }],
  a388: [{ airline: 'Emirates', hub: 'DXB' }, { airline: 'Singapore Airlines', hub: 'SIN' }, { airline: 'Malaysia Airlines', hub: 'KUL' }],
};

/** New-build delivery centres by family (the A320 family from Hamburg or Toulouse). */
export const FACTORIES: Partial<Record<RatingFamily, { maker: string; sites: Site[] }>> = {
  A320: { maker: 'Airbus', sites: [{ code: 'HAM', name: 'Airbus', city: 'Hamburg' }, { code: 'TLS', name: 'Airbus', city: 'Toulouse' }] },
  A350: { maker: 'Airbus', sites: [{ code: 'TLS', name: 'Airbus', city: 'Toulouse' }] },
  B787: { maker: 'Boeing', sites: [{ code: 'CHS', name: 'Boeing', city: 'Charleston' }] },
};

/** Types offered as rare new-build lease slots. */
export const NEW_BUILD = ['a321neo', 'b789', 'a359', 'a35u'];

export interface MroStation extends Site {
  /** Bodies it can take: narrowbody only, or both. */
  wide: boolean;
}

/** Cabin refit shops (UPDATE-0.7.md §F7.2). */
export const MRO_STATIONS: MroStation[] = [
  { code: 'LIS', name: 'TAP Maintenance & Engineering', city: 'Lisbon', wide: true },
  { code: 'MAD', name: 'Iberia Maintenance', city: 'Madrid', wide: true },
  { code: 'HAM', name: 'Lufthansa Technik', city: 'Hamburg', wide: true },
  { code: 'MLA', name: 'Lufthansa Technik Malta', city: 'Malta', wide: true },
  { code: 'VNO', name: 'FL Technics', city: 'Vilnius', wide: false },
  { code: 'SNN', name: 'Atlantic Aviation Group', city: 'Shannon', wide: false },
  { code: 'IST', name: 'Turkish Technic', city: 'Istanbul', wide: true },
  { code: 'AUH', name: 'Etihad Engineering', city: 'Abu Dhabi', wide: true },
  { code: 'AMM', name: 'Joramco', city: 'Amman', wide: true },
  { code: 'SIN', name: 'ST Engineering', city: 'Singapore', wide: true },
];
