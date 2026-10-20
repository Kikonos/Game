// Read-only queries shared by the UI and modules. Cheap enough to call per frame for ≤ 10 aircraft.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { flightsOf } from './entities';
import { interpolateGC } from './geo';
import type { Aircraft, Flight, GameState, Minute } from './types';

export type LivePhase = 'parked' | 'taxi' | 'airborne' | 'maintenance' | 'aog' | 'delivering';

export interface AircraftLive {
  aircraft: Aircraft;
  phase: LivePhase;
  /** [lon, lat] now, and slightly ahead for heading (airborne only). */
  pos: [number, number];
  ahead?: [number, number];
  /** Airport when on the ground. */
  at?: string;
  flight?: Flight;
  /** 0–1 along the current flight's block time. */
  progress: number;
  next?: Flight;
}

/** Effective (actual or estimated) off/on blocks of a flight; airborne legs use the queued arrival (eta). */
export function flightTimes(f: Flight): { off: Minute; on: Minute } {
  const off = f.atd ?? f.std + f.delay;
  const on = f.ata ?? f.eta ?? off + f.block;
  return { off, on };
}

export function currentFlight(g: GameState, ac: Aircraft): Flight | undefined {
  return ac.flightId ? g.flights[ac.flightId] : undefined;
}

/** First non-cancelled flight departing at or after t. */
export function nextFlight(g: GameState, aircraftId: string, t: Minute): Flight | undefined {
  for (const f of flightsOf(g, aircraftId)) if (f.status === 'scheduled' && f.std + f.delay >= t) return f;
  return undefined;
}

/** Flights overlapping [from, to). */
export function flightsBetween(g: GameState, aircraftId: string, from: Minute, to: Minute): Flight[] {
  return flightsOf(g, aircraftId).filter((f) => f.sta > from && f.std < to);
}

/** Where an aircraft is at (fractional) time t — for the map; t should be ≥ g.now. */
export function aircraftLive(g: GameState, ac: Aircraft, t: number): AircraftLive {
  const f = currentFlight(g, ac);
  if (f) {
    const { off, on } = flightTimes(f);
    const A = AIRPORT_BY_CODE[f.from];
    const B = AIRPORT_BY_CODE[f.to];
    const span = Math.max(1, on - off);
    const progress = Math.min(1, Math.max(0, (t - off) / span));
    const pos = interpolateGC(A.lon, A.lat, B.lon, B.lat, progress);
    const ahead = interpolateGC(A.lon, A.lat, B.lon, B.lat, Math.min(1, progress + 0.01));
    return { aircraft: ac, phase: 'airborne', pos, ahead, flight: f, progress, next: nextFlight(g, ac.id, on) };
  }
  const A = AIRPORT_BY_CODE[ac.at];
  const phase: LivePhase = ac.status === 'maintenance' ? 'maintenance' : ac.status === 'aog' ? 'aog' : ac.status === 'delivering' ? 'delivering' : 'parked';
  return { aircraft: ac, phase, pos: [A.lon, A.lat], at: ac.at, progress: 0, next: nextFlight(g, ac.id, t) };
}

export function fleetList(g: GameState): Aircraft[] {
  return Object.values(g.fleet);
}
