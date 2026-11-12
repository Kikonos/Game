// v0.19 the network's Inbox notes (topic 'network', ref the route): launch steps, setbacks, decisions waiting, weak
// bookings, no aircraft, rival reactions. Each chimes and toasts as its tone says (core/cues via pushMessage).

import type { Cue } from '../core/cues';
import { pushMessage } from '../core/messages';
import type { GameState, Message } from '../core/types';
import type { Route } from './types';

/** Posts a route note; `once` keys it on the route so it is said once; `cue` 'silent' or its own cue (v0.23.1). */
export function pushRouteNote(g: GameState, route: Route, tone: Message['tone'], title: string, body: string, once: string | null, cue?: 'silent' | Cue): void {
  if (once) {
    const told = (route.told ??= {});
    if (told[once] !== undefined) return;
    told[once] = g.now;
  }
  pushMessage(g, { tone, cat: 'commercial', topic: 'network', title, body, ref: { kind: 'route', id: route.id }, ...(cue === 'silent' ? { cue: null } : cue ? { cue } : {}) });
}
