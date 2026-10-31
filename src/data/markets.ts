// v0.14 market presence: the world split into the markets a charter airline sells in. Built from the game's regions
// (data/regions.ts), with West & East Africa split by country. Each market has a demand calendar: real ACMI demand by
// month (summer leisure in Europe, Hajj and Umrah in the Gulf, the Lunar New Year and Golden Weeks in Asia, the
// southern summer in Oceania) and a lean towards the kinds of work it asks for most (capacity gaps in West Africa and
// Latin America ask for wet leases; the Gulf for pilgrim flights).

import type { Archetype } from '../engine/core/types';
import { AIRPORT_BY_CODE, AIRPORTS } from './airports';
import type { ContinentId } from './regions';

export type MarketId = 'nwe' | 'seu' | 'cee' | 'me' | 'naf' | 'waf' | 'eaf' | 'sas' | 'eas' | 'sea' | 'oce' | 'nam' | 'lat';

export interface Market {
  id: MarketId;
  name: string;
  /** For the presence bars. */
  short: string;
  continent: ContinentId;
  /** Regions (data/regions.ts) it holds; `countries` adds or moves single countries. */
  regions: string[];
  /** Demand by month Jan–Dec (1 = usual). */
  season: number[];
  /** One line on what its clients ask for. */
  demand: string;
  /** Kinds of work asked for more (or less) often than elsewhere. */
  tilt?: Partial<Record<Archetype, number>>;
}

const EUROPE_SUMMER = [0.7, 0.75, 0.9, 1.1, 1.25, 1.35, 1.4, 1.35, 1.15, 0.95, 0.7, 0.8];

