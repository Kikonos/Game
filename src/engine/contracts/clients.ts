// Fictional clients and rivals from the naming kit (B1).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { CLIENT_SEEDS, CLIENT_SEEDS_B1, RIVALS, RIVALS_B1, type ClientSeed } from '../../data/naming';
import { nextId } from '../core/entities';
import type { Client, ClientKind, GameState, Rival } from '../core/types';

const EUROPE = new Set(['PT', 'ES', 'LT', 'LV', 'MT', 'DE', 'IE', 'SE', 'HR', 'FR', 'GB', 'CH', 'NO', 'IT', 'NL', 'BE', 'AT', 'DK', 'FI', 'PL']);

/** Payment behaviour per kind (RESEARCH §4.3: commercial pays on time; governments 30–90 days late). */
function behaviour(s: ClientSeed): Pick<Client, 'payReliability' | 'lateDays' | 'cleanSensitivity'> {
  const eu = EUROPE.has(s.country);
  switch (s.kind) {
    case 'airline':
      return eu ? { payReliability: 0.92, lateDays: [3, 12], cleanSensitivity: 0.5 } : { payReliability: 0.7, lateDays: [7, 40], cleanSensitivity: 0.4 };
    case 'tourOperator':
      return { payReliability: 0.85, lateDays: [5, 20], cleanSensitivity: 0.5 };
    case 'government':
      return { payReliability: 0.35, lateDays: [20, 75], cleanSensitivity: 0.4 };
    case 'agency':
      return s.name.includes('Organisation') || s.name.includes('Coalition')
        ? { payReliability: 0.5, lateDays: [15, 60], cleanSensitivity: 0.8 }
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

/** Seeds g.clients at new game (skips seeds whose base airport is unknown). */
export function seedClients(g: GameState): void {
  for (const s of [...CLIENT_SEEDS, ...CLIENT_SEEDS_B1]) {
    if (!AIRPORT_BY_CODE[s.base]) continue;
    const c: Client = { id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base, ...behaviour(s), relation: 0 };
    g.clients[c.id] = c;
  }
}

const FLEETS: Record<'narrow' | 'wide' | 'mixed', Rival['fleet']> = {
  narrow: [{ typeId: 'a320ceo', count: 4 }, { typeId: 'b738', count: 2 }],
  wide: [{ typeId: 'b763', count: 2 }, { typeId: 'a333', count: 2 }],
  mixed: [{ typeId: 'a320ceo', count: 3 }, { typeId: 'a332', count: 1 }],
};
const PRICE: Record<Rival['personality'], [number, number]> = { cheap: [0.88, 0.6], premium: [1.15, 0.9], rescue: [1.1, 0.8], military: [1.05, 0.85], steady: [1.0, 0.75] };

/** Seeds g.rivals (names for "a rival took it"; B3 sub-charters to them). */
export function seedRivals(g: GameState): void {
  if (g.rivals.length) return;
  for (const r of [...RIVALS, ...RIVALS_B1]) {
    const [priceFactor, quality] = PRICE[r.personality];
    g.rivals.push({ id: nextId(g, 'rv'), name: r.name, country: r.country, base: r.base, fleet: FLEETS[r.fleet], priceFactor, quality, personality: r.personality });
  }
}

export function clientsOf(g: GameState, kinds: ClientKind[], pred: (c: Client) => boolean = () => true): Client[] {
  return Object.values(g.clients).filter((c) => kinds.includes(c.kind) && pred(c));
}

/** The home country's ministry ('Foreign Affairs' or 'Defence'), falling back to any. */
export function ministry(g: GameState, which: 'Foreign Affairs' | 'Defence'): Client | undefined {
  const country = AIRPORT_BY_CODE[g.company.homeBase]?.country;
  const all = clientsOf(g, ['government'], (c) => c.name.startsWith(`Ministry of ${which}`));
  return all.find((c) => c.country === country) ?? all[0];
}

/** Two-letter flight-number prefix from a client name ('Hanse Holiday Air' → 'HH', 'NordicBlue' → 'NB'). */
export function clientPrefix(name: string): string {
  const words = name.replace(/[^A-Za-zÀ-ÿ ]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const caps = name.match(/[A-Z]/g) ?? [];
  if (caps.length >= 2) return caps[0] + caps[1];
  return name.slice(0, 2).toUpperCase();
}

/** Single-purpose agencies: only their own kind of job (pilgrimages, diaspora, cruise crews, aid). */
const SPECIALISTS = ['Peregrinos de Fátima', 'Lusofonia Viagens', 'Mareterra Crew Logistics', 'Harbourline Crew Travel', 'International Migration Relief Organisation', 'Global Health Airbridge Coalition'];
export const isSpecialist = (c: Client) => SPECIALISTS.includes(c.name);
export const isMarineCrewing = (c: Client) => c.name.endsWith('Crew Logistics') || c.name.endsWith('Crew Travel');

export const isGovernment = (c: Client | undefined) => c?.kind === 'government' || (c?.kind === 'agency' && (c.name.includes('Organisation') || c.name.includes('Coalition')));
