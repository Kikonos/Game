import { AIRPORT_BY_CODE, type Airport } from '../data/airports';
import type { GameState, Modifier } from './types';

function matches(m: Modifier, a: Airport): boolean {
  switch (m.scope) {
    case 'global': return true;
    case 'continent': return m.targets.includes(a.continent);
    case 'region': return m.targets.includes(a.region);
    case 'country': return m.targets.includes(a.country);
    case 'airport': return m.targets.includes(a.code);
  }
}

interface Cache {
  day: number;
  mods: Modifier[];
  len: number;
  perAirport: Map<string, Modifier[]>;
}

const caches = new WeakMap<GameState, Cache>();

/** Active modifiers touching an airport today (cached per day). */
function activeFor(state: GameState, code: string): Modifier[] {
  let c = caches.get(state);
  if (!c || c.day !== state.day || c.mods !== state.modifiers || c.len !== state.modifiers.length) {
    c = { day: state.day, mods: state.modifiers, len: state.modifiers.length, perAirport: new Map() };
    caches.set(state, c);
  }
  let list = c.perAirport.get(code);
  if (!list) {
    const a = AIRPORT_BY_CODE[code];
    list = state.modifiers.filter((m) => m.startDay <= state.day && m.endDay >= state.day && matches(m, a));
    c.perAirport.set(code, list);
  }
  return list;
}

/** Product of active modifiers of a kind that touch either endpoint (each counted once). */
export function modifierFor(state: GameState, kind: Modifier['kind'], a: string, b?: string): number {
  let mult = 1;
  const la = activeFor(state, a);
  for (const m of la) if (m.kind === kind) mult *= m.mult;
  if (b) {
    for (const m of activeFor(state, b)) if (m.kind === kind && !la.includes(m)) mult *= m.mult;
  }
  return mult;
}

export function globalModifier(state: GameState, kind: Modifier['kind']): number {
  let mult = 1;
  for (const m of state.modifiers) {
    if (m.kind === kind && m.scope === 'global' && m.startDay <= state.day && m.endDay >= state.day) mult *= m.mult;
  }
  return mult;
}
