// Fictional clients from the naming kit (B1).

import { CLIENT_SEEDS } from '../../data/naming';
import { nextId } from '../core/entities';
import type { Client, GameState } from '../core/types';

/** Seeds g.clients at new game. TODO(B1): tune payment behaviour per kind (governments pay late, start-ups risky). */
export function seedClients(g: GameState): void {
  for (const s of CLIENT_SEEDS) {
    const gov = s.kind === 'government' || s.kind === 'agency';
    const c: Client = {
      id: nextId(g, 'cl'),
      name: s.name,
      kind: s.kind,
      country: s.country,
      base: s.base,
      payReliability: gov ? 0.45 : 0.9,
      lateDays: gov ? [20, 75] : [3, 15],
      cleanSensitivity: s.kind === 'airline' || s.kind === 'sports' ? 0.6 : 0.2,
      relation: 0,
    };
    g.clients[c.id] = c;
  }
}
