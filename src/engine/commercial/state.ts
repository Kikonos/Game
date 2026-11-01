// v0.14 Commercial: the g.com record, its load defaults and the shared helpers (side streams, the borrowed main
// stream, the pace of the event director, clients added on first use).

import { TENDER_CLIENT_SEEDS } from '../../data/fairs';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { muteCues, unmuteCues } from '../core/cues';
import { nextId } from '../core/entities';
import type { RngHolder } from '../core/rng';
import type { Client, GameState, Pace } from '../core/types';
import { hash } from '../core/util';
import { ensureClient } from '../contracts/clients';
import { isQuiet } from '../ops/director';
import type { CommercialState } from './types';

export type { CommercialState };

/** The commercial record (created empty on first use: older saves never had one). */
export function com(g: GameState): CommercialState {
  const c = (g.com ??= { tenders: [], trips: [], crises: [] });
  c.tenders ??= [];
  c.trips ??= [];
  c.crises ??= [];
  return c;
}

export function comStats(g: GameState): NonNullable<CommercialState['stats']> {
  return (com(g).stats ??= { bids: 0, won: 0, lost: 0, trips: 0, leads: 0, crises: 0, written: 0 });
}

/** Load: the record's defaults (SAVE_VERSION stays 1). */
export function loadCommercial(g: GameState): void {
  com(g);
}

/** A side stream for one key: deterministic per game, never touching the main sequence. */
export const sideOf = (g: GameState, key: string): RngHolder => ({ rng: hash(`${g.seed}:com:${key}`) | 0 });

/**
 * Runs `fn` on a borrowed main stream (the offer builders draw from g.rng) seeded from `key`, then puts the game's own
 * sequence back: an RFP or a lead never shifts the rest of the game's randomness. Cues raised inside are dropped
 * (`quiet`: an RFP's ask is not a market offer and must not chime 'New offer').
 */
export function withStream<T>(g: GameState, key: string, fn: () => T, quiet = false): T {
  const main = g.rng;
  g.rng = hash(`${g.seed}:com:${key}`) | 0;
  if (quiet) muteCues();
  try {
    return fn();
  } finally {
    if (quiet) unmuteCues();
    g.rng = main;
  }
}

export const paceOf = (g: GameState): Pace => g.director?.pace ?? 'normal';
/** A busy day of the event director (new work and crises arrive only then). */
export const busyNow = (g: GameState): boolean => !isQuiet(g, g.now);

/** A client by name: in the game, or (v0.14 tender issuers: Ryanair, Wizz Air…) added on first use. */
export function clientByName(g: GameState, name: string): Client | undefined {
  const have = Object.values(g.clients).find((c) => c.name === name);
  if (have) return have;
  const legacy = ensureClient(g, name);
  if (legacy) return legacy;
  const s = TENDER_CLIENT_SEEDS.find((x) => x.name === name);
  if (!s || !AIRPORT_BY_CODE[s.base]) return undefined;
  const eu = s.country !== 'SA' && s.country !== 'TR';
  const c: Client = {
    id: nextId(g, 'cl'), name: s.name, kind: s.kind, country: s.country, base: s.base,
    payReliability: eu ? 0.92 : 0.7, lateDays: eu ? [3, 12] : [7, 40], cleanSensitivity: 0.5,
    relation: 0, jobs: 0, firstJob: null, lastJob: null, log: [], level: 'new',
  };
  g.clients[c.id] = c;
  return c;
}

export const usdK = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e4 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v).toLocaleString('en-US')}`);
