// Simulation core: advances the clock through the event queue in (time, seq) order and
// dispatches each event to the modules. Deterministic: no wall clock, no Math.random.

import { contractsModule } from './contracts';
import { commercialModule } from './commercial';
import type { SimHandler, SimModule } from './core/module';
import { clearPause, takePause, type PauseReason } from './core/pause';
import { peek, pop, requeue, schedule } from './core/queue';
import { safetyTrip } from './core/safety';
import { asStep } from './core/uiRev';
import { DAY, monthKey, nextDayStart } from './core/time';
import type { GameState, Minute, SimEvent, SimEventType } from './core/types';
import { crewModule } from './crew';
import { networkModule } from './network';
import { opsModule } from './ops';
import { scenarioModule } from './scenario/module';

/** Dispatch order for every event type: ops (state machine, money) → contracts → crew (→ v0.12 the scenario's goals, last). */
/** v0.14 the commercial module (tenders, sales trips, client crises) runs after contracts, before crew. */
/** v0.19 the network module (scheduled routes) runs after commercial, before crew. */
export const MODULES: SimModule[] = [opsModule, contractsModule, commercialModule, networkModule, crewModule, scenarioModule];

const table = new Map<SimEventType, ((g: GameState, ev: SimEvent) => void)[]>();
for (const m of MODULES) {
  for (const [type, h] of Object.entries(m.handlers)) {
    if (!h) continue;
    const list = table.get(type as SimEventType) ?? [];
    list.push(h);
    table.set(type as SimEventType, list);
  }
}

/**
 * v0.25 (perf) the midnight work in phases, in the order of one 'day' dispatch: every module's day handler, a module's
 * dayPhases (crew) splitting it where a part after the first begins. The phases run back to back at 00:00 (see advanceTo).
 */
const DAY_PHASES: SimHandler[][] = [];
{
  let cur: SimHandler[] = [];
  for (const m of MODULES) {
    const parts = m.dayPhases ?? (m.handlers.day ? [m.handlers.day] : []);
    parts.forEach((h, i) => {
      if (i > 0) {
        DAY_PHASES.push(cur);
        cur = [];
      }
      cur.push(h);
    });
  }
  if (cur.length) DAY_PHASES.push(cur);
}

/** v0.25 (perf) the UI drew a frame between two midnight phases: the rest of that midnight is next in the queue. */
export function midDay(g: GameState): boolean {
  const top = peek(g);
  return !!top && top.type === 'day' && top.v > 0 && top.t <= g.now;
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
  // v0.25 (perf) not between two midnight phases: the day finishes first (its last phase is followed by the settle).
  if (midDay(g)) return;
  asStep(() => {
    for (const m of MODULES) m.settle?.(g, full);
  });
}

export interface AdvanceResult {
  /** Events processed. */
  events: number;
  /** Set when a handler asked to pause; g.now is that event's time. */
  pause: PauseReason | null;
  /** A game hour boundary was crossed (UI text refresh cadence). */
  hourChanged: boolean;
  /** v0.25 (perf) `split`: stopped between two midnight phases (g.now is that midnight; the next call goes on). */
  midDay?: boolean;
}

/**
 * Processes every queued event with t ≤ target, then sets g.now = target.
 * Stops early (g.now = event time) when an event requests a pause in `honour` (any reason when omitted:
 * tests and the bot). Requests outside `honour` are dropped, so they never leak into a later event.
 */
export function advanceTo(g: GameState, target: Minute, honour?: ReadonlySet<PauseReason>, split = false): AdvanceResult {
  // v0.15.1 (perf) an engine step: the screens' read-side caches (problem cards, quick feasibility) stay out of it.
  return asStep(() => advanceToRaw(g, target, honour, split));
}

/**
 * v0.25 (perf) `split` (the UI frame loop): return between two midnight phases, so the next frame runs the next one.
 * The phases and everything after them run exactly as in one call: no settle and no pause check between phases, and a
 * call that resumes a midnight keeps the pause requests its phases made (settle is a no-op until the day is done).
 */
function advanceToRaw(g: GameState, target: Minute, honour: ReadonlySet<PauseReason> | undefined, split: boolean): AdvanceResult {
  const startHour = Math.floor(g.now / 60);
  let events = 0;
  let pause: PauseReason | null = null;
  let half = false;
  if (!midDay(g)) clearPause();
  settle(g);
  let same = 0;
  for (;;) {
    const top = peek(g);
    if (!top || top.t > target || g.gameOver) break;
    pop(g);
    const phase = top.type === 'day' ? top.v || 0 : 0;
    if (!phase) same = top.t <= g.now ? same + 1 : 0;
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
      if (!phase && monthKey(top.t) !== monthKey(top.t - DAY)) dispatch(g, { ...top, type: 'month' });
      const ev = { ...top, v: 0 };
      for (let k = phase; k < DAY_PHASES.length; k++) {
        // v0.25 (perf) a frame between two phases (split): the next phase goes first at this minute (the same seq), so
        // nothing else runs in between and the day plays out as in one call.
        if (k > phase && split && !g.gameOver) {
          requeue(g, { ...top, v: k });
          half = true;
          break;
        }
        for (const h of DAY_PHASES[k]) h(g, ev);
      }
      if (half) break;
      schedule(g, top.t + DAY, 'day');
    } else {
      dispatch(g, top);
    }
    settle(g, false);
    pause = takePause(honour);
    if (pause) break;
  }
  if (half) return { events, pause, hourChanged: Math.floor(g.now / 60) !== startHour, midDay: true };
  // A full settle before anyone looks (or saves): every aircraft's empty legs relinked at this instant.
  if (events && !g.gameOver) settle(g);
  if (!pause && !g.gameOver) g.now = Math.max(g.now, target);
  return { events, pause, hourChanged: Math.floor(g.now / 60) !== startHour };
}
