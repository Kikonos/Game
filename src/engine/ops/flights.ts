// Flight execution state machine (B3). DESIGN.md §5.5. The skeleton moves aircraft between
// airports on time; B3 adds delays, AOG at departure, costs, crew checks and stats.

import { schedule } from '../core/queue';
import type { ActionResult, GameState, SimEvent } from '../core/types';

/** 'flight.dep' at std (+delay): off-blocks if aircraft and crew are ready, else delay/cancel. */
export function onFlightDep(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v || f.status !== 'scheduled' || !f.aircraftId) return;
  const ac = g.fleet[f.aircraftId];
  if (!ac) return;
  // TODO(B3): readiness (maintenance/AOG, aircraft position, crew legality), delay roll, AOG roll, delay → retime.
  f.status = 'enroute';
  f.atd = g.now;
  ac.flightId = f.id;
  ac.at = f.from;
  ac.status = 'flying';
  // TODO(B3): block × (1 ± 4% wind noise); the map interpolates to eta.
  f.eta = g.now + f.block;
  schedule(g, f.eta, 'flight.arr', f.id, f.ev);
}

/** 'flight.arr': on-blocks; aircraft parked at destination; hours/cycles; costs (fuel and fees on charters/ferries). */
export function onFlightArr(g: GameState, ev: SimEvent): void {
  const f = g.flights[ev.id];
  if (!f || f.ev !== ev.v) return;
  // Deadheads and sub-chartered legs (no aircraft): done on time; contracts bill, crew moves deadheaders.
  if (!f.aircraftId) {
    if (f.status !== 'scheduled') return;
    f.status = 'done';
    f.atd = f.std;
    f.ata = g.now;
    return;
  }
  if (f.status !== 'enroute') return;
  const ac = g.fleet[f.aircraftId];
  f.status = 'done';
  f.ata = g.now;
  if (!ac) return;
  ac.flightId = null;
  ac.at = f.to;
  ac.status = 'available';
  const fh = Math.max(0, f.block - 20) / 60;
  ac.hours += fh;
  ac.cycles += 1;
  ac.maint.fhSinceA += fh;
  ac.maint.fhSinceC += fh;
  // TODO(B3): fuel/fees/catering on charter & ferry legs, on-time stats, reputation, deferred-defect drift.
}

/** Delays a scheduled flight and ripples to the aircraft's following legs (respecting turn minima). TODO(B3) */
export function delayFlight(_g: GameState, _flightId: string, _minutes: number, _reason: string): ActionResult {
  return { ok: false, error: 'Delays are not built yet' };
}

/** Daily: drop done/cancelled flights older than 40 days (billing has used them). TODO(B3) */
export function pruneFlights(_g: GameState): void {}
