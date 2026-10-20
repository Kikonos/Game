// Deterministic event queue: a binary min-heap of SimEvents ordered by (t, seq), stored in the save.

import type { GameState, Minute, SimEvent, SimEventType } from './types';

const less = (a: SimEvent, b: SimEvent) => a.t < b.t || (a.t === b.t && a.seq < b.seq);

/** Queue an event. `v` is the entity's ev at scheduling time (stale events are skipped by handlers). */
export function schedule(g: GameState, t: Minute, type: SimEventType, id = '', v = 0): void {
  const q = g.queue;
  const ev: SimEvent = { t: Math.round(t), seq: ++g.seq, type, id, v };
  q.push(ev);
  let i = q.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(q[i], q[p])) break;
    [q[i], q[p]] = [q[p], q[i]];
    i = p;
  }
}

export function peek(g: GameState): SimEvent | undefined {
  return g.queue[0];
}

export function pop(g: GameState): SimEvent | undefined {
  const q = g.queue;
  if (!q.length) return undefined;
  const top = q[0];
  const last = q.pop()!;
  if (q.length) {
    q[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < q.length && less(q[l], q[m])) m = l;
      if (r < q.length && less(q[r], q[m])) m = r;
      if (m === i) break;
      [q[i], q[m]] = [q[m], q[i]];
      i = m;
    }
  }
  return top;
}

/** Drop queued events matching a predicate (rarely needed: prefer bumping the entity's ev). */
export function unschedule(g: GameState, match: (e: SimEvent) => boolean): void {
  const keep = g.queue.filter((e) => !match(e));
  g.queue = [];
  for (const e of keep.sort((a, b) => a.t - b.t || a.seq - b.seq)) g.queue.push(e);
}

/** Versioned event families: entity collection per type prefix (stale = missing entity or ev mismatch). */
const VERSIONED: [string, (g: GameState) => Record<string, { ev: number }>][] = [
  ['flight.', (g) => g.flights],
  ['duty.', (g) => g.duties],
  ['maint.', (g) => g.maintenance],
];

/** The queue without stale versioned events, as a valid heap (sorted). Used on save; does not mutate g. */
export function compactQueue(g: GameState): SimEvent[] {
  const live = g.queue.filter((e) => {
    for (const [prefix, coll] of VERSIONED) {
      if (!e.type.startsWith(prefix)) continue;
      const x = coll(g)[e.id];
      return !!x && x.ev === e.v;
    }
    return true;
  });
  return live.sort((a, b) => a.t - b.t || a.seq - b.seq);
}
