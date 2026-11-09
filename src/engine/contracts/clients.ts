// Real clients and rivals from the naming kit (B1).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { CLIENT_SEEDS, CLIENT_SEEDS_B1, CLIENT_SEEDS_V08, CLIENT_SEEDS_V014, CLIENT_SEEDS_V016, CLIENT_SEEDS_V0121, RIVALS, RIVALS_B1, type ClientSeed } from '../../data/naming';
import { nextId } from '../core/entities';
import { distance } from '../core/geo';
import { typeOf } from '../core/perf';
import { weightedPick } from '../core/rng';
import type { Client, ClientKind, ContractOffer, GameState, Rival } from '../core/types';
import type { AdhocGroup } from './flavor';
import { isWideJob } from './pricing';
import { seedClientStars, seedPrestige } from './prestige';

const EUROPE = new Set(['PT', 'ES', 'LT', 'LV', 'MT', 'DE', 'IE', 'SE', 'HR', 'FR', 'GB', 'CH', 'NO', 'IT', 'NL', 'BE', 'AT', 'DK', 'FI', 'PL', 'CZ', 'BG', 'EE', 'SK', 'RO', 'HU', 'IS', 'LU', 'GR', 'CY', 'RS']);

/** Payment behaviour per kind (RESEARCH §4.3: commercial pays on time; governments 30–90 days late). */
function behaviour(s: ClientSeed): Pick<Client, 'payReliability' | 'lateDays' | 'cleanSensitivity'> {
  const eu = EUROPE.has(s.country);
  switch (s.kind) {
    case 'airline':
      return eu ? { payReliability: 0.92, lateDays: [3, 12], cleanSensitivity: 0.5 } : { payReliability: 0.7, lateDays: [7, 40], cleanSensitivity: 0.4 };
    case 'tourOperator':
      return { payReliability: 0.85, lateDays: [5, 20], cleanSensitivity: 0.5 };
    case 'government':
      // v0.6: governments mostly pay late (RESEARCH §4.3: 30–90 days).
      return { payReliability: 0.2, lateDays: [25, 90], cleanSensitivity: 0.4 };
    case 'agency':
      return s.role === 'aid'
        ? { payReliability: 0.4, lateDays: [15, 60], cleanSensitivity: 0.8 }
        : { payReliability: 0.8, lateDays: [5, 25], cleanSensitivity: 0.4 };
    case 'sports':
      return { payReliability: 0.9, lateDays: [3, 15], cleanSensitivity: 0.7 };
    case 'music':
      return { payReliability: 0.75, lateDays: [5, 30], cleanSensitivity: 0.3 };
    case 'corporate':
      return { payReliability: 0.95, lateDays: [2, 10], cleanSensitivity: 0.8 };
    default:
      return { payReliability: 0.85, lateDays: [5, 20], cleanSensitivity: 0.5 };
  }
}

const ROLE_BY_NAME: Record<string, ClientSeed['role']> = {};
const SEED_BY_NAME: Record<string, ClientSeed> = {};
const ALL_SEEDS = [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1, ...CLIENT_SEEDS_V08];
for (const s of [...ALL_SEEDS, ...CLIENT_SEEDS_V014, ...CLIENT_SEEDS_V016]) {
  SEED_BY_NAME[s.name] = s;
  if (s.role) ROLE_BY_NAME[s.name] = s.role;
}

/** Seeds g.clients at new game (skips seeds whose base airport is unknown). */
export function seedClients(g: GameState): void {
  for (const s of ALL_SEEDS) {
    if (!AIRPORT_BY_CODE[s.base]) continue;
    const c: Client = { id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0, prestige: seedPrestige(s, s.role), stars: seedClientStars(s) };
    g.clients[c.id] = c;
  }
  seedClientsV016(g);
}

/** v0.14 the market-presence clients by name (data/naming.ts CLIENT_SEEDS_V014; v0.16 the new seeds marked `market`). */
const MARKET_SEEDS = new Set([...CLIENT_SEEDS_V014.map((s) => s.name), ...CLIENT_SEEDS_V016.filter((s) => s.market).map((s) => s.name)]);
export const isMarketClient = (c: Pick<Client, 'name'>): boolean => MARKET_SEEDS.has(c.name);

