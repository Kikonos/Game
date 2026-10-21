// Real clients and rivals from the naming kit (B1).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { CLIENT_SEEDS, CLIENT_SEEDS_B1, RIVALS, RIVALS_B1, type ClientSeed } from '../../data/naming';
import { nextId } from '../core/entities';
import { distance } from '../core/geo';
import { typeOf } from '../core/perf';
import { weightedPick } from '../core/rng';
import type { Client, ClientKind, ContractOffer, GameState, Rival } from '../core/types';
import type { AdhocGroup } from './flavor';

const EUROPE = new Set(['PT', 'ES', 'LT', 'LV', 'MT', 'DE', 'IE', 'SE', 'HR', 'FR', 'GB', 'CH', 'NO', 'IT', 'NL', 'BE', 'AT', 'DK', 'FI', 'PL', 'CZ', 'BG', 'EE', 'SK', 'RO']);

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
for (const s of [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1]) {
  SEED_BY_NAME[s.name] = s;
  if (s.role) ROLE_BY_NAME[s.name] = s.role;
}

/** Seeds g.clients at new game (skips seeds whose base airport is unknown). */
export function seedClients(g: GameState): void {
  for (const s of [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1]) {
    if (!AIRPORT_BY_CODE[s.base]) continue;
    const c: Client = { id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0 };
    g.clients[c.id] = c;
  }
}

const PRICE: Record<Rival['personality'], [number, number]> = { cheap: [0.88, 0.6], premium: [1.15, 0.9], rescue: [1.1, 0.8], military: [1.05, 0.85], steady: [1.0, 0.75] };

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
  const wide = req.body ? req.body === 'wide' : req.minSeats >= 230;
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