export const MARKETS: Market[] = [
  { id: 'nwe', name: 'Northwest Europe', short: 'Northwest Europe', continent: 'EU', regions: ['UKI', 'WEU', 'NOR'], season: EUROPE_SUMMER, demand: 'Summer leisure for the UK, Benelux and Nordic tour operators; winter is thin.', tilt: { seasonBase: 1.2, tourSeries: 1.2 } },
  { id: 'seu', name: 'Southern Europe', short: 'Southern Europe', continent: 'EU', regions: ['IBE', 'MED'], season: EUROPE_SUMMER, demand: 'Island and beach peaks from May to September; the network airlines short of lift.', tilt: { seasonBase: 1.3, aogCover: 1.1 } },
  { id: 'cee', name: 'Central & Eastern Europe', short: 'Central & East Europe', continent: 'EU', regions: ['CEU', 'EEU'], season: EUROPE_SUMMER, demand: 'German and Polish holiday charters; diaspora flights at Christmas and Easter.', tilt: { tourSeries: 1.2, adhoc: 1.1 } },
  { id: 'me', name: 'Middle East', short: 'Middle East', continent: 'ME', regions: ['GULF', 'LEV'], season: [1.1, 1.0, 1.1, 1.1, 1.0, 1.2, 1.1, 1.0, 0.9, 1.0, 1.0, 1.1], demand: 'Hajj and Umrah lift, Gulf winter sun and Türkiye’s summer: wet leases around the pilgrimage.', tilt: { hajj: 1.6, seasonBase: 1.1, vip: 1.3 } },
  { id: 'naf', name: 'North Africa', short: 'North Africa', continent: 'AF', regions: ['NAF'], season: [0.9, 0.9, 1.0, 1.1, 1.1, 1.2, 1.3, 1.3, 1.0, 1.0, 0.9, 1.0], demand: 'Diaspora summers from Europe, Red Sea resorts, Hajj flights from Morocco to Egypt.', tilt: { hajj: 1.3, adhoc: 1.2 } },
  { id: 'waf', name: 'West & Central Africa', short: 'West Africa', continent: 'AF', regions: [], season: [1.0, 0.9, 0.9, 1.0, 1.0, 1.1, 1.2, 1.2, 1.0, 1.0, 1.0, 1.3], demand: 'Chronic capacity gaps: airlines wet-lease to keep schedules; Hajj and Christmas diaspora peaks.', tilt: { seasonBase: 1.4, aogCover: 1.3, hajj: 1.2 } },
  { id: 'eaf', name: 'East & Southern Africa', short: 'East & South Africa', continent: 'AF', regions: ['SAF', 'ANT'], season: [1.1, 1.0, 0.9, 0.9, 0.9, 1.0, 1.2, 1.2, 1.0, 1.0, 1.0, 1.2], demand: 'Safari and Indian Ocean seasons, relief and UN work, the southern-summer peak.', tilt: { humanitarian: 1.4, unRotation: 1.4, seasonBase: 1.1 } },
  { id: 'sas', name: 'South Asia', short: 'South Asia', continent: 'AS', regions: ['SAS'], season: [1.1, 0.9, 0.9, 1.0, 1.1, 1.2, 1.0, 0.9, 0.9, 1.1, 1.2, 1.2], demand: 'Huge volume and thin fares; Hajj lift, Gulf workers, the Diwali and winter wedding peaks.', tilt: { hajj: 1.4, seasonBase: 1.1 } },
  { id: 'eas', name: 'East Asia', short: 'East Asia', continent: 'AS', regions: ['CHN', 'JKR'], season: [1.3, 1.3, 0.9, 0.9, 1.2, 0.9, 1.1, 1.2, 0.9, 1.2, 0.9, 1.0], demand: 'Lunar New Year, Golden Week and the summer holidays: peaks the airlines cannot cover alone.', tilt: { seasonBase: 1.2, tourSeries: 1.1 } },
  { id: 'sea', name: 'Southeast Asia', short: 'Southeast Asia', continent: 'AS', regions: ['SEA'], season: [1.2, 1.2, 1.0, 1.0, 0.9, 0.9, 1.1, 1.1, 0.9, 0.9, 1.0, 1.3], demand: 'Island tourism and Hajj from Indonesia and Malaysia; December to February is high season.', tilt: { hajj: 1.3, tourSeries: 1.2 } },
  { id: 'oce', name: 'Oceania', short: 'Oceania', continent: 'OC', regions: ['AUS', 'PAC'], season: [1.3, 1.1, 1.0, 1.0, 0.9, 1.0, 1.1, 1.0, 0.9, 1.0, 1.0, 1.3], demand: 'The southern summer, mining rotations and the Pacific islands’ thin routes.', tilt: { troopRotation: 1.2, seasonBase: 1.1 } },
  { id: 'nam', name: 'North America', short: 'North America', continent: 'NA', regions: ['USNE', 'USSE', 'USC', 'USW', 'CAN'], season: [0.9, 1.0, 1.1, 1.0, 1.0, 1.2, 1.2, 1.1, 0.9, 1.0, 1.1, 1.1], demand: 'Sports teams, tour programmes and summer wet leases; Thanksgiving and Christmas peaks.', tilt: { sports: 1.5, vip: 1.2 } },
  { id: 'lat', name: 'Latin America & Caribbean', short: 'Latin America', continent: 'SA', regions: ['MXC', 'SAN', 'BRA', 'SCO'], season: [1.3, 1.1, 1.0, 0.9, 0.9, 1.0, 1.2, 1.1, 0.9, 0.9, 1.0, 1.3], demand: 'Capacity gaps at fast-growing airlines, Caribbean winter sun and the July holidays.', tilt: { seasonBase: 1.4, aogCover: 1.2 } },
];

export const MARKET_BY_ID = Object.fromEntries(MARKETS.map((m) => [m.id, m])) as Record<MarketId, Market>;
export const MARKET_IDS: MarketId[] = MARKETS.map((m) => m.id);

/** West & East Africa (region WEA) split: these countries are East Africa, the rest West & Central. */
const EAST_AFRICA = new Set(['ET', 'KE', 'TZ', 'UG', 'RW', 'SS', 'SO', 'DJ', 'ER', 'BI', 'KM']);

const BY_REGION: Record<string, MarketId> = Object.fromEntries(MARKETS.flatMap((m) => m.regions.map((r) => [r, m.id])));

/** Country → market, from the region of its airports (the West & East Africa split by country). */
const BY_COUNTRY: Record<string, MarketId> = (() => {
  const out: Record<string, MarketId> = {};
  for (const a of AIRPORTS) {
    if (out[a.country]) continue;
    if (a.region === 'WEA') out[a.country] = EAST_AFRICA.has(a.country) ? 'eaf' : 'waf';
    else if (BY_REGION[a.region]) out[a.country] = BY_REGION[a.region];
  }
  return out;
})();

/** The market of a country (Europe's middle by default for a country with no airport in the data). Pure. */
export const marketOfCountry = (country: string): MarketId => BY_COUNTRY[country] ?? (EAST_AFRICA.has(country) ? 'eaf' : 'cee');

/** The market of an airport. Pure. */
export function marketOfAirport(code: string): MarketId | undefined {
  const a = AIRPORT_BY_CODE[code];
  return a ? marketOfCountry(a.country) : undefined;
}