/**
 * v0.16 the real clients the player asked for (data/naming.ts CLIENT_SEEDS_V016): a new game and an older save on load,
 * by name (one that already exists, say a tender's airline added on first use, keeps its record); ids of their own
 * ('cx' + the seed's place), as the v0.14 market clients, so nothing else shifts. Their level comes with the seed.
 */
export function seedClientsV016(g: GameState): void {
  const have = new Set(Object.values(g.clients).map((c) => c.name));
  CLIENT_SEEDS_V016.forEach((s, i) => {
    if (have.has(s.name) || !AIRPORT_BY_CODE[s.base]) return;
    const id = `cx${i.toString(36)}`;
    if (g.clients[id]) return;
    g.clients[id] = { id, name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new', prestige: s.prestige ?? seedPrestige(s, s.role), stars: seedClientStars(s) };
  });
}

/**
 * v0.14 the market-presence clients (a new game, and an older save on load): ids of their own ('cm' + the seed's
 * place), so adding them shifts no other id (side streams are keyed by ids) and a save gets the same ids as a new game.
 */
export function seedMarketClients(g: GameState): void {
  const have = new Set(Object.values(g.clients).map((c) => c.name));
  CLIENT_SEEDS_V014.forEach((s, i) => {
    if (have.has(s.name) || !AIRPORT_BY_CODE[s.base]) return;
    const id = `cm${i.toString(36)}`;
    if (g.clients[id]) return;
    g.clients[id] = { id, name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new', prestige: seedPrestige(s, s.role), stars: seedClientStars(s) };
  });
}

/** v0.8 load: clients added since the save was made (Hajj, presidencies, interior, health, polar), by name. */
export function loadClients(g: GameState): void {
  const have = new Set(Object.values(g.clients).map((c) => c.name));
  for (const s of ALL_SEEDS) {
    if (have.has(s.name) || !AIRPORT_BY_CODE[s.base]) continue;
    const c: Client = { id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0, prestige: seedPrestige(s, s.role), stars: seedClientStars(s) };
    g.clients[c.id] = c;
  }
  seedClientsV016(g);
}

/**
 * v0.12.1 a client added on first use (data/naming.ts CLIENT_SEEDS_V0121: the world-tour operators), or the one by
 * that name already in the game; undefined when the name is unknown or its base is not an airport we list.
 */
export function ensureClient(g: GameState, name: string): Client | undefined {
  const have = Object.values(g.clients).find((c) => c.name === name);
  if (have) return have;
  const s = CLIENT_SEEDS_V0121.find((x) => x.name === name);
  if (!s || !AIRPORT_BY_CODE[s.base]) return undefined;
  // As loadRelations sets them on a new game's clients: no jobs yet, a fresh log, a New client.
  const c: Client = { id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new', prestige: seedPrestige(s, s.role), stars: seedClientStars(s) };
  g.clients[c.id] = c;
  return c;
}

/** v0.8 the client's special role (hajj, presidency, interior, health, polar, foreign, defence, aid…). */
export const roleOf = (c: Client | undefined): ClientSeed['role'] | undefined => (c ? ROLE_BY_NAME[c.name] : undefined);

const PRICE: Record<Rival['personality'], [number, number]> = { cheap: [0.88, 0.6], premium: [1.15, 0.9], rescue: [1.1, 0.8], military: [1.05, 0.85], steady: [1.0, 0.75], big: [0.95, 0.75] };

/** Seeds g.rivals (names for "a rival took it"; B3 sub-charters to them). */
export function seedRivals(g: GameState): void {
  if (g.rivals.length) return;
  for (const r of [...RIVALS, ...RIVALS_B1]) {
    const [priceFactor, quality] = PRICE[r.personality];
    g.rivals.push({ id: nextId(g, 'rv'), name: r.name, country: r.country, base: r.base, fleet: r.fleet.map((f) => ({ ...f })), priceFactor, quality, personality: r.personality });
  }
}

export function clientsOf(g: GameState, kinds: ClientKind[], pred: (c: Client) => boolean = () => true): Client[] {
  return Object.values(g.clients).filter((c) => kinds.includes(c.kind) && pred(c));
}

/** The home country's ministry ('Foreign Affairs' or 'Defence'), falling back to any. */
export function ministry(g: GameState, which: 'Foreign Affairs' | 'Defence'): Client | undefined {
  const country = AIRPORT_BY_CODE[g.company.homeBase]?.country;
  const role = which === 'Defence' ? 'defence' : 'foreign';
  const all = clientsOf(g, ['government'], (c) => ROLE_BY_NAME[c.name] === role);
  return all.find((c) => c.country === country) ?? all[0];
}

/** Real IATA designators of airline clients: a wet-leased aircraft flies under the lessee's flight numbers. */
const IATA: Record<string, string> = {
  'SAS Scandinavian Airlines': 'SK', 'Aer Lingus': 'EI', airBaltic: 'BT', 'Croatia Airlines': 'OU', 'LOT Polish Airlines': 'LO',
  Condor: 'DE', Eurowings: 'EW', Lufthansa: 'LH', 'TAP Air Portugal': 'TP', 'Royal Air Maroc': 'AT', 'Royal Jordanian': 'RJ',
  'Air Sénégal': 'HC', 'TAAG Angola Airlines': 'DT', Airlink: '4Z', 'LATAM Brasil': 'JJ', 'GOL Linhas Aéreas': 'G3',
  'Azul Brazilian Airlines': 'AD', 'Air Canada': 'AC', 'LATAM Perú': 'LP', 'Vietnam Airlines': 'VN', Saudia: 'SV', flynas: 'XY',
  'Aegean Airlines': 'A3', 'Bulgaria Air': 'FB', 'Corendon Airlines': 'XC', 'Fiji Airways': 'FJ', 'Jet2.com': 'LS', 'TUI fly Belgium': 'TB',
  // v0.8
  'Garuda Indonesia': 'GA', 'Biman Bangladesh Airlines': 'BG', 'Air Algérie': 'AH', 'Pakistan International Airlines': 'PK',
  // v0.14 the market-presence airlines
  'Air Peace': 'P4', 'Air Côte d’Ivoire': 'HF', 'ASKY Airlines': 'KP', 'Africa World Airlines': 'AW', 'Kenya Airways': 'KQ', RwandAir: 'WB',
  'Air Tanzania': 'TC', IndiGo: '6E', SpiceJet: 'SG', 'SriLankan Airlines': 'UL', 'US-Bangla Airlines': 'BS', 'Jeju Air': '7C', 'Hong Kong Airlines': 'HX',
  'Juneyao Air': 'HO', 'Cebu Pacific': '5J', AirAsia: 'AK', 'VietJet Air': 'VJ', Qantas: 'QF', 'Virgin Australia': 'VA', 'Jetstar Airways': 'JQ',
  'Air Transat': 'TS', WestJet: 'WS', 'Sun Country Airlines': 'SY', Avianca: 'AV', 'Viva Aerobus': 'VB', 'Aerolíneas Argentinas': 'AR', 'Sky Airline': 'H2',
  Arajet: 'DM', 'Kuwait Airways': 'KU', 'Oman Air': 'WY', Tunisair: 'TU', EgyptAir: 'MS',
  // v0.16 the new airlines (data/naming.ts CLIENT_SEEDS_V016)
  'Air France': 'AF', KLM: 'KL', 'British Airways': 'BA', 'Virgin Atlantic': 'VS', Iberia: 'IB', SWISS: 'LX', 'Turkish Airlines': 'TK', 'Air New Zealand': 'NZ',
  'French bee': 'BF', 'Air Caraïbes': 'TX', 'Austrian Airlines': 'OS', 'Brussels Airlines': 'SN', Luxair: 'LG', 'ITA Airways': 'AZ', Finnair: 'AY', Icelandair: 'FI',
  'Air Europa': 'UX', 'Air Serbia': 'JU', TAROM: 'RO', 'KM Malta Airlines': 'KM', 'Cyprus Airways': 'CY', 'El Al': 'LY', Aircalin: 'SB', 'Air Tahiti Nui': 'TN',
  'Air Austral': 'UU', 'Caribbean Airlines': 'BW', 'Ethiopian Airlines': 'ET', 'South African Airways': 'SA', 'Air Mauritius': 'MK', 'Air Seychelles': 'HM',
  'Cabo Verde Airlines': 'VR', 'Air Niugini': 'PX', 'Solomon Airlines': 'IE', 'Copa Airlines': 'CM', Bahamasair: 'UP', 'Cayman Airways': 'KX',
  Corsair: 'SS', 'TUI Airways': 'BY', World2fly: '2W', Iberojet: 'E9', 'Edelweiss Air': 'WK', 'Discover Airlines': '4Y', Marabu: 'DI', Neos: 'NO',
  'Norse Atlantic Airways': 'N0', 'Sunclass Airlines': 'DK', SunExpress: 'XQ', 'Enter Air': 'E4', Transavia: 'HV', easyJet: 'U2', Ryanair: 'FR', Vueling: 'VY',
  Volotea: 'V7', Norwegian: 'DY', 'Wizz Air': 'W6', 'Pegasus Airlines': 'PC', flyadeal: 'F3',
};
/** Every designator a client flies under (preset company codes must avoid these). */
export const CLIENT_DESIGNATORS: readonly string[] = Object.values(IATA);

/** Flight-number prefix: the airline's IATA code, else initials ('Air Canada' → 'AC'). */

export function clientPrefix(name: string): string {
  if (IATA[name]) return IATA[name];
  const words = name.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-Z]/g) ?? [];
  if (caps.length >= 2) return caps[0] + caps[1];
  return name.slice(0, 2).toUpperCase();
}

/** Single-purpose agencies: only their own kind of job (pilgrimages, diaspora, cruise crews, aid). */
export const isSpecialist = (c: Client) => !!ROLE_BY_NAME[c.name] && c.kind === 'agency';
export const isMarineCrewing = (c: Client) => ROLE_BY_NAME[c.name] === 'marine';
export const isDiaspora = (c: Client) => ROLE_BY_NAME[c.name] === 'diaspora';
export const isPilgrim = (c: Client) => ROLE_BY_NAME[c.name] === 'pilgrim';
/** Cruise lines move a ship's crew; ship managers fly crew changes for several cargo/tanker vessels. */
export const isCruiseLine = (c: Client) => SEED_BY_NAME[c.name]?.marine === 'cruise';
/** Clubs big enough for a widebody pre-season tour abroad. */
export const isBigClub = (c: Client) => SEED_BY_NAME[c.name]?.tier === 'big';

/** Clients that would book this ad hoc group: any of its kinds plus its named clients (no ministries or specialists). */
export function adhocGroupClients(g: GameState, group: AdhocGroup): Client[] {
  return Object.values(g.clients).filter(
    (c) => (group.kinds.includes(c.kind as never) || !!group.clients?.includes(c.name)) && !isGovernment(c) && !isSpecialist(c) && !!AIRPORT_BY_CODE[c.base],
  );
}

/** Company screen line for a rival: base city and typical type families, no counts ('Lisbon · typical fleet A330/340, A350'). */
export function rivalFleetText(r: Rival): string {
  const fams = [...new Set(r.fleet.map((f) => typeOf(f.typeId).family))];
  return `${AIRPORT_BY_CODE[r.base]?.city ?? r.base} · typical fleet ${fams.join(', ')}`;
}

/** A rival that could have taken this offer: its fleet fits (family, else body), weighted towards the job's area; any rival as the fallback. */
export function rivalFor(g: GameState, o: Pick<ContractOffer, 'requirements' | 'pin'>): Rival | undefined {
  if (!g.rivals.length) return undefined;
  const req = o.requirements;
  const wide = isWideJob(req);
  const fits = (r: Rival) =>
    r.fleet.some((f) => {
      const t = typeOf(f.typeId);
      return req.families?.length ? req.families.includes(t.family) : (t.body === 'wide') === wide;
    });
  const fit = g.rivals.filter(fits);
  const pool = fit.length ? fit : g.rivals;
  const ok = !!AIRPORT_BY_CODE[o.pin];
  return weightedPick(g, pool, (r) => (ok && AIRPORT_BY_CODE[r.base] ? 1 / (1 + distance(r.base, o.pin) / 1500) : 1));
}

export const isGovernment = (c: Client | undefined) => c?.kind === 'government' || (c?.kind === 'agency' && ROLE_BY_NAME[c.name] === 'aid');
