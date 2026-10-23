// Small helpers shared by the ops modules (B3).

import { typeOf } from '../core/perf';
import { yearOf } from '../core/time';
import type { Aircraft, Contract, Flight, GameState, MaintenanceEvent, Stats } from '../core/types';
import { clamp } from '../core/util';

/** 'A320', '767', '747', 'A330': the type as people say it (else its short code). */
export const typeWord = (typeId: string) => { const t = typeOf(typeId); return t.name.match(/\b(A\d{3}|[1-9]\d7)\b/)?.[1] ?? t.short; };
/** 'An' before 'A320' / '8…' / '11…', else 'A'. */
export const an = (w: string) => (/^(A|E|F|H|I|L|M|N|O|R|S|X|8|11|18)/i.test(w) ? 'An' : 'A');

/** v0.8 fix pack: 'The client wants a widebody; CS-TWJ is an A320'. */
export const bodyText = (body: 'narrow' | 'wide', reg: string, typeId: string) => `The client wants a ${body === 'wide' ? 'widebody' : 'narrowbody'}; ${reg} is ${an(typeWord(typeId)).toLowerCase()} ${typeWord(typeId)}`;

/**
 * 'A-check', 'C-check', 'cabin refit', 'crew rest refit' (v0.7.3), 'crew rest seats' (an older v0.7.2 booking);
 * v0.8 fix pack: never a refit, a lease return, the paint shop or an AOG repair called a check.
 */
export const maintWord = (m: Pick<MaintenanceEvent, 'kind' | 'restFit' | 'refit'>): string =>
  m.kind === 'refit' ? (m.restFit ? 'crew rest refit' : m.refit?.restSeats !== undefined ? 'crew rest seats' : 'cabin refit')
  : m.kind === 'return' ? 'lease return check' : m.kind === 'paint' ? 'paint shop' : m.kind === 'AOG' ? 'AOG repair' : m.kind === 'line' ? 'line check' : `${m.kind}-check`;

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
