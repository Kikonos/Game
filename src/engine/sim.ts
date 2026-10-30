// Simulation core: advances the clock through the event queue in (time, seq) order and
// dispatches each event to the modules. Deterministic: no wall clock, no Math.random.

import { contractsModule } from './contracts';
import type { SimModule } from './core/module';
import { clearPause, takePause, type PauseReason } from './core/pause';
import { peek, pop, schedule } from './core/queue';
import { safetyTrip } from './core/safety';
import { DAY, monthKey, nextDayStart } from './core/time';
import type { GameState, Minute, SimEvent, SimEventType } from './core/types';
import { crewModule } from './crew';
import { opsModule } from './ops';
import { scenarioModule } from './scenario/module';

/** Dispatch order for every event type: ops (state machine, money) → contracts → crew (→ v0.12 the scenario's goals, last). */
export const MODULES: SimModule[] = [opsModule, contractsModule, crewModule, scenarioModule];

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

/**
 * Lets modules react to state changed by another module (e.g. crew re-syncs duties after flights were
 * retimed, cancelled or reassigned). Runs after every event and after every player action (store.act).
 */
export function settle(g: GameState, full = true): void {
  for (const m of MODULES) m.settle?.(g, full);
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
 * Stops early (g.now = event time) when an event requests a pause in `honour` (any reason when omitted:
 * tests and the bot). Requests outside `honour` are dropped, so they never leak into a later event.
 */
export function advanceTo(g: GameState, target: Minute, honour?: ReadonlySet<PauseReason>): AdvanceResult {
  const startHour = Math.floor(g.now / 60);
  let events = 0;
  let pause: PauseReason | null = null;
  clearPause();
  settle(g);
  let same = 0;
  for (;;) {
    const top = peek(g);
    if (!top || top.t > target || g.gameOver) break;
    pop(g);
    same = top.t <= g.now ? same + 1 : 0;
    g.now = Math.max(g.now, top.t);
    events++;
    // Safety net: modules re-queueing each other at one instant (a re-planning loop) must not hang the clock.
    if (same > 500 && top.type !== 'day') {
      // v0.8 pre-release: reported (a test fails; the game logs and plays on).
      if (same === 501) safetyTrip('advanceTo', `over 500 events at minute ${g.now} (${top.type} ${top.id})`);
      schedule(g, g.now + 60, top.type, top.id, top.v);
      continue;
    }
    if (top.type === 'day') {
      // Month end first (statements, billing), then the daily jobs, then the next rollover.
      if (monthKey(top.t) !== monthKey(top.t - DAY)) dispatch(g, { ...top, type: 'month' });
      dispatch(g, top);
      schedule(g, top.t + DAY, 'day');
    } else {
      dispatch(g, top);
    }
    settle(g, false);
    pause = takePause(honour);
    if (pause) break;
  }
  // A full settle before anyone looks (or saves): every aircraft's empty legs relinked at this instant.
  if (events && !g.gameOver) settle(g);
  if (!pause && !g.gameOver) g.now = Math.max(g.now, target);
  return { events, pause, hourChanged: Math.floor(g.now / 60) !== startHour };
}
