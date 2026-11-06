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
  a339: [{ airline: 'TAP', hub: 'LIS' }, { airline: 'Delta', hub: 'ATL' }, { airline: 'Condor', hub: 'FRA' }],
  a342: [{ airline: 'Aerolíneas Argentinas', hub: 'EZE' }, { airline: 'Conviasa', hub: 'CCS' }, { airline: 'Philippine Airlines', hub: 'MNL' }],
  a345: [{ airline: 'Emirates', hub: 'DXB' }, { airline: 'Etihad', hub: 'AUH' }, { airline: 'Azerbaijan Airlines', hub: 'GYD' }],
  a346: [{ airline: 'Lufthansa', hub: 'MUC' }, { airline: 'Iberia', hub: 'MAD' }, { airline: 'Virgin Atlantic', hub: 'LHR' }, { airline: 'South African', hub: 'JNB' }],
  a35k: [{ airline: 'Qatar Airways', hub: 'DOH' }, { airline: 'Cathay Pacific', hub: 'HKG' }, { airline: 'British Airways', hub: 'LHR' }],
  b739: [{ airline: 'Lion Air', hub: 'CGK' }, { airline: 'Alaska Airlines', hub: 'SEA' }, { airline: 'United', hub: 'IAH' }],
  b753: [{ airline: 'Condor', hub: 'FRA' }, { airline: 'Icelandair', hub: 'KEF' }, { airline: 'Delta', hub: 'MSP' }],
  b788: [{ airline: 'Norwegian', hub: 'OSL' }, { airline: 'Ethiopian', hub: 'ADD' }, { airline: 'Jetstar', hub: 'MEL' }],
  b78x: [{ airline: 'Etihad', hub: 'AUH' }, { airline: 'Singapore Airlines', hub: 'SIN' }, { airline: 'EVA Air', hub: 'TPE' }],
  b748: [{ airline: 'Lufthansa', hub: 'FRA' }, { airline: 'Korean Air', hub: 'ICN' }, { airline: 'Air China', hub: 'PEK' }],
  b744: [{ airline: 'Lufthansa', hub: 'FRA' }, { airline: 'British Airways', hub: 'LHR' }, { airline: 'KLM', hub: 'AMS' }, { airline: 'Virgin Atlantic', hub: 'LGW' }],
  a388: [{ airline: 'Emirates', hub: 'DXB' }, { airline: 'Singapore Airlines', hub: 'SIN' }, { airline: 'Malaysia Airlines', hub: 'KUL' }],
};

/** New-build delivery centres by family (the A320 family from Hamburg or Toulouse). */
export const FACTORIES: Partial<Record<RatingFamily, { maker: string; sites: Site[] }>> = {
  A320: { maker: 'Airbus', sites: [{ code: 'HAM', name: 'Airbus', city: 'Hamburg' }, { code: 'TLS', name: 'Airbus', city: 'Toulouse' }] },
  A350: { maker: 'Airbus', sites: [{ code: 'TLS', name: 'Airbus', city: 'Toulouse' }] },
  B787: { maker: 'Boeing', sites: [{ code: 'CHS', name: 'Boeing', city: 'Charleston' }] },
  // v0.10 A330neo final assembly in Toulouse; 777X from Everett (handed over via Seattle).
  'A330/340': { maker: 'Airbus', sites: [{ code: 'TLS', name: 'Airbus', city: 'Toulouse' }] },
  B777: { maker: 'Boeing', sites: [{ code: 'SEA', name: 'Boeing', city: 'Everett' }] },
};

/** Types offered as rare new-build lease slots. */
export const NEW_BUILD = ['a321neo', 'b789', 'a359', 'a35u', 'a339', 'a35k', 'b788', 'b78x', 'b779', 'b778'];

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

// ---------- v0.17 "Aircraft market" (UPDATE-0.17.md §I, §J.3; lane `supply`) ----------

/**
 * Storage and part-out sites where failure batches and stored aircraft are handed over: Tarmac Aerosave Tarbes, Shannon,
 * Tarmac Aerosave Teruel (TEV) and Pinal Airpark, Marana (MZJ). TEV and MZJ have no airline service and are not in
 * airports.ts (an airport row there would also become a fuel-stop and alternate candidate for every route): codes
 * not in airports.ts are dropped where they are used, as for LESSOR_SITES.
 */
export const STORAGE_SITES: Site[] = [
  { code: 'LDE', name: 'Tarmac Aerosave', city: 'Tarbes' },
  { code: 'TEV', name: 'Tarmac Aerosave', city: 'Teruel' },
  { code: 'MZJ', name: 'Pinal Airpark', city: 'Marana' },
  { code: 'SNN', name: 'Atlantic Aviation Group', city: 'Shannon' },
];

/** An airline with a spare aircraft in its quiet season (UTC months, 0 = January), subleased short-term (§I.1). */
export interface SpotSource {
  airline: string;
  typeId: string;
  /** Its base: handover and return. TUI fly Deutschland flies from Hannover, which is not in airports.ts: Frankfurt. */
  base: string;
  months: number[];
}

/**
 * Real short-term lessors (§I.1, research-supply §4): European leisure airlines' 737s and A320s come free in winter,
 * Asian and southern-hemisphere airlines' in their own quiet months (Cebu Pacific's A320s to flyadeal, Norse's
 * 787-9s to IndiGo and Air Tahiti Nui's in the southern winter).
 */
export const SPOT_SOURCES: SpotSource[] = [
  { airline: 'TUI fly Deutschland', typeId: 'b738', base: 'FRA', months: [10, 11, 0, 1, 2] },
  { airline: 'SunExpress', typeId: 'b738', base: 'AYT', months: [10, 11, 0, 1, 2] },
  { airline: 'Smartwings', typeId: 'b738', base: 'PRG', months: [10, 11, 0, 1, 2] },
  { airline: 'Enter Air', typeId: 'b738', base: 'WAW', months: [10, 11, 0, 1, 2] },
  { airline: 'Condor', typeId: 'a320ceo', base: 'FRA', months: [10, 11, 0, 1] },
  { airline: 'Corendon', typeId: 'b738', base: 'AMS', months: [10, 11, 0, 1, 2] },
  { airline: 'Cebu Pacific', typeId: 'a320ceo', base: 'MNL', months: [6, 7, 8] },
  { airline: 'IndiGo', typeId: 'a320ceo', base: 'DEL', months: [6, 7, 8] },
  { airline: 'Jetstar', typeId: 'a320ceo', base: 'MEL', months: [4, 5, 6, 7] },
  { airline: 'Aerolíneas Argentinas', typeId: 'b738', base: 'AEP', months: [4, 5, 6, 7] },
  { airline: 'Norse Atlantic', typeId: 'b789', base: 'OSL', months: [10, 11, 0, 1, 2] },
  { airline: 'Air Transat', typeId: 'a333', base: 'YUL', months: [4, 5, 6, 7, 8] },
  { airline: 'Air Tahiti Nui', typeId: 'b789', base: 'PPT', months: [4, 5, 6, 7] },
];

/**
 * The fleets of the airlines that fail in the world events (§J.3): their main type, which comes to the market as a
 * batch. Air Moldova flew A320s (and Embraers); TAROM 737-800s (and ATRs).
 */
export const FAILURE_FLEETS: Record<string, { typeId: string; wide?: string }> = {
  'Air Moldova': { typeId: 'a320ceo' },
  TAROM: { typeId: 'b738' },
};
