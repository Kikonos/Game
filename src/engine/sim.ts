// Simulation core: advances the clock through the event queue in (time, seq) order and
// dispatches each event to the modules. Deterministic: no wall clock, no Math.random.

import { contractsModule } from './contracts';
import type { SimModule } from './core/module';
import { takePause, type PauseReason } from './core/pause';
import { peek, pop, schedule } from './core/queue';
import { DAY, monthKey, nextDayStart } from './core/time';
import type { GameState, Minute, SimEvent, SimEventType } from './core/types';
import { crewModule } from './crew';
import { opsModule } from './ops';

/** Dispatch order for every event type: ops (state machine, money) → contracts → crew. */
export const MODULES: SimModule[] = [opsModule, contractsModule, crewModule];

const table = new Map<SimEventType, ((g: GameState, ev: SimEvent) => void)[]>();
for (const m of MODULES) {
  for (const [type, h] of Object.entries(m.handlers)) {
    if (!h) continue;
    const list = table.get(type as SimEventType) ?? [];
    list.push(h);
    table.set(type as SimEventType, list);
  }
}

function dispatch(g: GameState, ev: SimEvent) {
  const list = table.get(ev.type) ?? [];
  // Month end runs crew (salaries) → contracts (billing) → ops (fixed costs, closes the statement last).
  if (ev.type === 'month') for (let i = list.length - 1; i >= 0; i--) list[i](g, ev);
  else for (const h of list) h(g, ev);
}

/** Queues the first daily rollover; called by newGame. */
export function initCore(g: GameState): void {
  schedule(g, nextDayStart(g.now), 'day');
  for (const m of MODULES) m.init?.(g);
}

export function onLoad(g: GameState): void {
  for (const m of MODULES) m.load?.(g);
}

export interface AdvanceResult {
  /** Events processed. */
  events: number;
  /** Set when a handler asked to pause; g.now is that event's time. */
  pause: PauseReason | null;
  /** A game hour boundary was crossed (UI text refresh cadence). */
  hourChanged: boolean;
}

/**
 * Processes every queued event with t ≤ target, then sets g.now = target.
 * Stops early (g.now = event time) when an event requests a pause.
 */
export function advanceTo(g: GameState, target: Minute): AdvanceResult {
  const startHour = Math.floor(g.now / 60);
  let events = 0;
  let pause: PauseReason | null = null;
  for (;;) {
    const top = peek(g);
    if (!top || top.t > target || g.gameOver) break;
    pop(g);
    g.now = Math.max(g.now, top.t);
    events++;
    if (top.type === 'day') {
      // Month end first (statements, billing), then the daily jobs, then the next rollover.
      if (monthKey(top.t) !== monthKey(top.t - DAY)) dispatch(g, { ...top, type: 'month' });
      dispatch(g, top);
      schedule(g, top.t + DAY, 'day');
    } else {
      dispatch(g, top);
    }
    pause = takePause();
    if (pause) break;
  }
  if (!pause && !g.gameOver) g.now = Math.max(g.now, target);
  return { events, pause, hourChanged: Math.floor(g.now / 60) !== startHour };
}
