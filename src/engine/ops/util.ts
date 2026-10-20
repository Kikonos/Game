// Small helpers shared by the ops modules (B3).

import { typeOf } from '../core/perf';
import { yearOf } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, Stats } from '../core/types';
import { clamp } from '../core/util';

/** Lifetime counters with B3's optional fields defaulted. */
export function stats(g: GameState): Required<Stats> {
  const s = g.stats;
  s.departures ??= 0;
  s.aogs ??= 0;
  s.uncovered ??= 0;
  s.illegalFlown ??= 0;
  s.decisions ??= 0;
  s.augmentedDuties ??= 0;
  s.ulrSectors ??= 0;
  s.subchartered ??= 0;
  return s as Required<Stats>;
}

/** '$1.24M', '$340K', '$900'. */
export function usd(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}$${Math.round(a / 1e3)}K`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${Math.round(a)}`;
}

export const ageOf = (g: GameState, ac: Aircraft) => Math.max(0, yearOf(g.now) - ac.builtYear);
/** Age factor used by delay and AOG rolls: 1 + age/10. */
export const ageF = (g: GameState, ac: Aircraft) => 1 + ageOf(g, ac) / 10;
export const turnOf = (ac: Aircraft) => typeOf(ac.typeId).turnMin;
export const isRevenue = (f: Flight) => f.kind === 'revenue' || f.kind === 'techstop';
export const contractOf = (g: GameState, f: Flight): Contract | undefined => (f.contractId ? g.contracts[f.contractId] : undefined);
/** Legs of a base programme (season base, AOG cover) vs one-off trips (charters, rotations). */
export const isBaseLeg = (g: GameState, f: Flight) => contractOf(g, f)?.pattern.kind === 'base';

export function bumpReliable(g: GameState, d: number): void {
  const r = g.company.reputation;
  r.reliable = clamp(Math.round((r.reliable + d) * 100) / 100, 0, 100);
}

export function bumpRelation(g: GameState, clientId: string | undefined, d: number): void {
  const c = clientId ? g.clients[clientId] : undefined;
  if (c) c.relation = clamp(c.relation + d, -100, 100);
}
