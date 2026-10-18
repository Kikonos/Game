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

/** Product of active modifiers of a kind that touch either endpoint. */
export function modifierFor(state: GameState, kind: Modifier['kind'], a: string, b?: string): number {
  const A = AIRPORT_BY_CODE[a];
  const B = b ? AIRPORT_BY_CODE[b] : undefined;
  let mult = 1;
  for (const m of state.modifiers) {
    if (m.kind !== kind || m.startDay > state.day || m.endDay < state.day) continue;
    if (matches(m, A) || (B && matches(m, B))) mult *= m.mult;
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
